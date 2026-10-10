#!/usr/bin/env node
// ---------------------------------------------------------------------------
// v0.4.6 Batch 5 -- exact packed-package installation/execution acceptance
// gate.
//
// Proves the sequence a real consumer experiences: build -> npm pack ->
// install the exact .tgz into a clean temporary consumer project -> run the
// installed my-dev-kit-lab binary -> verify writable output goes to the lab
// workspace, the inspected target is unchanged, and the installed package
// itself is unchanged -> clean up.
//
// Node-only (no bash/PowerShell/platform-specific commands) so the same
// implementation runs identically on Windows, macOS, and Linux. Reuses the
// repository's own compiled cross-platform command-resolution helper
// (dist/src/core/resolveCommand.js) instead of duplicating shim-resolution
// logic -- this script only runs after a build, so that compiled module is
// guaranteed to exist.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AGENT_SUCCESS_GATE_LABELS, AGENT_SUCCESS_REQUIRED_TARBALL_PATHS, runAgentSuccessPackedAcceptance } from "./verifyPackedPackageAgentSuccess.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, "package.json");
const SOURCE_PACKAGE_JSON = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
const EXPECTED_PACKAGE_NAME = SOURCE_PACKAGE_JSON.name;
const EXPECTED_PACKAGE_VERSION = SOURCE_PACKAGE_JSON.version;
const EXPECTED_ENGINES_NODE = SOURCE_PACKAGE_JSON.engines?.node;
const EXPECTED_BIN_NAME = "my-dev-kit-lab";
const EXPECTED_BIN_TARGET = SOURCE_PACKAGE_JSON.bin?.[EXPECTED_BIN_NAME];
const EXPECTED_PLAYWRIGHT_VERSION = SOURCE_PACKAGE_JSON.dependencies?.playwright;

// Confirms the tarball carries every runtime file the public routes tested
// by this gate actually depend on. Not a full package-content reconciliation
// (that is Batch 6's job) -- only the material this batch's own installed
// execution proves is required.
const REQUIRED_TARBALL_PATHS = [
  "package.json",
  "dist/scripts/cli.js",
  "dist/scripts/run-final-demo.js",
  "dist/src/runtime/labExecutionContext.js",
  "dist/src/runtime/packageRoot.js",
  "dist/src/runtime/packageResource.js",
  "dist/src/cli/runLabCli.js",
  "dist/src/commands/runAuditCommand.js",
  "dist/src/commands/runSecurityValidationCommand.js",
  "dist/src/commands/runExperimentListCommand.js",
  "dist/src/commands/runExperimentDescribeCommand.js",
  "dist/src/commands/runExperimentRunCommand.js",
  "dist/src/commands/runControlledExperimentCommand.js",
  "dist/src/browser/playwrightRuntime.js",
  "dist/src/runtime/managedProcess.js",
  "dist/src/tutorial/runTutorial.js",
  "dist/src/tutorial/tutorialActions.js",
  "dist/src/tutorial/tutorialPointerGeometry.js",
  "dist/src/tutorial/tutorialSession.js",
  "dist/src/tutorial/tutorialArtifacts.js",
  "dist/src/tutorial/tutorialManifest.js",
  "dist/src/commands/runTutorialValidateCommand.js",
  "dist/src/commands/runTutorialRunCommand.js",
  "dist/src/experiments/plugins/warmIndexReuse/plugin.js",
  "dist/src/experiments/plugins/warmIndexReuse/execution.js",
  "dist/src/experiments/plugins/warmIndexReuse/metrics.js",
  "dist/src/experiments/plugins/warmIndexReuse/fakeAgentEvaluation.js",
  // v0.6.0 -- index-build snapshot evidence.
  "dist/src/evaluation/indexSnapshot.js",
  // v0.6.1 -- affected-neighborhood graph evidence, mapping, and assessment.
  "dist/src/evaluation/affectedNeighborhood.js",
  "dist/src/evaluation/indexFreshness.js",
  // v0.5.2 -- real-agent campaign runtime.
  "dist/src/experiments/plugins/warmIndexReuse/campaignPresets.js",
  "dist/src/experiments/plugins/warmIndexReuse/agentEvaluation.js",
  "dist/src/experiments/plugins/warmIndexReuse/realAgentPrompt.js",
  "dist/src/commands/runWarmIndexCampaignPresentation.js",
  "dist/src/gallery/writeWarmIndexCampaignGallery.js",
  "dist/src/report/experiments/buildWarmIndexReuseReport.js",
  "dist/src/report/experiments/renderWarmIndexReuseHtml.js",
  "dist/src/plots/buildWarmIndexPlotData.js",
  "dist/src/screenshot/captureReportScreenshot.js",
  "dist/src/commands/generateExperimentPlotsCommand.js",
  // v0.6.2 -- incremental-change-staleness plugin, execution/comparison artifact, and report owners.
  "dist/src/experiments/plugins/incrementalChangeStaleness/plugin.js",
  "dist/src/experiments/plugins/incrementalChangeStaleness/execution.js",
  "dist/src/experiments/plugins/incrementalChangeStaleness/executionArtifact.js",
  "dist/src/experiments/plugins/incrementalChangeStaleness/comparison.js",
  "dist/src/experiments/plugins/incrementalChangeStaleness/lifecycle.js",
  "dist/src/experiments/plugins/incrementalChangeStaleness/disposableTarget.js",
  // v0.6.3 -- four-treatment V2 lifecycle, execution, comparison, artifact, and report owners.
  "dist/src/experiments/plugins/incrementalChangeStaleness/lifecycleV2.js",
  "dist/src/experiments/plugins/incrementalChangeStaleness/executionV2.js",
  "dist/src/experiments/plugins/incrementalChangeStaleness/comparisonV2.js",
  "dist/src/experiments/plugins/incrementalChangeStaleness/executionArtifactV2.js",
  "dist/src/report/experiments/buildIncrementalChangeStalenessReportV2.js",
  "dist/src/report/experiments/renderIncrementalChangeStalenessTextV2.js",
  "dist/src/report/experiments/renderIncrementalChangeStalenessHtmlV2.js",
  "dist/src/report/experiments/buildIncrementalChangeStalenessReport.js",
  "dist/src/report/experiments/renderIncrementalChangeStalenessHtml.js",
  "benchmarks/contracts/benchmark-project-profiles.json",
  "benchmarks/contracts/warm-index-benchmark-cases.json",
  "benchmarks/contracts/incremental-change-staleness-scenarios.json",
  // v0.7.0 -- context-window-scaling plugin, artifact reader, report, plot owners, and bundled resources.
  "dist/src/experiments/plugins/contextWindowScaling/plugin.js",
  "dist/src/experiments/plugins/contextWindowScaling/cliBudgets.js",
  "dist/src/experiments/plugins/contextWindowScaling/executionArtifactReader.js",
  "dist/src/experiments/plugins/contextWindowScaling/metrics.js",
  // v0.7.1 -- synthetic repository planning, materialization, manifest, verification, case adapter, and the
  // context-window-scaling synthetic input bridge.
  "dist/src/experiments/plugins/contextWindowScaling/syntheticInputs.js",
  "dist/src/evaluation/syntheticRepository/index.js",
  "dist/src/evaluation/syntheticRepository/planning.js",
  "dist/src/evaluation/syntheticRepository/materialize.js",
  "dist/src/evaluation/syntheticRepository/manifest.js",
  "dist/src/evaluation/syntheticRepository/manifestVerification.js",
  "dist/src/evaluation/syntheticRepository/evaluationCase.js",
  "dist/src/report/experiments/buildContextWindowScalingReport.js",
  // v0.7.2 -- local-repository subject, safe execution lifecycle, privacy projection, and target immutability owners.
  "dist/src/evaluation/localRepositorySubject/index.js",
  "dist/src/evaluation/localRepositorySubject/config.js",
  "dist/src/evaluation/localRepositorySubject/gitRepository.js",
  "dist/src/evaluation/localRepositorySubject/inventory.js",
  "dist/src/evaluation/localRepositorySubject/loadLocalRepositorySubject.js",
  "dist/src/evaluation/localRepositorySubject/manifest.js",
  "dist/src/evaluation/localRepositorySubject/evaluationCase.js",
  "dist/src/evaluation/localRepositorySubject/expectedFiles.js",
  "dist/src/evaluation/targetImmutability/index.js",
  "dist/src/evaluation/targetImmutability/captureTargetSnapshot.js",
  "dist/src/evaluation/targetImmutability/compareTargetSnapshots.js",
  "dist/src/experiments/plugins/contextWindowScaling/localSubjectExecution.js",
  "dist/src/experiments/plugins/contextWindowScaling/localSubjectScratch.js",
  "dist/src/experiments/plugins/contextWindowScaling/localSubjectExclusions.js",
  "dist/src/experiments/plugins/contextWindowScaling/localSubjectErrors.js",
  "dist/src/experiments/plugins/contextWindowScaling/localSubjectPrivacy.js",
  "dist/src/experiments/plugins/contextWindowScaling/executionArtifact.js",
  "dist/src/report/experiments/writePluginExperimentReports.js",
  // v0.8.0 -- retrieval-quality evidence/metric/fact-mapping/corpus-completeness owners, the retrieval-precision-recall
  // plugin (bundled and external-local execution, privacy projection), and its specialized report owners.
  "dist/src/evaluation/retrievalQuality/index.js",
  "dist/src/evaluation/retrievalQuality/types.js",
  "dist/src/evaluation/retrievalQuality/buildRetrievalEvidence.js",
  "dist/src/evaluation/retrievalQuality/metrics.js",
  "dist/src/evaluation/retrievalQuality/factContextTargets.js",
  "dist/src/evaluation/retrievalQuality/corpusCompleteness.js",
  "dist/src/evaluation/runMyDevKitRetrieval.js",
  "dist/src/experiments/plugins/retrievalPrecisionRecall/index.js",
  "dist/src/experiments/plugins/retrievalPrecisionRecall/config.js",
  "dist/src/experiments/plugins/retrievalPrecisionRecall/metadata.js",
  "dist/src/experiments/plugins/retrievalPrecisionRecall/execution.js",
  "dist/src/experiments/plugins/retrievalPrecisionRecall/executionArtifact.js",
  "dist/src/experiments/plugins/retrievalPrecisionRecall/metrics.js",
  "dist/src/experiments/plugins/retrievalPrecisionRecall/plugin.js",
  "dist/src/experiments/plugins/retrievalPrecisionRecall/types.js",
  "dist/src/experiments/plugins/retrievalPrecisionRecall/localSubjectExecution.js",
  "dist/src/experiments/plugins/retrievalPrecisionRecall/localSubjectPrivacy.js",
  "dist/src/experiments/plugins/warmIndexReuse/selection.js",
  "dist/src/report/experiments/buildRetrievalPrecisionRecallReport.js",
  "dist/src/report/experiments/retrievalPrecisionRecallReportModel.js",
  "dist/src/evaluation/retrievalQueryStrategies.js",
  "dist/src/evaluation/retrievalQueryStrategyEvidence.js",
  "dist/src/evaluation/runSemanticRetrievalStrategy.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/index.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/metadata.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/config.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/types.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/execution.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/executionArtifact.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/analysisTypes.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/analysis.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/analysisArtifact.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/metrics.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/localSubjectExecution.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/localSubjectPrivacy.js",
  "dist/src/experiments/plugins/retrievalQueryStrategyComparison/plugin.js",
  "dist/src/report/experiments/retrievalQueryStrategyComparisonReportModel.js",
  "dist/src/report/experiments/buildRetrievalQueryStrategyComparisonReport.js",
  "dist/src/report/experiments/renderRetrievalQueryStrategyComparisonHtml.js",
  "dist/src/report/experiments/renderRetrievalQueryStrategyComparisonText.js",
  "dist/src/report/experiments/renderRetrievalPrecisionRecallHtml.js",
  "dist/src/report/experiments/renderRetrievalPrecisionRecallText.js",
  "dist/src/experiments/plugins/contextPackGeneration/analysis.js",
  "dist/src/experiments/plugins/contextPackGeneration/analysisArtifact.js",
  "dist/src/experiments/plugins/contextPackGeneration/analysisTypes.js",
  "dist/src/experiments/plugins/contextPackGeneration/buildContextPack.js",
  "dist/src/experiments/plugins/contextPackGeneration/config.js",
  "dist/src/experiments/plugins/contextPackGeneration/execution.js",
  "dist/src/experiments/plugins/contextPackGeneration/executionArtifact.js",
  "dist/src/experiments/plugins/contextPackGeneration/executionTypes.js",
  "dist/src/experiments/plugins/contextPackGeneration/identityEvidence.js",
  "dist/src/experiments/plugins/contextPackGeneration/index.js",
  "dist/src/experiments/plugins/contextPackGeneration/localSubjectExecution.js",
  "dist/src/experiments/plugins/contextPackGeneration/localSubjectPrivacy.js",
  "dist/src/experiments/plugins/contextPackGeneration/metadata.js",
  "dist/src/experiments/plugins/contextPackGeneration/metrics.js",
  "dist/src/experiments/plugins/contextPackGeneration/packArtifact.js",
  "dist/src/experiments/plugins/contextPackGeneration/packEvidence.js",
  "dist/src/experiments/plugins/contextPackGeneration/packSelectionPolicy.js",
  "dist/src/experiments/plugins/contextPackGeneration/plugin.js",
  "dist/src/experiments/plugins/contextPackGeneration/renderContextPack.js",
  "dist/src/experiments/plugins/contextPackGeneration/types.js",
  "dist/src/report/experiments/contextPackGenerationReportModel.js",
  "dist/src/report/experiments/buildContextPackGenerationReport.js",
  "dist/src/report/experiments/loadContextPackArtifacts.js",
  "dist/src/report/experiments/renderContextPackGenerationHtml.js",
  "dist/src/report/experiments/renderContextPackGenerationText.js",
  "dist/src/report/experiments/renderPluginExperimentReportHtml.js",
  "dist/src/plots/buildContextWindowScalingPlotData.js",
  "benchmarks/contracts/context-window-scaling-cases.json",
  "benchmarks/projects/context-window-scaling-fixed-ts/src/tasks/shippingQuote.ts",
  "benchmarks/projects/todo-ts/src/taskService.ts",
  "benchmarks/projects/task-analytics-large-mixed/py/task_analytics/quality.py",
  "benchmarks/projects/task-analytics-large-mixed/py/task_analytics/metrics.py",
  "benchmarks/projects/task-analytics-large-mixed/ts/src/services/buildAnalyticsSnapshot.ts",
  "benchmarks/projects/task-analytics-large-mixed/py/tests/test_quality.py",
  "benchmarks/projects/task-workflow-medium-ts/src/services/completeTask.ts",
  "examples/token-savings-cases.json",
  "examples/tutorial-browser/index.html",
  "examples/tutorial-browser/prepare.mjs",
  "examples/tutorial-browser/server.mjs",
  "examples/tutorial-browser/scenario.json",
  // v0.9.0 -- agent-success-rate compiled owners, task and profile catalogs and both canonical benchmark projects.
  ...AGENT_SUCCESS_REQUIRED_TARBALL_PATHS
];

const REQUIRED_EXPERIMENT_IDS = ["context-strategy-comparison", "warm-index-reuse", "incremental-change-staleness", "context-window-scaling", "retrieval-precision-recall", "retrieval-query-strategy-comparison", "context-pack-generation", "agent-success-rate"];
const INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS_LOCAL = ["U1", "L2", "E1", "P1", "I1", "T1"];

const WARM_INDEX_CHARTS = [
  "warm-index-amortized-index-cost.svg",
  "warm-index-context-size.svg",
  "warm-index-correctness.svg",
  "warm-index-cumulative-token-usage.svg"
];

// v0.5.1 dedicated warm-index benchmark corpus: this gate checks resource presence, readability,
// and basic shape only; full corpus policy is owned by scripts/verify-benchmarks.ts.
const WARM_INDEX_BENCHMARK_CORPUS = "benchmarks/contracts/warm-index-benchmark-cases.json";
const WARM_INDEX_BENCHMARK_CORPUS_PROJECT_COUNTS = { "task-workflow-medium-ts": 6, "task-analytics-large-mixed": 6 };
const WARM_INDEX_BENCHMARK_CORPUS_LOCALITIES = ["localized", "cross-module", "broad-change"];
const WARM_INDEX_BENCHMARK_CORPUS_SELECTED_CASE = "warm-medium-complete-idempotent";

// v0.6.1 installed-package affected-neighborhood acceptance (real upstream my-dev-kit, no fake kit).
const AFFECTED_FIRST_CASE = "warm-medium-import-dedupe";
const AFFECTED_CHANGED_CASE = WARM_INDEX_BENCHMARK_CORPUS_SELECTED_CASE;
const AFFECTED_BENCHMARK_PROJECT = "task-workflow-medium-ts";
const AFFECTED_MUTATED_FILE = "src/store/taskStore.ts";
const AFFECTED_MUTATION_TEXT = "\n// my-dev-kit-lab v0.6.1 packed acceptance controlled mutation\n";
const AFFECTED_LEAKED_PATHS = /^(tests|reports|lab-output|\.my-dev-kit-context|\.claude)\/|(^|\/)node_modules\/|\.tgz$|verifyPackedPackage|affectedNeighborhoodTestHelpers|fixtures\/affected-neighborhood/;

// v0.5.2 -- frozen real-agent stdin transport flags (Batch 2). Kept here, independent of the
// installed package's own compiled copy, so an installed-execution regression in either adapter's
// argv is caught by this gate rather than assumed unchanged.
const CODEX_STDIN_ARGS = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "-"];
const CLAUDE_STDIN_ARGS = ["--restricted", "-p", "--output-format", "json", "--no-session-persistence", "--tools", "", "--disallowedTools", "mcp__*"];

// Frozen codex-timeout-isolation preset case set (v0.5.2 Batch 1); exact order matters.
const WARM_INDEX_TIMEOUT_ISOLATION_CASES = ["warm-large-health-label", "warm-large-ts-leaderboard", "warm-large-broad-analytics-comparison"];

// Acceptance-test fixture only (written to a temporary directory, never packaged): the minimal
// my-dev-kit subcommands the warm-index run needs, writing only under the --out index path.
const FAKE_KIT_SOURCE_TEXT = "export class PackedGateFakeSource {}";
const FAKE_KIT_VERSION = "packed-gate-fake-kit 9.9.9";
const FAKE_MY_DEV_KIT_SOURCE = `import fs from "node:fs";
import path from "node:path";
const [command, ...rest] = process.argv.slice(2);
const arg = (flag) => { const index = rest.indexOf(flag); return index >= 0 ? rest[index + 1] : undefined; };
if (command === "index") {
  const root = arg("--root");
  const out = arg("--out");
  const roots = rest.flatMap((value, index) => (value === "--src" ? [rest[index + 1]] : []));
  const files = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = rel + "/" + entry.name;
      if (entry.isDirectory()) walk(child);
      else if (/\\.(ts|js|py)$/.test(entry.name)) files.push(child);
    }
  };
  roots.forEach(walk);
  files.sort();
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "symbol-index.json"), JSON.stringify({ schemaVersion: "2", fileCount: files.length, files: files.map((p) => ({ path: p, language: "typescript" })) }));
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ artifactKind: "my-dev-kit-v1-manifest", version: "1.0.0", projectRoot: root.replace(/\\\\/g, "/"), sourceRoots: roots, artifacts: { symbolIndex: "symbol-index.json" }, summary: { fileCount: files.length } }));
  console.log(JSON.stringify({ ok: true, command }));
} else if (command === "--version") {
  console.log("${FAKE_KIT_VERSION}");
} else if (command === "search") {
  console.log(JSON.stringify({ results: [{ nodeId: "todo-ts:createTask", file: "src/taskService.ts", symbol: "createTask" }] }));
} else if (command === "lookup" || command === "slice") {
  console.log(JSON.stringify({ nodeId: arg("--node"), command }));
} else if (command === "source") {
  process.stdout.write("1 ${FAKE_KIT_SOURCE_TEXT}\\n");
} else {
  process.stderr.write("Unsupported fake my-dev-kit command: " + command);
  process.exit(1);
}
`;

// ---------------------------------------------------------------------------
// v0.5.2 Batch 6 -- deterministic local fake Codex/Claude provider fixtures.
//
// Acceptance-test infrastructure only: written beneath tempRoot/fake-agents,
// never packaged, never a real provider. Behavior is selected purely by the
// MY_DEV_KIT_LAB_FAKE_AGENT_MODE environment variable so one fixture script
// per provider covers every deterministic status scenario this gate proves
// (see classifyAgentRunOutcome.ts for the exact status-mapping rules these
// fixtures are designed against). Never exposes hidden benchmark answer-key
// material and never logs full stdin (only a parsed case id / context mode).
// ---------------------------------------------------------------------------

const FAKE_AGENT_MODE_ENV = "MY_DEV_KIT_LAB_FAKE_AGENT_MODE";
const FAKE_AGENT_FAIL_MATCH_ENV = "MY_DEV_KIT_LAB_FAKE_AGENT_FAIL_MATCH";
const FAKE_AGENT_LOG_ENV = "MY_DEV_KIT_LAB_FAKE_AGENT_LOG";

// Shared control-flow prelude: version short-circuit, mode/log env lookup, and the exact
// failure/limit/timeout branches classifyAgentRunOutcome.ts keys off. `emitSuccess` is the only
// provider-specific piece -- it must always print a completed-style response (including for
// "missing-tokens", which omits only the usage object, never the answer envelope itself).
function fakeAgentFixtureBody(providerId, emitSuccessSource) {
  return `import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("${providerId} 1.0.0-fake");
  process.exit(0);
}

const mode = process.env[${JSON.stringify(FAKE_AGENT_MODE_ENV)}] || "success";
const failMatch = process.env[${JSON.stringify(FAKE_AGENT_FAIL_MATCH_ENV)}] || "";
const logPath = process.env[${JSON.stringify(FAKE_AGENT_LOG_ENV)}];

function emitSuccess(mode) {
${emitSuccessSource}
}

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  const caseMatch = stdin.match(/Case ID:\\s*(\\S+)/);
  const contextMatch = stdin.match(/Context mode:\\s*(\\S+)/);
  if (logPath) {
    try {
      appendFileSync(
        logPath,
        JSON.stringify({
          provider: ${JSON.stringify(providerId)},
          argv: args,
          caseId: caseMatch ? caseMatch[1] : null,
          contextMode: contextMatch ? contextMatch[1] : null
        }) + "\\n"
      );
    } catch {}
  }

  // Never respond, and never let the event loop drain naturally: without a pending handle Node
  // would exit on its own the moment stdin ends, which would (wrongly) look like an empty/invalid
  // fast completion rather than a hang. The harness's own command-timeout/kill logic is what must
  // terminate this process, proving real timeout handling rather than a fixture-simulated one.
  if (mode === "timeout") {
    setInterval(() => {}, 60 * 60 * 1000);
    return;
  }

  const appliesToThisCase = !failMatch || stdin.includes(failMatch);

  if (mode === "failure" && appliesToThisCase) {
    process.stderr.write("forced provider failure");
    process.exitCode = 1;
    return;
  }
  if (mode === "limit-reached" && appliesToThisCase) {
    process.stderr.write("rate limit exceeded for this account");
    process.exitCode = 1;
    return;
  }

  emitSuccess(mode);
  process.exitCode = 0;
});
`;
}

const CODEX_FIXTURE_SOURCE = fakeAgentFixtureBody(
  "codex",
  [
    '  console.log(JSON.stringify({ type: "thread.started" }));',
    '  if (mode === "invalid-output") {',
    '    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "I am unable to determine a structured answer." } }));',
    "    return;",
    "  }",
    '  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "answer: ok\\nrelevantFiles: src/example.ts\\nrelevantSymbols: exampleSymbol\\nexpectedFactsFound: \\nconfidence: high" } }));',
    '  if (mode !== "missing-tokens") {',
    '    console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 } }));',
    "  }"
  ].join("\n")
);

const CLAUDE_FIXTURE_SOURCE = fakeAgentFixtureBody(
  "claude",
  [
    '  if (mode === "invalid-output") {',
    '    console.log(JSON.stringify({ result: "I am unable to determine a structured answer.", session_id: "fixture" }));',
    "    return;",
    "  }",
    '  const answerText = "answer: ok\\nrelevantFiles: src/example.ts\\nrelevantSymbols: exampleSymbol\\nconfidence: high";',
    '  const envelope = { result: answerText, session_id: "fixture" };',
    '  if (mode !== "missing-tokens") {',
    "    envelope.usage = { input_tokens: 6, output_tokens: 4 };",
    "  }",
    "  console.log(JSON.stringify(envelope));"
  ].join("\n")
);

function writeFakeAgentLauncher(binDir, providerId, fixturePath) {
  if (process.platform === "win32") {
    const cmdPath = path.join(binDir, `${providerId}.cmd`);
    writeFileSync(cmdPath, `@echo off\r\n"${process.execPath}" "${fixturePath}" %*\r\n`, "utf8");
    return;
  }
  const shimPath = path.join(binDir, providerId);
  // Extension-less launcher: a plain `import(...)` expression (no top-level await) keeps this
  // valid regardless of whether Node's module-type auto-detection classifies it as CJS or ESM.
  writeFileSync(shimPath, `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(fixturePath).href)});\n`, "utf8");
  chmodSync(shimPath, 0o755);
}

async function writeFakeAgentBinaries(fakeAgentsDir, binDir) {
  await mkdir(binDir, { recursive: true });
  const codexFixturePath = path.join(fakeAgentsDir, "codex-fixture.mjs");
  const claudeFixturePath = path.join(fakeAgentsDir, "claude-fixture.mjs");
  writeFileSync(codexFixturePath, CODEX_FIXTURE_SOURCE, "utf8");
  writeFileSync(claudeFixturePath, CLAUDE_FIXTURE_SOURCE, "utf8");
  writeFakeAgentLauncher(binDir, "codex", codexFixturePath);
  writeFakeAgentLauncher(binDir, "claude", claudeFixturePath);
}

// The installed my-dev-kit-lab binary is resolved (to an absolute command/shim) BEFORE PATH
// narrowing, so narrowing PATH afterward cannot break the already-resolved CLI invocation itself;
// it only controls what the CLI's OWN child-process spawns (fake kit, fake provider) can discover.
function isolatedProviderEnv(baseEnv, extraBinDirs) {
  const nodeBinDir = path.dirname(process.execPath);
  const pathValue = [...extraBinDirs, nodeBinDir].join(path.delimiter);
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path") delete env[key];
  }
  env[process.platform === "win32" ? "Path" : "PATH"] = pathValue;
  env.PATH = pathValue;
  return env;
}

const PUBLIC_ROUTE_HELP_SMOKES = [
  ["audit", "--help"],
  ["security", "--help"],
  ["security", "validate", "--help"],
  ["experiment", "--help"],
  ["experiment", "controlled", "--help"],
  ["report", "render", "--help"],
  ["plots", "generate", "--help"],
  ["gallery", "build", "--help"],
  ["demo", "final", "--help"]
];

// ---------------------------------------------------------------------------
// Pure/deterministic helpers live in scripts/verifyPackedPackageHelpers.ts
// (compiled to dist/scripts/verifyPackedPackageHelpers.js) so they are real,
// independently-typed, and independently testable, matching this
// repository's existing scripts/verify-benchmarks.ts convention. Loaded
// dynamically from dist/ here since this script only ever runs after a
// build (see the dist/scripts/cli.js check in main()).
// ---------------------------------------------------------------------------

async function loadPrivacyScan() {
  const modulePath = path.join(REPO_ROOT, "dist", "scripts", "externalLocalPrivacyScan.js");
  if (!existsSync(modulePath)) {
    fail("BUILD_REQUIRED", `Compiled module not found: ${path.relative(REPO_ROOT, modulePath)}. Run "npm run build" before "npm run verify:packed-package".`);
  }
  return import(pathToFileURL(modulePath).href);
}

async function loadHelpers() {
  const modulePath = path.join(REPO_ROOT, "dist", "scripts", "verifyPackedPackageHelpers.js");
  if (!existsSync(modulePath)) {
    fail(
      "BUILD_REQUIRED",
      `Compiled module not found: ${path.relative(REPO_ROOT, modulePath)}. Run "npm run build" before "npm run verify:packed-package".`
    );
  }
  return import(pathToFileURL(modulePath).href);
}

// ---------------------------------------------------------------------------
// Gate failure helper
// ---------------------------------------------------------------------------

class PackedPackageGateError extends Error {
  constructor(gate, message, details) {
    super(`[${gate}] ${message}`);
    this.gate = gate;
    this.details = details;
  }
}

// Physical-root containment for the external retrieval-precision-recall scratch check. The product resolves the work
// root with realpath.native before creating private scratch, so on Windows the logged index path can use a different
// (for example 8.3 short) spelling of the same directory than the lexical output path. Compare against the physical root.
// Returns the segments of `candidate` beneath `root`, [] for the root itself, or null when it is outside the root.
function segmentsBeneathRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === "") return [];
  if (path.isAbsolute(relative)) return null;
  const segments = relative.split(path.sep);
  return segments[0] === ".." ? null : segments;
}

function fail(gate, message, details) {
  throw new PackedPackageGateError(gate, message, details);
}

// ---------------------------------------------------------------------------
// Cross-platform command execution
// ---------------------------------------------------------------------------

async function loadResolveCommand() {
  const modulePath = path.join(REPO_ROOT, "dist", "src", "core", "resolveCommand.js");
  if (!existsSync(modulePath)) {
    fail(
      "BUILD_REQUIRED",
      `Compiled module not found: ${path.relative(REPO_ROOT, modulePath)}. Run "npm run build" before "npm run verify:packed-package".`
    );
  }
  const module = await import(pathToFileURL(modulePath).href);
  return module.resolveCommand;
}

function runNpm(resolveCommand, args, options) {
  const resolved = resolveCommand("npm", { cwd: options.cwd });
  if (resolved.resolutionKind === "unavailable") {
    fail(options.gate ?? "NPM_UNAVAILABLE", "npm was not found on PATH.");
  }
  const needsResolvedPathArg =
    resolved.resolutionKind === "windows-cmd-shim" || resolved.resolutionKind === "windows-powershell-shim";
  const fullArgs = [
    ...resolved.argsPrefix,
    ...(needsResolvedPathArg && resolved.resolvedPath ? [resolved.resolvedPath] : []),
    ...args
  ];
  return spawnSync(resolved.command, fullArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 1024 * 1024 * 64
  });
}

function resolveConsumerBinCommand(resolveCommand, consumerDir) {
  const binDir = path.join(consumerDir, "node_modules", ".bin");
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const existingPath = process.env[pathKey] ?? process.env.PATH ?? "";
  const envWithBin = { ...process.env, [pathKey]: `${binDir}${path.delimiter}${existingPath}` };
  const resolved = resolveCommand(EXPECTED_BIN_NAME, { cwd: consumerDir, env: envWithBin });
  if (resolved.resolutionKind === "unavailable") {
    fail(
      "CONSUMER_INSTALL",
      `Installed local binary "${EXPECTED_BIN_NAME}" was not found under ${binDir} after npm install.`
    );
  }
  return { resolved, envWithBin };
}

function runInstalledCli(resolved, consumerDir, args, extraEnv) {
  const needsResolvedPathArg =
    resolved.resolutionKind === "windows-cmd-shim" || resolved.resolutionKind === "windows-powershell-shim";
  const fullArgs = [
    ...resolved.argsPrefix,
    ...(needsResolvedPathArg && resolved.resolvedPath ? [resolved.resolvedPath] : []),
    ...args
  ];
  return spawnSync(resolved.command, fullArgs, {
    cwd: consumerDir,
    encoding: "utf8",
    env: extraEnv,
    maxBuffer: 1024 * 1024 * 64
  });
}

function describeChildResult(result) {
  return [
    `exit=${result.status}`,
    `signal=${result.signal ?? "none"}`,
    `spawnError=${result.error ? (result.error.stack ?? result.error.message ?? String(result.error)) : "none"}`,
    `stdout:\n${result.stdout ?? ""}`,
    `stderr:\n${result.stderr ?? ""}`
  ].join("\n");
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve) => server.close(resolve));
  if (!port) fail("TUTORIAL_CONTRACT", "Could not reserve a loopback port for packed tutorial acceptance.");
  return port;
}

function parseJsonOutput(result, gate) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(gate, `Expected JSON output but received invalid JSON: ${error.message}`, describeChildResult(result));
  }
}

function requireNonEmptyFile(filePath, gate) {
  if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size === 0) {
    fail(gate, `Expected a non-empty regular file at ${filePath}.`);
  }
  return statSync(filePath).size;
}

function assertWebm(filePath, gate) {
  const bytes = readFileSync(filePath);
  if (bytes.length < 4 || !Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).equals(bytes.subarray(0, 4))) {
    fail(gate, `Expected an EBML/WebM file at ${filePath}.`);
  }
}

// ---------------------------------------------------------------------------
// Main gate sequence
// ---------------------------------------------------------------------------

