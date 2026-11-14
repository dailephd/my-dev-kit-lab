import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { DEFAULT_AUDIT_REGISTRY, NON_SOURCE_DETECTOR_IDS } from "../../src/audits/core/auditRegistry.js";
import { runAudit, type AuditResult, type AuditSourceProviderMode } from "../../src/audits/core/auditRunner.js";
import { collectKitSourceFacts, type KitCandidateExpectation, type KitCommandRunner } from "../../src/audits/core/kitSourceProvider.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import { assertRequiredCapabilities, validateKitFileRecord, type KitFileRecord } from "../../src/audits/core/kitSourceEvidence.js";
import { runMeasuredCommand } from "../../src/core/runMeasuredCommand.js";

// Gate 4 uses the production runner and frozen registry. No detector is replaced.
// Raw findings, producer facts and semantic projections are deliberately separate.
const root = path.resolve(".");
const workflowRoot = path.join(root, ".my-dev-kit-workflow/tmp/v010-lab-kit-gate4");
// The launcher authorizes a run by configuring its existing local temp directory
// before Node starts. A requested comparison path cannot authorize another run.
function canonicalDirectory(directory: string) {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory) throw new Error("Noncanonical absolute directory");
  const relative = path.relative(root, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Directory outside Lab");
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Symlink or junction in output path");
  }
  if (path.relative(fs.realpathSync(root), fs.realpathSync(directory)).startsWith("..")) throw new Error("Real path outside Lab");
  return directory;
}
function approvedRunRoot(binding = process.env.LAB_KIT_DIFFERENTIAL_TEST_ROOT) {
  const temp = process.env.TEMP;
  if (process.env.TSX_DISABLE_CACHE !== "1" || !temp || process.env.TMP !== temp || process.env.TMPDIR !== temp) throw new Error("Configure TSX_DISABLE_CACHE and TEMP/TMP/TMPDIR in the parent process");
  canonicalDirectory(temp);
  if (!binding) throw new Error("Set LAB_KIT_DIFFERENTIAL_TEST_ROOT to an authorized task-owned test runtime");
  const run = canonicalDirectory(binding);
  for (const frozenRoot of [workflowRoot, path.join(root, ".my-dev-kit-workflow/tmp/v010-lab-kit-gate5")]) {
    const relative = path.relative(frozenRoot, run);
    if (!relative || !relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("Frozen historical runtime denied for new writes");
  }
  const compact = path.join(root, ".my-dev-kit-workflow/tmp/e1r");
  if (path.relative(path.join(compact, "d"), run) !== "") throw new Error("Unapproved differential test runtime");
  const marker = path.join(compact, "owner.json");
  if (!fs.lstatSync(marker).isFile() || fs.lstatSync(marker).isSymbolicLink()) throw new Error("Invalid task runtime ownership");
  const owner = JSON.parse(fs.readFileSync(marker, "utf8").replace(/^\uFEFF/, ""));
  if (owner.task !== "v010-lab-evidence-01" || owner.nativeRun !== "20261105T131430-v010-lab-evidence-01" || path.relative(root, owner.repository) !== "") throw new Error("Unowned differential test runtime");
  const cache = process.env.npm_config_cache;
  if (!cache) throw new Error("Configure the approved Lab-local npm cache in the parent process");
  canonicalDirectory(cache);
  const logs = process.env.npm_config_logs_dir;
  if (!logs || process.env.npm_config_logs_max !== "100000") throw new Error("Configure isolated parent npm logs");
  canonicalDirectory(logs);
  const task = path.join(root, ".my-dev-kit-workflow/tmp/v010-lab-evidence-01/implementation/temp");
  if (path.relative(path.join(task, "npm-cache"), cache) !== "" || path.relative(path.join(task, "npm-logs"), logs) !== "") throw new Error("Parent cache/log root is not owned by this task");
  return run;
}
function validateOutputFile(request: string | undefined, approved = approvedRunRoot()): string | undefined {
  if (request === undefined) return undefined;
  if (!request || !path.isAbsolute(request) || path.resolve(request) !== request || request.split(/[\\/]/).includes("..")) throw new Error("Noncanonical differential output path");
  const relative = path.relative(workflowRoot, request);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("Frozen historical comparison destination");
  if (path.relative(path.join(approved, "comparisons"), path.dirname(request)) !== "" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(path.basename(request))) throw new Error("Differential output outside approved comparison root");
  canonicalDirectory(path.dirname(request));
  if (fs.existsSync(request) || fs.lstatSync(path.dirname(request)).isSymbolicLink()) throw new Error("Differential output already exists or is linked");
  return request;
}
function writeExclusiveComparison(file: string | undefined, value: unknown) {
  if (file === undefined) return undefined;
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  const descriptor = fs.openSync(file, "wx");
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const actual = fs.readFileSync(file);
    const expectedHash = createHash("sha256").update(bytes).digest("hex");
    if (createHash("sha256").update(actual).digest("hex") !== expectedHash) throw new Error("Incomplete comparison write: hash mismatch");
    JSON.parse(actual.toString("utf8"));
    return expectedHash;
  } finally { fs.closeSync(descriptor); }
}
const output = approvedRunRoot();
for (const name of ["temp", "comparisons"]) {
  const directory = path.join(output, name);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory);
  canonicalDirectory(directory);
}
const testRuntime = canonicalDirectory(path.join(output, "temp"));
const comparisonOutput = validateOutputFile(process.env.LAB_KIT_DIFFERENTIAL_OUTPUT_FILE);
let workspace: string | undefined;
const candidate = path.join(root, ".my-dev-kit-workflow/tools/v010-lab-kit-gate4/kit-candidate-05/node_modules/@dailephd/my-dev-kit");
const cli = path.join(candidate, "dist/cli.js");
const kitSourceRoot = path.resolve(root, "../my-dev-kit");
const kitSourceCommit = "c66e74a4833137528e6dfc26d8db8e90aa3c0258";
const qualificationFile = path.join(kitSourceRoot, ".my-dev-kit-workflow/tmp/v115-kit-facts-01/jvm-declaration-policy/evidence/candidate05-qualification.json");
const qualificationSha256 = "a465789bfb59bea0ece2a762c8625f8bd287120e5bd86247fddb42b8249efeb4";
const tarball = path.join(kitSourceRoot, ".my-dev-kit-workflow/tmp/v115-kit-facts-01/jvm-declaration-policy/candidate-05/dailephd-my-dev-kit-1.14.0.tgz");
const tarballSha256 = "7620a8122315069b97d46d6d3632dadcda59563f94caa97ae6966860c0a5067c";
const candidateExpectation: KitCandidateExpectation = {
  packageName: "@dailephd/my-dev-kit", packageVersion: "1.14.0", artifactSchemaVersion: "1.1.0",
  extractorRevision: "source-audit-v1.5.0", cliSha256: "35dbc49fc91f8c47f1e7cdaf86223414a54517ff25a1a29f87231b2bae3807b8",
};
const fixtureRoot = "tests/fixtures/audits/kit-differential-v010";
const sourceIds = ["docs-code-mismatch", "duplicate-implementation-candidate", "dead-code-candidate", "test-rot", "cross-platform-rot"];
type Classification = "BYPASS_REPLACED_WITH_KIT_EVIDENCE" | "PRESERVED_PARITY" | "INTENDED_CORRECTION_REQUIRES_FIXTURE" | "BLOCKING_REGRESSION" | "UNRESOLVED_COMPARISON" | "SOURCE_READER_BYPASS" | "KIT_CAPABILITY_UNAVAILABLE" | "NOT_APPLICABLE";
type Json = Record<string, any>; // Local record of actual foreign CLI JSON, never a production schema.
const comparisons: Json[] = [];
const negatives: Json[] = [];
const queries: Json[] = [];
const frozenBytes = fs.readFileSync(path.join(root, ".my-dev-kit-workflow/tmp/v010-lab-kit-gate4/comparisons/results.json"));
const frozen = JSON.parse(frozenBytes.toString("utf8")) as Json;
const gate4aBytes = fs.readFileSync(path.join(root, ".my-dev-kit-workflow/tmp/v010-lab-kit-gate4/correction-01/comparisons/results.json"));
const gate4a = JSON.parse(gate4aBytes.toString("utf8")) as Json;
const requirementCoverage = [
  ["M01", "implemented", "15 immutable targets, ten frozen detectors, both explicit providers"],
  ["M02", "implemented", "nonSourceControls on every target with absent Kit"],
  ["M03", "implemented", "missing-package five languages/mixed; Gate 3 command boundary tests exit 2 with fail-on none; detector/capability names remain a diagnostic gap"],
  ["M04", "existing-test", "kitSourceProvider.test.ts installed package resolution; auditRunnerKitBridge.test.ts incompatible candidate"],
  ["M05", "implemented", "stale-selected-source after real index on disposable copy"],
  ["M06", "implemented", "malformed-artifact; Gate 3 artifact hash/missing tests"],
  ["M07", "blocked", "Java partial record: frozen Gate 3 rejects partial instead of presence-only continuation; requires consumer policy decision before changing"],
  ["M08", "blocked", "python/tests/test_check.py npm run vanished: test-observations unsupported, legacy reader bypass; Kit language adapter observations and Lab consumer needed"],
  ["M09", "implemented", "ambiguous peer.ts/peer.js actual import-target present with multiple targets; no missing peer finding"],
  ["M10", "implemented", "outside-root lib/outside.ts: complete corrected selection; import-target query remains distinct from missing filesystem evidence"],
  ["M11", "blocked", "ambiguous/tests/check.sample.ts ../src/absent: actual proven-missing query available; test-rot still uses Lab resolver"],
  ["M12", "implemented", "TS/JS alpha.js specifier backed by alpha.ts and alpha.js respectively"],
  ["M13", "implemented", "python/src/dynamic.py dynamic __all__, actual exported null and adapter unknown exportState"],
  ["M14", "implemented", "python/src/alpha.py multiline __all__, HiddenWidget excluded"],
  ["M15", "implemented", "java/Alpha.java nested public under package owner vs Beta.java top-level public"],
  ["M16", "implemented", "kotlin visibility variants and src/script.kts unknown exports"],
  ["M17", "blocked", "kotlin SingletonWidget/companion fixture exists; object maps to unknown; add com.example.SingletonWidget doc claim comparison after consumer kind policy approval"],
  ["M18", "blocked", "java static import, Kotlin member import and mixed/src/custom source sets; JVM import-target indeterminate; resolver remains Lab-owned bypass"],
  ["M19", "implemented", "TS/JS src/detectors const/literal/imported/extra ids; producer facts retained; registry rule bypass reported"],
  ["M20", "implemented", "payload.json basename comment/string in all five languages; exact occurrence queries compared with legacy scans"],
  ["M21", "implemented", "TS/JS src/audits positive, negative db.exec/comment, inline require; bypass and partial producer limits retained"],
  ["M22", "implemented", "encoded TS/JS test input: skip/only comment/code, xit/todo/each, static/dynamic title, writeFile command exclusion"],
  ["M23", "implemented", "typescript/tests/fixtures/role.ts Lab test versus Kit unknown; Kit outside-policy paths retained"],
  ["M24", "implemented", "outside-root and mixed-ts-python-jvm/pytests selected and validated through inventory-derived roots"],
  ["M25", "implemented", "large/tests/check.sample.ts exceeds 200000 bytes and exact occurrence cap; incomplete query never absence"],
  ["M26", "blocked", "Gate 6 only: two crate files with exported same-name struct/function; no Rust qualification started"],
  ["M27", "blocked", "Gate 6 only: two crate files with distinct public declarations; no Rust qualification started"],
  ["M28", "blocked", "Gate 6 only: Rust macro/cfg partial and unsupported observation fixtures; Lab language model prerequisite unresolved"],
].map(([id, status, evidence]) => ({ id, status, evidence }));
let sequence = 0;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function assertCandidateIdentity(observed: Json) {
  const expected = { candidate: "Candidate05", sourceCommit: kitSourceCommit, packageName: candidateExpectation.packageName,
    packageVersion: candidateExpectation.packageVersion, artifactSchemaVersion: candidateExpectation.artifactSchemaVersion,
    extractorRevision: candidateExpectation.extractorRevision, cacheSchemaVersion: "1.4.0",
    cliSha256: candidateExpectation.cliSha256, tarballSha256, qualificationSha256 };
  for (const [key, value] of Object.entries(expected)) if (observed[key] !== value) throw new Error(`Unqualified Candidate05 identity: ${key}`);
}
// Authenticate before any detector runs, including when Vitest selects only a
// subset. Package version alone never selects or qualifies the producer.
const qualificationBytes = fs.readFileSync(qualificationFile);
if (sha(qualificationBytes) !== qualificationSha256) throw new Error("Unqualified Candidate05 producer record hash");
const qualification = JSON.parse(qualificationBytes.toString("utf8")) as Json;
const packageMetadata = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8")) as Json;
const candidateIdentity = { candidate: qualification.candidate.candidate,
  // The retained, hash-authenticated package provenance owns this historical
  // identity. The sibling checkout may advance after the candidate was packed.
  sourceCommit: qualification.candidate.sourceCommit,
  packageName: packageMetadata.name, packageVersion: packageMetadata.version, artifactSchemaVersion: qualification.schemaVersion,
  extractorRevision: qualification.extractorRevision, cacheSchemaVersion: qualification.cacheSchemaVersion,
  cliSha256: sha(fs.readFileSync(cli)), tarballSha256: sha(fs.readFileSync(tarball)), qualificationSha256: sha(qualificationBytes),
  qualificationIdentity: qualification.identity, installedPackageRoot: candidate, qualificationFile };
