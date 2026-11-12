import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  // Programmatic installed-package root injection (still identity- and
  // containment-checked exactly like a resolved package).
  installedPackageRoot?: string;
  expectation?: KitCandidateExpectation;
  runCommand?: KitCommandRunner;
  // Task-owned working directory for the Kit index and command logs. When
  // omitted a fresh directory is created and removed after acquisition.
  workDir?: string;
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

type KitCommandKind = "index" | "lookup-audit-files" | "lookup-audit-file" | "source-occurrence" | "import-target";

type KitCommandContext = {
  pkg: InstalledKitPackage;
  runCommand: KitCommandRunner;
  workDir: string;
  logDir: string;
  sequence: { next: number };
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

async function runKitJson(ctx: KitCommandContext, kind: KitCommandKind, kitArgs: string[]): Promise<unknown> {
  const commandId = `kit-${String(ctx.sequence.next++).padStart(6, "0")}-${kind}`;
  let result: MeasuredCommandResult;
  try { result = await ctx.runCommand({
    commandId,
    executable: process.execPath,
    args: [ctx.pkg.cliPath, ...kitArgs],
    cwd: ctx.workDir,
    outDir: ctx.logDir,
    resolveCommand: false,
    timeoutMs: kind === "index" ? KIT_INDEX_TIMEOUT_MS : KIT_LOOKUP_TIMEOUT_MS,
    stdoutMaxBytes: KIT_STDOUT_MAX_BYTES,
    stderrMaxBytes: KIT_STDERR_MAX_BYTES,
    terminateProcessTree: true,
  }); } catch (error) {
    if (error instanceof KitSourceEvidenceAcquisitionError) throw error;
    fail("subprocess-failed", `Kit ${kind} executor failed: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  targetRoot: string;
  sourceRoots: readonly string[];
  // Chooses which inventoried files need exact-file facts. May throw a
  // KitSourceEvidenceAcquisitionError (for example, selection incomplete).
  selectFactPaths: (inventory: readonly KitFileRecord[]) => readonly string[];
  requiredCapabilities: (record: KitFileRecord) => KitRequiredCapabilities;
  allowPartialDeclarationsForPath?: (filePath: string) => boolean;
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
  };

  // 1. Index immediately before obtaining evidence, outside the target.
  const indexArgs = ["index", "--root", request.targetRoot];
  for (const root of request.sourceRoots) indexArgs.push("--src", root);
  indexArgs.push("--out", indexDir, "--json");
  const indexResult = await runKitJson(ctx, "index", indexArgs);
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
  const header = validateKitArtifact(artifactBytes, reference, {
    packageName: expectation.packageName,
    packageVersion: expectation.packageVersion,
    artifactSchemaVersion: expectation.artifactSchemaVersion,
  });
  if (normalizeRootForCompare(header.source.projectRoot) !== normalizeRootForCompare(request.targetRoot)) {
    fail("root-mismatch", `artifact projectRoot ${header.source.projectRoot} is not the requested target.`);
  }

  // 3. Complete inventory traversal.
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
  crossValidateInventory(header, inventory, inventoryPages, request.sourceRoots);

  // 4. Exact-file fact traversal for the files the caller needs.
  const factPaths = [...new Set([...request.selectFactPaths(inventory), ...(header.schemaVersion === "1.1.0" ? inventory.filter(file => /\.(java|kt)$/i.test(file.path)).map(file => file.path) : [])])].sort();
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
        if ((expectation.cliSha256 === QUALIFIED_KIT_CANDIDATE.cliSha256 || expectation.cliSha256 === QUALIFIED_PUBLISHED_KIT.cliSha256) &&
            request.allowPartialDeclarationsForPath?.(filePath)) {
          assertQualifiedPartialDeclarations(record, request.requiredCapabilities(record));
        } else assertRequiredCapabilities(record, request.requiredCapabilities(record));
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
  targetRoot: string;
  inventory: ProjectInventorySnapshot;
  // Capabilities required of every Lab source/test file Kit analyzes.
  requiredCapabilities: KitRequiredCapabilities;
  includeScriptsRoot: boolean;
  requiredPaths?: readonly string[];
  capabilitiesForPath?: (filePath: string) => KitRequiredCapabilities;
  allowPartialDeclarationsForPath?: (filePath: string) => boolean;
  onReader?: (reader: KitSourceReader) => void;
};

export type KitSourceReader = {
  jsTsRelativeImportCandidateProof?: "mjs-extensionless-complete-v1";
  jsonRawLiteralContent?: "selected-test-json-v1";
  snapshotId: string;
  producer: KitSourceEvidence["producer"];
  selectedFile: (filePath: string) => KitFileRecord;
  occurrences: (filePath: string, value: string) => Promise<KitOccurrence>;
  importTarget: (factId: string) => Promise<KitImportProof>;
  dispose: () => void;
};

// Private semantic compatibility profiles, independent of package/schema versions.
// Add future producer identities only after qualifying the same proof contract.
const IMPORT_PROOF_PROFILES: Readonly<Record<string, "mjs-extensionless-complete-v1">> = Object.freeze({
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
  "35dbc49fc91f8c47f1e7cdaf86223414a54517ff25a1a29f87231b2bae3807b8": "selected-test-json-v1",
  "ac66e5a4a06b48f7a7bbbf03734002bd6686cc6aa2343d097ff374f52fcb486f": "selected-test-json-v1",
  "9c4b4aa51e17d2a3a973cbc320fa45659bea79d831c046226e3adf4eb7717004": "selected-test-json-v1",
  "e10d0ec4274681743623a8aabee41d6a68cdb1caf86b14a16a4dafd802808635": "selected-test-json-v1",
});

// Candidate 04, Kit commit 9741b842d0efa6bf9276ff0c089e50eace3643b7,
// independently qualified selected generated and vendor raw occurrences without changing
// the public role schema or admitting generated semantic source facts.
const NON_SEMANTIC_RAW_CONTENT_PROFILES: ReadonlySet<string> = new Set([
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
  testFiles: ProjectInventorySnapshot["testFiles"], rawSourceFiles: ProjectInventorySnapshot["sourceFiles"]): KitSourceReader {
  const cache = new Map<string, Promise<KitOccurrence>>();
  const proofs = new Map<string, Promise<KitImportProof>>();
  const indexDir = path.join(ctx.workDir, "index");
  const jsonRawLiteralContent = JSON_RAW_CONTENT_PROFILES[ctx.pkg.cliSha256];
  const selectedFile = (filePath: string): KitFileRecord => {
    validateKitRelativePath(filePath, "required content file");
    const file = evidence.inventory.find((record) => record.path === filePath);
    if (!file) fail("selection-incomplete", `Required file ${filePath} is not validated selected evidence (missing coverage).`);
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
  let closed = false;
  return {
    snapshotId: evidence.snapshotId, producer: evidence.producer, dispose: () => { closed = true; dispose(); },
    jsTsRelativeImportCandidateProof: IMPORT_PROOF_PROFILES[ctx.pkg.cliSha256],
    jsonRawLiteralContent,
    selectedFile,
    occurrences(filePath, value) {
      if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
      validateKitRelativePath(filePath, "occurrence file");
      const file = selectedFile(filePath);
      if (!value || value.length > 4096 || /[\r\n]/.test(value)) fail("invalid-request", "An occurrence literal must be nonempty, bounded and single-line.");
      const key = JSON.stringify([evidence.snapshotId, filePath, value]);
      if (!cache.has(key)) cache.set(key, runKitJson(ctx, "source-occurrence", ["source", "--index", indexDir,
        "--file", filePath, "--contains", value, "--context", "40", "--json"])
        .then((raw) => {
          if ((raw as { schemaVersion?: unknown })?.schemaVersion !== evidence.artifactSchemaVersion) fail("schema-mismatch", "Occurrence schema differs from the validated artifact.");
          return validateKitOccurrence(raw, { snapshotId: evidence.snapshotId, file, value });
        }));
      return cache.get(key)!;
    },
    importTarget(factId) {
      if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
      const fact = [...evidence.fileEvidence.values()].flatMap((file) => file.facts).find((fact) => fact.id === factId && fact.kind === "import");
      if (!fact) fail("invalid-request", "Import fact ID is not in the validated fact pages.");
      if (!proofs.has(factId)) proofs.set(factId, runKitJson(ctx, "import-target", ["lookup", "--index", indexDir,
        "--audit-import-target", factId, "--json"]).then((raw) => validateKitImportProof(raw, { snapshotId: evidence.snapshotId, fact, evidence })));
      return proofs.get(factId)!;
    },
  };
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
  rawSourcePaths: readonly string[] = []
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
  const rawSources = new Set(inventory.sourceFiles.filter((entry) => (entry.role === "generated" || entry.role === "vendor") &&
    SOURCE_LANGUAGES.has(entry.language) && rawSourcePaths.includes(entry.relativePath)).map((entry) => entry.relativePath));
  for (const filePath of required) {
    validateKitRelativePath(filePath, "required Lab path");
    const entry = byPath.get(filePath);
    const rawJson = rawTests.has(filePath) && isKitJsonTestContentPath(filePath);
    const rawSource = (entry?.role === "generated" || entry?.role === "vendor") && rawSources.has(filePath);
    if (entry && !labRequiresKitFacts(entry) && !rawJson && !rawSource) { excludedPaths.push(filePath); continue; }
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
function isKitJsonTestContentPath(filePath: string): boolean {
  const segments = filePath.toLowerCase().split("/");
  const name = segments.pop()!;
  return name.endsWith(".json") && !["package.json", "package-lock.json", "npm-shrinkwrap.json", "tsconfig.json", "jsconfig.json"].includes(name) &&
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
  // Only an explicit raw-only capability request can admit a generated/vendor source
  // category entry. Ordinary/default semantic collection still excludes it.
  const rawSourceFiles = request.inventory.sourceFiles.filter((entry) => (entry.role === "generated" || entry.role === "vendor") &&
    SOURCE_LANGUAGES.has(entry.language) && requiredSet.has(entry.relativePath) &&
    request.capabilitiesForPath?.(entry.relativePath).length === 0);
  const rawSourcePaths = rawSourceFiles.map((entry) => entry.relativePath);
  const scope = selectKitSourceRoots(targetRoot, request.inventory, [...requiredSet], rawSourcePaths);
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
  const pkg = resolveInstalledKitPackage({ installedPackageRoot: deps.installedPackageRoot, expectation });

  const sourceRoots = scope.sourceRoots;
  if (sourceRoots.length === 0) {
    fail(
      "selection-incomplete",
      `no eligible Kit source root exists, but ${requiredEntries.length} Lab source/test file(s) require Kit evidence.`
    );
  }

  const ownedWorkDir = deps.workDir === undefined;
  const workDir = deps.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "lab-kit-source-"));
  try {
    const evidence = await acquireKitSourceEvidence(
      {
        targetRoot,
        sourceRoots,
        selectFactPaths: (kitInventory) => {
          const requiredPaths = requiredEntries.map((entry) => entry.relativePath);
          assertSelectionCoversRequired(kitInventory, requiredPaths);
          const kitByPath = new Map(kitInventory.map((record) => [record.path, record]));
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
            if (!labRequiresKitFacts(entry)) {
              assertRequiredCapabilities(record, request.capabilitiesForPath?.(record.path) ?? request.requiredCapabilities);
              if (rawSourcePaths.includes(entry.relativePath)) {
                assertKitNonSemanticRawContent(record, NON_SEMANTIC_RAW_CONTENT_PROFILES.has(pkg.cliSha256));
              } else {
                assertKitJsonRawContent(record, JSON_RAW_CONTENT_PROFILES[pkg.cliSha256] === "selected-test-json-v1");
              }
            }
          }
          return requiredEntries.filter(labRequiresKitFacts).map((entry) => entry.relativePath);
        },
        requiredCapabilities: (record) => request.capabilitiesForPath?.(record.path) ?? request.requiredCapabilities,
        allowPartialDeclarationsForPath: request.allowPartialDeclarationsForPath,
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
    });
    if (scope.widerSelection) snapshot.warnings.push("Required root-level source selected with --src .; only validated selected files provide source evidence.");
    if (request.onReader) {
      const reader = createKitSourceReader(evidence, { pkg, runCommand: deps.runCommand ?? runMeasuredCommand,
        workDir, logDir: path.join(workDir, "logs"), sequence: { next: 1_000_000 } },
        () => { if (ownedWorkDir) fs.rmSync(workDir, { recursive: true, force: true }); }, request.inventory.testFiles, rawSourceFiles);
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
