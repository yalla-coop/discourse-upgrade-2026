#!/usr/bin/env node
// Layer B contract checks: does Discourse still return every field Prose reads?
//
//   node contract/run.mjs --env docker                     read-only checks
//   node contract/run.mjs --env docker --writes            also checks that create data
//   node contract/run.mjs --env docker --label baseline    save contract/reports/baseline.json
//   node contract/run.mjs --env docker --compare baseline  show what changed since baseline
//   node contract/run.mjs --env docker --only 34,59        run selected inventory rows
//
// --env NAME reads contract/.local/NAME.json:
//   { "base_url": "...", "member": { "username", "password" },
//     "member2": { "username", "password" }, "admin": { "username", "api_key" } }
//
// Reports contain field names, types and HTTP statuses only. Never values.

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { Session } from "./lib/session.mjs";
import { checkShape } from "./lib/shape.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// The live production site must never be used for these checks.
const FORBIDDEN_HOSTS = [/(^|\.)forwardtrust\.org\.uk$/i];

function parseArgs(argv) {
  const args = { writes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--writes") args.writes = true;
    else if (arg.startsWith("--")) args[arg.slice(2)] = argv[++i];
  }
  return args;
}

async function loadChecks(only) {
  const dir = path.join(here, "checks");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".mjs")).sort();
  const checks = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(path.join(dir, file)))).default;
    for (const check of mod.checks) checks.push({ ...check, area: mod.area, sourceFile: file });
  }
  if (!only) return checks;
  const ids = new Set(only.split(","));
  return checks.filter((c) => ids.has(String(c.id)) || c.id === 2); // always log in
}

