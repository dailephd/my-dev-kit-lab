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
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  "benchmarks/contracts/benchmark-project-profiles.json",
  "examples/token-savings-cases.json"
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
  const { findExactlyOneTarball, validateInstalledPackageIdentity, snapshotDirectory, diffSnapshots } =
    await loadHelpers();

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "my-dev-kit-lab-packed-"));
  const dirs = {
    pack: path.join(tempRoot, "pack"),
    consumer: path.join(tempRoot, "consumer"),
    home: path.join(tempRoot, "home"),
    workspace: path.join(tempRoot, "workspace"),
    target: path.join(tempRoot, "target")
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
    const missingRequired = REQUIRED_TARBALL_PATHS.filter((required) => !tarballFiles.has(required));
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
    // 7. External target + snapshots.
    // -----------------------------------------------------------------
    writeFileSync(
      path.join(dirs.target, "package.json"),
      `${JSON.stringify({ name: "packed-package-target", version: "1.0.0", scripts: {} }, null, 2)}\n`,
      "utf8"
    );

    const targetBefore = await snapshotDirectory(dirs.target);
    const installedPackageBefore = await snapshotDirectory(installedPackageRoot);

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
