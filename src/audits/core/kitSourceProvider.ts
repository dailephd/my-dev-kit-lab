import { describeAuditFile, type AuditExecutionReceipt } from "./auditExecutionReceipt.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createKitBatchTransport, type KitBatchFamily, type KitBatchFallback, type KitBatchPacket, type KitBatchProcessResult, type KitBatchSelector } from "./kitBatchTransport.js";
import { createKitLaunchGuard, type KitLaunchEvent, type KitLaunchGuard } from "./kitLaunchGuard.js";
import { createKitStreamTransport, type KitStreamTransport, type KitStreamEvent } from "./kitStreamTransport.js";
import { createRequire } from "node:module";
import { runMeasuredCommand, type MeasuredCommandInteraction, type MeasuredCommandResult, type RunMeasuredCommandOptions } from "../../core/runMeasuredCommand.js";
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
  validateKitOrdinarySourceReference,
  validateKitTestModifierProof,
  isTestModifierSource,
  type KitSourceReferencePremise,
  hasImmediateRelativeSpelling,
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

export const QUALIFIED_B5_P1_R6_KIT = Object.freeze({
  ...QUALIFIED_B3_P1_KIT,
  cliSha256: "400c8f2fbaaf5fc1d6dd61ae5bd28a6e278e0e48152affb4594cb0911a7ce56a",
  sourceSha: "af036ae8f45ed7db6fdb85005ddbe95d0fc5ae33",
  archiveSha256: "8038c3f15e7786476be26837ad5533093884f82c7231c4f6e1eb4e0613ea8714",
  receiptSha256: "7490a50ff0b7e49c8a1e566304a0cee29eba6b839173ca66948b9f4526512748",
} satisfies typeof QUALIFIED_B3_P1_KIT);

export const QUALIFIED_B5_P1_R7A_KIT = Object.freeze({
  ...QUALIFIED_B5_P1_R6_KIT,
  cliSha256: "08bb696ceddc46533d2bd1f87939ff69460686bcb5e55d9c8bcd532ee1bbbf23",
  sourceSha: "0d642684600f82ffb3f5eebc42ae73e14a7d7d25",
  archiveSha256: "37fa4b66f236317c5630a9bd19ca2ddfe3620ff0368c622673884e157e7d9d6c",
  receiptSha256: "92ce73b9f24b6eba3d5e9bb62fdd050fc5f20123707008816cc7dd6b6341e8b5",
} satisfies typeof QUALIFIED_B5_P1_R6_KIT);

// Both archives ship the same executable and runtime package members.
const QUALIFIED_R3_ARCHIVES = [QUALIFIED_B3_P1_KIT, {
  sourceSha: "a24b0a56b003082ad5c39c9fcc693e1bc8ec7bbb",
  archiveSha256: "25fc1a97401d4e9b0fd22aa6f9d9829fba607265c63be17324960b4c13e0ff34",
  receiptSha256: "5227a69e4025b22fe421ddcc7f3b568933ace7858c189ee46607c3110207ddca",
}] as const;
// Qualified for the opt-in direct modifier predicate using the focused installed receipt.
const QUALIFIED_DIRECT_MODIFIER_KIT = Object.freeze({
  ...QUALIFIED_B5_P1_R7A_KIT,
  sourceSha: "5b4e6a783691f6b5e434ac1de6e83df8d9e43f85",
  cliSha256: "b93d72b0f030cc3f8175ecc490589b781ce7dcadf93e4180677faf72899f7697",
  archiveSha256: "f532f2e0bb6be9272e022927a87a77fc3032a1303c212cda21a0a0383e5e4026",
  receiptSha256: "853193f4cf862f85d33d6396c96b40fb41da2e71a82836baf57aebdb2578b893",
} satisfies typeof QUALIFIED_B5_P1_R7A_KIT);
// The registry package was authenticated against the tagged release and the
// direct-modifier development producer. Its CLI differs by release version.
export const QUALIFIED_CURRENT_PUBLISHED_KIT = Object.freeze({
  packageName: KIT_PACKAGE_NAME,
  packageVersion: "1.16.0",
  artifactSchemaVersion: QUALIFIED_DIRECT_MODIFIER_KIT.artifactSchemaVersion,
  extractorRevision: QUALIFIED_DIRECT_MODIFIER_KIT.extractorRevision,
  cliSha256: "2ac31eaec94f1a3d51dc87e425895571c809ece071282581b2f25b8df29a5302",
  sourceSha: "673a1580d8259639205eeae71048306396e0bf31",
  archiveSha256: "659981281e4bc47d4af24e91c822c3260b79342fc4d6b16e73cb22144e688ff1",
  archiveIntegrity: "sha512-bbVaTCK3y8yKw3Nh9UD6ohVTAwZ1+bzP9n+rznJ+/UDi9xyplQN8X4ciutevfYFVYdtJt/w4/F5TeEGg1tB+pw==",
  archiveUrl: "https://registry.npmjs.org/@dailephd/my-dev-kit/-/my-dev-kit-1.16.0.tgz",
} satisfies KitCandidateExpectation & Record<string, string>);

const QUALIFIED_FACTS02_A5_R1_KIT = Object.freeze({
  packageName: KIT_PACKAGE_NAME,
  packageVersion: "1.16.0",
  artifactSchemaVersion: "1.2.0",
  extractorRevision: "source-audit-v1.7.0",
  sourceSha: "a0ec1b4d2ecd28980668aed286ba6e1b72920c88",
  archiveSha256: "a00c857131c6cc6db77a7aeb0b1c6e4cd1c621f259aa91090fa39dc5fc2acded",
  archiveIntegrity: "sha512-D4fGOqIHuG574L8+FnOnsJpRvebaEzRWMZgSQN4K0PzPBvkOq/Kc9kfSg26ZwfrTBrNDkNL1BXYFmyhwAvXW3g==",
  cliSha256: "614532ba59ec3f3b2c96ea8a4288bb1b398385913510d723cd83441ce4d97c34",
  receiptSha256: "ee11bd25eff2d393dc7dee1f7ed8ef0da9f6409f6e64e8f57da07db182b0291e",
  capabilities: {
    ordinarySourceReference: true,
    expressionReference: true,
    testModifierProof: true,
    testModifierProofRequest: true,
  } as const,
} satisfies KitCandidateExpectation & Record<string, unknown>);

const QUALIFIED_BATCH_ARCHIVES = [QUALIFIED_B5_P1_R6_KIT, QUALIFIED_B5_P1_R7A_KIT, QUALIFIED_DIRECT_MODIFIER_KIT] as const;