assertCandidateIdentity(candidateIdentity);
if (qualification.identity !== "CANDIDATE05_EXACT_COMMIT_QUALIFICATION" || qualification.candidate.sourceCommit !== kitSourceCommit) throw new Error("Unqualified Candidate05 producer record");
function tree(dir: string): { path: string; sha256: string }[] {
  const entries: { path: string; sha256: string }[] = [];
  function walk(current: string) {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`Unexpected link: ${full}`);
      if (stat.isDirectory()) walk(full);
      else entries.push({ path: path.relative(dir, full).replace(/\\/g, "/"), sha256: sha(fs.readFileSync(full)) });
    }
  }
  walk(dir);
  return entries;
}
const candidateBefore = sha(JSON.stringify(tree(candidate)));
const materialized = new Map<string, string>();
function targetFor(relative: string): string {
  if (materialized.has(relative)) return materialized.get(relative)!;
  const source = path.join(root, relative);
  // JSON-encoded payloads keep intentional runner modifiers out of Lab's own
  // text self-audit. Decode once, before either provider sees the target.
  const destination = path.join(work("immutable-target"), "target");
  for (const file of tree(source)) {
    const outputPath = path.join(destination, file.path.replace(/\.input$/, ""));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (file.path.endsWith(".input")) fs.writeFileSync(outputPath, JSON.parse(fs.readFileSync(path.join(source, file.path), "utf8")));
    else fs.copyFileSync(path.join(source, file.path), outputPath);
  }
  materialized.set(relative, destination);
  return destination;
}
function work(label: string) {
  if (!workspace) {
    const temp = testRuntime;
    workspace = fs.mkdtempSync(path.join(temp, "differential-run-"));
  }
  return fs.mkdtempSync(path.join(workspace, `${label}-${sequence++}-`));
}
function config(target: string) {
  return normalizeAuditConfig({ target, types: "code-rot", include: "docs,tests,package,architecture,cli", failOn: "none", out: path.join(output, "logs") }, root);
}
function normalize(value: unknown, target: string): any {
  if (typeof value === "string") return value.split(target).join("<TARGET>").split(target.replace(/\\/g, "/")).join("<TARGET>");
  if (Array.isArray(value)) return value.map((v) => normalize(v, target));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v, target)]));
  return value;
}
function findings(result: AuditResult | undefined, target: string) {
  if (!result) return null; // Failure is not zero findings.
  return result.issues.map((issue) => normalize(issue, target)).sort((a, b) => a.id.localeCompare(b.id));
}
async function invoke(target: string, mode: AuditSourceProviderMode, ids: readonly string[], runCommand?: KitCommandRunner, installedPackageRoot = candidate) {
  const calls: string[][] = [];
  const pages: Json[] = [];
  const workDir = work(mode);
  let result: AuditResult | undefined;
  let error: Json | null = null;
  try {
    result = await runAudit({ config: config(target), toolRoot: root, sourceProviderMode: mode,
      registry: DEFAULT_AUDIT_REGISTRY.filter((d) => ids.includes(d.id)),
      kitSourceProviderDependencies: { installedPackageRoot, expectation: candidateExpectation, workDir, runCommand: async (options) => {
        calls.push([...(options.args ?? [])]);
        const response = await (runCommand ?? runMeasuredCommand)(options);
        try { const parsed = JSON.parse(response.stdout); if (parsed.mode !== "index") pages.push(parsed); } catch { /* Failed JSON retained in error/logs. */ }
        return response;
      } },
    });
  } catch (caught) {
    const e = caught as Error & { category?: string; detail?: string };
    error = { name: e.name, category: e.category ?? "unclassified", message: e.message, detail: e.detail ?? null, exitCode: 2 };
  }
  pages.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { result, record: { providerMode: mode, providerIdentity: result?.sourceFacts.provider ?? null,
    producer: result?.sourceFacts.kitEvidence ?? null, selectedDetectorIds: [...ids], sourceCoverage: result?.sourceFacts.kitEvidence ?? null,
    exitCode: result?.exitCode ?? error?.exitCode ?? null,
    sourceFiles: result?.sourceFacts.files ?? null, rawFindings: result?.issues ?? null, normalizedFindings: findings(result, target),
    skippedDetectors: result?.skippedDetectors ?? null, detectorErrors: result?.detectorErrors ?? null,
    error, producerPages: pages, commandCount: calls.length, workDir }, calls };
}

