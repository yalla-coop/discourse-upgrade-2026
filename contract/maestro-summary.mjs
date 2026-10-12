#!/usr/bin/env node
// Reads a Maestro run log (from .maestro/run.sh) and writes Layer C results:
//   { passed, total, failed: [flow names], passed_flows: [flow names] }
// or { error } when no flow ran (for example the app build failed).
//
//   node contract/maestro-summary.mjs <maestro log> <output json>

import { readFile, writeFile } from "node:fs/promises";

const [logFile, outFile] = process.argv.slice(2);
const text = (await readFile(logFile, "utf8")).replace(/\x1b\[[0-9;]*m/g, "");

// Maestro prints one line per flow: "[Passed] TC001 - App launch readiness (12s)"
// or "[Failed] TC023 - Posts search (31s) (Element not found: ...)".
const flows = new Map();
for (const match of text.matchAll(/^\s*\[(Passed|Failed)\]\s+(.+?)\s+\(\d[\dhms. ]*\)/gm)) {
  flows.set(match[2].trim(), match[1]);
}

let result;
if (flows.size) {
  const passed = [...flows].filter(([, r]) => r === "Passed").map(([name]) => name);
  const failed = [...flows].filter(([, r]) => r === "Failed").map(([name]) => name);
  result = { passed: passed.length, total: flows.size, failed, passed_flows: passed };
} else {
  const summary = text.match(/(\d+)\/(\d+) Flows? (Passed|Failed)/);
  result = summary
    ? summary[3] === "Passed"
      ? { passed: Number(summary[1]), total: Number(summary[2]), failed: [], passed_flows: [] }
      : { passed: Number(summary[2]) - Number(summary[1]), total: Number(summary[2]), failed: [], passed_flows: [] }
    : { error: "No Maestro flow results found in the log (did the build or the emulator fail?)" };
}

await writeFile(outFile, JSON.stringify(result, null, 2));
console.log(
  result.error
    ? `Layer C: ${result.error}`
    : `Layer C: ${result.passed} / ${result.total} flows passed${result.failed.length ? ` (failed: ${result.failed.join(", ")})` : ""}`,
);
