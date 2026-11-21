import { describeAuditFile, type AuditExecutionReceipt } from "./auditExecutionReceipt.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { runMeasuredCommand, type MeasuredCommandResult, type RunMeasuredCommandOptions } from "../../core/runMeasuredCommand.js";
import { adaptKitEvidenceToSourceFacts } from "./kitSourceAdapter.js";
import {
  KIT_MAX_FACT_PAGES_PER_FILE,
  KIT_MAX_INVENTORY_PAGES,
  KIT_PACKAGE_NAME,
  KIT_SOURCE_AUDIT_ARTIFACT_FILENAME,
  KIT_SOURCE_AUDIT_EXTRACTOR_REVISION,
  KIT_SOURCE_AUDIT_SCHEMA_VERSION,
  KitSourceEvidenceAcquisitionError,
  assertRequiredCapabilities,
  authenticateKitWindowContent,
  assertPredicateScopedCapabilities,
  hasQualifiedPartialImports,
  assertQualifiedPartialDeclarations,
  assertKitJsonRawContent,
  assertSelectionCoversRequired,
  collectAllPages,
  crossValidateFileRecord,
  crossValidateInventory,
  flattenFactPages,
  flattenInventoryPages,
  requestedPathMatchesCanonical,
  sha256Hex,
  validateFactPage,
  validateInventoryPage,
  validateKitArtifact,
  validateKitManifestReference,
  validateKitRelativePath,
  validateKitOccurrence,
  validateKitImportProof,
  validateKitImportDomain,
  validateKitByteOccurrence,
  type KitImportDomain,
  type KitByteOccurrence,
  type KitAmbientClassification,
  type KitOccurrence,
  type KitImportProof,
  type KitEvidenceFailureCategory,
  type KitFactPage,
  type KitFileEvidence,
  type KitFileRecord,
  type KitInventoryPage,
  type KitRequiredCapabilities,
  type KitSourceEvidence,
} from "./kitSourceEvidence.js";
import { NORMALIZED_LANGUAGES, type NormalizedLanguage, type ProjectInventorySnapshot } from "./projectInventory.js";
import { SOURCE_FACT_PARSE_STATUSES, type SourceFactParseStatus, type SourceFactsSnapshot } from "./sourceFacts.js";
import { KIT_SOURCE_EVIDENCE_REQUIREMENTS, requiredKitCapabilitiesForPath, type ApplicableKitFileRequirement } from "./auditRegistry.js";

// ---------------------------------------------------------------------------
// v0.10.0 Gate 3 -- managed Kit source-evidence provider.
//
// Resolves the installed Kit package from Lab's module resolution (never a
// sibling checkout, PATH executable, npx, or registry download), verifies its
// identity, then drives the installed CLI through the existing bounded
// subprocess owner (src/core/runMeasuredCommand.ts) with `process.execPath`
// and an argument array. No shell, no shim, no second process executor.
//
// This module owns acquisition and command-failure behavior only. Validation
// lives in kitSourceEvidence.ts; mapping to Lab facts lives in
// kitSourceAdapter.ts. Any failure throws KitSourceEvidenceAcquisitionError;
// there is no fallback to a native analyzer.
// ---------------------------------------------------------------------------

export const KIT_INDEX_TIMEOUT_MS = 300000;
export const KIT_LOOKUP_TIMEOUT_MS = 30000;
export const KIT_STDOUT_MAX_BYTES = 8388608;
export const KIT_STDERR_MAX_BYTES = 262144;
export { KIT_MAX_INVENTORY_PAGES, KIT_MAX_FACT_PAGES_PER_FILE };

const KIT_MANIFEST_MAX_BYTES = 16 * 1024 * 1024;
const KIT_ARTIFACT_MAX_BYTES = 128 * 1024 * 1024;
const KIT_PACKAGE_JSON_MAX_BYTES = 1024 * 1024;
const KIT_CLI_MAX_BYTES = 64 * 1024 * 1024;
const KIT_LOOKUP_CONCURRENCY = 4;
const SOURCE_LANGUAGES = new Set(["typescript", "javascript", "python", "java", "kotlin", "rust"]);

export type KitCandidateExpectation = {
  packageName: string;
  packageVersion: string;
  artifactSchemaVersion: string;
  extractorRevision: string;
  // SHA-256 of the installed dist/cli.js. The artifact does not carry the
  // extractor revision, so the exact qualified build is pinned through it.
  // null disables the pin (non-candidate consumers).
  cliSha256: string | null;
};

// The immutable Candidate 05 qualified for Gate 5. Package
// metadata says 1.14.0; this is NOT the public npm 1.14.0 package.
export const QUALIFIED_KIT_CANDIDATE: KitCandidateExpectation = {
  packageName: KIT_PACKAGE_NAME,
  packageVersion: "1.14.0",
  artifactSchemaVersion: KIT_SOURCE_AUDIT_SCHEMA_VERSION,
  extractorRevision: KIT_SOURCE_AUDIT_EXTRACTOR_REVISION,
  cliSha256: "35dbc49fc91f8c47f1e7cdaf86223414a54517ff25a1a29f87231b2bae3807b8",
};

// Published 1.15.0 qualified independently against the retained Candidate 05 oracle.
export const QUALIFIED_PUBLISHED_KIT: KitCandidateExpectation = {
  packageName: KIT_PACKAGE_NAME,
  packageVersion: "1.15.0",
  artifactSchemaVersion: KIT_SOURCE_AUDIT_SCHEMA_VERSION,
  extractorRevision: KIT_SOURCE_AUDIT_EXTRACTOR_REVISION,
  cliSha256: "ac66e5a4a06b48f7a7bbbf03734002bd6686cc6aa2343d097ff374f52fcb486f",
};
// B3-P1-R3 independently qualified unpublished Kit candidate.
export const QUALIFIED_B3_P1_KIT = Object.freeze({
  packageName: KIT_PACKAGE_NAME,
  packageVersion: "1.15.1",
  artifactSchemaVersion: "1.2.0",
  extractorRevision: "source-audit-v1.6.0",
  cliSha256: "651c2a57987ec289ae963e3df9743b18d16f33c156154773de7225af9bd51165",
  sourceSha: "bde00d9c165a6a546170ab72e7a9534d6929697e",
  archiveSha256: "943b3506c7a3e9708f96d2e40a9fcfc720853c46a4273f31408568942a5599a6",
  receiptSha256: "a7bcc8286939e4f32d60a0715fd63d4b41fb1950b2caf5b11ce78951ce038cf7",
} satisfies KitCandidateExpectation & { sourceSha: string; archiveSha256: string; receiptSha256: string });

// Historical SW-123 P6-R2 archive.
export const QUALIFIED_SW123_P6_R2_KIT = {
  packageName: KIT_PACKAGE_NAME,
  packageVersion: "1.15.1",
  artifactSchemaVersion: "1.1.0",
  extractorRevision: "source-audit-v1.5.2",
  cliSha256: "11330f9ead9e498f6b5d622b3491cbd813da0760d2032d2ee577f5de6f846544",
} satisfies KitCandidateExpectation;

// P6-R7 is qualified for predicate acquisition and bounded semantic source
// ranges. Other reader capabilities retain their existing exact profiles.
export const QUALIFIED_SW123_P6_R7_KIT = {
  packageName: KIT_PACKAGE_NAME,
  packageVersion: "1.15.1",
  artifactSchemaVersion: "1.1.0",
  extractorRevision: "source-audit-v1.5.3",
  cliSha256: "59e7ab158d833c2ac82f2bb007129483eda8722e0ee1450d54df8d1b33835c62",
} satisfies KitCandidateExpectation;

const SW123_EXACT_KIT_PROFILES = [QUALIFIED_SW123_P6_R2_KIT, QUALIFIED_SW123_P6_R7_KIT] as const;

function matchesExactKitExpectation(expectation: KitCandidateExpectation, exact: KitCandidateExpectation): boolean {
  return expectation.packageName === exact.packageName && expectation.packageVersion === exact.packageVersion &&
    expectation.artifactSchemaVersion === exact.artifactSchemaVersion && expectation.extractorRevision === exact.extractorRevision &&
    expectation.cliSha256 === exact.cliSha256;
}

export type InstalledKitPackage = {
  packageRoot: string;
  cliPath: string;
  packageName: string;
  packageVersion: string;
  cliSha256: string;
};

export type KitCommandRunner = (options: RunMeasuredCommandOptions) => Promise<MeasuredCommandResult>;

// Internal test/consumer seam. Not a public CLI option.
export type KitSourceProviderDependencies = {
  qualifiedArchivePath?: string;
  // Programmatic installed-package root injection (still identity- and
  // containment-checked exactly like a resolved package).
  installedPackageRoot?: string;
  expectation?: KitCandidateExpectation;
  runCommand?: KitCommandRunner;
  // Task-owned working directory for the Kit index and command logs. When
  // omitted a fresh directory is created and removed after acquisition.
  workDir?: string;
  receipt?: AuditExecutionReceipt;
};