export function resolveQualifiedKitArchive(
  qualifiedArchivePath: string,
  installedPackageRoot: string,
): KitSourceProviderDependencies {
  const digest = sha256Hex(readBoundedFile(qualifiedArchivePath, 2 * 1024 * 1024, "package-identity", "Qualified Kit archive"));
  const expectation = (digest === QUALIFIED_FACTS02_A5_R1_KIT.archiveSha256 ? QUALIFIED_FACTS02_A5_R1_KIT :
    QUALIFIED_BATCH_ARCHIVES.find(profile => profile.archiveSha256 === digest)) ??
    (QUALIFIED_R3_ARCHIVES.some(profile => profile.archiveSha256 === digest) ? QUALIFIED_B3_P1_KIT : undefined);
  if (!expectation) fail("package-identity", "Kit archive SHA-256 does not match a qualified local archive.");
  const installed = resolveInstalledKitPackage({ installedPackageRoot, expectation });
  if (expectation === QUALIFIED_FACTS02_A5_R1_KIT) authenticateFacts02Package(qualifiedArchivePath, installed);
  return { expectation, qualifiedArchivePath, installedPackageRoot };
}

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

function isProofProfile(expectation: KitCandidateExpectation): boolean {
  return matchesExactKitExpectation(expectation, QUALIFIED_FACTS02_A5_R1_KIT) ||
    matchesExactKitExpectation(expectation, QUALIFIED_CURRENT_PUBLISHED_KIT) ||
    matchesExactKitExpectation(expectation, QUALIFIED_B3_P1_KIT) || QUALIFIED_BATCH_ARCHIVES.some(profile => matchesExactKitExpectation(expectation, profile));
}

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
  // Independent contract fixtures use the injected command seam. Real
  // archives receive capabilities through the exact managed profile.
  testOnlyOrdinarySourceReference?: true;
  testOnlyExpressionReference?: true;
  testOnlyPlaywrightModifierProof?: true;
  testOnlyPlaywrightProofRequest?: true;
  launchGuard?: KitLaunchGuard;
  onKitLaunch?: (event: KitLaunchEvent) => void;
  // Exact R6 comparison lane. All other producer profiles remain standalone.
  disableBatch?: boolean;
  disableStream?: boolean;
  streamFrameLimit?: number;
  streamTimeoutMs?: number;
  onKitStream?: (event: KitStreamEvent) => void;
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

function authenticateFacts02Package(archivePath: string, installed: InstalledKitPackage): void {
  const profile = QUALIFIED_FACTS02_A5_R1_KIT;
  const campaign = path.dirname(path.dirname(path.resolve(archivePath)));
  const read = (filename: string, maxBytes: number, label: string) => {
    try {
      const physical = fs.realpathSync.native(filename);
      if (!isContained(campaign, physical) || path.relative(physical, filename) !== "") {
        fail("package-identity", `${label} lies outside the qualified package layout.`);
      }
    } catch (error) {
      if (error instanceof KitSourceEvidenceAcquisitionError) throw error;
      fail("package-identity", `${label} is missing or inaccessible.`);
    }
    return readBoundedFile(filename, maxBytes, "package-identity", label);
  };
  const receiptBytes = read(path.join(campaign, "validation", "qualification.json"), 64 * 1024, "Kit qualification receipt");
  if (sha256Hex(receiptBytes) !== profile.receiptSha256) {
    fail("package-identity", "Kit qualification receipt does not match the exact A5-R1 identity.");
  }
  // The receipt and the ledgers it pins are immutable inputs to this profile.
  const receipt = JSON.parse(receiptBytes.toString("utf8")) as {
    archivePath: string;
    archiveIntegrity: string;
    sourceCommit: string;
    installedPackageRoot: string;
    installedCliSha256: string;
    archiveMemberLedgerSha256: string;
    consumerLockSha256: string;
    consumerManifestSha256: string;
    runtimeDependencyIdentity: Record<string, { installedPackageJsonSha256: string }>;
  };
  if (path.relative(receipt.archivePath, path.resolve(archivePath)) !== "" ||
      path.relative(receipt.installedPackageRoot, installed.packageRoot) !== "" ||
      receipt.archiveIntegrity !== profile.archiveIntegrity || receipt.sourceCommit !== profile.sourceSha ||
      receipt.installedCliSha256 !== installed.cliSha256) {
    fail("package-identity", "Kit archive and installation do not match the A5-R1 receipt.");
  }
  const archive = read(path.resolve(archivePath), 2 * 1024 * 1024, "Qualified Kit archive");
  if (sha256Hex(archive) !== profile.archiveSha256) {
    fail("package-identity", "Kit archive bytes differ from the exact A5-R1 identity.");
  }
  const ledgerBytes = read(path.join(campaign, "validation", "archive-members.json"), 64 * 1024, "Kit archive member ledger");
  if (sha256Hex(ledgerBytes) !== receipt.archiveMemberLedgerSha256) {
    fail("package-identity", "Kit archive member ledger does not match the A5-R1 receipt.");
  }
  const ledger = JSON.parse(ledgerBytes.toString("utf8")) as {
    members: { path: string; size: number; sha256: string }[];
  };
  for (const member of ledger.members) {
    const bytes = read(path.join(installed.packageRoot, member.path), member.size, `Kit package member ${member.path}`);
    if (bytes.length !== member.size || sha256Hex(bytes) !== member.sha256) {
      fail("package-identity", `Kit package member ${member.path} does not match the qualified archive.`);
    }
  }
  const consumerRoot = path.join(campaign, "consumer");
  const lock = read(path.join(consumerRoot, "package-lock.json"), 64 * 1024, "Kit runtime lockfile");
  const manifest = read(path.join(consumerRoot, "package.json"), 64 * 1024, "Kit runtime manifest");
  if (sha256Hex(lock) !== receipt.consumerLockSha256 || sha256Hex(manifest) !== receipt.consumerManifestSha256) {
    fail("package-identity", "Kit runtime installation does not match the A5-R1 receipt.");
  }
  const resolve = createRequire(installed.cliPath);
  for (const [name, dependency] of Object.entries(receipt.runtimeDependencyIdentity)) {
    const root = path.join(consumerRoot, "node_modules", name);
    const metadata = read(path.join(root, "package.json"), 64 * 1024, `Kit runtime dependency ${name}`);
    let entry: string;
    try {
      entry = fs.realpathSync.native(resolve.resolve(name));
    } catch {
      fail("package-identity", `Kit runtime dependency ${name} cannot be resolved.`);
    }
    if (!isContained(root, entry) || sha256Hex(metadata) !== dependency.installedPackageJsonSha256) {
      fail("package-identity", `Kit runtime dependency ${name} does not match the A5-R1 receipt.`);
    }
  }
}

