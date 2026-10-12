#!/usr/bin/env node
// Writes one test-run record (Layer A + Layer B) to results/runs/, for the
// upgrade tracker and for git history. Called by script/safety-net.sh.
//
//   node contract/summarize.mjs --hop baseline --rspec <file with rspec output>
//        --report contract/reports/last-run.json --compare contract/reports/baseline.json
//        --version 3.4.0.beta4-dev --branch safety-net/baseline --commit abc123
//        [--maestro contract/.local/layer-c-last.json --maestro-baseline contract/reports/layer-c-baseline.json]
//
// Layer C (Maestro) fails only when a flow that passed on the baseline fails
// now: some flows need staging data the local copy doesn't have. The first
// Layer C run with --hop baseline becomes that baseline.
//
// Like the contract reports, the record holds counts, check names and field
// names only. Never data values.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function layerA() {
  if (!args.rspec) return null;
  let text = "";
  try {
    text = await readFile(args.rspec, "utf8");
  } catch {
    return null;
  }
  const match = text.match(/(\d+) examples?, (\d+) failures?/);
  if (!match) return { examples: 0, failures: 0, error: "no rspec summary found (tests did not run)" };
  const failed = [...text.matchAll(/^rspec \.\/(spec\/\S+) # (.+)$/gm)].map((m) => `${m[1]}: ${m[2]}`);
  return { examples: Number(match[1]), failures: Number(match[2]), failed };
}

async function layerB() {
  const report = args.report && (await readJson(args.report));
  if (!report) return null;
  const count = (r) => report.results.filter((x) => x.result === r).length;
  const baseline = args.compare && (await readJson(args.compare));
  const key = (r) => `${r.id}|${r.area}|${r.name}`;
  const before = new Map((baseline?.results || []).map((r) => [key(r), r.result]));
  const changed = report.results
    .filter((r) => before.has(key(r)) && before.get(key(r)) !== r.result && r.result !== "SKIPPED" && before.get(key(r)) !== "SKIPPED")
    .map((r) => `#${r.id} ${r.area}: ${r.name} (${before.get(key(r))} -> ${r.result})`);
  return {
    passed: count("PASS"),
    failed: count("FAIL"),
    unverified: count("UNVERIFIED"),
    skipped: count("SKIPPED"),
    changed_vs_baseline: changed,
    failed_checks: report.results
      .filter((r) => r.result === "FAIL")
      .map((r) => ({ id: String(r.id), name: `${r.area}: ${r.name}`, problems: r.problems })),
  };
}

async function layerC() {
  const c = args.maestro && (await readJson(args.maestro));
  if (!c) return null;
  if (c.error) return { passed: 0, total: 0, failed: [], error: c.error, regressions: [] };
  let baseline = args["maestro-baseline"] && (await readJson(args["maestro-baseline"]));
  if (!baseline && args.hop === "baseline" && args["maestro-baseline"]) {
    await writeFile(args["maestro-baseline"], JSON.stringify(c, null, 2));
    baseline = c;
    console.log(`Layer C baseline saved: ${path.relative(process.cwd(), args["maestro-baseline"])}`);
  }
  const regressions = baseline ? (baseline.passed_flows || []).filter((name) => c.failed.includes(name)) : [];
  return {
    passed: c.passed,
    total: c.total,
    failed: c.failed,
    regressions,
    compared_with_baseline: Boolean(baseline),
  };
}

const a = await layerA();
const b = await layerB();
const c = await layerC();
const abPass = a && b && !a.error && a.failures === 0 && b.failed === 0 && b.changed_vs_baseline.length === 0;
const cPass = !c || (!c.error && c.regressions.length === 0);
const verdict = abPass && cPass ? "pass" : "fail";

const ranAt = new Date();
const record = {
  hop: args.hop,
  discourse_version: args.version,
  branch: args.branch,
  commit: args.commit,
  ran_at: ranAt.toISOString(),
  verdict,
  layer_a: a,
  layer_b: b,
  layer_c: c,
};

const stamp = ranAt.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const dir = path.join(here, "..", "results", "runs");
await mkdir(dir, { recursive: true });
const file = path.join(dir, `${args.hop}_${stamp}.json`);
await writeFile(file, JSON.stringify(record, null, 2));
if (c) {
  console.log(
    c.error
      ? `  Layer C (app flows):      NOT RUN (${c.error})`
      : `  Layer C (app flows):      ${c.regressions.length ? "FAIL" : "PASS"}  ${c.passed} / ${c.total} flows` +
          (c.regressions.length ? `, newly failing: ${c.regressions.join(", ")}` : "") +
          (c.compared_with_baseline ? "" : " (no Layer C baseline yet)"),
  );
}
console.log(`Run recorded: results/runs/${path.basename(file)}  (verdict: ${verdict.toUpperCase()})`);
process.exitCode = verdict === "pass" ? 0 : 1;
