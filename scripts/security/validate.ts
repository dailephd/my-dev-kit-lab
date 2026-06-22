#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { runSecurityValidation } from "../../src/securityValidation/validate/runSecurityValidation.js";
import { renderTextReport, renderJsonReport } from "../../src/securityValidation/report/renderSecurityReport.js";
import type { SecurityReport } from "../../src/securityValidation/report/securityReportTypes.js";

const cwd = process.cwd();

console.log("=".repeat(60));
console.log("my-dev-kit-lab security:validate");
console.log("=".repeat(60));
console.log(`Working directory: ${cwd}`);
console.log("");

const summary = await runSecurityValidation({
  cwd,
  fuzzIterations: parseInt(process.env["FUZZ_ITERATIONS"] ?? "50", 10),
  fuzzSeed: parseInt(process.env["FUZZ_SEED"] ?? "0xDEADBEEF", 16),
});

// Build report object
const report: SecurityReport = {
  metadata: {
    packageName: summary.packageName,
    packageVersion: summary.packageVersion,
    branch: summary.auditedBranch,
    commit: summary.auditedCommit,
    generatedAt: summary.finishedAt,
    totalDurationMs:
      new Date(summary.finishedAt).getTime() - new Date(summary.startedAt).getTime(),
  },
  sections: [],
  allChecks: summary.checks,
  allFindings: summary.findings,
  verdict: summary.verdict,
  recommendedNextStep: summary.recommendedNextStep,
};

const textReport = renderTextReport(report);
const jsonReport = renderJsonReport(report);

// Write reports to reports/ directory (not committed by default — see .gitignore)
const reportsDir = path.join(cwd, "reports");
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

const version = summary.packageVersion;
const txtPath = path.join(reportsDir, `v${version}-security-validation.txt`);
const jsonPath = path.join(reportsDir, `v${version}-security-validation.json`);

fs.writeFileSync(txtPath, textReport, "utf8");
fs.writeFileSync(jsonPath, jsonReport, "utf8");

// Print report to stdout as well
console.log(textReport);

console.log(`\nReports written:`);
console.log(`  ${txtPath}`);
console.log(`  ${jsonPath}`);

// Exit code based on verdict
const blockerExists =
  summary.verdict === "not-ready-security-blocker-remains";
const inconclusive =
  summary.verdict === "inconclusive-audit-environment-incomplete";

if (blockerExists) {
  console.error("\nExit 1 — security blocker remains.");
  process.exitCode = 1;
} else if (inconclusive) {
  console.warn("\nExit 2 — audit environment incomplete.");
  process.exitCode = 2;
} else {
  console.log("\nExit 0 — validation completed.");
  process.exitCode = 0;
}
