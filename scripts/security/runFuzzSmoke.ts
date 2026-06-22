#!/usr/bin/env node
import { runAllFuzzTargets } from "../../src/securityValidation/fuzz/fuzzHarness.js";
import { ALL_FUZZ_TARGETS } from "../../src/securityValidation/fuzz/fuzzTargets.js";

const SEED = parseInt(process.env["FUZZ_SEED"] ?? "0xDEADBEEF", 16);
const ITERATIONS = parseInt(process.env["FUZZ_ITERATIONS"] ?? "50", 10);

console.log(`Running fuzz smoke tests...`);
console.log(`  Targets   : ${ALL_FUZZ_TARGETS.length}`);
console.log(`  Seed      : 0x${SEED.toString(16).toUpperCase()}`);
console.log(`  Iterations: ${ITERATIONS} per target`);

const result = await runAllFuzzTargets(ALL_FUZZ_TARGETS, {
  seed: SEED,
  iterations: ITERATIONS,
});

console.log(`\nStatus  : ${result.status.toUpperCase()}`);
console.log(`Duration: ${result.durationMs}ms`);
console.log(`Crashes : ${result.findings.length}`);

if (result.findings.length > 0) {
  console.log("\nCrash findings:");
  for (const f of result.findings) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.title}`);
    if (f.evidence) console.log(`    Evidence: ${f.evidence.slice(0, 160)}`);
  }
  process.exitCode = 1;
} else {
  console.log("\nAll fuzz targets completed without crashes.");
  process.exitCode = 0;
}