function fail(category: KitEvidenceFailureCategory, message: string, detail?: string): never {
  throw new KitSourceEvidenceAcquisitionError(category, message, detail);
}

// ---------------------------------------------------------------------------
// Package resolution
// ---------------------------------------------------------------------------

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function readBoundedFile(filePath: string, maxBytes: number, category: KitEvidenceFailureCategory, label: string): Buffer {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    fail(category, `${label} is missing.`);
  }
  if (!stat.isFile()) fail(category, `${label} is not a regular file.`);
  if (stat.size > maxBytes) fail(category, `${label} exceeds the ${maxBytes}-byte limit.`);
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    fail(category, `${label} could not be read: ${error instanceof Error ? error.message : error}`);
  }
}

export function resolveInstalledKitPackage(
  options: { installedPackageRoot?: string; expectation?: KitCandidateExpectation } = {}
): InstalledKitPackage {
  const expectation = options.expectation ?? QUALIFIED_PUBLISHED_KIT;
  let packageJsonPath: string;
  if (options.installedPackageRoot !== undefined) {
    packageJsonPath = path.join(path.resolve(options.installedPackageRoot), "package.json");
  } else {
    try {
      // Node module resolution from Lab's own installation. No PATH, no npx.
      packageJsonPath = createRequire(import.meta.url).resolve(`${expectation.packageName}/package.json`);
    } catch {
      fail(
        "package-missing",
        `${expectation.packageName} is not installed in Lab's managed package environment.`
      );
    }
  }
  let packageRoot: string;
  try {
    packageRoot = fs.realpathSync(path.dirname(packageJsonPath));
  } catch {
    fail("package-missing", `installed Kit package root does not exist: ${path.dirname(packageJsonPath)}.`);
  }

  const packageJsonBytes = readBoundedFile(
    path.join(packageRoot, "package.json"),
    KIT_PACKAGE_JSON_MAX_BYTES,
    "package-missing",
    "installed Kit package.json"
  );
  let packageJson: Record<string, unknown>;
  try {
    packageJson = JSON.parse(packageJsonBytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    fail("package-identity", "installed Kit package.json is not valid JSON.");
  }
  if (packageJson.name !== expectation.packageName) {
    fail("package-identity", `installed package ${JSON.stringify(packageJson.name)} is not ${expectation.packageName}.`);
  }
  if (packageJson.version !== expectation.packageVersion) {
    fail(
      "package-identity",
      `installed ${expectation.packageName} version ${JSON.stringify(packageJson.version)} is not ${expectation.packageVersion}.`
    );
  }

  const bin = packageJson.bin;
  const binEntry =
    typeof bin === "string"
      ? bin
      : typeof bin === "object" && bin !== null && typeof (bin as Record<string, unknown>)["my-dev-kit"] === "string"
        ? ((bin as Record<string, unknown>)["my-dev-kit"] as string)
        : undefined;
  if (binEntry === undefined || binEntry.length === 0 || path.isAbsolute(binEntry)) {
    fail("cli-containment", "installed Kit package.json declares no relative my-dev-kit bin entry.");
  }
  const declaredCli = path.resolve(packageRoot, binEntry);
  if (!isContained(packageRoot, declaredCli)) {
    fail("cli-containment", `Kit bin entry ${JSON.stringify(binEntry)} escapes the installed package root.`);
  }
  let cliPath: string;
  try {
    cliPath = fs.realpathSync(declaredCli);
  } catch {
    fail("cli-containment", `Kit CLI ${binEntry} does not exist inside the installed package.`);
  }
  if (!isContained(packageRoot, cliPath)) {
    fail("cli-containment", "Kit CLI resolves outside the installed package root (symlink or junction).");
  }
  if (path.extname(cliPath) !== ".js") {
    fail("cli-containment", `Kit CLI ${binEntry} is not a JavaScript entry.`);
  }

  const cliBytes = readBoundedFile(cliPath, KIT_CLI_MAX_BYTES, "cli-containment", "installed Kit CLI");
  const cliSha256 = sha256Hex(cliBytes);
  if (expectation.cliSha256 !== null && cliSha256 !== expectation.cliSha256) {
    fail(
      "package-identity",
      `installed Kit CLI SHA-256 ${cliSha256} is not the qualified candidate ${expectation.cliSha256}.`
    );
  }
  const proofProfile = cliSha256 === QUALIFIED_B3_P1_KIT.cliSha256;
  if (expectation.artifactSchemaVersion === "1.2.0" && !proofProfile) {
    fail("package-identity", "Source-audit schema 1.2.0 requires the exact qualified B3-P1 CLI.");
  }
  if (proofProfile && (expectation.extractorRevision !== QUALIFIED_B3_P1_KIT.extractorRevision ||
      expectation.packageVersion !== QUALIFIED_B3_P1_KIT.packageVersion || expectation.packageName !== KIT_PACKAGE_NAME ||
      expectation.cliSha256 !== QUALIFIED_B3_P1_KIT.cliSha256)) {
    fail("package-identity", "B3-P1 requires its exact extractor, package and CLI identity.");
  }
  if (proofProfile && !["1.1.0", "1.2.0"].includes(expectation.artifactSchemaVersion)) {
    fail("schema-mismatch", "B3-P1 supports legacy 1.1.0 and explicit 1.2.0.");
  }
  const exact = SW123_EXACT_KIT_PROFILES.find(profile => profile.cliSha256 === cliSha256);
  if (exact) {
    if (expectation.extractorRevision !== exact.extractorRevision) fail("extractor-mismatch", "The SW-123 candidate requires its exact extractor revision.");
    if (expectation.artifactSchemaVersion !== exact.artifactSchemaVersion) fail("schema-mismatch", "The SW-123 candidate requires its exact source-audit schema.");
    if (!matchesExactKitExpectation(expectation, exact)) fail("package-identity", "The SW-123 candidate requires its exact package identity and CLI digest.");
  }
  if (!cliBytes.includes(Buffer.from(expectation.extractorRevision, "utf8"))) {
    fail("extractor-mismatch", `installed Kit CLI does not carry extractor revision ${expectation.extractorRevision}.`);
  }
  return {
    packageRoot,
    cliPath,
    packageName: expectation.packageName,
    packageVersion: expectation.packageVersion,
    cliSha256,
  };
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

type KitCommandKind = "index" | "lookup-audit-files" | "lookup-audit-file" | "source-occurrence" | "source-range" | "import-target" | "import-domain" | "byte-occurrence";

type KitCommandContext = {
  pkg: InstalledKitPackage;
  runCommand: KitCommandRunner;
  workDir: string;
  logDir: string;
  sequence: { next: number };
  receipt?: AuditExecutionReceipt;
};

function classifyStderrCode(stderr: string): KitEvidenceFailureCategory | undefined {
  const code = /^([A-Z][A-Z0-9_]{3,})\b:?/m.exec(stderr.trim())?.[1];
  switch (code) {
    case "STALE_SOURCE_EVIDENCE":
      return "stale-evidence";
    case "INVALID_AUDIT_PATH":
    case "INVALID_AUDIT_PAGE":
      return "path-invalid";
    case "AUDIT_EVIDENCE_INVALID":
      return "artifact-invalid";
    case "AUDIT_EVIDENCE_UNAVAILABLE":
      return "artifact-missing";
    default:
      return undefined;
  }
}

async function runKitJson(ctx: KitCommandContext, kind: KitCommandKind, kitArgs: string[], stdoutMaxBytes = KIT_STDOUT_MAX_BYTES): Promise<unknown> {
  const commandId = `kit-${String(ctx.sequence.next++).padStart(6, "0")}-${kind}`;
  const options: RunMeasuredCommandOptions = {
    commandId,
    executable: process.execPath,
    args: [ctx.pkg.cliPath, ...kitArgs],
    cwd: ctx.workDir,
    outDir: ctx.logDir,
    resolveCommand: false,
    timeoutMs: kind === "index" ? KIT_INDEX_TIMEOUT_MS : KIT_LOOKUP_TIMEOUT_MS,
    stdoutMaxBytes,
    stderrMaxBytes: KIT_STDERR_MAX_BYTES,
    terminateProcessTree: true,
  };
  const receipt = ctx.receipt;
  // Predicate literals can be source-derived. They are not part of the
  // reconstructible invocation when retained evidence redacts them.
  const secretIndex = kitArgs.findIndex(arg => arg === "--contains" || arg === "--contains-bytes-hex");
  const args = [...options.args!];
  if (secretIndex >= 0) args[secretIndex + 2] = "[REDACTED]";
  let observedExit: number | null = null;
  if (receipt) {
    options.telemetryArgs = args;
    options.exclusiveArtifacts = true;
    options.onSettled = result => {
      observedExit = result.exitCode;
      receipt.write(commandId + "-exit", {
        exitCode: result.exitCode, signal: result.signal ?? null, ok: result.ok,
        startedAt: result.startedAt, endedAt: result.endedAt, timedOut: result.timedOut,
        outputLimit: result.outputLimit, processTreeCleanup: result.processTreeCleanup, error: result.error,
      });
    };
    receipt.write(commandId + "-initial", { ...options, args, telemetryArgs: undefined,
      exactArgv: secretIndex < 0, environment: { mode: "inherited", omitted: true, nodeOptionsPresent: process.env.NODE_OPTIONS !== undefined }, launcher: "node:child_process.spawn" });
  }
  let result: MeasuredCommandResult;
  try { result = await ctx.runCommand(options); } catch (error) {
    receipt?.write(commandId + "-failure", { exitCode: observedExit, error: String(error) });
    if (error instanceof KitSourceEvidenceAcquisitionError) throw error;
    fail("subprocess-failed", `Kit ${kind} executor failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (receipt) receipt.write(commandId + "-result", {
    exitCode: result.exitCode, signal: result.signal ?? null, ok: result.ok, error: result.error,
    startedAt: result.startedAt, endedAt: result.endedAt, timedOut: result.timedOut,
    outputLimit: result.outputLimit, processTreeCleanup: result.processTreeCleanup,
    artifacts: [result.stdoutPath, result.stderrPath, result.telemetryPath].map(file =>
      file && fs.existsSync(file) ? describeAuditFile(file) : null),
  });
  if (result.timedOut) {
    fail("subprocess-timeout", `Kit ${kind} command timed out.`);
  }
  if (result.outputLimit) {
    fail(
      "output-limit",
      `Kit ${kind} command exceeded the ${result.outputLimit.limitBytes}-byte ${result.outputLimit.stream} limit; truncated output is not parsed.`
    );
  }
  if (!result.ok) {
    const stderrCode = classifyStderrCode(result.stderr);
    fail(
      stderrCode ?? "subprocess-failed",
      `Kit ${kind} command failed (exit ${result.exitCode ?? "none"}${result.error ? `, ${result.error}` : ""}).`,
      result.stderr.slice(0, 500)
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail("invalid-json", `Kit ${kind} command exited 0 but stdout is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
}

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

export type KitEvidenceRequest = {
  // Internal opt-in: the runner must account for unavailable predicates before enabling this.
  predicateRequirements?: readonly ApplicableKitFileRequirement[];
  targetRoot: string;
  sourceRoots: readonly string[];
  // Chooses which inventoried files need exact-file facts. May throw a
  // KitSourceEvidenceAcquisitionError (for example, selection incomplete).
  selectFactPaths: (inventory: readonly KitFileRecord[]) => readonly string[];
  requiredCapabilities: (record: KitFileRecord) => KitRequiredCapabilities;
  allowPartialDeclarationsForPath?: (filePath: string) => boolean;
  deferPartialImports?: boolean;
};

function normalizeRootForCompare(value: string): string {
  const resolved = path.resolve(value).replace(/\\/g, "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export async function acquireKitSourceEvidence(
  request: KitEvidenceRequest,
  pkg: InstalledKitPackage,
  deps: KitSourceProviderDependencies,
  expectation: KitCandidateExpectation,
  workDir: string
): Promise<KitSourceEvidence> {
  const proofProfile = pkg.cliSha256 === QUALIFIED_B3_P1_KIT.cliSha256 && matchesExactKitExpectation(expectation, QUALIFIED_B3_P1_KIT);
  if (request.predicateRequirements && !proofProfile && (!expectation.cliSha256 || expectation.artifactSchemaVersion !== "1.1.0" ||
      (!["source-audit-v1.5.0", "source-audit-v1.5.1"].includes(expectation.extractorRevision) &&
        !SW123_EXACT_KIT_PROFILES.some(profile => matchesExactKitExpectation(expectation, profile))))) {
    fail("invalid-request", "Predicate evidence requires an exact CLI digest and an explicitly qualified source-audit contract.");
  }
  const logDir = path.join(workDir, "logs");
  const indexDir = path.join(workDir, "index");
  fs.mkdirSync(logDir, { recursive: true });
  if (fs.existsSync(indexDir)) {
    fail("invalid-request", "the Kit index output directory already exists; refusing to overwrite it.");
  }
  const ctx: KitCommandContext = {
    pkg,
    runCommand: deps.runCommand ?? runMeasuredCommand,
    workDir,
    logDir,
    sequence: { next: 0 },
    receipt: deps.receipt,
  };

  // 1. Index immediately before obtaining evidence, outside the target.
  const indexArgs = ["index", "--root", request.targetRoot];
  for (const root of request.sourceRoots) indexArgs.push("--src", root);
  if (proofProfile) indexArgs.push("--source-audit-schema", "1.2.0");
  indexArgs.push("--out", indexDir, "--json");
  deps.receipt?.setStage("kit-index");
  let indexResult: unknown;
  try {
    indexResult = await runKitJson(ctx, "index", indexArgs);
  } finally {
    if (deps.receipt) {
      const files = ["manifest.json", KIT_SOURCE_AUDIT_ARTIFACT_FILENAME].map(name => {
        const filename = path.join(indexDir, name);
        return fs.existsSync(filename) && fs.lstatSync(filename).isFile() &&
          path.relative(filename, fs.realpathSync(filename)) === "" ? describeAuditFile(filename) : null;
      });
      deps.receipt.write("kit-index-artifacts", files);
    }
  }
  deps.receipt?.setStage("kit-artifact-validation");
  if (typeof indexResult !== "object" || indexResult === null || (indexResult as { mode?: unknown }).mode !== "index") {
    fail("artifact-invalid", "Kit index command did not report mode index.");
  }

  // 2. Manifest and artifact (task-owned directory, fixed names).
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      readBoundedFile(path.join(indexDir, "manifest.json"), KIT_MANIFEST_MAX_BYTES, "artifact-missing", "Kit manifest").toString("utf8")
    );
  } catch (error) {
    if (error instanceof KitSourceEvidenceAcquisitionError) throw error;
    fail("invalid-json", "Kit manifest is not valid JSON.");
  }
  const reference = validateKitManifestReference(manifest);
  const artifactBytes = readBoundedFile(
    path.join(indexDir, KIT_SOURCE_AUDIT_ARTIFACT_FILENAME),
    KIT_ARTIFACT_MAX_BYTES,
    "artifact-missing",
    "Kit source-audit artifact"
  );
  if (reference.schemaVersion !== expectation.artifactSchemaVersion) fail("schema-mismatch", "Source-audit manifest schema differs from the producer expectation.");
  const header = validateKitArtifact(artifactBytes, reference, {
    packageName: expectation.packageName,
    packageVersion: expectation.packageVersion,
    artifactSchemaVersion: expectation.artifactSchemaVersion,
  });
  if (normalizeRootForCompare(header.source.projectRoot) !== normalizeRootForCompare(request.targetRoot)) {
    fail("root-mismatch", `artifact projectRoot ${header.source.projectRoot} is not the requested target.`);
  }

  // 3. Complete inventory traversal.
  deps.receipt?.write("kit-artifact-identity", {
    producer: header.producer, source: header.source, coverage: header.coverage, schemaVersion: header.schemaVersion,
  });
  deps.receipt?.setStage("kit-inventory");
  const snapshotId = header.source.snapshotId;
  const inventoryPages: KitInventoryPage[] = await collectAllPages(
    async (pageIndex) => {
      const raw = await runKitJson(ctx, "lookup-audit-files", [
        "lookup", "--index", indexDir, "--audit-files", "--page", String(pageIndex), "--json",
      ]);
      if ((raw as { schemaVersion?: unknown })?.schemaVersion !== header.schemaVersion) fail("schema-mismatch", "Inventory page schema differs from the validated artifact.");
      return validateInventoryPage(raw, { snapshotId, pageIndex });
    },
    { maxPages: KIT_MAX_INVENTORY_PAGES, label: "inventory traversal" }
  );
  const inventory = flattenInventoryPages(inventoryPages);
  deps.receipt?.write("kit-selection", { inventory, pageCount: inventoryPages.length });
  crossValidateInventory(header, inventory, inventoryPages, request.sourceRoots);
  deps.receipt?.setStage("kit-required-coverage");

  // 4. Exact-file fact traversal for the files the caller needs.
  const factPaths = [...new Set([...request.selectFactPaths(inventory), ...(["1.1.0", "1.2.0"].includes(header.schemaVersion) ? inventory.filter(file => /\.(java|kt)$/i.test(file.path)).map(file => file.path) : [])])].sort();
  deps.receipt?.setStage("kit-fact-pages");
  const recordByPath = new Map(inventory.map((record) => [record.path, record]));
  for (const factPath of factPaths) {
    if (!requestedPathMatchesCanonical(factPath) || !recordByPath.has(factPath)) {
      fail("selection-incomplete", `requested fact file ${JSON.stringify(factPath)} is not in the Kit selected inventory.`);
    }
  }
  const fileEvidence = new Map<string, KitFileEvidence>();
  const globalFactIds = new Set<string>();
  const outcomes: Array<{ evidence?: KitFileEvidence; pages?: KitFactPage[]; error?: unknown }> = factPaths.map(() => ({}));
  let aborted = false;
  let cursor = 0;
  const worker = async () => {
    while (!aborted) {
      const index = cursor++;
      if (index >= factPaths.length) return;
      const filePath = factPaths[index]!;
      try {
        const pages = await collectAllPages(
          async (pageIndex) => {
            const raw = await runKitJson(ctx, "lookup-audit-file", [
              "lookup", "--index", indexDir, "--audit-file", filePath, "--page", String(pageIndex), "--json",
            ]);
            if ((raw as { schemaVersion?: unknown })?.schemaVersion !== header.schemaVersion) fail("schema-mismatch", "Fact page schema differs from the validated artifact.");
            return validateFactPage(raw, { snapshotId, pageIndex, path: filePath });
          },
          { maxPages: KIT_MAX_FACT_PAGES_PER_FILE, label: `fact traversal of ${filePath}` }
        );
        const inventoryRecord = recordByPath.get(filePath)!;
        crossValidateFileRecord(inventoryRecord, pages[0]!.file);
        const record = pages[0]!.file;
        if (request.predicateRequirements) {
          const requirements = request.predicateRequirements.filter(r => r.path === filePath);
          const required = request.requiredCapabilities(record);
          if (required.length > 0 && (requirements.length === 0 || requirements.some(r =>
              !KIT_SOURCE_EVIDENCE_REQUIREMENTS[r.detectorId] ||
              (r.applicability === "APPLICABLE_REQUIRED" && !KIT_SOURCE_EVIDENCE_REQUIREMENTS[r.detectorId]!.capabilities.includes(r.capability))) ||
              JSON.stringify([...required].sort()) !== JSON.stringify(requiredKitCapabilitiesForPath(requirements, filePath)))) {
            fail("invalid-request", `${filePath} predicate requirements do not cover its requested capabilities.`);
          }
          assertPredicateScopedCapabilities(record, required);
        } else if ((expectation.cliSha256 === QUALIFIED_KIT_CANDIDATE.cliSha256 || expectation.cliSha256 === QUALIFIED_PUBLISHED_KIT.cliSha256) &&
            request.allowPartialDeclarationsForPath?.(filePath)) {
          assertQualifiedPartialDeclarations(record, request.requiredCapabilities(record));
        } else {
          const required = request.requiredCapabilities(record);
          const qualifiedProducer = expectation.cliSha256 === QUALIFIED_PUBLISHED_KIT.cliSha256 || expectation.cliSha256 === QUALIFIED_KIT_CANDIDATE.cliSha256;
          assertRequiredCapabilities(record, request.deferPartialImports && qualifiedProducer && hasQualifiedPartialImports(record)
            ? required.filter(capability => capability !== "imports") : required);
        }
        outcomes[index] = { pages };
      } catch (error) {
        outcomes[index] = { error };
        aborted = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(KIT_LOOKUP_CONCURRENCY, Math.max(1, factPaths.length)) }, worker));
  // Deterministic: report the first failure in sorted path order.
  for (const outcome of outcomes) {
    if (outcome.error !== undefined) throw outcome.error;
  }
  let factPageCount = 0;
  factPaths.forEach((filePath, index) => {
    const pages = outcomes[index]!.pages;
    if (pages === undefined) fail("traversal-incomplete", `no fact traversal result for ${filePath}.`);
    const facts = flattenFactPages(filePath, pages, globalFactIds);
    factPageCount += pages.length;
    fileEvidence.set(filePath, { record: pages[0]!.file, facts, factPages: pages.length });
  });

  return {
    producer: header.producer,
    artifactSchemaVersion: header.schemaVersion,
    extractorRevision: expectation.extractorRevision,
    source: header.source,
    coverage: header.coverage,
    snapshotId,
    inventory,
    inventoryPages: inventoryPages.length,
    fileEvidence,
    factPages: factPageCount,
    traversalComplete: true,
  };
}

// ---------------------------------------------------------------------------
// Lab-facing orchestration
// ---------------------------------------------------------------------------

export type KitSourceFactsRequest = {
  predicateRequirements?: readonly ApplicableKitFileRequirement[];
  targetRoot: string;
  inventory: ProjectInventorySnapshot;
  // Capabilities required of every Lab source/test file Kit analyzes.
  requiredCapabilities: KitRequiredCapabilities;
  includeScriptsRoot: boolean;
  requiredPaths?: readonly string[];
  capabilitiesForPath?: (filePath: string) => KitRequiredCapabilities;
  allowPartialDeclarationsForPath?: (filePath: string) => boolean;
  deferPartialImports?: boolean;
  onReader?: (reader: KitSourceReader) => void;
};

export type KitSourceReader = {
  jsTsRelativeImportCandidateProof?: "mjs-extensionless-complete-v1";
  jsonRawLiteralContent?: "selected-test-json-v1";
  snapshotId: string;
  producer: KitSourceEvidence["producer"];
  selectedFile: (filePath: string) => KitFileRecord;
  // Positive path-literal facts only; this never certifies text absence.
  fixtureReferenceBasenames?: (filePath: string) => readonly string[];
  reExportSpecifiers?: (filePath: string) => readonly string[];
  reExportTargets?: (filePath: string) => readonly { id: string; sourceSpecifier: string }[];
  unsupportedRawContentReason?: (filePath: string) => string | undefined;
  occurrences: (filePath: string, value: string) => Promise<KitOccurrence>;
  // Private exact-producer profile: contiguous Kit ranges, authenticated
  // against the selected record's byte hash before any whole-text predicate.
  authenticatedContent?: (filePath: string) => Promise<string>;
  // Selected JSON can also come from hash-verified occurrence windows.
  authenticatedFixtureContent?: (filePath: string) => Promise<string>;
  cachedAuthenticatedFixtureContent?: (filePath: string) => Promise<string | undefined>;
  // Exact selected bytes for text-only predicates. This supplies no semantic facts.
  authenticatedRawTestContent?: (filePath: string) => string | undefined;
  expressionDomains?: (filePath: string) => Promise<readonly { linkedImportFactId?: string; proof: KitImportDomain }[]>;
  byteOccurrences?: (filePath: string, needleHex: string) => Promise<KitByteOccurrence>;
  ambientClassification?: (filePath: string) => KitAmbientClassification | undefined;
  importTarget: (factId: string) => Promise<KitImportProof>;
  dispose: () => void;
};

// Private semantic compatibility profiles, independent of package/schema versions.
// Add future producer identities only after qualifying the same proof contract.
const IMPORT_PROOF_PROFILES: Readonly<Record<string, "mjs-extensionless-complete-v1">> = Object.freeze({
  [QUALIFIED_SW123_P6_R2_KIT.cliSha256]: "mjs-extensionless-complete-v1",
  // SW-123 P5: exact unpublished P2 archive, metadata 1.15.1. Installed
  // proof/occurrence tests qualify this digest; it does not advance the pin.
  "591109bd72d4f423865e65eac28e216a754c7abdb470d1df21066c6edc8522eb": "mjs-extensionless-complete-v1",
  "35dbc49fc91f8c47f1e7cdaf86223414a54517ff25a1a29f87231b2bae3807b8": "mjs-extensionless-complete-v1",
  "ac66e5a4a06b48f7a7bbbf03734002bd6686cc6aa2343d097ff374f52fcb486f": "mjs-extensionless-complete-v1",
  "9c4b4aa51e17d2a3a973cbc320fa45659bea79d831c046226e3adf4eb7717004": "mjs-extensionless-complete-v1",
  "c024614168a747764811926a403fb7e75d32c8b7be77d7a7cba16344d8848c1e": "mjs-extensionless-complete-v1",
  "e10d0ec4274681743623a8aabee41d6a68cdb1caf86b14a16a4dafd802808635": "mjs-extensionless-complete-v1",
});

// Candidate 03 (source 8688c371249513988cbc7f13be2e339c80b07f99,
// tarball b3a39074098eef79c0c50b6f82c2e708a533dc661b48d345fc5e018cc14bd85f)
// separately qualified selected JSON content with extractor source-audit-v1.3.0.
// Neither a package version nor an extractor revision self-certifies this.
const JSON_RAW_CONTENT_PROFILES: Readonly<Record<string, "selected-test-json-v1">> = Object.freeze({
  [QUALIFIED_SW123_P6_R2_KIT.cliSha256]: "selected-test-json-v1",
  "591109bd72d4f423865e65eac28e216a754c7abdb470d1df21066c6edc8522eb": "selected-test-json-v1",
  "35dbc49fc91f8c47f1e7cdaf86223414a54517ff25a1a29f87231b2bae3807b8": "selected-test-json-v1",
  "ac66e5a4a06b48f7a7bbbf03734002bd6686cc6aa2343d097ff374f52fcb486f": "selected-test-json-v1",
  "9c4b4aa51e17d2a3a973cbc320fa45659bea79d831c046226e3adf4eb7717004": "selected-test-json-v1",
  "e10d0ec4274681743623a8aabee41d6a68cdb1caf86b14a16a4dafd802808635": "selected-test-json-v1",
});

// Candidate 04, Kit commit 9741b842d0efa6bf9276ff0c089e50eace3643b7,
// independently qualified selected generated and vendor raw occurrences without changing
// the public role schema or admitting generated semantic source facts.
const NON_SEMANTIC_RAW_CONTENT_PROFILES: ReadonlySet<string> = new Set([
  QUALIFIED_SW123_P6_R2_KIT.cliSha256,
  "591109bd72d4f423865e65eac28e216a754c7abdb470d1df21066c6edc8522eb",
  "ac66e5a4a06b48f7a7bbbf03734002bd6686cc6aa2343d097ff374f52fcb486f",
  "35dbc49fc91f8c47f1e7cdaf86223414a54517ff25a1a29f87231b2bae3807b8",
  "9c4b4aa51e17d2a3a973cbc320fa45659bea79d831c046226e3adf4eb7717004",
]);

function assertKitNonSemanticRawContent(record: KitFileRecord, qualifiedProducer: boolean): void {
  if (!qualifiedProducer || record.status !== "parsed" || record.lineCount === null ||
      record.contentSha256 === null || !/^[a-f0-9]{64}$/.test(record.contentSha256)) {
    fail("capability-insufficient", `${record.path} lacks qualified hash-identified non-semantic source raw content evidence.`);
  }
}

function createKitSourceReader(evidence: KitSourceEvidence, ctx: KitCommandContext, dispose: () => void,
  testFiles: ProjectInventorySnapshot["testFiles"], rawSourceFiles: ProjectInventorySnapshot["sourceFiles"], inventoryFiles: ProjectInventorySnapshot["files"]): KitSourceReader {
  const cache = new Map<string, Promise<KitOccurrence>>();
  const proofs = new Map<string, Promise<KitImportProof>>();
  const contents = new Map<string, Promise<string>>();
  const rawTestContents = new Map<string, string | undefined>();
  const testFileByPath = new Map(testFiles.map(file => [file.relativePath, file]));
  const r3 = ctx.pkg.cliSha256 === QUALIFIED_B3_P1_KIT.cliSha256 && evidence.artifactSchemaVersion === "1.2.0";
  const domainPromises = new Map<string, Promise<KitImportDomain>>();
  const assertFresh = (file: KitFileRecord) => {
    const root = fs.realpathSync(evidence.source.projectRoot);
    const target = fs.realpathSync(path.resolve(root, file.path));
    if (!isContained(root, target) || !file.contentSha256) fail("stale-evidence", "Required proof file lacks contained hashed bytes.");
    const bytes = readBoundedFile(target, file.sizeBytes, "stale-evidence", "Proof source");
    if (bytes.length !== file.sizeBytes || sha256Hex(bytes) !== file.contentSha256) fail("stale-evidence", "Proof source bytes changed.");
    return bytes;
  };
  const indexDir = path.join(ctx.workDir, "index");
  const jsonRawLiteralContent = r3 ? "selected-test-json-v1" : JSON_RAW_CONTENT_PROFILES[ctx.pkg.cliSha256];
  const p6R2 = ctx.pkg.cliSha256 === QUALIFIED_SW123_P6_R2_KIT.cliSha256 &&
    ctx.pkg.packageName === QUALIFIED_SW123_P6_R2_KIT.packageName &&
    ctx.pkg.packageVersion === QUALIFIED_SW123_P6_R2_KIT.packageVersion &&
    evidence.artifactSchemaVersion === QUALIFIED_SW123_P6_R2_KIT.artifactSchemaVersion &&
    evidence.extractorRevision === QUALIFIED_SW123_P6_R2_KIT.extractorRevision;
  const p6R7 = matchesExactKitExpectation({
    ...ctx.pkg, artifactSchemaVersion: evidence.artifactSchemaVersion, extractorRevision: evidence.extractorRevision,
  }, QUALIFIED_SW123_P6_R7_KIT);
  const authenticatedRanges = p6R2 || p6R7 ||
    ctx.pkg.cliSha256 === "591109bd72d4f423865e65eac28e216a754c7abdb470d1df21066c6edc8522eb";
  const selectedFile = (filePath: string): KitFileRecord => {
    validateKitRelativePath(filePath, "required content file");
    const file = evidence.inventory.find((record) => record.path === filePath);
    if (!file) fail("selection-incomplete", `Required file ${filePath} is not validated selected evidence (missing coverage).`);
    if (p6R2 && file.status === "unsupported" && !filePath.toLowerCase().endsWith(".json")) {
      const input = inventoryFiles.find(entry => entry.relativePath === filePath);
      if (!input) fail("selection-incomplete", `Required file ${filePath} is absent from Lab's inventory.`);
      if (input.sizeBytes !== file.sizeBytes) fail("stale-evidence", `${filePath} size differs from Lab's inventory.`);
      if (!file.contentSha256 || file.sizeBytes > 200000) fail("capability-insufficient", `${filePath} lacks bounded authenticated text evidence.`);
      return file;
    }
    if (evidence.fileEvidence.has(filePath)) return file;
    const rawSourceFile = rawSourceFiles.find((entry) => entry.relativePath === filePath);
    if (rawSourceFile) {
      if (rawSourceFile.sizeBytes !== file.sizeBytes) fail("stale-evidence", `${filePath} size differs from Lab's inventory.`);
      assertKitNonSemanticRawContent(file, NON_SEMANTIC_RAW_CONTENT_PROFILES.has(ctx.pkg.cliSha256));
      return file;
    }
    const testFile = testFiles.find((entry) => entry.relativePath === filePath);
    if (!jsonRawLiteralContent || !testFile || !filePath.endsWith(".json")) {
      fail("selection-incomplete", `Required file ${filePath} is not validated selected evidence.`);
    }
    if (testFile.sizeBytes !== file.sizeBytes) fail("stale-evidence", `${filePath} size differs from Lab's inventory.`);
    assertKitJsonRawContent(file, true);
    return file;
  };
  const reExportTargets = (filePath: string) => {
    if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
    selectedFile(filePath);
    const full = evidence.fileEvidence.get(filePath);
    if (!full || !["complete", "partial"].includes(full.record.capabilities.exports)) return [];
    return full.facts.flatMap(fact => fact.kind === "export" && fact.exportOrigin === "re-export" && fact.sourceSpecifier
      ? [{ id: fact.id, sourceSpecifier: fact.sourceSpecifier }] : []);
  };
  let closed = false;
  function readAuthenticatedContent(filePath: string, fixtureOnly = false): Promise<string> {
    if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
    const file = selectedFile(filePath);
    const fixtureJson = fixtureOnly && filePath.endsWith(".json");
    if (fixtureOnly && !fixtureJson && (!["parsed", "partial"].includes(file.status) ||
        !SOURCE_LANGUAGES.has(file.language) || file.lineCount === null || !file.contentSha256)) {
      fail("capability-insufficient", `${filePath} lacks qualified fixture source ranges.`);
    }
    if (fixtureOnly) assertFresh(file);
    if (contents.has(filePath)) return contents.get(filePath)!;
    // Zero bytes plus their authenticated digest establish the entire
    // content. Kit has no first source line to return for an empty file.
    if (file.sizeBytes === 0 && file.contentSha256) {
      if (file.contentSha256 !== createHash("sha256").update("").digest("hex")) {
        fail("stale-evidence", `${filePath} has an inconsistent authenticated empty-file digest.`);
      }
      if (p6R2 && file.status === "unsupported") return (async () => {
        for (const [key, query] of cache) {
          const [snapshot, origin] = JSON.parse(key) as string[];
          if (snapshot === evidence.snapshotId && origin === filePath && (await query).complete) return "";
        }
        fail("capability-insufficient", `${filePath} requires a complete occurrence query to authenticate empty text.`);
      })();
      const empty = Promise.resolve("");
      contents.set(filePath, empty);
      return empty;
    }
    if (fixtureJson) {
      // One literal probe can supply whole-file context for selected JSON.
      // Truncated windows are useful only if the exact byte digest matches.
      // Keep this optional probe within the existing command output budget.
      if (file.sizeBytes * 200 * 6 + 131072 > KIT_STDOUT_MAX_BYTES) {
        fail("capability-insufficient", `${filePath} fixture source windows may exceed the bounded output budget.`);
      }
      const content = reader.occurrences(filePath, '"').then(result => {
        const text = authenticateKitWindowContent(filePath, file, result.matches);
        assertFresh(file);
        if (text === null) fail("capability-insufficient", `${filePath} lacks complete hash-identified fixture source windows.`);
        return text;
      });
      contents.set(filePath, content);
      return content;
    }
    if ((filePath.endsWith(".json") || p6R2 && file.status === "unsupported") && file.contentSha256 && file.sizeBytes <= 200000) return (async () => {
      const matches: KitOccurrence["matches"] = [];
      for (const [key, query] of cache) {
        const [snapshot, origin] = JSON.parse(key) as string[];
        if (snapshot === evidence.snapshotId && origin === filePath) matches.push(...(await query).matches);
      }
      const content = authenticateKitWindowContent(filePath, file, matches);
      if (content === null) fail("capability-insufficient", `${filePath} lacks complete hash-identified cached source windows.`);
      contents.set(filePath, Promise.resolve(content));
      return content;
    })();
    if (!file.contentSha256 || file.lineCount === null || file.sizeBytes > 200000 || !SOURCE_LANGUAGES.has(file.language)) {
      fail("capability-insufficient", `${filePath} lacks bounded hash-identified whole-content evidence.`);
    }
    if (!contents.has(filePath)) contents.set(filePath, (async () => {
      const parts: string[] = [];
      for (let start = 1; start <= file.lineCount!; start += 160) {
        const end = Math.min(start + 159, file.lineCount!);
        const raw = await runKitJson(ctx, "source-range", ["source", "--index", indexDir,
          "--file", filePath, "--start", String(start), "--end", String(end), "--max-lines", "160", "--json"]);
        const r = raw as { status?: unknown; mode?: unknown; filePath?: unknown; indexDir?: unknown;
          absolutePath?: unknown; startLine?: unknown; endLine?: unknown; lineCount?: unknown; content?: unknown;
          continuationCursor?: { eof?: unknown } };
        // The pinned generic range renderer omits one terminal empty line.
        // Any other missing range, wrong identity or inconsistent coordinates
        // is invalid evidence, not a coverage warning.
        if (!r || typeof r !== "object" || Array.isArray(r) || r.status !== "ok" || r.mode !== "line-range" || r.filePath !== filePath ||
            typeof r.indexDir !== "string" || path.resolve(r.indexDir) !== path.resolve(indexDir) ||
            typeof r.absolutePath !== "string" || path.resolve(r.absolutePath) !== path.resolve(evidence.source.projectRoot, filePath) ||
            r.startLine !== start || typeof r.endLine !== "number" ||
            !(r.endLine === end || (end === file.lineCount && r.endLine === end - 1 && r.continuationCursor?.eof === true)) ||
            r.endLine < start || r.lineCount !== r.endLine - start + 1 || typeof r.content !== "string" ||
            (!fixtureOnly && r.content.includes("\r")) || r.content.split("\n").length !== r.lineCount ||
            (!fixtureOnly && Buffer.byteLength(r.content, "utf8") > file.sizeBytes)) {
          fail("artifact-invalid", `${filePath} has inconsistent authenticated source-range coordinates or identity.`);
        }
        parts.push(r.content);
        if (r.endLine === file.lineCount! - 1 && r.continuationCursor?.eof === true) break;
      }
      const normalized = parts.join("\n");
      // Kit renders ranges with LF and omits the terminal newline. Only an
      // exact original-byte digest match admits either supported encoding.
      for (const newline of ["\n", "\r\n"]) {
        const text = normalized.replace(/\n/g, newline);
        for (const candidate of [text, text + newline]) {
          if (Buffer.byteLength(candidate, "utf8") === file.sizeBytes &&
              createHash("sha256").update(candidate, "utf8").digest("hex") === file.contentSha256) {
            if (fixtureOnly) assertFresh(file);
            return candidate;
          }
        }
      }
      if (fixtureOnly) {
        // The generic renderer normalizes CRLF. Mixed endings or lossy decoding
        // may prevent reconstruction; abandon the range and use the exact scans.
        assertFresh(file);
        fail("capability-insufficient", `${filePath} source ranges cannot reconstruct the selected bytes.`);
      }
      fail("stale-evidence", `${filePath} source ranges do not reproduce the authenticated file bytes.`);
    })());
    return contents.get(filePath)!;
  }
  const reader: KitSourceReader = {
    snapshotId: evidence.snapshotId, producer: evidence.producer, dispose: () => { closed = true; contents.clear(); rawTestContents.clear(); dispose(); },
    jsTsRelativeImportCandidateProof: IMPORT_PROOF_PROFILES[ctx.pkg.cliSha256],
    jsonRawLiteralContent,
    selectedFile,
    reExportSpecifiers: filePath => reExportTargets(filePath).map(fact => fact.sourceSpecifier),
    reExportTargets: p6R2 ? reExportTargets : undefined,
    fixtureReferenceBasenames(filePath) {
      if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
      selectedFile(filePath);
      const full = evidence.fileEvidence.get(filePath);
      if (!full || !["complete", "partial"].includes(full.record.capabilities["fixture-references"])) return [];
      return full.facts.filter(fact => fact.kind === "fixture-reference" &&
        typeof fact.value === "string" && typeof fact.name === "string" &&
        path.posix.basename(fact.name.replace(/\\/g, "/")) === fact.value).map(fact => fact.value!) ?? [];
    },
    authenticatedContent: authenticatedRanges ? readAuthenticatedContent : undefined,
    authenticatedFixtureContent: r3 ? filePath => readAuthenticatedContent(filePath, true) : undefined,
    cachedAuthenticatedFixtureContent: r3 ? async filePath => {
      if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
      const content = contents.get(filePath);
      if (!content) return undefined;
      let text: string;
      try {
        text = await content;
      } catch (error) {
        if (!(error instanceof KitSourceEvidenceAcquisitionError) || error.category !== "capability-insufficient") throw error;
        return undefined;
      }
      if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
      assertFresh(selectedFile(filePath));
      return text;
    } : undefined,
    authenticatedRawTestContent: r3 ? filePath => {
      if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
      validateKitRelativePath(filePath, "raw test content file");
      const input = testFileByPath.get(filePath);
      if (!input) return undefined;
      const file = evidence.inventory.find(record => record.path === filePath);
      if (!file) fail("selection-incomplete", `Required file ${filePath} is missing from validated selected inventory.`);
      if (input.sizeBytes !== file.sizeBytes) fail("stale-evidence", `${filePath} size differs from Lab's inventory.`);
      if (!file.contentSha256 || file.sizeBytes > 200000 || file.status !== "unsupported" ||
          evidence.fileEvidence.has(filePath) && !filePath.endsWith(".json")) return undefined;
      const bytes = assertFresh(file);
      if (rawTestContents.has(filePath)) return rawTestContents.get(filePath);
      const decoded = bytes.toString("utf8");
      const text = !bytes.includes(0) && Buffer.from(decoded, "utf8").equals(bytes) ? decoded : undefined;
      rawTestContents.set(filePath, text);
      return text;
    } : undefined,
    unsupportedRawContentReason(filePath) {
      if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
      validateKitRelativePath(filePath, "raw coverage file");
      const file = evidence.inventory.find(record => record.path === filePath);
      if (!file) fail("selection-incomplete", `Required file ${filePath} is missing from validated selected inventory.`);
      const input = testFiles.find(entry => entry.relativePath === filePath);
      if (input && input.sizeBytes !== file.sizeBytes) fail("stale-evidence", `${filePath} size differs from Lab's inventory.`);
      // A selected unsupported file can have a byte hash without a qualified
      // content reader. Keep that gap distinct from a missing selection.
      if (!input || file.status !== "unsupported") return undefined;
      if (file.contentSha256 === null) {
        return "Validated Kit inventory declares unsupported raw source without a content hash; raw-content predicates are UNAVAILABLE.";
      }
      if (r3 && !evidence.fileEvidence.has(filePath) && !filePath.endsWith(".json")) {
        assertFresh(file);
        return "Validated Kit inventory identifies unsupported test bytes without a qualified raw-content reader.";
      }
      return undefined;
    },
    ...(r3 ? {
      async expressionDomains(filePath: string) {
        if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
        const entry = evidence.fileEvidence.get(filePath);
        if (!entry) fail("selection-incomplete", "Domain origin is outside authenticated fact pages.");
        assertFresh(entry.record);
        const proofs = [];
        for (const fact of entry.facts.filter(fact => fact.kind === "dynamic-import-expression")) {
          if (!domainPromises.has(fact.id)) domainPromises.set(fact.id, runKitJson(ctx, "import-domain", [
            "lookup", "--index", indexDir, "--audit-import-domain", fact.id, "--json",
          ]).then(raw => validateKitImportDomain(raw, evidence, fact)));
          const proof = await domainPromises.get(fact.id)!;
          assertFresh(entry.record);
          for (const target of proof.positivePaths) assertFresh(evidence.inventory.find(f => f.path === target)!);
          proofs.push({ linkedImportFactId: fact.dynamicImport?.literalImportFactId, proof });
        }
        return proofs;
      },
      async byteOccurrences(filePath: string, needleHex: string) {
        if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
        validateKitRelativePath(filePath, "byte occurrence path");
        if (!/^(?:[0-9a-f]{2}){1,4096}$/.test(needleHex)) fail("invalid-request", "Expected a bounded lowercase literal byte sequence.");
        const file = evidence.inventory.find(f => f.path === filePath);
        if (!file) fail("selection-incomplete", "Byte predicate file is outside selected inventory.");
        const raw = await runKitJson(ctx, "byte-occurrence", ["source", "--index", indexDir,
          "--file", filePath, "--contains-bytes-hex", needleHex, "--json"]);
        const proof = validateKitByteOccurrence(raw, evidence, file, needleHex);
        if (proof.complete || proof.matches.length) assertFresh(file);
        return proof;
      },
      ambientClassification(filePath: string) {
        if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
        const file = evidence.fileEvidence.get(filePath)?.record;
        if (!file?.ambientClassification) return undefined;
        assertFresh(file);
        return file.ambientClassification;
      },
    } : {}),
    occurrences(filePath, value) {
      if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
      validateKitRelativePath(filePath, "occurrence file");
      const file = selectedFile(filePath);
      if (!value || value.length > 4096 || /[\r\n]/.test(value)) fail("invalid-request", "An occurrence literal must be nonempty, bounded and single-line.");
      const key = JSON.stringify([evidence.snapshotId, filePath, value]);
      // The exact candidate returns up to 200 windows, each repeating a
      // single-line JSON document. Budget for JSON escaping (at most 6x),
      // while retaining a finite bound and fatal rejection of truncation.
      const outputBudget = authenticatedRanges &&
        filePath.endsWith(".json") && file.sizeBytes <= 200000
        ? Math.max(KIT_STDOUT_MAX_BYTES, file.sizeBytes * 200 * 6 + 131072) : KIT_STDOUT_MAX_BYTES;
      if (!cache.has(key)) cache.set(key, runKitJson(ctx, "source-occurrence", ["source", "--index", indexDir,
        "--file", filePath, "--contains", value, "--context", "40", "--json"], outputBudget)
        .then((raw) => {
          if ((raw as { schemaVersion?: unknown })?.schemaVersion !== (r3 ? "1.1.0" : evidence.artifactSchemaVersion)) fail("schema-mismatch", "Occurrence schema differs from the validated artifact.");
          return validateKitOccurrence(raw, { snapshotId: evidence.snapshotId, file, value, rawOnlyTextUnavailable: r3 && file.status === "unsupported" });
        }));
      return cache.get(key)!;
    },
    importTarget(factId) {
      if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
      const fact = [...evidence.fileEvidence.values()].flatMap(({ record, facts }) => facts.filter(fact =>
        fact.id === factId && (fact.kind === "import" || p6R2 && fact.kind === "export" &&
          fact.exportOrigin === "re-export" && !!fact.sourceSpecifier &&
          (record.language === "javascript" || record.language === "typescript"))))[0];
      if (!fact) fail("invalid-request", "Import fact ID is not in the validated fact pages.");
      if (!proofs.has(factId)) proofs.set(factId, runKitJson(ctx, "import-target", ["lookup", "--index", indexDir,
        "--audit-import-target", factId, "--json"]).then((raw) => validateKitImportProof(raw, { snapshotId: evidence.snapshotId, fact, evidence })));
      return proofs.get(factId)!;
    },
  };
  return reader;
}

export type KitSourceScope = {
  sourceRoots: string[];
  requiredPaths: string[];
  excludedPaths: string[];
  inapplicablePaths: string[];
  unresolvedPaths: string[];
  complete: boolean;
  widerSelection: boolean;
};

// Only examines inventory paths and their ancestors, never discovers files.
// Kit documents --src as relative to --root, including the project root;
// selecting '.' is explicitly wider and still requires exact-file validation.
export function selectKitSourceRoots(
  targetRoot: string,
  inventory: ProjectInventorySnapshot,
  requiredPaths: readonly string[] = inventory.files.filter(labRequiresKitFacts).map((entry) => entry.relativePath),
  rawSourcePaths: readonly string[] = [],
  qualifiedTsconfigContent = false
): KitSourceScope {
  const base = fs.realpathSync(targetRoot);
  const byPath = new Map(inventory.files.map((entry) => [entry.relativePath, entry]));
  const identities = new Set<string>();
  for (const entry of inventory.files) {
    const canonical = validateKitRelativePath(entry.relativePath, "Lab inventory path");
    const identity = canonical.toLowerCase();
    if (identities.has(identity)) fail("path-invalid", `ambiguous Lab file identity ${canonical}.`);
    identities.add(identity);
  }
  const roots = new Set<string>();
  const excludedPaths: string[] = [];
  const unresolvedPaths: string[] = [];
  const required = [...new Set(requiredPaths)].sort();
  const rawTests = new Set(inventory.testFiles.map((entry) => entry.relativePath));
  const rawSources = new Set(inventory.files.filter((entry) => (entry.role === "generated" || entry.role === "vendor") &&
    SOURCE_LANGUAGES.has(entry.language) && rawSourcePaths.includes(entry.relativePath)).map((entry) => entry.relativePath));
  for (const filePath of required) {
    validateKitRelativePath(filePath, "required Lab path");
    const entry = byPath.get(filePath);
    const rawJson = rawTests.has(filePath) && isKitJsonTestContentPath(filePath, qualifiedTsconfigContent);
    const rawSource = (entry?.role === "generated" || entry?.role === "vendor") && rawSources.has(filePath);
    const rawConfig = entry?.role === "config" && filePath.endsWith(".gradle.kts") && rawSourcePaths.includes(filePath);
    if (entry && !labRequiresKitFacts(entry) && !rawJson && !rawSource && !rawConfig) { excludedPaths.push(filePath); continue; }
    if (!entry) { unresolvedPaths.push(filePath); continue; }
    try {
      let current = base;
      const segments = filePath.split("/");
      for (const [index, segment] of segments.entries()) {
        current = path.join(current, segment);
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) throw new Error("source link or junction");
        if (index < segments.length - 1 ? !stat.isDirectory() : !stat.isFile()) throw new Error("invalid path kind");
        const relative = path.relative(base, fs.realpathSync(current));
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("source escape");
      }
      roots.add(segments.length === 1 ? "." : rawJson || rawSource ? segments.slice(0, -1).join("/") : segments[0]!);
    } catch {
      unresolvedPaths.push(filePath);
    }
  }
  const sourceRoots = roots.has(".") ? ["."] : [...roots].sort().filter((root) =>
    ![...roots].some((ancestor) => ancestor !== root && root.startsWith(`${ancestor}/`)));
  const requiredSet = new Set(required);
  const inapplicablePaths = inventory.files.map((entry) => entry.relativePath).filter((filePath) => !requiredSet.has(filePath)).sort();
  return { sourceRoots, requiredPaths: required, excludedPaths, inapplicablePaths, unresolvedPaths,
    complete: excludedPaths.length === 0 && unresolvedPaths.length === 0, widerSelection: roots.has(".") };
}

function labRequiresKitFacts(entry: ProjectInventorySnapshot["files"][number]): boolean {
  return (entry.role === "source" || entry.role === "test") && SOURCE_LANGUAGES.has(entry.language);
}

// Candidate 03's selected test-content eligibility, without semantic parsing.
function isKitJsonTestContentPath(filePath: string, qualifiedTsconfigContent: boolean): boolean {
  const segments = filePath.toLowerCase().split("/");
  const name = segments.pop()!;
  return name.endsWith(".json") && !["package.json", "package-lock.json", "npm-shrinkwrap.json", "jsconfig.json"].includes(name) &&
    (qualifiedTsconfigContent || name !== "tsconfig.json") &&
    !name.endsWith(".lock.json") && !segments.some((segment) =>
      ["generated", "vendor", "node_modules", "target", ".next", "dist", "build", "coverage", "playwright-report", "test-results", "output", "out", ".cache", ".turbo", ".vercel", ".git", ".pytest_cache", "__pycache__", ".venv", "venv", ".gradle"].includes(segment) || segment === ".my-dev-kit" || segment.startsWith(".my-dev-kit-")) &&
    segments.some((segment) => ["test", "tests", "__tests__", "fixtures"].includes(segment));
}

export async function collectKitSourceFacts(
  request: KitSourceFactsRequest,
  deps: KitSourceProviderDependencies = {}
): Promise<SourceFactsSnapshot> {
  const expectation = deps.expectation ?? QUALIFIED_PUBLISHED_KIT;
  const targetRoot = path.resolve(request.targetRoot);
  let readerIssued = false;
  const requiredSet = new Set(request.requiredPaths ?? request.inventory.files.filter(labRequiresKitFacts).map((entry) => entry.relativePath));
  if (request.predicateRequirements) {
    if (!request.requiredPaths || !request.capabilitiesForPath) fail("invalid-request", "Predicate acquisition requires explicit selected paths and per-path capabilities.");
    for (const filePath of requiredSet) {
      const scoped = request.predicateRequirements.filter(r => r.path === filePath);
      if (scoped.length === 0 || scoped.some(r => !KIT_SOURCE_EVIDENCE_REQUIREMENTS[r.detectorId] ||
          (r.applicability === "APPLICABLE_REQUIRED" && !KIT_SOURCE_EVIDENCE_REQUIREMENTS[r.detectorId]!.capabilities.includes(r.capability))) ||
          JSON.stringify([...request.capabilitiesForPath(filePath)].sort()) !== JSON.stringify(requiredKitCapabilitiesForPath(scoped, filePath))) {
        fail("invalid-request", `${filePath} lacks matching known detector predicate requirements.`);
      }
    }
  }
  // Only an explicit raw-only capability request can admit a generated/vendor source
  // category entry. Ordinary/default semantic collection still excludes it.
  const rawSourceFiles = request.inventory.files.filter((entry) => (entry.role === "generated" || entry.role === "vendor") &&
    SOURCE_LANGUAGES.has(entry.language) && requiredSet.has(entry.relativePath) &&
    request.capabilitiesForPath?.(entry.relativePath).length === 0);
  const rawConfigFiles = request.inventory.files.filter(entry => entry.role === "config" && entry.relativePath.endsWith(".gradle.kts") &&
    requiredSet.has(entry.relativePath) && request.capabilitiesForPath?.(entry.relativePath).length === 0);
  const rawSourcePaths = [...rawSourceFiles, ...rawConfigFiles].map((entry) => entry.relativePath);
  deps.receipt?.setStage("lab-required-source-scope");
  const scope = selectKitSourceRoots(targetRoot, request.inventory, [...requiredSet], rawSourcePaths,
    matchesExactKitExpectation(expectation, QUALIFIED_B3_P1_KIT));
  deps.receipt?.write("lab-required-source-scope", scope);
  if (!scope.complete) fail("selection-incomplete", `unresolved required paths: ${scope.unresolvedPaths.join(", ")}; excluded required paths: ${scope.excludedPaths.join(", ")}.`);
  const requiredEntries = request.inventory.files.filter((entry) => requiredSet.has(entry.relativePath));
  if (requiredEntries.length === 0) {
    // Nothing to ask Kit about: Lab's inventory has no source/test file in a
    // Kit-supported language. The package is not resolved and no index is
    // created; the snapshot says so explicitly instead of implying coverage.
    return {
      targetRoot,
      provider: "kit",
      files: [],
      filesByLanguage: zeroLanguageCounts(),
      filesByParseStatus: zeroStatusCounts(),
      analyzerDiagnostics: [],
      warnings: [
        "No Lab source/test file in a Kit-supported language requires Kit evidence; no Kit index was created.",
      ],
    };
  }

  // Evidence is required: verify the managed package before anything else. A
  // missing or wrong Kit is fatal.
  deps.receipt?.setStage("kit-package-qualification");
  const archive = deps.receipt && deps.qualifiedArchivePath && fs.existsSync(deps.qualifiedArchivePath)
    ? describeAuditFile(deps.qualifiedArchivePath) : null;
  deps.receipt?.write("kit-package-request", {
    expectation, installedPackageRoot: deps.installedPackageRoot ?? null,
    archivePath: deps.qualifiedArchivePath ?? null, observedArchive: archive,
  });
  const pkg = resolveInstalledKitPackage({ installedPackageRoot: deps.installedPackageRoot, expectation });
  if (pkg.cliSha256 === QUALIFIED_B3_P1_KIT.cliSha256 &&
      (!deps.installedPackageRoot || !deps.qualifiedArchivePath ||
      sha256Hex(readBoundedFile(deps.qualifiedArchivePath, 2 * 1024 * 1024, "package-identity", "Qualified Kit R3 archive")) !== QUALIFIED_B3_P1_KIT.archiveSha256))
    fail("package-identity", "Managed R3 requires the exact qualified local archive and an isolated installed package root.");


  deps.receipt?.write("kit-package", { ...pkg, expectation,
    archive });
  const sourceRoots = scope.sourceRoots;
  if (sourceRoots.length === 0) {
    fail(
      "selection-incomplete",
      `no eligible Kit source root exists, but ${requiredEntries.length} Lab source/test file(s) require Kit evidence.`
    );
  }

  const ownedWorkDir = deps.workDir === undefined && deps.receipt === undefined;
  const workDir = deps.receipt?.directory ?? deps.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "lab-kit-source-"));
  try {
    const evidence = await acquireKitSourceEvidence(
      {
        targetRoot,
        sourceRoots,
        selectFactPaths: (kitInventory) => {
          const requiredPaths = requiredEntries.map((entry) => entry.relativePath);
          const kitByPath = new Map(kitInventory.map((record) => [record.path, record]));
          deps.receipt?.write("kit-required-inclusion", requiredPaths.map(file => ({ file, selected: kitByPath.has(file) })));
          assertSelectionCoversRequired(kitInventory, requiredPaths);
          // A Lab inventory entry and the Kit record for the same path must
          // describe the same bytes; a size difference means the source
          // changed between Lab's scan and Kit's index.
          for (const entry of requiredEntries) {
            const record = kitByPath.get(entry.relativePath)!;
            if (record.sizeBytes !== entry.sizeBytes) {
              fail(
                "stale-evidence",
                `${entry.relativePath} is ${entry.sizeBytes} byte(s) in Lab's inventory but ${record.sizeBytes} in Kit's index.`
              );
            }
            if (!labRequiresKitFacts(entry) && !rawConfigFiles.includes(entry)) {
              assertRequiredCapabilities(record, request.capabilitiesForPath?.(record.path) ?? request.requiredCapabilities);
              if (rawSourcePaths.includes(entry.relativePath)) {
                assertKitNonSemanticRawContent(record, NON_SEMANTIC_RAW_CONTENT_PROFILES.has(pkg.cliSha256));
              } else {
                assertKitJsonRawContent(record, matchesExactKitExpectation(expectation, QUALIFIED_B3_P1_KIT) ||
                  JSON_RAW_CONTENT_PROFILES[pkg.cliSha256] === "selected-test-json-v1");
              }
            }
          }
          return requiredEntries.filter(entry => labRequiresKitFacts(entry) || rawConfigFiles.includes(entry)).map((entry) => entry.relativePath);
        },
        requiredCapabilities: (record) => request.capabilitiesForPath?.(record.path) ?? request.requiredCapabilities,
        allowPartialDeclarationsForPath: request.allowPartialDeclarationsForPath,
        deferPartialImports: request.deferPartialImports,
        predicateRequirements: request.predicateRequirements,
      },
      pkg,
      deps,
      expectation,
      workDir
    );
    const snapshot = adaptKitEvidenceToSourceFacts({
      evidence,
      inventory: request.inventory,
      targetRoot,
      requiredCapabilities: request.requiredCapabilities,
      capabilitiesForPath: request.capabilitiesForPath,
      deferPartialImports: request.deferPartialImports,
    });
    if (scope.widerSelection) snapshot.warnings.push("Required root-level source selected with --src .; only validated selected files provide source evidence.");
    if (request.onReader) {
      const reader = createKitSourceReader(evidence, { pkg, runCommand: deps.runCommand ?? runMeasuredCommand,
        workDir, logDir: path.join(workDir, "logs"), sequence: { next: 1_000_000 }, receipt: deps.receipt },
        () => { if (ownedWorkDir) fs.rmSync(workDir, { recursive: true, force: true }); }, request.inventory.testFiles, rawSourceFiles, request.inventory.files);
      request.onReader(reader);
      readerIssued = true;
    }
    return snapshot;
  } finally {
    if (ownedWorkDir && !readerIssued) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

function zeroLanguageCounts(): Record<NormalizedLanguage, number> {
  return Object.fromEntries(NORMALIZED_LANGUAGES.map((language) => [language, 0])) as Record<NormalizedLanguage, number>;
}

function zeroStatusCounts(): Record<SourceFactParseStatus, number> {
  return Object.fromEntries(SOURCE_FACT_PARSE_STATUSES.map((status) => [status, 0])) as Record<
    SourceFactParseStatus,
    number
  >;
}

// Explicit empty snapshot for runs whose selected detectors need no source
// evidence. It does not claim the target has no source files.
export function createNotCollectedSourceFacts(targetRoot: string): SourceFactsSnapshot {
  return {
    targetRoot: path.resolve(targetRoot),
    provider: "not-collected",
    files: [],
    filesByLanguage: zeroLanguageCounts(),
    filesByParseStatus: zeroStatusCounts(),
    analyzerDiagnostics: [],
    warnings: ["No selected detector requires source evidence; source facts were not collected."],
  };
}