export function resolveInstalledKitPackage(
  options: { installedPackageRoot?: string; expectation?: KitCandidateExpectation } = {}
): InstalledKitPackage {
  const expectation = options.expectation ?? QUALIFIED_CURRENT_PUBLISHED_KIT;
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
  const managed = [QUALIFIED_FACTS02_A5_R1_KIT, ...QUALIFIED_BATCH_ARCHIVES].find(candidate => candidate.cliSha256 === cliSha256);
  if (managed && !matchesExactKitExpectation(expectation, managed)) {
    fail("package-identity", "Managed Kit requires its exact package, CLI, extractor and selection-schema profile.");
  }
  const published = cliSha256 === QUALIFIED_CURRENT_PUBLISHED_KIT.cliSha256;
  if (published) {
    if (expectation.extractorRevision !== QUALIFIED_CURRENT_PUBLISHED_KIT.extractorRevision)
      fail("extractor-mismatch", "Published Kit requires its exact qualified extractor revision.");
    if (expectation.artifactSchemaVersion !== QUALIFIED_CURRENT_PUBLISHED_KIT.artifactSchemaVersion)
      fail("schema-mismatch", "Published Kit requires its exact qualified selection schema.");
    if (!matchesExactKitExpectation(expectation, QUALIFIED_CURRENT_PUBLISHED_KIT))
      fail("package-identity", "Published Kit requires its exact qualified producer profile.");
  }
  const proofProfile = cliSha256 === QUALIFIED_B3_P1_KIT.cliSha256;
  if (expectation.artifactSchemaVersion === "1.2.0" && !proofProfile && !managed && !published) {
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

type KitQueryKind = "lookup-audit-files" | "lookup-audit-file" | "source-occurrence" | "source-range" | "import-target" | "import-domain" | "byte-occurrence";
type KitCommandKind = "lookup-stream" | "source-stream" | "lookup-batch" | "source-batch" | "index" | KitQueryKind;

type KitCommandContext = {
  pkg: InstalledKitPackage;
  runCommand: KitCommandRunner;
  workDir: string;
  logDir: string;
  sequence: { next: number; logical?: number };
  receipt?: AuditExecutionReceipt;
  guard?: KitLaunchGuard;
  onKitLaunch?: (event: KitLaunchEvent) => void;
  query?: ReturnType<typeof createKitBatchTransport>;
  stream?: KitStreamTransport;
  ordinarySourceReference?: true;
  expressionReference?: true;
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

async function executeKitCommand(ctx: KitCommandContext, kind: KitCommandKind, kitArgs: string[], stdoutMaxBytes: number,
  fallback?: KitBatchFallback, interaction?: MeasuredCommandInteraction, signal = ctx.guard?.signal): Promise<MeasuredCommandResult> {
  const commandId = `kit-${String(ctx.sequence.next++).padStart(6, "0")}-${kind}`;
  const attempt = ctx.guard?.attempt(commandId, kind, event => {
    const receiptEvent = fallback ? { ...event, fallback } : event;
    ctx.receipt?.write(commandId + "-launch-" + event.status, receiptEvent);
    ctx.onKitLaunch?.(receiptEvent);
  });
  const options: RunMeasuredCommandOptions = {
    commandId,
    executable: process.execPath,
    args: [ctx.pkg.cliPath, ...kitArgs],
    cwd: ctx.workDir,
    outDir: ctx.logDir,
    resolveCommand: false,
    timeoutMs: interaction ? 100 * 60_000 : kind === "index" ? KIT_INDEX_TIMEOUT_MS : KIT_LOOKUP_TIMEOUT_MS,
    stdoutMaxBytes,
    stderrMaxBytes: KIT_STDERR_MAX_BYTES,
    terminateProcessTree: true,
    interaction,
    ...(attempt && { signal, beforeSpawn: attempt.beforeSpawn, onSpawn: attempt.started }),
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
  }
  if (receipt || attempt) {
    options.onSettled = result => {
      attempt?.settled(result.exitCode, signal?.aborted === true);
      observedExit = result.exitCode;
      receipt?.write(commandId + "-exit", {
        exitCode: result.exitCode, signal: result.signal ?? null, ok: result.ok,
        startedAt: result.startedAt, endedAt: result.endedAt, timedOut: result.timedOut,
        outputLimit: result.outputLimit, processTreeCleanup: result.processTreeCleanup, error: result.error,
      });
    };
    receipt?.write(commandId + "-initial", { ...options, signal: undefined, interaction: interaction ? "framed" : undefined, args, telemetryArgs: undefined,
      exactArgv: secretIndex < 0, environment: { mode: "inherited", omitted: true, nodeOptionsPresent: process.env.NODE_OPTIONS !== undefined }, launcher: "node:child_process.spawn" });
  }
  let result: MeasuredCommandResult;
  try { result = await ctx.runCommand(options); } catch (error) {
    attempt?.settled(observedExit, signal?.aborted === true);
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
  attempt?.settled(result.exitCode, signal?.aborted === true);
  return result;
}

async function executeKitJson(ctx: KitCommandContext, kind: KitCommandKind, kitArgs: string[], stdoutMaxBytes: number,
  batch = false, fallback?: KitBatchFallback): Promise<unknown> {
  const result = await executeKitCommand(ctx, kind, kitArgs, stdoutMaxBytes, fallback);
  ctx.guard?.signal.throwIfAborted();
  if (result.timedOut) {
    fail("subprocess-timeout", `Kit ${kind} command timed out.`);
  }
  if (result.outputLimit) {
    fail(
      "output-limit",
      `Kit ${kind} command exceeded the ${result.outputLimit.limitBytes}-byte ${result.outputLimit.stream} limit; truncated output is not parsed.`
    );
  }
  if (batch && result.ok && result.exitCode !== 0) fail("subprocess-failed", "Kit batch success lacks numeric exit 0.");
  if (batch && !result.ok && result.exitCode === 2 && !result.error) {
    if (!result.stdout.trim() && /^AUDIT_BATCH_OUTPUT_LIMIT:/.test(result.stderr.trim())) return { exit: "producer-output-limit" };
    if (result.stdout.trim() && !result.stderr.trim()) {
      try { return { exit: 2, body: JSON.parse(result.stdout) }; }
      catch { fail("invalid-json", "Kit batch exited 2 with malformed JSON."); }
    }
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
    const body: unknown = JSON.parse(result.stdout);
    return batch ? { exit: 0, body } : body;
  } catch (error) {
    fail("invalid-json", `Kit ${kind} command exited 0 but stdout is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
}

function runKitQuery(ctx: KitCommandContext, indexDir: string, item: KitBatchSelector,
  stdoutMaxBytes = KIT_STDOUT_MAX_BYTES): Promise<unknown> {
  let family: KitBatchFamily = "lookup";
  let kind: KitQueryKind;
  let args: string[];
  switch (item.selector) {
    case "audit-files": kind = "lookup-audit-files"; args = ["--audit-files", "--page", String(item.page)]; break;
    case "audit-file":
      kind = "lookup-audit-file";
      args = ["--audit-file", item.path, "--page", String(item.page)];
      if (item.testModifierProof) args.push("--test-modifier-proof");
      break;
    case "audit-import-target": kind = "import-target"; args = ["--audit-import-target", item.factId]; break;
    case "audit-import-domain": kind = "import-domain"; args = ["--audit-import-domain", item.factId]; break;
    case "line-range":
      family = "source"; kind = "source-range";
      args = ["--file", item.path, "--start", String(item.start), "--end", String(item.end), "--max-lines", String(item.maxLines)];
      break;
    case "exact-file-occurrence":
      family = "source"; kind = "source-occurrence";
      args = ["--file", item.path, "--contains", item.literal, "--context", String(item.context)];
      break;
    case "exact-file-byte-occurrence":
      family = "source"; kind = "byte-occurrence"; args = ["--file", item.path, "--contains-bytes-hex", item.needleHex];
      break;
  }
  if (ctx.guard && ctx.receipt) {
    const logical = ctx.sequence.logical ?? ctx.sequence.next;
    ctx.sequence.logical = logical + 1;
    const request = ctx.receipt.journalEnabled
      ? { selector: item.selector, requestSha256: sha256Hex(Buffer.from(JSON.stringify(item))) }
      : undefined;
    ctx.receipt.write("kit-logical-" + String(logical), { kind, family }, request);
  }
  const standalone = (fallback?: KitBatchFallback) => executeKitJson(ctx, kind,
    [family, "--index", indexDir, ...args, "--json"], stdoutMaxBytes, false, fallback);
  if (ctx.stream && stdoutMaxBytes <= KIT_STDOUT_MAX_BYTES) return ctx.stream.query(family, item);
  return ctx.query && stdoutMaxBytes <= KIT_STDOUT_MAX_BYTES ? ctx.query(family, item, standalone) : standalone();
}

function configureKitBatch(ctx: KitCommandContext, deps: KitSourceProviderDependencies,
  identity: { snapshotId: string; selectionFingerprint: string }, indexDir: string): void {
  if (![QUALIFIED_B5_P1_R6_KIT.cliSha256, QUALIFIED_B5_P1_R7A_KIT.cliSha256, QUALIFIED_CURRENT_PUBLISHED_KIT.cliSha256, QUALIFIED_FACTS02_A5_R1_KIT.cliSha256].includes(ctx.pkg.cliSha256) || deps.disableBatch || !ctx.guard) return;
  const batchInput = fs.mkdtempSync(path.join(ctx.workDir, "kb-"));
  let next = 0;
  ctx.query = createKitBatchTransport({
    identity, signal: ctx.guard.signal,
    async execute(packet: KitBatchPacket): Promise<KitBatchProcessResult> {
      const id = String(++next);
      const input = path.join(batchInput, id + ".json");
      fs.writeFileSync(input, packet.bytes, { flag: "wx", mode: 0o600 });
      try {
        ctx.receipt?.write("kit-batch-" + path.basename(batchInput) + "-" + id, {
          family: packet.family, logicalRequests: packet.count, inputSha256: sha256Hex(packet.bytes), inputBytes: packet.bytes.length,
        });
        return await executeKitJson(ctx, packet.family === "lookup" ? "lookup-batch" : "source-batch",
          [packet.family, "--index", indexDir, "--audit-batch-file", input, "--json"], KIT_STDOUT_MAX_BYTES, true) as KitBatchProcessResult;
      } finally {
        fs.unlinkSync(input);
      }
    },
    itemError: code => new KitSourceEvidenceAcquisitionError(classifyStderrCode(code) ?? "subprocess-failed",
      "Kit batch item failed (exit 2).", code),
    fallback: (packet, count, reason) => {
      const inputSha256 = sha256Hex(packet.bytes);
      ctx.receipt?.write("kit-batch-fallback-" + inputSha256, { family: packet.family, inputSha256, standaloneAttemptsUpperBound: count, reason });
    },
  });
}

type KitStreamState = { current?: KitStreamTransport };

function configureKitTransport(ctx: KitCommandContext, deps: KitSourceProviderDependencies,
  identity: { snapshotId: string; selectionFingerprint: string }, indexDir: string, state?: KitStreamState): void {
  if (!state || !ctx.guard || deps.disableStream || ![QUALIFIED_B5_P1_R7A_KIT.cliSha256, QUALIFIED_CURRENT_PUBLISHED_KIT.cliSha256, QUALIFIED_FACTS02_A5_R1_KIT.cliSha256].includes(ctx.pkg.cliSha256)) {
    configureKitBatch(ctx, deps, identity, indexDir);
    return;
  }
  let eventId = 0;
  state.current ??= createKitStreamTransport({
    identity, signal: ctx.guard.signal, frameLimit: deps.streamFrameLimit, timeoutMs: deps.streamTimeoutMs,
    launch: (family, interaction, signal) => executeKitCommand(ctx, family === "lookup" ? "lookup-stream" : "source-stream",
      [family, "--index", path.resolve(indexDir), "--audit-stream", "--json"], KIT_STDOUT_MAX_BYTES, undefined, interaction, signal),
    itemError: code => new KitSourceEvidenceAcquisitionError(classifyStderrCode(code) ??
      (code === "AUDIT_BATCH_OUTPUT_LIMIT" ? "output-limit" : "subprocess-failed"), "Kit session item failed.", code),
    observe: event => {
      ctx.receipt?.write("kit-stream-" + String(++eventId), event);
      deps.onKitStream?.(event);
    },
  });
  ctx.stream = state.current;
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
  workDir: string,
  streamState?: KitStreamState,
): Promise<KitSourceEvidence> {
  const proofProfile = pkg.cliSha256 === expectation.cliSha256 && isProofProfile(expectation);
  const modifierProfile = playwrightModifierProfile(pkg, expectation, deps);
  const qualifiedTestModifierProof = modifierProfile !== undefined;
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
    receipt: deps.receipt, guard: deps.launchGuard, onKitLaunch: deps.onKitLaunch,
  };

  // 1. Index immediately before obtaining evidence, outside the target.
  const indexArgs = ["index", "--root", request.targetRoot];
  for (const root of request.sourceRoots) indexArgs.push("--src", root);
  if (proofProfile) indexArgs.push("--source-audit-schema", "1.2.0");
  indexArgs.push("--out", indexDir, "--json");
  deps.receipt?.setStage("kit-index");
  let indexResult: unknown;
  try {
    indexResult = await executeKitJson(ctx, "index", indexArgs, KIT_STDOUT_MAX_BYTES);
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
  configureKitTransport(ctx, deps, header.source, indexDir, streamState);
  const inventoryPages: KitInventoryPage[] = await collectAllPages(
    async (pageIndex) => {
      const raw = await runKitQuery(ctx, indexDir, { selector: "audit-files", page: pageIndex });
      if ((raw as { schemaVersion?: unknown })?.schemaVersion !== header.schemaVersion) fail("schema-mismatch", "Inventory page schema differs from the validated artifact.");
      if (qualifiedTestModifierProof && Object.hasOwn(raw as object, "testModifierProof")) {
        fail("page-invalid", "Test modifier proof is not permitted on an inventory page.");
      }
      return validateInventoryPage(raw, { snapshotId, pageIndex });
    },
    { maxPages: KIT_MAX_INVENTORY_PAGES, label: "inventory traversal", ...((ctx.query || ctx.stream) && { window: KIT_LOOKUP_CONCURRENCY }) }
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
        const inventoryRecord = recordByPath.get(filePath)!;
        const pages = await collectAllPages(
          async (pageIndex) => {
            const requestProof = modifierProfile === "negotiated" && pageIndex === 0 && isTestModifierSource(inventoryRecord);
            const item = { selector: "audit-file", path: filePath } as const;
            const raw = await runKitQuery(ctx, indexDir, requestProof
              ? { ...item, page: 0, testModifierProof: true } : { ...item, page: pageIndex });
            if ((raw as { schemaVersion?: unknown })?.schemaVersion !== header.schemaVersion) fail("schema-mismatch", "Fact page schema differs from the validated artifact.");
            if (modifierProfile === "negotiated" && !requestProof && Object.hasOwn(raw as object, "testModifierProof")) {
              fail("page-invalid", "The exact-file request did not negotiate test modifier proof.");
            }
            return validateFactPage(raw, { snapshotId, pageIndex, path: filePath,
              qualifiedTestModifierProof: qualifiedTestModifierProof ? true : undefined });
          },
          { maxPages: KIT_MAX_FACT_PAGES_PER_FILE, label: `fact traversal of ${filePath}` }
        );
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

  const evidence: KitSourceEvidence = {
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
  if (qualifiedTestModifierProof) {
    const selectedDomainDigest = sha256Hex(JSON.stringify([...recordByPath.keys()].sort()));
    for (const [index, filePath] of factPaths.entries()) {
      const raw = outcomes[index]!.pages![0]!.testModifierProof;
      if (!raw) continue;
      const root = fs.realpathSync.native(evidence.source.projectRoot);
      const origin = fileEvidence.get(filePath)!;
      const proof = validateKitTestModifierProof(raw, origin, evidence, recordByPath, selectedDomainDigest,
        record => readFreshModifierSource(root, record));
      if (proof.runnerBinding.wrapper) {
        assertSourceReferencePremises(root, proof.runnerBinding.wrapper.reference.premiseRefs, recordByPath);
      }
      origin.testModifierProof = proof;
    }
  }
  return evidence;
}

function hasReferenceFixtureLane(deps: KitSourceProviderDependencies, schemaVersion: string): boolean {
  return !!(deps.disableStream && deps.runCommand && deps.installedPackageRoot && deps.expectation &&
    !deps.qualifiedArchivePath && schemaVersion === "1.2.0");
}

function playwrightModifierProfile(
  pkg: InstalledKitPackage, expectation: KitCandidateExpectation, deps: KitSourceProviderDependencies,
): "passive" | "negotiated" | undefined {
  const exact = QUALIFIED_FACTS02_A5_R1_KIT;
  if (pkg.cliSha256 === exact.cliSha256 && matchesExactKitExpectation(expectation, exact) &&
      deps.qualifiedArchivePath && exact.capabilities.testModifierProof && exact.capabilities.testModifierProofRequest) {
    return "negotiated";
  }
  if (deps.testOnlyPlaywrightModifierProof !== true || !deps.runCommand || !deps.installedPackageRoot ||
      !deps.expectation || deps.qualifiedArchivePath || expectation.artifactSchemaVersion !== "1.2.0" ||
      pkg.cliSha256 !== expectation.cliSha256 || !isProofProfile(expectation)) return undefined;
  if (deps.testOnlyPlaywrightProofRequest === true) return "negotiated";
  if (deps.disableStream) return "passive";
  return undefined;
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
  // Internal focused replay of an independently frozen whole-project selection.
  expectedWholeProjectSnapshot?: string;
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
  explicitImportsCompleteWithExpressions?: (filePath: string, explicitImportCount: number) => boolean;
  expressionDomains?: (filePath: string) => Promise<readonly { linkedImportFactId?: string; proof: KitImportDomain }[]>;
  byteOccurrences?: (filePath: string, needleHex: string) => Promise<KitByteOccurrence>;
  ambientClassification?: (filePath: string) => KitAmbientClassification | undefined;
  ordinarySourceReference?: true;
  /** The exact computed-reference extension is qualified for this reader. */
  expressionReference?: true;
  testModifierProof?: (filePath: string) => KitFileEvidence["testModifierProof"];
  importTarget: (factId: string) => Promise<KitImportProof & {
    exactSelectedPath?: string;
    qualifiedSourceReferencePath?: string;
    selectedTargetUpperBound?: readonly string[];
    ordinarySourceReferenceReason?: string | null;
    applicableSourceReferenceAbsent?: true;
  }>;
  dispose: () => void | Promise<void>;
};

// Private semantic compatibility profiles, independent of package/schema versions.
// Add future producer identities only after qualifying the same proof contract.
const IMPORT_PROOF_PROFILES: Readonly<Record<string, "mjs-extensionless-complete-v1">> = Object.freeze({
  [QUALIFIED_CURRENT_PUBLISHED_KIT.cliSha256]: "mjs-extensionless-complete-v1",
  [QUALIFIED_DIRECT_MODIFIER_KIT.cliSha256]: "mjs-extensionless-complete-v1",
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
  QUALIFIED_CURRENT_PUBLISHED_KIT.cliSha256,
  QUALIFIED_DIRECT_MODIFIER_KIT.cliSha256,
  QUALIFIED_FACTS02_A5_R1_KIT.cliSha256,
  // The exact R3 CLI also returns complete, hash-bound text occurrences
  // for selected generated and vendor source without admitting semantic facts.
  QUALIFIED_B3_P1_KIT.cliSha256,
  QUALIFIED_B5_P1_R6_KIT.cliSha256,
  QUALIFIED_B5_P1_R7A_KIT.cliSha256,
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

function assertCanonicalReferenceOrigin(root: string, originFile: string): void {
  const origin = path.resolve(root, originFile);
  if (fs.realpathSync.native(origin) !== origin) fail("stale-evidence", "Source reference origin identity changed.");
}

function readFreshProofSource(root: string, file: KitFileRecord): Buffer {
  const target = fs.realpathSync(path.resolve(root, file.path));
  if (!isContained(root, target) || !file.contentSha256) fail("stale-evidence", "Required proof file lacks contained hashed bytes.");
  const bytes = readBoundedFile(target, file.sizeBytes, "stale-evidence", "Proof source");
  if (bytes.length !== file.sizeBytes || sha256Hex(bytes) !== file.contentSha256) fail("stale-evidence", "Proof source bytes changed.");
  return bytes;
}

function readFreshModifierSource(root: string, file: KitFileRecord): Buffer {
  try {
    assertCanonicalReferenceOrigin(root, file.path);
    return readFreshProofSource(root, file);
  } catch (error) {
    if (error instanceof KitSourceEvidenceAcquisitionError) throw error;
    fail("stale-evidence", "Test modifier proof source cannot be inspected: " + file.path);
  }
}

function assertSourceReferencePremises(
  root: string, premises: readonly KitSourceReferencePremise[], inventory: ReadonlyMap<string, KitFileRecord>,
): void {
  for (const premise of premises) {
    let state: KitSourceReferencePremise["state"] = "directory";
    const segments = premise.path.split("/");
    let current = root;
    for (const segment of segments) {
      if (state !== "directory") {
        state = "absent";
        break;
      }
      current = path.join(current, segment);
      try {
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink() || fs.realpathSync.native(current) !== current) {
          fail("stale-evidence", "Source reference premise no longer has a canonical contained path.");
        }
        if (stat.isFile()) state = "file";
        else if (!stat.isDirectory()) fail("stale-evidence", "Source reference premise has an unsupported file type.");
      } catch (error) {
        if (error instanceof KitSourceEvidenceAcquisitionError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          fail("stale-evidence", "Source reference premise cannot be inspected.");
        }
        state = "absent";
        break;
      }
    }
    if (state !== premise.state) fail("stale-evidence", "Source reference premise state changed: " + premise.path);
    if (state === "file") {
      const size = Math.min(inventory.get(premise.path)?.sizeBytes ?? KIT_MANIFEST_MAX_BYTES, KIT_MANIFEST_MAX_BYTES);
      const bytes = readBoundedFile(current, size, "stale-evidence", "Source reference premise");
      if (sha256Hex(bytes) !== premise.contentSha256) {
        fail("stale-evidence", "Source reference premise content changed: " + premise.path);
      }
    }
  }
}

function createKitSourceReader(evidence: KitSourceEvidence, ctx: KitCommandContext, dispose: () => void | Promise<void>,
  testFiles: ProjectInventorySnapshot["testFiles"], rawSourceFiles: ProjectInventorySnapshot["sourceFiles"],
  inventoryFiles: ProjectInventorySnapshot["files"], qualifiedTestModifierProof: boolean): KitSourceReader {
  const cache = new Map<string, Promise<KitOccurrence>>();
  // A fresh stream frame is required for repeated predicates, especially
  // import absence, which can change while the origin SHA stays identical.
  function query<T>(store: Map<string, Promise<T>>, key: string, fetch: () => Promise<T>): Promise<T> {
    if (ctx.stream) return fetch();
    if (!store.has(key)) store.set(key, fetch());
    return store.get(key)!;
  }
  const proofs = new Map<string, Promise<{
    proof: KitImportProof;
    reference?: ReturnType<typeof validateKitOrdinarySourceReference>;
  }>>();
  const contents = new Map<string, Promise<string>>();
  const rawTestContents = new Map<string, string | undefined>();
  const testFileByPath = new Map(testFiles.map(file => [file.relativePath, file]));
  const r3 = (ctx.pkg.cliSha256 === QUALIFIED_B3_P1_KIT.cliSha256 ||
    ctx.pkg.cliSha256 === QUALIFIED_CURRENT_PUBLISHED_KIT.cliSha256 ||
    ctx.pkg.cliSha256 === QUALIFIED_FACTS02_A5_R1_KIT.cliSha256 ||
    QUALIFIED_BATCH_ARCHIVES.some(profile => profile.cliSha256 === ctx.pkg.cliSha256)) &&
    evidence.artifactSchemaVersion === "1.2.0";
  const domainPromises = new Map<string, Promise<ReturnType<typeof validateKitImportDomain>>>();
  const inventoryByPath = new Map(evidence.inventory.map(record => [record.path, record]));
  const assertFresh = (file: KitFileRecord) => readFreshProofSource(fs.realpathSync(evidence.source.projectRoot), file);
  const indexDir = path.join(ctx.workDir, "index");
  const jsonRawLiteralContent = r3 ? "selected-test-json-v1" : JSON_RAW_CONTENT_PROFILES[ctx.pkg.cliSha256];
  const p6R2 = ctx.pkg.cliSha256 === QUALIFIED_SW123_P6_R2_KIT.cliSha256 &&
    ctx.pkg.packageName === QUALIFIED_SW123_P6_R2_KIT.packageName &&
    ctx.pkg.packageVersion === QUALIFIED_SW123_P6_R2_KIT.packageVersion &&
    evidence.artifactSchemaVersion === QUALIFIED_SW123_P6_R2_KIT.artifactSchemaVersion &&
    evidence.extractorRevision === QUALIFIED_SW123_P6_R2_KIT.extractorRevision;
  const importsById = new Map([...evidence.fileEvidence.values()].flatMap(({ record, facts }) =>
    facts.filter(fact => fact.kind === "import" || (r3 || p6R2) && fact.kind === "export" &&
      fact.exportOrigin === "re-export" && !!fact.sourceSpecifier &&
      (record.language === "javascript" || record.language === "typescript"))
      .map(fact => [fact.id, { fact, record }] as const)));
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
    if (ctx.stream && fixtureOnly) contents.delete(filePath);
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
        const raw = await runKitQuery(ctx, indexDir, { selector: "line-range", path: filePath, start, end, maxLines: 160 });
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
    snapshotId: evidence.snapshotId, producer: evidence.producer, dispose: () => { closed = true; contents.clear(); rawTestContents.clear(); return dispose(); },
    jsTsRelativeImportCandidateProof: IMPORT_PROOF_PROFILES[ctx.pkg.cliSha256],
    jsonRawLiteralContent,
    selectedFile,
    reExportSpecifiers: filePath => reExportTargets(filePath).map(fact => fact.sourceSpecifier),
    ordinarySourceReference: ctx.ordinarySourceReference,
    expressionReference: ctx.expressionReference,
    testModifierProof: qualifiedTestModifierProof ? filePath => {
      if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
      validateKitRelativePath(filePath, "test modifier proof file");
      const origin = evidence.fileEvidence.get(filePath);
      if (!origin?.testModifierProof) return undefined;
      const root = fs.realpathSync.native(evidence.source.projectRoot);
      readFreshModifierSource(root, origin.record);
      const wrapper = origin.testModifierProof.runnerBinding.wrapper;
      if (wrapper) {
        readFreshModifierSource(root, inventoryByPath.get(wrapper.path)!);
        assertSourceReferencePremises(root, wrapper.reference.premiseRefs, inventoryByPath);
      }
      return origin.testModifierProof;
    } : undefined,
    reExportTargets: r3 || p6R2 ? reExportTargets : undefined,
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
        text = await (ctx.stream ? readAuthenticatedContent(filePath, true) : content);
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
      explicitImportsCompleteWithExpressions(filePath: string, explicitImportCount: number) {
        if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
        const entry = evidence.fileEvidence.get(filePath);
        if (!entry || !evidence.traversalComplete || !evidence.coverage.inventoryComplete ||
            !evidence.coverage.exclusionsAreExplicit || entry.record.capabilities.imports !== "partial" ||
            entry.record.capabilities["dynamic-import-expressions"] !== "complete" ||
            entry.facts.filter(fact => fact.kind === "import").length !== explicitImportCount) return false;
        const diagnostics = entry.record.diagnostics ?? [];
        if (diagnostics.some(diagnostic => /truncat|dropped|unsupported-require|unsupported-import-specifier/.test(diagnostic.code))) return false;
        const missingCalls = diagnostics.filter(diagnostic => diagnostic.code === "unsupported-dynamic-import");
        const computedCalls = entry.facts.filter(fact =>
          fact.kind === "dynamic-import-expression" && !fact.dynamicImport?.literalImportFactId);
        // The exact producer reports each unsupported import call at its
        // expression start. The complete expression inventory accounts for
        // these partial ordinary imports.
        return missingCalls.length > 0 && missingCalls.every(({ start }) => !!start &&
          computedCalls.some(fact => start.line === fact.span.startLine && start.column === fact.span.startColumn));
      },
      async expressionDomains(filePath: string) {
        if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
        const entry = evidence.fileEvidence.get(filePath);
        if (!entry) fail("selection-incomplete", "Domain origin is outside authenticated fact pages.");
        assertFresh(entry.record);
        const proofs = [];
        for (const fact of entry.facts.filter(fact => fact.kind === "dynamic-import-expression")) {
          const { expressionReferencePremises, ...proof } = await query(domainPromises, fact.id, () => runKitQuery(ctx, indexDir,
            { selector: "audit-import-domain", factId: fact.id }).then(raw =>
              validateKitImportDomain(raw, evidence, fact, ctx.expressionReference)));
          assertFresh(entry.record);
          if (expressionReferencePremises) {
            if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
            const root = fs.realpathSync.native(evidence.source.projectRoot);
            assertCanonicalReferenceOrigin(root, entry.record.path);
            assertSourceReferencePremises(root, expressionReferencePremises, inventoryByPath);
          }
          for (const target of proof.selectedTargetUpperBound ?? proof.positivePaths) {
            assertFresh(inventoryByPath.get(target)!);
          }
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
        const raw = await runKitQuery(ctx, indexDir, { selector: "exact-file-byte-occurrence", path: filePath, needleHex });
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
      return query(cache, key, () => runKitQuery(ctx, indexDir, { selector: "exact-file-occurrence", path: filePath, literal: value, context: 40 }, outputBudget)
        .then((raw) => {
          if ((raw as { schemaVersion?: unknown })?.schemaVersion !== (r3 ? "1.1.0" : evidence.artifactSchemaVersion)) fail("schema-mismatch", "Occurrence schema differs from the validated artifact.");
          return validateKitOccurrence(raw, { snapshotId: evidence.snapshotId, file, value, rawOnlyTextUnavailable: r3 && file.status === "unsupported" });
        }));
    },
    async importTarget(factId) {
      if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
      const entry = importsById.get(factId);
      if (!entry) fail("invalid-request", "Import fact ID is not in the validated fact pages.");
      const { fact, record } = entry;
      const fetchProof = async () => {
        const raw = await runKitQuery(ctx, indexDir, { selector: "audit-import-target", factId });
        const proof = validateKitImportProof(raw, { snapshotId: evidence.snapshotId, fact, evidence });
        const extension = (raw as { sourceReferenceProof?: unknown }).sourceReferenceProof;
        const reference = ctx.ordinarySourceReference && extension !== undefined
          ? validateKitOrdinarySourceReference(extension, proof, evidence, fact) : undefined;
        return { proof, reference };
      };
      // Extension premises are rechecked on every use of the memoized response.
      // The legacy stream continues to refresh its independent absence claims.
      const { proof, reference } = await query(proofs, factId, fetchProof);
      if (reference) {
        if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
        const root = fs.realpathSync.native(evidence.source.projectRoot);
        assertCanonicalReferenceOrigin(root, record.path);
        assertFresh(record);
        assertSourceReferencePremises(root, reference.premiseRefs, inventoryByPath);
      }
      const projection = {
        qualifiedSourceReferencePath: reference?.qualifiedSourceReferencePath,
        selectedTargetUpperBound: reference?.selectedTargetUpperBound,
        ordinarySourceReferenceReason: reference?.reasonCode,
        applicableSourceReferenceAbsent: reference?.applicableSourceReferenceAbsent,
        exactSelectedPath: undefined,
      };
      if (r3 && (record.language === "javascript" || record.language === "typescript")) {
        if (closed) fail("invalid-request", "The per-audit Kit reader is closed.");
        assertFresh(record);
        if (proof.selectionComplete !== (evidence.coverage.inventoryComplete && evidence.coverage.exclusionsAreExplicit)) {
          fail("artifact-invalid", "Import-target proof contradicts the selected inventory completeness.");
        }
        if (proof.status === "present") {
          const reason = proof.candidatePaths.length === 1 ? "TARGET_IN_SELECTED_INVENTORY" : "MULTIPLE_TARGETS_IN_SELECTED_INVENTORY";
          if (proof.candidatePaths.length === 0 || proof.reasonCode !== reason) fail("artifact-invalid", "Invalid selected import-target witness.");
          for (const candidate of proof.candidatePaths) {
            const target = inventoryByPath.get(candidate);
            if (!target) fail("artifact-invalid", "Import-target witness is outside selected inventory.");
            assertFresh(target);
          }
          const selected = proof.candidatePaths[0]!;
          const specifier = proof.sourceSpecifier;
          const root = fs.realpathSync(evidence.source.projectRoot);
          const isCanonical = (file: string) =>
            path.relative(root, fs.realpathSync(path.resolve(root, file))).split(path.sep).join("/") === file;
          // The ordinary lookup can return implementation-extension alternatives
          // or configured candidates. Admit only a literal immediate path shared
          // by ordinary relative ESM and CommonJS resolution.
          if (proof.candidatePaths.length === 1 && hasImmediateRelativeSpelling(record.path, specifier, selected) &&
              isCanonical(record.path) && isCanonical(selected)) {
            if (reference?.selectedTargetUpperBound && !reference.selectedTargetUpperBound.includes(selected)) {
              fail("artifact-invalid", "Qualified exact path contradicts the ordinary source reference domain.");
            }
            return { ...proof, ...projection, exactSelectedPath: selected };
          }
        } else if (proof.status === "proven-missing" &&
            (proof.reasonCode !== "ALL_CANDIDATES_ABSENT_IN_COMPLETE_SELECTION" ||
            proof.candidatePaths.some(candidate => inventoryByPath.has(candidate)))) {
          fail("artifact-invalid", "Import-target exclusion contradicts the selected inventory.");
        }
      }
      return { ...proof, ...projection };
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
  const expectation = deps.expectation ?? QUALIFIED_CURRENT_PUBLISHED_KIT;
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
    isProofProfile(expectation));
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
  const managed = [QUALIFIED_FACTS02_A5_R1_KIT, ...QUALIFIED_BATCH_ARCHIVES].find(candidate => candidate.cliSha256 === pkg.cliSha256);
  const facts02 = managed === QUALIFIED_FACTS02_A5_R1_KIT ? QUALIFIED_FACTS02_A5_R1_KIT.capabilities : undefined;
  if (managed) {
    if (!deps.installedPackageRoot || !deps.qualifiedArchivePath ||
        sha256Hex(readBoundedFile(deps.qualifiedArchivePath, 2 * 1024 * 1024, "package-identity", "Qualified Kit archive")) !== managed.archiveSha256) {
      fail("package-identity", "Managed Kit requires the exact qualified local archive and installed package root.");
    }
    if (facts02) authenticateFacts02Package(deps.qualifiedArchivePath, pkg);
    if (!deps.workDir && !deps.receipt) fail("invalid-request", "Managed Kit requires a task-owned work directory or audit receipt.");
    deps = { ...deps, launchGuard: deps.launchGuard ?? createKitLaunchGuard() };
  }
  if (pkg.cliSha256 === QUALIFIED_CURRENT_PUBLISHED_KIT.cliSha256) {
    deps = { ...deps, launchGuard: deps.launchGuard ?? createKitLaunchGuard() };
  }
  let qualifiedR3Archive: (typeof QUALIFIED_R3_ARCHIVES)[number] | undefined;
  if (pkg.cliSha256 === QUALIFIED_B3_P1_KIT.cliSha256) {
    if (!deps.installedPackageRoot || !deps.qualifiedArchivePath)
      fail("package-identity", "Managed R3 requires an exact qualified local archive and an isolated installed package root.");
    const archiveSha256 = sha256Hex(
      readBoundedFile(deps.qualifiedArchivePath, 2 * 1024 * 1024, "package-identity", "Qualified Kit R3 archive"));
    qualifiedR3Archive = QUALIFIED_R3_ARCHIVES.find(profile => profile.archiveSha256 === archiveSha256);
    if (!qualifiedR3Archive)
      fail("package-identity", "Managed R3 requires an exact qualified local archive and an isolated installed package root.");
  }

  deps.receipt?.write("kit-package", {
    ...pkg, expectation, archive,
    ...(qualifiedR3Archive && { qualifiedR3Archive }),
    ...(managed && { qualifiedBatchArchive: managed }),
  });
  const expectedSnapshot = request.expectedWholeProjectSnapshot;
  if (expectedSnapshot !== undefined && !/^[a-f0-9]{64}$/.test(expectedSnapshot))
    fail("invalid-request", "Expected a full whole-project Kit snapshot digest.");
  const sourceRoots = expectedSnapshot === undefined ? scope.sourceRoots : ["."];
  if (sourceRoots.length === 0) {
    fail(
      "selection-incomplete",
      `no eligible Kit source root exists, but ${requiredEntries.length} Lab source/test file(s) require Kit evidence.`
    );
  }

  const ownedWorkDir = deps.workDir === undefined && deps.receipt === undefined;
  const workDir = deps.receipt?.directory ?? deps.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "lab-kit-source-"));
  const streamState: KitStreamState = {};
  const close = () => {
    if (streamState.current) return streamState.current.close().finally(() => deps.launchGuard?.close());
    deps.launchGuard?.close();
  };
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
                assertKitJsonRawContent(record, isProofProfile(expectation) ||
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
      workDir,
      streamState,
    );
    if (expectedSnapshot !== undefined && evidence.snapshotId !== expectedSnapshot)
      fail("stale-evidence", "The acquired whole-project Kit snapshot differs from the frozen replay snapshot.");
    const snapshot = adaptKitEvidenceToSourceFacts({
      qualifiedDirectModifiers: [QUALIFIED_DIRECT_MODIFIER_KIT, QUALIFIED_CURRENT_PUBLISHED_KIT, QUALIFIED_FACTS02_A5_R1_KIT].some(profile =>
        pkg.cliSha256 === profile.cliSha256 && matchesExactKitExpectation(expectation, profile)),
      evidence,
      inventory: request.inventory,
      targetRoot,
      requiredCapabilities: request.requiredCapabilities,
      capabilitiesForPath: request.capabilitiesForPath,
      deferPartialImports: request.deferPartialImports,
    });
    if (scope.widerSelection) snapshot.warnings.push("Required root-level source selected with --src .; only validated selected files provide source evidence.");
    if (request.onReader) {
      const fixtureExtensionLane = hasReferenceFixtureLane(deps, evidence.artifactSchemaVersion);
      const context: KitCommandContext = { pkg, runCommand: deps.runCommand ?? runMeasuredCommand,
        workDir, logDir: path.join(workDir, "logs"), sequence: { next: 1_000_000 }, receipt: deps.receipt,
        guard: deps.launchGuard, onKitLaunch: deps.onKitLaunch,
        ordinarySourceReference: facts02?.ordinarySourceReference ?? (fixtureExtensionLane ? deps.testOnlyOrdinarySourceReference : undefined),
        expressionReference: facts02?.expressionReference ?? (fixtureExtensionLane ? deps.testOnlyExpressionReference : undefined) };
      configureKitTransport(context, deps, evidence.source, path.join(workDir, "index"), streamState);
      const reader = createKitSourceReader(evidence, context, async () => {
        await close();
        if (ownedWorkDir) fs.rmSync(workDir, { recursive: true, force: true });
      }, request.inventory.testFiles, rawSourceFiles, request.inventory.files,
      playwrightModifierProfile(pkg, expectation, deps) !== undefined);
      request.onReader(reader);
      readerIssued = true;
    }
    return snapshot;
  } finally {
    if (!readerIssued) await close();
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