// Decision-level inventory. Merely having ctx.sourceFacts is not evidence of use.
const bypasses = [
  { detectorId: "duplicate-implementation-candidate", function: "findDuplicateDetectorRegistryIds", predicate: "first id/DETECTOR_ID text match in /detectors/*.ts", reader: "readBoundedFileText", kitQuery: "identifier-literal registry-id (not consumed)", fixture: "typescript/src/detectors" },
  { detectorId: "dead-code-candidate", function: "buildReverseReferenceIndex", predicate: "relative import basename absent", reader: "readBoundedFileText + IMPORT_SPECIFIER_PATTERN; merged with collectRelativeImportBasenames", kitQuery: "imports partly consumed; raw scan still supplies required references", fixture: "typescript" },
  { detectorId: "dead-code-candidate", function: "findUnreferencedFixtures", predicate: "basename absent in concatenated tests", reader: "readBoundedFileText", kitQuery: "exact-file source --contains (not consumed)", fixture: "all tests/fixtures/payload.json" },
  { detectorId: "test-rot", function: "findMissingSourceImports / findMissingSourceImportsFromSourceFacts / findMissingPythonSourceImports / findMissingJvmSourceImports", predicate: "target does not exist in Lab-derived candidate paths", reader: "raw regex + fs.existsSync + jvmImportCandidatePaths", kitQuery: "lookup --audit-import-target (not consumed)", fixture: "all language tests" },
  { detectorId: "test-rot", function: "findStaleNpmRunReferences / findSkipUsage / findOnlyUsage / findStaleVersionMentions", predicate: "npm run, skip/only and version title regex", reader: "readBoundedFileText", kitQuery: "test-observation (not consumed)", fixture: "typescript/tests/check.sample.ts; python/tests/test_check.py" },
  { detectorId: "cross-platform-rot", function: "scanSourceFiles / nearbyWindow", predicate: "split literals or shell:true within 150 characters of exec/spawn", reader: "readBoundedFileText", kitQuery: "process-observation (not consumed)", fixture: "typescript/src/audits; javascript/src/audits" },
];
function bypassApplicable(id: string, paths: string[]): boolean {
  if (id === "duplicate-implementation-candidate") return paths.some((p) => /\/detectors\/[\w-]+\.ts$/.test(p));
  if (id === "cross-platform-rot") return paths.some((p) => p.startsWith("src/audits/") && !p.endsWith("/textLines.ts"));
  return id === "dead-code-candidate" || (id === "test-rot" && paths.some((p) => p.startsWith("tests/") || p.includes("/test/") || p.startsWith("pytests/")));
}

