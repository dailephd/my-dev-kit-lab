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
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  "benchmarks/contracts/benchmark-project-profiles.json",
  "benchmarks/contracts/warm-index-benchmark-cases.json",
  "benchmarks/projects/todo-ts/src/taskService.ts",
  "examples/token-savings-cases.json",
  "examples/tutorial-browser/index.html",
  "examples/tutorial-browser/prepare.mjs",
  "examples/tutorial-browser/server.mjs",
  "examples/tutorial-browser/scenario.json"
];

const REQUIRED_EXPERIMENT_IDS = ["context-strategy-comparison", "warm-index-reuse"];

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
    snapshotDirectory,
    diffSnapshots
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
    campaigns: path.join(tempRoot, "campaigns")
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
    const warmHelpStart = runHelp.indexOf("warm-index-reuse only:");
    const contextHelpStart = runHelp.indexOf("context-strategy-comparison only:");
    if (
      runHelpResult.status !== 0 ||
      warmHelpStart < 0 ||
      contextHelpStart <= warmHelpStart ||
      !runHelp.slice(warmHelpStart, contextHelpStart).includes("--kit-command <command>") ||
      !runHelp.slice(contextHelpStart).includes("--agents")
    ) {
      fail("EXPERIMENT_RUN_HELP", "Installed `experiment run --help` does not document --kit-command as warm-index-reuse-specific.", describeChildResult(runHelpResult));
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
      warmSnapshot.tool?.availability !== "unavailable"
    ) {
      fail("WARM_INDEX_INDEX_SNAPSHOT", `Installed warm-index execution artifact lacks a complete index snapshot: ${JSON.stringify(warmSnapshot)?.slice(0, 400)}`);
    }
    if (warmArtifactText.includes(warmTaskServiceSource.split("\n").find((line) => line.includes("constructor(")) ?? "\u0000") || warmArtifactText.includes(FAKE_KIT_SOURCE_TEXT)) {
      fail("WARM_INDEX_INDEX_SNAPSHOT", "Installed warm-index execution artifact contains source or context text.");
    }
    if (/"(?:freshness|changedFiles|changedFileCount)"/.test(warmArtifactText)) {
      fail("WARM_INDEX_INDEX_SNAPSHOT", "Installed warm-index execution artifact contains freshness or changed-file fields before they are implemented.");
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
    // A real (non-isolated) Chromium capture, run a second time in the same job right after the
    // existing tutorial's own full real-browser recording, has proven to exceed available resources
    // on hosted Linux/macOS CI runners (observed as the child process being killed outright, not a
    // graceful screenshot failure) even though it is reliable on Windows and in local development.
    // Rather than risk destabilizing the shared Playwright runtime with launch-flag/environment
    // hacks, this gate only requires a *captured* screenshot -- proving the installed campaign's
    // real-browser integration end to end -- on win32, where it is reliable. Linux/macOS still prove
    // every other part of this scenario (report, campaign summary, token evidence, argv privacy,
    // plots, gallery) plus the deterministic *skipped* path here (an isolated empty browser cache),
    // and the deterministic captured/skipped/failed screenshot *semantics* already have dedicated,
    // always-reliable coverage in the Batch 5 focused command tests.
    const codexSuccessCaptureCapable = process.platform === "win32";
    const MAX_SCREENSHOT_ATTEMPTS = codexSuccessCaptureCapable ? 3 : 1;
    let codexSuccessOut;
    let codexSuccess;
    for (let attempt = 1; attempt <= MAX_SCREENSHOT_ATTEMPTS; attempt += 1) {
      const attemptOut = path.join(dirs.campaigns, MAX_SCREENSHOT_ATTEMPTS > 1 ? `codex-success-attempt-${attempt}` : "codex-success");
      clearProviderLog();
      const attemptResult = runInstalledCli(
        cliCommand,
        dirs.consumer,
        campaignArgs("codex-full", attemptOut, ["--case", "warm-medium-complete-idempotent"]),
        campaignEnv({
          mode: "success",
          playwrightBrowsersPath: codexSuccessCaptureCapable ? undefined : dirs.browserCache
        })
      );
      process.stderr.write(
        `[diagnostic] codex-success attempt ${attempt} finished at ${new Date().toISOString()} (${Date.now() - gateStartedAt}ms since gate start): status=${attemptResult.status} signal=${attemptResult.signal ?? "none"} error=${attemptResult.error ? (attemptResult.error.message ?? String(attemptResult.error)) : "none"}\n`
      );
      if (attemptResult.status === 0) {
        codexSuccessOut = attemptOut;
        codexSuccess = { result: attemptResult, log: readProviderLog() };
        break;
      }
      const isRealBrowserFlake =
        /Screenshot: failed/.test(attemptResult.stdout ?? "") && /Status: completed/.test(attemptResult.stdout ?? "");
      if (!isRealBrowserFlake || attempt === MAX_SCREENSHOT_ATTEMPTS) {
        fail("WARM_INDEX_CAMPAIGN_CODEX_INSTALLED", "Installed campaign command did not exit 0.", describeChildResult(attemptResult));
      }
      console.error(
        `[WARM_INDEX_CAMPAIGN_CODEX_INSTALLED] Real-browser screenshot capture failed on attempt ${attempt}/${MAX_SCREENSHOT_ATTEMPTS} (known transient Chromium flake under sequential load); retrying with a fresh output directory.`
      );
    }
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

    // Presentation acceptance: four plots, screenshot capture (captured on win32; deterministic
    // skip elsewhere per the resource note above), and the three-item campaign gallery.
    requireFourCampaignCharts("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION", codexSuccessOut);
    const codexGallery = requireCampaignGallery("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION", codexSuccessOut);
    const [codexReportItem, codexPlotsItem, codexExecutionItem] = codexGallery.items;
    if (codexSuccessCaptureCapable) {
      requireNonEmptyFile(path.join(codexSuccessOut, "report.png"), "WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION");
      if (codexReportItem.status !== "pass" || !codexReportItem.screenshotPath) {
        fail("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION", "Codex campaign gallery report item is not a captured pass.");
      }
    } else {
      if (existsSync(path.join(codexSuccessOut, "report.png"))) {
        fail("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION", "Codex campaign unexpectedly produced report.png with an isolated empty browser cache.");
      }
      if (codexReportItem.status !== "warning" || codexReportItem.screenshotPath) {
        fail("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION", "Codex campaign gallery report item did not reflect the skipped screenshot.");
      }
      if (!codexReportItem.warnings?.some((warning) => /Playwright or browser runtime is unavailable/.test(warning))) {
        fail("WARM_INDEX_CAMPAIGN_CODEX_PRESENTATION", "Codex campaign gallery is missing the canonical screenshot-skip warning.");
      }
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

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  await main();
}
