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
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  "benchmarks/contracts/benchmark-project-profiles.json",
  "examples/token-savings-cases.json",
  "examples/tutorial-browser/index.html",
  "examples/tutorial-browser/prepare.mjs",
  "examples/tutorial-browser/server.mjs",
  "examples/tutorial-browser/scenario.json"
];

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
  return [`exit=${result.status}`, `stdout:\n${result.stdout ?? ""}`, `stderr:\n${result.stderr ?? ""}`].join("\n");
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
    browserCache: path.join(tempRoot, "empty-browser-cache")
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