const fixtures = [
  ...["typescript", "javascript", "python", "java", "kotlin", "mixed", "outside-root", "ambiguous", "large"].map((name) => `${fixtureRoot}/${name}`),
  ...["mixed-docs-claims", "mixed-generated-vendor", "mixed-java-kotlin", "mixed-python-ts", "mixed-ts-js", "mixed-ts-python-jvm"].map((name) => `tests/fixtures/audits/mixed-language/${name}`),
];
const canonicalLedgerFile = path.join(workflowRoot, "correction-09/comparisons/gate4-150-decision-ledger.json");
const canonicalLedgerBytes = fs.readFileSync(canonicalLedgerFile);
if (sha(canonicalLedgerBytes) !== "16aca301acea424b23011b64265bf71549e5288a45bb21b1918e4f544ae2073e") throw new Error("Canonical Gate4I ledger identity mismatch");
const canonicalDecisionIds: string[] = JSON.parse(canonicalLedgerBytes.toString("utf8")).decisions.map((decision: Json) => decision.decisionId).sort();
const plannedDecisionIds = fixtures.flatMap((fixture) => DEFAULT_AUDIT_REGISTRY.map((detector) => `${fixture}::${detector.id}`)).sort();
if (canonicalDecisionIds.length !== 150 || new Set(canonicalDecisionIds).size !== 150 || JSON.stringify(plannedDecisionIds) !== JSON.stringify(canonicalDecisionIds)) throw new Error("Differential plan does not cover the exact 150 canonical decisions");

