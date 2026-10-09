// ---------------------------------------------------------------------------
// v0.9.0 Batch 6 -- agent-success-rate installed-package acceptance.
//
// This module is a section of the existing packed-package gate (scripts/verify-packed-package.mjs): it is called from
// that script's main() with the SAME exact tarball, the SAME clean consumer install and the SAME installed binary. It
// packs nothing, installs nothing and never reaches the npm registry. Everything it runs is the installed
// `my-dev-kit-lab` binary against the installed package's bundled six-task corpus, from invocation directories outside
// the source checkout and the package.
//
// No real coding agent is ever invoked. "Real-agent" scenarios use deterministic fake `codex` / `claude` executables
// (tests/scripts/fixtures/packedAgentSuccessProvider.mjs, never packaged) selected through the public CLI with
// `--agent <provider> --include-real-agents`; their answers are test-owned data prepared here, so the production plugin
// is proven to evaluate what the provider PROCESS returned and never looks up the deterministic fixture.
//
// Gate labels below are acceptance gate names, not scientific metric ids.
// ---------------------------------------------------------------------------

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const AGENT_SUCCESS_PLUGIN_ID = "agent-success-rate";
export const AGENT_SUCCESS_TREATMENTS = ["raw-full-file", "context-pack"];
export const AGENT_SUCCESS_LEGACY_EXPERIMENT_IDS = [
  "context-strategy-comparison",
  "warm-index-reuse",
  "incremental-change-staleness",
  "context-window-scaling",
  "retrieval-precision-recall",
  "retrieval-query-strategy-comparison",
  "context-pack-generation"
];
export const AGENT_SUCCESS_SCHEMAS = {
  execution: "my-dev-kit-lab-agent-success-rate-execution-v1",
  analysis: "my-dev-kit-lab-agent-success-rate-analysis-v1",
  report: "my-dev-kit-lab-agent-success-rate-report-v1"
};
export const AGENT_SUCCESS_TASK_CATALOG = "benchmarks/contracts/agent-success-rate-tasks.json";
export const AGENT_SUCCESS_PROJECT_PROFILES = "benchmarks/contracts/agent-success-rate-project-profiles.json";
export const AGENT_SUCCESS_PROJECTS = ["agent-success-task-board-node", "agent-success-inventory-node"];
export const AGENT_SUCCESS_EXECUTION_FILE = "agent-success-rate-execution.json";
export const AGENT_SUCCESS_ANALYSIS_FILE = "agent-success-rate-analysis.json";

export const AGENT_SUCCESS_GATE_LABELS = [
  "AGENT_SUCCESS_PACKAGE_CONTENTS",
  "AGENT_SUCCESS_DISCOVERY",
  "AGENT_SUCCESS_DESCRIBE",
  "AGENT_SUCCESS_HELP",
  "AGENT_SUCCESS_DETERMINISTIC_RUN",
  "AGENT_SUCCESS_CORPUS",
  "AGENT_SUCCESS_REPORTS",
  "AGENT_SUCCESS_OUTPUT_ROOT",
  "AGENT_SUCCESS_CLI_REJECTION",
  "AGENT_SUCCESS_PROVIDER_TRANSPORT",
  "AGENT_SUCCESS_REPAIR",
  "AGENT_SUCCESS_REPAIR_LIMIT",
  "AGENT_SUCCESS_CLEANUP",
  "AGENT_SUCCESS_IMMUTABILITY",
  "AGENT_SUCCESS_PACKAGE_HYGIENE"
];

const PLUGIN_DIR = "dist/src/experiments/plugins/agentSuccessRate";
const pluginModules = [
  "agentTaskProjection", "analysis", "analysisArtifact", "analysisTypes", "attemptEvidence", "config", "contextGeneration", "execution",
  "executionArtifact", "executionTypes", "index", "metadata", "metrics", "plugin", "realAgentExecution", "realAgentPrompt",
  "repairAnalysis", "repairExecution", "repairFeedback", "repairPolicy", "types"
].map((name) => `${PLUGIN_DIR}/${name}.js`);
const corpusModules = [
  "applyPatchToSandbox", "assessBaseline", "corpusTypes", "extractPatchCandidate", "index", "parseUnifiedDiff", "patchTypes", "readAgentSuccessCorpus",
  "runVerificationCheck", "taskPaths", "taskTypes", "validateAgentSuccessCorpus", "validateAgentSuccessTask", "validatePatchPolicy", "verificationTypes"
].map((name) => `dist/src/evaluation/agentSuccess/${name}.js`);
const sandboxModules = ["createBenchmarkSandbox", "errors", "gitExecutor", "index", "minimalHostEnv", "pathPolicy", "removeBenchmarkSandbox", "treeSnapshot", "types"].map(
  (name) => `dist/src/evaluation/benchmarkSandbox/${name}.js`
);
const changeSetModules = ["captureChangeSet", "index", "types"].map((name) => `dist/src/evaluation/changeSet/${name}.js`);
const reportModules = ["agentSuccessRateReportModel", "buildAgentSuccessRateReport", "renderAgentSuccessRateHtml", "renderAgentSuccessRateText"].map(
  (name) => `dist/src/report/experiments/${name}.js`
);
const providerModules = [
  "dist/src/agents/runAgentPrompt.js",
  "dist/src/agents/agentRegistry.js",
  "dist/src/agents/parseAgentTokenUsage.js",
  "dist/src/agents/adapters/codexAdapter.js",
  "dist/src/agents/adapters/claudeAdapter.js",
  "dist/src/evaluation/classifyAgentRunOutcome.js"
];
const projectFiles = {
  "agent-success-task-board-node": [
    ".gitattributes", "README.md", "package.json", "src/index.js", "src/projectSummary.js", "src/taskService.js", "src/taskStore.js", "src/validation.js",
    "tests/import-edge.check.mjs", "tests/import-primary.check.mjs", "tests/regression.check.mjs", "tests/summary-edge.check.mjs", "tests/summary-primary.check.mjs",
    "tests/title-edge.check.mjs", "tests/title-primary.check.mjs"
  ],
  "agent-success-inventory-node": [
    ".gitattributes", "README.md", "package.json", "src/fulfillmentReport.js", "src/index.js", "src/inventoryStore.js", "src/quantity.js", "src/reservationService.js",
    "tests/quantity-edge.check.mjs", "tests/quantity-primary.check.mjs", "tests/regression.check.mjs", "tests/report-edge.check.mjs", "tests/report-primary.check.mjs",
    "tests/reservation-edge.check.mjs", "tests/reservation-primary.check.mjs"
  ]
};

/** Every compiled owner and bundled resource the installed agent-success-rate runtime needs (derived from the local source graph). */
export const AGENT_SUCCESS_REQUIRED_TARBALL_PATHS = [
  ...pluginModules,
  ...corpusModules,
  ...sandboxModules,
  ...changeSetModules,
  ...reportModules,
  ...providerModules,
  AGENT_SUCCESS_TASK_CATALOG,
  AGENT_SUCCESS_PROJECT_PROFILES,
  ...Object.entries(projectFiles).flatMap(([project, files]) => files.map((file) => `benchmarks/projects/${project}/${file}`))
];

/**
 * Paths that must never appear in the tarball. The canonical projects' trusted `*.check.mjs` files, their project-local
 * `.gitattributes`, the benchmark projects' own source and test files and the bundled deterministic reference patches are
 * INTENTIONAL package resources (everything beneath `benchmarks/` ships by design) and are not matched here; the development
 * test harness (top-level `tests/`, the packed-package verifier and its fixtures) is.
 */
export const AGENT_SUCCESS_FORBIDDEN_TARBALL_PATTERNS = [
  /(^|\/)\.my-dev-kit-context\//,
  /(^|\/)\.my-dev-kit-orchestrator\//,
  /(^|\/)\.my-dev-kit\//,
  /(^|\/)(reports|lab-output)\//,
  /(^|\/)sandboxes\//,
  /(^|\/)agents\/.+\/attempt-\d+\//,
  /(^|\/)\.git\//,
  /(^|\/)\.git(ignore|modules)$/,
  /\.tgz$/,
  /(^|\/)\.env(\..*)?$/,
  /(^|\/)(\.npmrc|id_rsa|id_ed25519)$/,
  /\.(pem|key|p12)$/,
  /(^|\/)\.claude\//,
  /(^|\/)(AGENTS|CLAUDE)\.md$/,
  /(^|\/)(agents|claude)\.txt$/,
  /^(dist\/)?(tests|scripts\/fixtures|scripts\/docs)\//,
  /(^|\/)(verify-packed-package|verifyPackedPackage[A-Za-z]*)\.(mjs|ts)$/,
  /(^|\/)node_modules\//,
  /(^|\/)(invocations\.jsonl|agent-run-result\.json|prompt\.txt)$/
];

/** Returns the files that match a forbidden pattern; a `tests/` path is allowed only when it is a canonical `*.check.mjs` file under benchmarks/projects/. */
export function findForbiddenTarballPaths(files, patterns = AGENT_SUCCESS_FORBIDDEN_TARBALL_PATTERNS) {
  const problems = [];
  for (const file of [...files].map((entry) => entry.replace(/\\/g, "/")).sort()) {
    const canonicalCheck = /^benchmarks\/projects\/agent-success-[a-z-]+\/tests\/[^/]+\.check\.mjs$/.test(file);
    if (canonicalCheck) continue;
    if (patterns.some((pattern) => pattern.test(file))) problems.push(file);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Small pure helpers (exported for the unit tests).
// ---------------------------------------------------------------------------

export const normalizeSpace = (text) => text.replace(/\s+/g, " ");

export function listFilesRecursive(root) {
  if (!existsSync(root)) return [];
  const found = [];
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) found.push(child);
    }
  };
  walk("");
  return found.sort();
}