async function main() {
  const gateStartedAt = Date.now();
  const compiledBinPath = path.join(REPO_ROOT, "dist", "scripts", "cli.js");
  if (!existsSync(compiledBinPath)) {
    fail(
      "BUILD_REQUIRED",
      `Compiled bin not found: dist/scripts/cli.js. Run "npm run build" before "npm run verify:packed-package".`
    );
  }

  const resolveCommand = await loadResolveCommand();
  const {
    findExactlyOneTarball,
    validateInstalledPackageIdentity,
    validatePlaywrightRuntimeDependency,
    missingRequiredTarballPaths,
    validateManifestRelativePaths,
    validateWarmIndexCampaignGalleryManifest,
    validateWarmIndexCampaignScreenshotEvidence,
    snapshotDirectory,
    diffSnapshots,
    UPSTREAM_MY_DEV_KIT_PACKAGE,
    UPSTREAM_MY_DEV_KIT_SPEC,
    UPSTREAM_MY_DEV_KIT_VERSION,
    validateUpstreamMyDevKitIdentity,
    resolveUpstreamBinRelativePath,
    buildControlledMutationKitWrapperSource,
    validateAffectedNeighborhoodLayers,
    evaluateIncrementalChangeStalenessV2Acceptance,
    validateIncrementalChangeStalenessReportConsistencyV2,
    INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS_EXPECTED
  } =
    await loadHelpers();

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "my-dev-kit-lab-packed-"));
  const dirs = {
    pack: path.join(tempRoot, "pack"),
    consumer: path.join(tempRoot, "consumer"),
    home: path.join(tempRoot, "home"),
    workspace: path.join(tempRoot, "workspace"),
    target: path.join(tempRoot, "target"),
    tutorialContracts: path.join(tempRoot, "tutorial-contracts"),
    tutorialRuns: path.join(tempRoot, "tutorial-runs"),
    browserCache: path.join(tempRoot, "empty-browser-cache"),
    fakeKit: path.join(tempRoot, "fake-my-dev-kit"),
    fakeAgents: path.join(tempRoot, "fake-agents"),
    fakeAgentsBin: path.join(tempRoot, "fake-agents", "bin"),
    campaigns: path.join(tempRoot, "campaigns"),
    // v0.6.1: real published upstream my-dev-kit, a disposable second install of the exact tarball
    // that is the only place the controlled mutation may happen, and their outputs.
    upstream: path.join(tempRoot, "upstream-my-dev-kit"),
    mutableConsumer: path.join(tempRoot, "mutable-consumer"),
    affectedRuns: path.join(tempRoot, "affected-neighborhood-runs")
  };

  try {
    for (const dir of Object.values(dirs)) {
      await mkdir(dir, { recursive: true });
    }

    // -----------------------------------------------------------------
    // 1. Pack the exact tarball.
    // -----------------------------------------------------------------
    const packResult = runNpm(resolveCommand, ["pack", "--json", "--pack-destination", dirs.pack], {
      cwd: REPO_ROOT,
      gate: "PACK"
    });
    if (packResult.status !== 0) {
      fail("PACK", "npm pack failed.", describeChildResult(packResult));
    }
    let packJson;
    try {
      packJson = JSON.parse(packResult.stdout);
    } catch (error) {
      fail("PACK", `npm pack --json produced unparseable output: ${error.message}`, packResult.stdout);
    }
    if (!Array.isArray(packJson) || packJson.length !== 1) {
      fail("PACK", `Expected exactly one npm pack result entry, got ${packJson?.length ?? 0}.`);
    }
    const packEntry = packJson[0];
    const tarballFilenameFromJson = packEntry.filename;
    const packDirEntries = readdirSync(dirs.pack);
    const tarballFilename = findExactlyOneTarball(packDirEntries);
    if (tarballFilenameFromJson && tarballFilenameFromJson !== tarballFilename) {
      fail(
        "PACK",
        `npm pack --json filename ("${tarballFilenameFromJson}") does not match the single tarball found on disk ("${tarballFilename}").`
      );
    }
    const tarballPath = path.resolve(dirs.pack, tarballFilename);
    if (!existsSync(tarballPath)) {
      fail("PACK", `Resolved tarball path does not exist: ${tarballPath}`);
    }
    const tarballBytes = await readFile(tarballPath);
    const tarballSha256 = createHash("sha256").update(tarballBytes).digest("hex");

    // -----------------------------------------------------------------
    // 2. Verify critical tarball contents (same artifact, not re-packed).
    // -----------------------------------------------------------------
    const tarballFiles = new Set((packEntry.files ?? []).map((entry) => entry.path.replace(/\\/g, "/")));
    const missingRequired = missingRequiredTarballPaths(tarballFiles, REQUIRED_TARBALL_PATHS);
    if (missingRequired.length > 0) {
      fail("PACK_CONTENTS", `Required runtime file(s) missing from the packed tarball: ${missingRequired.join(", ")}`);
    }
    if (!tarballFiles.has(WARM_INDEX_BENCHMARK_CORPUS)) {
      fail("WARM_INDEX_BENCHMARK_CORPUS_RESOURCE", `The packed tarball does not contain ${WARM_INDEX_BENCHMARK_CORPUS}.`);
    }

    // -----------------------------------------------------------------
    // 3. Create a clean consumer project and install the exact tarball.
    // -----------------------------------------------------------------
    writeFileSync(
      path.join(dirs.consumer, "package.json"),
      `${JSON.stringify({ name: "my-dev-kit-lab-packed-consumer", version: "0.0.0", private: true }, null, 2)}\n`,
      "utf8"
    );
    const installResult = runNpm(resolveCommand, ["install", "--no-audit", "--no-fund", tarballPath], {
      cwd: dirs.consumer,
      gate: "CONSUMER_INSTALL"
    });
    if (installResult.status !== 0) {
      fail("CONSUMER_INSTALL", "npm install of the exact tarball failed in the clean consumer project.", describeChildResult(installResult));
    }

    // -----------------------------------------------------------------
    // 4. Verify installed package identity.
    // -----------------------------------------------------------------
    const installedPackageRoot = path.join(dirs.consumer, "node_modules", EXPECTED_PACKAGE_NAME);
    const installedPackageJsonPath = path.join(installedPackageRoot, "package.json");
    if (!existsSync(installedPackageJsonPath)) {
      fail("CONSUMER_INSTALL", `Installed package.json not found: ${installedPackageJsonPath}`);
    }
    const installedPackageJson = JSON.parse(await readFile(installedPackageJsonPath, "utf8"));
    const identityProblems = validateInstalledPackageIdentity(installedPackageJson, {
      name: EXPECTED_PACKAGE_NAME,
      version: EXPECTED_PACKAGE_VERSION,
      enginesNode: EXPECTED_ENGINES_NODE,
      binName: EXPECTED_BIN_NAME,
      binTarget: EXPECTED_BIN_TARGET
    });
    if (identityProblems.length > 0) {
      fail("CONSUMER_INSTALL", `Installed package identity mismatch: ${identityProblems.join("; ")}`);
    }
    const playwrightProblems = validatePlaywrightRuntimeDependency(installedPackageJson, EXPECTED_PLAYWRIGHT_VERSION);
    if (playwrightProblems.length > 0) {
      fail("CONSUMER_INSTALL", `Installed Playwright dependency contract failed: ${playwrightProblems.join("; ")}`);
    }
    const installedPlaywrightPath = path.join(dirs.consumer, "node_modules", "playwright", "package.json");
    if (!existsSync(installedPlaywrightPath)) {
      fail("CONSUMER_INSTALL", "The clean consumer cannot resolve its installed Playwright runtime dependency.");
    }
    const installedPlaywrightJson = JSON.parse(await readFile(installedPlaywrightPath, "utf8"));
    if (installedPlaywrightJson.version !== EXPECTED_PLAYWRIGHT_VERSION) {
      fail("CONSUMER_INSTALL", `Installed Playwright version is ${installedPlaywrightJson.version}, expected ${EXPECTED_PLAYWRIGHT_VERSION}.`);
    }
    const installedBinPath = path.join(installedPackageRoot, EXPECTED_BIN_TARGET);
    if (!existsSync(installedBinPath)) {
      fail("CONSUMER_INSTALL", `Installed bin target does not exist: ${installedBinPath}`);
    }

    const { resolved: cliCommand, envWithBin } = resolveConsumerBinCommand(resolveCommand, dirs.consumer);

    // -----------------------------------------------------------------
    // 5. Basic installed CLI acceptance.
    // -----------------------------------------------------------------
    const helpResult = runInstalledCli(cliCommand, dirs.consumer, ["--help"], envWithBin);
    if (helpResult.status !== 0) {
      fail("HELP", "Installed `--help` did not exit 0.", describeChildResult(helpResult));
    }

    const versionResult = runInstalledCli(cliCommand, dirs.consumer, ["--version"], envWithBin);
    if (versionResult.status !== 0) {
      fail("VERSION", "Installed `--version` did not exit 0.", describeChildResult(versionResult));
    }
    const installedVersionOutput = versionResult.stdout.trim();
    if (installedVersionOutput !== EXPECTED_PACKAGE_VERSION) {
      fail(
        "VERSION",
        `Installed --version output ("${installedVersionOutput}") does not match installed package.json version ("${EXPECTED_PACKAGE_VERSION}").`
      );
    }

    const experimentListResult = runInstalledCli(cliCommand, dirs.consumer, ["experiment", "list", "--json"], envWithBin);
    if (experimentListResult.status !== 0) {
      fail("EXPERIMENT_LIST", "Installed `experiment list` did not exit 0.", describeChildResult(experimentListResult));
    }
    let experimentListParsed;
    try {
      experimentListParsed = JSON.parse(experimentListResult.stdout);
    } catch (error) {
      fail("EXPERIMENT_LIST", `Installed \`experiment list --json\` produced unparseable output: ${error.message}`);
    }
    const knownExperiments = experimentListParsed.experiments ?? [];
    if (knownExperiments.length === 0) {
      fail("EXPERIMENT_LIST", "Installed `experiment list` returned an empty registry.");
    }
    const knownExperimentId = knownExperiments[0].id;
    const knownExperimentIds = knownExperiments.map((experiment) => experiment.id);
    for (const requiredId of REQUIRED_EXPERIMENT_IDS) {
      if (!knownExperimentIds.includes(requiredId)) {
        fail("EXPERIMENT_LIST", `Installed registry is missing ${requiredId}; found: ${knownExperimentIds.join(", ")}`);
      }
    }

    const experimentDescribeResult = runInstalledCli(
      cliCommand,
      dirs.consumer,
      ["experiment", "describe", "--experiment", knownExperimentId],
      envWithBin
    );
    if (experimentDescribeResult.status !== 0) {
      fail(
        "EXPERIMENT_DESCRIBE",
        `Installed \`experiment describe --experiment ${knownExperimentId}\` did not exit 0.`,
        describeChildResult(experimentDescribeResult)
      );
    }

    const warmDescribeResult = runInstalledCli(
      cliCommand,
      dirs.consumer,
      ["experiment", "describe", "--experiment", "warm-index-reuse", "--json"],
      envWithBin
    );
    if (warmDescribeResult.status !== 0) {
      fail("EXPERIMENT_DESCRIBE_WARM", "Installed `experiment describe --experiment warm-index-reuse` did not exit 0.", describeChildResult(warmDescribeResult));
    }
    let warmDescription;
    try {
      warmDescription = JSON.parse(warmDescribeResult.stdout);
    } catch (error) {
      fail("EXPERIMENT_DESCRIBE_WARM", `Installed warm-index-reuse describe produced unparseable output: ${error.message}`);
    }
    const warmVariants = JSON.stringify(warmDescription.supportedVariants ?? []);
    const warmOptionalFieldNames = (warmDescription.optionalConfigFields ?? []).map((field) => field.name);
    // v0.5.2: the installed warm-index-reuse plugin now supports a single-provider-per-preset real-
    // agent campaign surface (kitCommand/campaignPreset/includeRealAgents/timeoutMs). It must still
    // never expose the agent-matrix fields owned by context-strategy-comparison.
    const REQUIRED_WARM_OPTIONAL_FIELDS = ["kitCommand", "campaignPreset", "includeRealAgents", "timeoutMs"];
    const FORBIDDEN_WARM_OPTIONAL_FIELDS = ["agents", "strategies", "complexities", "commandTemplate"];
    const REQUIRED_WARM_CAMPAIGN_PRESET_MENTIONS = ["codex-full", "claude-full", "codex-timeout-isolation"];
    if (
      warmDescription.metadata?.status !== "experimental" ||
      warmVariants !== JSON.stringify(["raw-full-file", "warm-index-reuse"]) ||
      !REQUIRED_WARM_OPTIONAL_FIELDS.every((name) => warmOptionalFieldNames.includes(name)) ||
      FORBIDDEN_WARM_OPTIONAL_FIELDS.some((name) => warmOptionalFieldNames.includes(name)) ||
      !REQUIRED_WARM_CAMPAIGN_PRESET_MENTIONS.every((preset) => warmDescribeResult.stdout.includes(preset))
    ) {
      fail(
        "EXPERIMENT_DESCRIBE_WARM",
        "Installed warm-index-reuse description does not expose the v0.5.2 single-provider-per-preset campaign surface.",
        warmDescribeResult.stdout
      );
    }

    const runHelpResult = runInstalledCli(cliCommand, dirs.consumer, ["experiment", "run", "--help"], envWithBin);
    const runHelp = runHelpResult.stdout ?? "";
    const kitCommandHelpStart = runHelp.indexOf("my-dev-kit command override (warm-index-reuse, incremental-change-staleness, context-window-scaling, retrieval-precision-recall, retrieval-query-strategy-comparison, and context-pack-generation):");
    const warmHelpStart = runHelp.indexOf("warm-index-reuse only:");
    const contextHelpStart = runHelp.indexOf("context-strategy-comparison only:");
    const warmCampaignHelp = warmHelpStart >= 0 && contextHelpStart > warmHelpStart
      ? runHelp.slice(warmHelpStart, contextHelpStart)
      : "";
    const normalizedWarmCampaignHelp = warmCampaignHelp.replace(/\s+/g, " ");
    const campaignScreenshotHelpContract = [
      "campaign report screenshot is best-effort presentation",
      "skipped or failed capture is reported explicitly",
      "failed remains failed",
      "no PNG is fabricated",
      "screenshot status alone does not fail an otherwise successful campaign command",
      "Core experiment, report,",
      "plot, and gallery failures remain fatal."
    ];
    if (
      runHelpResult.status !== 0 ||
      kitCommandHelpStart < 0 ||
      warmHelpStart < 0 ||
      contextHelpStart <= warmHelpStart ||
      warmHelpStart <= kitCommandHelpStart ||
      !runHelp.slice(kitCommandHelpStart, warmHelpStart).includes("--kit-command <command>") ||
      !runHelp.slice(kitCommandHelpStart, warmHelpStart).includes("warm-index-reuse") ||
      !runHelp.slice(kitCommandHelpStart, warmHelpStart).includes("incremental-change-staleness") ||
      !runHelp.slice(kitCommandHelpStart, warmHelpStart).includes("context-window-scaling") ||
      !runHelp.slice(kitCommandHelpStart, warmHelpStart).includes("--context-budgets <values>") ||
      campaignScreenshotHelpContract.some((phrase) => !normalizedWarmCampaignHelp.includes(phrase)) ||
      /screenshot failure makes the command unsuccessful/i.test(normalizedWarmCampaignHelp) ||
      !runHelp.slice(contextHelpStart).includes("--agents")
    ) {
      fail("EXPERIMENT_RUN_HELP", "Installed `experiment run --help` does not document both supported --kit-command plugins and the nonfatal automatic campaign screenshot contract.", describeChildResult(runHelpResult));
    }

    // -----------------------------------------------------------------
    // 6. Public route loading smokes.
    // -----------------------------------------------------------------
    for (const routeArgs of PUBLIC_ROUTE_HELP_SMOKES) {
      const result = runInstalledCli(cliCommand, dirs.consumer, routeArgs, envWithBin);
      if (result.status !== 0) {
        fail("PUBLIC_ROUTE_HELP_SMOKE", `Installed \`${routeArgs.join(" ")}\` did not exit 0.`, describeChildResult(result));
      }
    }

    // -----------------------------------------------------------------
    // 7. Installed tutorial contracts and browser/runtime acceptance.
    // -----------------------------------------------------------------
    const installedExampleRoot = path.join(installedPackageRoot, "examples", "tutorial-browser");
    const scenarioPath = path.join(installedExampleRoot, "scenario.json");
    const installedPackageBefore = await snapshotDirectory(installedPackageRoot);
    const exampleBefore = await snapshotDirectory(installedExampleRoot);
    const tutorialPort = await reserveLoopbackPort();
    const targetContractPath = path.join(dirs.tutorialContracts, "target-contract.json");
    writeFileSync(
      targetContractPath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        id: "lab-browser-fixture",
        prepare: { executable: process.execPath, args: [path.join(installedExampleRoot, "prepare.mjs"), "{{targetRoot}}"] },
        processes: [{
          id: "fixture-server",
          executable: process.execPath,
          args: ["{{targetRoot}}/app/server.mjs"],
          cwd: "target-root",
          env: { TUTORIAL_FIXTURE_PORT: String(tutorialPort) },
          readiness: { kind: "http", url: `http://127.0.0.1:${tutorialPort}/`, timeoutMs: 15000, intervalMs: 100 }
        }],
        applicationUrl: `http://127.0.0.1:${tutorialPort}/`
      }, null, 2)}\n`,
      "utf8"
    );
    const tutorialHelpRoutes = [
      ["tutorial", "--help"],
      ["tutorial", "validate", "--help"],
      ["tutorial", "run", "--help"]
    ];
    for (const routeArgs of tutorialHelpRoutes) {
      const result = runInstalledCli(cliCommand, dirs.consumer, routeArgs, envWithBin);
      if (result.status !== 0) fail("TUTORIAL_HELP", `Installed ${routeArgs.join(" ")} did not exit 0.`, describeChildResult(result));
    }
    const validateArgs = ["tutorial", "validate", "--scenario", scenarioPath, "--target-contract", targetContractPath, "--json"];
    const validation = runInstalledCli(cliCommand, dirs.consumer, validateArgs, envWithBin);
    if (validation.status !== 0) fail("TUTORIAL_VALIDATE", "Installed tutorial validation failed.", describeChildResult(validation));
    const validationJson = parseJsonOutput(validation, "TUTORIAL_VALIDATE");
    if (validationJson.status !== "valid" || validationJson.scenarioId !== "lab-browser-fixture" || validationJson.targetIdMatches !== true || validationJson.stepCount !== 10) {
      fail("TUTORIAL_VALIDATE", "Installed tutorial validation returned an unexpected result.", validation.stdout);
    }

    await mkdir(dirs.browserCache, { recursive: true });
    const unavailableRoot = path.join(dirs.tutorialRuns, "browser-unavailable");
    const unavailable = runInstalledCli(
      cliCommand,
      dirs.consumer,
      ["tutorial", "run", "--scenario", scenarioPath, "--target-contract", targetContractPath, "--out", unavailableRoot, "--json"],
      { ...envWithBin, PLAYWRIGHT_BROWSERS_PATH: dirs.browserCache }
    );
    if (unavailable.status === 0) fail("TUTORIAL_BROWSER_UNAVAILABLE", "Tutorial unexpectedly passed without a browser binary.", unavailable.stdout);
    const unavailableJson = parseJsonOutput(unavailable, "TUTORIAL_BROWSER_UNAVAILABLE");
    if (unavailableJson.status !== "browser-unavailable" || !String(unavailableJson.error ?? "").match(/playwright install|browser/i)) {
      fail("TUTORIAL_BROWSER_UNAVAILABLE", "Missing Chromium did not produce the supported browser-unavailable result.", unavailable.stdout);
    }
    if (readdirSync(dirs.browserCache).length !== 0) fail("TUTORIAL_BROWSER_UNAVAILABLE", "Tutorial execution downloaded a browser into the isolated cache.");

    const realRunRoot = path.join(dirs.tutorialRuns, "real");
    const realRun = runInstalledCli(
      cliCommand,
      dirs.consumer,
      ["tutorial", "run", "--scenario", scenarioPath, "--target-contract", targetContractPath, "--out", realRunRoot, "--json"],
      envWithBin
    );
    if (realRun.status !== 0) {
      fail("TUTORIAL_REAL_EXECUTION", "Packed tutorial acceptance requires a compatible local Chromium runtime; install it with `npx playwright install chromium` and rerun this gate.", describeChildResult(realRun));
    }
    const realJson = parseJsonOutput(realRun, "TUTORIAL_REAL_EXECUTION");
    if (realJson.status !== "passed" || realJson.scenarioId !== "lab-browser-fixture" || realJson.targetId !== "lab-browser-fixture" || realJson.warnings?.length || realJson.cleanupErrors?.length) {
      fail("TUTORIAL_REAL_EXECUTION", "Packed tutorial returned an unexpected successful-run result.", realRun.stdout);
    }
    if (!realJson.paths?.runRoot || path.resolve(realJson.paths.runRoot) !== path.resolve(realRunRoot)) fail("TUTORIAL_REAL_EXECUTION", "Explicit --out was not honored exactly.");
    if (realJson.steps?.length !== 10 || realJson.steps.some((step) => step.status !== "passed")) fail("TUTORIAL_REAL_EXECUTION", "The canonical tutorial did not return exactly ten passed steps.");
    const pointerClickStep = realJson.steps.find((step) => step.id === "pointer-click-surface");
    if (pointerClickStep?.action?.type !== "pointer-click" || pointerClickStep.action.status !== "passed" || pointerClickStep.assertions?.some((assertion) => assertion.status !== "passed")) {
      fail("TUTORIAL_POINTER_CLICK", "Packed pointer-click action or its DOM assertions did not pass.");
    }
    const pointerDragStep = realJson.steps.find((step) => step.id === "pointer-drag-surface");
    if (pointerDragStep?.action?.type !== "pointer-drag" || pointerDragStep.action.status !== "passed" || pointerDragStep.assertions?.some((assertion) => assertion.status !== "passed")) {
      fail("TUTORIAL_POINTER_DRAG", "Packed pointer-drag action or its DOM assertions did not pass.");
    }
    const selectOptionStep = realJson.steps.find((step) => step.id === "select-operation");
    if (selectOptionStep?.action?.type !== "select-option" || selectOptionStep.action.status !== "passed" || selectOptionStep.assertions?.some((assertion) => assertion.status !== "passed")) {
      fail("TUTORIAL_SELECT_OPTION", "Packed select-option action or its native-select DOM assertions did not pass.");
    }
    const artifactFiles = {
      video: path.join(realRunRoot, "artifacts", "tutorial.webm"),
      srt: path.join(realRunRoot, "artifacts", "tutorial.srt"),
      vtt: path.join(realRunRoot, "artifacts", "tutorial.vtt"),
      markdown: path.join(realRunRoot, "artifacts", "tutorial.md"),
      manifest: path.join(realRunRoot, "artifacts", "tutorial-manifest.json")
    };
    const videoSize = requireNonEmptyFile(artifactFiles.video, "TUTORIAL_ARTIFACTS");
    assertWebm(artifactFiles.video, "TUTORIAL_ARTIFACTS");
    for (const filePath of [artifactFiles.srt, artifactFiles.vtt, artifactFiles.markdown, artifactFiles.manifest]) requireNonEmptyFile(filePath, "TUTORIAL_ARTIFACTS");
    const screenshotNames = ["app-open.png", "activated.png", "submitted.png", "dropped.png", "pointer-clicked.png", "pointer-dragged.png", "operation-selected.png", "banner-visible.png"];
    const screenshotSizes = Object.fromEntries(screenshotNames.map((name) => [name, requireNonEmptyFile(path.join(realRunRoot, "screenshots", name), "TUTORIAL_ARTIFACTS")]));
    const manifest = JSON.parse(readFileSync(artifactFiles.manifest, "utf8"));
    if (manifest.schemaVersion !== "1.0.0" || manifest.run?.status !== "passed" || manifest.scenario?.id !== "lab-browser-fixture" || manifest.target?.id !== "lab-browser-fixture" || manifest.steps?.length !== 10 || manifest.warnings?.length || manifest.cleanupErrors?.length) fail("TUTORIAL_MANIFEST", "Packed tutorial manifest does not prove a clean ten-step run.");
    if (manifest.steps.find((step) => step.id === "pointer-click-surface")?.action?.type !== "pointer-click" || manifest.steps.find((step) => step.id === "pointer-click-surface")?.action?.status !== "passed") fail("TUTORIAL_MANIFEST", "Packed tutorial manifest lacks a passed pointer-click action.");
    if (manifest.steps.find((step) => step.id === "pointer-drag-surface")?.action?.type !== "pointer-drag" || manifest.steps.find((step) => step.id === "pointer-drag-surface")?.action?.status !== "passed") fail("TUTORIAL_MANIFEST", "Packed tutorial manifest lacks a passed pointer-drag action.");
    if (manifest.steps.find((step) => step.id === "select-operation")?.action?.type !== "select-option" || manifest.steps.find((step) => step.id === "select-operation")?.action?.status !== "passed") fail("TUTORIAL_MANIFEST", "Packed tutorial manifest lacks a passed select-option action.");
    if (validateManifestRelativePaths(manifest).length > 0) fail("TUTORIAL_MANIFEST", "Packed tutorial manifest contains an invalid artifact path.");
    for (const record of manifest.artifacts.filter((artifact) => ["video", "srt", "vtt", "markdown"].includes(artifact.kind) || artifact.kind === "screenshot")) {
      if (record.status !== "written") fail("TUTORIAL_MANIFEST", `Packed artifact ${record.kind} is not written.`);
    }

    const defaultRun = runInstalledCli(cliCommand, dirs.consumer, ["tutorial", "run", "--scenario", scenarioPath, "--target-contract", targetContractPath, "--json"], { ...envWithBin, HOME: dirs.home, USERPROFILE: dirs.home, PLAYWRIGHT_BROWSERS_PATH: dirs.browserCache });
    const defaultJson = parseJsonOutput(defaultRun, "TUTORIAL_DEFAULT_WORKSPACE");
    if (defaultJson.status !== "browser-unavailable" || !defaultJson.paths?.runRoot.startsWith(path.join(dirs.home, ".my-dev-kit-lab", "tutorials", "lab-browser-fixture") + path.sep)) fail("TUTORIAL_DEFAULT_WORKSPACE", "Default tutorial workspace escaped the fake home boundary.");
    const explicitRun = runInstalledCli(cliCommand, dirs.consumer, ["--workspace", dirs.workspace, "tutorial", "run", "--scenario", scenarioPath, "--target-contract", targetContractPath, "--json"], { ...envWithBin, PLAYWRIGHT_BROWSERS_PATH: dirs.browserCache });
    const explicitJson = parseJsonOutput(explicitRun, "TUTORIAL_EXPLICIT_WORKSPACE");
    if (explicitJson.status !== "browser-unavailable" || !explicitJson.paths?.runRoot.startsWith(path.join(dirs.workspace, "tutorials", "lab-browser-fixture") + path.sep)) fail("TUTORIAL_EXPLICIT_WORKSPACE", "Explicit tutorial workspace escaped the requested boundary.");

    // -----------------------------------------------------------------
    // 7. External target + snapshots.
    // -----------------------------------------------------------------
    writeFileSync(
      path.join(dirs.target, "package.json"),
      `${JSON.stringify({ name: "packed-package-target", version: "1.0.0", scripts: {} }, null, 2)}\n`,
      "utf8"
    );

    const targetBefore = await snapshotDirectory(dirs.target);

    // -----------------------------------------------------------------
    // 8. Default workspace behavior (fake HOME, no --workspace).
    // -----------------------------------------------------------------
    const fakeHomeEnv = { ...envWithBin, HOME: dirs.home, USERPROFILE: dirs.home };
    const auditResult = runInstalledCli(
      cliCommand,
      dirs.consumer,
      ["audit", "--target", dirs.target, "--types", "code-rot", "--fail-on", "none"],
      fakeHomeEnv
    );
    if (auditResult.status !== 0) {
      fail("AUDIT_INSTALLED_EXECUTION", "Installed `audit` (default workspace) did not exit 0.", describeChildResult(auditResult));
    }
    const defaultWorkspaceReportsDir = path.join(dirs.home, ".my-dev-kit-lab", "reports", "audits", "code-rot");
    if (!existsSync(defaultWorkspaceReportsDir) || readdirSync(defaultWorkspaceReportsDir).length === 0) {
      fail("DEFAULT_WORKSPACE", `Expected audit report files under ${defaultWorkspaceReportsDir}; none found.`);
    }

    // -----------------------------------------------------------------
    // 9. Explicit workspace behavior.
    // -----------------------------------------------------------------
    const securityResult = runInstalledCli(
      cliCommand,
      dirs.consumer,
      ["--workspace", dirs.workspace, "security", "validate", "--target", dirs.target, "--checks", "boundary", "--format", "json"],
      envWithBin
    );
    if (securityResult.status !== 0) {
      fail(
        "SECURITY_INSTALLED_EXECUTION",
        "Installed `security validate` (explicit workspace) did not exit 0.",
        describeChildResult(securityResult)
      );
    }
    const explicitWorkspaceReportsDir = path.join(dirs.workspace, "reports", "security");
    if (!existsSync(explicitWorkspaceReportsDir) || readdirSync(explicitWorkspaceReportsDir).length === 0) {
      fail("EXPLICIT_WORKSPACE", `Expected security report files under ${explicitWorkspaceReportsDir}; none found.`);
    }
    if (existsSync(path.join(installedPackageRoot, "reports"))) {
      fail("EXPLICIT_WORKSPACE", "Security report was written beneath the installed package root.");
    }
    if (existsSync(path.join(dirs.target, "reports"))) {
      fail("EXPLICIT_WORKSPACE", "Security report was written beneath the target root.");
    }

    // -----------------------------------------------------------------
    // 9b. Installed warm-index-reuse execution and plots. A temporary,
    // test-owned fake my-dev-kit script stands in for the real kit so the
    // gate needs no network; it is never packaged.
    // -----------------------------------------------------------------
    const fakeKitScript = path.join(dirs.fakeKit, "fake-my-dev-kit.mjs");
    writeFileSync(fakeKitScript, FAKE_MY_DEV_KIT_SOURCE, "utf8");
    const fakeKitCommand = `"${process.execPath}" "${fakeKitScript}"`;
    const warmOut = path.join(dirs.workspace, "warm-index-run");
    const warmPlotsOut = path.join(dirs.workspace, "warm-index-plots");
    const warmRun = runInstalledCli(
      cliCommand,
      dirs.consumer,
      ["experiment", "run", "--experiment", "warm-index-reuse", "--case", "todo-ts-create-task", "--kit-command", fakeKitCommand, "--out", warmOut],
      envWithBin
    );
    if (warmRun.status !== 0) {
      fail("WARM_INDEX_INSTALLED_EXECUTION", "Installed warm-index-reuse run did not exit 0.", describeChildResult(warmRun));
    }
    for (const name of ["warm-index-execution.json", "report.json", "report.txt", "report.html"]) {
      requireNonEmptyFile(path.join(warmOut, name), "WARM_INDEX_REPORTS");
    }
    const warmReportText = readFileSync(path.join(warmOut, "report.json"), "utf8");
    const warmReport = JSON.parse(warmReportText).report;
    const warmTask = warmReport?.warmIndexReuse?.projects?.[0]?.tasks?.[0];
    if (warmReport?.plugin?.id !== "warm-index-reuse" || !warmTask) {
      fail("WARM_INDEX_REPORTS", "Installed warm-index report is missing its plugin id or warmIndexReuse section.");
    }
    for (const side of ["raw", "warm"]) {
      if (warmTask[side].agentCorrectness?.availability !== "available" || warmTask[side].agentTotalTokens?.availability !== "available") {
        fail("WARM_INDEX_AGENT_EVIDENCE", `Installed warm-index run lacks fake-agent correctness/token evidence for the ${side} side.`);
      }
    }
    if (warmReportText.includes("contextText") || warmReportText.includes(FAKE_KIT_SOURCE_TEXT)) {
      fail("WARM_INDEX_REPORTS", "Installed warm-index report contains context text.");
    }

    // v0.6.0 Batch 1: the installed run records baseline index-build evidence (no comparison, no
    // freshness). Target/installed-package immutability is proven by the end-of-run checks below.
    const warmArtifactText = readFileSync(path.join(warmOut, "warm-index-execution.json"), "utf8");
    const warmSnapshot = JSON.parse(warmArtifactText).projects?.[0]?.indexSnapshot;
    const warmTaskServiceSource = readFileSync(path.join(installedPackageRoot, "benchmarks", "projects", "todo-ts", "src", "taskService.ts"), "utf8");
    const warmTaskServiceEntry = warmSnapshot?.files?.find((file) => file.path === "src/taskService.ts");
    if (
      warmSnapshot?.schemaVersion !== "my-dev-kit-lab-index-snapshot-v1" ||
      warmSnapshot.status !== "complete" ||
      !warmTaskServiceEntry ||
      warmTaskServiceEntry.sha256 !== createHash("sha256").update(warmTaskServiceSource).digest("hex") ||
      !warmSnapshot.artifacts?.some((artifact) => artifact.path === "manifest.json") ||
      warmSnapshot.tool?.availability !== "available" ||
      warmSnapshot.tool?.version !== FAKE_KIT_VERSION
    ) {
      fail("WARM_INDEX_INDEX_SNAPSHOT", `Installed warm-index execution artifact lacks a complete index snapshot: ${JSON.stringify(warmSnapshot)?.slice(0, 400)}`);
    }
    if (warmArtifactText.includes(warmTaskServiceSource.split("\n").find((line) => line.includes("constructor(")) ?? "\u0000") || warmArtifactText.includes(FAKE_KIT_SOURCE_TEXT)) {
      fail("WARM_INDEX_INDEX_SNAPSHOT", "Installed warm-index execution artifact contains source or context text.");
    }
    // v0.6.0 Batch 2: per-task, observational freshness of the unchanged installed target. It is
    // evidence only and never changes the task/warm statuses asserted elsewhere in this gate.
    const warmFreshnessTasks = JSON.parse(warmArtifactText).projects?.[0]?.tasks ?? [];
    if (warmFreshnessTasks.length === 0) {
      fail("WARM_INDEX_INDEX_FRESHNESS", "Installed warm-index execution artifact has no tasks to carry freshness evidence.");
    }
    for (const task of warmFreshnessTasks) {
      const freshness = task.indexFreshness;
      if (
        freshness?.schemaVersion !== "my-dev-kit-lab-index-freshness-v1" ||
        freshness.status !== "fresh" ||
        freshness.baselineSnapshotStatus !== "complete" ||
        freshness.indexedFileCount !== warmSnapshot.indexedFileCount ||
        freshness.unchangedFileCount !== warmSnapshot.indexedFileCount ||
        freshness.changedFileCount !== 0 ||
        freshness.missingFileCount !== 0 ||
        freshness.unresolvedFileCount !== 0 ||
        task.warmStatus !== "completed"
      ) {
        fail("WARM_INDEX_INDEX_FRESHNESS", `Installed warm-index task lacks fresh index-freshness evidence: ${JSON.stringify(freshness)?.slice(0, 400)}`);
      }
    }
    // v0.6.1: the additive affected-neighborhood evidence is persisted under the unchanged v1 schema.
    // This fake kit builds no code graph, so the assessment ran but is unavailable; it never
    // changes the task statuses asserted above.
    if (JSON.parse(warmArtifactText).schemaVersion !== "my-dev-kit-lab-warm-index-execution-v1") {
      fail("WARM_INDEX_AFFECTED_NEIGHBORHOOD_FAKE_KIT", "Installed warm-index execution artifact changed its outer schema version.");
    }
    for (const task of warmFreshnessTasks) {
      const assessment = task.affectedNeighborhood;
      if (assessment?.schemaVersion !== "my-dev-kit-lab-affected-neighborhood-assessment-v1" || assessment.status !== "unavailable" || task.status !== "completed") {
        fail("WARM_INDEX_AFFECTED_NEIGHBORHOOD_FAKE_KIT", `Installed fake-kit task lacks an unavailable affected-neighborhood assessment: ${JSON.stringify(assessment)?.slice(0, 300)}`);
      }
    }

    // v0.6.0 Batch 3: the installed report files present the persisted freshness evidence.
    const warmFreshnessSummary = warmReport.warmIndexReuse?.indexFreshnessSummary;
    const warmReportTasks = warmReport.warmIndexReuse?.projects?.flatMap((project) => project.tasks) ?? [];
    if (
      !warmFreshnessSummary ||
      warmFreshnessSummary.assessedTaskCount !== warmFreshnessTasks.length ||
      warmFreshnessSummary.freshTaskCount !== warmFreshnessTasks.length ||
      warmFreshnessSummary.staleTaskCount !== 0 ||
      warmFreshnessSummary.partiallyStaleTaskCount !== 0 ||
      warmFreshnessSummary.unknownTaskCount !== 0 ||
      warmFreshnessSummary.unassessedTaskCount !== 0 ||
      !warmReportTasks.some((task) => task.indexFreshness?.status === "fresh")
    ) {
      fail("WARM_INDEX_REPORT_FRESHNESS", `Installed report.json lacks fresh index-freshness presentation: ${JSON.stringify(warmFreshnessSummary)}`);
    }
    const warmReportTextFile = readFileSync(path.join(warmOut, "report.txt"), "utf8");
    const warmReportHtmlFile = readFileSync(path.join(warmOut, "report.html"), "utf8");
    if (!warmReportTextFile.includes("Index Freshness Summary") || !warmReportTextFile.includes("Index Freshness Status: fresh")) {
      fail("WARM_INDEX_REPORT_FRESHNESS", "Installed report.txt lacks the index freshness summary or a fresh task status.");
    }
    if (!warmReportHtmlFile.includes("Index Freshness") || !warmReportHtmlFile.includes("fresh")) {
      fail("WARM_INDEX_REPORT_FRESHNESS", "Installed report.html lacks the index freshness presentation.");
    }
    if (JSON.stringify(warmReport.warmIndexReuse).match(/\b[0-9a-f]{64}\b/) || /\b[0-9a-f]{64}\b/.test(warmReportTextFile) || /\b[0-9a-f]{64}\b/.test(warmReportHtmlFile)) {
      fail("WARM_INDEX_REPORT_FRESHNESS", "Installed warm-index report presentation contains a content hash.");
    }

    const warmPlots = runInstalledCli(cliCommand, dirs.consumer, ["plots", "generate", "--experiment", warmOut, "--out", warmPlotsOut], envWithBin);
    if (warmPlots.status !== 0) {
      fail("WARM_INDEX_PLOTS", "Installed `plots generate` for warm-index output did not exit 0.", describeChildResult(warmPlots));
    }
    const warmPlotSummary = JSON.parse(readFileSync(path.join(warmPlotsOut, "plots-summary.json"), "utf8"));
    if (warmPlotSummary.chartCount !== WARM_INDEX_CHARTS.length) {
      fail("WARM_INDEX_PLOTS", `Expected ${WARM_INDEX_CHARTS.length} warm-index charts, got ${warmPlotSummary.chartCount}.`);
    }
    for (const chart of WARM_INDEX_CHARTS) {
      const chartPath = path.join(warmPlotsOut, "charts", chart);
      requireNonEmptyFile(chartPath, "WARM_INDEX_PLOTS");
      if (!readFileSync(chartPath, "utf8").includes("<svg")) {
        fail("WARM_INDEX_PLOTS", `Warm-index chart is not SVG markup: ${chart}`);
      }
    }
    const warmPlotData = readFileSync(path.join(warmPlotsOut, "plot-data.json"), "utf8");
    if (warmPlotData.includes("contextText") || warmPlotData.includes(FAKE_KIT_SOURCE_TEXT)) {
      fail("WARM_INDEX_PLOTS", "Warm-index plot data contains context text.");
    }

    // 9c. Installed v0.5.1 warm-index benchmark corpus: readable resource with the expected basic
    // shape, consumed through the existing --cases surface with one bounded selected case.
    const installedCorpusPath = path.join(installedPackageRoot, WARM_INDEX_BENCHMARK_CORPUS);
    if (!existsSync(installedCorpusPath)) {
      fail("WARM_INDEX_BENCHMARK_CORPUS_INSTALLED_READ", `Installed package is missing ${WARM_INDEX_BENCHMARK_CORPUS}.`);
    }
    let installedCorpus;
    try {
      installedCorpus = JSON.parse(readFileSync(installedCorpusPath, "utf8"));
    } catch (error) {
      fail("WARM_INDEX_BENCHMARK_CORPUS_INSTALLED_READ", `Installed warm-index benchmark corpus is not valid JSON: ${error.message}`);
    }
    if (!Array.isArray(installedCorpus)) {
      fail("WARM_INDEX_BENCHMARK_CORPUS_INSTALLED_READ", "Installed warm-index benchmark corpus is not a JSON array.");
    }
    const installedCorpusIds = installedCorpus.map((entry) => entry?.id);
    const expectedCorpusTotal = Object.values(WARM_INDEX_BENCHMARK_CORPUS_PROJECT_COUNTS).reduce((sum, count) => sum + count, 0);
    if (installedCorpus.length !== expectedCorpusTotal || new Set(installedCorpusIds).size !== installedCorpusIds.length) {
      fail(
        "WARM_INDEX_BENCHMARK_CORPUS_INSTALLED_READ",
        `Installed warm-index benchmark corpus must hold ${expectedCorpusTotal} uniquely identified cases; found ${installedCorpus.length}.`
      );
    }
    for (const [project, expectedCount] of Object.entries(WARM_INDEX_BENCHMARK_CORPUS_PROJECT_COUNTS)) {
      const projectCases = installedCorpus.filter((entry) => entry?.benchmarkProject === project);
      if (projectCases.length !== expectedCount) {
        fail("WARM_INDEX_BENCHMARK_CORPUS_INSTALLED_READ", `Installed corpus has ${projectCases.length} ${project} cases; expected ${expectedCount}.`);
      }
      for (const locality of WARM_INDEX_BENCHMARK_CORPUS_LOCALITIES) {
        if (!projectCases.some((entry) => entry.taskLocality === locality)) {
          fail("WARM_INDEX_BENCHMARK_CORPUS_INSTALLED_READ", `Installed corpus has no ${locality} case for ${project}.`);
        }
      }
    }

    // A relative --cases path resolves against the installed package root (existing behavior).
    const corpusOut = path.join(dirs.workspace, "warm-index-corpus-run");
    const corpusRun = runInstalledCli(
      cliCommand,
      dirs.consumer,
      [
        "experiment", "run", "--experiment", "warm-index-reuse",
        "--cases", WARM_INDEX_BENCHMARK_CORPUS,
        "--case", WARM_INDEX_BENCHMARK_CORPUS_SELECTED_CASE,
        "--kit-command", fakeKitCommand,
        "--out", corpusOut
      ],
      envWithBin
    );
    if (corpusRun.status !== 0) {
      fail("WARM_INDEX_BENCHMARK_CORPUS_INSTALLED_SELECTION", "Installed warm-index run over the packaged corpus did not exit 0.", describeChildResult(corpusRun));
    }
    const corpusArtifact = JSON.parse(readFileSync(path.join(corpusOut, "warm-index-execution.json"), "utf8"));
    const corpusSelection = (corpusArtifact.projects ?? []).map((project) => [project.benchmarkProject, (project.tasks ?? []).map((task) => task.caseId)]);
    if (JSON.stringify(corpusSelection) !== JSON.stringify([["task-workflow-medium-ts", [WARM_INDEX_BENCHMARK_CORPUS_SELECTED_CASE]]])) {
      fail("WARM_INDEX_BENCHMARK_CORPUS_INSTALLED_SELECTION", `Unexpected selection from the packaged corpus: ${JSON.stringify(corpusSelection)}`);
    }
    const corpusReport = JSON.parse(readFileSync(path.join(corpusOut, "report.json"), "utf8")).report;
    if (corpusReport?.warmIndexReuse?.summary?.taskCount !== 1) {
      fail("WARM_INDEX_BENCHMARK_CORPUS_INSTALLED_SELECTION", "Installed corpus selection did not produce a one-task warm-index report.");
    }
    const corpusOutRelative = path.relative(installedPackageRoot, corpusOut);
    if (!corpusOutRelative.startsWith("..") && !path.isAbsolute(corpusOutRelative)) {
      fail("WARM_INDEX_OUTPUT_LOCATION", "Installed corpus selection output was written beneath the installed package root.");
    }

    if (existsSync(path.join(installedPackageRoot, "indexes")) || existsSync(path.join(installedPackageRoot, "agents"))) {
      fail("WARM_INDEX_OUTPUT_LOCATION", "Warm-index output was written beneath the installed package root.");
    }
    console.log("EXPERIMENT_LIST_REQUIRED_PLUGINS: PASS");
    console.log("EXPERIMENT_DESCRIBE_WARM: PASS");
    console.log("EXPERIMENT_RUN_HELP: PASS");
    console.log("WARM_INDEX_INSTALLED_EXECUTION: PASS");
    console.log("WARM_INDEX_REPORTS: PASS");
    console.log(`WARM_INDEX_PLOTS: PASS (${warmPlotSummary.chartCount} charts)`);
    console.log("WARM_INDEX_BENCHMARK_CORPUS_RESOURCE: PASS");
    console.log(`WARM_INDEX_BENCHMARK_CORPUS_INSTALLED_READ: PASS (${installedCorpus.length} cases)`);
    console.log(`WARM_INDEX_BENCHMARK_CORPUS_INSTALLED_SELECTION: PASS (${WARM_INDEX_BENCHMARK_CORPUS_SELECTED_CASE})`);

    // -----------------------------------------------------------------
    // 9c-2. v0.6.1 affected-neighborhood installed-package acceptance. The
    // installed CLIs (from the exact tarball) run against the REAL published
    // @dailephd/my-dev-kit at the pinned version -- no fake kit, no
    // hand-written graph. Case A is fresh. Case B needs a real post-baseline
    // file change; the installed CLI only accepts case targets inside its own
    // package root, so a disposable SECOND install of the same tarball is the
    // sole mutable sandbox, while the primary install stays under the
    // immutability gates. All generated output lives in dirs.affectedRuns.
    // -----------------------------------------------------------------
    const affectedPrimaryBenchmarkRoot = path.join(installedPackageRoot, "benchmarks", "projects", AFFECTED_BENCHMARK_PROJECT);
    const canonicalBenchmarkRoot = path.join(REPO_ROOT, "benchmarks", "projects", AFFECTED_BENCHMARK_PROJECT);
    const canonicalBenchmarkBefore = await snapshotDirectory(canonicalBenchmarkRoot);
    const primaryBenchmarkBefore = await snapshotDirectory(affectedPrimaryBenchmarkRoot);
    const readJsonFile = (file, gate) => {
      try {
        return JSON.parse(readFileSync(file, "utf8"));
      } catch (error) {
        fail(gate, `Could not read JSON ${file}: ${error.message}`);
      }
    };

    // Upstream pin: the registry must still report the pinned version (never silently test a newer one).
    const registryView = runNpm(resolveCommand, ["view", UPSTREAM_MY_DEV_KIT_PACKAGE, "version"], { cwd: dirs.consumer, gate: "AFFECTED_NEIGHBORHOOD_REAL_MY_DEV_KIT" });
    if (registryView.status !== 0 || registryView.stdout.trim() !== UPSTREAM_MY_DEV_KIT_VERSION) {
      fail(
        "AFFECTED_NEIGHBORHOOD_REAL_MY_DEV_KIT",
        `BLOCKED_UPSTREAM_MY_DEV_KIT_BASELINE_CHANGED: registry reports ${JSON.stringify(registryView.stdout?.trim())}, expected ${UPSTREAM_MY_DEV_KIT_VERSION}.`,
        describeChildResult(registryView)
      );
    }
    writeFileSync(path.join(dirs.upstream, "package.json"), `${JSON.stringify({ name: "my-dev-kit-lab-packed-upstream", version: "0.0.0", private: true }, null, 2)}\n`, "utf8");
    const upstreamInstall = runNpm(resolveCommand, ["install", "--no-audit", "--no-fund", UPSTREAM_MY_DEV_KIT_SPEC], { cwd: dirs.upstream, gate: "AFFECTED_NEIGHBORHOOD_REAL_MY_DEV_KIT" });
    if (upstreamInstall.status !== 0) {
      fail("AFFECTED_NEIGHBORHOOD_REAL_MY_DEV_KIT", `npm install of ${UPSTREAM_MY_DEV_KIT_SPEC} failed.`, describeChildResult(upstreamInstall));
    }
    const upstreamPackageRoot = path.join(dirs.upstream, "node_modules", ...UPSTREAM_MY_DEV_KIT_PACKAGE.split("/"));
    const upstreamPackageJson = readJsonFile(path.join(upstreamPackageRoot, "package.json"), "AFFECTED_NEIGHBORHOOD_REAL_MY_DEV_KIT");
    const upstreamIdentityProblems = validateUpstreamMyDevKitIdentity(upstreamPackageJson);
    const upstreamBinRelative = resolveUpstreamBinRelativePath(upstreamPackageJson);
    if (upstreamIdentityProblems.length > 0 || !upstreamBinRelative) {
      fail("AFFECTED_NEIGHBORHOOD_REAL_MY_DEV_KIT", `Installed upstream identity problem(s): ${[...upstreamIdentityProblems, ...(upstreamBinRelative ? [] : ["no bin entry"])].join("; ")}`);
    }
    const upstreamBin = path.join(upstreamPackageRoot, ...upstreamBinRelative.split("/"));
    const upstreamVersionProbe = spawnSync(process.execPath, [upstreamBin, "--version"], { encoding: "utf8" });
    if (upstreamVersionProbe.status !== 0 || !upstreamVersionProbe.stdout.includes(UPSTREAM_MY_DEV_KIT_VERSION)) {
      fail("AFFECTED_NEIGHBORHOOD_REAL_MY_DEV_KIT", `Upstream --version probe did not report ${UPSTREAM_MY_DEV_KIT_VERSION}.`, describeChildResult(upstreamVersionProbe));
    }
    const realKitCommand = `"${process.execPath}" "${upstreamBin}"`;

    // v0.6.1 adds no CLI command or flag: installed help must not mention the feature.
    for (const helpArgs of [["--help"], ["experiment", "run", "--help"], ["experiment", "describe", "--experiment", "warm-index-reuse"]]) {
      const helpOutput = runInstalledCli(cliCommand, dirs.consumer, helpArgs, envWithBin);
      if (helpOutput.status !== 0 || /affected|neighborhood|reindex/i.test(helpOutput.stdout)) {
        fail("AFFECTED_NEIGHBORHOOD_CLI_SURFACE", `Installed \`${helpArgs.join(" ")}\` exited ${helpOutput.status} or mentions affected-neighborhood/reindex options.`);
      }
    }

    const assertOutputOutsidePackage = (outDir, packageRoot, label) => {
      const relative = path.relative(packageRoot, outDir);
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
        fail("AFFECTED_NEIGHBORHOOD_OUTPUT_LOCATION", `${label} output was written beneath its installed package root.`);
      }
      if (existsSync(path.join(packageRoot, "indexes")) || existsSync(path.join(packageRoot, "agents")) || existsSync(path.join(packageRoot, "commands"))) {
        fail("AFFECTED_NEIGHBORHOOD_OUTPUT_LOCATION", `${label} generated indexes/commands beneath its installed package root.`);
      }
    };
    const readRunOutputs = (outDir, gate) => ({
      executionArtifact: readJsonFile(path.join(outDir, "warm-index-execution.json"), gate),
      report: readJsonFile(path.join(outDir, "report.json"), gate).report,
      reportText: readFileSync(path.join(outDir, "report.txt"), "utf8"),
      reportHtml: readFileSync(path.join(outDir, "report.html"), "utf8")
    });
    const requireLayers = (gate, outputs, caseId, expected) => {
      const problems = validateAffectedNeighborhoodLayers({ caseId, ...outputs, expected });
      if (problems.length > 0) fail(gate, problems.join("\n"));
    };
    const requireRealUpstreamIndex = (outDir, gate) => {
      const indexDir = path.join(outDir, "indexes", AFFECTED_BENCHMARK_PROJECT);
      const manifest = readJsonFile(path.join(indexDir, "manifest.json"), gate);
      const graph = readJsonFile(path.join(indexDir, "code-graph.json"), gate);
      if (manifest.artifactKind !== "my-dev-kit-v1-manifest" || graph.artifactKind !== "code-graph" || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
        fail(gate, "The real upstream index did not produce the expected manifest and code graph artifacts.");
      }
    };

    // ---- Case A: fresh --------------------------------------------------
    const freshOut = path.join(dirs.affectedRuns, "fresh");
    const freshRun = runInstalledCli(
      cliCommand,
      dirs.consumer,
      ["experiment", "run", "--experiment", "warm-index-reuse", "--cases", WARM_INDEX_BENCHMARK_CORPUS, "--case", AFFECTED_CHANGED_CASE, "--kit-command", realKitCommand, "--out", freshOut],
      envWithBin
    );
    if (freshRun.status !== 0) {
      fail("AFFECTED_NEIGHBORHOOD_FRESH", "Installed fresh affected-neighborhood run did not exit 0.", describeChildResult(freshRun));
    }
    assertOutputOutsidePackage(freshOut, installedPackageRoot, "Fresh run");
    for (const name of ["warm-index-execution.json", "report.json", "report.txt", "report.html"]) requireNonEmptyFile(path.join(freshOut, name), "AFFECTED_NEIGHBORHOOD_FRESH");
    requireRealUpstreamIndex(freshOut, "AFFECTED_NEIGHBORHOOD_REAL_MY_DEV_KIT");
    const freshOutputs = readRunOutputs(freshOut, "AFFECTED_NEIGHBORHOOD_FRESH");
    const freshProject = freshOutputs.executionArtifact.projects?.[0];
    if (freshOutputs.executionArtifact.projects?.length !== 1 || freshProject?.sessionPrepared !== true || freshProject?.tasks?.length !== 1) {
      fail("AFFECTED_NEIGHBORHOOD_FRESH", "Fresh run did not prepare exactly one session for one task.");
    }
    if (freshProject.indexSnapshot?.tool?.version?.includes(UPSTREAM_MY_DEV_KIT_VERSION) !== true) {
      fail("AFFECTED_NEIGHBORHOOD_REAL_MY_DEV_KIT", `Fresh run index snapshot did not record the real upstream version: ${JSON.stringify(freshProject.indexSnapshot?.tool)}`);
    }
    if (freshProject.tasks[0].indexFreshness?.status !== "fresh") fail("AFFECTED_NEIGHBORHOOD_FRESH", "Fresh run task freshness is not fresh.");
    requireLayers("AFFECTED_NEIGHBORHOOD_FRESH", freshOutputs, AFFECTED_CHANGED_CASE, {
      freshnessStatus: "fresh",
      assessmentStatus: "complete",
      relationship: "unrelated",
      reindexRecommendation: "not-indicated",
      metrics: { changedFileCount: 0, changedSymbolCount: 0, affectedNodeCount: 0, affectedEdgeCount: 0, taskOverlapCount: 0, taskOverlapPercent: 0 }
    });

    // ---- Case B: controlled changed file in a disposable second install ----
    writeFileSync(path.join(dirs.mutableConsumer, "package.json"), `${JSON.stringify({ name: "my-dev-kit-lab-packed-mutable-consumer", version: "0.0.0", private: true }, null, 2)}\n`, "utf8");
    const sandboxInstall = runNpm(resolveCommand, ["install", "--no-audit", "--no-fund", tarballPath], { cwd: dirs.mutableConsumer, gate: "AFFECTED_NEIGHBORHOOD_CHANGED_FILE" });
    if (sandboxInstall.status !== 0) {
      fail("AFFECTED_NEIGHBORHOOD_CHANGED_FILE", "npm install of the exact tarball into the disposable mutable consumer failed.", describeChildResult(sandboxInstall));
    }
    const sandboxPackageRoot = path.join(dirs.mutableConsumer, "node_modules", EXPECTED_PACKAGE_NAME);
    const { resolved: sandboxCliCommand, envWithBin: sandboxEnv } = resolveConsumerBinCommand(resolveCommand, dirs.mutableConsumer);
    const sandboxBenchmarkRoot = path.join(sandboxPackageRoot, "benchmarks", "projects", AFFECTED_BENCHMARK_PROJECT);
    const sandboxMutatedFile = path.join(sandboxBenchmarkRoot, ...AFFECTED_MUTATED_FILE.split("/"));
    const sandboxBefore = await snapshotDirectory(sandboxPackageRoot);
    const wrapperDir = path.join(dirs.affectedRuns, "mutation-wrapper");
    await mkdir(wrapperDir, { recursive: true });
    const wrapperScript = path.join(wrapperDir, "controlled-mutation-kit.mjs");
    const wrapperState = path.join(wrapperDir, "state.json");
    const wrapperLog = path.join(wrapperDir, "log.txt");
    writeFileSync(
      wrapperScript,
      buildControlledMutationKitWrapperSource({ upstreamBin, mutateFile: sandboxMutatedFile, mutationText: AFFECTED_MUTATION_TEXT, statePath: wrapperState, logPath: wrapperLog }),
      "utf8"
    );
    const changedOut = path.join(dirs.affectedRuns, "changed");
    const changedRun = runInstalledCli(
      sandboxCliCommand,
      dirs.mutableConsumer,
      ["experiment", "run", "--experiment", "warm-index-reuse", "--cases", WARM_INDEX_BENCHMARK_CORPUS, "--case", `${AFFECTED_FIRST_CASE},${AFFECTED_CHANGED_CASE}`, "--kit-command", `"${process.execPath}" "${wrapperScript}"`, "--out", changedOut],
      sandboxEnv
    );
    if (changedRun.status !== 0) {
      fail("AFFECTED_NEIGHBORHOOD_CHANGED_FILE", "Installed controlled changed-file run did not exit 0.", describeChildResult(changedRun));
    }
    assertOutputOutsidePackage(changedOut, sandboxPackageRoot, "Changed-file run");
    for (const name of ["warm-index-execution.json", "report.json", "report.txt", "report.html"]) requireNonEmptyFile(path.join(changedOut, name), "AFFECTED_NEIGHBORHOOD_CHANGED_FILE");
    requireRealUpstreamIndex(changedOut, "AFFECTED_NEIGHBORHOOD_REAL_MY_DEV_KIT");

    // Mutation timing evidence: the file was unchanged through the real index build, and mutated
    // exactly once afterwards, only after a successful real index.
    const mutation = readJsonFile(wrapperState, "AFFECTED_NEIGHBORHOOD_CHANGED_FILE");
    const wrapperLines = readFileSync(wrapperLog, "utf8").trim().split("\n");
    if (
      mutation.indexSucceededCount !== 1 ||
      mutation.mutationCount !== 1 ||
      !mutation.shaBeforeIndex ||
      mutation.shaBeforeIndex !== mutation.shaAfterIndex ||
      mutation.shaAfterIndex !== mutation.shaBeforeMutation ||
      mutation.shaAfterMutation === mutation.shaBeforeMutation ||
      wrapperLines.findIndex((line) => line.startsWith("index\t")) !== wrapperLines.findIndex((line) => line.startsWith("index\t0")) ||
      wrapperLines.findIndex((line) => line.startsWith("index\t0")) < 0 ||
      wrapperLines.findIndex((line) => line.startsWith("search\t")) < wrapperLines.findIndex((line) => line.startsWith("index\t0"))
    ) {
      fail("AFFECTED_NEIGHBORHOOD_CHANGED_FILE", `Controlled mutation timing evidence is invalid: ${JSON.stringify(mutation)} log=${JSON.stringify(wrapperLines.slice(0, 8))}`);
    }
    const changedOutputs = readRunOutputs(changedOut, "AFFECTED_NEIGHBORHOOD_CHANGED_FILE");
    const changedTasks = changedOutputs.executionArtifact.projects?.[0]?.tasks ?? [];
    if (changedOutputs.executionArtifact.projects?.length !== 1 || changedOutputs.executionArtifact.projects[0].sessionPrepared !== true) {
      fail("AFFECTED_NEIGHBORHOOD_CHANGED_FILE", "Changed-file run did not prepare exactly one session.");
    }
    if (changedTasks.map((task) => task.caseId).join(",") !== `${AFFECTED_FIRST_CASE},${AFFECTED_CHANGED_CASE}`) {
      fail("AFFECTED_NEIGHBORHOOD_CHANGED_FILE", `Unexpected changed-file task order: ${changedTasks.map((task) => task.caseId).join(",")}`);
    }
    const changedProject = changedOutputs.executionArtifact.projects[0];
    const baselineEntry = changedProject.indexSnapshot?.files?.find((file) => file.path === AFFECTED_MUTATED_FILE);
    const staleChange = changedTasks[1].indexFreshness?.changes?.find((change) => change.path === AFFECTED_MUTATED_FILE);
    if (
      changedProject.indexSnapshot?.tool?.version?.includes(UPSTREAM_MY_DEV_KIT_VERSION) !== true ||
      baselineEntry?.sha256 !== mutation.shaBeforeIndex ||
      changedTasks[0].indexFreshness?.status !== "fresh" ||
      changedTasks[1].indexFreshness?.status !== "stale" ||
      changedTasks[1].indexFreshness.changedFileCount !== 1 ||
      changedTasks[1].indexFreshness.changes?.length !== 1 ||
      staleChange?.changeType !== "modified" ||
      staleChange.baselineSha256 !== mutation.shaBeforeIndex ||
      staleChange.currentSha256 !== mutation.shaAfterMutation
    ) {
      fail("AFFECTED_NEIGHBORHOOD_CHANGED_FILE", `Changed-file freshness/baseline evidence is inconsistent with the controlled mutation: ${JSON.stringify(changedTasks.map((task) => task.indexFreshness?.status))}`);
    }
    // Task 2 is the first task boundary after the mutation: real stale, related, recommended.
    requireLayers("AFFECTED_NEIGHBORHOOD_CHANGED_FILE", changedOutputs, AFFECTED_CHANGED_CASE, {
      freshnessStatus: "stale",
      assessmentStatus: "complete",
      relationship: "related",
      reindexRecommendation: "recommended",
      metrics: { changedFileCount: 1, changedSymbolCount: "positive", affectedNodeCount: "positive", affectedEdgeCount: "nonnegative", taskOverlapCount: "positive", taskOverlapPercent: "positive" }
    });
    // Task 1 (measured before the mutation) is fresh; its task mapping is partial (unresolved
    // expected symbols), so zero overlap stays unknown / unknown rather than unrelated.
    requireLayers("AFFECTED_NEIGHBORHOOD_PARTIAL_UNKNOWN", changedOutputs, AFFECTED_FIRST_CASE, {
      freshnessStatus: "fresh",
      assessmentStatus: "partial",
      relationship: "unknown",
      reindexRecommendation: "unknown",
      metrics: { changedFileCount: 0, changedSymbolCount: 0, affectedNodeCount: 0, affectedEdgeCount: 0, taskOverlapCount: 0, taskOverlapPercent: 0 }
    });

    // Immutability: the authoritative fixtures never change; only the sandbox's one file does.
    const sandboxChanges = diffSnapshots(sandboxBefore, await snapshotDirectory(sandboxPackageRoot));
    const expectedSandboxChange = `modified: benchmarks/projects/${AFFECTED_BENCHMARK_PROJECT}/${AFFECTED_MUTATED_FILE}`;
    if (sandboxChanges.length !== 1 || sandboxChanges[0] !== expectedSandboxChange) {
      fail("AFFECTED_NEIGHBORHOOD_MUTABLE_COPY", `Disposable sandbox changed beyond the authorized single file: ${sandboxChanges.join(", ")}`);
    }
    const canonicalChanges = diffSnapshots(canonicalBenchmarkBefore, await snapshotDirectory(canonicalBenchmarkRoot));
    if (canonicalChanges.length > 0) fail("AFFECTED_NEIGHBORHOOD_IMMUTABILITY", `Canonical source benchmark changed: ${canonicalChanges.join(", ")}`);
    const primaryBenchmarkChanges = diffSnapshots(primaryBenchmarkBefore, await snapshotDirectory(affectedPrimaryBenchmarkRoot));
    if (primaryBenchmarkChanges.length > 0) fail("AFFECTED_NEIGHBORHOOD_IMMUTABILITY", `Primary installed benchmark changed: ${primaryBenchmarkChanges.join(", ")}`);
    const leakedTarballPaths = [...tarballFiles].filter((file) => AFFECTED_LEAKED_PATHS.test(file));
    if (leakedTarballPaths.length > 0) fail("AFFECTED_NEIGHBORHOOD_PACKAGE_INVENTORY", `Tarball contains development/generated paths: ${leakedTarballPaths.slice(0, 10).join(", ")}`);

    console.log(`AFFECTED_NEIGHBORHOOD_REAL_MY_DEV_KIT: PASS (${UPSTREAM_MY_DEV_KIT_SPEC}, real index + code-graph consumed, registry=${UPSTREAM_MY_DEV_KIT_VERSION})`);
    console.log(`AFFECTED_NEIGHBORHOOD_FRESH: PASS (${AFFECTED_CHANGED_CASE}: fresh, complete, unrelated, not-indicated)`);
    console.log(`AFFECTED_NEIGHBORHOOD_CHANGED_FILE: PASS (${AFFECTED_MUTATED_FILE}: stale, changedFileCount=1, related, recommended)`);
    console.log("AFFECTED_NEIGHBORHOOD_METRICS: PASS (six structured, six generic warm-only, execution/metric/report layers agree)");
    console.log("AFFECTED_NEIGHBORHOOD_REPORT: PASS (report.json, report.txt, report.html for fresh and changed runs)");
    console.log(`AFFECTED_NEIGHBORHOOD_PARTIAL_UNKNOWN: PASS (${AFFECTED_FIRST_CASE}: partial, unknown, unknown)`);
    console.log("AFFECTED_NEIGHBORHOOD_MUTABLE_COPY: PASS (exactly one authorized sandbox file changed, after the real index)");
    console.log("AFFECTED_NEIGHBORHOOD_IMMUTABILITY: PASS (canonical and primary installed benchmarks unchanged)");
    console.log("AFFECTED_NEIGHBORHOOD_CLI_SURFACE: PASS (no new command or flag)");
    console.log("AFFECTED_NEIGHBORHOOD_PACKAGE_INVENTORY: PASS (no development or generated paths in the tarball)");

    // -----------------------------------------------------------------
    // 9c-4. v0.7.0 context-window-scaling installed-package acceptance.
    // Runs through the INSTALLED bin of consumer A from a working directory
    // that is neither the source checkout nor the installed package root. The
    // deterministic fake kit is copied from the repository test fixtures into
    // this gate's temp directory at verification time (never packaged, no
    // network). The bundled case catalog and fixed project are resolved from
    // the installed package; the project profile is derived in memory.
    // -----------------------------------------------------------------
    const SCALING_ID = "context-window-scaling";
    const SCALING_PLOT_IDS = [
      "context-window-scaling-context-size",
      "context-window-scaling-success-rate-by-budget",
      "context-window-scaling-correctness-by-budget"
    ];
    const SCALING_OUTPUTS = ["json", "text", "html", "plot"];
    const SCALING_VARIANTS = ["raw-full-file", "my-dev-kit-guided"];
    const scalingListed = knownExperiments.filter((entry) => entry.id === SCALING_ID);
    if (
      scalingListed.length !== 1 ||
      scalingListed[0].status !== "experimental" ||
      JSON.stringify(scalingListed[0].supportedVariants) !== JSON.stringify(SCALING_VARIANTS) ||
      JSON.stringify(scalingListed[0].supportedOutputs) !== JSON.stringify(SCALING_OUTPUTS) ||
      JSON.stringify(scalingListed[0].supportedTargets) !== JSON.stringify(["self", "external-local"])
    ) {
      fail("CONTEXT_WINDOW_SCALING_DISCOVERY", `Installed experiment list lacks the expected context-window-scaling entry: ${JSON.stringify(scalingListed)}`);
    }
    const scalingDescribeResult = runInstalledCli(cliCommand, dirs.consumer, ["experiment", "describe", "--experiment", SCALING_ID, "--json"], envWithBin);
    if (scalingDescribeResult.status !== 0) {
      fail("CONTEXT_WINDOW_SCALING_DISCOVERY", "Installed experiment describe for context-window-scaling did not exit 0.", describeChildResult(scalingDescribeResult));
    }
    const scalingDescribed = parseJsonOutput(scalingDescribeResult, "CONTEXT_WINDOW_SCALING_DISCOVERY");
    if (
      scalingDescribed.metadata?.id !== SCALING_ID ||
      scalingDescribed.metadata?.status !== "experimental" ||
      JSON.stringify(scalingDescribed.metadata?.supportedTargets) !== JSON.stringify(["self", "external-local"]) ||
      JSON.stringify(scalingDescribed.metadata?.supportedOutputs) !== JSON.stringify(SCALING_OUTPUTS) ||
      JSON.stringify(scalingDescribed.supportedVariants) !== JSON.stringify(SCALING_VARIANTS)
    ) {
      fail("CONTEXT_WINDOW_SCALING_DISCOVERY", `Installed describe output is not the expected context-window-scaling contract: ${scalingDescribeResult.stdout}`);
    }

    if (path.resolve(dirs.consumer) === path.resolve(installedPackageRoot) || path.resolve(dirs.consumer) === REPO_ROOT) {
      fail("CONTEXT_WINDOW_SCALING_RESOURCE_RESOLUTION", "The consumer working directory must differ from the installed package root and the source checkout.");
    }
    const scalingFakeKitScript = path.join(dirs.fakeKit, "fake-context-scaling-kit.mjs");
    writeFileSync(scalingFakeKitScript, readFileSync(path.join(REPO_ROOT, "tests", "fixtures", "fake-context-scaling-kit-cli.js"), "utf8"), "utf8");
    const scalingKitCommand = `"${process.execPath}" "${scalingFakeKitScript}"`;
    const scalingProjectRoot = path.join(installedPackageRoot, "benchmarks", "projects", "context-window-scaling-fixed-ts");
    const scalingContractsRoot = path.join(installedPackageRoot, "benchmarks", "contracts");
    for (const required of [scalingProjectRoot, path.join(scalingContractsRoot, "context-window-scaling-cases.json")]) {
      if (!existsSync(required)) fail("CONTEXT_WINDOW_SCALING_RESOURCE_RESOLUTION", `Installed package is missing bundled resource ${required}.`);
    }
    const scalingProjectBefore = await snapshotDirectory(scalingProjectRoot);
    const scalingContractsBefore = await snapshotDirectory(scalingContractsRoot);

    // Negative public CLI behavior through the installed bin.
    for (const badArgs of [["--context-budgets", "12k"], ["--case", "not-a-real-case"], ["--target", dirs.target]]) {
      const bad = runInstalledCli(cliCommand, dirs.consumer, ["experiment", "run", "--experiment", SCALING_ID, "--kit-command", scalingKitCommand, ...badArgs], envWithBin);
      if (bad.status === 0) {
        fail("CONTEXT_WINDOW_SCALING_CLI_REJECTION", `Installed run accepted invalid options: ${badArgs.join(" ")}`);
      }
    }

    const runScaling = (label, caseId, budgets) => {
      const out = path.join(dirs.workspace, `context-window-scaling-${label}`);
      const plotsOut = path.join(dirs.workspace, `context-window-scaling-${label}-plots`);
      const run = runInstalledCli(
        cliCommand,
        dirs.consumer,
        ["experiment", "run", "--experiment", SCALING_ID, "--case", caseId, "--context-budgets", budgets, "--kit-command", scalingKitCommand, "--out", out],
        envWithBin
      );
      if (run.status !== 0) {
        fail("CONTEXT_WINDOW_SCALING_RUN", `Installed context-window-scaling run (${label}) did not exit 0.`, describeChildResult(run));
      }
      assertOutputOutsidePackage(out, installedPackageRoot, `context-window-scaling ${label} run`);
      for (const name of ["context-window-scaling-execution.json", "report.json", "report.txt", "report.html"]) {
        requireNonEmptyFile(path.join(out, name), "CONTEXT_WINDOW_SCALING_REPORTS");
      }
      const artifact = readJsonFile(path.join(out, "context-window-scaling-execution.json"), "CONTEXT_WINDOW_SCALING_ARTIFACT");
      const report = readJsonFile(path.join(out, "report.json"), "CONTEXT_WINDOW_SCALING_REPORTS").report;
      if (report?.plugin?.id !== SCALING_ID) {
        fail("CONTEXT_WINDOW_SCALING_REPORTS", `Installed report.json does not belong to ${SCALING_ID}.`);
      }
      const plots = runInstalledCli(cliCommand, dirs.consumer, ["plots", "generate", "--experiment", out, "--out", plotsOut], envWithBin);
      if (plots.status !== 0) {
        fail("CONTEXT_WINDOW_SCALING_PLOTS", `Installed plots generate (${label}) did not exit 0.`, describeChildResult(plots));
      }
      const plotSummary = readJsonFile(path.join(plotsOut, "plots-summary.json"), "CONTEXT_WINDOW_SCALING_PLOTS");
      if (plotSummary.chartCount !== SCALING_PLOT_IDS.length) {
        fail("CONTEXT_WINDOW_SCALING_PLOTS", `Expected ${SCALING_PLOT_IDS.length} context-window-scaling charts, got ${plotSummary.chartCount}.`);
      }
      for (const plotId of SCALING_PLOT_IDS) {
        const chartPath = path.join(plotsOut, "charts", `${plotId}.svg`);
        requireNonEmptyFile(chartPath, "CONTEXT_WINDOW_SCALING_PLOTS");
        if (!readFileSync(chartPath, "utf8").includes("<svg")) {
          fail("CONTEXT_WINDOW_SCALING_PLOTS", `Chart is not SVG markup: ${plotId}`);
        }
      }
      const plotData = readJsonFile(path.join(plotsOut, "plot-data.json"), "CONTEXT_WINDOW_SCALING_PLOTS");
      if (JSON.stringify(plotData.plots.map((plot) => plot.id)) !== JSON.stringify(SCALING_PLOT_IDS)) {
        fail("CONTEXT_WINDOW_SCALING_PLOTS", `Unexpected plot set: ${plotData.plots.map((plot) => plot.id).join(", ")}`);
      }
      return { out, artifact, plotData };
    };

    // Bounded representative run: raw is too large at 8k/16k and fits at 32k; guided fits everywhere.
    const scalingMain = runScaling("b-standard", "ctx-scale-b-16k-32k", "8k,16k,32k");
    if (
      scalingMain.artifact.schemaVersion !== "my-dev-kit-lab-context-window-scaling-execution-v1" ||
      JSON.stringify(scalingMain.artifact.contextBudgets) !== JSON.stringify([8192, 16384, 32768]) ||
      JSON.stringify(scalingMain.artifact.cases.map((entry) => entry.caseId)) !== JSON.stringify(["ctx-scale-b-16k-32k"])
    ) {
      fail("CONTEXT_WINDOW_SCALING_ARTIFACT", "Installed execution artifact does not show the selected case and normalized 8k,16k,32k budgets.");
    }
    const scalingTreatments = Object.fromEntries(scalingMain.artifact.cases[0].treatments.map((treatment) => [treatment.variantId, treatment]));
    const fitOf = (variantId) => scalingTreatments[variantId].budgetCells.map((cell) => cell.contextFitStatus);
    if (
      JSON.stringify(fitOf("raw-full-file")) !== JSON.stringify(["context-too-large", "context-too-large", "fits"]) ||
      JSON.stringify(fitOf("my-dev-kit-guided")) !== JSON.stringify(["fits", "fits", "fits"]) ||
      scalingTreatments["my-dev-kit-guided"].context.status !== "available" ||
      scalingTreatments["my-dev-kit-guided"].evaluation.agentId !== "fake-agent"
    ) {
      fail("CONTEXT_WINDOW_SCALING_ARTIFACT", "Installed run did not use the bundled fixed project with the deterministic fake kit (unexpected fit evidence).");
    }
    const correctnessPlot = scalingMain.plotData.plots.find((plot) => plot.id === "context-window-scaling-correctness-by-budget");
    if (
      correctnessPlot.points.some((point) => point.group === "raw-full-file" && (point.x === 8192 || point.x === 16384)) ||
      !scalingMain.plotData.skippedPoints.some((point) => point.plotId === correctnessPlot.id && point.label === "raw-full-file 8k")
    ) {
      fail("CONTEXT_WINDOW_SCALING_PLOTS", "Unavailable raw correctness was plotted instead of skipped.");
    }

    // Custom budget and case-filter proof.
    const scalingCustom = runScaling("a-custom", "ctx-scale-a-8k-16k", "8k,12000,32k");
    if (
      JSON.stringify(scalingCustom.artifact.contextBudgets) !== JSON.stringify([8192, 12000, 32768]) ||
      JSON.stringify(scalingCustom.artifact.cases.map((entry) => entry.caseId)) !== JSON.stringify(["ctx-scale-a-8k-16k"])
    ) {
      fail("CONTEXT_WINDOW_SCALING_ARTIFACT", "Custom --context-budgets 8k,12000,32k did not reach the installed artifact as 8192,12000,32768.");
    }
    const customRate = scalingCustom.plotData.plots.find((plot) => plot.id === "context-window-scaling-success-rate-by-budget");
    if (JSON.stringify([...new Set(customRate.points.map((point) => point.x))]) !== JSON.stringify([8192, 12000, 32768])) {
      fail("CONTEXT_WINDOW_SCALING_PLOTS", "Custom budgets were not preserved numerically in the installed plot data.");
    }

    const scalingProjectChanges = diffSnapshots(scalingProjectBefore, await snapshotDirectory(scalingProjectRoot));
    const scalingContractsChanges = diffSnapshots(scalingContractsBefore, await snapshotDirectory(scalingContractsRoot));
    if (scalingProjectChanges.length > 0 || scalingContractsChanges.length > 0) {
      fail("CONTEXT_WINDOW_SCALING_IMMUTABILITY", `Bundled benchmark resources changed during execution: ${[...scalingProjectChanges, ...scalingContractsChanges].join(", ")}`);
    }
    console.log("CONTEXT_WINDOW_SCALING_DISCOVERY: PASS (listed and described as experimental, self + external-local targets, json/text/html/plot)");
    console.log("CONTEXT_WINDOW_SCALING_RUN: PASS (installed bin, cwd outside checkout and package, fake kit, bundled case catalog and fixed project)");
    console.log("CONTEXT_WINDOW_SCALING_ARTIFACT: PASS (V1 schema; standard and custom budgets; case filter)");
    console.log("CONTEXT_WINDOW_SCALING_REPORTS: PASS (report.json, report.txt, report.html)");
    console.log("CONTEXT_WINDOW_SCALING_PLOTS: PASS (exactly three SVG plots; null correctness skipped; custom budgets preserved)");
    console.log("CONTEXT_WINDOW_SCALING_IMMUTABILITY: PASS (bundled fixed project and case contract unchanged)");

    // -----------------------------------------------------------------
    // 9c-4b. v0.7.1 context-window-scaling --synthetic-config installed-package
    // acceptance. The SMALL TypeScript + Python config is authored here, inside
    // the disposable workspace (never sourced from the checkout), and the run goes
    // through the installed bin. Inputs and outputs live under paths containing
    // spaces. The legacy bundled-corpus run above is retained unchanged.
    // -----------------------------------------------------------------
    const SYNTHETIC_CASE_SPECS = [
      { id: "pack-ts", language: "typescript", seed: "packed", sourceFileCount: 6, moduleDepth: 3, internalImportCount: 6, symbolCount: 12, testFileCount: 3, taskLocality: "cross-module", repeatedPatternCount: 3 },
      { id: "pack-py", language: "python", seed: "packed", sourceFileCount: 6, moduleDepth: 3, internalImportCount: 6, symbolCount: 12, testFileCount: 3, taskLocality: "localized", repeatedPatternCount: 3 }
    ];
    const SYNTHETIC_CASE_IDS = ["pack-py-task", "pack-ts-task"];
    const syntheticRunHelp = runInstalledCli(cliCommand, dirs.consumer, ["experiment", "run", "--help"], envWithBin);
    const syntheticHelpText = (syntheticRunHelp.stdout ?? "").replace(/\s+/g, " ");
    if (
      syntheticRunHelp.status !== 0 ||
      !syntheticHelpText.includes("--synthetic-config <path>") ||
      !syntheticHelpText.includes("SyntheticRepositoryConfigV1") ||
      !syntheticHelpText.includes("Mutually exclusive with --case") ||
      !syntheticHelpText.includes("bundled four-case catalog")
    ) {
      fail("CONTEXT_WINDOW_SCALING_SYNTHETIC_HELP", "Installed `experiment run --help` does not document --synthetic-config, its mutual exclusion with --case, and the bundled default.", describeChildResult(syntheticRunHelp));
    }
    const syntheticDescribeResult = runInstalledCli(cliCommand, dirs.consumer, ["experiment", "describe", "--experiment", SCALING_ID, "--json"], envWithBin);
    const syntheticDescribed = parseJsonOutput(syntheticDescribeResult, "CONTEXT_WINDOW_SCALING_SYNTHETIC_DESCRIBE");
    const syntheticListed = knownExperiments.filter((entry) => entry.id === SCALING_ID);
    if (
      syntheticDescribeResult.status !== 0 ||
      JSON.stringify((syntheticDescribed.optionalConfigFields ?? []).map((field) => field.name)) !== JSON.stringify(["contextBudgets", "kitCommand"]) ||
      (syntheticDescribed.requiredConfigFields ?? []).length !== 0 ||
      !(syntheticDescribed.examples ?? []).some((example) => example.includes("--synthetic-config")) ||
      !String(syntheticDescribed.targetBehavior ?? "").includes("--synthetic-config") ||
      syntheticListed.length !== 1
    ) {
      fail("CONTEXT_WINDOW_SCALING_SYNTHETIC_DESCRIBE", `Installed describe/list does not expose --synthetic-config as a command input selector (config fields must stay contextBudgets, kitCommand): ${syntheticDescribeResult.stdout}`);
    }
    console.log("CONTEXT_WINDOW_SCALING_SYNTHETIC_HELP: PASS (--synthetic-config, mutual exclusion with --case, bundled default documented)");
    console.log("CONTEXT_WINDOW_SCALING_SYNTHETIC_DESCRIBE: PASS (selector exposed as command input; config fields stay contextBudgets, kitCommand; one list entry)");

    const syntheticInputDir = path.join(dirs.workspace, "synthetic input dir");
    mkdirSync(syntheticInputDir, { recursive: true });
    const syntheticConfigPath = path.join(syntheticInputDir, "synthetic config.json");
    writeFileSync(syntheticConfigPath, JSON.stringify({ schemaVersion: "1.0.0", cases: SYNTHETIC_CASE_SPECS }, null, 2), "utf8");
    const syntheticConfigBefore = readFileSync(syntheticConfigPath, "utf8");
    const syntheticFakeKitScript = path.join(dirs.fakeKit, "fake-synthetic-kit.cjs");
    writeFileSync(syntheticFakeKitScript, readFileSync(path.join(REPO_ROOT, "tests", "fixtures", "fake-synthetic-kit-cli.cjs"), "utf8"), "utf8");
    const syntheticKitCommand = `"${process.execPath}" "${syntheticFakeKitScript}"`;
    const syntheticOut = path.join(dirs.workspace, "synthetic run out");
    const syntheticSourceCorpus = [
      path.join(REPO_ROOT, "benchmarks", "projects", "context-window-scaling-fixed-ts"),
      path.join(REPO_ROOT, "benchmarks", "contracts")
    ];
    const syntheticSourceBefore = await Promise.all(syntheticSourceCorpus.map((root) => snapshotDirectory(root)));
    const syntheticInstalledBefore = [await snapshotDirectory(scalingProjectRoot), await snapshotDirectory(scalingContractsRoot)];

    const rejectedMix = runInstalledCli(
      cliCommand,
      dirs.consumer,
      ["experiment", "run", "--experiment", SCALING_ID, "--synthetic-config", syntheticConfigPath, "--case", "ctx-scale-a-8k-16k", "--kit-command", syntheticKitCommand, "--out", syntheticOut],
      envWithBin
    );
    if (rejectedMix.status === 0 || existsSync(syntheticOut)) {
      fail("CONTEXT_WINDOW_SCALING_SYNTHETIC_RUN", "Installed run accepted --case together with --synthetic-config.", describeChildResult(rejectedMix));
    }

    const syntheticRun = runInstalledCli(
      cliCommand,
      dirs.consumer,
      ["experiment", "run", "--experiment", SCALING_ID, "--synthetic-config", syntheticConfigPath, "--context-budgets", "8k,16k", "--kit-command", syntheticKitCommand, "--out", syntheticOut],
      envWithBin
    );
    if (syntheticRun.status !== 0) {
      fail("CONTEXT_WINDOW_SCALING_SYNTHETIC_RUN", "Installed context-window-scaling --synthetic-config run did not exit 0.", describeChildResult(syntheticRun));
    }
    assertOutputOutsidePackage(syntheticOut, installedPackageRoot, "context-window-scaling synthetic run");
    for (const name of ["context-window-scaling-execution.json", "report.json", "report.txt", "report.html"]) {
      requireNonEmptyFile(path.join(syntheticOut, name), "CONTEXT_WINDOW_SCALING_SYNTHETIC_RUN");
    }
    const syntheticArtifactText = readFileSync(path.join(syntheticOut, "context-window-scaling-execution.json"), "utf8");
    const syntheticArtifact = JSON.parse(syntheticArtifactText);
    if (
      syntheticArtifact.schemaVersion !== "my-dev-kit-lab-context-window-scaling-execution-v1" ||
      JSON.stringify(syntheticArtifact.contextBudgets) !== JSON.stringify([8192, 16384]) ||
      JSON.stringify(syntheticArtifact.cases.map((entry) => entry.caseId)) !== JSON.stringify(SYNTHETIC_CASE_IDS)
    ) {
      fail("CONTEXT_WINDOW_SCALING_SYNTHETIC_RUN", "Installed synthetic execution artifact is not the V1 schema over the two generated cases in normalized order.");
    }
    for (const hostPath of [dirs.workspace, dirs.consumer, syntheticOut, syntheticConfigPath, installedPackageRoot, tempRoot]) {
      if (syntheticArtifactText.includes(hostPath) || syntheticArtifactText.includes(JSON.stringify(hostPath).slice(1, -1))) {
        fail("CONTEXT_WINDOW_SCALING_SYNTHETIC_RUN", `Execution artifact leaks host path ${hostPath}.`);
      }
    }
    for (const entry of syntheticArtifact.cases) {
      const guided = entry.treatments.find((treatment) => treatment.variantId === "my-dev-kit-guided");
      if (guided?.context?.status !== "available") {
        fail("CONTEXT_WINDOW_SCALING_SYNTHETIC_RUN", `Guided treatment for ${entry.caseId} did not produce available context with the deterministic fake kit.`);
      }
    }
    console.log("CONTEXT_WINDOW_SCALING_SYNTHETIC_RUN: PASS (installed bin, space-containing paths, TypeScript + Python cases, V1 artifact, reports, no host paths)");

    const installedSyntheticModule = await import(
      pathToFileURL(path.join(installedPackageRoot, "dist", "src", "evaluation", "syntheticRepository", "index.js")).href
    );
    for (const spec of SYNTHETIC_CASE_SPECS) {
      const caseDir = path.join(syntheticOut, "synthetic-repositories", spec.id);
      const repositoryRoot = path.join(caseDir, "repository");
      const manifestPath = path.join(caseDir, "synthetic-repository-manifest.json");
      if (!existsSync(repositoryRoot) || !existsSync(manifestPath)) {
        fail("CONTEXT_WINDOW_SCALING_SYNTHETIC_MANIFESTS", `Generated ${spec.language} repository or manifest is missing for ${spec.id}.`);
      }
      if (path.relative(installedPackageRoot, repositoryRoot).startsWith("..") === false) {
        fail("CONTEXT_WINDOW_SCALING_SYNTHETIC_MANIFESTS", `Generated repository ${spec.id} is inside the installed package tree.`);
      }
      const verification = installedSyntheticModule.verifySyntheticRepositoryMaterialization({ manifestPath, repositoryRoot });
      if (!verification.ok || verification.issues.length > 0) {
        fail("CONTEXT_WINDOW_SCALING_SYNTHETIC_MANIFESTS", `Installed verifier rejected ${spec.id}: ${verification.issues.join("; ")}`);
      }
    }
    console.log("CONTEXT_WINDOW_SCALING_SYNTHETIC_MANIFESTS: PASS (TypeScript and Python repositories + manifests verified by the installed compiled verifier, outside the package tree)");

    const syntheticSourceAfter = await Promise.all(syntheticSourceCorpus.map((root) => snapshotDirectory(root)));
    const syntheticInstalledAfter = [await snapshotDirectory(scalingProjectRoot), await snapshotDirectory(scalingContractsRoot)];
    const syntheticChanges = [
      ...syntheticSourceBefore.flatMap((before, index) => diffSnapshots(before, syntheticSourceAfter[index])),
      ...syntheticInstalledBefore.flatMap((before, index) => diffSnapshots(before, syntheticInstalledAfter[index]))
    ];
    if (syntheticChanges.length > 0 || readFileSync(syntheticConfigPath, "utf8") !== syntheticConfigBefore) {
      fail("CONTEXT_WINDOW_SCALING_SYNTHETIC_IMMUTABILITY", `Frozen corpus or synthetic input changed during the synthetic run: ${syntheticChanges.join(", ")}`);
    }
    console.log("CONTEXT_WINDOW_SCALING_SYNTHETIC_IMMUTABILITY: PASS (input config, frozen corpus in checkout and installed package unchanged; whole-run package diff checked later)");

    // -----------------------------------------------------------------
    // 9c-4c. v0.7.2 installed-package external-local repository acceptance.
    // The INSTALLED bin runs context-window-scaling against a disposable
    // local Git repository (paths with spaces, nested sources, an ignored
    // private file and an oversized file) with the REAL published my-dev-kit
    // resolved above (realKitCommand) -- never a fake kit and never a
    // source-checkout import. It proves command compatibility, safe
    // exclusions, completion, cleanup, target immutability and privacy-safe
    // durable output; it asserts no retrieval winner and no quality metric.
    // -----------------------------------------------------------------
    {
      const gate = "CONTEXT_WINDOW_SCALING_LOCAL_SUBJECT";
      const privacyScan = await loadPrivacyScan();
      const LOCAL_MARKERS = {
        eligible: "PACKED_ELIGIBLE_MARKER_4c1d",
        ignoredFile: "PACKED_IGNORED_MARKER_8e20",
        ignoredDirectory: "PACKED_IGNORED_DIR_MARKER_b7a3",
        oversized: "PACKED_OVERSIZED_MARKER_61f9"
      };
      const localArea = path.join(tempRoot, "local subject area");
      const localTarget = path.join(localArea, "target repo", "inner project");
      const localConfigPath = path.join(localArea, "config dir", "local subject.json");
      const localOut = path.join(dirs.workspace, "local subject out", "run");
      const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
      for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]) delete gitEnv[key];
      const localGit = (...args) => {
        const result = spawnSync(
          "git",
          ["-c", "user.name=Packed Gate", "-c", "user.email=packed-gate@example.invalid", "-c", "commit.gpgsign=false", ...args],
          { cwd: localTarget, encoding: "utf8", env: gitEnv }
        );
        if (result.status !== 0) fail(gate, `git ${args[0]} failed while preparing the disposable local subject.`, describeChildResult(result));
        return result.stdout;
      };
      const localWrite = (relative, content) => {
        const absolute = path.join(localTarget, ...relative.split("/"));
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, content, "utf8");
      };
      mkdirSync(localTarget, { recursive: true });
      localGit("init", "-q", "-b", "main");
      localWrite(".gitignore", "src/private notes.ts\nsrc/gen/\n");
      localWrite("src/app/main.ts", `export function computeTotal(values: number[]): number { return values.reduce((sum, value) => sum + value, 0); } // ${LOCAL_MARKERS.eligible}\n`);
      localWrite("src/app/util/helper.ts", "export const helper = 2;\n");
      localWrite("src/huge file.ts", `// ${LOCAL_MARKERS.oversized}\n${"x".repeat(1_048_576 + 100)}\n`);
      localGit("add", "-A");
      localGit("commit", "-q", "-m", "packed fixture");
      localWrite("src/private notes.ts", `export const privateNotes = 1; // ${LOCAL_MARKERS.ignoredFile}\n`);
      localWrite("src/gen/out.ts", `export const generated = 1; // ${LOCAL_MARKERS.ignoredDirectory}\n`);
      mkdirSync(path.dirname(localConfigPath), { recursive: true });
      writeFileSync(
        localConfigPath,
        JSON.stringify({
          schemaVersion: "1.0.0",
          subjectId: "packed-local-subject",
          cases: [
            {
              id: "compute-total",
              title: "Find computeTotal",
              sourceRoots: ["src"],
              query: "Where is computeTotal defined?",
              expectedFiles: ["src/app/main.ts"],
              expectedSymbols: ["computeTotal"],
              rawIncludeGlobs: ["src/**/*"]
            }
          ]
        }),
        "utf8"
      );
      const localConfigBefore = readFileSync(localConfigPath, "utf8");
      const localTargetBefore = await snapshotDirectory(localTarget);
      const localStatusBefore = localGit("status", "--porcelain=v1", "--ignored");
      const localHeadBefore = localGit("rev-parse", "HEAD").trim();
      const localArgs = (extra) => ["experiment", "run", "--experiment", SCALING_ID, ...extra];

      // Installed-package negative boundary cases: every one must exit nonzero, create no output and leave the target untouched.
      const unsafeInside = path.join(localTarget, "lab-out");
      const plainDirectory = path.join(localArea, "plain directory");
      mkdirSync(plainDirectory, { recursive: true });
      const dummySyntheticConfig = path.join(localArea, "dummy synthetic.json");
      writeFileSync(dummySyntheticConfig, "{}", "utf8");
      const negativeCases = [
        ["out-equals-target", ["--target", localTarget, "--local-subject-config", localConfigPath, "--out", localTarget], null],
        ["out-inside-target", ["--target", localTarget, "--local-subject-config", localConfigPath, "--out", unsafeInside], unsafeInside],
        ["missing-local-subject-config", ["--target", localTarget, "--out", localOut], localOut],
        ["config-without-external-target", ["--local-subject-config", localConfigPath, "--out", localOut], localOut],
        ["synthetic-and-local-subject", ["--synthetic-config", dummySyntheticConfig, "--local-subject-config", localConfigPath, "--out", localOut], localOut],
        ["synthetic-with-target", ["--target", localTarget, "--synthetic-config", dummySyntheticConfig, "--out", localOut], localOut],
        ["non-worktree-root-target", ["--target", path.join(localTarget, "src"), "--local-subject-config", localConfigPath, "--out", localOut], localOut],
        ["non-git-target", ["--target", plainDirectory, "--local-subject-config", localConfigPath, "--out", localOut], localOut]
      ];
      for (const [label, args, mustNotExist] of negativeCases) {
        const result = runInstalledCli(cliCommand, dirs.consumer, localArgs([...args, "--kit-command", realKitCommand]), envWithBin);
        if (result.status === 0) fail(gate, `Installed negative case ${label} exited 0.`, describeChildResult(result));
        if (mustNotExist && existsSync(mustNotExist)) fail(gate, `Installed negative case ${label} created output at the rejected location.`);
        if (existsSync(path.dirname(localOut)) && readdirSync(path.dirname(localOut)).length > 0) {
          fail(gate, `Installed negative case ${label} left output beneath the Lab work root.`);
        }
        const diff = diffSnapshots(localTargetBefore, await snapshotDirectory(localTarget));
        if (diff.length > 0) fail(gate, `Installed negative case ${label} mutated the target: ${diff.join(", ")}`);
        const failureLeaks = privacyScan.scanDurableArtifactText(
          [{ name: `${label}-stderr`, text: `${result.stdout ?? ""}\n${result.stderr ?? ""}` }],
          [{ label: "target", value: localTarget, kind: "path" }, ...Object.values(LOCAL_MARKERS).map((value) => ({ label: "marker", value, kind: "text" }))]
        );
        if (failureLeaks.length > 0) fail(gate, `Installed negative case ${label} printed a private value: ${JSON.stringify(failureLeaks)}`);
      }
      console.log(`CONTEXT_WINDOW_SCALING_LOCAL_SUBJECT_REJECTIONS: PASS (${negativeCases.length} installed boundary cases: nonzero exit, no output, target unchanged)`);

      const localRun = runInstalledCli(
        cliCommand,
        dirs.consumer,
        localArgs(["--target", localTarget, "--local-subject-config", localConfigPath, "--context-budgets", "8k,16k", "--kit-command", realKitCommand, "--out", localOut]),
        envWithBin
      );
      if (localRun.status !== 0) {
        fail(gate, "Installed external-local context-window-scaling run with the real my-dev-kit did not exit 0.", describeChildResult(localRun));
      }
      assertOutputOutsidePackage(localOut, installedPackageRoot, "context-window-scaling external-local run");
      if (!path.relative(localTarget, localOut).startsWith("..")) fail(gate, "Lab output was written inside the inspected target.");
      const localExpectedFiles = ["context-window-scaling-execution.json", "local-repository-subject-manifest.json", "report.html", "report.json", "report.txt"];
      const localOutEntries = readdirSync(localOut).sort();
      if (JSON.stringify(localOutEntries) !== JSON.stringify(localExpectedFiles)) {
        fail(gate, `External-local output is not exactly the durable artifact set (scratch not removed or extra output): ${localOutEntries.join(", ")}`);
      }
      for (const name of localExpectedFiles) requireNonEmptyFile(path.join(localOut, name), gate);
      const localArtifact = readJsonFile(path.join(localOut, "context-window-scaling-execution.json"), gate);
      const localSubjectManifest = readJsonFile(path.join(localOut, "local-repository-subject-manifest.json"), gate);
      const localReport = readJsonFile(path.join(localOut, "report.json"), gate);
      if (
        localArtifact.schemaVersion !== "my-dev-kit-lab-context-window-scaling-execution-v1" ||
        JSON.stringify(localArtifact.contextBudgets) !== JSON.stringify([8192, 16384]) ||
        localSubjectManifest.schemaId !== "my-dev-kit-lab-local-repository-subject-manifest-v1" ||
        localSubjectManifest.subjectId !== "packed-local-subject" ||
        localSubjectManifest.repository?.commit !== localHeadBefore ||
        localReport.report?.plugin?.id !== SCALING_ID ||
        localReport.report?.target?.kind !== "external-local" ||
        localReport.report?.target?.privacyProjection !== "external-local-redacted"
      ) {
        fail(gate, "Installed external-local artifacts do not carry the expected schema, subject identity, Git commit and privacy projection.");
      }
      const localTreatments = localArtifact.cases?.[0]?.treatments ?? [];
      if (JSON.stringify(localTreatments.map((treatment) => treatment.variantId)) !== JSON.stringify(["raw-full-file", "my-dev-kit-guided"])) {
        fail(gate, "Installed external-local run did not execute exactly the raw and guided treatments.");
      }
      for (const treatment of localTreatments) {
        if (treatment.status === "failed" || treatment.context?.status !== "available" || treatment.budgetCells?.length !== 2) {
          fail(gate, `Treatment ${treatment.variantId} did not produce available context and two budget cells (status=${treatment.status}).`);
        }
      }
      const redactionProblems = privacyScan.checkRedactionTruthfulness(localArtifact);
      if (redactionProblems.length > 0) fail(gate, `External-local redaction is not truthful: ${redactionProblems.join("; ")}`);
      const localSentinels = [
        ...[localTarget, localArea, path.dirname(localConfigPath), localOut, path.dirname(localOut), dirs.workspace, dirs.consumer, dirs.upstream, installedPackageRoot, tempRoot, os.tmpdir(), os.homedir(), REPO_ROOT].map(
          (value) => ({ label: "private path", value, kind: "path" })
        ),
        ...Object.entries(LOCAL_MARKERS).map(([label, value]) => ({ label: `marker ${label}`, value, kind: "text" })),
        ...["private notes.ts", "huge file.ts", "gen/out", "src/app/main.ts", "helper.ts", "indexes"].map((value) => ({ label: `file ${value}`, value, kind: "text" }))
      ];
      const localLeaks = privacyScan.scanDurableOutputDirectory(localOut, localSentinels);
      if (localLeaks.length > 0) fail(gate, `Durable external-local output leaks private values: ${JSON.stringify(localLeaks)}`);
      const localTargetChanges = diffSnapshots(localTargetBefore, await snapshotDirectory(localTarget));
      if (
        localTargetChanges.length > 0 ||
        localGit("status", "--porcelain=v1", "--ignored") !== localStatusBefore ||
        localGit("rev-parse", "HEAD").trim() !== localHeadBefore ||
        readFileSync(localConfigPath, "utf8") !== localConfigBefore
      ) {
        fail(gate, `External-local run changed the target or its config: ${localTargetChanges.join(", ")}`);
      }
      for (const forbidden of [".my-dev-kit", ".my-dev-kit-lab", "lab-output", "lab-out"]) {
        if (existsSync(path.join(localTarget, forbidden))) fail(gate, `Lab artifacts appeared inside the target: ${forbidden}`);
      }
      console.log(`CONTEXT_WINDOW_SCALING_LOCAL_SUBJECT_RUN: PASS (installed bin; real ${UPSTREAM_MY_DEV_KIT_SPEC}; raw + guided; space-containing target/config/output; output path length ${localOut.length})`);
      console.log("CONTEXT_WINDOW_SCALING_LOCAL_SUBJECT_PRIVACY: PASS (raw, separator, JSON-escaped and HTML-escaped path forms; markers; ignored/oversized names; redaction truthful)");
      console.log("CONTEXT_WINDOW_SCALING_LOCAL_SUBJECT_IMMUTABILITY: PASS (target tree, Git status/HEAD and config unchanged; scratch removed; no Lab output in target)");
    }

    // -----------------------------------------------------------------
    // 9c-2b. v0.8.1 retrieval-query-strategy-comparison installed-package
    // acceptance. Discovery, a bundled run and the full external-local safety
    // matrix use the deterministic upstream-shaped fake my-dev-kit copied from
    // the repository test fixtures at verification time (never packaged, no
    // network). The SUCCESSFUL external-local compatibility proof uses the REAL
    // published upstream my-dev-kit installed above (realKitCommand), never the
    // fake. No retrieval-quality threshold is asserted; valid measurements or
    // truthful partial evidence are both acceptable.
    // -----------------------------------------------------------------
    {
      const gate = "RETRIEVAL_QUERY_STRATEGY_COMPARISON";
      const RQS_ID = "retrieval-query-strategy-comparison";
      const RQS_OUTPUTS = ["json", "html", "text", "artifact"];
      const RQS_STRATEGIES = ["keyword-search", "symbol-lookup", "graph-neighborhood", "source-slice", "data-model-graph", "model-view-lineage", "combined-graph-guided"];
      const RQS_SCOPES = ["overall", "localized", "cross-module", "broad-change"];
      const RQS_EXECUTION_FILE = "retrieval-query-strategy-comparison-execution.json";
      const RQS_ANALYSIS_FILE = "retrieval-query-strategy-comparison-analysis.json";
      const RQS_DURABLE_FAMILY = ["local-repository-subject-manifest.json", "report.html", "report.json", "report.txt", RQS_ANALYSIS_FILE, RQS_EXECUTION_FILE];
      const RQS_BUNDLED_FAMILY = [RQS_EXECUTION_FILE, RQS_ANALYSIS_FILE, "report.json", "report.html", "report.txt"];
      const privacyScan = await loadPrivacyScan();

      // --- Discovery ---
      const rqsListed = knownExperiments.filter((entry) => entry.id === RQS_ID);
      if (
        rqsListed.length !== 1 ||
        rqsListed[0].status !== "experimental" ||
        rqsListed[0].schemaVersion !== "1.0.0" ||
        JSON.stringify(rqsListed[0].supportedVariants) !== JSON.stringify(RQS_STRATEGIES) ||
        JSON.stringify(rqsListed[0].supportedOutputs) !== JSON.stringify(RQS_OUTPUTS) ||
        JSON.stringify(rqsListed[0].supportedTargets) !== JSON.stringify(["self", "external-local"])
      ) {
        fail(`${gate}_DISCOVERY`, `Installed experiment list lacks the expected ${RQS_ID} entry: ${JSON.stringify(rqsListed)}`);
      }
      const rqsDescribeResult = runInstalledCli(cliCommand, dirs.consumer, ["experiment", "describe", "--experiment", RQS_ID, "--json"], envWithBin);
      if (rqsDescribeResult.status !== 0) fail(`${gate}_DISCOVERY`, `Installed experiment describe for ${RQS_ID} did not exit 0.`, describeChildResult(rqsDescribeResult));
      const rqsDescribed = parseJsonOutput(rqsDescribeResult, `${gate}_DISCOVERY`);
      if (
        rqsDescribed.metadata?.id !== RQS_ID ||
        rqsDescribed.metadata?.status !== "experimental" ||
        rqsDescribed.metadata?.schemaVersion !== "1.0.0" ||
        JSON.stringify(rqsDescribed.metadata?.supportedTargets) !== JSON.stringify(["self", "external-local"]) ||
        JSON.stringify(rqsDescribed.metadata?.supportedOutputs) !== JSON.stringify(RQS_OUTPUTS) ||
        JSON.stringify(rqsDescribed.supportedVariants) !== JSON.stringify(RQS_STRATEGIES) ||
        JSON.stringify((rqsDescribed.requiredConfigFields ?? []).map((field) => field.name)) !== JSON.stringify(["outDir"]) ||
        JSON.stringify((rqsDescribed.optionalConfigFields ?? []).map((field) => field.name)) !== JSON.stringify(["kitCommand", "caseIds", "benchmarkProjects"]) ||
        JSON.stringify(rqsDescribed).includes('"strategies"')
      ) {
        fail(`${gate}_DISCOVERY`, `Installed describe output is not the expected ${RQS_ID} contract: ${rqsDescribeResult.stdout}`);
      }
      console.log("RETRIEVAL_QUERY_STRATEGY_COMPARISON_DISCOVERY: PASS (installed list and describe: experimental, 1.0.0, self + external-local, json/html/text/artifact, seven strategies, closed config without a strategy option)");

      if (path.resolve(dirs.consumer) === path.resolve(installedPackageRoot) || path.resolve(dirs.consumer) === REPO_ROOT) {
        fail(`${gate}_RESOURCE_RESOLUTION`, "The consumer working directory must differ from the installed package root and the source checkout.");
      }
      const rqsKitScript = path.join(dirs.fakeKit, "fake-upstream-shaped-kit-rqs.mjs");
      writeFileSync(rqsKitScript, readFileSync(path.join(REPO_ROOT, "tests", "fixtures", "fake-upstream-shaped-kit-cli.js"), "utf8"), "utf8");
      const rqsKitCommand = `"${process.execPath}" "${rqsKitScript}"`;
      const RQS_MARKERS = {
        source: "PACKED_RQS_SOURCE_BODY_MARKER_2e61",
        stdout: "PACKED_RQS_RAW_STDOUT_MARKER_90ad",
        stderr: "PACKED_RQS_RAW_STDERR_MARKER_f4b7",
        title: "PACKED RQS PRIVATE TITLE MARKER",
        titleTwo: "PACKED RQS SECOND PRIVATE TITLE MARKER",
        symbol: "PackedRqsPrivateModelAlpha",
        symbolTwo: "formatPackedRqsPrivateBeta",
        fact: "packed-rqs-private-fact-one",
        factTwo: "packed-rqs-private-fact-two",
        factThree: "packed-rqs-private-fact-three"
      };
      const rqsKitEnv = (extra = {}) => ({
        ...envWithBin,
        RPR_KIT_SOURCE_TEXT: RQS_MARKERS.source,
        RPR_KIT_STDOUT_TEXT: RQS_MARKERS.stdout,
        RPR_KIT_STDERR_TEXT: RQS_MARKERS.stderr,
        ...extra
      });
      const rqsReadKitCalls = (logFile) =>
        existsSync(logFile)
          ? readFileSync(logFile, "utf8")
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line))
          : [];
      const rqsForbiddenPropertyNames = ["score", "compositeScore", "winnerScore", "rank", "ranking"];
      const rqsCollectPropertyNames = (value, into = new Set()) => {
        if (Array.isArray(value)) value.forEach((entry) => rqsCollectPropertyNames(entry, into));
        else if (value !== null && typeof value === "object") {
          for (const [key, child] of Object.entries(value)) {
            into.add(key);
            rqsCollectPropertyNames(child, into);
          }
        }
        return into;
      };

      // --- Bundled run over the packaged corpus: one case, seven treatments, semantic data-model commands ---
      const rqsBundledOut = path.join(dirs.workspace, "rqs-bundled", "run");
      const rqsBundledLog = path.join(tempRoot, "rqs-bundled-kit.log");
      const rqsBundledRun = runInstalledCli(
        cliCommand,
        dirs.consumer,
        ["experiment", "run", "--experiment", RQS_ID, "--case", "warm-medium-complete-idempotent", "--kit-command", rqsKitCommand, "--out", rqsBundledOut],
        rqsKitEnv({
          RPR_KIT_LOG: rqsBundledLog,
          RPR_KIT_FILES: "src/services/completeTask.ts,src/store/taskStore.ts",
          RPR_KIT_SYMBOLS: "completeTask@src/services/completeTask.ts",
          RPR_KIT_DATA_MODEL_ENTITY: "task"
        })
      );
      if (rqsBundledRun.status !== 0) fail(`${gate}_BUNDLED`, `Installed bundled ${RQS_ID} run did not exit 0.`, describeChildResult(rqsBundledRun));
      assertOutputOutsidePackage(rqsBundledOut, installedPackageRoot, `${RQS_ID} bundled run`);
      for (const name of RQS_BUNDLED_FAMILY) requireNonEmptyFile(path.join(rqsBundledOut, name), `${gate}_BUNDLED`);
      const rqsBundledExecution = readJsonFile(path.join(rqsBundledOut, RQS_EXECUTION_FILE), `${gate}_BUNDLED`);
      const rqsBundledAnalysis = readJsonFile(path.join(rqsBundledOut, RQS_ANALYSIS_FILE), `${gate}_BUNDLED`);
      const rqsBundledReport = readJsonFile(path.join(rqsBundledOut, "report.json"), `${gate}_BUNDLED`);
      if (
        rqsBundledExecution.schemaVersion !== "my-dev-kit-lab-retrieval-query-strategy-comparison-execution-v1" ||
        rqsBundledExecution.cases?.length !== 1 ||
        rqsBundledExecution.cases[0].caseId !== "warm-medium-complete-idempotent" ||
        JSON.stringify(rqsBundledExecution.cases[0].treatments?.map((treatment) => treatment.strategyId)) !== JSON.stringify(RQS_STRATEGIES) ||
        rqsBundledExecution.cases[0].identityRedaction !== undefined ||
        Object.keys(rqsBundledExecution).includes("analysis")
      ) {
        fail(`${gate}_BUNDLED`, `Installed bundled execution artifact is not the expected execution-only, seven-treatment, unredacted evidence: ${JSON.stringify(rqsBundledExecution.cases?.[0])?.slice(0, 500)}`);
      }
      const rqsOverall = rqsBundledAnalysis.analysis?.scopes?.[0];
      if (
        rqsBundledAnalysis.schemaVersion !== "my-dev-kit-lab-retrieval-query-strategy-comparison-analysis-v1" ||
        JSON.stringify(rqsBundledAnalysis.analysis?.scopes?.map((scope) => scope.scopeId)) !== JSON.stringify(RQS_SCOPES) ||
        rqsOverall?.comparisonCaseCount !== 1 ||
        JSON.stringify(rqsOverall?.strategySummaries?.map((summary) => summary.strategyId)) !== JSON.stringify(RQS_STRATEGIES) ||
        rqsBundledAnalysis.methodology?.aggregation !== "matched-complete-case-macro-mean" ||
        rqsBundledAnalysis.methodology?.fileF1 !== "balanced-f1" ||
        rqsBundledAnalysis.methodology?.multiObjectiveComparison !== "pareto-dominance" ||
        rqsBundledAnalysis.methodology?.uniqueBestRule !== "single-member-pareto-front"
      ) {
        fail(`${gate}_BUNDLED`, `Installed bundled analysis artifact is not the expected four-scope, one-matched-case, Pareto analysis: ${JSON.stringify(rqsOverall)?.slice(0, 500)}`);
      }
      const rqsPropertyNames = rqsCollectPropertyNames(rqsBundledAnalysis);
      for (const forbidden of rqsForbiddenPropertyNames) {
        if (rqsPropertyNames.has(forbidden)) fail(`${gate}_BUNDLED`, `Installed analysis artifact carries a composite score or ranking property: ${forbidden}`);
      }
      const rqsCalls = rqsReadKitCalls(rqsBundledLog);
      if (rqsCalls.filter((call) => call.argv[0] === "index").length !== 1) {
        fail(`${gate}_BUNDLED`, "The bundled run did not build exactly one index for the one selected benchmark project.");
      }
      if (rqsCalls.filter((call) => call.argv[0] === "data-model").length === 0) {
        fail(`${gate}_BUNDLED`, "The bundled run did not execute the semantic data-model treatments.");
      }
      const rqsBundledSerialized = RQS_BUNDLED_FAMILY.map((name) => readFileSync(path.join(rqsBundledOut, name), "utf8")).join("\n");
      for (const marker of [RQS_MARKERS.source, RQS_MARKERS.stdout, RQS_MARKERS.stderr]) {
        if (rqsBundledSerialized.includes(marker)) fail(`${gate}_BUNDLED`, "Installed bundled output serialized raw source, stdout or stderr marker text.");
      }
      console.log("RETRIEVAL_QUERY_STRATEGY_COMPARISON_BUNDLED: PASS (installed bin; packaged corpus and profiles; offline upstream-shaped kit; one index, seven ordered treatments, semantic data-model commands; execution and analysis artifacts separate; no composite score or ranking)");

      const rqsReportSection = rqsBundledReport.report?.retrievalQueryStrategyComparison;
      const rqsHtml = readFileSync(path.join(rqsBundledOut, "report.html"), "utf8");
      const rqsText = readFileSync(path.join(rqsBundledOut, "report.txt"), "utf8");
      if (
        rqsReportSection?.schemaVersion !== "my-dev-kit-lab-retrieval-query-strategy-comparison-report-v1" ||
        JSON.stringify(rqsReportSection?.scopes?.map((scope) => scope.scopeId)) !== JSON.stringify(RQS_SCOPES) ||
        !rqsReportSection?.scopes?.some((scope) => scope.scopeId === "localized") ||
        rqsReportSection?.methodology?.aggregation !== "matched-complete-case-macro-mean" ||
        !Array.isArray(rqsReportSection?.scopes?.[0]?.paretoFrontStrategyIds) ||
        rqsReportSection?.cases?.[0]?.treatments?.length !== 7 ||
        rqsReportSection?.cases?.[0]?.treatments?.[0]?.fileF1 === undefined ||
        rqsReportSection?.identityRedaction !== null ||
        Object.keys(rqsBundledReport.report?.rawRun ?? {}).includes("analysis") ||
        Object.keys(rqsBundledReport.report?.rawRun ?? {}).includes("caseExecutionEvidence")
      ) {
        fail(`${gate}_REPORT`, `Installed report.json lacks the expected typed retrieval-query-strategy-comparison section: ${JSON.stringify(rqsReportSection)?.slice(0, 400)}`);
      }
      for (const [label, output] of [["report.html", rqsHtml], ["report.txt", rqsText]]) {
        for (const required of ["Retrieval Query Strategy Comparison", "Task-Type Comparison", "localized", "Pareto"]) {
          if (!output.includes(required)) fail(`${gate}_REPORT`, `Installed ${label} does not contain "${required}".`);
        }
      }
      console.log("RETRIEVAL_QUERY_STRATEGY_COMPARISON_REPORT: PASS (installed report.json typed section, report.html and report.txt: four task-type scopes, methodology, Pareto data, per-case treatment metrics)");

      // --- External-local: one disposable Git repository outside the installed package ---
      const RQS_LOCAL = {
        eligible: "PACKED_RQS_ELIGIBLE_MARKER_8a3c",
        ignoredFile: "PACKED_RQS_IGNORED_MARKER_5d19",
        ignoredDirectory: "PACKED_RQS_IGNORED_DIR_MARKER_b620",
        oversized: "PACKED_RQS_OVERSIZED_MARKER_0f77"
      };
      const rqsArea = path.join(tempRoot, "rqs local subject area");
      const rqsTarget = path.join(rqsArea, "target repo", "inner project");
      const rqsConfigPath = path.join(rqsArea, "config dir", "local subject.json");
      const rqsLog = path.join(tempRoot, "rqs-local-kit.log");
      const rqsGitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
      for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]) delete rqsGitEnv[key];
      const rqsGit = (...args) => {
        const result = spawnSync("git", ["-c", "user.name=Packed Gate", "-c", "user.email=packed-gate@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: rqsTarget, encoding: "utf8", env: rqsGitEnv });
        if (result.status !== 0) fail(gate, `git ${args[0]} failed while preparing the disposable retrieval subject.`, describeChildResult(result));
        return result.stdout;
      };
      const rqsWrite = (relative, content) => {
        const absolute = path.join(rqsTarget, ...relative.split("/"));
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, content, "utf8");
      };
      mkdirSync(rqsTarget, { recursive: true });
      rqsGit("init", "-q", "-b", "main");
      rqsWrite(".gitignore", "src/private notes.ts\nsrc/gen/\n");
      rqsWrite(
        "src/app/taskModel.ts",
        `export interface ${RQS_MARKERS.symbol} {\n  id: string;\n  title: string;\n  done: boolean;\n}\n\nexport function createPackedRqsTask(title: string): ${RQS_MARKERS.symbol} {\n  return { id: "${RQS_LOCAL.eligible}", title, done: false };\n}\n`
      );
      rqsWrite(
        "src/app/util/format.ts",
        `import type { ${RQS_MARKERS.symbol} } from "../taskModel";\n\nexport function ${RQS_MARKERS.symbolTwo}(task: ${RQS_MARKERS.symbol}): string {\n  return task.title + ":" + String(task.done);\n}\n`
      );
      rqsWrite("src/huge file.ts", `// ${RQS_LOCAL.oversized}\n${"x".repeat(1_048_576 + 100)}\n`);
      rqsGit("add", "-A");
      rqsGit("commit", "-q", "-m", "packed fixture");
      rqsWrite("src/private notes.ts", `export const privateNotes = 1; // ${RQS_LOCAL.ignoredFile}\n`);
      rqsWrite("src/gen/out.ts", `export const generated = 1; // ${RQS_LOCAL.ignoredDirectory}\n`);
      const rqsAnswerKey = (files, symbols, facts, targets) => ({
        expectedFiles: files,
        expectedSymbols: symbols,
        expectedFacts: facts.map((id) => ({ id, text: "private fact text that is never persisted", weight: 1, required: true })),
        expectedContextTargets: targets,
        minimumCorrectFacts: 1
      });
      mkdirSync(path.dirname(rqsConfigPath), { recursive: true });
      writeFileSync(
        rqsConfigPath,
        JSON.stringify({
          schemaVersion: "1.0.0",
          subjectId: "packed-rqs-subject",
          cases: [
            {
              id: "packed-rqs-case-one",
              title: RQS_MARKERS.title,
              sourceRoots: ["src"],
              query: `Where are ${RQS_MARKERS.symbol} and ${RQS_MARKERS.symbolTwo} defined?`,
              expectedFiles: ["src/app/taskModel.ts", "src/app/util/format.ts"],
              expectedSymbols: [RQS_MARKERS.symbol, RQS_MARKERS.symbolTwo],
              rawIncludeGlobs: ["src/**/*"],
              taskLocality: "cross-module",
              answerKey: rqsAnswerKey(
                ["src/app/taskModel.ts", "src/app/util/format.ts"],
                [RQS_MARKERS.symbol, RQS_MARKERS.symbolTwo],
                [RQS_MARKERS.fact, RQS_MARKERS.factTwo],
                [
                  { file: "src/app/taskModel.ts", symbols: [RQS_MARKERS.symbol], required: true, factIds: [RQS_MARKERS.fact] },
                  { file: "src/app/util/format.ts", symbols: [RQS_MARKERS.symbolTwo], required: true, factIds: [RQS_MARKERS.factTwo] }
                ]
              )
            },
            {
              id: "packed-rqs-case-two",
              title: RQS_MARKERS.titleTwo,
              sourceRoots: ["src/app/util"],
              query: `Where is ${RQS_MARKERS.symbolTwo} defined?`,
              expectedFiles: ["src/app/util/format.ts"],
              expectedSymbols: [RQS_MARKERS.symbolTwo],
              rawIncludeGlobs: ["src/app/util/**/*"],
              taskLocality: "localized",
              answerKey: rqsAnswerKey(
                ["src/app/util/format.ts"],
                [RQS_MARKERS.symbolTwo],
                [RQS_MARKERS.factThree],
                [{ file: "src/app/util/format.ts", symbols: [RQS_MARKERS.symbolTwo], required: true, factIds: [RQS_MARKERS.factThree] }]
              )
            }
          ]
        }),
        "utf8"
      );
      const rqsConfigBefore = readFileSync(rqsConfigPath, "utf8");
      const rqsTargetBefore = await snapshotDirectory(rqsTarget);
      const rqsStatusBefore = rqsGit("status", "--porcelain=v1", "--ignored");
      const rqsHeadBefore = rqsGit("rev-parse", "HEAD").trim();
      const rqsRunArgs = (extra) => ["experiment", "run", "--experiment", RQS_ID, ...extra];
      const rqsLocalEnv = (extra = {}) =>
        rqsKitEnv({
          RPR_KIT_LOG: rqsLog,
          RPR_KIT_FILES: "src/app/taskModel.ts,src/app/util/format.ts",
          RPR_KIT_SYMBOLS: `${RQS_MARKERS.symbol}@src/app/taskModel.ts`,
          RPR_KIT_DATA_MODEL_ENTITY: RQS_MARKERS.symbol,
          ...extra
        });
      const rqsOut = path.join(dirs.workspace, "rqs local out", "run");
      const rqsRealOut = path.join(dirs.workspace, "rqs real out", "run");
      const rqsSentinels = [
        ...[rqsTarget, rqsArea, path.dirname(rqsConfigPath), rqsOut, path.dirname(rqsOut), rqsRealOut, path.dirname(rqsRealOut), dirs.workspace, dirs.consumer, dirs.fakeKit, installedPackageRoot, tempRoot, os.tmpdir(), os.homedir(), REPO_ROOT].map(
          (value) => ({ label: "private path", value, kind: "path" })
        ),
        ...Object.entries({ ...RQS_MARKERS, ...RQS_LOCAL }).map(([label, value]) => ({ label: `marker ${label}`, value, kind: "text" })),
        ...["private notes.ts", "huge file.ts", "gen/out", "src/app/taskModel.ts", "src/app/util/format.ts", "taskModel.ts", "format.ts", "inner project", "target repo", "fake-upstream-shaped-kit"].map((value) => ({ label: `name ${value}`, value, kind: "text" }))
      ];
      const expectRqsTargetUntouched = async (label) => {
        const diff = diffSnapshots(rqsTargetBefore, await snapshotDirectory(rqsTarget));
        if (diff.length > 0) fail(`${gate}_IMMUTABILITY`, `${label} mutated the target: ${diff.join(", ")}`);
        if (rqsGit("status", "--porcelain=v1", "--ignored") !== rqsStatusBefore || rqsGit("rev-parse", "HEAD").trim() !== rqsHeadBefore || readFileSync(rqsConfigPath, "utf8") !== rqsConfigBefore) {
          fail(`${gate}_IMMUTABILITY`, `${label} changed the target Git state or its config.`);
        }
      };

      // Mode-matrix rejections and output-boundary rejections: nonzero, no output, no my-dev-kit call, target untouched.
      const rqsUnsafeInside = path.join(rqsTarget, "lab-out");
      const rqsNegativeCases = [
        ["target-without-config", ["--target", rqsTarget, "--out", rqsOut]],
        ["config-without-target", ["--local-subject-config", rqsConfigPath, "--out", rqsOut]],
        ["case-in-external-mode", ["--target", rqsTarget, "--local-subject-config", rqsConfigPath, "--case", "packed-rqs-case-one", "--out", rqsOut]],
        ["benchmark-project-in-external-mode", ["--target", rqsTarget, "--local-subject-config", rqsConfigPath, "--benchmark-project", "packed-rqs-subject", "--out", rqsOut]],
        ["output-inside-target", ["--target", rqsTarget, "--local-subject-config", rqsConfigPath, "--out", rqsUnsafeInside]],
        ["output-equals-target", ["--target", rqsTarget, "--local-subject-config", rqsConfigPath, "--out", rqsTarget]]
      ];
      for (const [label, args] of rqsNegativeCases) {
        const result = runInstalledCli(cliCommand, dirs.consumer, rqsRunArgs([...args, "--kit-command", rqsKitCommand]), rqsLocalEnv());
        if (result.status === 0) fail(`${gate}_EXTERNAL_REJECTIONS`, `Installed negative case ${label} exited 0.`, describeChildResult(result));
        if (existsSync(rqsUnsafeInside) || (existsSync(path.dirname(rqsOut)) && readdirSync(path.dirname(rqsOut)).length > 0)) {
          fail(`${gate}_EXTERNAL_REJECTIONS`, `Installed negative case ${label} created output.`);
        }
        const consoleLeaks = privacyScan.scanDurableArtifactText(
          [{ name: `${label}-console`, text: `${result.stdout ?? ""}\n${result.stderr ?? ""}` }],
          rqsSentinels
            .filter((sentinel) => sentinel.kind === "path" && sentinel.value !== os.tmpdir() && sentinel.value !== os.homedir() && sentinel.value !== tempRoot && sentinel.value !== REPO_ROOT && sentinel.value !== dirs.workspace)
            .concat(rqsSentinels.filter((sentinel) => sentinel.kind === "text" && sentinel.label.startsWith("marker")))
        );
        if (consoleLeaks.length > 0) fail(`${gate}_EXTERNAL_REJECTIONS`, `Installed negative case ${label} printed a private value: ${JSON.stringify(consoleLeaks)}`);
        await expectRqsTargetUntouched(`Installed negative case ${label}`);
      }
      if (rqsReadKitCalls(rqsLog).length > 0) fail(`${gate}_EXTERNAL_REJECTIONS`, "A rejected installed run still invoked my-dev-kit.");
      console.log(`RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXTERNAL_REJECTIONS: PASS (${rqsNegativeCases.length} installed boundary cases: nonzero exit, no output, no my-dev-kit call, target unchanged)`);

      // Installed failure path (deterministic fake kit): an unsafe retrieved identity must fail closed with no durable family.
      const rqsFailureOut = path.join(dirs.workspace, "rqs local failure out", "run");
      const rqsFailure = runInstalledCli(
        cliCommand,
        dirs.consumer,
        rqsRunArgs(["--target", rqsTarget, "--local-subject-config", rqsConfigPath, "--kit-command", rqsKitCommand, "--out", rqsFailureOut]),
        rqsLocalEnv({ RPR_KIT_FILES: "src/private notes.ts" })
      );
      if (rqsFailure.status === 0) fail(`${gate}_EXTERNAL_FAILURE`, "Installed run that retrieved an ignored file exited 0.", describeChildResult(rqsFailure));
      const rqsFailureText = `${rqsFailure.stdout ?? ""}\n${rqsFailure.stderr ?? ""}`;
      if (!rqsFailureText.includes("RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE") || !rqsFailureText.includes("Status: failed")) {
        fail(`${gate}_EXTERNAL_FAILURE`, "Installed unsafe-identity failure did not report the bounded safe code.", describeChildResult(rqsFailure));
      }
      for (const forbidden of ["private notes", rqsTarget, rqsArea, ...Object.values(RQS_LOCAL), ...Object.values(RQS_MARKERS)]) {
        if (rqsFailureText.includes(forbidden)) fail(`${gate}_EXTERNAL_FAILURE`, `Installed failure output contains a private value (${forbidden.length > 40 ? `${forbidden.slice(0, 20)}...` : forbidden}).`);
      }
      if (existsSync(rqsFailureOut) && readdirSync(rqsFailureOut).length > 0) {
        fail(`${gate}_EXTERNAL_FAILURE`, `Installed failure wrote files to the output directory: ${readdirSync(rqsFailureOut).join(", ")}`);
      }
      await expectRqsTargetUntouched("Installed unsafe-identity failure");
      console.log("RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXTERNAL_FAILURE: PASS (installed bin; unsafe retrieved identity: nonzero, bounded safe code, no durable family, target unchanged)");

      // Installed external-local success with the deterministic fake kit: observable index/exclusion/scratch behavior.
      writeFileSync(rqsLog, "", "utf8");
      const rqsFakeRun = runInstalledCli(
        cliCommand,
        dirs.consumer,
        rqsRunArgs(["--target", rqsTarget, "--local-subject-config", rqsConfigPath, "--kit-command", rqsKitCommand, "--out", rqsOut]),
        rqsLocalEnv()
      );
      if (rqsFakeRun.status !== 0) fail(`${gate}_EXTERNAL`, "Installed external-local run with the deterministic kit did not exit 0.", describeChildResult(rqsFakeRun));
      assertOutputOutsidePackage(rqsOut, installedPackageRoot, `${RQS_ID} external-local fake-kit run`);
      const rqsFakeEntries = readdirSync(rqsOut).sort();
      if (JSON.stringify(rqsFakeEntries) !== JSON.stringify(RQS_DURABLE_FAMILY)) {
        fail(`${gate}_EXTERNAL`, `External-local output is not exactly the approved durable family (scratch, index or command files remained): ${rqsFakeEntries.join(", ")}`);
      }
      const rqsPhysicalOut = realpathSync.native(rqsOut);
      const rqsIndexCalls = rqsReadKitCalls(rqsLog).filter((call) => call.argv[0] === "index");
      const rqsSourceRoots = rqsIndexCalls.map((call) => call.argv.flatMap((value, index) => (value === "--src" ? [call.argv[index + 1]] : [])));
      if (rqsIndexCalls.length !== 2 || JSON.stringify(rqsSourceRoots) !== JSON.stringify([["src"], ["src/app/util"]])) {
        fail(`${gate}_EXTERNAL`, `Expected one private base index per configured case with exactly that case's source roots, got ${JSON.stringify(rqsSourceRoots)}.`);
      }
      for (const call of rqsIndexCalls) {
        const excluded = call.argv.flatMap((value, index) => (value === "--exclude" ? [call.argv[index + 1]] : []));
        for (const required of ["src/gen", "src/huge file.ts", "src/private notes.ts"]) {
          if (!excluded.includes(required)) fail(`${gate}_EXTERNAL`, `A case index did not receive the exact exclusion ${required}.`);
        }
        if (call.argv.includes("--call-graph")) fail(`${gate}_EXTERNAL`, "An external-local base index requested --call-graph.");
        const indexOut = call.argv[call.argv.indexOf("--out") + 1];
        const indexSegments = segmentsBeneathRoot(rqsPhysicalOut, indexOut);
        if (indexSegments === null || indexSegments.length < 3 || !indexSegments[0].startsWith("s-") || !/^i\d+$/.test(indexSegments[1]) || indexSegments[2] !== "base") {
          fail(`${gate}_EXTERNAL`, "A case base index was not built at <scratch>/i<N>/base inside the private scratch.");
        }
        rqsSentinels.push({ label: "private index path", value: indexOut, kind: "path" }, { label: "private scratch path", value: path.dirname(path.dirname(indexOut)), kind: "path" });
      }
      const rqsDataModelCalls = rqsReadKitCalls(rqsLog).filter((call) => call.argv[0] === "data-model");
      if (rqsDataModelCalls.length === 0) fail(`${gate}_EXTERNAL`, "The external-local run did not execute the semantic data-model treatments.");
      const rqsSemanticIndexes = new Set(rqsDataModelCalls.map((call) => call.argv[call.argv.indexOf("--index") + 1]));
      if ([...rqsSemanticIndexes].some((indexPath) => !/[\\/]i\d+[\\/](base|strategies[\\/](data-model-graph|model-view-lineage))$/.test(indexPath))) {
        fail(`${gate}_EXTERNAL`, `A semantic strategy used an index outside the case base or its isolated strategy copy: ${[...rqsSemanticIndexes].join(", ")}`);
      }
      const rqsFakeLeaks = privacyScan.scanDurableOutputDirectory(rqsOut, rqsSentinels);
      if (rqsFakeLeaks.length > 0) fail(`${gate}_PRIVACY`, `Durable installed external-local output (deterministic kit) leaks private values: ${JSON.stringify(rqsFakeLeaks)}`);
      await expectRqsTargetUntouched("Installed external-local run with the deterministic kit");

      // --- REAL published my-dev-kit: the successful external-local compatibility proof ---
      if (!realKitCommand.includes(upstreamBin)) {
        fail(`${gate}_REAL_MY_DEV_KIT`, `Kit command is not the installed real published upstream binary: ${realKitCommand}`);
      }
      const rqsRealRun = runInstalledCli(
        cliCommand,
        dirs.consumer,
        rqsRunArgs(["--target", rqsTarget, "--local-subject-config", rqsConfigPath, "--kit-command", realKitCommand, "--out", rqsRealOut]),
        envWithBin
      );
      if (rqsRealRun.status !== 0) fail(`${gate}_REAL_MY_DEV_KIT`, `Installed external-local run with the real ${UPSTREAM_MY_DEV_KIT_SPEC} did not exit 0.`, describeChildResult(rqsRealRun));
      assertOutputOutsidePackage(rqsRealOut, installedPackageRoot, `${RQS_ID} external-local real-kit run`);
      if (!path.relative(rqsTarget, rqsRealOut).startsWith("..")) fail(`${gate}_EXTERNAL`, "Lab output was written inside the inspected target.");
      const rqsRealEntries = readdirSync(rqsRealOut).sort();
      if (JSON.stringify(rqsRealEntries) !== JSON.stringify(RQS_DURABLE_FAMILY)) {
        fail(`${gate}_REAL_MY_DEV_KIT`, `Real-kit external-local output is not exactly the approved durable family: ${rqsRealEntries.join(", ")}`);
      }
      for (const name of RQS_DURABLE_FAMILY) requireNonEmptyFile(path.join(rqsRealOut, name), `${gate}_REAL_MY_DEV_KIT`);
      const rqsRealExecution = readJsonFile(path.join(rqsRealOut, RQS_EXECUTION_FILE), `${gate}_REAL_MY_DEV_KIT`);
      const rqsRealAnalysis = readJsonFile(path.join(rqsRealOut, RQS_ANALYSIS_FILE), `${gate}_REAL_MY_DEV_KIT`);
      const rqsRealManifest = readJsonFile(path.join(rqsRealOut, "local-repository-subject-manifest.json"), `${gate}_REAL_MY_DEV_KIT`);
      const rqsRealReport = readJsonFile(path.join(rqsRealOut, "report.json"), `${gate}_REAL_MY_DEV_KIT`);
      const rqsRealSection = rqsRealReport.report?.retrievalQueryStrategyComparison;
      if (
        rqsRealExecution.schemaVersion !== "my-dev-kit-lab-retrieval-query-strategy-comparison-execution-v1" ||
        JSON.stringify(rqsRealExecution.cases?.map((entry) => entry.caseId)) !== JSON.stringify(["packed-rqs-case-one", "packed-rqs-case-two"]) ||
        rqsRealExecution.cases?.some((entry) => JSON.stringify(entry.treatments?.map((treatment) => treatment.strategyId)) !== JSON.stringify(RQS_STRATEGIES) || entry.caseName !== "<redacted case title>" || entry.identityRedaction?.semanticNodeIds !== "redacted") ||
        rqsRealAnalysis.schemaVersion !== "my-dev-kit-lab-retrieval-query-strategy-comparison-analysis-v1" ||
        JSON.stringify(rqsRealAnalysis.analysis?.scopes?.map((scope) => scope.scopeId)) !== JSON.stringify(RQS_SCOPES) ||
        rqsRealAnalysis.analysis?.scopes?.[0]?.caseCount !== 2 ||
        rqsRealAnalysis.analysis?.scopes?.[1]?.caseCount !== 1 ||
        rqsRealAnalysis.analysis?.scopes?.[2]?.caseCount !== 1 ||
        rqsRealManifest.schemaId !== "my-dev-kit-lab-local-repository-subject-manifest-v1" ||
        rqsRealManifest.subjectId !== "packed-rqs-subject" ||
        rqsRealManifest.repository?.commit !== rqsHeadBefore ||
        rqsRealReport.report?.plugin?.id !== RQS_ID ||
        rqsRealReport.report?.target?.kind !== "external-local" ||
        rqsRealReport.report?.target?.targetRoot !== "local-repository:packed-rqs-subject" ||
        rqsRealReport.report?.target?.toolRoot !== "[redacted]" ||
        rqsRealReport.report?.target?.privacyProjection !== "external-local-redacted" ||
        rqsRealReport.report?.metadata?.outputRoot !== "[redacted]" ||
        rqsRealSection?.identityRedaction !== "external-local-redacted" ||
        !rqsRealSection?.cases?.flatMap((entry) => entry.treatments).some((treatment) => typeof treatment.retrievedTokenCount === "number")
      ) {
        fail(`${gate}_REAL_MY_DEV_KIT`, "Real-kit external-local artifacts do not carry the expected schemas, matched seven treatments, subject identity, Git commit, privacy projection and numeric scientific values.");
      }
      // Structural redaction proof (substring search would collide with short identifiers).
      for (const entry of rqsRealExecution.cases) {
        for (const treatment of entry.treatments) {
          for (const symbol of treatment.evidence?.symbols ?? []) {
            if (!/^<redacted symbol \d+>$/.test(symbol.name) || symbol.nodeId !== null) fail(`${gate}_PRIVACY`, "A real-kit external symbol identity or semantic node ID was not redacted.");
          }
          for (const file of treatment.evidence?.files ?? []) {
            if (!/^<redacted file \d+>$/.test(file.path)) fail(`${gate}_PRIVACY`, "A real-kit external file identity was not redacted.");
          }
        }
      }
      for (const entry of rqsRealAnalysis.analysis.cases) {
        for (const treatment of entry.treatments) {
          const quality = treatment.quality;
          if (!quality) continue;
          for (const list of [quality.symbol.relevantRetrievedSymbols, quality.symbol.irrelevantRetrievedSymbols, quality.symbol.missedSymbols]) {
            for (const item of list ?? []) if (!/^<redacted symbol \d+>$/.test(item)) fail(`${gate}_PRIVACY`, "A real-kit quality symbol identity was not redacted.");
          }
          for (const list of [quality.fact.coveredFactIds, quality.fact.uncoveredFactIds]) {
            for (const item of list ?? []) if (!/^<redacted fact \d+>$/.test(item)) fail(`${gate}_PRIVACY`, "A real-kit quality fact identity was not redacted.");
          }
        }
      }
      const rqsRealLeaks = privacyScan.scanDurableOutputDirectory(rqsRealOut, rqsSentinels);
      if (rqsRealLeaks.length > 0) fail(`${gate}_PRIVACY`, `Durable installed external-local output (real my-dev-kit) leaks private values: ${JSON.stringify(rqsRealLeaks)}`);
      await expectRqsTargetUntouched("Installed external-local run with the real my-dev-kit");
      for (const forbidden of [".my-dev-kit", ".my-dev-kit-lab", "lab-output", "lab-out"]) {
        if (existsSync(path.join(rqsTarget, forbidden))) fail(`${gate}_IMMUTABILITY`, `Lab artifacts appeared inside the target: ${forbidden}`);
      }
      console.log(`RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXTERNAL: PASS (installed bin; one private base index per case with exact roots and exclusions at <scratch>/i<N>/base; isolated semantic copies; space-containing paths; output path length ${rqsOut.length})`);
      console.log(`RETRIEVAL_QUERY_STRATEGY_COMPARISON_REAL_MY_DEV_KIT: PASS (installed bin; real ${UPSTREAM_MY_DEV_KIT_SPEC}; two cases x seven treatments; matched analysis and report written; redacted durable family)`);
      console.log("RETRIEVAL_QUERY_STRATEGY_COMPARISON_PRIVACY: PASS (raw, separator, JSON-escaped and HTML-escaped path forms; markers; file, symbol, fact, semantic-node and title identities; scratch and index paths; deterministic and real my-dev-kit outputs)");
      console.log("RETRIEVAL_QUERY_STRATEGY_COMPARISON_IMMUTABILITY: PASS (target tree, Git status/HEAD and config unchanged after rejections, failure, deterministic and real runs; scratch removed; no Lab output in target)");
    }

    // -----------------------------------------------------------------
    // 9c-5. v0.8.0 installed-package retrieval-precision-recall acceptance.
    // The INSTALLED bin proves discovery, one bundled run over the packaged
    // corpus, and an external-local run against a disposable Git repository.
    // Both use a deterministic, upstream-shaped fake my-dev-kit copied from
    // the repository test fixtures at verification time (never packaged, no
    // network), so the gate is offline and never imports the source checkout.
    // It asserts no retrieval-quality threshold.
    // -----------------------------------------------------------------
    {
      const gate = "RETRIEVAL_PRECISION_RECALL";
      const RPR_ID = "retrieval-precision-recall";
      const RPR_OUTPUTS = ["json", "html", "text", "artifact"];
      const RPR_DURABLE_FAMILY = ["local-repository-subject-manifest.json", "report.html", "report.json", "report.txt", "retrieval-precision-recall-execution.json"];
      const privacyScan = await loadPrivacyScan();

      const rprListed = knownExperiments.filter((entry) => entry.id === RPR_ID);
      if (
        rprListed.length !== 1 ||
        rprListed[0].status !== "experimental" ||
        JSON.stringify(rprListed[0].supportedVariants) !== JSON.stringify(["my-dev-kit-retrieval"]) ||
        JSON.stringify(rprListed[0].supportedOutputs) !== JSON.stringify(RPR_OUTPUTS) ||
        JSON.stringify(rprListed[0].supportedTargets) !== JSON.stringify(["self", "external-local"])
      ) {
        fail(`${gate}_DISCOVERY`, `Installed experiment list lacks the expected retrieval-precision-recall entry: ${JSON.stringify(rprListed)}`);
      }
      const rprDescribeResult = runInstalledCli(cliCommand, dirs.consumer, ["experiment", "describe", "--experiment", RPR_ID, "--json"], envWithBin);
      if (rprDescribeResult.status !== 0) fail(`${gate}_DISCOVERY`, "Installed experiment describe for retrieval-precision-recall did not exit 0.", describeChildResult(rprDescribeResult));
      const rprDescribed = parseJsonOutput(rprDescribeResult, `${gate}_DISCOVERY`);
      if (
        rprDescribed.metadata?.id !== RPR_ID ||
        rprDescribed.metadata?.status !== "experimental" ||
        rprDescribed.metadata?.schemaVersion !== "1.0.0" ||
        JSON.stringify(rprDescribed.metadata?.supportedTargets) !== JSON.stringify(["self", "external-local"]) ||
        JSON.stringify(rprDescribed.metadata?.supportedOutputs) !== JSON.stringify(RPR_OUTPUTS) ||
        JSON.stringify(rprDescribed.supportedVariants) !== JSON.stringify(["my-dev-kit-retrieval"]) ||
        JSON.stringify((rprDescribed.requiredConfigFields ?? []).map((field) => field.name)) !== JSON.stringify(["outDir"]) ||
        JSON.stringify((rprDescribed.optionalConfigFields ?? []).map((field) => field.name)) !== JSON.stringify(["kitCommand", "caseIds", "benchmarkProjects"])
      ) {
        fail(`${gate}_DISCOVERY`, `Installed describe output is not the expected retrieval-precision-recall contract: ${rprDescribeResult.stdout}`);
      }
      console.log("RETRIEVAL_PRECISION_RECALL_DISCOVERY: PASS (installed list and describe: experimental, 1.0.0, self + external-local, json/html/text/artifact, one variant, closed config)");

      if (path.resolve(dirs.consumer) === path.resolve(installedPackageRoot) || path.resolve(dirs.consumer) === REPO_ROOT) {
        fail(`${gate}_RESOURCE_RESOLUTION`, "The consumer working directory must differ from the installed package root and the source checkout.");
      }
      const rprKitScript = path.join(dirs.fakeKit, "fake-upstream-shaped-kit.mjs");
      writeFileSync(rprKitScript, readFileSync(path.join(REPO_ROOT, "tests", "fixtures", "fake-upstream-shaped-kit-cli.js"), "utf8"), "utf8");
      const rprKitCommand = `"${process.execPath}" "${rprKitScript}"`;
      const RPR_MARKERS = {
        source: "PACKED_RPR_SOURCE_BODY_MARKER_5a21",
        stdout: "PACKED_RPR_RAW_STDOUT_MARKER_c7d0",
        stderr: "PACKED_RPR_RAW_STDERR_MARKER_93be",
        title: "PACKED RPR PRIVATE TITLE MARKER",
        titleTwo: "PACKED RPR SECOND PRIVATE TITLE MARKER",
        symbol: "PackedRprPrivateSymbolAlpha",
        symbolTwo: "PackedRprPrivateSymbolBeta",
        fact: "packed-rpr-private-fact-one",
        factTwo: "packed-rpr-private-fact-two",
        factThree: "packed-rpr-private-fact-three"
      };
      const rprKitEnv = (extra = {}) => ({
        ...envWithBin,
        RPR_KIT_SOURCE_TEXT: RPR_MARKERS.source,
        RPR_KIT_STDOUT_TEXT: RPR_MARKERS.stdout,
        RPR_KIT_STDERR_TEXT: RPR_MARKERS.stderr,
        ...extra
      });
      const readKitCalls = (logFile) =>
        existsSync(logFile)
          ? readFileSync(logFile, "utf8")
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line))
          : [];

      // --- Bundled run over the packaged corpus (one case, deterministic evidence) ---
      const rprBundledOut = path.join(dirs.workspace, "rpr-bundled", "run");
      const rprBundledLog = path.join(tempRoot, "rpr-bundled-kit.log");
      const rprBundledRun = runInstalledCli(
        cliCommand,
        dirs.consumer,
        ["experiment", "run", "--experiment", RPR_ID, "--case", "warm-medium-complete-idempotent", "--kit-command", rprKitCommand, "--out", rprBundledOut],
        rprKitEnv({
          RPR_KIT_LOG: rprBundledLog,
          RPR_KIT_FILES: "src/services/completeTask.ts,src/store/taskStore.ts",
          RPR_KIT_SYMBOLS: "completeTask@src/services/completeTask.ts"
        })
      );
      if (rprBundledRun.status !== 0) fail(`${gate}_BUNDLED`, "Installed bundled retrieval-precision-recall run did not exit 0.", describeChildResult(rprBundledRun));
      assertOutputOutsidePackage(rprBundledOut, installedPackageRoot, "retrieval-precision-recall bundled run");
      for (const name of ["retrieval-precision-recall-execution.json", "report.json", "report.txt", "report.html"]) requireNonEmptyFile(path.join(rprBundledOut, name), `${gate}_BUNDLED`);
      const rprBundledArtifact = readJsonFile(path.join(rprBundledOut, "retrieval-precision-recall-execution.json"), `${gate}_BUNDLED`);
      const rprBundledReport = readJsonFile(path.join(rprBundledOut, "report.json"), `${gate}_BUNDLED`);
      const bundledCase = rprBundledArtifact.cases?.[0];
      if (
        rprBundledArtifact.schemaVersion !== "my-dev-kit-lab-retrieval-precision-recall-execution-v1" ||
        rprBundledArtifact.cases?.length !== 1 ||
        bundledCase?.caseId !== "warm-medium-complete-idempotent" ||
        bundledCase?.status !== "completed" ||
        bundledCase?.identityRedaction !== undefined ||
        bundledCase?.quality?.file?.precision?.value !== 1 ||
        bundledCase?.quality?.file?.recall?.value !== 1 ||
        !bundledCase?.quality?.file?.relevantRetrievedFiles?.includes("src/services/completeTask.ts") ||
        bundledCase?.quality?.fact?.coverage?.availability !== "available" ||
        rprBundledReport.report?.plugin?.id !== RPR_ID ||
        rprBundledReport.report?.target?.isSelf !== true ||
        rprBundledReport.report?.retrievalPrecisionRecall?.cases?.[0]?.identityRedaction !== null
      ) {
        fail(`${gate}_BUNDLED`, `Installed bundled run did not produce the expected unredacted, packaged-corpus evidence: ${JSON.stringify(bundledCase)?.slice(0, 600)}`);
      }
      if (readKitCalls(rprBundledLog).filter((call) => call.argv[0] === "index").length !== 1) {
        fail(`${gate}_BUNDLED`, "The bundled run did not build exactly one index for the one selected benchmark project.");
      }
      const rprBundledSerialized = ["retrieval-precision-recall-execution.json", "report.json", "report.txt", "report.html"].map((name) => readFileSync(path.join(rprBundledOut, name), "utf8")).join("\n");
      for (const marker of [RPR_MARKERS.source, RPR_MARKERS.stdout, RPR_MARKERS.stderr]) {
        if (rprBundledSerialized.includes(marker)) fail(`${gate}_BUNDLED`, "Installed bundled output serialized raw source, stdout or stderr marker text.");
      }
      console.log("RETRIEVAL_PRECISION_RECALL_BUNDLED: PASS (installed bin; packaged corpus and profiles; offline upstream-shaped kit; unredacted benchmark identities; no raw output persisted)");

      // --- External-local: disposable Git repository outside the installed package ---
      const RPR_LOCAL = {
        eligible: "PACKED_RPR_ELIGIBLE_MARKER_1f9a",
        ignoredFile: "PACKED_RPR_IGNORED_MARKER_44c8",
        ignoredDirectory: "PACKED_RPR_IGNORED_DIR_MARKER_e03b",
        oversized: "PACKED_RPR_OVERSIZED_MARKER_7b52"
      };
      const rprArea = path.join(tempRoot, "rpr local subject area");
      const rprTarget = path.join(rprArea, "target repo", "inner project");
      const rprConfigPath = path.join(rprArea, "config dir", "local subject.json");
      const rprOut = path.join(dirs.workspace, "rpr local out", "run");
      const rprLog = path.join(tempRoot, "rpr-local-kit.log");
      const rprGitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
      for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]) delete rprGitEnv[key];
      const rprGit = (...args) => {
        const result = spawnSync("git", ["-c", "user.name=Packed Gate", "-c", "user.email=packed-gate@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: rprTarget, encoding: "utf8", env: rprGitEnv });
        if (result.status !== 0) fail(gate, `git ${args[0]} failed while preparing the disposable retrieval subject.`, describeChildResult(result));
        return result.stdout;
      };
      const rprWrite = (relative, content) => {
        const absolute = path.join(rprTarget, ...relative.split("/"));
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, content, "utf8");
      };
      mkdirSync(rprTarget, { recursive: true });
      rprGit("init", "-q", "-b", "main");
      rprWrite(".gitignore", "src/private notes.ts\nsrc/gen/\n");
      rprWrite("src/app/main.ts", `export function ${RPR_MARKERS.symbol}(): string { return "${RPR_LOCAL.eligible}"; }\n`);
      rprWrite("src/app/util/helper.ts", `export function ${RPR_MARKERS.symbolTwo}(value: number): number { return value + 1; }\n`);
      rprWrite("src/huge file.ts", `// ${RPR_LOCAL.oversized}\n${"x".repeat(1_048_576 + 100)}\n`);
      rprGit("add", "-A");
      rprGit("commit", "-q", "-m", "packed fixture");
      rprWrite("src/private notes.ts", `export const privateNotes = 1; // ${RPR_LOCAL.ignoredFile}\n`);
      rprWrite("src/gen/out.ts", `export const generated = 1; // ${RPR_LOCAL.ignoredDirectory}\n`);
      const rprAnswerKey = (files, symbols, facts, targets) => ({
        expectedFiles: files,
        expectedSymbols: symbols,
        expectedFacts: facts.map((id) => ({ id, text: "private fact text that is never persisted", weight: 1, required: true })),
        expectedContextTargets: targets,
        minimumCorrectFacts: 1
      });
      mkdirSync(path.dirname(rprConfigPath), { recursive: true });
      writeFileSync(
        rprConfigPath,
        JSON.stringify({
          schemaVersion: "1.0.0",
          subjectId: "packed-rpr-subject",
          cases: [
            {
              id: "packed-case-one",
              title: RPR_MARKERS.title,
              sourceRoots: ["src"],
              query: "Where are the private symbols defined?",
              expectedFiles: ["src/app/main.ts", "src/app/util/helper.ts"],
              expectedSymbols: [RPR_MARKERS.symbol, RPR_MARKERS.symbolTwo],
              rawIncludeGlobs: ["src/**/*"],
              answerKey: rprAnswerKey(
                ["src/app/main.ts", "src/app/util/helper.ts"],
                [RPR_MARKERS.symbol, RPR_MARKERS.symbolTwo],
                [RPR_MARKERS.fact, RPR_MARKERS.factTwo],
                [
                  { file: "src/app/main.ts", symbols: [RPR_MARKERS.symbol], required: true, factIds: [RPR_MARKERS.fact] },
                  { file: "src/app/util/helper.ts", symbols: [RPR_MARKERS.symbolTwo], required: true, factIds: [RPR_MARKERS.factTwo] }
                ]
              )
            },
            {
              id: "packed-case-two",
              title: RPR_MARKERS.titleTwo,
              sourceRoots: ["src/app/util"],
              query: "Where is the helper defined?",
              expectedFiles: ["src/app/util/helper.ts"],
              expectedSymbols: [RPR_MARKERS.symbolTwo],
              rawIncludeGlobs: ["src/app/util/**/*"],
              answerKey: rprAnswerKey(
                ["src/app/util/helper.ts"],
                [RPR_MARKERS.symbolTwo],
                [RPR_MARKERS.factThree],
                [{ file: "src/app/util/helper.ts", symbols: [RPR_MARKERS.symbolTwo], required: true, factIds: [RPR_MARKERS.factThree] }]
              )
            }
          ]
        }),
        "utf8"
      );
      const rprConfigBefore = readFileSync(rprConfigPath, "utf8");
      const rprTargetBefore = await snapshotDirectory(rprTarget);
      const rprStatusBefore = rprGit("status", "--porcelain=v1", "--ignored");
      const rprHeadBefore = rprGit("rev-parse", "HEAD").trim();
      const rprRunArgs = (extra) => ["experiment", "run", "--experiment", RPR_ID, ...extra];
      const rprLocalEnv = (extra = {}) =>
        rprKitEnv({ RPR_KIT_LOG: rprLog, RPR_KIT_FILES: "src/app/main.ts,src/app/util/helper.ts", RPR_KIT_SYMBOLS: `${RPR_MARKERS.symbol}@src/app/main.ts`, ...extra });
      const rprSentinels = [
        ...[rprTarget, rprArea, path.dirname(rprConfigPath), rprOut, path.dirname(rprOut), dirs.workspace, dirs.consumer, dirs.fakeKit, installedPackageRoot, tempRoot, os.tmpdir(), os.homedir(), REPO_ROOT].map(
          (value) => ({ label: "private path", value, kind: "path" })
        ),
        ...Object.entries({ ...RPR_MARKERS, ...RPR_LOCAL }).map(([label, value]) => ({ label: `marker ${label}`, value, kind: "text" })),
        ...["private notes.ts", "huge file.ts", "gen/out", "src/app/main.ts", "src/app/util/helper.ts", "main.ts", "helper.ts", "inner project", "target repo", "fake-upstream-shaped-kit"].map((value) => ({ label: `name ${value}`, value, kind: "text" }))
      ];
      const expectTargetUntouched = async (label) => {
        const diff = diffSnapshots(rprTargetBefore, await snapshotDirectory(rprTarget));
        if (diff.length > 0) fail(`${gate}_IMMUTABILITY`, `${label} mutated the target: ${diff.join(", ")}`);
        if (rprGit("status", "--porcelain=v1", "--ignored") !== rprStatusBefore || rprGit("rev-parse", "HEAD").trim() !== rprHeadBefore || readFileSync(rprConfigPath, "utf8") !== rprConfigBefore) {
          fail(`${gate}_IMMUTABILITY`, `${label} changed the target Git state or its config.`);
        }
      };

      // Mode-matrix rejections and an output-inside-target rejection: nonzero, no output, target untouched, nothing private printed.
      const rprUnsafeInside = path.join(rprTarget, "lab-out");
      const rprNegativeCases = [
        ["target-without-config", ["--target", rprTarget, "--out", rprOut]],
        ["config-without-target", ["--local-subject-config", rprConfigPath, "--out", rprOut]],
        ["case-in-external-mode", ["--target", rprTarget, "--local-subject-config", rprConfigPath, "--case", "packed-case-one", "--out", rprOut]],
        ["benchmark-project-in-external-mode", ["--target", rprTarget, "--local-subject-config", rprConfigPath, "--benchmark-project", "packed-rpr-subject", "--out", rprOut]],
        ["output-inside-target", ["--target", rprTarget, "--local-subject-config", rprConfigPath, "--out", rprUnsafeInside]],
        ["output-equals-target", ["--target", rprTarget, "--local-subject-config", rprConfigPath, "--out", rprTarget]]
      ];
      for (const [label, args] of rprNegativeCases) {
        const result = runInstalledCli(cliCommand, dirs.consumer, rprRunArgs([...args, "--kit-command", rprKitCommand]), rprLocalEnv());
        if (result.status === 0) fail(`${gate}_REJECTIONS`, `Installed negative case ${label} exited 0.`, describeChildResult(result));
        if (existsSync(rprUnsafeInside) || (existsSync(path.dirname(rprOut)) && readdirSync(path.dirname(rprOut)).length > 0)) {
          fail(`${gate}_REJECTIONS`, `Installed negative case ${label} created output.`);
        }
        const leaks = privacyScan.scanDurableArtifactText([{ name: `${label}-console`, text: `${result.stdout ?? ""}\n${result.stderr ?? ""}` }], rprSentinels.filter((sentinel) => sentinel.kind === "path" && sentinel.value !== os.tmpdir() && sentinel.value !== os.homedir() && sentinel.value !== tempRoot && sentinel.value !== REPO_ROOT).concat(rprSentinels.filter((sentinel) => sentinel.kind === "text" && sentinel.label.startsWith("marker"))));
        if (leaks.length > 0) fail(`${gate}_REJECTIONS`, `Installed negative case ${label} printed a private value: ${JSON.stringify(leaks)}`);
        await expectTargetUntouched(`Installed negative case ${label}`);
      }
      if (readKitCalls(rprLog).length > 0) fail(`${gate}_REJECTIONS`, "A rejected installed run still invoked my-dev-kit.");
      console.log(`RETRIEVAL_PRECISION_RECALL_EXTERNAL_REJECTIONS: PASS (${rprNegativeCases.length} installed boundary cases: nonzero exit, no output, no my-dev-kit call, target unchanged)`);

      // Installed failure path: an unsafe retrieved identity must fail closed with no normal durable family.
      const rprFailureOut = path.join(dirs.workspace, "rpr local failure out", "run");
      const rprFailure = runInstalledCli(
        cliCommand,
        dirs.consumer,
        rprRunArgs(["--target", rprTarget, "--local-subject-config", rprConfigPath, "--kit-command", rprKitCommand, "--out", rprFailureOut]),
        rprLocalEnv({ RPR_KIT_FILES: "src/private notes.ts" })
      );
      if (rprFailure.status === 0) fail(`${gate}_EXTERNAL_FAILURE`, "Installed run that retrieved an ignored file exited 0.", describeChildResult(rprFailure));
      const failureText = `${rprFailure.stdout ?? ""}\n${rprFailure.stderr ?? ""}`;
      if (!failureText.includes("RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE") || !failureText.includes("Status: failed")) {
        fail(`${gate}_EXTERNAL_FAILURE`, "Installed unsafe-identity failure did not report the bounded safe code.", describeChildResult(rprFailure));
      }
      for (const forbidden of ["private notes", "ignored", rprTarget, rprArea, ...Object.values(RPR_LOCAL), ...Object.values(RPR_MARKERS)]) {
        if (failureText.includes(forbidden)) fail(`${gate}_EXTERNAL_FAILURE`, `Installed failure output contains a private value (${forbidden.length > 40 ? `${forbidden.slice(0, 20)}...` : forbidden}).`);
      }
      if (existsSync(rprFailureOut) && readdirSync(rprFailureOut).length > 0) {
        fail(`${gate}_EXTERNAL_FAILURE`, `Installed failure wrote files to the output directory: ${readdirSync(rprFailureOut).join(", ")}`);
      }
      await expectTargetUntouched("Installed unsafe-identity failure");
      console.log("RETRIEVAL_PRECISION_RECALL_EXTERNAL_FAILURE: PASS (installed bin; unsafe retrieved identity: nonzero, bounded safe code, no normal durable family, target unchanged)");

      // Installed external-local success. The failure run above built (and discarded) one private index before stopping, so the
      // call log is reset to count exactly the indexes of this run.
      writeFileSync(rprLog, "", "utf8");
      const rprRun = runInstalledCli(
        cliCommand,
        dirs.consumer,
        rprRunArgs(["--target", rprTarget, "--local-subject-config", rprConfigPath, "--kit-command", rprKitCommand, "--out", rprOut]),
        rprLocalEnv()
      );
      if (rprRun.status !== 0) fail(`${gate}_EXTERNAL`, "Installed external-local retrieval-precision-recall run did not exit 0.", describeChildResult(rprRun));
      assertOutputOutsidePackage(rprOut, installedPackageRoot, "retrieval-precision-recall external-local run");
      if (!path.relative(rprTarget, rprOut).startsWith("..")) fail(`${gate}_EXTERNAL`, "Lab output was written inside the inspected target.");
      const rprEntries = readdirSync(rprOut).sort();
      if (JSON.stringify(rprEntries) !== JSON.stringify(RPR_DURABLE_FAMILY)) {
        fail(`${gate}_EXTERNAL`, `External-local output is not exactly the approved durable family (scratch, index or command files remained): ${rprEntries.join(", ")}`);
      }
      for (const name of RPR_DURABLE_FAMILY) requireNonEmptyFile(path.join(rprOut, name), `${gate}_EXTERNAL`);
      const rprArtifact = readJsonFile(path.join(rprOut, "retrieval-precision-recall-execution.json"), `${gate}_EXTERNAL`);
      const rprManifest = readJsonFile(path.join(rprOut, "local-repository-subject-manifest.json"), `${gate}_EXTERNAL`);
      const rprReport = readJsonFile(path.join(rprOut, "report.json"), `${gate}_EXTERNAL`);
      if (
        rprArtifact.schemaVersion !== "my-dev-kit-lab-retrieval-precision-recall-execution-v1" ||
        JSON.stringify(rprArtifact.cases?.map((entry) => entry.caseId)) !== JSON.stringify(["packed-case-one", "packed-case-two"]) ||
        rprArtifact.aggregate?.runSummary?.completedCaseCount !== 2 ||
        rprManifest.schemaId !== "my-dev-kit-lab-local-repository-subject-manifest-v1" ||
        rprManifest.subjectId !== "packed-rpr-subject" ||
        rprManifest.repository?.commit !== rprHeadBefore ||
        rprReport.report?.plugin?.id !== RPR_ID ||
        rprReport.report?.target?.kind !== "external-local" ||
        rprReport.report?.target?.targetRoot !== "local-repository:packed-rpr-subject" ||
        rprReport.report?.target?.toolRoot !== "[redacted]" ||
        rprReport.report?.target?.privacyProjection !== "external-local-redacted" ||
        rprReport.report?.metadata?.outputRoot !== "[redacted]"
      ) {
        fail(`${gate}_EXTERNAL`, "Installed external-local artifacts do not carry the expected schema, subject identity, Git commit and privacy projection.");
      }
      const rprRedactionProblems = privacyScan.checkRetrievalRedactionTruthfulness(rprArtifact);
      if (rprRedactionProblems.length > 0) fail(`${gate}_EXTERNAL`, `External-local retrieval redaction is not truthful: ${rprRedactionProblems.join("; ")}`);
      const rprPhysicalOut = realpathSync.native(rprOut);
      const rprIndexCalls = readKitCalls(rprLog).filter((call) => call.argv[0] === "index");
      const rprSourceRoots = rprIndexCalls.map((call) => call.argv.flatMap((value, index) => (value === "--src" ? [call.argv[index + 1]] : [])));
      if (rprIndexCalls.length !== 2 || JSON.stringify(rprSourceRoots) !== JSON.stringify([["src"], ["src/app/util"]])) {
        fail(`${gate}_EXTERNAL`, `Expected one private index per configured case with exactly that case's source roots, got ${JSON.stringify(rprSourceRoots)}.`);
      }
      for (const call of rprIndexCalls) {
        const excluded = call.argv.flatMap((value, index) => (value === "--exclude" ? [call.argv[index + 1]] : []));
        for (const required of ["src/gen", "src/huge file.ts", "src/private notes.ts"]) {
          if (!excluded.includes(required)) fail(`${gate}_EXTERNAL`, `A case index did not receive the exact exclusion ${required}.`);
        }
        const indexOut = call.argv[call.argv.indexOf("--out") + 1];
        const indexSegments = segmentsBeneathRoot(rprPhysicalOut, indexOut);
        if (indexSegments === null || indexSegments.length < 2 || !indexSegments[0].startsWith("s-")) fail(`${gate}_EXTERNAL`, "A case index was not built inside the private scratch.");
        rprSentinels.push({ label: "private index path", value: indexOut, kind: "path" }, { label: "private scratch path", value: path.dirname(indexOut), kind: "path" });
      }
      const rprLeaks = privacyScan.scanDurableOutputDirectory(rprOut, rprSentinels);
      if (rprLeaks.length > 0) fail(`${gate}_PRIVACY`, `Durable installed external-local output leaks private values: ${JSON.stringify(rprLeaks)}`);
      const rprHtml = readFileSync(path.join(rprOut, "report.html"), "utf8");
      if (!rprHtml.includes("&lt;redacted file 1&gt;") || /<redacted [a-z]+ \d+>/.test(rprHtml)) {
        fail(`${gate}_PRIVACY`, "Installed report.html does not escape the redaction placeholders.");
      }
      await expectTargetUntouched("Installed external-local run");
      for (const forbidden of [".my-dev-kit", ".my-dev-kit-lab", "lab-output", "lab-out"]) {
        if (existsSync(path.join(rprTarget, forbidden))) fail(`${gate}_IMMUTABILITY`, `Lab artifacts appeared inside the target: ${forbidden}`);
      }
      console.log(`RETRIEVAL_PRECISION_RECALL_EXTERNAL: PASS (installed bin; offline upstream-shaped kit; one private index per case with exact roots and exclusions; space-containing paths; output path length ${rprOut.length})`);
      console.log("RETRIEVAL_PRECISION_RECALL_PRIVACY: PASS (raw, separator, JSON-escaped and HTML-escaped path forms; markers; file, symbol, fact and title identities; scratch and index paths; redaction truthful)");
      console.log("RETRIEVAL_PRECISION_RECALL_IMMUTABILITY: PASS (target tree, Git status/HEAD and config unchanged; scratch removed; no Lab output in target)");
    }

    // -----------------------------------------------------------------
    // 9c-3. v0.6.2 incremental-change-staleness installed-package acceptance
    // (Batch 6). Consumer A (dirs.consumer) proves clean install/identity/
    // CLI/plugin discovery only and never runs the six-scenario workflow, so
    // it stays covered by the whole-run installedPackageBefore/After diff.
    // Consumer B is the exact same tarball's already-independent second
    // install (dirs.mutableConsumer / sandboxPackageRoot / sandboxCliCommand
    // / sandboxEnv, established above): it runs the plugin's OWN production
    // disposable-target/mutation/lifecycle architecture end to end against
    // the REAL published upstream already resolved above (upstreamBin /
    // realKitCommand) -- never the old v0.6.1 controlled-mutation wrapper,
    // never a fake kit, never the source checkout's own benchmarks.
    // -----------------------------------------------------------------
    const icsListResult = runInstalledCli(cliCommand, dirs.consumer, ["experiment", "list", "--json"], envWithBin);
    if (icsListResult.status !== 0) {
      fail("INCREMENTAL_CHANGE_STALENESS_DISCOVERY", "Installed `experiment list --json` did not exit 0.", describeChildResult(icsListResult));
    }
    const icsListParsed = parseJsonOutput(icsListResult, "INCREMENTAL_CHANGE_STALENESS_DISCOVERY");
    const icsListedEntries = (icsListParsed.experiments ?? []).filter((entry) => entry.id === "incremental-change-staleness");
    if (icsListedEntries.length !== 1) {
      fail("INCREMENTAL_CHANGE_STALENESS_DISCOVERY", `Expected incremental-change-staleness exactly once in \`experiment list\`, found ${icsListedEntries.length}.`);
    }
    if (
      icsListedEntries[0].status !== "experimental" ||
      JSON.stringify(icsListedEntries[0].supportedVariants) !== JSON.stringify(INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS_EXPECTED)
    ) {
      fail("INCREMENTAL_CHANGE_STALENESS_DISCOVERY", `Unexpected listed plugin metadata/variants: ${JSON.stringify(icsListedEntries[0])}`);
    }

    const icsDescribeResult = runInstalledCli(
      cliCommand,
      dirs.consumer,
      ["experiment", "describe", "--experiment", "incremental-change-staleness", "--json"],
      envWithBin
    );
    if (icsDescribeResult.status !== 0) {
      fail(
        "INCREMENTAL_CHANGE_STALENESS_DISCOVERY",
        "Installed `experiment describe --experiment incremental-change-staleness` did not exit 0.",
        describeChildResult(icsDescribeResult)
      );
    }
    const icsDescribed = parseJsonOutput(icsDescribeResult, "INCREMENTAL_CHANGE_STALENESS_DISCOVERY");
    if (
      icsDescribed.metadata?.id !== "incremental-change-staleness" ||
      icsDescribed.metadata?.status !== "experimental" ||
      JSON.stringify(icsDescribed.supportedVariants) !== JSON.stringify(INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS_EXPECTED)
    ) {
      fail(
        "INCREMENTAL_CHANGE_STALENESS_DISCOVERY",
        `Installed describe output does not expose exactly the four V2 treatments: ${icsDescribeResult.stdout}`
      );
    }
    console.log("INCREMENTAL_CHANGE_STALENESS_DISCOVERY: PASS (listed exactly once; describe exposes the four V2 treatments in order)");

    // v0.6.3 Batch 5: the acceptance experiment must use the real published upstream, never a fake.
    if (!realKitCommand.includes(upstreamBin)) {
      fail("INCREMENTAL_CHANGE_STALENESS_REAL_UPSTREAM", `Kit command is not the installed real published upstream binary: ${realKitCommand}`);
    }
    const gitOutput = (args) => {
      const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
      if (result.status !== 0) fail("INCREMENTAL_CHANGE_STALENESS_IMMUTABILITY", `git ${args.join(" ")} failed.`, describeChildResult(result));
      return result.stdout.trim();
    };
    const icsRepoStatusBefore = gitOutput(["status", "--short"]);
    const icsCanonicalBenchmarksBefore = await snapshotDirectory(path.join(REPO_ROOT, "benchmarks"));
    const icsUpstreamBefore = await snapshotDirectory(upstreamPackageRoot);
    const icsSandboxBefore = await snapshotDirectory(sandboxPackageRoot);
    const icsOut = path.join(dirs.affectedRuns, "incremental-change-staleness");
    const icsRun = runInstalledCli(
      sandboxCliCommand,
      dirs.mutableConsumer,
      ["experiment", "run", "--experiment", "incremental-change-staleness", "--kit-command", realKitCommand, "--out", icsOut],
      sandboxEnv
    );
    if (icsRun.status !== 0) {
      fail("INCREMENTAL_CHANGE_STALENESS_RUN", "Installed six-scenario incremental-change-staleness run did not exit 0.", describeChildResult(icsRun));
    }
    assertOutputOutsidePackage(icsOut, sandboxPackageRoot, "incremental-change-staleness run");
    for (const name of ["incremental-change-staleness-execution.json", "report.json", "report.txt", "report.html"]) {
      requireNonEmptyFile(path.join(icsOut, name), "INCREMENTAL_CHANGE_STALENESS_RUN");
    }

    const icsArtifact = readJsonFile(path.join(icsOut, "incremental-change-staleness-execution.json"), "INCREMENTAL_CHANGE_STALENESS_ARTIFACT");
    const installedModule = async (...segments) => {
      const modulePath = path.join(sandboxPackageRoot, "dist", "src", ...segments);
      if (!existsSync(modulePath)) fail("INCREMENTAL_CHANGE_STALENESS_ARTIFACT", `Installed module not found: ${modulePath}`);
      return import(pathToFileURL(modulePath).href);
    };

    // The production V2 artifact validator of the INSTALLED package (never a looser acceptance parser).
    const installedArtifactModule = await installedModule("experiments", "plugins", "incrementalChangeStaleness", "executionArtifactV2.js");
    let productionValidatorError = null;
    try {
      installedArtifactModule.validateIncrementalChangeStalenessExecutionArtifactV2(icsArtifact);
    } catch (error) {
      productionValidatorError = error.message;
    }
    const icsAcceptance = evaluateIncrementalChangeStalenessV2Acceptance(icsArtifact);
    const icsReportJson = readJsonFile(path.join(icsOut, "report.json"), "INCREMENTAL_CHANGE_STALENESS_REPORT").report;
    const icsReportText = readFileSync(path.join(icsOut, "report.txt"), "utf8");
    const icsReportHtml = readFileSync(path.join(icsOut, "report.html"), "utf8");
    const installedReportModule = await installedModule("report", "experiments", "buildIncrementalChangeStalenessReportV2.js");
    const icsReportProblems = validateIncrementalChangeStalenessReportConsistencyV2({
      artifact: icsArtifact,
      report: icsReportJson,
      reportText: icsReportText,
      reportHtml: icsReportHtml,
      expectedLimitations: installedReportModule.LIMITATIONS_V2
    });

    const icsGitHead = gitOutput(["rev-parse", "HEAD"]);
    const icsGitBranch = gitOutput(["branch", "--show-current"]);
    const icsPackageVersion = packEntry.version;
    const writeIcsEvidence = (finalVerdict, immutability) => {
      const reportPath = path.join(REPO_ROOT, ".my-dev-kit-context", "reports", "v0.6.3-real-upstream-partial-refresh-acceptance.txt");
      const cell = (value) => (value === null || value === undefined ? "null" : Array.isArray(value) ? JSON.stringify(value) : String(value));
      const lines = [
        "my-dev-kit-lab v0.6.3 real-upstream partial-refresh acceptance (local-only evidence; not public documentation)",
        `timestamp: ${new Date().toISOString()}`,
        `source branch: ${icsGitBranch}`,
        `source commit: ${icsGitHead}`,
        `lab package: ${packEntry.name}@${icsPackageVersion}`,
        `lab tarball: ${tarballFilename}`,
        `lab tarball sha256: ${tarballSha256}`,
        `upstream package: ${UPSTREAM_MY_DEV_KIT_SPEC}`,
        `kit command: ${realKitCommand}`,
        `packed consumer path: ${dirs.mutableConsumer}`,
        "command surface: installed CLI: experiment run --experiment incremental-change-staleness --kit-command <real upstream> --out <run dir>",
        `scenarios: ${INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS_LOCAL.join(", ")}`,
        "",
        "per scenario/treatment evidence:"
      ];
      for (const row of icsAcceptance.rows) {
        lines.push(
          `  [${row.scenarioId}] ${row.treatmentId} intent=${cell(row.treatmentIntent)} kind=${cell(row.refreshKind)} realization=${cell(row.refreshRealization)}`,
          `      requestedScope=${cell(row.requestedScope)} appliedScope=${cell(row.appliedScope)} selectionStatus=${cell(row.selectionStatus)} fallbackReason=${cell(row.fallbackReason)}`,
          `      freshExtractionFileCount=${cell(row.freshExtractionFileCount)} reusedFileCount=${cell(row.reusedFileCount)} forcedNeighborReanalysisFileCount=${cell(row.forcedNeighborReanalysisFileCount)} seedFileCount=${cell(row.seedFileCount)} affectedNodeCount=${cell(row.affectedNodeCount)}`,
          `      forcedNeighborSample=${cell(row.forcedNeighborSample)}`,
          `      baselineFreshness=${cell(row.baselineFreshness)} refreshedFreshness=${cell(row.refreshedFreshness)} requiredFileStatus=${cell(row.requiredFileStatus)} correctness=${row.correctness} referenceClassification=${cell(row.referenceClassification)}`
        );
      }
      lines.push(
        "",
        `scenarios with forcedNeighborReanalysisFileCount > 0: ${icsAcceptance.forcedNeighborScenarios.join(", ") || "none"}`,
        `scenarios where affected fresh extraction exceeds changed-files (and reused is lower): ${icsAcceptance.geometryDifferenceScenarios.join(", ") || "none"}`,
        `production V2 artifact validator: ${productionValidatorError ?? "PASS"}`,
        `contract problems: ${icsAcceptance.contractProblems.join(" | ") || "none"}`,
        `changed-files realization gate: ${icsAcceptance.changedFilesRealizationProblems.length === 0 ? "PASS" : icsAcceptance.changedFilesRealizationProblems.join(" | ")}`,
        `affected-neighborhood realization gate: ${icsAcceptance.affectedRealizationProblems.length === 0 ? "PASS" : icsAcceptance.affectedRealizationProblems.join(" | ")}`,
        `discrimination gate: ${icsAcceptance.discrimination}${icsAcceptance.discriminationProblems.length > 0 ? ` (${icsAcceptance.discriminationProblems.join(" | ")})` : ""}`,
        `report json/text/html consistency: ${icsReportProblems.length === 0 ? "PASS" : icsReportProblems.join(" | ")}`,
        `immutability: ${immutability}`,
        "note: no treatment ranking or safety claim is made; counts and durations are descriptive only.",
        `final acceptance verdict: ${finalVerdict}`
      );
      mkdirSync(path.dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
      return reportPath;
    };

    if (productionValidatorError) {
      writeIcsEvidence("BLOCKED_ARTIFACT_OR_REPORT_CONTRACT_MISMATCH", "not evaluated");
      fail("BLOCKED_ARTIFACT_OR_REPORT_CONTRACT_MISMATCH", `Installed production V2 artifact validator rejected the artifact: ${productionValidatorError}`);
    }
    if (icsAcceptance.verdict !== "PASS") {
      writeIcsEvidence(icsAcceptance.verdict, "not evaluated");
      fail(icsAcceptance.verdict, icsAcceptance.problems.join("\n"));
    }
    if (icsReportProblems.length > 0) {
      writeIcsEvidence("BLOCKED_ARTIFACT_OR_REPORT_CONTRACT_MISMATCH", "not evaluated");
      fail("BLOCKED_ARTIFACT_OR_REPORT_CONTRACT_MISMATCH", icsReportProblems.join("\n"));
    }
    if (icsArtifact.summary.failedScenarioCount !== 0) {
      fail("INCREMENTAL_CHANGE_STALENESS_RUN", `Expected failedScenarioCount 0, got ${icsArtifact.summary.failedScenarioCount}.`);
    }
    for (const scenario of icsArtifact.scenarios) {
      const version = scenario.lifecycle?.myDevKitVersion;
      if (typeof version !== "string" || !version.includes(UPSTREAM_MY_DEV_KIT_VERSION)) {
        fail("INCREMENTAL_CHANGE_STALENESS_REAL_UPSTREAM", `[${scenario.scenarioId}] lifecycle myDevKitVersion ${JSON.stringify(version)} does not identify the real upstream ${UPSTREAM_MY_DEV_KIT_VERSION}.`);
      }
    }

    // Reuse (never reimplement) the installed package's own pure stale-risk comparison module.
    const installedComparison = await installedModule("experiments", "plugins", "incrementalChangeStaleness", "comparison.js");
    for (const scenario of icsArtifact.scenarios) {
      const byId = (id) => scenario.treatments.find((treatment) => treatment.treatmentId === id);
      const correctnessComparable = (treatment) =>
        treatment?.fakeAgent?.correctness?.available ? { available: true, score: treatment.fakeAgent.correctness.score } : { available: false };
      const stale = byId("stale-index");
      const full = byId("full-refresh");
      const persisted = scenario.referenceComparisons.find((comparison) => comparison.candidateTreatmentId === "stale-index").comparison;
      const correctnessRelation = installedComparison.compareCorrectness(correctnessComparable(stale), correctnessComparable(full));
      const requiredRelation = installedComparison.compareRequiredFileEvidence(stale.requiredFileEvidence, full.requiredFileEvidence);
      const classification = installedComparison.classifyStaleRisk(correctnessRelation, requiredRelation);
      if (
        correctnessRelation !== persisted.correctnessRelation ||
        requiredRelation !== persisted.requiredFileEvidenceRelation ||
        classification.staleRiskClassification !== persisted.staleRiskClassification
      ) {
        fail("INCREMENTAL_CHANGE_STALENESS_COMPARISON", `[${scenario.scenarioId}] persisted stale-vs-full comparison disagrees with the installed pure comparison helper.`);
      }
    }

    // Immutability: mutation stays inside the plugin's own runtime root; installed Lab package, installed
    // upstream package, canonical benchmark sources, and the source checkout must all be unchanged.
    const icsSandboxChanges = diffSnapshots(icsSandboxBefore, await snapshotDirectory(sandboxPackageRoot));
    if (icsSandboxChanges.length > 0) {
      writeIcsEvidence("BLOCKED_IMMUTABILITY_VIOLATION", `installed Lab package changed: ${icsSandboxChanges.join(", ")}`);
      fail("BLOCKED_IMMUTABILITY_VIOLATION", `Installed package resources changed after the six-scenario run: ${icsSandboxChanges.join(", ")}`);
    }
    const icsUpstreamChanges = diffSnapshots(icsUpstreamBefore, await snapshotDirectory(upstreamPackageRoot));
    if (icsUpstreamChanges.length > 0) {
      writeIcsEvidence("BLOCKED_IMMUTABILITY_VIOLATION", `installed upstream package changed: ${icsUpstreamChanges.join(", ")}`);
      fail("BLOCKED_IMMUTABILITY_VIOLATION", `Installed upstream package changed after the run: ${icsUpstreamChanges.join(", ")}`);
    }
    const icsCanonicalChanges = diffSnapshots(icsCanonicalBenchmarksBefore, await snapshotDirectory(path.join(REPO_ROOT, "benchmarks")));
    const icsRepoStatusAfter = gitOutput(["status", "--short"]);
    if (icsCanonicalChanges.length > 0 || icsRepoStatusAfter !== icsRepoStatusBefore) {
      writeIcsEvidence("BLOCKED_IMMUTABILITY_VIOLATION", "source checkout or canonical benchmarks changed");
      fail("BLOCKED_IMMUTABILITY_VIOLATION", `Source checkout changed during the run: canonical=${icsCanonicalChanges.join(", ") || "none"}; git status before/after: ${JSON.stringify(icsRepoStatusBefore)} / ${JSON.stringify(icsRepoStatusAfter)}`);
    }
    const icsEvidencePath = writeIcsEvidence(
      "PASS",
      "installed Lab package, installed upstream package, canonical benchmarks, and source git status unchanged"
    );

    console.log(`INCREMENTAL_CHANGE_STALENESS_RUN: PASS (6 scenarios x 4 treatments; real ${UPSTREAM_MY_DEV_KIT_SPEC}; ${icsArtifact.scenarios.map((s) => `${s.scenarioId}=${s.referenceComparisons.map((c) => c.kind === "stale-risk" ? c.comparison.staleRiskClassification : c.classification).join("/")}`).join(", ")})`);
    console.log("INCREMENTAL_CHANGE_STALENESS_ARTIFACT: PASS (V2 schema; installed production validator; four treatments; three comparisons; no forbidden aggregate fields)");
    console.log("INCREMENTAL_CHANGE_STALENESS_REALIZATION: PASS (changed-files and affected-neighborhood APPLIED_PARTIAL for every scenario; stale NO_REFRESH; full FULL_REFRESH; refreshed states fresh)");
    console.log(`INCREMENTAL_CHANGE_STALENESS_DISCRIMINATION: PASS (forced neighbors: ${icsAcceptance.forcedNeighborScenarios.join(",")}; geometry difference: ${icsAcceptance.geometryDifferenceScenarios.join(",")})`);
    console.log("INCREMENTAL_CHANGE_STALENESS_REPORT: PASS (report.json/report.txt/report.html consistent with the V2 execution artifact; limitations present; no aggregate verdict)");
    console.log("INCREMENTAL_CHANGE_STALENESS_COMPARISON: PASS (persisted stale-vs-full comparison agrees with the installed pure comparison helper)");
    console.log("INCREMENTAL_CHANGE_STALENESS_IMMUTABILITY: PASS (installed Lab package, installed upstream package, canonical benchmarks, source git status unchanged)");
    console.log(`INCREMENTAL_CHANGE_STALENESS_EVIDENCE: ${icsEvidencePath}`);

    // -----------------------------------------------------------------
    // 9c-6. v0.8.2 context-pack-generation installed-package acceptance.
    // The INSTALLED bin proves discovery, flag validation, a bundled run over
    // the packaged corpus, and an external-local run against a disposable Git
    // repository. The deterministic safety matrix uses a stand-in my-dev-kit
    // copied from the repository test fixtures at verification time (never
    // packaged, no network). The compatibility proof uses the REAL published
    // upstream my-dev-kit installed above (realKitCommand). No retrieval-quality
    // threshold is asserted: valid measurements or truthful partial evidence
    // are both acceptable, and context-pack need not outperform raw.
    // -----------------------------------------------------------------
    {
      const gate = "CONTEXT_PACK_GENERATION";
      const CPG_ID = "context-pack-generation";
      const CPG_TREATMENTS = ["raw-full-file", "context-pack"];
      const CPG_SCOPES = ["overall", "localized", "cross-module", "broad-change"];
      const CPG_SCHEMAS = {
        pack: "my-dev-kit-lab-context-pack-experiment-v1",
        execution: "my-dev-kit-lab-context-pack-generation-execution-v1",
        analysis: "my-dev-kit-lab-context-pack-generation-analysis-v1",
        report: "my-dev-kit-lab-context-pack-generation-report-v1"
      };
      const CPG_EXECUTION_FILE = "context-pack-generation-execution.json";
      const CPG_ANALYSIS_FILE = "context-pack-generation-analysis.json";
      const CPG_MANIFEST_FILE = "local-repository-subject-manifest.json";
      const CPG_EXTERNAL_FAMILY = [CPG_ANALYSIS_FILE, CPG_EXECUTION_FILE, CPG_MANIFEST_FILE, "report.html", "report.json", "report.txt"];
      const CPG_BUNDLED_CASE = "warm-medium-complete-idempotent";
      const CPG_PREVIEW_LIMITS = { files: 5, symbols: 5, sourceSlices: 3, callRelationships: 5, tests: 5, evidenceNotes: 5, linesPerSlice: 12 };
      const privacyScan = await loadPrivacyScan();

      // --- Discovery (installed list and describe) ---
      const cpgListed = knownExperiments.filter((entry) => entry.id === CPG_ID);
      if (
        cpgListed.length !== 1 ||
        cpgListed[0].name !== "Context Pack Generation" ||
        cpgListed[0].status !== "experimental" ||
        JSON.stringify(cpgListed[0].supportedVariants) !== JSON.stringify(CPG_TREATMENTS) ||
        JSON.stringify(cpgListed[0].supportedTargets) !== JSON.stringify(["self", "external-local"]) ||
        JSON.stringify(cpgListed[0].supportedOutputs) !== JSON.stringify(["json", "html", "text", "artifact"])
      ) {
        fail(`${gate}_DISCOVERY`, `Installed experiment list lacks the expected ${CPG_ID} entry: ${JSON.stringify(cpgListed)}`);
      }
      if (JSON.stringify(knownExperimentIds.slice(0, REQUIRED_EXPERIMENT_IDS.length)) !== JSON.stringify(REQUIRED_EXPERIMENT_IDS)) {
        fail(`${gate}_DISCOVERY`, `Installed registry order differs from the required trailing order: ${knownExperimentIds.join(", ")}`);
      }
      const cpgDescribeJson = runInstalledCli(cliCommand, dirs.consumer, ["experiment", "describe", "--experiment", CPG_ID, "--json"], envWithBin);
      if (cpgDescribeJson.status !== 0) fail(`${gate}_DISCOVERY`, `Installed experiment describe for ${CPG_ID} did not exit 0.`, describeChildResult(cpgDescribeJson));
      const cpgDescribed = parseJsonOutput(cpgDescribeJson, `${gate}_DISCOVERY`);
      if (
        cpgDescribed.metadata?.id !== CPG_ID ||
        cpgDescribed.metadata?.name !== "Context Pack Generation" ||
        cpgDescribed.metadata?.status !== "experimental" ||
        JSON.stringify(cpgDescribed.supportedVariants) !== JSON.stringify(CPG_TREATMENTS) ||
        JSON.stringify((cpgDescribed.requiredConfigFields ?? []).map((field) => field.name)) !== JSON.stringify(["outDir"]) ||
        JSON.stringify((cpgDescribed.optionalConfigFields ?? []).map((field) => field.name)) !== JSON.stringify(["kitCommand", "caseIds", "benchmarkProjects"]) ||
        /"(strategies|treatments|selectionPolicy)"/.test(JSON.stringify(cpgDescribed))
      ) {
        fail(`${gate}_DISCOVERY`, `Installed describe output is not the expected ${CPG_ID} contract: ${cpgDescribeJson.stdout}`);
      }
      const cpgDescribeText = runInstalledCli(cliCommand, dirs.consumer, ["experiment", "describe", "--experiment", CPG_ID], envWithBin);
      const cpgDescribeTextOut = cpgDescribeText.stdout ?? "";
      if (
        cpgDescribeText.status !== 0 ||
        !cpgDescribeTextOut.includes(`ID: ${CPG_ID}`) ||
        !cpgDescribeTextOut.includes("Context Pack Generation") ||
        !cpgDescribeTextOut.includes("Status: experimental") ||
        !cpgDescribeTextOut.includes("Supported variants: raw-full-file, context-pack")
      ) {
        fail(`${gate}_DISCOVERY`, "Installed text describe does not show the expected ID, name, status and ordered variants.", describeChildResult(cpgDescribeText));
      }
      console.log("CONTEXT_PACK_GENERATION_DISCOVERY: PASS (installed list and describe: experimental, raw-full-file then context-pack, self + external-local, closed config without a treatment or policy option; earlier experiments keep their order)");

      // --- Deterministic stand-in kit (test fixture copied at verification time; never packaged) ---
      const cpgKitScript = path.join(dirs.fakeKit, "fake-context-pack-kit.mjs");
      writeFileSync(cpgKitScript, readFileSync(path.join(REPO_ROOT, "tests", "experiments", "contextPackGeneration", "fakeContextPackKit.mjs"), "utf8"), "utf8");
      const cpgKitCommand = `"${process.execPath}" "${cpgKitScript}"`;
      const cpgReadKitCalls = (logFile) =>
        existsSync(logFile)
          ? readFileSync(logFile, "utf8")
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line))
          : [];
      const CPG_MARKERS = {
        title: "PACKED CPG PRIVATE TITLE MARKER",
        titleTwo: "PACKED CPG SECOND PRIVATE TITLE MARKER",
        symbol: "packedCpgPrivateAlpha",
        symbolTwo: "formatPackedCpgPrivateBeta",
        fact: "packed-cpg-private-fact-one",
        factTwo: "packed-cpg-private-fact-two",
        factThree: "packed-cpg-private-fact-three",
        queryPhrase: "packed cpg private query phrase"
      };
      const CPG_LOCAL = {
        eligible: "PACKED_CPG_ELIGIBLE_SOURCE_MARKER_8a3c",
        testSource: "PACKED_CPG_TEST_SOURCE_MARKER_71de",
        ignoredFile: "PACKED_CPG_IGNORED_MARKER_5d19",
        oversized: "PACKED_CPG_OVERSIZED_MARKER_0f77"
      };
      const cpgCollectPropertyNames = (value, into = new Set()) => {
        if (Array.isArray(value)) value.forEach((entry) => cpgCollectPropertyNames(entry, into));
        else if (value !== null && typeof value === "object") {
          for (const [key, child] of Object.entries(value)) {
            into.add(key);
            cpgCollectPropertyNames(child, into);
          }
        }
        return into;
      };
      // Scientific artifacts and the report minus its display-only previews (a preview legitimately carries a file `rank`).
      const cpgAssertNoRankingOrWinner = (label, value) => {
        for (const name of cpgCollectPropertyNames(value)) {
          if (/winner|^rank$|ranking|bestTreatment|composite|pareto|^score$/i.test(name)) fail(`${gate}_BUNDLED`, `${label} introduces a ranking, winner, composite score or Pareto property: ${name}`);
        }
      };
      const cpgAssertSchemasAndOrder = (execution, analysis, caseIds, label, stage) => {
        if (execution.schemaVersion !== CPG_SCHEMAS.execution) fail(stage, `${label} execution schema is ${execution.schemaVersion}.`);
        if (analysis.schemaVersion !== CPG_SCHEMAS.analysis) fail(stage, `${label} analysis schema is ${analysis.schemaVersion}.`);
        if (JSON.stringify(execution.treatmentOrder) !== JSON.stringify(CPG_TREATMENTS)) fail(stage, `${label} execution treatment order is ${JSON.stringify(execution.treatmentOrder)}.`);
        if (JSON.stringify(execution.cases?.map((entry) => entry.caseId)) !== JSON.stringify(caseIds)) fail(stage, `${label} execution case ids are ${JSON.stringify(execution.cases?.map((entry) => entry.caseId))}.`);
        for (const entry of execution.cases) {
          if (JSON.stringify(entry.treatments?.map((treatment) => treatment.treatmentId)) !== JSON.stringify(CPG_TREATMENTS)) fail(stage, `${label} case ${entry.caseId} treatments are not raw-full-file then context-pack.`);
        }
        if (JSON.stringify(analysis.analysis?.scopes?.map((scope) => scope.scopeId)) !== JSON.stringify(CPG_SCOPES)) fail(stage, `${label} analysis scopes are not overall, localized, cross-module, broad-change.`);
        if (analysis.methodology?.aggregation !== "matched-complete-case-macro-mean" || analysis.methodology?.treatmentComparison !== "paired-descriptive-delta") fail(stage, `${label} analysis methodology is not the frozen one.`);
      };
      // Report section agrees with the persisted analysis (the verifier never recomputes the science).
      const cpgAssertReportAgrees = (section, execution, analysis, label, stage) => {
        if (
          section?.schemaVersion !== CPG_SCHEMAS.report ||
          JSON.stringify(section.treatmentOrder) !== JSON.stringify(CPG_TREATMENTS) ||
          JSON.stringify(section.scopes) !== JSON.stringify(analysis.analysis.scopes) ||
          JSON.stringify(section.methodology) !== JSON.stringify(analysis.methodology) ||
          JSON.stringify(section.cases?.map((entry) => entry.caseId)) !== JSON.stringify(execution.cases.map((entry) => entry.caseId)) ||
          section.cases.some((entry, index) => JSON.stringify(entry.comparison) !== JSON.stringify(analysis.analysis.cases[index].comparison))
        ) {
          fail(stage, `${label} report section does not agree with the persisted execution and analysis artifacts.`);
        }
      };

      // --- Installed flag validation (bundled mode): nonzero, no output, no my-dev-kit call ---
      const cpgRejectLog = path.join(tempRoot, "cpg-reject-kit.log");
      const cpgRejectOut = path.join(dirs.workspace, "cpg-reject", "run");
      const cpgSyntheticConfig = path.join(tempRoot, "cpg-synthetic.json");
      writeFileSync(cpgSyntheticConfig, "{}", "utf8");
      const cpgBadFlagSets = [
        ["--synthetic-config", cpgSyntheticConfig],
        ["--context-budgets", "8k,16k"],
        ["--campaign-preset", "codex-full"],
        ["--include-real-agents"],
        ["--strategy", "context-pack"],
        ["--strategies", "raw-full-file,context-pack"],
        ["--treatment", "context-pack"],
        ["--treatments", "context-pack"],
        ["--selection-policy", "bounded-multiseed-v1"],
        ["--agents", "fake"]
      ];
      for (const badArgs of cpgBadFlagSets) {
        const result = runInstalledCli(cliCommand, dirs.consumer, ["experiment", "run", "--experiment", CPG_ID, "--kit-command", cpgKitCommand, ...badArgs, "--out", cpgRejectOut], { ...envWithBin, CPG_KIT_LOG: cpgRejectLog });
        if (result.status === 0) fail(`${gate}_FLAGS`, `Installed ${CPG_ID} accepted unsupported flag ${badArgs[0]}.`, describeChildResult(result));
        if (existsSync(path.dirname(cpgRejectOut))) fail(`${gate}_FLAGS`, `Rejected flag ${badArgs[0]} still created output.`);
      }
      if (cpgReadKitCalls(cpgRejectLog).length > 0) fail(`${gate}_FLAGS`, "A rejected installed flag combination still invoked my-dev-kit.");
      console.log(`CONTEXT_PACK_GENERATION_FLAGS: PASS (installed bin rejected ${cpgBadFlagSets.length} unsupported flag sets: nonzero exit, no output, no my-dev-kit call)`);

      // --- Bundled run over the packaged corpus with the deterministic kit ---
      const cpgBundledOut = path.join(dirs.workspace, "cpg-bundled", "run");
      const cpgBundledLog = path.join(tempRoot, "cpg-bundled-kit.log");
      const cpgBundledRun = runInstalledCli(
        cliCommand,
        dirs.consumer,
        ["experiment", "run", "--experiment", CPG_ID, "--case", CPG_BUNDLED_CASE, "--kit-command", cpgKitCommand, "--out", cpgBundledOut],
        { ...envWithBin, CPG_KIT_LOG: cpgBundledLog }
      );
      if (cpgBundledRun.status !== 0) fail(`${gate}_BUNDLED`, `Installed bundled ${CPG_ID} run did not exit 0.`, describeChildResult(cpgBundledRun));
      assertOutputOutsidePackage(cpgBundledOut, installedPackageRoot, `${CPG_ID} bundled run`);
      const cpgPackRelative = `packs/${CPG_BUNDLED_CASE}.context-pack.json`;
      for (const name of [CPG_EXECUTION_FILE, CPG_ANALYSIS_FILE, "report.json", "report.html", "report.txt", cpgPackRelative]) requireNonEmptyFile(path.join(cpgBundledOut, ...name.split("/")), `${gate}_BUNDLED`);
      const cpgBundledExecution = readJsonFile(path.join(cpgBundledOut, CPG_EXECUTION_FILE), `${gate}_BUNDLED`);
      const cpgBundledAnalysis = readJsonFile(path.join(cpgBundledOut, CPG_ANALYSIS_FILE), `${gate}_BUNDLED`);
      const cpgBundledReport = readJsonFile(path.join(cpgBundledOut, "report.json"), `${gate}_BUNDLED`);
      const cpgBundledPack = readJsonFile(path.join(cpgBundledOut, ...cpgPackRelative.split("/")), `${gate}_BUNDLED`);
      cpgAssertSchemasAndOrder(cpgBundledExecution, cpgBundledAnalysis, [CPG_BUNDLED_CASE], "Installed bundled", `${gate}_BUNDLED`);
      if (cpgBundledPack.schemaVersion !== CPG_SCHEMAS.pack || cpgBundledPack.caseId !== CPG_BUNDLED_CASE) fail(`${gate}_BUNDLED`, `Installed bundled pack artifact schema is ${cpgBundledPack.schemaVersion}.`);
      if (cpgBundledExecution.cases[0].identityRedaction !== undefined) fail(`${gate}_BUNDLED`, "Bundled execution evidence carries an external-local redaction marker.");
      const cpgBundledCalls = cpgReadKitCalls(cpgBundledLog);
      if (cpgBundledCalls.filter((call) => call.argv[0] === "index").length !== 1 || cpgBundledCalls.filter((call) => call.argv[0] === "search").length !== 1) {
        fail(`${gate}_BUNDLED`, "The bundled run did not build exactly one index and run exactly one search for the one selected case.");
      }
      if (!cpgBundledCalls.some((call) => call.argv[0] === "index" && call.argv.includes("--call-graph"))) fail(`${gate}_BUNDLED`, "The bundled run did not request a call-graph index for context-pack retrieval.");
      cpgAssertNoRankingOrWinner("Installed bundled analysis artifact", cpgBundledAnalysis);
      console.log("CONTEXT_PACK_GENERATION_BUNDLED: PASS (installed bin; packaged corpus; one index and one search; execution, analysis and pack artifacts with the exact schemas; raw-full-file then context-pack; no ranking, winner or composite score)");

      // --- Installed reports (bundled) ---
      const cpgSection = cpgBundledReport.report?.contextPackGeneration;
      cpgAssertNoRankingOrWinner("Installed bundled report section", { ...cpgSection, previews: undefined });
      cpgAssertReportAgrees(cpgSection, cpgBundledExecution, cpgBundledAnalysis, "Installed bundled", `${gate}_REPORT`);
      const cpgHtml = readFileSync(path.join(cpgBundledOut, "report.html"), "utf8");
      const cpgText = readFileSync(path.join(cpgBundledOut, "report.txt"), "utf8");
      for (const [label, output] of [["report.html", cpgHtml], ["report.txt", cpgText]]) {
        for (const required of ["Context Pack Generation", "raw-full-file", "context-pack", "localized", CPG_BUNDLED_CASE]) {
          if (!output.includes(required)) fail(`${gate}_REPORT`, `Installed ${label} does not contain "${required}".`);
        }
      }
      for (const required of ["Per-Case Treatments", "Scope Aggregates", "Context Pack Preview", "Interpretation Limits", "estimatedTokens", "factCoverage"]) {
        if (!cpgText.includes(required)) fail(`${gate}_REPORT`, `Installed report.txt does not contain "${required}".`);
      }
      if (cpgSection.previews?.length !== 1 || cpgSection.previews[0].status !== "available" || cpgSection.previews[0].caseId !== CPG_BUNDLED_CASE) {
        fail(`${gate}_REPORT`, `Installed bundled report does not carry one available pack preview: ${JSON.stringify(cpgSection.previews?.map((preview) => preview.status))}`);
      }
      const cpgPreview = cpgSection.previews[0];
      for (const [list, limit] of [["files", CPG_PREVIEW_LIMITS.files], ["symbols", CPG_PREVIEW_LIMITS.symbols], ["sourceSlices", CPG_PREVIEW_LIMITS.sourceSlices], ["callRelationships", CPG_PREVIEW_LIMITS.callRelationships], ["tests", CPG_PREVIEW_LIMITS.tests], ["evidenceNotes", CPG_PREVIEW_LIMITS.evidenceNotes]]) {
        const shown = cpgPreview[list];
        if (!shown || shown.items.length > limit || shown.items.length + shown.omittedCount !== shown.totalCount) fail(`${gate}_REPORT`, `Installed preview list ${list} is not bounded (limit ${limit}): ${JSON.stringify({ shown: shown?.items?.length, total: shown?.totalCount, omitted: shown?.omittedCount })}`);
      }
      for (const slice of cpgPreview.sourceSlices.items) {
        if (slice.previewLineCount > CPG_PREVIEW_LIMITS.linesPerSlice || slice.previewText.split("\n").length > CPG_PREVIEW_LIMITS.linesPerSlice) fail(`${gate}_REPORT`, "Installed preview source slice exceeds the display line limit.");
      }
      if (cpgPreview.sourceSlices.totalCount !== cpgBundledPack.sourceSlices.length) fail(`${gate}_REPORT`, "Installed preview source-slice total disagrees with the persisted pack artifact.");
      if (cpgBundledPack.size === null || cpgBundledPack.size === undefined) fail(`${gate}_REPORT`, "Installed pack artifact has no size evidence.");
      // HTML escaping through the installed renderer: any previewed source line containing HTML-significant characters must appear escaped only.
      const cpgHtmlEscape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      const cpgSpecialLines = cpgPreview.sourceSlices.items.flatMap((slice) => slice.previewText.split("\n")).filter((line) => /[<>&"']/.test(line) && line.trim().length > 0);
      for (const line of cpgSpecialLines) {
        if (!cpgHtml.includes(cpgHtmlEscape(line))) fail(`${gate}_REPORT`, "Installed report.html did not contain the HTML-escaped form of a previewed source line.");
        if (/[<>]/.test(line) && cpgHtml.includes(line)) fail(`${gate}_REPORT`, "Installed report.html contains a previewed source line unescaped.");
      }
      if (cpgSection === null || cpgSection === undefined) fail(`${gate}_REPORT`, "Installed report.json contextPackGeneration section is null.");
      console.log(`CONTEXT_PACK_GENERATION_REPORT: PASS (installed report.json typed section agrees with persisted analysis; report.txt and report.html present; bounded preview within limits; ${cpgSpecialLines.length} previewed lines with HTML-significant characters checked for escaping)`);

      // --- External-local: one disposable Git repository outside the installed package ---
      const cpgArea = path.join(tempRoot, "cpg local subject area");
      const cpgTarget = path.join(cpgArea, "target repo", "inner project");
      const cpgConfigPath = path.join(cpgArea, "config dir", "local subject.json");
      const cpgLog = path.join(tempRoot, "cpg-local-kit.log");
      const cpgGitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
      for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]) delete cpgGitEnv[key];
      const cpgGit = (...args) => {
        const result = spawnSync("git", ["-c", "user.name=Packed Gate", "-c", "user.email=packed-gate@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: cpgTarget, encoding: "utf8", env: cpgGitEnv });
        if (result.status !== 0) fail(gate, `git ${args[0]} failed while preparing the disposable context-pack subject.`, describeChildResult(result));
        return result.stdout;
      };
      const cpgWrite = (relative, content) => {
        const absolute = path.join(cpgTarget, ...relative.split("/"));
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, content, "utf8");
      };
      mkdirSync(cpgTarget, { recursive: true });
      cpgGit("init", "-q", "-b", "main");
      cpgWrite(".gitignore", "src/private notes.ts\n");
      cpgWrite(
        "src/app/taskModel.ts",
        `export function ${CPG_MARKERS.symbol}(title: string): string {\n  // ${CPG_LOCAL.eligible}\n  return title.trim();\n}\n`
      );
      cpgWrite(
        "src/app/util/format.ts",
        `import { ${CPG_MARKERS.symbol} } from "../taskModel";\n\nexport function ${CPG_MARKERS.symbolTwo}(title: string): string {\n  return ${CPG_MARKERS.symbol}(title) + ":done";\n}\n`
      );
      cpgWrite(
        "src/app/taskModel.test.ts",
        `import { ${CPG_MARKERS.symbol} } from "./taskModel";\n\nexport function packedCpgPrivateTest(): boolean {\n  // ${CPG_LOCAL.testSource}\n  return ${CPG_MARKERS.symbol}(" x ") === "x";\n}\n`
      );
      cpgWrite("src/huge file.ts", `// ${CPG_LOCAL.oversized}\n${"x".repeat(1_048_576 + 100)}\n`);
      cpgGit("add", "-A");
      cpgGit("commit", "-q", "-m", "packed fixture");
      cpgWrite("src/private notes.ts", `export const privateNotes = 1; // ${CPG_LOCAL.ignoredFile}\n`);
      const cpgAnswerKey = (files, symbols, facts, targets) => ({
        expectedFiles: files,
        expectedSymbols: symbols,
        expectedFacts: facts.map((id) => ({ id, text: "private fact text that is never persisted", weight: 1, required: true })),
        expectedContextTargets: targets,
        minimumCorrectFacts: 1
      });
      mkdirSync(path.dirname(cpgConfigPath), { recursive: true });
      writeFileSync(
        cpgConfigPath,
        JSON.stringify({
          schemaVersion: "1.0.0",
          subjectId: "packed-cpg-subject",
          cases: [
            {
              id: "packed-cpg-case-one",
              title: CPG_MARKERS.title,
              sourceRoots: ["src"],
              query: `Where are ${CPG_MARKERS.symbol} and ${CPG_MARKERS.symbolTwo} defined? ${CPG_MARKERS.queryPhrase}`,
              expectedFiles: ["src/app/taskModel.ts", "src/app/util/format.ts"],
              expectedSymbols: [CPG_MARKERS.symbol, CPG_MARKERS.symbolTwo],
              rawIncludeGlobs: ["src/**/*"],
              taskLocality: "cross-module",
              answerKey: cpgAnswerKey(
                ["src/app/taskModel.ts", "src/app/util/format.ts"],
                [CPG_MARKERS.symbol, CPG_MARKERS.symbolTwo],
                [CPG_MARKERS.fact, CPG_MARKERS.factTwo],
                [
                  { file: "src/app/taskModel.ts", symbols: [CPG_MARKERS.symbol], required: true, factIds: [CPG_MARKERS.fact] },
                  { file: "src/app/util/format.ts", symbols: [CPG_MARKERS.symbolTwo], required: true, factIds: [CPG_MARKERS.factTwo] }
                ]
              )
            },
            {
              id: "packed-cpg-case-two",
              title: CPG_MARKERS.titleTwo,
              sourceRoots: ["src/app/util"],
              query: `Where is ${CPG_MARKERS.symbolTwo} defined?`,
              expectedFiles: ["src/app/util/format.ts"],
              expectedSymbols: [CPG_MARKERS.symbolTwo],
              rawIncludeGlobs: ["src/app/util/**/*"],
              taskLocality: "localized",
              answerKey: cpgAnswerKey(
                ["src/app/util/format.ts"],
                [CPG_MARKERS.symbolTwo],
                [CPG_MARKERS.factThree],
                [{ file: "src/app/util/format.ts", symbols: [CPG_MARKERS.symbolTwo], required: true, factIds: [CPG_MARKERS.factThree] }]
              )
            }
          ]
        }),
        "utf8"
      );
      const cpgConfigBefore = readFileSync(cpgConfigPath, "utf8");
      const cpgTargetBefore = await snapshotDirectory(cpgTarget);
      const cpgStatusBefore = cpgGit("status", "--porcelain=v1", "--ignored");
      const cpgHeadBefore = cpgGit("rev-parse", "HEAD").trim();
      const cpgRunArgs = (extra) => ["experiment", "run", "--experiment", CPG_ID, ...extra];
      const cpgOut = path.join(dirs.workspace, "cpg local out", "run");
      const cpgRealOut = path.join(dirs.workspace, "cpg real out", "run");
      const cpgSentinels = [
        ...[cpgTarget, cpgArea, path.dirname(cpgConfigPath), cpgOut, path.dirname(cpgOut), cpgRealOut, path.dirname(cpgRealOut), dirs.workspace, dirs.consumer, dirs.fakeKit, installedPackageRoot, tempRoot, os.tmpdir(), os.homedir(), REPO_ROOT].map(
          (value) => ({ label: "private path", value, kind: "path" })
        ),
        ...Object.entries({ ...CPG_MARKERS, ...CPG_LOCAL }).map(([label, value]) => ({ label: `marker ${label}`, value, kind: "text" })),
        ...["private notes.ts", "huge file.ts", "src/app/taskModel.ts", "src/app/util/format.ts", "src/app/taskModel.test.ts", "taskModel.ts", "taskModel.test.ts", "format.ts", "packedCpgPrivateTest", "inner project", "target repo", "fake-context-pack-kit", "symbol:src/", "file:src/"].map((value) => ({ label: `name ${value}`, value, kind: "text" }))
      ];
      const expectCpgTargetUntouched = async (label) => {
        const diff = diffSnapshots(cpgTargetBefore, await snapshotDirectory(cpgTarget));
        if (diff.length > 0) fail(`${gate}_IMMUTABILITY`, `${label} mutated the target: ${diff.join(", ")}`);
        if (cpgGit("status", "--porcelain=v1", "--ignored") !== cpgStatusBefore || cpgGit("rev-parse", "HEAD").trim() !== cpgHeadBefore || readFileSync(cpgConfigPath, "utf8") !== cpgConfigBefore) {
          fail(`${gate}_IMMUTABILITY`, `${label} changed the target Git state or its config.`);
        }
      };

      // Mode-matrix and output-boundary rejections: nonzero, no output, no my-dev-kit call, target untouched.
      const cpgUnsafeInside = path.join(cpgTarget, "lab-out");
      const cpgNegativeCases = [
        ["target-without-config", ["--target", cpgTarget, "--out", cpgOut]],
        ["config-without-target", ["--local-subject-config", cpgConfigPath, "--out", cpgOut]],
        ["case-in-external-mode", ["--target", cpgTarget, "--local-subject-config", cpgConfigPath, "--case", "packed-cpg-case-one", "--out", cpgOut]],
        ["benchmark-project-in-external-mode", ["--target", cpgTarget, "--local-subject-config", cpgConfigPath, "--benchmark-project", "packed-cpg-subject", "--out", cpgOut]],
        ["output-inside-target", ["--target", cpgTarget, "--local-subject-config", cpgConfigPath, "--out", cpgUnsafeInside]],
        ["output-equals-target", ["--target", cpgTarget, "--local-subject-config", cpgConfigPath, "--out", cpgTarget]]
      ];
      for (const [label, args] of cpgNegativeCases) {
        const result = runInstalledCli(cliCommand, dirs.consumer, cpgRunArgs([...args, "--kit-command", cpgKitCommand]), { ...envWithBin, CPG_KIT_LOG: cpgLog });
        if (result.status === 0) fail(`${gate}_EXTERNAL_REJECTIONS`, `Installed negative case ${label} exited 0.`, describeChildResult(result));
        if (existsSync(cpgUnsafeInside) || (existsSync(path.dirname(cpgOut)) && readdirSync(path.dirname(cpgOut)).length > 0)) {
          fail(`${gate}_EXTERNAL_REJECTIONS`, `Installed negative case ${label} created output.`);
        }
        await expectCpgTargetUntouched(`Installed negative case ${label}`);
      }
      if (cpgReadKitCalls(cpgLog).length > 0) fail(`${gate}_EXTERNAL_REJECTIONS`, "A rejected installed run still invoked my-dev-kit.");
      console.log(`CONTEXT_PACK_GENERATION_EXTERNAL_REJECTIONS: PASS (${cpgNegativeCases.length} installed boundary cases: nonzero exit, no output, no my-dev-kit call, target unchanged)`);

      // Shared external-local assertions for the deterministic-kit run and the real-kit run.
      const cpgAssertExternalOutput = (out, label, stage) => {
        const entries = readdirSync(out).sort();
        if (JSON.stringify(entries) !== JSON.stringify(CPG_EXTERNAL_FAMILY)) fail(stage, `${label} output is not exactly the approved durable family (pack, scratch or index files remained): ${entries.join(", ")}`);
        for (const name of CPG_EXTERNAL_FAMILY) requireNonEmptyFile(path.join(out, name), stage);
        const execution = readJsonFile(path.join(out, CPG_EXECUTION_FILE), stage);
        const analysis = readJsonFile(path.join(out, CPG_ANALYSIS_FILE), stage);
        const manifest = readJsonFile(path.join(out, CPG_MANIFEST_FILE), stage);
        const report = readJsonFile(path.join(out, "report.json"), stage);
        cpgAssertSchemasAndOrder(execution, analysis, ["packed-cpg-case-one", "packed-cpg-case-two"], label, stage);
        if (execution.cases.some((entry) => entry.caseName !== "<redacted case title>" || entry.identityRedaction?.semanticNodeIds !== "redacted" || entry.identityRedaction?.sourceText !== "redacted")) fail(stage, `${label} execution evidence lacks the external-local redaction marker.`);
        if (execution.cases.some((entry) => entry.treatments.some((treatment) => treatment.packArtifactPath !== null || (treatment.includedFiles ?? []).length > 0 || treatment.identityEvidence != null))) fail(stage, `${label} execution evidence carries a pack path or identity lists.`);
        if (analysis.analysis.scopes[0].caseCount !== 2 || analysis.analysis.scopes[1].caseCount !== 1 || analysis.analysis.scopes[2].caseCount !== 1) fail(stage, `${label} analysis scope case counts do not match the two configured cases.`);
        if (manifest.schemaId !== "my-dev-kit-lab-local-repository-subject-manifest-v1" || manifest.subjectId !== "packed-cpg-subject" || manifest.repository?.commit !== cpgHeadBefore) fail(stage, `${label} subject manifest is not the expected privacy-safe manifest.`);
        const section = report.report?.contextPackGeneration;
        cpgAssertReportAgrees(section, execution, analysis, label, stage);
        if (report.report?.plugin?.id !== CPG_ID || report.report?.target?.kind !== "external-local" || report.report?.target?.targetRoot !== "local-repository:packed-cpg-subject" || report.report?.target?.toolRoot !== "[redacted]" || report.report?.metadata?.outputRoot !== "[redacted]") {
          fail(stage, `${label} report does not carry the redacted external-local target and output roots.`);
        }
        // Absence of a pack body is intentional: the preview is redacted, never "pack-artifact-unavailable".
        if (section.previews?.length !== 2 || section.previews.some((preview) => preview.status !== "redacted-external-local" || preview.packArtifactPath !== null || preview.task !== null || preview.files !== null || preview.symbols !== null || preview.sourceSlices !== null)) {
          fail(stage, `${label} report previews are not the redacted external-local previews: ${JSON.stringify(section.previews?.map((preview) => preview.status))}`);
        }
        const html = readFileSync(path.join(out, "report.html"), "utf8");
        const text = readFileSync(path.join(out, "report.txt"), "utf8");
        for (const [name, output] of [["report.json", JSON.stringify(report)], ["report.html", html], ["report.txt", text]]) {
          if (output.includes("pack-artifact-unavailable")) fail(stage, `${label} ${name} renders the intentional absence of a pack body as pack-artifact-unavailable.`);
        }
        for (const [name, output] of [["report.html", html], ["report.txt", text]]) {
          for (const required of ["Context Pack Generation", "redacted-external-local", "title and summary redacted", "identities redacted", "content redacted"]) {
            if (!output.includes(required)) fail(stage, `${label} ${name} does not contain the fixed redaction wording "${required}".`);
          }
        }
        return { execution, analysis, report, section };
      };

      // External-local success with the deterministic kit: observable index/exclusion/scratch behavior.
      writeFileSync(cpgLog, "", "utf8");
      const cpgFakeRun = runInstalledCli(
        cliCommand,
        dirs.consumer,
        cpgRunArgs(["--target", cpgTarget, "--local-subject-config", cpgConfigPath, "--kit-command", cpgKitCommand, "--out", cpgOut]),
        { ...envWithBin, CPG_KIT_LOG: cpgLog }
      );
      if (cpgFakeRun.status !== 0) fail(`${gate}_EXTERNAL`, "Installed external-local run with the deterministic kit did not exit 0.", describeChildResult(cpgFakeRun));
      assertOutputOutsidePackage(cpgOut, installedPackageRoot, `${CPG_ID} external-local deterministic-kit run`);
      if (!path.relative(cpgTarget, cpgOut).startsWith("..")) fail(`${gate}_EXTERNAL`, "Lab output was written inside the inspected target.");
      cpgAssertExternalOutput(cpgOut, "Deterministic-kit external-local", `${gate}_EXTERNAL`);
      const cpgIndexCalls = cpgReadKitCalls(cpgLog).filter((call) => call.argv[0] === "index");
      const cpgSourceRoots = cpgIndexCalls.map((call) => call.argv.flatMap((value, index) => (value === "--src" ? [call.argv[index + 1]] : [])));
      if (cpgIndexCalls.length !== 2 || JSON.stringify(cpgSourceRoots) !== JSON.stringify([["src"], ["src/app/util"]])) {
        fail(`${gate}_EXTERNAL`, `Expected one private base index per configured case with exactly that case's source roots, got ${JSON.stringify(cpgSourceRoots)}.`);
      }
      const cpgPhysicalOut = realpathSync.native(cpgOut);
      for (const call of cpgIndexCalls) {
        const excluded = call.argv.flatMap((value, index) => (value === "--exclude" ? [call.argv[index + 1]] : []));
        for (const required of ["src/huge file.ts", "src/private notes.ts"]) {
          if (!excluded.includes(required)) fail(`${gate}_EXTERNAL`, `A case index did not receive the exact exclusion ${required}.`);
        }
        const indexOut = call.argv[call.argv.indexOf("--out") + 1];
        // Scratch lives beneath the output root only while the run is in progress; it must be gone afterward (checked below and by the exact family).
        if (segmentsBeneathRoot(cpgPhysicalOut, indexOut) === null) fail(`${gate}_EXTERNAL`, "A private index was not built in private scratch beneath the run output root.");
        if (!path.relative(cpgTarget, indexOut).startsWith("..")) fail(`${gate}_EXTERNAL`, "A private index was built inside the inspected target.");
        if (existsSync(indexOut)) fail(`${gate}_EXTERNAL`, "A private scratch index remained after the run.");
        cpgSentinels.push({ label: "private index path", value: indexOut, kind: "path" }, { label: "private scratch path", value: path.dirname(indexOut), kind: "path" });
      }
      const cpgFakeLeaks = privacyScan.scanDurableOutputDirectory(cpgOut, cpgSentinels);
      if (cpgFakeLeaks.length > 0) fail(`${gate}_PRIVACY`, `Durable installed external-local output (deterministic kit) leaks private values: ${JSON.stringify(cpgFakeLeaks)}`);
      await expectCpgTargetUntouched("Installed external-local run with the deterministic kit");
      for (const forbidden of [".my-dev-kit", ".my-dev-kit-lab", "lab-output", "lab-out"]) {
        if (existsSync(path.join(cpgTarget, forbidden))) fail(`${gate}_IMMUTABILITY`, `Lab artifacts appeared inside the target: ${forbidden}`);
      }
      console.log(`CONTEXT_PACK_GENERATION_EXTERNAL: PASS (installed bin; deterministic kit; one private base index per case with exact roots and exclusions outside target and output; exact durable family; redacted previews; space-containing paths; output path length ${cpgOut.length})`);

      // --- REAL published my-dev-kit: bounded compatibility smoke (bundled and external-local) ---
      if (!realKitCommand.includes(upstreamBin)) fail(`${gate}_REAL_MY_DEV_KIT`, `Kit command is not the installed real published upstream binary: ${realKitCommand}`);
      const cpgRealBundledOut = path.join(dirs.workspace, "cpg real bundled", "run");
      const cpgRealBundled = runInstalledCli(
        cliCommand,
        dirs.consumer,
        cpgRunArgs(["--case", CPG_BUNDLED_CASE, "--kit-command", realKitCommand, "--out", cpgRealBundledOut]),
        envWithBin
      );
      if (cpgRealBundled.status !== 0) fail(`${gate}_REAL_MY_DEV_KIT`, `Installed bundled run with the real ${UPSTREAM_MY_DEV_KIT_SPEC} did not exit 0.`, describeChildResult(cpgRealBundled));
      assertOutputOutsidePackage(cpgRealBundledOut, installedPackageRoot, `${CPG_ID} bundled real-kit run`);
      const cpgRealBundledExecution = readJsonFile(path.join(cpgRealBundledOut, CPG_EXECUTION_FILE), `${gate}_REAL_MY_DEV_KIT`);
      const cpgRealBundledAnalysis = readJsonFile(path.join(cpgRealBundledOut, CPG_ANALYSIS_FILE), `${gate}_REAL_MY_DEV_KIT`);
      cpgAssertSchemasAndOrder(cpgRealBundledExecution, cpgRealBundledAnalysis, [CPG_BUNDLED_CASE], "Real-kit bundled", `${gate}_REAL_MY_DEV_KIT`);
      const cpgRealBundledPackTreatment = cpgRealBundledExecution.cases[0].treatments[1];
      const cpgRealStepKinds = (treatment) => new Set(treatment.steps.filter((step) => step.succeeded).map((step) => step.kind));
      if (!["completed", "partial"].includes(cpgRealBundledPackTreatment.status) || !cpgRealStepKinds(cpgRealBundledPackTreatment).has("search") || !cpgRealStepKinds(cpgRealBundledPackTreatment).has("source") || cpgRealBundledPackTreatment.size === null) {
        fail(`${gate}_REAL_MY_DEV_KIT`, `Real-kit bundled context-pack treatment did not complete index, search and bounded source retrieval: ${JSON.stringify({ status: cpgRealBundledPackTreatment.status, steps: [...cpgRealStepKinds(cpgRealBundledPackTreatment)] })}`);
      }
      const cpgRealBundledPack = readJsonFile(path.join(cpgRealBundledOut, ...cpgPackRelative.split("/")), `${gate}_REAL_MY_DEV_KIT`);
      if (cpgRealBundledPack.schemaVersion !== CPG_SCHEMAS.pack) fail(`${gate}_REAL_MY_DEV_KIT`, "Real-kit bundled pack artifact has the wrong schema.");
      const cpgRealBundledReport = readJsonFile(path.join(cpgRealBundledOut, "report.json"), `${gate}_REAL_MY_DEV_KIT`);
      cpgAssertReportAgrees(cpgRealBundledReport.report?.contextPackGeneration, cpgRealBundledExecution, cpgRealBundledAnalysis, "Real-kit bundled", `${gate}_REAL_MY_DEV_KIT`);

      const cpgRealRun = runInstalledCli(
        cliCommand,
        dirs.consumer,
        cpgRunArgs(["--target", cpgTarget, "--local-subject-config", cpgConfigPath, "--kit-command", realKitCommand, "--out", cpgRealOut]),
        envWithBin
      );
      if (cpgRealRun.status !== 0) fail(`${gate}_REAL_MY_DEV_KIT`, `Installed external-local run with the real ${UPSTREAM_MY_DEV_KIT_SPEC} did not exit 0.`, describeChildResult(cpgRealRun));
      assertOutputOutsidePackage(cpgRealOut, installedPackageRoot, `${CPG_ID} external-local real-kit run`);
      if (!path.relative(cpgTarget, cpgRealOut).startsWith("..")) fail(`${gate}_EXTERNAL`, "Lab output was written inside the inspected target.");
      const cpgReal = cpgAssertExternalOutput(cpgRealOut, "Real-kit external-local", `${gate}_REAL_MY_DEV_KIT`);
      for (const entry of cpgReal.execution.cases) {
        const packTreatment = entry.treatments[1];
        if (!["completed", "partial"].includes(packTreatment.status) || !cpgRealStepKinds(packTreatment).has("search") || packTreatment.size === null) {
          fail(`${gate}_REAL_MY_DEV_KIT`, `Real-kit external-local context-pack treatment for ${entry.caseId} did not complete retrieval: ${packTreatment.status}`);
        }
      }
      // Structural redaction proof (substring search would collide with short identifiers).
      for (const entry of cpgReal.analysis.analysis.cases) {
        for (const treatment of entry.treatments) {
          const quality = treatment.quality;
          if (!quality) continue;
          for (const list of [quality.symbol?.relevantRetrievedSymbols, quality.symbol?.irrelevantRetrievedSymbols, quality.symbol?.missedSymbols]) {
            for (const item of list ?? []) if (!/^<redacted symbol \d+>$/.test(item)) fail(`${gate}_PRIVACY`, "A real-kit quality symbol identity was not redacted.");
          }
          for (const list of [quality.fact?.coveredFactIds, quality.fact?.uncoveredFactIds]) {
            for (const item of list ?? []) if (!/^<redacted fact \d+>$/.test(item)) fail(`${gate}_PRIVACY`, "A real-kit quality fact identity was not redacted.");
          }
        }
      }
      const cpgRealLeaks = privacyScan.scanDurableOutputDirectory(cpgRealOut, cpgSentinels);
      if (cpgRealLeaks.length > 0) fail(`${gate}_PRIVACY`, `Durable installed external-local output (real my-dev-kit) leaks private values: ${JSON.stringify(cpgRealLeaks)}`);
      await expectCpgTargetUntouched("Installed external-local run with the real my-dev-kit");
      for (const forbidden of [".my-dev-kit", ".my-dev-kit-lab", "lab-output", "lab-out"]) {
        if (existsSync(path.join(cpgTarget, forbidden))) fail(`${gate}_IMMUTABILITY`, `Lab artifacts appeared inside the target: ${forbidden}`);
      }
      console.log(`CONTEXT_PACK_GENERATION_REAL_MY_DEV_KIT: PASS (installed bin; real ${UPSTREAM_MY_DEV_KIT_SPEC}; bundled one-case run with index, search, bounded source and pack artifact; external-local two-case run with redacted durable family and no pack body; no quality threshold asserted)`);
      console.log("CONTEXT_PACK_GENERATION_PRIVACY: PASS (every durable external-local file scanned: raw, separator, JSON-escaped and HTML-escaped path forms; markers; file, symbol, node-id, test, fact, task and title identities; source text; scratch and index paths; deterministic and real my-dev-kit outputs)");
      console.log("CONTEXT_PACK_GENERATION_IMMUTABILITY: PASS (target tree, Git status/HEAD and config unchanged after rejections, deterministic and real runs; scratch removed; no Lab output in target)");
    }

    // -----------------------------------------------------------------
    // 9c-7. v0.9.0 agent-success-rate installed-package acceptance. The same
    // exact tarball and installed binary as every gate above; implemented in
    // scripts/verifyPackedPackageAgentSuccess.mjs. Deterministic fake providers
    // only -- no real coding agent is ever invoked.
    // -----------------------------------------------------------------
    await runAgentSuccessPackedAcceptance({
      fail,
      describeChildResult,
      runInstalledCli,
      cliCommand,
      envWithBin,
      consumerBinDir: path.join(dirs.consumer, "node_modules", ".bin"),
      repoRoot: REPO_ROOT,
      tempRoot,
      installedPackageRoot,
      tarballFiles,
      snapshotDirectory,
      diffSnapshots,
      writeFakeAgentLauncher,
      isolatedProviderEnv,
      codexArgs: CODEX_STDIN_ARGS,
      claudeArgs: CLAUDE_STDIN_ARGS
    });

    // -----------------------------------------------------------------
    // 9d. v0.5.2 real-agent campaign acceptance. Deterministic local fake
    // Codex/Claude providers only -- no real provider is ever invoked. Every
    // scenario runs inside the same installed-package-immutability window
    // proven at step 10, so a campaign leaking output into the installed
    // package would already be caught there.
    // -----------------------------------------------------------------
    process.stderr.write(`[diagnostic] entering campaign acceptance at ${new Date().toISOString()} (${Date.now() - gateStartedAt}ms since gate start)\n`);
    await writeFakeAgentBinaries(dirs.fakeAgents, dirs.fakeAgentsBin);
    const providerLogPath = path.join(dirs.fakeAgents, "invocations.jsonl");
    const readProviderLog = () =>
      existsSync(providerLogPath)
        ? readFileSync(providerLogPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
        : [];
    const clearProviderLog = () => writeFileSync(providerLogPath, "", "utf8");

    // On POSIX, resolveCommand() resolves the installed CLI to its bare name (not an absolute
    // path) for a "direct" resolution kind, so spawning it still depends on PATH containing the
    // consumer's own node_modules/.bin at spawn time -- unlike Windows, where every resolution kind
    // yields an absolute command. Provider-PATH isolation must narrow which *providers* (codex/
    // claude) can be discovered without breaking discovery of the CLI binary itself.
    const consumerBinDir = path.join(dirs.consumer, "node_modules", ".bin");
    function campaignEnv({ mode = "success", failMatch, playwrightBrowsersPath, extraBinDirs = [dirs.fakeAgentsBin] } = {}) {
      const env = {
        ...isolatedProviderEnv(envWithBin, [consumerBinDir, ...extraBinDirs]),
        [FAKE_AGENT_MODE_ENV]: mode,
        [FAKE_AGENT_LOG_ENV]: providerLogPath
      };
      if (failMatch) env[FAKE_AGENT_FAIL_MATCH_ENV] = failMatch;
      if (playwrightBrowsersPath !== undefined) env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath;
      return env;
    }

    function campaignArgs(preset, outDir, extra = []) {
      return [
        "experiment", "run",
        "--experiment", "warm-index-reuse",
        "--campaign", preset,
        "--include-real-agents",
        "--kit-command", fakeKitCommand,
        "--out", outDir,
        ...extra
      ];
    }

    function readCampaignReport(outDir) {
      return JSON.parse(readFileSync(path.join(outDir, "report.json"), "utf8")).report;
    }

    function runCampaignScenario(gate, args, env) {
      clearProviderLog();
      const result = runInstalledCli(cliCommand, dirs.consumer, args, env);
      if (result.status !== 0) {
        fail(gate, "Installed campaign command did not exit 0.", describeChildResult(result));
      }
      return { result, log: readProviderLog() };
    }

    function requireCampaignReportFiles(gate, outDir) {
      for (const name of ["warm-index-execution.json", "report.json", "report.txt", "report.html"]) {
        requireNonEmptyFile(path.join(outDir, name), gate);
      }
    }

    function requireFourCampaignCharts(gate, outDir) {
      requireNonEmptyFile(path.join(outDir, "plots", "plot-data.json"), gate);
      requireNonEmptyFile(path.join(outDir, "plots", "plots-summary.json"), gate);
      const plotSummary = JSON.parse(readFileSync(path.join(outDir, "plots", "plots-summary.json"), "utf8"));
      if (plotSummary.chartCount !== WARM_INDEX_CHARTS.length) {
        fail(gate, `Expected ${WARM_INDEX_CHARTS.length} warm-index campaign charts, got ${plotSummary.chartCount}.`);
      }
      for (const chart of WARM_INDEX_CHARTS) {
        const chartPath = path.join(outDir, "plots", "charts", chart);
        requireNonEmptyFile(chartPath, gate);
        if (!readFileSync(chartPath, "utf8").includes("<svg")) {
          fail(gate, `Campaign chart is not SVG markup: ${chart}`);
        }
      }
    }

    function requireCampaignGallery(gate, outDir) {
      requireNonEmptyFile(path.join(outDir, "gallery", "gallery-manifest.json"), gate);
      requireNonEmptyFile(path.join(outDir, "gallery", "gallery-index.html"), gate);
      const manifest = JSON.parse(readFileSync(path.join(outDir, "gallery", "gallery-manifest.json"), "utf8"));
      const problems = validateWarmIndexCampaignGalleryManifest(manifest);
      if (problems.length > 0) {
        fail("WARM_INDEX_CAMPAIGN_GALLERY", problems.join("; "));
      }
      return manifest;
    }

    function requireNoBoundedArtifactLeak(gate, outDir) {
      const candidatePaths = [
        path.join(outDir, "report.json"),
        path.join(outDir, "report.txt"),
        path.join(outDir, "report.html"),
        path.join(outDir, "warm-index-execution.json"),
        path.join(outDir, "plots", "plot-data.json"),
        path.join(outDir, "gallery", "gallery-manifest.json"),
        path.join(outDir, "gallery", "gallery-index.html")
      ].filter(existsSync);
      for (const filePath of candidatePaths) {
        const text = readFileSync(filePath, "utf8");
        for (const forbidden of ["contextText", "promptText", "finalAnswerText", FAKE_KIT_SOURCE_TEXT, '"stdout"', '"stderr"']) {
          if (text.includes(forbidden)) {
            fail(gate, `${path.relative(outDir, filePath)} contains forbidden content: ${forbidden}`);
          }
        }
      }
    }

    function requireProviderArgvPrivacy(gate, log) {
      for (const entry of log) {
        const joined = entry.argv.join(" ");
        if (/answer:|relevantFiles:|BEGIN_SUPPLIED_CONTEXT/i.test(joined)) {
          fail(gate, `Provider argv appears to contain prompt or context content: ${joined}`);
        }
      }
    }

    function requireFrozenProviderFlags(gate, log, expectedArgv) {
      for (const entry of log) {
        if (JSON.stringify(entry.argv) !== JSON.stringify(expectedArgv)) {
          fail(gate, `Provider argv does not match the frozen v0.5.2 Batch 2 transport flags: ${JSON.stringify(entry.argv)}`);
        }
      }
    }

    const ZERO_OUTCOME_COUNTS = { completed: 0, failed: 0, timeout: 0, invalidOutput: 0, agentUnavailable: 0, agentLimitReached: 0, skipped: 0 };
    function requireOutcomeCounts(gate, actual, expectedOverrides) {
      const expected = { ...ZERO_OUTCOME_COUNTS, ...expectedOverrides };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        fail(gate, `Unexpected outcome counts: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
      }
    }

    // --- 9d.1 Codex installed success campaign (sections 19-22) ---------
    // The normal screenshot attempt remains enabled on Windows. Screenshot output is optional
    // campaign presentation evidence on every platform: captured, skipped, and failed results are
    // validated against the command output, gallery manifest, and actual PNG presence below.
    // Core campaign execution is performed exactly once; a failed screenshot does not retry it.
    const codexSuccessCaptureCapable = process.platform === "win32";
    const codexSuccessOut = path.join(dirs.campaigns, "codex-success");
    clearProviderLog();
    const codexSuccessResult = runInstalledCli(
      cliCommand,
      dirs.consumer,
      campaignArgs("codex-full", codexSuccessOut, ["--case", "warm-medium-complete-idempotent"]),
      campaignEnv({
        mode: "success",
        playwrightBrowsersPath: codexSuccessCaptureCapable ? undefined : dirs.browserCache
      })
    );
    process.stderr.write(
      `[diagnostic] codex-success finished at ${new Date().toISOString()} (${Date.now() - gateStartedAt}ms since gate start): status=${codexSuccessResult.status} signal=${codexSuccessResult.signal ?? "none"} error=${codexSuccessResult.error ? (codexSuccessResult.error.message ?? String(codexSuccessResult.error)) : "none"}\n`
    );
    if (codexSuccessResult.status !== 0) {
      fail("WARM_INDEX_CAMPAIGN_CODEX_INSTALLED", "Installed campaign command did not exit 0.", describeChildResult(codexSuccessResult));
    }
    const codexSuccess = { result: codexSuccessResult, log: readProviderLog() };
    requireCampaignReportFiles("WARM_INDEX_CAMPAIGN_CODEX_INSTALLED", codexSuccessOut);
    const codexSuccessReport = readCampaignReport(codexSuccessOut);
    const codexWarm = codexSuccessReport?.warmIndexReuse;
    if (codexSuccessReport?.plugin?.id !== "warm-index-reuse" || codexSuccessReport?.metadata?.status !== "completed") {
      fail("WARM_INDEX_CAMPAIGN_CODEX_INSTALLED", "Installed Codex campaign report is missing plugin id or infrastructure completed status.");
    }
    if (codexWarm?.agent?.id !== "codex" || codexWarm?.agent?.mode !== "real-provider") {
      fail("WARM_INDEX_CAMPAIGN_CODEX_INSTALLED", "Installed Codex campaign report is missing agent identity.");
    }
    const codexCampaign = codexWarm?.agentCampaign;
    if (
      codexCampaign?.presetId !== "codex-full" ||
      codexCampaign?.agentId !== "codex" ||
      codexCampaign?.selectedCaseCount !== 1 ||
      codexCampaign?.scheduledSideCount !== 2 ||
      codexCampaign?.executedSideCount !== 2 ||
      codexCampaign?.notRunForMissingContextCount !== 0 ||
      codexCampaign?.agentEvidenceStatus !== "complete" ||
      codexCampaign?.tokenEvidenceStatus !== "complete"
    ) {
      fail("WARM_INDEX_CAMPAIGN_CODEX_INSTALLED", `Unexpected Codex campaign summary: ${JSON.stringify(codexCampaign)}`);
    }
    requireOutcomeCounts("WARM_INDEX_CAMPAIGN_CODEX_INSTALLED", codexCampaign.outcomeCounts, { completed: 2 });
    const codexTask = codexWarm?.projects?.[0]?.tasks?.[0];
    for (const side of ["raw", "warm"]) {
      if (codexTask?.[side]?.agentTotalTokens?.availability !== "available" || codexTask?.[side]?.agentTotalTokens?.value !== 10) {
        fail("WARM_INDEX_CAMPAIGN_CODEX_INSTALLED", `Codex campaign ${side} side is missing its available token total of 10.`);
      }
    }
    if (codexSuccess.log.length !== 2) {
      fail("WARM_INDEX_CAMPAIGN_PROVIDER_ARGV_PRIVACY", `Expected exactly 2 Codex invocations, observed ${codexSuccess.log.length}.`);
    }
    requireProviderArgvPrivacy("WARM_INDEX_CAMPAIGN_PROVIDER_ARGV_PRIVACY", codexSuccess.log);
    requireFrozenProviderFlags("WARM_INDEX_CAMPAIGN_PROVIDER_ARGV_PRIVACY", codexSuccess.log, CODEX_STDIN_ARGS);

    // Presentation acceptance: four plots, screenshot state consistency, and the three-item gallery.
    requireFourCampaignCharts("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION", codexSuccessOut);
    const codexGallery = requireCampaignGallery("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION", codexSuccessOut);
    const [codexReportItem, codexPlotsItem, codexExecutionItem] = codexGallery.items;
    const screenshotLine = (codexSuccess.result.stdout ?? "").split(/\r?\n/).find((line) => line.startsWith("Screenshot: "));
    const expectedPngPath = path.join(codexSuccessOut, "report.png");
    const screenshotStatus = screenshotLine === "Screenshot: skipped"
      ? "skipped"
      : screenshotLine === "Screenshot: failed"
        ? "failed"
        : screenshotLine === `Screenshot: ${expectedPngPath}`
          ? "captured"
          : undefined;
    if (!screenshotStatus) {
      fail("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION", "Installed campaign did not report a screenshot outcome.");
    }
    if (screenshotStatus === "captured") {
      requireNonEmptyFile(expectedPngPath, "WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION");
    }
    const screenshotProblems = validateWarmIndexCampaignScreenshotEvidence({
      status: screenshotStatus,
      commandOutput: codexSuccess.result.stdout ?? "",
      expectedPngPath,
      pngExists: existsSync(expectedPngPath),
      reportItem: codexReportItem
    });
    if (screenshotProblems.length > 0) {
      fail("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION", screenshotProblems.join("; "));
    }
    if (codexPlotsItem.status !== "pass" || !codexPlotsItem.metrics?.some((metric) => metric.id === "chart-count" && metric.value === 4)) {
      fail("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION", "Codex campaign gallery plots item is not pass with a chart-count of 4.");
    }
    if (codexExecutionItem.status !== "pass") {
      fail("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION", "Codex campaign gallery execution item is not pass.");
    }
    requireNoBoundedArtifactLeak("WARM_INDEX_CAMPAIGN_BOUNDED_ARTIFACTS", codexSuccessOut);

    // --- 9d.2 Claude installed token-unavailable campaign (sections 23-24) ---
    const claudeMissingOut = path.join(dirs.campaigns, "claude-missing-tokens");
    const claudeMissing = runCampaignScenario(
      "WARM_INDEX_CAMPAIGN_CLAUDE_INSTALLED",
      campaignArgs("claude-full", claudeMissingOut, ["--case", "warm-medium-complete-idempotent"]),
      campaignEnv({ mode: "missing-tokens", playwrightBrowsersPath: dirs.browserCache })
    );
    requireCampaignReportFiles("WARM_INDEX_CAMPAIGN_CLAUDE_INSTALLED", claudeMissingOut);
    const claudeMissingReport = readCampaignReport(claudeMissingOut);
    const claudeWarm = claudeMissingReport?.warmIndexReuse;
    if (claudeMissingReport?.metadata?.status !== "completed" || claudeWarm?.agent?.id !== "claude" || claudeWarm?.agent?.mode !== "real-provider") {
      fail("WARM_INDEX_CAMPAIGN_CLAUDE_INSTALLED", "Installed Claude campaign report is missing infrastructure status or agent identity.");
    }
    if (claudeWarm?.agentCampaign?.agentEvidenceStatus !== "complete" || claudeWarm?.agentCampaign?.tokenEvidenceStatus !== "unavailable") {
      fail("WARM_INDEX_CAMPAIGN_CLAUDE_TOKEN_UNAVAILABLE", `Unexpected Claude campaign evidence status: ${JSON.stringify(claudeWarm?.agentCampaign)}`);
    }
    if (claudeWarm?.summary?.agentTotalTokensAvailableCount !== 0) {
      fail("WARM_INDEX_CAMPAIGN_CLAUDE_TOKEN_UNAVAILABLE", "Claude campaign token-unavailable evidence unexpectedly reports available token totals.");
    }
    requireOutcomeCounts("WARM_INDEX_CAMPAIGN_CLAUDE_TOKEN_UNAVAILABLE", claudeWarm.agentCampaign.outcomeCounts, { completed: 2 });
    if (claudeMissing.log.length !== 2) {
      fail("WARM_INDEX_CAMPAIGN_PROVIDER_ARGV_PRIVACY", `Expected exactly 2 Claude invocations, observed ${claudeMissing.log.length}.`);
    }
    requireProviderArgvPrivacy("WARM_INDEX_CAMPAIGN_PROVIDER_ARGV_PRIVACY", claudeMissing.log);
    requireFrozenProviderFlags("WARM_INDEX_CAMPAIGN_PROVIDER_ARGV_PRIVACY", claudeMissing.log, CLAUDE_STDIN_ARGS);

    if (existsSync(path.join(claudeMissingOut, "report.png"))) {
      fail("WARM_INDEX_CAMPAIGN_CLAUDE_TOKEN_UNAVAILABLE", "Claude token-unavailable campaign unexpectedly produced report.png.");
    }
    requireFourCampaignCharts("WARM_INDEX_CAMPAIGN_CLAUDE_TOKEN_UNAVAILABLE", claudeMissingOut);
    const claudeGallery = requireCampaignGallery("WARM_INDEX_CAMPAIGN_CLAUDE_TOKEN_UNAVAILABLE", claudeMissingOut);
    const [claudeReportItem] = claudeGallery.items;
    if (claudeReportItem.status !== "warning" || claudeReportItem.screenshotPath) {
      fail("WARM_INDEX_CAMPAIGN_CLAUDE_TOKEN_UNAVAILABLE", "Claude campaign gallery report item did not reflect the skipped screenshot.");
    }
    if (!claudeReportItem.warnings?.some((warning) => /Playwright or browser runtime is unavailable/.test(warning))) {
      fail("WARM_INDEX_CAMPAIGN_CLAUDE_TOKEN_UNAVAILABLE", "Claude campaign gallery is missing the canonical screenshot-skip warning.");
    }
    requireNoBoundedArtifactLeak("WARM_INDEX_CAMPAIGN_BOUNDED_ARTIFACTS", claudeMissingOut);

    // --- 9d.3 codex-timeout-isolation preset: exact three cases, partial failure (section 25) ---
    const timeoutIsoOut = path.join(dirs.campaigns, "codex-timeout-isolation");
    const timeoutIso = runCampaignScenario(
      "WARM_INDEX_CAMPAIGN_TIMEOUT_ISOLATION",
      campaignArgs("codex-timeout-isolation", timeoutIsoOut, []),
      campaignEnv({ mode: "failure", failMatch: "warm-large-ts-leaderboard", playwrightBrowsersPath: dirs.browserCache })
    );
    const isoArtifact = JSON.parse(readFileSync(path.join(timeoutIsoOut, "warm-index-execution.json"), "utf8"));
    const isoSelection = (isoArtifact.projects ?? []).map((project) => project.tasks?.map((task) => task.caseId));
    if (isoArtifact.projects?.length !== 1 || JSON.stringify(isoSelection[0]) !== JSON.stringify(WARM_INDEX_TIMEOUT_ISOLATION_CASES)) {
      fail("WARM_INDEX_CAMPAIGN_TIMEOUT_ISOLATION", `Unexpected codex-timeout-isolation selection: ${JSON.stringify(isoSelection)}`);
    }
    const isoReport = readCampaignReport(timeoutIsoOut);
    const isoCampaign = isoReport?.warmIndexReuse?.agentCampaign;
    if (isoReport?.metadata?.status !== "completed") {
      fail("WARM_INDEX_CAMPAIGN_TIMEOUT_ISOLATION", "codex-timeout-isolation infrastructure status is not completed.");
    }
    if (isoCampaign?.selectedCaseCount !== 3 || isoCampaign?.scheduledSideCount !== 6 || isoCampaign?.executedSideCount !== 6) {
      fail("WARM_INDEX_CAMPAIGN_TIMEOUT_ISOLATION", `Unexpected codex-timeout-isolation side counts: ${JSON.stringify(isoCampaign)}`);
    }
    requireOutcomeCounts("WARM_INDEX_CAMPAIGN_TIMEOUT_ISOLATION", isoCampaign.outcomeCounts, { completed: 4, failed: 2 });
    if (isoCampaign.agentEvidenceStatus !== "partial") {
      fail("WARM_INDEX_CAMPAIGN_TIMEOUT_ISOLATION", `codex-timeout-isolation agentEvidenceStatus was ${isoCampaign.agentEvidenceStatus}, expected partial.`);
    }
    if (timeoutIso.log.length !== 6) {
      fail("WARM_INDEX_CAMPAIGN_TIMEOUT_ISOLATION", `Expected exactly 6 Codex invocations for codex-timeout-isolation, observed ${timeoutIso.log.length}.`);
    }
    requireFourCampaignCharts("WARM_INDEX_CAMPAIGN_TIMEOUT_ISOLATION", timeoutIsoOut);
    requireCampaignGallery("WARM_INDEX_CAMPAIGN_TIMEOUT_ISOLATION", timeoutIsoOut);
    requireNoBoundedArtifactLeak("WARM_INDEX_CAMPAIGN_BOUNDED_ARTIFACTS", timeoutIsoOut);

    // --- 9d.4 invalid-output classification (section 26) ---------------
    const invalidOutputOut = path.join(dirs.campaigns, "codex-invalid-output");
    runCampaignScenario(
      "WARM_INDEX_CAMPAIGN_INVALID_OUTPUT",
      campaignArgs("codex-full", invalidOutputOut, ["--case", "warm-medium-import-dedupe"]),
      campaignEnv({ mode: "invalid-output", playwrightBrowsersPath: dirs.browserCache })
    );
    const invalidOutputReport = readCampaignReport(invalidOutputOut);
    const invalidOutputCampaign = invalidOutputReport?.warmIndexReuse?.agentCampaign;
    if (invalidOutputReport?.metadata?.status !== "completed") {
      fail("WARM_INDEX_CAMPAIGN_INVALID_OUTPUT", "invalid-output scenario infrastructure status is not completed.");
    }
    if (!(invalidOutputCampaign?.outcomeCounts?.invalidOutput > 0)) {
      fail("WARM_INDEX_CAMPAIGN_INVALID_OUTPUT", `Expected outcomeCounts.invalidOutput > 0, got ${JSON.stringify(invalidOutputCampaign?.outcomeCounts)}.`);
    }
    if (invalidOutputCampaign?.agentEvidenceStatus !== "partial") {
      fail("WARM_INDEX_CAMPAIGN_INVALID_OUTPUT", `invalid-output agentEvidenceStatus was ${invalidOutputCampaign?.agentEvidenceStatus}, expected partial.`);
    }
    requireFourCampaignCharts("WARM_INDEX_CAMPAIGN_INVALID_OUTPUT", invalidOutputOut);
    requireCampaignGallery("WARM_INDEX_CAMPAIGN_INVALID_OUTPUT", invalidOutputOut);

    // --- 9d.5 agent-unavailable classification (section 27) -------------
    // No fake-agents bin directory on PATH at all: codex/claude are genuinely unresolvable, and the
    // installed my-dev-kit-lab binary itself was already resolved to an absolute path beforehand.
    const agentUnavailableOut = path.join(dirs.campaigns, "codex-agent-unavailable");
    const agentUnavailable = runCampaignScenario(
      "WARM_INDEX_CAMPAIGN_AGENT_UNAVAILABLE",
      campaignArgs("codex-full", agentUnavailableOut, ["--case", "warm-medium-import-dedupe"]),
      campaignEnv({ mode: "success", extraBinDirs: [], playwrightBrowsersPath: dirs.browserCache })
    );
    if (agentUnavailable.log.length !== 0) {
      fail("WARM_INDEX_CAMPAIGN_AGENT_UNAVAILABLE", "The isolated PATH unexpectedly allowed the fake Codex executable to run.");
    }
    const agentUnavailableReport = readCampaignReport(agentUnavailableOut);
    const agentUnavailableCampaign = agentUnavailableReport?.warmIndexReuse?.agentCampaign;
    if (agentUnavailableReport?.metadata?.status !== "completed") {
      fail("WARM_INDEX_CAMPAIGN_AGENT_UNAVAILABLE", "agent-unavailable scenario infrastructure status is not completed.");
    }
    requireOutcomeCounts("WARM_INDEX_CAMPAIGN_AGENT_UNAVAILABLE", agentUnavailableCampaign.outcomeCounts, { agentUnavailable: 2 });
    if (agentUnavailableCampaign?.agentEvidenceStatus !== "partial" || agentUnavailableCampaign?.tokenEvidenceStatus !== "unavailable") {
      fail("WARM_INDEX_CAMPAIGN_AGENT_UNAVAILABLE", `Unexpected agent-unavailable campaign summary: ${JSON.stringify(agentUnavailableCampaign)}`);
    }
    if (agentUnavailableReport?.warmIndexReuse?.summary?.agentCorrectnessAvailableCount !== 0) {
      fail("WARM_INDEX_CAMPAIGN_AGENT_UNAVAILABLE", "agent-unavailable scenario unexpectedly reports available correctness evidence.");
    }
    requireFourCampaignCharts("WARM_INDEX_CAMPAIGN_AGENT_UNAVAILABLE", agentUnavailableOut);
    requireCampaignGallery("WARM_INDEX_CAMPAIGN_AGENT_UNAVAILABLE", agentUnavailableOut);

    // --- 9d.6 agent-limit-reached classification (section 28) -----------
    const limitReachedOut = path.join(dirs.campaigns, "codex-limit-reached");
    runCampaignScenario(
      "WARM_INDEX_CAMPAIGN_AGENT_LIMIT_REACHED",
      campaignArgs("codex-full", limitReachedOut, ["--case", "warm-medium-import-dedupe"]),
      campaignEnv({ mode: "limit-reached", playwrightBrowsersPath: dirs.browserCache })
    );
    const limitReachedReport = readCampaignReport(limitReachedOut);
    const limitReachedCampaign = limitReachedReport?.warmIndexReuse?.agentCampaign;
    if (limitReachedReport?.metadata?.status !== "completed") {
      fail("WARM_INDEX_CAMPAIGN_AGENT_LIMIT_REACHED", "agent-limit-reached scenario infrastructure status is not completed.");
    }
    requireOutcomeCounts("WARM_INDEX_CAMPAIGN_AGENT_LIMIT_REACHED", limitReachedCampaign.outcomeCounts, { agentLimitReached: 2 });
    if (limitReachedCampaign?.agentEvidenceStatus !== "partial") {
      fail("WARM_INDEX_CAMPAIGN_AGENT_LIMIT_REACHED", `agent-limit-reached agentEvidenceStatus was ${limitReachedCampaign?.agentEvidenceStatus}, expected partial.`);
    }
    requireFourCampaignCharts("WARM_INDEX_CAMPAIGN_AGENT_LIMIT_REACHED", limitReachedOut);
    requireCampaignGallery("WARM_INDEX_CAMPAIGN_AGENT_LIMIT_REACHED", limitReachedOut);

    // --- 9d.7 timeout classification (section 29) ------------------------
    const timeoutOut = path.join(dirs.campaigns, "codex-timeout");
    runCampaignScenario(
      "WARM_INDEX_CAMPAIGN_TIMEOUT",
      campaignArgs("codex-full", timeoutOut, ["--case", "warm-medium-import-dedupe", "--timeout-ms", "250"]),
      campaignEnv({ mode: "timeout", playwrightBrowsersPath: dirs.browserCache })
    );
    const timeoutReport = readCampaignReport(timeoutOut);
    const timeoutCampaign = timeoutReport?.warmIndexReuse?.agentCampaign;
    if (timeoutReport?.metadata?.status !== "completed") {
      fail("WARM_INDEX_CAMPAIGN_TIMEOUT", "timeout scenario infrastructure status is not completed.");
    }
    requireOutcomeCounts("WARM_INDEX_CAMPAIGN_TIMEOUT", timeoutCampaign.outcomeCounts, { timeout: 2 });
    if (timeoutCampaign?.agentEvidenceStatus !== "partial") {
      fail("WARM_INDEX_CAMPAIGN_TIMEOUT", `timeout agentEvidenceStatus was ${timeoutCampaign?.agentEvidenceStatus}, expected partial.`);
    }
    requireFourCampaignCharts("WARM_INDEX_CAMPAIGN_TIMEOUT", timeoutOut);
    requireCampaignGallery("WARM_INDEX_CAMPAIGN_TIMEOUT", timeoutOut);

    if (
      existsSync(path.join(installedPackageRoot, "campaigns")) ||
      existsSync(path.join(installedPackageRoot, "plots")) ||
      existsSync(path.join(installedPackageRoot, "gallery")) ||
      existsSync(path.join(installedPackageRoot, "report.png"))
    ) {
      fail("WARM_INDEX_CAMPAIGN_OUTPUT_LOCATION", "Real-agent campaign output was written beneath the installed package root.");
    }

    console.log("WARM_INDEX_CAMPAIGN_CODEX_INSTALLED: PASS");
    console.log("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION: PASS");
    console.log("WARM_INDEX_CAMPAIGN_CLAUDE_INSTALLED: PASS");
    console.log("WARM_INDEX_CAMPAIGN_CLAUDE_TOKEN_UNAVAILABLE: PASS");
    console.log(`WARM_INDEX_CAMPAIGN_TIMEOUT_ISOLATION: PASS (${WARM_INDEX_TIMEOUT_ISOLATION_CASES.join(", ")})`);
    console.log("WARM_INDEX_CAMPAIGN_INVALID_OUTPUT: PASS");
    console.log("WARM_INDEX_CAMPAIGN_AGENT_UNAVAILABLE: PASS");
    console.log("WARM_INDEX_CAMPAIGN_AGENT_LIMIT_REACHED: PASS");
    console.log("WARM_INDEX_CAMPAIGN_TIMEOUT: PASS");
    console.log("WARM_INDEX_CAMPAIGN_BOUNDED_ARTIFACTS: PASS");
    console.log("WARM_INDEX_CAMPAIGN_PROVIDER_ARGV_PRIVACY: PASS");
    console.log("WARM_INDEX_CAMPAIGN_GALLERY: PASS");

    // -----------------------------------------------------------------
    // 10. Target and installed-package immutability.
    // -----------------------------------------------------------------
    const targetAfter = await snapshotDirectory(dirs.target);
    const targetChanges = diffSnapshots(targetBefore, targetAfter);
    if (targetChanges.length > 0) {
      fail("TARGET_IMMUTABILITY", `Target changed during installed execution: ${targetChanges.join(", ")}`);
    }

    const installedPackageAfter = await snapshotDirectory(installedPackageRoot);
    const installedPackageChanges = diffSnapshots(installedPackageBefore, installedPackageAfter);
    if (installedPackageChanges.length > 0) {
      fail(
        "INSTALLED_PACKAGE_IMMUTABILITY",
        `Installed package changed during execution: ${installedPackageChanges.join(", ")}`
      );
    }
    const exampleAfter = await snapshotDirectory(installedExampleRoot);
    const exampleChanges = diffSnapshots(exampleBefore, exampleAfter);
    if (exampleChanges.length > 0) {
      fail("PACKAGED_EXAMPLE_IMMUTABILITY", `Installed packaged tutorial example changed during execution: ${exampleChanges.join(", ")}`);
    }
    console.log("TUTORIAL_HELP: PASS");
    console.log("TUTORIAL_VALIDATE: PASS");
    console.log("TUTORIAL_BROWSER_UNAVAILABLE: PASS (isolated browser cache remained empty)");
    console.log("TUTORIAL_REAL_EXECUTION: PASS");
    console.log("TUTORIAL_POINTER_CLICK: PASS");
    console.log("TUTORIAL_POINTER_DRAG: PASS");
    console.log("TUTORIAL_SELECT_OPTION: PASS");
    console.log(`TUTORIAL_VIDEO: artifacts/tutorial.webm (${videoSize} bytes)`);
    console.log(`TUTORIAL_SRT: artifacts/tutorial.srt (${statSync(artifactFiles.srt).size} bytes)`);
    console.log(`TUTORIAL_VTT: artifacts/tutorial.vtt (${statSync(artifactFiles.vtt).size} bytes)`);
    console.log(`TUTORIAL_MARKDOWN: artifacts/tutorial.md (${statSync(artifactFiles.markdown).size} bytes)`);
    console.log(`TUTORIAL_MANIFEST: artifacts/tutorial-manifest.json (${statSync(artifactFiles.manifest).size} bytes), schema=${manifest.schemaVersion}, status=${manifest.run.status}`);
    console.log(`TUTORIAL_SCREENSHOTS: ${JSON.stringify(screenshotSizes)}`);
    console.log("TUTORIAL_DEFAULT_WORKSPACE: PASS");
    console.log("TUTORIAL_EXPLICIT_WORKSPACE: PASS");
    console.log("TUTORIAL_EXPLICIT_OUT: PASS");
    console.log("PACKAGED_EXAMPLE_IMMUTABILITY: PASS");

    // -----------------------------------------------------------------
    // 11. Source repository cleanliness (no .tgz created there).
    // -----------------------------------------------------------------
    const strayTarballs = readdirSync(REPO_ROOT).filter((name) => name.endsWith(".tgz"));
    if (strayTarballs.length > 0) {
      fail("SOURCE_REPOSITORY_CLEAN", `Stray tarball(s) found in the source repository: ${strayTarballs.join(", ")}`);
    }

    // -----------------------------------------------------------------
    // 12. Summary.
    // -----------------------------------------------------------------
    console.log(
      [
        "PACKED_PACKAGE_VERDICT: PASS",
        "",
        `PACKAGE_NAME: ${EXPECTED_PACKAGE_NAME}`,
        `PACKAGE_VERSION: ${EXPECTED_PACKAGE_VERSION}`,
        `TARBALL_SHA256: ${tarballSha256}`,
        `INSTALLED_BIN: ${EXPECTED_BIN_NAME} -> ${EXPECTED_BIN_TARGET}`,
        "",
        "HELP: PASS",
        "VERSION: PASS",
        "EXPERIMENT_LIST: PASS",
        "EXPERIMENT_DESCRIBE: PASS",
        "AUDIT_INSTALLED_EXECUTION: PASS",
        "SECURITY_INSTALLED_EXECUTION: PASS",
        "DEFAULT_WORKSPACE: PASS",
        "EXPLICIT_WORKSPACE: PASS",
        "TARGET_IMMUTABILITY: PASS",
        "INSTALLED_PACKAGE_IMMUTABILITY: PASS",
        "AFFECTED_NEIGHBORHOOD_REAL_MY_DEV_KIT: PASS",
        "AFFECTED_NEIGHBORHOOD_FRESH: PASS",
        "AFFECTED_NEIGHBORHOOD_CHANGED_FILE: PASS",
        "AFFECTED_NEIGHBORHOOD_METRICS: PASS",
        "AFFECTED_NEIGHBORHOOD_REPORT: PASS",
        "INCREMENTAL_CHANGE_STALENESS_DISCOVERY: PASS",
        "INCREMENTAL_CHANGE_STALENESS_RUN: PASS",
        "INCREMENTAL_CHANGE_STALENESS_ARTIFACT: PASS",
        "INCREMENTAL_CHANGE_STALENESS_REPORT: PASS",
        "INCREMENTAL_CHANGE_STALENESS_COMPARISON: PASS",
        "INCREMENTAL_CHANGE_STALENESS_IMMUTABILITY: PASS",
        "CONTEXT_WINDOW_SCALING_DISCOVERY: PASS",
        "CONTEXT_WINDOW_SCALING_RUN: PASS",
        "CONTEXT_WINDOW_SCALING_ARTIFACT: PASS",
        "CONTEXT_WINDOW_SCALING_REPORTS: PASS",
        "CONTEXT_WINDOW_SCALING_PLOTS: PASS",
        "CONTEXT_WINDOW_SCALING_IMMUTABILITY: PASS",
        "CONTEXT_WINDOW_SCALING_LOCAL_SUBJECT_REJECTIONS: PASS",
        "CONTEXT_WINDOW_SCALING_LOCAL_SUBJECT_RUN: PASS",
        "CONTEXT_WINDOW_SCALING_LOCAL_SUBJECT_PRIVACY: PASS",
        "CONTEXT_WINDOW_SCALING_LOCAL_SUBJECT_IMMUTABILITY: PASS",
        "RETRIEVAL_PRECISION_RECALL_DISCOVERY: PASS",
        "RETRIEVAL_PRECISION_RECALL_BUNDLED: PASS",
        "RETRIEVAL_PRECISION_RECALL_EXTERNAL_REJECTIONS: PASS",
        "RETRIEVAL_PRECISION_RECALL_EXTERNAL_FAILURE: PASS",
        "RETRIEVAL_PRECISION_RECALL_EXTERNAL: PASS",
        "RETRIEVAL_PRECISION_RECALL_PRIVACY: PASS",
        "RETRIEVAL_PRECISION_RECALL_IMMUTABILITY: PASS",
        "RETRIEVAL_QUERY_STRATEGY_COMPARISON_DISCOVERY: PASS",
        "RETRIEVAL_QUERY_STRATEGY_COMPARISON_BUNDLED: PASS",
        "RETRIEVAL_QUERY_STRATEGY_COMPARISON_REPORT: PASS",
        "RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXTERNAL_REJECTIONS: PASS",
        "RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXTERNAL_FAILURE: PASS",
        "RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXTERNAL: PASS",
        "RETRIEVAL_QUERY_STRATEGY_COMPARISON_PRIVACY: PASS",
        "RETRIEVAL_QUERY_STRATEGY_COMPARISON_IMMUTABILITY: PASS",
        "RETRIEVAL_QUERY_STRATEGY_COMPARISON_REAL_MY_DEV_KIT: PASS",
        "CONTEXT_PACK_GENERATION_DISCOVERY: PASS",
        "CONTEXT_PACK_GENERATION_FLAGS: PASS",
        "CONTEXT_PACK_GENERATION_BUNDLED: PASS",
        "CONTEXT_PACK_GENERATION_REPORT: PASS",
        "CONTEXT_PACK_GENERATION_EXTERNAL_REJECTIONS: PASS",
        "CONTEXT_PACK_GENERATION_EXTERNAL: PASS",
        "CONTEXT_PACK_GENERATION_PRIVACY: PASS",
        "CONTEXT_PACK_GENERATION_IMMUTABILITY: PASS",
        "CONTEXT_PACK_GENERATION_REAL_MY_DEV_KIT: PASS",
        ...AGENT_SUCCESS_GATE_LABELS.map((label) => `${label}: PASS`),
        "SOURCE_CHECKOUT_RUNTIME_DEPENDENCY: NONE_OBSERVED"
      ].join("\n")
    );
  } catch (error) {
    if (error instanceof PackedPackageGateError) {
      console.error(`PACKED_PACKAGE_VERDICT: FAIL`);
      console.error(`FAILED_GATE: ${error.gate}`);
      console.error(error.message);
      if (error.details) {
        console.error(error.details);
      }
    } else {
      console.error("PACKED_PACKAGE_VERDICT: FAIL");
      console.error("FAILED_GATE: UNEXPECTED_ERROR");
      console.error(error);
    }
    process.exitCode = 1;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export { describeChildResult, fail, isolatedProviderEnv, loadResolveCommand, resolveConsumerBinCommand, runInstalledCli, writeFakeAgentLauncher };

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  await main();
}