describe("differential output safety", () => {
  const historical = path.join(workflowRoot, "correction-02/comparisons/results.json");
  const historicalHash = sha(fs.readFileSync(historical));
  it("uses the explicitly owned compact differential runtime", () => {
    expect(approvedRunRoot()).toBe(path.join(root, ".my-dev-kit-workflow/tmp/e1r/d"));
    expect(path.relative(output, testRuntime)).toBe("temp");
  });
  it("denies protected Gate4/Gate5 runtimes, source fixtures, packages and outside roots", () => {
    for (const directory of [workflowRoot, path.join(root, ".my-dev-kit-workflow/tmp/v010-lab-kit-gate5"), path.join(root, "tests/fixtures"), path.join(root, "node_modules"), path.dirname(root)]) expect(() => approvedRunRoot(directory)).toThrow();
    expect(sha(fs.readFileSync(historical))).toBe(historicalHash);
  });
  it("refuses missing runtime authority and lexical traversal", () => {
    expect(() => approvedRunRoot("")).toThrow(/LAB_KIT_DIFFERENTIAL_TEST_ROOT/);
    expect(() => approvedRunRoot(output + path.sep + ".." + path.sep + "d")).toThrow(/Noncanonical/);
  });
  it("denies a linked runtime and preserves the protected historical bytes", () => {
    const probe = fs.mkdtempSync(path.join(testRuntime, "root-safety-"));
    const link = path.join(probe, "redirect");
    fs.symlinkSync(path.dirname(root), link, process.platform === "win32" ? "junction" : "dir");
    try { expect(() => approvedRunRoot(link)).toThrow(/Symlink|junction/); expect(sha(fs.readFileSync(historical))).toBe(historicalHash); }
    finally { fs.unlinkSync(link); }
  });
  it("authenticates all Candidate05 identity dimensions before execution", () => {
    expect(() => assertCandidateIdentity(candidateIdentity)).not.toThrow();
    for (const key of ["candidate", "sourceCommit", "packageName", "packageVersion", "artifactSchemaVersion", "extractorRevision", "cacheSchemaVersion", "cliSha256", "tarballSha256", "qualificationSha256"]) {
      expect(() => assertCandidateIdentity({ ...candidateIdentity, [key]: "unqualified" })).toThrow(/Unqualified Candidate05/);
    }
  });
  it("keeps real working directories under the approved task temp", () => {
    const directory = work("containment-safety");
    expect(path.relative(path.join(output, "temp"), directory).startsWith("..")).toBe(false);
    expect(path.relative(path.join(output, "temp"), directory)).not.toBe("");
    expect(fs.existsSync(path.join(output, "indexes"))).toBe(false);
  });
  it("keeps unconfigured comparisons in memory without historical output", () => {
    expect(validateOutputFile(undefined)).toBeUndefined();
    expect(writeExclusiveComparison(undefined, { decisions: ["assertions remain active"] })).toBeUndefined();
    expect(sha(fs.readFileSync(historical))).toBe(historicalHash);
  });
  it("validates the selected approved destination", () => {
    const file = path.join(output, "comparisons/absent-safety-check.json");
    expect(validateOutputFile(file)).toBe(file); // Validation alone creates nothing.
    expect(fs.existsSync(file)).toBe(false);
  });
  it("creates valid flushed output once and records its SHA-256", () => {
    const file = path.join(fs.mkdtempSync(path.join(testRuntime, "writer-safety-")), "result.json");
    const digest = writeExclusiveComparison(file, { complete: true, decisions: [1] });
    expect(digest).toBe(sha(fs.readFileSync(file)));
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ complete: true, decisions: [1] });
    expect(() => writeExclusiveComparison(file, { replacement: true })).toThrow();
    expect(sha(fs.readFileSync(file))).toBe(digest);
    expect(() => writeExclusiveComparison(file, { repeatedRun: true })).toThrow();
    expect(sha(fs.readFileSync(file))).toBe(digest);
  });
  it("rejects existing approved output without modifying bytes", () => {
    // A synthetic run below task-owned temp exercises the same real filesystem
    // validation without creating another campaign comparison artifact.
    const run = fs.mkdtempSync(path.join(testRuntime, "validation-safety-"));
    fs.mkdirSync(path.join(run, "comparisons"));
    const file = path.join(run, "comparisons/result.json");
    fs.writeFileSync(file, "preserved", { flag: "wx" });
    expect(() => validateOutputFile(file, run)).toThrow(/already exists/);
    expect(fs.readFileSync(file, "utf8")).toBe("preserved");
  });
  it("denies all eighteen frozen roots including correction-02", () => {
    for (let n = 1; n <= 18; n++) expect(() => validateOutputFile(path.join(workflowRoot, `correction-${String(n).padStart(2, "0")}/comparisons/results.json`))).toThrow(/Frozen/);
    expect(sha(fs.readFileSync(historical))).toBe(historicalHash);
  });
  it("rejects outside-project, traversal, relative and empty configuration without fallback", () => {
    for (const file of [path.resolve(root, "../outside.json"), path.join(output, "comparisons") + path.sep + ".." + path.sep + "escape.json", "relative.json", "", path.join(workflowRoot, "future-unapproved/comparisons/result.json")]) expect(() => validateOutputFile(file)).toThrow();
    expect(sha(fs.readFileSync(historical))).toBe(historicalHash);
  });
  it("rejects symlink or junction escape where supported", (context) => {
    const run = fs.mkdtempSync(path.join(testRuntime, "link-safety-"));
    const escape = fs.mkdtempSync(path.join(testRuntime, "link-target-"));
    try { fs.symlinkSync(escape, path.join(run, "comparisons"), process.platform === "win32" ? "junction" : "dir"); }
    catch (error) { if (["EPERM", "ENOTSUP", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) { context.skip(); return; } throw error; }
    expect(() => validateOutputFile(path.join(run, "comparisons/result.json"), run)).toThrow(/Symlink|junction/);
    expect(fs.readdirSync(escape)).toEqual([]);
  });
  it("propagates parent cache controls before TSX preload", () => {
    const child = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", 'import os from "node:os"; console.log(JSON.stringify({temp:os.tmpdir(),disabled:process.env.TSX_DISABLE_CACHE,tmp:process.env.TMP,tmpdir:process.env.TMPDIR,cache:process.env.npm_config_cache}))'], { cwd: root, encoding: "utf8", windowsHide: true }));
    expect(child).toEqual({ temp: process.env.TEMP, disabled: "1", tmp: process.env.TMP, tmpdir: process.env.TMPDIR, cache: process.env.npm_config_cache });
  });
});