function expectedStatuses(check) {
  return Array.isArray(check.status) ? check.status : [check.status ?? 200];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.env) {
    console.error("Usage: node contract/run.mjs --env NAME [--writes] [--label NAME] [--compare NAME] [--only 1,2]");
    process.exit(2);
  }

  const config = JSON.parse(await readFile(path.join(here, ".local", `${args.env}.json`), "utf8"));
  const host = new URL(config.base_url).hostname;
  if (FORBIDDEN_HOSTS.some((pattern) => pattern.test(host))) {
    console.error(`Refusing to run against ${host}: contract checks never run on production.`);
    process.exit(2);
  }

  const sessions = {
    anon: new Session(config.base_url),
    member: new Session(config.base_url),
    member2: new Session(config.base_url),
    admin: new Session(config.base_url, {
      apiKey: config.admin.api_key,
      apiUsername: config.admin.username,
    }),
  };
  const ctx = {
    username: config.member.username,
    memberEmail: config.member.email,
    member2Username: config.member2?.username,
    adminUsername: config.admin.username,
  };

  const checks = await loadChecks(args.only);
  const results = [];

  for (const check of checks) {
    const label = `#${String(check.id).padStart(2)} ${check.area}: ${check.name}`;
    if (check.write && !args.writes) {
      results.push({ id: check.id, area: check.area, name: check.name, result: "SKIPPED", reason: "write check (use --writes)" });
      continue;
    }

    if (check.as === "member2" && !sessions.member2.loggedIn && config.member2) {
      await sessions.member2.login(config.member2.username, config.member2.password);
    }

    let response;
    try {
      if (check.run) {
        response = await check.run(sessions, ctx, config);
      } else {
        const session = sessions[check.as || "member"];
        const requestPath = typeof check.path === "function" ? check.path(ctx) : check.path;
        const form = typeof check.form === "function" ? check.form(ctx) : check.form;
        const json = typeof check.json === "function" ? check.json(ctx) : check.json;
        const multipart = check.multipart
          ? { fields: typeof check.fields === "function" ? check.fields(ctx) : check.fields, file: check.file }
          : undefined;
        if (requestPath == null || requestPath.includes("undefined")) {
          results.push({ id: check.id, area: check.area, name: check.name, result: "UNVERIFIED", problems: [], unverified: ["an id this check needs was not found by earlier checks"] });
          console.log(`?  ${label}  (missing id from earlier checks)`);
          continue;
        }
        response = await session.request(check.method, requestPath, { form, json, multipart });
      }
    } catch (error) {
      results.push({ id: check.id, area: check.area, name: check.name, result: "FAIL", problems: [`request failed: ${error.message}`] });
      console.log(`✗  ${label}\n     request failed: ${error.message}`);
      continue;
    }

    // Discourse rate limits (e.g. forgot password: 3/minute, 6/hour) say nothing
    // about the API contract, so they are reported as not verified.
    const errorText = JSON.stringify(response.data?.errors || "");
    if (response.status === 429 || (response.status === 422 && /too many times/i.test(errorText))) {
      results.push({ id: check.id, area: check.area, name: check.name, result: "UNVERIFIED", status: response.status, problems: [], unverified: ["rate limited by Discourse, run again later"] });
      console.log(`?  ${label}\n     not verified: rate limited by Discourse, run again later`);
      continue;
    }

    const problems = [...(response.problems || [])];
    const allowed = expectedStatuses(check);
    if (!allowed.includes(response.status)) {
      problems.push(`HTTP ${response.status} (expected ${allowed.join(" or ")})`);
    }
    let unverified = [];
    if (allowed.includes(response.status) && response.status < 300) {
      const shape = checkShape(response.data, check.expect || {});
      problems.push(...shape.problems);
      unverified = shape.unverified;
      try {
        problems.push(...(check.verify?.(response.data, ctx) || []));
      } catch (error) {
        problems.push(`verify failed: ${error.message}`);
      }
      try {
        check.capture?.(response.data, ctx);
      } catch (error) {
        problems.push(`capture failed: ${error.message}`);
      }
    }

    if (check.cleanup) {
      try {
        await check.cleanup(sessions, ctx, config);
      } catch (error) {
        console.log(`   cleanup failed for ${label}: ${error.message}`);
      }
    }

    const result = problems.length ? "FAIL" : unverified.length ? "UNVERIFIED" : "PASS";
    results.push({ id: check.id, area: check.area, name: check.name, result, status: response.status, problems, unverified });

    const mark = { PASS: "✓", FAIL: "✗", UNVERIFIED: "?" }[result];
    console.log(`${mark}  ${label}`);
    for (const p of problems) console.log(`     ${p}`);
    for (const u of unverified) console.log(`     not verified: ${u}`);
    if (result === "FAIL" && response.data?.errors) {
      console.log(`     (Discourse said: ${JSON.stringify(response.data.errors).slice(0, 200)})`);
    }
  }

  const count = (r) => results.filter((x) => x.result === r).length;
  console.log(
    `\n${count("PASS")} passed, ${count("FAIL")} failed, ${count("UNVERIFIED")} not verified, ${count("SKIPPED")} skipped`,
  );

  const reportsDir = path.join(here, "reports");
  if (args.label) {
    await mkdir(reportsDir, { recursive: true });
    const report = { label: args.label, env: args.env, writes: args.writes, ran_at: new Date().toISOString(), results };
    await writeFile(path.join(reportsDir, `${args.label}.json`), JSON.stringify(report, null, 2));
    console.log(`Report saved to contract/reports/${args.label}.json`);
  }

  if (args.compare) {
    const before = JSON.parse(await readFile(path.join(reportsDir, `${args.compare}.json`), "utf8"));
    const key = (r) => `${r.id}|${r.area}|${r.name}`;
    const previous = new Map(before.results.map((r) => [key(r), r]));
    const changed = results.filter((r) => {
      const was = previous.get(key(r));
      return was && was.result !== r.result && was.result !== "SKIPPED" && r.result !== "SKIPPED";
    });
    console.log(`\nCompared with ${args.compare}: ${changed.length} check(s) changed`);
    for (const r of changed) console.log(`  #${r.id} ${r.area}: ${r.name}  ${previous.get(key(r)).result} -> ${r.result}`);
  }

  process.exit(count("FAIL") ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