/** Directories on PATH (in order) that contain an executable called `name`. */
export function executableDirectories(name, pathValue, platform = process.platform) {
  const extensions = platform === "win32" ? ["", ".exe", ".cmd", ".bat", ".ps1"] : [""];
  return (pathValue ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .filter((directory) => extensions.some((extension) => existsSync(path.join(directory, `${name}${extension}`))));
}

/** True when `candidate` lies inside `root` (or is it). */
export function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Values a real agent must never see, derived independently of the production leak guard from the installed catalog. */
export function collectHiddenTaskValues(task) {
  const values = [];
  const add = (label, value) => {
    if (typeof value === "string" && value.trim().length >= 6) values.push({ label, value });
  };
  add("deterministicFixture.id", task.deterministicFixture?.id);
  add("deterministicFixture.notes", task.deterministicFixture?.notes);
  for (const check of [...task.taskChecks, ...task.regressionChecks]) {
    if (/-/.test(check.id)) add("check.id", check.id);
    for (const arg of check.args ?? []) if (!arg.startsWith("-") && /[./]/.test(arg)) add("check.path", arg);
  }
  for (const fact of task.behaviorFacts ?? []) {
    add("behaviorFact.text", fact.text);
    if (/-/.test(fact.id)) add("behaviorFact.id", fact.id);
  }
  for (const file of task.protectedFiles ?? []) if (/^tests\//.test(file)) add("protectedFile.test", file);
  return values;
}

/** Contract field names that must never be spelled in an agent-facing prompt. */
export const HIDDEN_FIELD_NAMES = ["deterministicFixture", "verificationCheckIds", "expectedEditFiles", "allowedEditFiles", "protectedFiles", "taskChecks", "regressionChecks", "behaviorFacts"];

/** Added reference-patch lines (long enough to be distinctive) that are not already canonical project source. */
export function distinctiveReferencePatchLines(task, canonicalSource) {
  return (task.deterministicFixture?.patch ?? "")
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++") && line.trim().length > 24)
    .map((line) => line.slice(1))
    .filter((line) => !canonicalSource.includes(line.trim()));
}

/** Labels of hidden material found in a prompt. */
export function findPromptLeakLabels(prompt, task, canonicalSource) {
  const found = new Set();
  for (const entry of collectHiddenTaskValues(task)) if (prompt.includes(entry.value)) found.add(entry.label);
  for (const name of HIDDEN_FIELD_NAMES) if (prompt.includes(name)) found.add(`field:${name}`);
  for (const line of distinctiveReferencePatchLines(task, canonicalSource)) if (prompt.includes(line)) found.add("referencePatch.line");
  return [...found].sort();
}

/** A unified diff that applies cleanly to `fileText` but cannot make any behavior check pass (one appended comment line). */
export function buildNoopPatch(relativePath, fileText) {
  const lines = fileText.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const last = lines.length;
  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -${last},1 +${last},2 @@`,
    ` ${lines[last - 1]}`,
    "+// packed acceptance: harmless comment that does not change behavior",
    ""
  ].join("\n");
}

export const fenced = (patch) => `Here is a proposed change.\n\n\`\`\`diff\n${patch}\`\`\`\n`;

/** The ordered metric value (or null when unavailable) used by the scientific cross-checks. */
export function metricValue(metric) {
  return metric && metric.availability === "available" ? metric.value : null;
}

// ---------------------------------------------------------------------------
// The acceptance run.
// ---------------------------------------------------------------------------

/**
 * @param ctx  Everything the surrounding gate already owns (no second install, no second pack):
 *   fail, describeChildResult, runInstalledCli, cliCommand, envWithBin, consumerBinDir, repoRoot, tempRoot, installedPackageRoot,
 *   tarballFiles (Set of packed paths), knownExperiments / knownExperimentIds (installed `experiment list --json`),
 *   snapshotDirectory, diffSnapshots, writeFakeAgentLauncher, isolatedProviderEnv, codexArgs, claudeArgs
 */
export async function runAgentSuccessPackedAcceptance(ctx) {
  const workspaces = [];
  try {
    await runAgentSuccessPackedAcceptanceInner(ctx, workspaces);
  } finally {
    for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
  }
}

async function runAgentSuccessPackedAcceptanceInner(ctx, workspaces) {
  const { fail, describeChildResult, runInstalledCli, cliCommand, envWithBin, repoRoot, tempRoot, installedPackageRoot, snapshotDirectory, diffSnapshots } = ctx;
  const pass = (label, detail) => console.log(`${label}: PASS${detail ? ` (${detail})` : ""}`);
  const readJson = (file, gate) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      fail(gate, `Expected readable JSON at ${path.basename(file)}: ${error.message}`);
    }
  };
  const requireFile = (file, gate) => {
    if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) fail(gate, `Expected a non-empty file: ${path.basename(file)}`);
  };

  // Short, space-containing directories keep the default output path inside the Windows path limit.
  const base = path.join(tempRoot, "asr acc");
  const invocationCwd = path.join(base, "inv cwd");
  // The default output tree (workspace/lab-output/experiments/<id>/<target>/<run>/sandboxes/<id>/...) is deep, and on Windows a
  // sandbox working directory beyond MAX_PATH makes process spawning fail. The workspace therefore lives directly under the OS
  // temp directory (short, still containing spaces) and is removed when this section ends.
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "asr w "));
  workspaces.push(workspaceDir);
  const unrelatedDir = path.join(workspaceDir, "unrelated");
  const fixturesDir = path.join(base, "fixtures");
  const agentBin = path.join(base, "agent bin");
  for (const directory of [invocationCwd, unrelatedDir, fixturesDir, agentBin]) mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(unrelatedDir, "keep.txt"), "unrelated workspace content\n", "utf8");

  const installedCatalogPath = path.join(installedPackageRoot, ...AGENT_SUCCESS_TASK_CATALOG.split("/"));
  const installedProfilesPath = path.join(installedPackageRoot, ...AGENT_SUCCESS_PROJECT_PROFILES.split("/"));
  const installedProjectRoot = (project) => path.join(installedPackageRoot, "benchmarks", "projects", project);

  // ---- snapshots taken before any agent-success execution --------------------------------------------------------
  const immutabilityTargets = [
    ["installed package", installedPackageRoot],
    ["installed task-board project", installedProjectRoot(AGENT_SUCCESS_PROJECTS[0])],
    ["installed inventory project", installedProjectRoot(AGENT_SUCCESS_PROJECTS[1])],
    ["workspace sibling content", unrelatedDir]
  ];
  const before = new Map();
  for (const [label, root] of immutabilityTargets) before.set(label, await snapshotDirectory(root));
  const catalogBytesBefore = readFileSync(installedCatalogPath);
  const profilesBytesBefore = readFileSync(installedProfilesPath);
  const assertImmutable = async (stage) => {
    for (const [label, root] of immutabilityTargets) {
      const changes = diffSnapshots(before.get(label), await snapshotDirectory(root));
      if (changes.length > 0) fail("AGENT_SUCCESS_IMMUTABILITY", `${label} changed ${stage}: ${changes.slice(0, 8).join(", ")}`);
    }
    if (!readFileSync(installedCatalogPath).equals(catalogBytesBefore) || !readFileSync(installedProfilesPath).equals(profilesBytesBefore)) {
      fail("AGENT_SUCCESS_IMMUTABILITY", `An installed catalog changed ${stage}.`);
    }
  };

  // ---- 1. PACKAGE CONTENTS ---------------------------------------------------------------------------------------
  {
    const gate = "AGENT_SUCCESS_PACKAGE_CONTENTS";
    const missing = AGENT_SUCCESS_REQUIRED_TARBALL_PATHS.filter((entry) => !ctx.tarballFiles.has(entry));
    if (missing.length > 0) fail(gate, `Required agent-success-rate file(s) missing from the exact tarball: ${missing.join(", ")}`);
    for (const entry of AGENT_SUCCESS_REQUIRED_TARBALL_PATHS) {
      if (!existsSync(path.join(installedPackageRoot, ...entry.split("/")))) fail(gate, `Required file is in the tarball but not installed: ${entry}`);
    }
    const catalog = readJson(installedCatalogPath, gate);
    const sourceCatalog = readJson(path.join(repoRoot, ...AGENT_SUCCESS_TASK_CATALOG.split("/")), gate);
    if (!Array.isArray(catalog) || catalog.length !== 6) fail(gate, `Installed task catalog has ${Array.isArray(catalog) ? catalog.length : "no"} tasks, expected 6.`);
    if (JSON.stringify(catalog) !== JSON.stringify(sourceCatalog)) fail(gate, "The installed task catalog differs from the candidate's own catalog.");
    const profiles = readJson(installedProfilesPath, gate);
    if (JSON.stringify(profiles) !== JSON.stringify(readJson(path.join(repoRoot, ...AGENT_SUCCESS_PROJECT_PROFILES.split("/")), gate))) {
      fail(gate, "The installed project-profile catalog differs from the candidate's own catalog.");
    }
    for (const project of AGENT_SUCCESS_PROJECTS) {
      const attributes = path.join(installedProjectRoot(project), ".gitattributes");
      if (!readFileSync(attributes, "utf8").replace(/\r\n/g, "\n").includes("* text eol=lf")) fail(gate, `${project} lost its project-local .gitattributes line-ending contract.`);
      const projectManifest = readJson(path.join(installedProjectRoot(project), "package.json"), gate);
      if (projectManifest.private !== true) fail(gate, `${project} package.json is not private.`);
    }
    pass(gate, `${AGENT_SUCCESS_REQUIRED_TARBALL_PATHS.length} required compiled owners and resources present in the exact tarball and installed; six-task catalog and profiles identical to the candidate; project .gitattributes intact`);
  }

  // ---- 2. DISCOVERY (from an independent invocation directory) -----------------------------------------------------
  const listResult = runInstalledCli(cliCommand, invocationCwd, ["experiment", "list", "--json"], envWithBin);
  if (listResult.status !== 0) fail("AGENT_SUCCESS_DISCOVERY", "Installed `experiment list --json` failed from the independent directory.", describeChildResult(listResult));
  const listed = JSON.parse(listResult.stdout).experiments;
  {
    const gate = "AGENT_SUCCESS_DISCOVERY";
    const ids = listed.map((entry) => entry.id);
    const entries = listed.filter((entry) => entry.id === AGENT_SUCCESS_PLUGIN_ID);
    if (ids.length !== 8) fail(gate, `Expected eight installed experiment plugins, found ${ids.length}: ${ids.join(", ")}`);
    if (entries.length !== 1) fail(gate, `${AGENT_SUCCESS_PLUGIN_ID} occurs ${entries.length} times in the installed list.`);
    if (JSON.stringify(ids.slice(0, 7)) !== JSON.stringify(AGENT_SUCCESS_LEGACY_EXPERIMENT_IDS)) fail(gate, `Historical plugin ids or their order changed: ${ids.join(", ")}`);
    if (ids[7] !== AGENT_SUCCESS_PLUGIN_ID) fail(gate, `${AGENT_SUCCESS_PLUGIN_ID} is not the eighth plugin: ${ids.join(", ")}`);
    if (entries[0].status !== "experimental") fail(gate, `${AGENT_SUCCESS_PLUGIN_ID} status is ${entries[0].status}, expected experimental.`);
    if (JSON.stringify(entries[0].supportedTargets) !== JSON.stringify(["self"])) fail(gate, "agent-success-rate must be self-target only.");
    pass(gate, "eight plugins; seven historical ids unchanged and in order; agent-success-rate listed once, last and experimental");
  }

  // ---- 3. DESCRIBE --------------------------------------------------------------------------------------------------
  {
    const gate = "AGENT_SUCCESS_DESCRIBE";
    const result = runInstalledCli(cliCommand, invocationCwd, ["experiment", "describe", "--experiment", AGENT_SUCCESS_PLUGIN_ID, "--json"], envWithBin);
    if (result.status !== 0) fail(gate, "Installed describe failed.", describeChildResult(result));
    const described = JSON.parse(result.stdout);
    const names = (fields) => (fields ?? []).map((field) => field.name);
    const asr = described.agentSuccessRate ?? {};
    if (
      described.metadata?.id !== AGENT_SUCCESS_PLUGIN_ID ||
      described.metadata?.status !== "experimental" ||
      described.metadata?.schemaVersion !== "1.0.0" ||
      JSON.stringify(described.metadata?.supportedTargets) !== JSON.stringify(["self"]) ||
      JSON.stringify(described.metadata?.supportedOutputs) !== JSON.stringify(["json", "html", "text", "artifact"]) ||
      JSON.stringify(described.supportedVariants) !== JSON.stringify(AGENT_SUCCESS_TREATMENTS) ||
      JSON.stringify(names(described.requiredConfigFields)) !== JSON.stringify(["outDir"]) ||
      JSON.stringify(names(described.optionalConfigFields)) !== JSON.stringify(["caseIds", "benchmarkProjects", "agentId", "includeRealAgents", "timeoutMs", "kitCommand", "repairAttempts"]) ||
      JSON.stringify(asr.treatments) !== JSON.stringify(AGENT_SUCCESS_TREATMENTS) ||
      JSON.stringify(asr.providers) !== JSON.stringify(["codex", "claude"]) ||
      !/^deterministic-fixture/.test(asr.defaultMode ?? "") ||
      !/Opt-in only/.test(asr.realAgentMode ?? "") ||
      asr.timeoutMs?.default !== 240000 ||
      asr.timeoutMs?.maximum !== 1800000 ||
      JSON.stringify(asr.repairAttempts?.allowed) !== JSON.stringify([0, 1, 2]) ||
      asr.repairAttempts?.default !== 0 ||
      asr.repairAttempts?.maximumTotalAttemptsPerTreatment !== 3 ||
      JSON.stringify(asr.reportOutputs) !== JSON.stringify(["report.json", "report.html", "report.txt", AGENT_SUCCESS_EXECUTION_FILE, AGENT_SUCCESS_ANALYSIS_FILE])
    ) {
      fail(gate, "Installed describe output is not the expected agent-success-rate contract.", result.stdout);
    }
    pass(gate, "self-only; raw-full-file then context-pack; deterministic default; real-provider opt-in; repairAttempts 0-2 (max 3 attempts); timeout 240000/1800000; json/html/text/artifact outputs");
  }

  // ---- 4. HELP -------------------------------------------------------------------------------------------------------
  {
    const gate = "AGENT_SUCCESS_HELP";
    const result = runInstalledCli(cliCommand, invocationCwd, ["experiment", "run", "--help"], envWithBin);
    if (result.status !== 0) fail(gate, "Installed `experiment run --help` failed.", describeChildResult(result));
    const section = normalizeSpace(result.stdout.slice(result.stdout.indexOf("agent-success-rate only:")));
    for (const phrase of [
      "agent-success-rate only:",
      "Self-target only (the Lab itself); --target is rejected.",
      "deterministic-fixture mode",
      "invokes no coding agent",
      "Accepted options: --out, --case, --benchmark-project, --kit-command, --agent, --include-real-agents, --timeout-ms and --repair-attempts",
      "--agent <codex|claude>",
      "Real-agent mode is entered only when --agent is combined with --include-real-agents; neither flag works alone.",
      "Explicit authorization to invoke the selected provider. Without it no provider is ever launched.",
      "default 240000, maximum 1800000",
      "--repair-attempts <0|1|2>",
      "At most 3 attempts per treatment.",
      "in a fresh sandbox",
      "Initial-attempt and final success are reported separately.",
      "no winner, ranking, composite score or significance claim"
    ]) {
      if (!section.includes(phrase)) fail(gate, `Installed help does not document: ${phrase}`);
    }
    if (result.stdout.indexOf("agent-success-rate only:") < 0) fail(gate, "Installed help has no agent-success-rate section.");
    pass(gate, "mode, provider opt-in, timeout default/maximum, repair bound, exclusions and separate initial/final reporting documented; no new command family");
  }

  // ---- deterministic campaign (default output, explicit --workspace) ------------------------------------------------
  const detOut = path.join(base, "det run");
  const catalog = readJson(installedCatalogPath, "AGENT_SUCCESS_DETERMINISTIC_RUN");
  const taskById = new Map(catalog.map((task) => [task.id, task]));
  const catalogIds = catalog.map((task) => task.id);
  const providerStateRoot = path.join(base, "provider state");
  const providerLogOf = (stateDir) => {
    const file = path.join(stateDir, "invocations.jsonl");
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  const noProviderEnv = () => ({ ...envWithBin });

  // The deterministic run must not launch any provider even if one were on PATH: give it a PATH with a recording fake.
  const sentinelStateDir = path.join(providerStateRoot, "deterministic");
  mkdirSync(sentinelStateDir, { recursive: true });
  for (const name of ["packedAgentSuccessProvider.mjs", "fakeAgentSuccessKit.mjs"]) copyFileSync(path.join(repoRoot, "tests", "scripts", "fixtures", name), path.join(fixturesDir, name));
  for (const providerId of ["codex", "claude"]) {
    const wrapper = path.join(fixturesDir, `${providerId}-fixture.mjs`);
    writeFileSync(wrapper, `import { runProvider } from "./packedAgentSuccessProvider.mjs";\nrunProvider(${JSON.stringify(providerId)});\n`, "utf8");
    ctx.writeFakeAgentLauncher(agentBin, providerId, wrapper);
  }
  const kitScript = path.join(fixturesDir, "fakeAgentSuccessKit.mjs");
  const kitCommand = `"${process.execPath}" "${kitScript}"`;
  // The trusted checks and sandbox run `node` and `git`; nothing else is reachable. Real `codex`/`claude` executables must NOT
  // be discoverable: only the fakes in `agent bin` may answer to those names, so no paid provider can ever be launched.
  const hostPath = envWithBin.Path ?? envWithBin.PATH ?? process.env.PATH ?? "";
  const gitDirectories = executableDirectories("git", hostPath);
  if (gitDirectories.length === 0) fail("AGENT_SUCCESS_DETERMINISTIC_RUN", "git was not found on PATH; the benchmark sandbox cannot run.");
  const providerPathDirs = [ctx.consumerBinDir, agentBin, gitDirectories[0]];
  const providerEnvBase = ctx.isolatedProviderEnv(envWithBin, providerPathDirs);
  const narrowedPath = providerEnvBase.Path ?? providerEnvBase.PATH;
  for (const providerId of ["codex", "claude"]) {
    const directories = executableDirectories(providerId, narrowedPath);
    if (directories.length !== 1 || path.resolve(directories[0]) !== path.resolve(agentBin)) {
      fail("AGENT_SUCCESS_PROVIDER_TRANSPORT", `A real ${providerId} executable could be discovered on the acceptance PATH (${directories.join(", ")}); refusing to run.`);
    }
  }
  const providerEnv = (stateDir, kitLog) => ({
    ...providerEnvBase,
    ASR_PACKED_STATE_DIR: stateDir,
    ...(kitLog ? { ASR_KIT_LOG: kitLog } : {})
  });

  {
    const gate = "AGENT_SUCCESS_DETERMINISTIC_RUN";
    const result = runInstalledCli(cliCommand, invocationCwd, ["--workspace", workspaceDir, "experiment", "run", "--experiment", AGENT_SUCCESS_PLUGIN_ID, "--out", detOut], providerEnv(sentinelStateDir));
    if (result.status !== 0) fail(gate, "Installed deterministic six-case campaign did not exit 0.", describeChildResult(result));
    if (providerLogOf(sentinelStateDir).length > 0) fail(gate, "The deterministic run launched a provider process.");
    if (!/Execution mode: deterministic-fixture/.test(result.stdout) || !/Provider: none/.test(result.stdout)) fail(gate, "The deterministic run does not state its mode and that no provider ran.", result.stdout);
    for (const name of [AGENT_SUCCESS_EXECUTION_FILE, AGENT_SUCCESS_ANALYSIS_FILE, "report.json", "report.html", "report.txt"]) requireFile(path.join(detOut, name), gate);
  }
  const detExecution = readJson(path.join(detOut, AGENT_SUCCESS_EXECUTION_FILE), "AGENT_SUCCESS_DETERMINISTIC_RUN");
  const detAnalysis = readJson(path.join(detOut, AGENT_SUCCESS_ANALYSIS_FILE), "AGENT_SUCCESS_DETERMINISTIC_RUN");
  const detReport = readJson(path.join(detOut, "report.json"), "AGENT_SUCCESS_DETERMINISTIC_RUN");

  // Shared scientific cross-check: execution evidence, analysis artifact and typed report section must agree.
  const crossCheck = (gate, execution, analysis, report, expectation) => {
    if (execution.schemaVersion !== AGENT_SUCCESS_SCHEMAS.execution) fail(gate, `Execution schema is ${execution.schemaVersion}.`);
    if (analysis.schemaVersion !== AGENT_SUCCESS_SCHEMAS.analysis) fail(gate, `Analysis schema is ${analysis.schemaVersion}.`);
    const section = report.report?.agentSuccessRate;
    if (section?.schemaVersion !== AGENT_SUCCESS_SCHEMAS.report) fail(gate, `Report section schema is ${section?.schemaVersion}.`);
    for (const [label, value] of [["execution", execution.runId], ["analysis", analysis.runId], ["report", section.identity.runId]]) {
      if (value !== execution.runId) fail(gate, `${label} run id disagrees with the execution artifact.`);
    }
    if (execution.pluginId !== AGENT_SUCCESS_PLUGIN_ID || analysis.pluginId !== AGENT_SUCCESS_PLUGIN_ID) fail(gate, "Artifact plugin id is wrong.");
    if (JSON.stringify(execution.treatmentOrder) !== JSON.stringify(AGENT_SUCCESS_TREATMENTS) || JSON.stringify(analysis.analysis.treatmentOrder) !== JSON.stringify(AGENT_SUCCESS_TREATMENTS)) fail(gate, "Treatment order is not raw-full-file then context-pack.");
    if (execution.executionMode !== expectation.mode || analysis.analysis.executionMode !== expectation.mode || section.identity.executionMode !== expectation.mode) fail(gate, `Execution mode is not ${expectation.mode} in every layer.`);
    if (analysis.analysis.contextEffectEvaluated !== execution.contextEffectEvaluated) fail(gate, "contextEffectEvaluated disagrees between execution and analysis.");
    if (expectation.mode === "deterministic-fixture" && execution.contextEffectEvaluated !== false) fail(gate, "Deterministic fixture mode must report contextEffectEvaluated=false.");
    const executionCaseIds = execution.cases.map((entry) => entry.caseId);
    if (JSON.stringify(executionCaseIds) !== JSON.stringify(expectation.caseIds)) fail(gate, `Execution case ids/order are ${executionCaseIds.join(", ")}.`);
    if (JSON.stringify(analysis.analysis.cases.map((entry) => entry.caseId)) !== JSON.stringify(expectation.caseIds)) fail(gate, "Analysis case order differs from the execution artifact.");
    if (JSON.stringify(section.cases.map((entry) => entry.caseId)) !== JSON.stringify(expectation.caseIds)) fail(gate, "Report case order differs from the execution artifact.");
    if (section.identity.caseCount !== expectation.caseIds.length || section.identity.treatmentOutcomeCount !== expectation.caseIds.length * 2) fail(gate, "Report identity counts disagree with the execution artifact.");
    const outcomes = [];
    execution.cases.forEach((executionCase, caseIndex) => {
      const analysisCase = analysis.analysis.cases[caseIndex];
      const reportCase = section.cases[caseIndex];
      if (JSON.stringify(executionCase.treatments.map((entry) => entry.treatmentId)) !== JSON.stringify(AGENT_SUCCESS_TREATMENTS)) fail(gate, `${executionCase.caseId}: treatments are not raw-full-file then context-pack.`);
      executionCase.treatments.forEach((treatment, index) => {
        const label = `${executionCase.caseId}/${treatment.treatmentId}`;
        const analysed = analysisCase.treatments[index];
        const reported = reportCase.treatments[index];
        if (analysed.treatmentId !== treatment.treatmentId || reported.treatmentId !== treatment.treatmentId) fail(gate, `${label}: treatment identity disagrees between layers.`);
        const metrics = analysed.metrics;
        const attempts = treatment.attempts ?? [null];
        const repair = analysed.repair;
        const initial = repair ? metricValue(repair.initialAttemptTaskSuccess) : metricValue(metrics.taskSuccess);
        const final = metricValue(metrics.taskSuccess);
        // The report layer carries the same verdicts and counts as the analysis (it recomputes nothing).
        if (metricValue(reported.finalTaskSuccess) !== final) fail(gate, `${label}: report final success disagrees with the analysis.`);
        if (metricValue(reported.initialTaskSuccess) !== initial) fail(gate, `${label}: report initial success disagrees with the analysis.`);
        if (reported.attemptCount !== attempts.length) fail(gate, `${label}: report attemptCount ${reported.attemptCount} != ${attempts.length}.`);
        if (reported.repairAttemptCount !== attempts.length - 1) fail(gate, `${label}: report repairAttemptCount is wrong.`);
        if (repair) {
          if (repair.attemptCount !== attempts.length || repair.repairAttemptCount !== attempts.length - 1) fail(gate, `${label}: analysis attempt counts disagree with the execution attempts.`);
          if (JSON.stringify(metricValue(repair.repairSucceeded)) !== JSON.stringify(metricValue(reported.repairSucceeded))) fail(gate, `${label}: repairSucceeded disagrees between analysis and report.`);
        } else if (attempts.length !== 1) fail(gate, `${label}: multiple attempts without a repair analysis.`);
        // execution <-> analysis for the final evaluated attempt
        const post = treatment.postEditVerification;
        if (post && metrics.taskCheckPassedCount.availability === "available") {
          const passed = post.taskResults.filter((result) => result.status === "passed").length;
          if (metrics.taskCheckPassedCount.value !== passed || metrics.taskCheckTotalCount.value !== post.taskResults.length) fail(gate, `${label}: task-check counts disagree between execution and analysis.`);
          const regressionPassed = post.regressionResults.filter((result) => result.status === "passed").length;
          if (metrics.regressionCheckPassedCount.value !== regressionPassed || metrics.regressionCheckTotalCount.value !== post.regressionResults.length) fail(gate, `${label}: regression counts disagree between execution and analysis.`);
        }
        if (treatment.change && metrics.changedFileCount?.availability === "available") {
          if (metrics.changedFileCount.value !== treatment.change.changedCount) fail(gate, `${label}: changed-file count disagrees between execution and analysis.`);
          if (metrics.totalChurn?.availability === "available" && metrics.totalChurn.value !== treatment.change.totalAdditions + treatment.change.totalDeletions) fail(gate, `${label}: total churn disagrees between execution and analysis.`);
        }
        // Unavailable evidence is never reported as zero or as a verdict.
        for (const [id, metric] of Object.entries(metrics)) {
          if (metric.availability !== "available" && metric.value !== null && metric.value !== undefined) fail(gate, `${label}: unavailable metric ${id} carries a value (${JSON.stringify(metric.value)}).`);
        }
        outcomes.push({ label, treatment, analysed, reported, initial, final, attempts });
      });
    });
    return outcomes;
  };

  // ---- 5. DETERMINISTIC RUN: six cases, twelve outcomes ------------------------------------------------------------
  {
    const gate = "AGENT_SUCCESS_DETERMINISTIC_RUN";
    const outcomes = crossCheck(gate, detExecution, detAnalysis, detReport, { mode: "deterministic-fixture", caseIds: catalogIds });
    if (outcomes.length !== 12) fail(gate, `Expected 12 treatment outcomes, found ${outcomes.length}.`);
    const sandboxIds = new Set();
    for (const outcome of outcomes) {
      const { label, treatment, analysed } = outcome;
      const metrics = analysed.metrics;
      if (treatment.status !== "completed" || treatment.availability !== "complete") fail(gate, `${label}: status ${treatment.status}/${treatment.availability}.`);
      if (treatment.baselineAssessment?.evaluable !== true) fail(gate, `${label}: the baseline is not evaluable.`);
      if (treatment.baselineVerification.taskResults.some((r) => r.status !== "failed") ) fail(gate, `${label}: a task check passes at the baseline, so the task would be trivially solved.`);
      if (treatment.patch?.outcome !== "success") fail(gate, `${label}: reference patch outcome ${treatment.patch?.outcome}.`);
      if ([...treatment.postEditVerification.taskResults, ...treatment.postEditVerification.regressionResults].some((r) => r.status !== "passed")) fail(gate, `${label}: a trusted check failed after the reference patch.`);
      if (treatment.protectedIntegrity.status !== "intact") fail(gate, `${label}: protected files not intact.`);
      if (!treatment.change || treatment.change.changedCount < 1) fail(gate, `${label}: no verified change evidence.`);
      if (treatment.cleanup?.attempted !== true || treatment.cleanup?.removed !== true) fail(gate, `${label}: sandbox cleanup is not proven.`);
      if (treatment.realAgent !== undefined || treatment.attempts !== undefined) fail(gate, `${label}: deterministic evidence carries real-agent or attempt data.`);
      if (treatment.agentTokenUsage !== null || treatment.timing.agentDurationMs !== null) fail(gate, `${label}: deterministic mode reports provider telemetry.`);
      if (treatment.errors.length > 0) fail(gate, `${label}: execution errors ${JSON.stringify(treatment.errors.map((e) => e.code))}.`);
      for (const id of ["taskSuccess", "taskChecksPassed", "regressionSafe", "requiredFactsSatisfied", "protectedIntegrity", "patchApplied"]) {
        if (metricValue(metrics[id]) !== true) fail(gate, `${label}: ${id} is not true.`);
      }
      if (outcome.initial !== true || outcome.final !== true) fail(gate, `${label}: initial/final success is not true.`);
      if (sandboxIds.has(treatment.sandboxId)) fail(gate, `${label}: sandbox id reused.`);
      sandboxIds.add(treatment.sandboxId);
      for (const patchPath of [treatment.proposedPatchPath, treatment.appliedPatchPath]) {
        if (!patchPath || path.isAbsolute(patchPath) || patchPath.includes("..")) fail(gate, `${label}: patch artifact path is not a relative reference: ${patchPath}`);
        requireFile(path.join(detOut, ...patchPath.split("/")), gate);
      }
      const task = taskById.get(label.split("/")[0]);
      if (treatment.patch.appliedFiles.length === 0 || treatment.patch.appliedFiles.some((file) => !task.allowedEditFiles.includes(file.path))) fail(gate, `${label}: applied files fall outside the task's allowed files.`);
    }
    if (detAnalysis.analysis.caseCount !== 6) fail(gate, "Analysis caseCount is not 6.");
    pass(gate, "installed bin; consumer cwd and workspace with spaces; 6 cases x 2 treatments = 12 outcomes; reference patches pass trusted checks; no provider process; contextEffectEvaluated=false");
  }

  // ---- 6. CORPUS ----------------------------------------------------------------------------------------------------
  {
    const gate = "AGENT_SUCCESS_CORPUS";
    const projectOfCase = detExecution.cases.map((entry) => entry.benchmarkProject);
    const expectedProjects = catalog.map((task) => task.benchmarkProject);
    if (JSON.stringify(projectOfCase) !== JSON.stringify(expectedProjects)) fail(gate, "Execution project ids differ from the catalog.");
    if (JSON.stringify([...new Set(projectOfCase)].sort()) !== JSON.stringify([...AGENT_SUCCESS_PROJECTS].sort())) fail(gate, "The run did not cover both canonical projects.");
    const localities = new Set(catalog.map((task) => task.taskLocality));
    if (!["localized", "cross-module", "broad-change"].every((locality) => localities.has(locality))) fail(gate, "The catalog does not cover all three localities.");
    for (const project of AGENT_SUCCESS_PROJECTS) {
      const baselineCommits = new Set(detExecution.cases.filter((entry) => entry.benchmarkProject === project).flatMap((entry) => entry.treatments.map((t) => t.sandboxBaseline.digest)));
      if (baselineCommits.size !== 1) fail(gate, `${project}: sandbox baselines are not identical across tasks and treatments.`);
    }
    pass(gate, "catalog order and project ids preserved; both baselines evaluable and identical per project; localized, cross-module and broad-change tasks all solved by their reference patches");
  }

  // ---- 7. REPORTS ---------------------------------------------------------------------------------------------------
  const htmlEscape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const reportTextChecks = (gate, outDir, report, analysis, extraText = []) => {
    const text = readFileSync(path.join(outDir, "report.txt"), "utf8");
    const html = readFileSync(path.join(outDir, "report.html"), "utf8");
    const section = report.report.agentSuccessRate;
    for (const [label, output] of [["report.txt", text], ["report.html", html]]) {
      for (const required of ["Agent Success Rate", "raw-full-file", "context-pack", ...section.cases.map((entry) => entry.caseId), ...extraText]) {
        if (!output.includes(required)) fail(gate, `${label} does not contain "${required}".`);
      }
    }
    if (!/initial task success: (yes|no|unavailable); final task success: (yes|no|unavailable); attempts=\d+; repair attempts=\d+/.test(text)) fail(gate, "report.txt does not present initial and final success separately.");
    if (!html.includes("Per-Attempt Repair History") || !html.includes("Duration And Token Evidence")) fail(gate, "report.html lacks the repair-history and duration/token sections.");
    if (/<script/i.test(html)) fail(gate, "report.html contains a script element.");
    return { text, html, section };
  };
  {
    const gate = "AGENT_SUCCESS_REPORTS";
    const { text, html, section } = reportTextChecks(gate, detOut, detReport, detAnalysis, ["deterministic-fixture"]);
    if (section.resultAvailability.overall !== "complete" || section.resultAvailability.evaluableTreatmentOutcomes !== 12) fail(gate, "Report availability is not complete 12/12.");
    for (const treatment of section.treatments) {
      if (treatment.initialSuccessfulCases !== 6 || treatment.finalSuccessfulCases !== 6 || treatment.repair !== null) fail(gate, `${treatment.treatmentId}: report treatment summary is wrong.`);
    }
    if (section.comparison !== null) fail(gate, "Deterministic mode must not present a context comparison.");
    if (!/does not measure a coding agent/.test(section.scientificStatement)) fail(gate, "The deterministic scientific statement is missing.");
    if (/winner|ranking|composite/i.test(JSON.stringify(Object.keys(section))) ) fail(gate, "The typed section exposes a ranking/winner/composite property.");
    // HTML escaping: dynamic values are escaped, so no raw angle bracket from data may appear; spot-check a representative title.
    const titleWithMarkup = "<b>&\"'";
    if (html.includes(titleWithMarkup)) fail(gate, "report.html contains unescaped markup characters from dynamic data.");
    if (!html.includes(htmlEscape("Normalize task titles on creation"))) fail(gate, "report.html does not contain the case title.");
    // Machine-local paths: typed section and artifact references stay relative.
    const sectionJson = JSON.stringify(section);
    for (const root of [detOut, installedPackageRoot, tempRoot, repoRoot]) {
      for (const form of [root, root.replace(/\\/g, "\\\\"), root.replace(/\\/g, "/")]) {
        if (sectionJson.includes(form)) fail(gate, "The typed report section embeds a machine-local path.");
      }
    }
    for (const artifact of section.artifacts ?? []) {
      const reference = artifact.path ?? "";
      if (path.isAbsolute(reference) || /^[A-Za-z]:/.test(reference) || reference.includes("..")) fail(gate, `Artifact reference is not relative: ${reference}`);
    }
    if (!text.includes("Provider: none (no coding agent was invoked)")) fail(gate, "report.txt does not state that no coding agent was invoked.");
    pass(gate, "report.json typed section, report.html and report.txt agree with the execution and analysis artifacts; initial and final success presented separately; unavailable values never zero; dynamic text escaped; artifact references relative");
  }

  // ---- filters (selection preserves catalog order) ------------------------------------------------------------------
  const runDeterministic = (extra, name) => {
    const out = path.join(base, name);
    const result = runInstalledCli(cliCommand, invocationCwd, ["experiment", "run", "--experiment", AGENT_SUCCESS_PLUGIN_ID, ...extra, "--out", out], providerEnv(sentinelStateDir));
    return { result, out };
  };
  {
    const gate = "AGENT_SUCCESS_CORPUS";
    const localized = catalog.find((task) => task.taskLocality === "localized");
    const broad = catalog.find((task) => task.taskLocality === "broad-change" && task.benchmarkProject !== localized.benchmarkProject);
    const reversed = `${broad.id},${localized.id}`;
    const expected = catalogIds.filter((id) => id === localized.id || id === broad.id);
    const byCase = runDeterministic(["--case", reversed], "filter case");
    if (byCase.result.status !== 0) fail(gate, "Installed --case selection failed.", describeChildResult(byCase.result));
    const selected = readJson(path.join(byCase.out, AGENT_SUCCESS_EXECUTION_FILE), gate).cases.map((entry) => entry.caseId);
    if (JSON.stringify(selected) !== JSON.stringify(expected)) fail(gate, `--case reordered the catalog: asked ${reversed}, got ${selected.join(",")}.`);
    const byProject = runDeterministic(["--benchmark-project", AGENT_SUCCESS_PROJECTS[1]], "filter project");
    if (byProject.result.status !== 0) fail(gate, "Installed --benchmark-project selection failed.", describeChildResult(byProject.result));
    const projectSelected = readJson(path.join(byProject.out, AGENT_SUCCESS_EXECUTION_FILE), gate).cases.map((entry) => entry.caseId);
    const expectedProject = catalog.filter((task) => task.benchmarkProject === AGENT_SUCCESS_PROJECTS[1]).map((task) => task.id);
    if (JSON.stringify(projectSelected) !== JSON.stringify(expectedProject)) fail(gate, `--benchmark-project selection is wrong: ${projectSelected.join(",")}.`);
    pass("AGENT_SUCCESS_CORPUS", `filters: a reversed --case pair ran in catalog order (${expected.join(" -> ")}); --benchmark-project selected ${expectedProject.length} tasks of ${AGENT_SUCCESS_PROJECTS[1]}`);
  }

  // ---- 8. OUTPUT ROOT: resource resolution, workspace, default output --------------------------------------------------
  {
    const gate = "AGENT_SUCCESS_OUTPUT_ROOT";
    // Default output (no --out) with the global --workspace, from the independent invocation directory.
    const defaultRun = runInstalledCli(
      cliCommand,
      invocationCwd,
      ["--workspace", workspaceDir, "experiment", "run", "--experiment", AGENT_SUCCESS_PLUGIN_ID, "--case", catalogIds[0]],
      providerEnv(sentinelStateDir)
    );
    if (defaultRun.status !== 0) fail(gate, "Installed run with the default output location failed.", describeChildResult(defaultRun));
    const outputLine = /^Output: (.+)$/m.exec(defaultRun.stdout)?.[1]?.trim();
    if (!outputLine) fail(gate, "The default run did not report its output directory.", defaultRun.stdout);
    if (!isInside(workspaceDir, outputLine)) fail(gate, "The default output is not inside the explicit workspace.");
    if (isInside(installedPackageRoot, outputLine) || isInside(repoRoot, outputLine) || isInside(invocationCwd, outputLine)) fail(gate, "The default output is inside the package, checkout or invocation directory.");
    requireFile(path.join(outputLine, "report.json"), gate);
    requireFile(path.join(outputLine, AGENT_SUCCESS_EXECUTION_FILE), gate);
    // Nothing was written into the invocation directory, the package, the canonical projects or the checkout by any run so far.
    if (listFilesRecursive(invocationCwd).length > 0) fail(gate, `Output was silently written to the invocation directory: ${listFilesRecursive(invocationCwd).slice(0, 5).join(", ")}`);
    if (existsSync(path.join(installedPackageRoot, "lab-output")) || existsSync(path.join(installedPackageRoot, "reports"))) fail(gate, "An output directory appeared inside the installed package.");
    for (const project of AGENT_SUCCESS_PROJECTS) {
      for (const stray of ["lab-output", "sandboxes", "diffs", "agents", ".git"]) if (existsSync(path.join(installedProjectRoot(project), stray))) fail(gate, `${project} gained ${stray}.`);
    }
    // The bundled corpus was resolved from the package root, not the cwd: run with a cwd that has its own decoy benchmarks tree.
    const decoyCwd = path.join(base, "decoy cwd");
    mkdirSync(path.join(decoyCwd, "benchmarks", "contracts"), { recursive: true });
    writeFileSync(path.join(decoyCwd, "benchmarks", "contracts", "agent-success-rate-tasks.json"), "[]", "utf8");
    const decoyRun = runInstalledCli(cliCommand, decoyCwd, ["experiment", "run", "--experiment", AGENT_SUCCESS_PLUGIN_ID, "--case", catalogIds[3], "--out", path.join(base, "decoy run")], providerEnv(sentinelStateDir));
    if (decoyRun.status !== 0) fail(gate, "A cwd containing a decoy benchmarks tree changed which corpus the installed CLI resolved.", describeChildResult(decoyRun));
    const decoyCases = readJson(path.join(base, "decoy run", AGENT_SUCCESS_EXECUTION_FILE), gate).cases.map((entry) => entry.caseId);
    if (JSON.stringify(decoyCases) !== JSON.stringify([catalogIds[3]])) fail(gate, "The decoy cwd corpus influenced the run.");
    // PATH-012: an output root deep enough that the OS may refuse to start a process in the sandbox must never crash the installed
    // CLI. The host decides the outcome (probed with a plain Node spawn, not assumed from any length): either the run completes, or
    // it ends in a controlled, reported infrastructure failure -- never an unhandled stream error, never a success verdict.
    {
      let deepOut = path.join(base, "deep out");
      while (deepOut.length < 300) deepOut = path.join(deepOut, "n".repeat(Math.max(1, Math.min(40, 300 - deepOut.length - 1))));
      mkdirSync(deepOut, { recursive: true });
      const hostCanSpawnDeep = runInstalledCli({ command: process.execPath, argsPrefix: ["-e", "1"], resolutionKind: "direct" }, deepOut, [], envWithBin).status === 0;
      const deepRun = runInstalledCli(cliCommand, invocationCwd, ["experiment", "run", "--experiment", AGENT_SUCCESS_PLUGIN_ID, "--case", catalogIds[0], "--out", deepOut], providerEnv(sentinelStateDir));
      const diagnostics = `${deepRun.stderr ?? ""}\n${deepRun.stdout ?? ""}`;
      if (/Unhandled 'error' event|ENOTCONN|throw er;/.test(diagnostics.replace(/SANDBOX_GIT_FAILED[^\n]*/g, ""))) fail(gate, "A deep output root produced an unhandled process error in the installed CLI.", describeChildResult(deepRun));
      const deepExecution = readJson(path.join(deepOut, AGENT_SUCCESS_EXECUTION_FILE), gate);
      const deepTreatments = deepExecution.cases.flatMap((entry) => entry.treatments);
      if (hostCanSpawnDeep) {
        if (deepRun.status !== 0 || deepTreatments.some((treatment) => treatment.status !== "completed")) fail(gate, "This host can start processes in the deep output root, but the installed run did not complete.", describeChildResult(deepRun));
      } else {
        if (deepRun.status !== 1) fail(gate, `Deep output root: expected a controlled failure (exit 1), got ${deepRun.status}.`, describeChildResult(deepRun));
        for (const treatment of deepTreatments) {
          if (treatment.status !== "failed" || treatment.availability !== "infrastructure-failure") fail(gate, "A deep-output failure was not reported as an infrastructure failure.");
          if (!treatment.errors.some((error) => error.code === "SANDBOX_GIT_FAILED" && /cwd length \d+ characters/.test(error.message))) fail(gate, "The deep-output failure carries no actionable diagnostic.");
        }
      }
      if (/"taskSuccess":\s*true/.test(JSON.stringify(deepExecution)) && !hostCanSpawnDeep) fail(gate, "A failed deep-output run reported task success.");
      for (const project of AGENT_SUCCESS_PROJECTS) {
        if (existsSync(path.join(installedProjectRoot(project), ".git"))) fail(gate, `${project} gained .git during the deep-output run.`);
      }
    }
    pass(gate, "deep output root ends in completion or a controlled infrastructure failure (never an unhandled error); bundled catalog and profiles resolved from the installed packageRoot, never the cwd; default output under the explicit workspace; explicit --out honoured; nothing written to the invocation directory, package or canonical projects");
  }

  // ---- 9. CLI REJECTION MATRIX -----------------------------------------------------------------------------------------
  {
    const gate = "AGENT_SUCCESS_CLI_REJECTION";
    const rejectState = path.join(providerStateRoot, "reject");
    mkdirSync(rejectState, { recursive: true });
    const rejectKitLog = path.join(base, "reject-kit.log");
    const rejectWorkspace = path.join(base, "reject ws");
    const rejectOut = path.join(base, "reject out", "run");
    const realFlags = ["--agent", "codex", "--include-real-agents"];
    const firstCase = catalogIds[0];
    const cases = [
      ["--agents", "codex"], ["--strategies", "raw-full-file"], ["--complexities", "short"], ["--campaign", "codex-full"], ["--max-runs", "1"],
      ["--continue-on-failure"], ["--no-continue-on-failure"], ["--require-agents"], ["--command-template-codex", "x"], ["--command-template-claude", "x"],
      ["--target", "."], ["--local-subject-config", "x.json"], ["--synthetic-config", "x.json"], ["--cases", "x"], ["--project-profiles", "x.json"],
      ["--context-budgets", "8k"], ["--no-screenshot"],
      ["--agent", "codex"], ["--include-real-agents"],
      ["--repair-attempts", "1"], ["--timeout-ms", "1000"], ["--kit-command", "x"],
      ["--agent", "codex", "--agent", "claude", "--include-real-agents"], ["--agent", "claude,codex", "--include-real-agents"], ["--agent", "gemini", "--include-real-agents"],
      [...realFlags, "--repair-attempts", "3"], [...realFlags, "--repair-attempts", "1.5"], [...realFlags, "--repair-attempts", "-1"], [...realFlags, "--repair-attempts", "x"],
      [...realFlags, "--timeout-ms", "0"], [...realFlags, "--timeout-ms", "1800001"], [...realFlags, "--timeout-ms", "abc"], [...realFlags, "--timeout-ms", "1.5"],
      ["--case", "nope"], ["--case", `${firstCase},${firstCase}`], ["--case", ""], ["--case"], ["--benchmark-project", "nope"],
      ["--benchmark-project", `${AGENT_SUCCESS_PROJECTS[0]},${AGENT_SUCCESS_PROJECTS[0]}`], ["--benchmark-project", ""], ["--agent"], ["--out"]
    ];
    for (const extra of cases) {
      const args = ["--workspace", rejectWorkspace, "experiment", "run", "--experiment", AGENT_SUCCESS_PLUGIN_ID, ...extra];
      if (!extra.includes("--out")) args.push("--out", rejectOut);
      const result = runInstalledCli(cliCommand, invocationCwd, args, providerEnv(rejectState, rejectKitLog));
      const shown = extra.join(" ") || "(none)";
      if (result.status === 0) fail(gate, `Installed CLI accepted a rejected input: ${shown}`, describeChildResult(result));
      if (/\bat (async )?[\w.<>]+ \(.*:\d+:\d+\)/.test(result.stderr ?? "") && !/Error:/.test((result.stderr ?? "").split("\n")[0])) fail(gate, `Rejection of "${shown}" produced an unbounded stack trace.`);
      if (existsSync(path.dirname(rejectOut)) || existsSync(rejectWorkspace)) fail(gate, `Rejected input "${shown}" still allocated an output or workspace directory.`);
    }
    if (providerLogOf(rejectState).length > 0) fail(gate, "A rejected command launched a provider.");
    if (existsSync(rejectKitLog)) fail(gate, "A rejected command invoked my-dev-kit.");
    pass(gate, `${cases.length} unsupported, incompatible, malformed or unknown inputs: nonzero exit, no output or workspace directory allocated, no provider launched, no my-dev-kit call`);
  }

  // ---- real-agent simulation helpers ------------------------------------------------------------------------------------
  const projectSourceText = (project) =>
    listFilesRecursive(installedProjectRoot(project))
      .filter((file) => /\.(c|m)?js$/.test(file) && !file.startsWith("tests/"))
      .map((file) => readFileSync(path.join(installedProjectRoot(project), ...file.split("/")), "utf8"))
      .join("\n");
  const referencePatch = (task) => task.deterministicFixture.patch;
  const noopPatchFor = (task) => {
    const file = task.expectedEditFiles[0];
    return buildNoopPatch(file, readFileSync(path.join(installedProjectRoot(task.benchmarkProject), ...file.split("/")), "utf8"));
  };

  /**
   * Runs the installed CLI in real-agent mode against a fake provider. `script` maps provider invocation numbers to
   * answers: { 1: text, 2: text, default: text } and optional behavior objects ({exitCode, stderr} | {noUsage:true}).
   */
  const runSimulation = (spec) => {
    const stateDir = path.join(providerStateRoot, spec.name);
    const responses = path.join(stateDir, "responses");
    mkdirSync(responses, { recursive: true });
    for (const [n, text] of Object.entries(spec.answers ?? {})) writeFileSync(path.join(responses, `${spec.caseId}.any.${n}.txt`), text, "utf8");
    for (const [n, behavior] of Object.entries(spec.behaviors ?? {})) {
      writeFileSync(path.join(responses, `${spec.caseId}.any.${n}.behavior.json`), JSON.stringify(behavior), "utf8");
      if (!(n in (spec.answers ?? {}))) writeFileSync(path.join(responses, `${spec.caseId}.any.${n}.txt`), "unused", "utf8");
    }
    const out = path.join(base, spec.name);
    const kitLog = path.join(base, `${spec.name}-kit.log`);
    const args = [
      "--workspace", workspaceDir, "experiment", "run", "--experiment", AGENT_SUCCESS_PLUGIN_ID, "--case", spec.caseId,
      "--agent", spec.provider, "--include-real-agents", "--kit-command", kitCommand, "--out", out,
      ...(spec.repairAttempts === undefined ? [] : ["--repair-attempts", String(spec.repairAttempts)])
    ];
    const result = runInstalledCli(cliCommand, invocationCwd, args, providerEnv(stateDir, kitLog));
    const kitCalls = existsSync(kitLog) ? readFileSync(kitLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    const read = (file) => (existsSync(path.join(out, file)) ? readJson(path.join(out, file), spec.gate) : null);
    return {
      spec, result, out, stateDir, kitCalls, invocations: providerLogOf(stateDir),
      execution: read(AGENT_SUCCESS_EXECUTION_FILE), analysis: read(AGENT_SUCCESS_ANALYSIS_FILE), report: read("report.json"),
      prompts: (invocation) => readFileSync(path.join(stateDir, "prompts", `${invocation.key}.${invocation.n}.prompt.txt`), "utf8")
    };
  };

  /** Everything every simulated run must satisfy: transport, cwd isolation, prompt privacy, kit filtering, artifact privacy. */
  const checkSimulationCommon = (run, expectation) => {
    const { spec } = run;
    const gate = spec.gate;
    const task = taskById.get(spec.caseId);
    const canonicalSource = projectSourceText(task.benchmarkProject);
    const frozen = spec.provider === "codex" ? ctx.codexArgs : ctx.claudeArgs;
    if (run.result.status !== expectation.exit) fail(gate, `${spec.name}: CLI exit ${run.result.status}, expected ${expectation.exit}.`, describeChildResult(run.result));
    if (run.execution === null || run.analysis === null || run.report === null) fail(gate, `${spec.name}: scientific artifacts are missing.`, describeChildResult(run.result));
    const expectedInvocations = expectation.invocationsPerTreatment * 2;
    if (run.invocations.length !== expectedInvocations) fail(gate, `${spec.name}: ${run.invocations.length} provider invocations, expected ${expectedInvocations}.`);
    for (const invocation of run.invocations) {
      if (invocation.provider !== spec.provider) fail(gate, `${spec.name}: the wrong provider executable was launched (${invocation.provider}).`);
      if (JSON.stringify(invocation.argv) !== JSON.stringify(frozen)) fail(gate, `${spec.name}: ${spec.provider} argv is not the frozen stdin transport: ${JSON.stringify(invocation.argv)}`);
      if (invocation.stdinChars < 200) fail(gate, `${spec.name}: the prompt did not arrive over stdin.`);
      const joined = invocation.argv.join(" ");
      if (/Case ID|BEGIN_SUPPLIED_CONTEXT|Implementation Benchmark/.test(joined)) fail(gate, `${spec.name}: prompt text leaked into provider argv.`);
      // neutral provider cwd: outside the package, the checkout, the canonical projects and the output tree
      for (const protectedRoot of [installedPackageRoot, repoRoot, run.out, workspaceDir, invocationCwd, installedProjectRoot(task.benchmarkProject)]) {
        if (isInside(protectedRoot, invocation.cwd)) fail(gate, `${spec.name}: the provider ran inside ${path.basename(protectedRoot)}.`);
      }
      if (existsSync(path.join(invocation.cwd, ".git")) || existsSync(invocation.cwd)) fail(gate, `${spec.name}: the provider working directory was not removed.`);
      const prompt = run.prompts(invocation);
      const leaks = findPromptLeakLabels(prompt, task, canonicalSource);
      if (leaks.length > 0) fail(gate, `${spec.name}: ${invocation.key} attempt ${invocation.n} prompt leaks hidden task data (${leaks.join(", ")}).`);
      if (prompt.includes("PACKED_ASR_DECOY_TRUSTED_CONTENT_6c1e") || prompt.includes("decoy-trusted") || /\.check\.mjs/.test(prompt)) fail(gate, `${spec.name}: a trusted-test decoy reached the prompt.`);
      if (!prompt.includes("<<<BEGIN_SUPPLIED_CONTEXT>>>") || !prompt.includes(`Context mode: ${invocation.mode}`)) fail(gate, `${spec.name}: the prompt lacks the supplied source context.`);
      if (invocation.n > 1) {
        if (invocation.repairHeader[0] !== invocation.n) fail(gate, `${spec.name}: repair prompt ${invocation.n} lacks its repair header.`);
      } else if (/# Repair attempt/.test(prompt)) fail(gate, `${spec.name}: the initial prompt carries repair text.`);
      if (/<<<BEGIN_PREVIOUS_PROPOSAL>>>/.test(prompt) && invocation.n === 1) fail(gate, `${spec.name}: the initial prompt carries a previous proposal.`);
    }
    // independent treatment contexts: the two treatments received different context text for the same task
    const firstPrompts = run.invocations.filter((invocation) => invocation.n === 1).map((invocation) => ({ mode: invocation.mode, text: run.prompts(invocation).split("<<<BEGIN_SUPPLIED_CONTEXT>>>")[1] }));
    if (firstPrompts.length !== 2 || firstPrompts[0].mode === firstPrompts[1].mode || firstPrompts[0].text === firstPrompts[1].text) fail(gate, `${spec.name}: the treatments did not receive independent contexts.`);
    // the original treatment context is reused unchanged by every repair of that treatment
    for (const mode of AGENT_SUCCESS_TREATMENTS) {
      const contexts = run.invocations.filter((invocation) => invocation.mode === mode).map((invocation) => run.prompts(invocation).split("<<<BEGIN_SUPPLIED_CONTEXT>>>")[1].split("<<<END_SUPPLIED_CONTEXT>>>")[0]);
      if (new Set(contexts).size !== 1) fail(gate, `${spec.name}: ${mode} repairs did not reuse the original context unchanged.`);
    }
    // my-dev-kit retrieval never addressed a trusted test or the decoy
    for (const call of run.kitCalls) {
      if (call.argv[0] !== "source") continue;
      const file = call.argv[call.argv.indexOf("--file") + 1];
      if (file !== undefined && (file.startsWith("tests/") || /\.check\.mjs$/.test(file))) fail(gate, `${spec.name}: source retrieval addressed a trusted test (${file}).`);
    }
    if (!run.kitCalls.some((call) => call.argv[0] === "search")) fail(gate, `${spec.name}: the context-pack treatment never queried my-dev-kit.`);
    // artifacts
    const modes = run.execution.realAgent;
    if (!modes || modes.providerId !== spec.provider || modes.promptTransport !== "stdin" || modes.repairAttempts !== (spec.repairAttempts ?? 0)) fail(gate, `${spec.name}: execution realAgent identity is wrong: ${JSON.stringify(modes)}`);
    if (run.execution.executionMode !== "real-agent") fail(gate, `${spec.name}: execution mode is ${run.execution.executionMode}.`);
    const outcomes = crossCheck(gate, run.execution, run.analysis, run.report, { mode: "real-agent", caseIds: [spec.caseId] });
    for (const [artifactName, artifact] of [[AGENT_SUCCESS_EXECUTION_FILE, run.execution], [AGENT_SUCCESS_ANALYSIS_FILE, run.analysis], ["report.json", run.report.report.agentSuccessRate]]) {
      const json = JSON.stringify(artifact);
      for (const forbidden of ["BEGIN_SUPPLIED_CONTEXT", "BEGIN_PREVIOUS_PROPOSAL", "diff --git", "@@ -", "packed acceptance: harmless comment", "PACKED_ASR_DECOY"]) {
        if (json.includes(forbidden)) fail(gate, `${spec.name}: ${artifactName} embeds prompt, source or patch body (${forbidden}).`);
      }
      for (const root of [run.out, installedPackageRoot, tempRoot]) {
        for (const form of [root, root.replace(/\\/g, "\\\\"), root.replace(/\\/g, "/")]) if (json.includes(form)) fail(gate, `${spec.name}: ${artifactName} embeds a machine-local path.`);
      }
    }
    const perTreatment = expectation.invocationsPerTreatment;
    for (const outcome of outcomes) {
      const { label, treatment, attempts, analysed } = outcome;
      const key = (m) => run.invocations.filter((invocation) => invocation.mode === m).length;
      if (key(treatment.treatmentId) !== perTreatment || attempts.length !== perTreatment) fail(gate, `${spec.name}: ${label} ran ${attempts.length} attempts / ${key(treatment.treatmentId)} invocations, expected ${perTreatment}.`);
      if (attempts.length > 3) fail(gate, `${spec.name}: ${label} exceeded three attempts.`);
      const sandboxIds = attempts.map((attempt) => (attempt?.evidence ?? treatment).sandboxId);
      if (new Set(sandboxIds).size !== attempts.length) fail(gate, `${spec.name}: ${label} reused a sandbox across attempts.`);
      if (treatment.sandboxId !== sandboxIds[sandboxIds.length - 1]) fail(gate, `${spec.name}: ${label} top-level evidence is not the final attempt.`);
      attempts.forEach((attempt, index) => {
        const number = index + 1;
        if (attempt && attempt.attemptNumber !== number) fail(gate, `${spec.name}: ${label} attempt numbering is not contiguous.`);
        if (attempt?.cleanupResult && (attempt.cleanupResult.attempted !== true || attempt.cleanupResult.removed !== true)) fail(gate, `${spec.name}: ${label} attempt ${number} was not cleaned up.`);
      });
      if (!analysed.repair && perTreatment > 1) fail(gate, `${spec.name}: ${label} has no repair analysis.`);
    }
    return outcomes;
  };

  // ---- 10. PROVIDER TRANSPORT (codex and claude, initial attempt) -------------------------------------------------------
  {
    const gate = "AGENT_SUCCESS_PROVIDER_TRANSPORT";
    const codexTask = taskById.get(catalogIds[0]);
    const codex = runSimulation({ gate, name: "sim-codex", provider: "codex", caseId: codexTask.id, answers: { default: fenced(referencePatch(codexTask)) } });
    const codexOutcomes = checkSimulationCommon(codex, { exit: 0, invocationsPerTreatment: 1 });
    for (const outcome of codexOutcomes) {
      if (outcome.initial !== true || outcome.final !== true) fail(gate, `codex ${outcome.label}: the provider-authored patch did not pass the trusted checks.`);
      const usage = outcome.treatment.agentTokenUsage;
      if (!usage || usage.totalTokens !== 100 || usage.inputTokens !== 70 || usage.outputTokens !== 30 || usage.source !== "cli-json") fail(gate, `codex ${outcome.label}: provider token telemetry was not preserved exactly: ${JSON.stringify(usage)}`);
      if (metricValue(outcome.analysed.metrics.agentTotalTokens) !== 100) fail(gate, `codex ${outcome.label}: the analysis token total is not the 100 the provider reported.`);
      const duration = metricValue(outcome.analysed.metrics.agentDurationMs);
      if (typeof duration !== "number" || duration !== outcome.treatment.timing.agentDurationMs) fail(gate, `codex ${outcome.label}: provider duration is not preserved between execution and analysis.`);
      if (outcome.treatment.realAgent.providerStatus !== "completed" || outcome.treatment.realAgent.finalAnswerAvailable !== true) fail(gate, `codex ${outcome.label}: provider outcome not completed.`);
    }
    const claudeTask = taskById.get(catalogIds[3]);
    const claude = runSimulation({
      gate, name: "sim-claude", provider: "claude", caseId: claudeTask.id,
      answers: { default: fenced(referencePatch(claudeTask)) }, behaviors: { default: { noUsage: true } }
    });
    const claudeOutcomes = checkSimulationCommon(claude, { exit: 0, invocationsPerTreatment: 1 });
    for (const outcome of claudeOutcomes) {
      if (outcome.final !== true) fail(gate, `claude ${outcome.label}: the provider-authored patch did not pass the trusted checks.`);
      // Provider tokens were not reported: they must stay unavailable, never zero, and no total may be invented.
      const usage = outcome.treatment.agentTokenUsage;
      if (!usage || usage.totalTokens !== null || usage.inputTokens !== null || usage.outputTokens !== null || usage.source !== "unavailable") fail(gate, `claude ${outcome.label}: unavailable token usage was not kept null/unavailable: ${JSON.stringify(usage)}`);
      const tokens = outcome.analysed.metrics.agentTotalTokens;
      if (tokens.availability !== "unavailable" || tokens.value !== null) fail(gate, `claude ${outcome.label}: the token metric is not unavailable: ${JSON.stringify(tokens)}`);
      if (typeof metricValue(outcome.analysed.metrics.agentDurationMs) !== "number") fail(gate, `claude ${outcome.label}: the provider duration is missing although the provider ran.`);
    }
    for (const aggregate of claude.analysis.analysis.aggregates) {
      if (aggregate.agentTokenMeasurementsAvailable !== 0 || aggregate.agentTokenMeasurementsUnavailable !== 1) fail(gate, `claude ${aggregate.treatmentId}: token measurement counts are wrong.`);
      for (const total of aggregate.repair.providerTokens) {
        if (total.total.availability !== "unavailable" || total.total.value !== null || total.sumOfAvailable !== null || total.availableCaseCount !== 0) fail(gate, `claude ${aggregate.treatmentId}: a provider-token total was invented from unavailable usage (${total.basis}).`);
      }
    }
    // The production plugin used the provider's answer, never the bundled fixture: a provider answer that is NOT the fixture must fail.
    const decoy = runSimulation({ gate, name: "sim-decoy", provider: "codex", caseId: codexTask.id, answers: { default: fenced(noopPatchFor(codexTask)) } });
    const decoyOutcomes = checkSimulationCommon(decoy, { exit: decoy.result.status, invocationsPerTreatment: 1 });
    for (const outcome of decoyOutcomes) {
      if (outcome.final !== false) fail(gate, `decoy ${outcome.label}: a non-solving provider patch was scored as a success (deterministicFixture substitution?).`);
    }
    pass(gate, "installed bin with fake codex and claude executables: frozen stdin flags, neutral removed cwd, source-only prompts with independent treatment contexts, trusted-test decoys filtered before retrieval, provider answer (not the fixture) evaluated, telemetry preserved and unavailable token usage kept unavailable; 0 real providers");
  }

  // ---- 11. REPAIR -------------------------------------------------------------------------------------------------------
  const repairFacts = (run, outcomes, expected) => {
    const gate = run.spec.gate;
    for (const outcome of outcomes) {
      const { label, analysed, treatment, attempts } = outcome;
      const repair = analysed.repair;
      if (metricValue(repair.initialAttemptTaskSuccess) !== expected.initial) fail(gate, `${run.spec.name} ${label}: initial success ${metricValue(repair.initialAttemptTaskSuccess)} != ${expected.initial}.`);
      if (metricValue(repair.finalTaskSuccess) !== expected.final) fail(gate, `${run.spec.name} ${label}: final success ${metricValue(repair.finalTaskSuccess)} != ${expected.final}.`);
      if (repair.attemptCount !== expected.attempts || repair.repairAttemptCount !== expected.attempts - 1) fail(gate, `${run.spec.name} ${label}: attempt counts are wrong.`);
      if (metricValue(repair.repairSucceeded) !== expected.repairSucceeded) fail(gate, `${run.spec.name} ${label}: repairSucceeded ${metricValue(repair.repairSucceeded)} != ${expected.repairSucceeded}.`);
      if (expected.tokens !== undefined && metricValue(repair.totalProviderTokens) !== expected.tokens) fail(gate, `${run.spec.name} ${label}: total provider tokens ${metricValue(repair.totalProviderTokens)} != ${expected.tokens} (one provider-reported total per attempt).`);
      if (metricValue(repair.firstAttemptProviderTokens) !== expected.tokens / expected.attempts || metricValue(repair.finalAttemptProviderTokens) !== expected.tokens / expected.attempts) fail(gate, `${run.spec.name} ${label}: first/final attempt token bases are wrong.`);
      // final edit quality is the FINAL patch's evidence only, never a sum or mix over attempts
      const churnOf = (evidence) => (evidence.change ? evidence.change.totalAdditions + evidence.change.totalDeletions : null);
      const finalChurn = churnOf(attempts[attempts.length - 1].evidence);
      if (metricValue(analysed.metrics.totalChurn) !== finalChurn) fail(gate, `${run.spec.name} ${label}: totalChurn ${metricValue(analysed.metrics.totalChurn)} is not the final patch's ${finalChurn}.`);
      const firstChurn = churnOf(attempts[0].evidence);
      if (attempts.length > 1 && firstChurn !== null && finalChurn !== null && firstChurn !== finalChurn && metricValue(analysed.metrics.totalChurn) === firstChurn) fail(gate, `${run.spec.name} ${label}: edit quality was taken from the first attempt.`);
      if (metricValue(analysed.metrics.changedFileCount) !== (attempts[attempts.length - 1].evidence.change?.changedCount ?? null)) fail(gate, `${run.spec.name} ${label}: changedFileCount is not the final patch's.`);
      // the final evaluated patch is the last attempt's; the first attempt's patch artifact is preserved separately
      const lastApplied = attempts[attempts.length - 1].evidence;
      if (treatment.change?.changedFiles?.map((f) => f.relativePath).join() !== lastApplied.change?.changedFiles?.map((f) => f.relativePath).join()) fail(gate, `${run.spec.name} ${label}: top-level change evidence is not the final attempt's.`);
      attempts.forEach((attempt, index) => {
        const expectedSuccess = expected.perAttempt[index];
        if (attempt.taskSuccess !== expectedSuccess) fail(gate, `${run.spec.name} ${label}: attempt ${index + 1} taskSuccess ${attempt.taskSuccess} != ${expectedSuccess}.`);
        if (expected.categories && attempt.failureCategory !== expected.categories[index]) fail(gate, `${run.spec.name} ${label}: attempt ${index + 1} category ${attempt.failureCategory} != ${expected.categories[index]}.`);
        const proposedPath = path.join(run.out, "diffs", run.execution.cases[0].benchmarkProject, run.spec.caseId, treatment.treatmentId, `attempt-${index + 1}-proposed.patch`);
        if (expected.proposals?.[index] && !existsSync(proposedPath)) fail(gate, `${run.spec.name} ${label}: attempt ${index + 1} proposed patch artifact is missing.`);
      });
      // no cumulative mutation: every attempt starts from the same canonical baseline digest
      const digests = new Set(attempts.map((attempt) => attempt.evidence.sandboxBaseline.digest));
      if (digests.size !== 1) fail(gate, `${run.spec.name} ${label}: attempts did not start from the same canonical baseline.`);
    }
  };
  const repairTask = taskById.get(catalogIds[0]);
  const repairTaskTwo = taskById.get(catalogIds[3]);
  {
    const gate = "AGENT_SUCCESS_REPAIR";
    // A. attempt 1 fails (applies, solves nothing), repair 1 succeeds
    const a = runSimulation({ gate, name: "rep-a", provider: "codex", caseId: repairTask.id, repairAttempts: 2, answers: { 1: fenced(noopPatchFor(repairTask)), default: fenced(referencePatch(repairTask)) } });
    const aOut = checkSimulationCommon(a, { exit: 0, invocationsPerTreatment: 2 });
    repairFacts(a, aOut, { initial: false, final: true, attempts: 2, repairSucceeded: true, perAttempt: [false, true], categories: ["task-check-failed", "none"], proposals: [true, true], tokens: 200 });
    // B. attempt 1 fails, repair 1 fails (no usable diff), repair 2 succeeds
    const b = runSimulation({
      gate, name: "rep-b", provider: "claude", caseId: repairTaskTwo.id, repairAttempts: 2,
      answers: { 1: fenced(noopPatchFor(repairTaskTwo)), 2: "I could not produce a diff for this one.", default: fenced(referencePatch(repairTaskTwo)) }
    });
    const bOut = checkSimulationCommon(b, { exit: 0, invocationsPerTreatment: 3 });
    repairFacts(b, bOut, { initial: false, final: true, attempts: 3, repairSucceeded: true, perAttempt: [false, false, true], categories: ["task-check-failed", "patch-malformed", "none"], proposals: [true, false, true], tokens: 300 });
    // E. attempt 1 edits a protected file (patch policy rejects it before Git sees it), repair 1 succeeds
    const readmeText = readFileSync(path.join(installedProjectRoot(repairTask.benchmarkProject), "README.md"), "utf8");
    const e = runSimulation({
      gate, name: "rep-e", provider: "codex", caseId: repairTask.id, repairAttempts: 1,
      answers: { 1: fenced(buildNoopPatch("README.md", readmeText)), default: fenced(referencePatch(repairTask)) }
    });
    const eOut = checkSimulationCommon(e, { exit: 0, invocationsPerTreatment: 2 });
    repairFacts(e, eOut, { initial: false, final: true, attempts: 2, repairSucceeded: true, perAttempt: [false, true], categories: ["patch-policy-rejected", "none"], proposals: [true, true], tokens: 200 });
    for (const outcome of eOut) {
      const first = outcome.attempts[0].evidence;
      if (first.patch.outcome !== "policy-rejection" || !first.patch.attemptedProtectedPaths.includes("README.md")) fail(gate, `rep-e ${outcome.label}: the protected-file edit was not rejected by the patch policy.`);
      if (first.change !== null) fail(gate, `rep-e ${outcome.label}: a rejected patch produced change evidence (it must not have touched the sandbox).`);
      if (outcome.attempts[0].changeEvidenceAvailability !== "unavailable") fail(gate, `rep-e ${outcome.label}: change evidence is not marked unavailable for the rejected attempt.`);
    }
    for (const run of [a, b, e]) {
      for (const invocation of run.invocations.filter((entry) => entry.n > 1)) {
        const prompt = run.prompts(invocation);
        const original = run.prompts(run.invocations.find((entry) => entry.mode === invocation.mode && entry.n === 1));
        // same original public instruction and treatment context
        const head = (text) => text.split("<<<BEGIN_SUPPLIED_CONTEXT>>>")[0];
        if (head(prompt) !== head(original)) fail(gate, `${run.spec.name}: a repair prompt changed the original public instruction.`);
        if (!/Return a COMPLETE replacement diff against the ORIGINAL supplied source/.test(prompt)) fail(gate, `${run.spec.name}: a repair prompt does not demand a complete replacement diff.`);
        // an earlier agent-authored patch may appear as fenced data; the hidden reference patch may not (checked in common)
      }
    }
    // the first repair prompt of A carries the previous (agent-authored) no-op proposal as fenced data
    const firstRepair = a.invocations.find((entry) => entry.n === 2);
    if (!a.prompts(firstRepair).includes("packed acceptance: harmless comment")) fail(gate, "rep-a: the first repair prompt does not carry the previous agent-authored proposal.");
    pass(gate, "A: attempt 1 fails then repair 1 succeeds (2 attempts); B: attempt 1 fails, repair 1 malformed, repair 2 succeeds (3 attempts); E: a protected-file edit is rejected by the patch policy and repaired; same instruction and context, fresh sandboxes and a complete replacement diff each time; initial success stays false while final success is true; per-attempt patch artifacts preserved; reference patch absent from every prompt");
  }

  // ---- 12. REPAIR LIMIT and non-repairable failures ----------------------------------------------------------------------
  {
    const gate = "AGENT_SUCCESS_REPAIR_LIMIT";
    // C. three failed attempts terminate with exactly three invocations per treatment (no fourth)
    const c = runSimulation({ gate, name: "rep-c", provider: "codex", caseId: repairTask.id, repairAttempts: 2, answers: { default: fenced(noopPatchFor(repairTask)) } });
    const cOut = checkSimulationCommon(c, { exit: c.result.status, invocationsPerTreatment: 3 });
    repairFacts(c, cOut, { initial: false, final: false, attempts: 3, repairSucceeded: false, perAttempt: [false, false, false], categories: ["task-check-failed", "task-check-failed", "task-check-failed"], proposals: [true, true, true], tokens: 300 });
    if (c.invocations.some((entry) => entry.n > 3)) fail(gate, "rep-c: a fourth provider invocation occurred.");
    if (existsSync(path.join(c.out, "agents", c.execution.cases[0].benchmarkProject, c.spec.caseId, "raw-full-file", "attempt-4"))) fail(gate, "rep-c: a fourth attempt directory exists.");
    // repair denominators: both treatments attempted a repair and neither was repaired
    for (const aggregate of c.analysis.analysis.aggregates) {
      const repair = aggregate.repair;
      if (!repair || repair.repairAttemptedCaseCount !== 1 || repair.repairAttemptedEvaluableCaseCount !== 1 || repair.repairedCaseCount !== 0 || metricValue(repair.repairSuccessRate) !== 0) fail(gate, `rep-c: ${aggregate.treatmentId} repair denominators are wrong: ${JSON.stringify(repair)}`);
      if (repair.totalAttemptCount !== 3 || repair.totalRepairAttemptCount !== 2 || repair.initialAttemptSuccessfulCount !== 0 || repair.finalSuccessfulCount !== 0) fail(gate, `rep-c: ${aggregate.treatmentId} attempt totals are wrong.`);
    }
    // D. a non-repairable provider failure never retries
    const d = runSimulation({
      gate, name: "rep-d", provider: "codex", caseId: repairTask.id, repairAttempts: 2,
      behaviors: { default: { exitCode: 1, stderr: "usage limit reached, try again later" } }
    });
    if (d.invocations.length !== 2 || d.invocations.some((entry) => entry.n !== 1)) fail(gate, `rep-d: a non-repairable provider failure retried (${d.invocations.map((entry) => `${entry.mode}#${entry.n}`).join(", ")}).`);
    const dExecution = d.execution;
    if (dExecution === null) fail(gate, "rep-d: scientific artifacts are missing after a provider failure.", describeChildResult(d.result));
    for (const treatment of dExecution.cases[0].treatments) {
      if (treatment.attempts.length !== 1 || treatment.attempts[0].repairEligible !== false) fail(gate, `rep-d: ${treatment.treatmentId} recorded a repair-eligible failure.`);
      if (!["provider-limit-reached", "provider-failed", "provider-unavailable"].includes(treatment.attempts[0].failureCategory)) fail(gate, `rep-d: unexpected failure category ${treatment.attempts[0].failureCategory}.`);
      if (treatment.attempts[0].taskSuccess === true) fail(gate, "rep-d: a failed provider attempt is reported as task success.");
    }
    for (const entry of d.analysis.analysis.cases[0].treatments) {
      if (metricValue(entry.repair.repairSucceeded) !== null || entry.repair.repairAttemptCount !== 0) fail(gate, "rep-d: repair metrics were fabricated for a provider failure.");
      if (metricValue(entry.metrics.taskSuccess) === true) fail(gate, "rep-d: unavailable evidence became success.");
    }
    for (const aggregate of d.analysis.analysis.aggregates) {
      if (aggregate.repair && aggregate.repair.repairAttemptedCaseCount !== 0) fail(gate, "rep-d: a provider failure was counted as a repair attempt in the denominator.");
      if (aggregate.repair && aggregate.repair.repairSuccessRate.availability === "available") fail(gate, "rep-d: repairSuccessRate is available without any repair attempt.");
    }
    pass(gate, "three failed attempts end at exactly three provider invocations per treatment (no fourth attempt, repairSucceeded=false, repair denominators 1/1/0); a provider limit failure is not repairable, is not retried and creates no repair metric");
  }

  // ---- 13. CLEANUP (installed runs left nothing behind) ---------------------------------------------------------------
  {
    const gate = "AGENT_SUCCESS_CLEANUP";
    const runs = readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(path.join(base, entry.name, AGENT_SUCCESS_EXECUTION_FILE))).map((entry) => path.join(base, entry.name));
    if (runs.length < 10) fail(gate, `Expected at least ten completed run directories, found ${runs.length}.`);
    for (const run of runs) {
      if (existsSync(path.join(run, "sandboxes"))) fail(gate, `${path.basename(run)}: sandbox runtime root was left behind.`);
      const execution = readJson(path.join(run, AGENT_SUCCESS_EXECUTION_FILE), gate);
      for (const entry of execution.cases) for (const treatment of entry.treatments) {
        for (const attempt of treatment.attempts ?? [{ cleanupResult: treatment.cleanup }]) {
          const cleanup = attempt.cleanupResult ?? attempt.evidence?.cleanup;
          if (!cleanup || cleanup.attempted !== true || cleanup.removed !== true) fail(gate, `${path.basename(run)}: ${entry.caseId}/${treatment.treatmentId} cleanup is not proven.`);
        }
      }
    }
    pass(gate, `${runs.length} installed runs: every sandbox and provider working directory removed, runtime roots absent, cleanup evidence recorded for every attempt (failure injection is covered by the in-repository cleanupHardening tests)`);
  }

  // ---- 14. IMMUTABILITY ------------------------------------------------------------------------------------------------
  {
    await assertImmutable("during the agent-success-rate acceptance runs");
    pass("AGENT_SUCCESS_IMMUTABILITY", "installed package tree, both canonical installed benchmark projects, the task and profile catalogs and unrelated workspace content are byte-identical before and after every campaign");
  }

  // ---- 15. PACKAGE HYGIENE -----------------------------------------------------------------------------------------------
  {
    const gate = "AGENT_SUCCESS_PACKAGE_HYGIENE";
    const offenders = findForbiddenTarballPaths(ctx.tarballFiles);
    if (offenders.length > 0) fail(gate, `The tarball contains development or runtime artifacts: ${offenders.slice(0, 10).join(", ")}`);
    const installedExtras = listFilesRecursive(installedPackageRoot).filter((file) => !file.startsWith("node_modules/"));
    const installedOffenders = findForbiddenTarballPaths(installedExtras);
    if (installedOffenders.length > 0) fail(gate, `The installed package contains development or runtime artifacts: ${installedOffenders.slice(0, 10).join(", ")}`);
    pass(gate, "no context, orchestrator, report, output, sandbox, provider-log, Git, environment, secret or test-harness path in the tarball or the installed tree; canonical *.check.mjs files, project .gitattributes and reference patches are intentional resources");
  }
}