describe("Gate5 installed-candidate qualification and historical provenance", () => {
  it("pins executable and preserved tarball identities", () => {
    expect(sha(fs.readFileSync(cli))).toBe(candidateExpectation.cliSha256);
    expect(sha(fs.readFileSync(tarball))).toBe(tarballSha256);
  });

  it("preserves unknown line count for unsupported non-source inventory (failed before Gate 4 correction)", () => {
    const capabilities = Object.fromEntries(["declarations", "imports", "exports", "identifier-literals", "test-observations", "fixture-references", "process-observations", "api-client-calls", "source-ranges"].map((name) => [name, "unsupported"]));
    const file = { path: "tests/fixtures/payload.json", sizeBytes: 3, contentSha256: null, lineCount: null,
      language: "unsupported", role: "unknown", status: "unsupported", analyzerId: null, capabilities, warnings: [] };
    expect(validateKitFileRecord(file, "fixture").lineCount).toBeNull();
    expect(() => assertRequiredCapabilities(validateKitFileRecord(file, "fixture"), ["imports"])).toThrow(/capability-insufficient/);
    expect(() => validateKitFileRecord({ ...file, status: "parsed" }, "fixture")).toThrow(/page-invalid/);
  });

  // The active 150-decision regression is Kit versus the committed accepted oracle.
  // Historical legacy comparisons remain immutable evidence.

  it("fails closed for package unavailable with fail-on none", async () => {
    for (const language of ["typescript", "javascript", "python", "java", "kotlin", "mixed"]) {
      const outcome = await invoke(path.join(root, fixtureRoot, language), "kit", ["test-rot"], undefined, path.join(output, "absent-kit"));
      negatives.push({ case: `missing-package-${language}`, ...outcome.record });
      expect(outcome.record.error?.category).toBe("package-missing");
      expect(outcome.record.normalizedFindings).toBeNull();
      expect(outcome.record.error?.exitCode).toBe(2);
    }
  });

  it("records bypasses rather than certifying matching counts as parity", () => {
    expect(requirementCoverage.map((r) => r.id)).toEqual(Array.from({ length: 28 }, (_, i) => `M${String(i + 1).padStart(2, "0")}`));
    expect(bypasses).toHaveLength(6);
    expect(new Set(bypasses.map((b) => b.detectorId)).size).toBe(4);
    for (const comparison of comparisons) for (const decision of comparison.decisions) {
      if (bypassApplicable(decision.detectorId, comparison.files.map((f: Json) => f.path))) expect(["BYPASS_REPLACED_WITH_KIT_EVIDENCE", "KIT_CAPABILITY_UNAVAILABLE"]).toContain(decision.classification);
    }
  });

  it.each(["typescript", "javascript", "python", "java", "kotlin", "mixed", "ambiguous", "outside-root", "large"])("measures actual capabilities, import targets and exact occurrences for %s", async (name) => {
    const target = targetFor(`${fixtureRoot}/${name}`);
    const before = tree(target);
    // Empty capability requirement belongs to the real cross-platform detector.
    // It permits inspection of partial producer facts without pretending that
    // declarations/imports met another detector's stronger requirements.
    // Capability inspection is deliberately independent of detector applicability.
    // Empty structural requirements inspect partial facts without certifying a rule.
    const inspectionDir = work("capability-inspection");
    const inspection = await collectKitSourceFacts({ targetRoot: target, inventory: scanProjectInventory(target),
      requiredCapabilities: [], includeScriptsRoot: true }, { installedPackageRoot: candidate, expectation: candidateExpectation, workDir: inspectionDir });
    const acquired = { record: { error: null, sourceFiles: inspection.files } };
    const index = path.join(inspectionDir, "index");
    async function query(args: string[]) {
      const response = await runMeasuredCommand({ executable: process.execPath, args: [cli, ...args, "--index", index, "--json"],
        commandId: `query-${sequence++}`, cwd: root, outDir: work("query"), resolveCommand: false, timeoutMs: 30_000 });
      expect(response.exitCode).toBe(0);
      return JSON.parse(response.stdout) as Json;
    }
    const artifact = JSON.parse(fs.readFileSync(path.join(index, "source-audit-evidence.json"), "utf8")) as Json;
    const files: Json[] = [];
    for (const file of artifact.files as Json[]) {
      // All producer facts are recorded in the local result, including facts
      // the bridge currently discards and files outside Lab source/test policy.
      const entry: Json = { path: file.path, language: file.language, role: file.role, status: file.status,
        contentSha256: file.contentSha256, capabilities: file.capabilities, facts: file.facts, diagnostics: file.diagnostics, importTargets: [] };
      for (const fact of file.facts ?? []) if (fact.kind === "import") {
        entry.importTargets.push(await query(["lookup", "--audit-import-target", fact.id]));
      }
      if (file.role === "test" || /check|Test/.test(file.path)) {
        entry.occurrence = await query(["source", "--file", file.path, "--contains", "payload.json"]);
        expect(typeof entry.occurrence.complete).toBe("boolean");
        // Absence is usable only when complete=true; partial never means zero.
        entry.occurrenceClassification = entry.occurrence.complete ? "PRESERVED_PARITY" : "KIT_CAPABILITY_UNAVAILABLE";
        if (name === "large" && /check/.test(file.path)) expect(entry.occurrence.complete).toBe(false);
      }
      files.push(entry);
    }
    queries.push({ fixture: name, coverage: artifact.coverage, source: artifact.source, producer: artifact.producer, files,
      bridgeError: acquired.record.error, bridgeSourceFiles: acquired.record.sourceFiles });
    if (["python", "java", "kotlin"].includes(name)) {
      expect(files.some((f) => f.capabilities["process-observations"] === "unsupported")).toBe(true);
    }
    if (name === "ambiguous") {
      const targets = files.flatMap((f) => f.importTargets);
      expect(JSON.stringify(targets)).toContain("MULTIPLE_TARGETS_IN_SELECTED_INVENTORY");
      expect(JSON.stringify(targets)).toContain("proven-missing");
    }
    const declarations = files.flatMap((f) => f.facts).filter((f) => f.kind === "declaration");
    if (name === "java") {
      expect(declarations.find((d) => d.name === "PackageWidget")?.visibility).toBe("package");
      expect(declarations.find((d) => d.name === "ProtectedWidget")?.visibility).toBe("protected");
      expect(declarations.find((d) => d.name === "PrivateWidget")?.visibility).toBe("private");
      expect(declarations.find((d) => d.name === "NestedPublicWidget" && d.ownerKey)?.exported).toBe(false);
      expect(declarations.find((d) => d.name === "NestedPublicWidget" && !d.ownerKey)?.exported).toBe(true);
    }
    if (name === "kotlin") {
      expect(declarations.find((d) => d.name === "InternalWidget")?.visibility).toBe("internal");
      expect(declarations.find((d) => d.name === "ScriptWidget")?.exported).toBeNull();
      expect(declarations.find((d) => d.name === "ScriptWidget")?.visibility).toBe("unknown");
      expect(files.find((f) => f.path === "src/script.kts")?.capabilities.exports).toBe("partial");
    }
    if (name === "python") {
      expect(declarations.find((d) => d.name === "UnknownWidget")?.exported).toBeNull();
      expect(declarations.find((d) => d.name === "HiddenWidget")?.exported).toBe(false);
      expect(declarations.find((d) => d.name === "DifferentialWidget")?.exportOrigin).toBe("python-all");
    }
    if (name === "typescript") {
      expect(files.some((f) => f.path.endsWith(".mts") && f.contentSha256)).toBe(true);
      expect(files.some((f) => f.path.endsWith(".cts") && f.contentSha256)).toBe(true);
      expect(files.flatMap((f) => f.facts).some((f) => f.kind === "identifier-literal" && f.value === "same-id")).toBe(true);
      expect(files.find((f) => f.path === "tests/fixtures/role.ts")?.role).toBe("unknown");
    }
    if (name === "mixed") {
      const result = await invoke(target, "kit", ["duplicate-implementation-candidate"]);
      if (!result.record.error) {
        const duplicate = result.result!.issues.find((i) => i.title.includes('"CollisionWidget"'));
        expect(duplicate?.affectedFiles.sort()).toEqual(["src/one.ts", "src/two.js"]);
      } else expect(result.record.error.category).toBe("capability-insufficient");
    }
    expect(tree(target)).toEqual(before);
  }, 300_000);

  it.each(["wrong-producer", "malformed-artifact", "wrong-snapshot", "missing-inventory-page", "truncated-facts", "required-unsupported", "required-partial"])("rejects %s using a fault injected into real candidate output", async (fault) => {
    const target = path.join(root, fixtureRoot, "ambiguous");
    const runner: KitCommandRunner = async (options) => {
      const response = await runMeasuredCommand(options);
      const args = options.args ?? [];
      if (args.includes("index") && ["wrong-producer", "malformed-artifact"].includes(fault)) {
        const index = args[args.indexOf("--out") + 1]!;
        const file = path.join(index, "source-audit-evidence.json");
        if (fault === "malformed-artifact") fs.writeFileSync(file, "{broken");
        else {
          const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
          artifact.producer.packageName = "wrong-producer";
          const bytes = JSON.stringify(artifact);
          fs.writeFileSync(file, bytes);
          const manifestPath = path.join(index, "manifest.json");
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          // Existing manifest location is found from its actual producer JSON.
          function replace(value: Json) { for (const [key, child] of Object.entries(value)) {
            if (key === "sha256" && child === sha(fs.readFileSync(file))) continue;
            if (child && typeof child === "object") replace(child);
            if (key === "path" && child === "source-audit-evidence.json") value.sha256 = sha(bytes);
          } }
          replace(manifest); fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        }
      }
      if (!args.includes("lookup")) return response;
      const body = JSON.parse(response.stdout);
      if (fault === "wrong-snapshot") body.snapshotId = "0".repeat(64);
      if (fault === "missing-inventory-page" && args.includes("--audit-files")) { body.nextPageIndex = 1; body.totalPages = 2; }
      if (args.includes("--audit-files") && ["required-partial", "required-unsupported"].includes(fault)) {
        for (const file of body.files) file.capabilities.imports = fault === "required-partial" ? "partial" : "unsupported";
      }
      if (args.includes("--audit-file")) {
        if (fault === "truncated-facts") body.facts = [];
        if (fault === "required-unsupported") body.file.capabilities.imports = "unsupported";
        if (fault === "required-partial") body.file.capabilities.imports = "partial";
      }
      return { ...response, stdout: JSON.stringify(body) };
    };
    const result = await invoke(target, "kit", ["test-rot"], runner);
    negatives.push({ case: fault, ...result.record });
    expect(result.record.error).not.toBeNull();
    expect(result.record.error?.category).not.toBe("unclassified");
    if (["required-partial", "required-unsupported"].includes(fault)) expect(result.record.error?.category).toBe("capability-insufficient");
    expect(result.record.normalizedFindings).toBeNull();
    expect(result.record.error?.exitCode).toBe(2);
  }, 300_000);

  it("rejects incomplete and unsupported required capabilities without treating them as absence", () => {
    const file = { path: "src/partial.java", status: "parsed", capabilities: { declarations: "partial" } } as unknown as KitFileRecord;
    expect(() => assertRequiredCapabilities(file, ["declarations"])).toThrow(/capability-insufficient/);
    file.capabilities.declarations = "unsupported";
    expect(() => assertRequiredCapabilities(file, ["declarations"])).toThrow(/capability-insufficient/);
  });

  it("rejects stale selected source after the real index without changing tracked fixtures", async () => {
    const target = path.join(work("stale-target"), "target");
    fs.cpSync(path.join(root, fixtureRoot, "ambiguous"), target, { recursive: true });
    const runner: KitCommandRunner = async (options) => {
      const result = await runMeasuredCommand(options);
      if (options.args?.includes("index")) fs.appendFileSync(path.join(target, "src/peer.ts"), "\n// changed after index\n");
      return result;
    };
    const result = await invoke(target, "kit", ["test-rot"], runner);
    negatives.push({ case: "stale-selected-source", ...result.record });
    expect(result.record.error?.category).toBe("stale-evidence");
    expect(JSON.stringify(result.record.error)).toContain("STALE_SOURCE_EVIDENCE");
    expect(result.record.normalizedFindings).toBeNull();
  }, 300_000);
});

afterAll(() => {
  expect(sha(JSON.stringify(tree(candidate)))).toBe(candidateBefore);
  for (const fixture of fixtures) expect(tree(path.join(root, fixture)).length).toBeGreaterThan(0);
});
