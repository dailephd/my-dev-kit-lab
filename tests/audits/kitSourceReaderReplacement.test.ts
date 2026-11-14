import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("../../src/audits/codeRot/utils/boundedRead.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/audits/codeRot/utils/boundedRead.js")>("../../src/audits/codeRot/utils/boundedRead.js");
  return { ...actual, readBoundedFileText: vi.fn(actual.readBoundedFileText) };
});
import { readBoundedFileText } from "../../src/audits/codeRot/utils/boundedRead.js";
import { collectKitSourceFacts, QUALIFIED_KIT_CANDIDATE, type KitSourceReader, type KitCommandRunner } from "../../src/audits/core/kitSourceProvider.js";
import { validateKitOccurrence, validateKitImportProof, qualifyKitDeclarationPredicate, KitSourceEvidenceAcquisitionError, KIT_CAPABILITY_NAMES, type KitSourceEvidence, type KitFileRecord, type KitImportProof, type KitOccurrence, type KitFact } from "../../src/audits/core/kitSourceEvidence.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import { runMeasuredCommand } from "../../src/core/runMeasuredCommand.js";
import { kitPredicateContent, requireCompleteKitOccurrence } from "../../src/audits/codeRot/utils/sourceFactsLookup.js";
import { runAudit, type AuditResult } from "../../src/audits/core/auditRunner.js";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { resolveAuditTarget } from "../../src/audits/core/auditTarget.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { renderAuditTextReport } from "../../src/audits/report/renderAuditTextReport.js";
import { DEFAULT_AUDIT_REGISTRY, type AuditDetector } from "../../src/audits/core/auditRegistry.js";
import type { SourceFileFacts } from "../../src/audits/core/sourceFacts.js";

const candidate = path.resolve(".my-dev-kit-workflow/tools/v010-lab-kit-gate3/kit-candidate/node_modules/@dailephd/my-dev-kit");
const candidate03 = path.resolve(".my-dev-kit-workflow/tools/v010-lab-kit-gate4/kit-candidate-03/node_modules/@dailephd/my-dev-kit");
const historicalCandidate01 = { ...QUALIFIED_KIT_CANDIDATE, artifactSchemaVersion: "1.0.0", extractorRevision: "source-audit-v1.2.0", cliSha256: "df2113290dd0cc64e0505f27a2fbc48678bc54752f7f5953cf48a6bd88e39259" };
const candidate03Deps = { installedPackageRoot: candidate03, expectation: { ...QUALIFIED_KIT_CANDIDATE, artifactSchemaVersion: "1.0.0",
  cliSha256: "e10d0ec4274681743623a8aabee41d6a68cdb1caf86b14a16a4dafd802808635", extractorRevision: "source-audit-v1.3.0" } };
const candidate04Deps = { installedPackageRoot: path.resolve(".my-dev-kit-workflow/tools/v010-lab-kit-gate4/kit-candidate-04/node_modules/@dailephd/my-dev-kit"),
  expectation: { ...QUALIFIED_KIT_CANDIDATE, artifactSchemaVersion: "1.0.0", cliSha256: "9c4b4aa51e17d2a3a973cbc320fa45659bea79d831c046226e3adf4eb7717004", extractorRevision: "source-audit-v1.4.0" } };
const candidate05Deps = { installedPackageRoot: path.resolve(".my-dev-kit-workflow/tools/v010-lab-kit-gate4/kit-candidate-05/node_modules/@dailephd/my-dev-kit"),
  expectation: { ...QUALIFIED_KIT_CANDIDATE, artifactSchemaVersion: "1.1.0", cliSha256: "35dbc49fc91f8c47f1e7cdaf86223414a54517ff25a1a29f87231b2bae3807b8", extractorRevision: "source-audit-v1.5.0" } };
const owned: string[] = [];
const onlyCall = ["test", "only"].join(".");
const skipCall = ["it", "skip"].join(".");
function project(files: Record<string, string | Buffer>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-reader-")); owned.push(root);
  for (const [name, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), body); }
  return root;
}
const readers: KitSourceReader[] = [];
async function acquire(root: string, runCommand?: KitCommandRunner) {
  let reader!: KitSourceReader;
  const facts = await collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root), requiredCapabilities: [], includeScriptsRoot: true,
    onReader(value) { reader = value; readers.push(value); } }, { installedPackageRoot: candidate, expectation: historicalCandidate01, runCommand });
  return { reader, facts };
}
afterAll(() => { readers.forEach((r) => r.dispose()); owned.forEach((p) => fs.rmSync(p, { recursive: true, force: true })); });
const config = (root: string) => normalizeAuditConfig({ target: root, types: "code-rot", include: "docs,tests,package,architecture,cli", failOn: "none" }, process.cwd());

describe("mixed-language declaration profiles", () => {
  it.each([
    ["mixed-docs-claims", 2, 2],
    ["mixed-java-kotlin", 2, 4],
    ["mixed-ts-python-jvm", 4, 2],
  ] as const)("qualifies tests/fixtures/audits/mixed-language/%s::dead-code-candidate without equalizing counts", async (fixture, findings, jvmFiles) => {
    const root = project({});
    fs.cpSync(path.resolve("tests/fixtures/audits/mixed-language", fixture), root, { recursive: true });
    const registry = DEFAULT_AUDIT_REGISTRY.filter(d => d.id === "dead-code-candidate");
    const legacy = historicalAccepted(`tests/fixtures/audits/mixed-language/${fixture}`, "dead-code-candidate");
    vi.mocked(readBoundedFileText).mockClear();
    const kit = await runAudit({ config: config(root), toolRoot: process.cwd(), sourceProviderMode: "kit", registry, kitSourceProviderDependencies: candidate05Deps });
    expect(legacy.detectorErrors).toEqual([]);
    expect(kit.detectorErrors).toEqual([]);
    expect(kit.issues).toHaveLength(findings);
    expect(legacy.issues).toHaveLength(findings);
    const identity = (result: Pick<AuditResult, "issues">) => result.issues.map(({ id, severity, confidence, affectedFiles }) => ({ id, severity, confidence, affectedFiles }));
    expect(identity(kit)).toEqual(identity(legacy));
    const jvm = kit.sourceFacts.files.filter(f => f.language === "java" || f.language === "kotlin");
    expect(jvm).toHaveLength(jvmFiles);
    for (const file of jvm) {
      const before = legacy.sourceFacts.files.find(f => f.relativePath === file.relativePath)!;
      // Complete is specific to the Kit role profile: it does not include methods.
      expect(before.declarations.map(d => d.kind)).toEqual(["class", "method"]);
      expect(file.declarations.map(d => d.kind)).toEqual(["class"]);
      expect(file.kit?.capabilities.declarations).toBe("complete");
      expect(file.kit?.jvmPackageName).toBe("com.example");
      expect(file.declarations[0]).toMatchObject({ ownerKey: null, line: 3,
        jvmDeclaration: { packageName: "com.example", qualifiedName: `com.example.${file.declarations[0].name}`, role: "type" },
        provenance: { producer: "kit", extractionMethod: `${file.language}-lexical`, startLine: 3 } });
      expect(file.declarations[0].provenance?.factId).toMatch(/^audit-fact:/);
      expect(before.declarations[1]).not.toHaveProperty("ownerKey");
    }
    for (const language of ["typescript", "javascript", "python"]) {
      const files = kit.sourceFacts.files.filter(f => f.language === language);
      for (const file of files) {
        const before = legacy.sourceFacts.files.find(f => f.relativePath === file.relativePath)!;
        const roles = (facts: SourceFileFacts) => facts.declarations.map(({ name, kind, line }) => ({ name, kind, line }));
        expect(roles(file)).toEqual(roles(before));
        expect(file.declarations.every(d => d.jvmDeclaration === undefined)).toBe(true);
      }
    }
    expect(vi.mocked(readBoundedFileText).mock.calls.filter(call => /\.(java|kt|py|js|ts)$/.test(call[1]))).toEqual([]);
  }, 120000);
});

describe("qualified declaration proof validation", () => {
  function sample() {
    const snapshotId = "a".repeat(64);
    const record: KitFileRecord = { path: "src/Beta.java", language: "java", jvmPackageName: "com.example", role: "source", status: "parsed", sizeBytes: 10, contentSha256: "b".repeat(64), lineCount: 3, analyzerId: "java-lexical", warnings: [], diagnostics: [],
      capabilities: { ...Object.fromEntries(KIT_CAPABILITY_NAMES.map(name => [name, "complete"])) as KitFileRecord["capabilities"], jvmDeclarations: "complete" } };
    const declaration: KitFact = { id: "audit-fact:declaration", kind: "declaration", name: "Widget", ownerKey: null, span: { path: record.path, startLine: 2, startColumn: null, endLine: null, endColumn: null }, extractionMethod: "java-lexical", jvmDeclaration: { packageName: "com.example", qualifiedName: "com.example.Widget", role: "type" } };
    const fact: KitFact = { ...declaration, id: "audit-fact:import", kind: "import", sourceSpecifier: "com.example.Absent", jvmDeclaration: undefined, jvmImportTarget: { kind: "java-type", qualifiedName: "com.example.Absent" } };
    const evidence: KitSourceEvidence = { snapshotId, artifactSchemaVersion: "1.1.0", extractorRevision: "source-audit-v1.5.0", producer: { packageName: "@dailephd/my-dev-kit", packageVersion: "1.14.0" },
      source: { projectRoot: process.cwd(), sourceRoots: ["src"], excludes: [], symbolIndexSchemaVersion: "3", codeGraphSchemaVersion: "1.1.0", selectionFingerprint: "c".repeat(64), snapshotId },
      coverage: { selectedFileCount: 1, recordedFileCount: 1, unreadableFileCount: 0, unsupportedFileCount: 0, excludedPathCount: 0, inventoryComplete: true, exclusionsAreExplicit: true }, inventory: [record], inventoryPages: 1, factPages: 1, traversalComplete: true,
      fileEvidence: new Map([[record.path, { record, facts: [declaration, fact], factPages: 1 }]]) };
    const proof: KitImportProof = { schemaVersion: "1.1.0", mode: "audit-import-target", snapshotId, importFactId: fact.id, originFile: record.path, sourceSpecifier: fact.sourceSpecifier!, status: "proven-missing", candidatePaths: [], selectionComplete: true, reasonCode: "ABSENT_IN_COMPLETE_JVM_DECLARATION_DOMAIN",
      declarationProof: { scope: "selected-ordinary-jvm-sources", targetKind: "java-type", targetQualifiedName: "com.example.Absent", targetPackageName: "com.example", domainComplete: true, packageWitnessFactIds: [declaration.id], matchingDeclarationFactIds: [], matchingSourcePaths: [], matchingQualifiedNames: [], incompletenessReasons: [] } };
    return { proof, expected: { snapshotId, fact, evidence }, record, declaration };
  }
  it("accepts witnessed complete scoped absence without fabricated filesystem paths", () => {
    const { proof, expected } = sample();
    expect(validateKitImportProof(proof, expected).status).toBe("proven-missing");
  });
  it.each(["witness", "partial", "target", "snapshot", "fact", "scope", "matches", "traversal", "unknown-package", "package-partition", "import-binding"])("rejects unsupported claimed absence: %s", kind => {
    const { proof, expected, record } = sample();
    if (kind === "witness") proof.declarationProof!.packageWitnessFactIds = [];
    if (kind === "partial") record.capabilities.jvmDeclarations = "partial";
    if (kind === "target") proof.declarationProof!.targetQualifiedName = "com.example.Other";
    if (kind === "snapshot") proof.snapshotId = "x".repeat(64);
    if (kind === "fact") proof.importFactId = "unknown";
    if (kind === "scope") (proof.declarationProof as any).scope = "classpath";
    if (kind === "matches") proof.declarationProof!.matchingDeclarationFactIds = ["fabricated"];
    if (kind === "traversal") expected.evidence.traversalComplete = false;
    if (kind === "unknown-package") delete record.jvmPackageName;
    if (kind === "package-partition") proof.declarationProof!.targetPackageName = "com";
    if (kind === "import-binding") { expected.fact.jvmImportTarget!.qualifiedName = "com.example.Other"; proof.declarationProof!.targetQualifiedName = "com.example.Other"; }
    expect(() => validateKitImportProof(proof, expected)).toThrow(KitSourceEvidenceAcquisitionError);
  });
  it("preserves every duplicate candidate and rejects lost declaration provenance", () => {
    const { proof, expected, declaration, record } = sample();
    expected.fact.jvmImportTarget!.qualifiedName = "com.example.Widget";
    expected.fact.sourceSpecifier = "com.example.Widget";
    proof.sourceSpecifier = "com.example.Widget";
    proof.declarationProof!.targetQualifiedName = "com.example.Widget";
    const second = { ...declaration, id: "audit-fact:second" };
    expected.evidence.fileEvidence.get(record.path)!.facts.push(second);
    proof.status = "present";
    proof.declarationProof!.matchingDeclarationFactIds = [declaration.id, second.id];
    proof.declarationProof!.matchingSourcePaths = [record.path, record.path];
    proof.declarationProof!.matchingQualifiedNames = ["com.example.Widget", "com.example.Widget"];
    proof.declarationProof!.packageWitnessFactIds = [declaration.id, second.id];
    expect(validateKitImportProof(proof, expected).declarationProof!.matchingDeclarationFactIds).toHaveLength(2);
    proof.declarationProof!.matchingDeclarationFactIds.pop();
    expect(() => validateKitImportProof(proof, expected)).toThrow();
  });
});

describe("Candidate 04 acquisition contracts", () => {
  const registry = (id: string) => DEFAULT_AUDIT_REGISTRY.filter(d => d.id === id);

  it("retains unknown script-owner accessibility while preserving known nonpublic candidates", async () => {
    const root = project({ "src/declarations.kts": "val marker = 1\nclass ScriptWidget\n", "src/Hidden.kt": "private class Hidden\n" });
    vi.mocked(readBoundedFileText).mockClear();
    const result = await runAudit({ config: config(root), toolRoot: process.cwd(), sourceProviderMode: "kit",
      registry: registry("dead-code-candidate"), kitSourceProviderDependencies: candidate04Deps });
    expect(result.detectorErrors).toEqual([]);
    const script = result.sourceFacts.files.find(f => f.relativePath.endsWith(".kts"))!;
    expect(script.declarations.find(d => d.name === "ScriptWidget")).toMatchObject({ line: 2, exportState: "unknown", exportOrigin: "unknown" });
    expect(result.issues.some(i => i.id.includes("unreferenced-kotlin-declaration") && i.id.includes("ScriptWidget"))).toBe(false);
    expect(result.issues.find(i => i.id.includes("unreferenced-kotlin-declaration") && i.id.includes("Hidden"))).toMatchObject({ severity: "info", confidence: "low", affectedFiles: ["src/Hidden.kt"] });
    expect(vi.mocked(readBoundedFileText).mock.calls.filter(c => /\.(kt|kts)$/.test(c[1]))).toEqual([]);
  }, 120000);

  it.each(["dead-code-candidate", "test-rot"])("honors the existing byte predicate bound for %s without native fallback", async id => {
    const root = project({ "src/main.ts": "export const value = 1\n", "tests/exact.test.ts": "//" + " ".repeat(199998),
      "tests/over.test.ts": "//" + " ".repeat(199999), "tests/fixtures/payload.json": "{}\n" });
    const calls: string[][] = [];
    vi.mocked(readBoundedFileText).mockClear();
    const result = await runAudit({ config: config(root), toolRoot: process.cwd(), sourceProviderMode: "kit", registry: registry(id),
      kitSourceProviderDependencies: { ...candidate04Deps, runCommand: async options => { calls.push([...(options.args ?? [])]); return runMeasuredCommand(options); } } });
    expect(result.exitCode).toBe(0); expect(result.detectorErrors).toEqual([]);
    expect(calls.some(a => a.includes("--contains") && a.includes("tests/exact.test.ts"))).toBe(true);
    expect(calls.some(a => a.includes("--contains") && a.includes("tests/over.test.ts"))).toBe(false);
    expect(vi.mocked(readBoundedFileText).mock.calls.some(c => c[0] === root && c[1].startsWith("tests/"))).toBe(false);
  }, 120000);

  it.each(["primary", "additional"])("skips overbound %s JSON test predicates under the established bound", async kind => {
    const root = project({ "tests/check.test.ts": "// no imports\n", "tests/fixtures/payload.json": kind === "primary" ? " ".repeat(200001) : "{}\n",
      ...(kind === "additional" ? { "tests/fixtures/second.json": " ".repeat(200001) } : {}) });
    const calls: string[][] = [];
    const result = await runAudit({ config: config(root), toolRoot: process.cwd(), sourceProviderMode: "kit", registry: registry("test-rot"),
      kitSourceProviderDependencies: { ...candidate04Deps, runCommand: async options => { calls.push([...(options.args ?? [])]); return runMeasuredCommand(options); } } });
    expect(result.exitCode).toBe(0); expect(result.detectorErrors).toEqual([]);
    const over = kind === "primary" ? "tests/fixtures/payload.json" : "tests/fixtures/second.json";
    expect(calls.some(a => a.includes("--contains") && a.includes(over))).toBe(false);
  }, 120000);

  async function generated(root: string, deps = candidate04Deps, file = "generated/schema.ts") {
    let reader!: KitSourceReader;
    const facts = await collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root),
      requiredPaths: [file], requiredCapabilities: [], capabilitiesForPath: () => [], includeScriptsRoot: false,
      onReader(value) { reader = value; readers.push(value); } }, deps);
    return { facts, reader };
  }
  it.each(["generated/schema.ts", "vendor/schema.py"])("authenticates explicit raw %s without semantic facts or blanket admission", async file => {
    const other = path.posix.join(path.posix.dirname(file), "other.ts");
    const root = project({ [file]: file.endsWith(".py") ? "class Schema:\n    pass\n" : "export type Schema = { id: string }\n", [other]: "export const other = 1\n" });
    vi.mocked(readBoundedFileText).mockClear();
    const { facts, reader } = await generated(root, candidate04Deps, file);
    expect(facts.files).toEqual([]);
    expect(reader.selectedFile(file).contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await reader.occurrences(file, "Schema")).toMatchObject({ complete: true, matchCount: 1 });
    expect(() => reader.selectedFile(other)).toThrow(KitSourceEvidenceAcquisitionError);
    expect(vi.mocked(readBoundedFileText).mock.calls.some(c => c[0] === root)).toBe(false);
    fs.appendFileSync(path.join(root, file), "\n");
    await expect(reader.occurrences(file, "new query")).rejects.toMatchObject({ category: "stale-evidence" });
  }, 120000);
  it("does not grant a previously qualified candidate the new generated raw capability", async () => {
    const root = project({ "generated/schema.ts": "export const schema = 1\n" });
    await expect(generated(root, candidate03Deps)).rejects.toMatchObject({ category: "capability-insufficient" });
  }, 120000);
});

describe("Candidate 05 exact JVM acquisition", () => {
  it.each(["java", "kotlin"])("executes the current %s test-rot fixture with qualified declaration evidence", async language => {
    const original = path.resolve("tests/fixtures/audits/kit-differential-v010", language);
    const files: Record<string, Buffer> = {};
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const source = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(source);
        else files[path.relative(original, source).replace(/\\/g, "/")] = fs.readFileSync(source);
      }
    };
    visit(original);
    const target = project(files);
    vi.mocked(readBoundedFileText).mockClear();
    let executions = 0;
    const detector = DEFAULT_AUDIT_REGISTRY.find(detector => detector.id === "test-rot")!;
    const result = await runAudit({ config: config(target), toolRoot: process.cwd(), sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps,
      registry: [{ ...detector, run: context => { executions++; return detector.run(context); } }] });
    expect(executions).toBe(1);
    expect(result.detectorErrors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.issues.some(issue => issue.description.includes("AbsentWidget") || issue.title.includes("AbsentWidget"))).toBe(true);
    const docs = await runAudit({ config: config(target), toolRoot: process.cwd(), sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps,
      registry: DEFAULT_AUDIT_REGISTRY.filter(d => d.id === "docs-code-mismatch") });
    expect(docs.detectorErrors).toEqual([]);
    expect(docs.issues.some(i => i.id.endsWith(":com.example.AbsentWidget"))).toBe(true);
    expect(vi.mocked(readBoundedFileText).mock.calls.filter(args => /\.(java|kt|kts)$/.test(args[1]))).toEqual([]);
    for (const [relative, bytes] of Object.entries(files)) expect(fs.readFileSync(path.join(original, relative))).toEqual(bytes);
  }, 120000);
});

describe("Candidate 05 owner-authorized requirement witnesses", () => {
  it("matches qualified objects, companions and nested owners without simple-name substitution (M17)", async () => {
    const target = project({
      "package.json": '{"name":"m17-witness","version":"1.0.0"}',
      "src/main/kotlin/com/example/Types.kt": [
        "package com.example", "object SingletonWidget {}", "class Container {",
        " companion object Factory {}", "}", "class DefaultContainer {",
        " companion object {}", "}", "class SupportedWidget {}",
        "class Outer {", " class Inner {", "  companion object DeepFactory {}", " }", "}", "",
      ].join("\n"),
      "README.md": ["Use `com.example.SupportedWidget`.", "Use `com.example.SingletonWidget`.",
        "Use `com.example.Container.Factory`.", "Use `com.example.DefaultContainer.Companion`.",
        "Use `com.example.AbsentWidget`.", "Use `com.example.Outer.Inner.DeepFactory`.",
        "Use `org.example.SingletonWidget`.", "Use `com.example.WrongOwner.Factory`.",
        "Use `SingletonWidget` and `SupportedWidget`.", ""].join("\n"),
    });
    const detector = DEFAULT_AUDIT_REGISTRY.find(d => d.id === "docs-code-mismatch")!;
    let files: SourceFileFacts[] = [];
    vi.mocked(readBoundedFileText).mockClear();
    const result = await runAudit({ config: config(target), toolRoot: process.cwd(), sourceProviderMode: "kit",
      kitSourceProviderDependencies: candidate05Deps,
      registry: [{ ...detector, run: ctx => { files = ctx.sourceFacts!.files; return detector.run(ctx); } }],
    });
    const facts = files.find(f => f.relativePath.endsWith("Types.kt"))!;
    expect(facts.kit?.capabilities.declarations).toBe("complete");
    expect(facts.kit?.capabilities.jvmDeclarations).toBe("complete");
    for (const [name, qualifiedName, ownerKey] of [
      ["SingletonWidget", "com.example.SingletonWidget", null],
      ["Factory", "com.example.Container.Factory", "kotlin/class:Container"],
      ["Companion", "com.example.DefaultContainer.Companion", "kotlin/class:DefaultContainer"],
    ] as const) {
      expect(facts.declarations.find(d => d.name === name)).toMatchObject({ kind: "unknown", providerKind: "object", ownerKey,
        jvmDeclaration: { packageName: "com.example", qualifiedName, role: "type" }, provenance: { producer: "kit" } });
    }
    expect(result.detectorErrors).toEqual([]);
    expect(result.issues.some(i => i.id.includes("SupportedWidget"))).toBe(false);
    const claims = result.issues.map(i => i.id);
    for (const name of ["com.example.SingletonWidget", "com.example.Container.Factory", "com.example.DefaultContainer.Companion",
      "com.example.Outer.Inner.DeepFactory", "SingletonWidget", "SupportedWidget"])
      expect(claims.some(id => id.endsWith(`:${name}`))).toBe(false);
    for (const name of ["com.example.AbsentWidget", "org.example.SingletonWidget", "com.example.WrongOwner.Factory"])
      expect(claims.some(id => id.endsWith(`:${name}`))).toBe(true);
    expect(facts.declarations.find(d => d.name === "DeepFactory")?.jvmDeclaration?.qualifiedName).toBe("com.example.Outer.Inner.DeepFactory");
    expect(result.issues.every(i => i.confidence === "low")).toBe(true);
    expect(vi.mocked(readBoundedFileText).mock.calls.filter(args => /\.(kt|kts)$/.test(args[1]))).toEqual([]);
  }, 120000);

  it("permits the independent bounded file signal while suppressing unknown-export declaration candidacy (M13 revised)", async () => {
    const target = project({ "package.json": '{"name":"m13-witness","version":"1.0.0"}',
      "src/dynamic.py": "__all__ = make_names()\nclass UnknownWidget:\n    pass\n" });
    const detector = DEFAULT_AUDIT_REGISTRY.find(d => d.id === "dead-code-candidate")!;
    let files: SourceFileFacts[] = [];
    const result = await runAudit({ config: config(target), toolRoot: process.cwd(), sourceProviderMode: "kit",
      kitSourceProviderDependencies: candidate05Deps,
      registry: [{ ...detector, run: ctx => { files = ctx.sourceFacts!.files; return detector.run(ctx); } }],
    });
    const facts = files.find(f => f.relativePath === "src/dynamic.py")!;
    expect(facts.declarations.find(d => d.name === "UnknownWidget")).toMatchObject({ exportState: "unknown", exported: false });
    expect(result.issues.some(i => i.id.includes("unreferenced-python-declaration"))).toBe(false);
    // D2 supersedes the original broad file prohibition; unknown exports
    // remain unknown and cannot supply declaration-level absence evidence.
    expect(result.issues.find(i => i.id === "dead-code-candidate:unreferenced-source-file:src/dynamic.py")?.evidence[0]?.message)
      .toContain("No relative import/require specifier");
    const file = result.issues.find(i => i.id === "dead-code-candidate:unreferenced-source-file:src/dynamic.py")!;
    expect(file).toMatchObject({ severity: "low", confidence: "low" });
    expect(file.description).toContain("candidate");
    expect(facts.kit?.capabilities.imports).toBe("complete");
    expect(facts.kit?.capabilities.exports).not.toBe("complete");
  }, 120000);

  it("qualifies an actual partial Java positive while explicitly excluding absence inference (M07)", async () => {
    const target = project({ "package.json": '{"name":"m07-witness","version":"1.0.0"}',
      "src/main/java/com/example/ObservedWidget.java": "package com.example;\npublic class ObservedWidget {}\n/* unclosed comment\n",
      "README.md": "Use `ObservedWidget`. Use `com.example.AbsentWidget`.\n" });
    const detector = DEFAULT_AUDIT_REGISTRY.find(d => d.id === "docs-code-mismatch")!;
    vi.mocked(readBoundedFileText).mockClear();
    const result = await runAudit({ config: config(target), toolRoot: process.cwd(), sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps,
      registry: [{ ...detector, run: ctx => {
        const file = ctx.sourceFacts!.files.find(f => f.relativePath.endsWith("ObservedWidget.java"))!;
        expect(file.parseStatus).toBe("file-level-only");
        expect(file.kit?.capabilities.declarations).toBe("partial");
        expect(file.kit?.capabilities.imports).toBe("partial");
        expect(qualifyKitDeclarationPredicate(file, file.declarations.find(d => d.name === "ObservedWidget")!)).toBe("QUALIFIED_POSITIVE");
        expect(qualifyKitDeclarationPredicate(file)).toBe("UNAVAILABLE");
        return detector.run(ctx);
      } }] });
    expect(result.exitCode).toBe(0);
    expect(result.detectorErrors).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.sourceFacts.warnings.join(" ")).toContain("unmatched claims requiring unavailable evidence are UNAVAILABLE");
    expect(result.sourceFacts.warnings.join(" ")).toContain("Declaration absence inference excluded");
    const report = buildAuditReportModel(result, { target: resolveAuditTarget(target, process.cwd()), registry: [detector] });
    expect(report.sourceFacts.warnings.join(" ")).toContain("unmatched claims requiring unavailable evidence are UNAVAILABLE");
    expect(renderAuditTextReport(report)).toContain("Declaration absence inference excluded");
    expect(vi.mocked(readBoundedFileText).mock.calls.filter(args => args[1].endsWith(".java"))).toEqual([]);
    // A different detector keeps its required declaration/import acquisition.
    await expect(runAudit({ config: config(target), toolRoot: process.cwd(), sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps,
      registry: DEFAULT_AUDIT_REGISTRY.filter(d => ["docs-code-mismatch", "dead-code-candidate"].includes(d.id)) }))
      .rejects.toMatchObject({ category: "capability-insufficient" });
    await expect(runAudit({ config: config(target), toolRoot: process.cwd(), sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps,
      registry: [{ ...detector, run: ctx => {
        const file = ctx.sourceFacts!.files.find(f => f.relativePath.endsWith("ObservedWidget.java"))!;
        const declaration = file.declarations.find(d => d.name === "ObservedWidget")!;
        declaration.kind = "unknown";
        expect(qualifyKitDeclarationPredicate(file, declaration)).toBe("UNAVAILABLE");
        return detector.run(ctx);
      } }] })).rejects.toMatchObject({ category: "capability-insufficient" });
  }, 120000);

  it("keeps complete declaration-name evidence distinct from unavailable script package identity", async () => {
    const target = project({ "src/script.kts": "class ScriptWidget\n",
      "README.md": "Use `ScriptWidget`, `com.example.ScriptWidget`, and `com.example.AbsentWidget`.\n" });
    const result = await runAudit({ config: config(target), toolRoot: process.cwd(), sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps,
      registry: DEFAULT_AUDIT_REGISTRY.filter(d => d.id === "docs-code-mismatch") });
    expect(result.detectorErrors).toEqual([]);
    const file = result.sourceFacts.files.find(f => f.relativePath === "src/script.kts")!;
    expect(file.kit?.capabilities).toMatchObject({ declarations: "complete", jvmDeclarations: "unsupported" });
    expect(result.issues.some(i => i.id.endsWith(":com.example.ScriptWidget"))).toBe(false);
    expect(result.sourceFacts.warnings.join(" ")).toContain("Unavailable claims: com.example.ScriptWidget");
    // Absence of a name from a complete declaration-name domain needs no
    // package-binding inference; same-name unknown identity remains unavailable.
    expect(result.issues.find(i => i.id.endsWith(":com.example.AbsentWidget"))).toMatchObject({ severity: "info", confidence: "low" });
  }, 120000);

  it("does not promote an unsupported producer kind even when it carries a qualified type identity", async () => {
    const target = project({ "src/main/java/com/example/Types.java": "package com.example;\npublic class UnsupportedWidget {}\npublic class SupportedWidget {}\n",
      "README.md": "Use `com.example.UnsupportedWidget` and `com.example.SupportedWidget`.\n" });
    const detector = DEFAULT_AUDIT_REGISTRY.find(d => d.id === "docs-code-mismatch")!;
    // An explicit unknown-kind fault in the real producer's lookup response.
    // Candidate05 normalizes Java records to class, so records are not an
    // unknown-kind witness. Do not pretend the producer emits that kind.
    const runCommand: KitCommandRunner = async options => {
      const result = await runMeasuredCommand(options);
      if (options.args?.includes("--audit-file") && result.ok) {
        const page = JSON.parse(result.stdout);
        for (const fact of page.facts ?? []) if (fact.kind === "declaration" && fact.name === "UnsupportedWidget") fact.declarationKind = "unsupported-kind";
        return { ...result, stdout: JSON.stringify(page) };
      }
      return result;
    };
    const result = await runAudit({ config: config(target), toolRoot: process.cwd(), sourceProviderMode: "kit", kitSourceProviderDependencies: { ...candidate05Deps, runCommand },
      registry: [{ ...detector, run: ctx => {
        const file = ctx.sourceFacts!.files[0];
        const declaration = file.declarations.find(d => d.name === "UnsupportedWidget")!;
        expect(declaration).toMatchObject({ kind: "unknown", providerKind: "unsupported-kind" });
        expect(qualifyKitDeclarationPredicate(file, declaration)).toBe("UNAVAILABLE");
        expect(qualifyKitDeclarationPredicate(file)).toBe("QUALIFIED_NEGATIVE");
        return detector.run(ctx);
      } }] });
    expect(result.detectorErrors).toEqual([]);
    expect(result.issues.find(i => i.id.endsWith(":com.example.UnsupportedWidget"))).toMatchObject({ severity: "info", confidence: "low" });
    expect(result.issues.some(i => i.id.endsWith(":com.example.SupportedWidget"))).toBe(false);
  }, 120000);

  it.each(["unknown-kind", "missing-provenance", "incomplete-domain", "source-identity"])("does not promote %s to a qualified docs claim", async fault => {
    const target = project({ "src/main/kotlin/com/example/Types.kt": "package com.example\nobject SingletonWidget {}\n",
      "README.md": "Use `com.example.SingletonWidget`. Use `com.example.AbsentWidget`.\n" });
    const detector = DEFAULT_AUDIT_REGISTRY.find(d => d.id === "docs-code-mismatch")!;
    await expect(runAudit({ config: config(target), toolRoot: process.cwd(), sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps,
      registry: [{ ...detector, run: ctx => {
        const file = ctx.sourceFacts!.files[0];
        const declaration = file.declarations.find(d => d.name === "SingletonWidget")!;
        expect(qualifyKitDeclarationPredicate(file, declaration)).toBe("QUALIFIED_POSITIVE");
        expect(qualifyKitDeclarationPredicate(file)).toBe("QUALIFIED_NEGATIVE");
        if (fault === "unknown-kind") declaration.providerKind = "unsupported-unknown";
        if (fault === "missing-provenance") declaration.provenance = undefined;
        if (fault === "incomplete-domain") { file.kit!.capabilities.declarations = "partial"; file.kit!.capabilities.jvmDeclarations = "partial"; }
        if (fault === "source-identity") file.relativePath = "src/unselected/Types.kt";
        expect(qualifyKitDeclarationPredicate(file, declaration)).toBe("UNAVAILABLE");
        expect(qualifyKitDeclarationPredicate(file)).toBe("UNAVAILABLE");
        return detector.run(ctx);
      } }] })).rejects.toMatchObject({ category: "capability-insufficient" });
  }, 120000);
});

describe("Python dead-code export origin", () => {
  const detector = DEFAULT_AUDIT_REGISTRY.find(({ id }) => id === "dead-code-candidate")!;
  const declarationId = "dead-code-candidate:unreferenced-python-declaration:src/app.py:class:Calculator";
  async function evaluate(body: string, unknownOrigin?: "unknown" | "missing") {
    const root = project({ "src/app.py": body });
    vi.mocked(readBoundedFileText).mockClear();
    const result = await runAudit({ config: config(root), toolRoot: process.cwd(), sourceProviderMode: "kit",
      kitSourceProviderDependencies: candidate03Deps,
      registry: [{ ...detector, run: (ctx) => {
        if (unknownOrigin) {
          // Remove positive origin evidence without manufacturing an absent __all__.
          for (const file of ctx.sourceFacts?.files ?? []) {
            for (const entry of file.exports) entry.exportOrigin = unknownOrigin === "missing" ? undefined : "unknown";
          }
        }
        return detector.run(ctx);
      } }] });
    expect(result.exitCode).toBe(0);
    expect(result.detectorErrors).toEqual([]);
    expect(vi.mocked(readBoundedFileText).mock.calls.filter((args) => args[1].endsWith(".py"))).toEqual([]);
    return { result, facts: result.sourceFacts.files.find(({ relativePath }) => relativePath === "src/app.py")! };
  }

  it("does not promote conventional exports to explicit __all__ protection", async () => {
    const { result, facts } = await evaluate("class Calculator:\n    pass\n");
    expect(facts.exports).toEqual([expect.objectContaining({ name: "Calculator", exportOrigin: "python-convention" })]);
    expect(facts.kit?.capabilities.exports).toBe("partial");
    expect(result.issues.find(({ id }) => id === declarationId)).toMatchObject({ severity: "info", confidence: "low" });
  }, 120000);

  it("preserves qualified explicit __all__ protection", async () => {
    const { result, facts } = await evaluate('__all__ = ["Calculator"]\nclass Calculator:\n    pass\n');
    expect(facts.exports).toEqual([expect.objectContaining({ name: "Calculator", exportOrigin: "python-all" })]);
    expect(facts.kit?.capabilities.exports).toBe("complete");
    expect(result.issues.some(({ id }) => id === declarationId)).toBe(false);
  }, 120000);

  it("retains the explicit empty __all__ distinction", async () => {
    const { result, facts } = await evaluate("__all__ = []\nclass Calculator:\n    pass\n");
    expect(facts.exports).toEqual([]);
    expect(facts.kit?.capabilities.exports).toBe("complete");
    expect(facts.declarations.find(({ name }) => name === "Calculator")).toMatchObject({ exported: false, exportState: "not-exported" });
    expect(result.issues.some(({ id }) => id === declarationId)).toBe(false);
  }, 120000);

  it.each(["unknown", "missing"] as const)("does not promote %s origin to explicit protection", async (origin) => {
    const { result, facts } = await evaluate("class Calculator:\n    pass\n", origin);
    expect(facts.exports[0].exportOrigin).toBe(origin === "missing" ? undefined : "unknown");
    expect(result.issues.some(({ id }) => id === declarationId)).toBe(true);
  }, 120000);

  it("retains conservative dynamic __all__ declaration uncertainty", async () => {
    const { result, facts } = await evaluate("__all__ = discover_exports()\nclass Calculator:\n    pass\n");
    expect(facts.declarations.find(({ name }) => name === "Calculator")).toMatchObject({ exported: false, exportState: "unknown", exportOrigin: "unknown" });
    expect(result.issues.some(({ id }) => id === declarationId)).toBe(false);
  }, 120000);

  it("preserves multiline explicit exports and nested declaration ownership", async () => {
    const { result, facts } = await evaluate([
      "__all__ = [", '    "PublicContainer",', "]",
      "class PublicContainer:", "    class InnerWidget:", "        pass",
      "class HiddenWidget:", "    pass", "",
    ].join("\n"));
    expect(facts.kit?.capabilities.exports).toBe("complete");
    expect(facts.exports).toEqual([expect.objectContaining({ name: "PublicContainer", exportOrigin: "python-all" })]);
    expect(facts.declarations.find(({ name }) => name === "InnerWidget")).toMatchObject({
      line: 5, exported: false, exportState: "not-exported", ownerKey: "python/class:PublicContainer",
    });
    expect(facts.declarations.find(({ name }) => name === "HiddenWidget")).toMatchObject({
      line: 7, exported: false, exportState: "not-exported",
    });
    // The existing Python predicate requires positive exported evidence and
    // exempts qualified explicit __all__. This does not equate legacy facts.
    expect(result.issues.filter(({ id }) => id.includes("unreferenced-python-declaration"))).toEqual([]);
  }, 120000);

  it("restores actual Calculator candidacy while retaining the 0 versus 2 export-count difference", async () => {
    const root = path.resolve("tests/fixtures/audits/mixed-language/mixed-python-ts");
    const invoke = (sourceProviderMode: "kit") => runAudit({ config: config(root), toolRoot: process.cwd(),
      sourceProviderMode, registry: [detector], kitSourceProviderDependencies: candidate03Deps });
    const legacy = historicalAccepted("tests/fixtures/audits/mixed-language/mixed-python-ts", "dead-code-candidate"), kit = await invoke("kit");
    expect([legacy.exitCode, kit.exitCode]).toEqual([0, 0]);
    expect(kit.detectorErrors).toEqual([]);
    const finding = legacy.issues.find(({ id }) => id === declarationId)!;
    expect(finding).toMatchObject({ severity: "info", confidence: "low", affectedFiles: ["src/app.py"] });
    expect(kit.issues.find(({ id }) => id === declarationId)).toEqual(finding);
    expect(kit.issues.map(({ id }) => id).sort()).toEqual(legacy.issues.map(({ id }) => id).sort());
    expect(kit.sourceFacts.files.find(({ relativePath }) => relativePath === "src/app.py")?.declarations.find(({ name }) => name === "Calculator")?.line).toBe(5);
    const fileId = "dead-code-candidate:unreferenced-source-file:src/app.py";
    const legacyFile = legacy.issues.find(({ id }) => id === fileId)!;
    const kitFile = kit.issues.find(({ id }) => id === fileId)!;
    expect(legacyFile.evidence.some(({ message }) => message.includes("recorded 0 export(s)"))).toBe(true);
    expect(kitFile.evidence.some(({ message }) => message.includes("recorded 2 export(s)"))).toBe(true);
    const legacyMessage = legacyFile.evidence.find(({ message }) => message.includes("recorded 0 export(s)"))!.message;
    const kitMessage = kitFile.evidence.find(({ message }) => message.includes("recorded 2 export(s)"))!.message;
    expect(legacyMessage).toContain('Source facts for "src/app.py" (python)');
    expect(kitMessage).toContain('Source facts for "src/app.py" (python)');
    expect(legacyMessage).toContain("origin metadata: none recorded");
    expect(kitMessage).toContain("origin metadata: python-convention");
    expect(kitMessage).not.toBe(legacyMessage); // Accurate attribution does not establish evidence parity.
    expect({ ...kitFile, evidence: legacyFile.evidence }).toEqual(legacyFile);
  }, 120000);
});

describe("dead-code export-count attribution", () => {
  const detector = DEFAULT_AUDIT_REGISTRY.find(({ id }) => id === "dead-code-candidate")!;
  async function evaluate(file: string, body: string, mutate?: (facts: SourceFileFacts) => void) {
    const root = project({ [file]: body });
    vi.mocked(readBoundedFileText).mockClear();
    const result = await runAudit({ config: config(root), toolRoot: process.cwd(), sourceProviderMode: "kit",
      kitSourceProviderDependencies: candidate03Deps, registry: [{ ...detector, run: (ctx) => {
        const facts = ctx.sourceFacts?.files.find(({ relativePath }) => relativePath === file);
        if (facts) mutate?.(facts);
        return detector.run(ctx);
      } }] });
    expect(result.exitCode).toBe(0);
    expect(result.detectorErrors).toEqual([]);
    expect(vi.mocked(readBoundedFileText).mock.calls.filter((args) => args[1].endsWith(path.extname(file)))).toEqual([]);
    const facts = result.sourceFacts.files.find(({ relativePath }) => relativePath === file)!;
    const finding = result.issues.find(({ id }) => id === `dead-code-candidate:unreferenced-source-file:${file}`)!;
    const evidence = finding.evidence.find(({ message }) => message.includes("recorded "))!;
    expect(evidence).toMatchObject({ kind: "reference", filePath: file, source: "dead-code-candidate", confidence: "medium" });
    expect(evidence.message).toContain(`recorded ${facts.exports.length} export(s), ${facts.declarations.length} declaration(s), and ${facts.imports.length} import(s)`);
    expect(evidence.message).toContain("cross-provider count equivalence is not established");
    return { facts, message: evidence.message };
  }

  it.each([
    ["python", "src/app.py", "class AttributionWidget:\n    pass\n"],
    ["typescript", "src/app.ts", "export class AttributionWidget {}\n"],
    ["javascript", "src/app.js", "export class AttributionWidget {}\n"],
    ["java", "src/AttributionWidget.java", "public class AttributionWidget {}\n"],
  ])("attributes recorded counts to the actual %s file", async (language, file, body) => {
    const { facts, message } = await evaluate(file, body);
    expect(facts.exports).toHaveLength(1);
    expect(message).toContain(`Source facts for "${file}" (${language})`);
    expect(message).not.toContain("TypeScript/JavaScript analyzer");
    for (const entry of facts.exports) expect(message).toContain(entry.exportOrigin!);
    if (language === "python") {
      expect(message).toContain("python-convention");
      expect(message).not.toContain("__all__");
    }
  }, 120000);

  it("retains qualified explicit origin metadata without redefining the count", async () => {
    const { facts, message } = await evaluate("src/app.py", '__all__ = ["AttributionWidget"]\nclass AttributionWidget:\n    pass\n');
    expect(facts.kit?.capabilities.exports).toBe("complete");
    expect(facts.exports).toHaveLength(1);
    expect(message).toContain("origin metadata: python-all");
  }, 120000);

  it.each(["unknown", undefined])("does not invent provenance for %s origin", async (origin) => {
    const { message } = await evaluate("src/app.py", "class AttributionWidget:\n    pass\n", (facts) => {
      for (const entry of facts.exports) entry.exportOrigin = origin;
    });
    expect(message).toContain(`origin metadata: ${origin ?? "unspecified"}`);
    expect(message).not.toContain("python-convention");
    expect(message).not.toContain("__all__");
  }, 120000);

  it("keeps unsupported language attribution neutral", async () => {
    const { message } = await evaluate("src/app.ts", "export const evidenceOnly = 1;\n", (facts) => {
      facts.language = "unknown";
    });
    expect(message).toContain('Source facts for "src/app.ts" (unknown)');
    expect(message).not.toContain("(typescript)");
  }, 120000);
});

describe("Java declaration owner evidence consumption", () => {
  it.each([false, true])("retains enclosing public=%s evidence independently in both detectors", async (publicOwner) => {
    const root = project({
      "src/Container.java": `${publicOwner ? "public " : ""}class Container {\n  public class SharedWidget {}\n}\n`,
      "src/SharedWidget.java": "public class SharedWidget {}\n",
    });
    const registry = DEFAULT_AUDIT_REGISTRY.filter(({ id }) =>
      id === "dead-code-candidate" || id === "duplicate-implementation-candidate");
    vi.mocked(readBoundedFileText).mockClear();
    const result = await runAudit({ config: config(root), toolRoot: process.cwd(), sourceProviderMode: "kit",
      registry, kitSourceProviderDependencies: candidate03Deps });
    expect(result.exitCode).toBe(0);
    expect(result.detectorErrors).toEqual([]);
    expect(vi.mocked(readBoundedFileText).mock.calls.filter((args) => args[1].endsWith(".java"))).toEqual([]);
    const nested = result.sourceFacts.files.find(({ relativePath }) => relativePath === "src/Container.java")!
      .declarations.find(({ name }) => name === "SharedWidget")!;
    expect(nested).toMatchObject({ line: 2, exported: publicOwner,
      exportState: publicOwner ? "exported" : "not-exported" });
    expect(nested.ownerKey).toBeTruthy();
    const topLevel = result.sourceFacts.files.find(({ relativePath }) => relativePath === "src/SharedWidget.java")!
      .declarations.find(({ name }) => name === "SharedWidget")!;
    expect(topLevel).toMatchObject({ line: 1, exported: true, exportState: "exported" });
    const deadCode = result.issues.find(({ id }) =>
      id === "dead-code-candidate:unreferenced-java-declaration:src/Container.java:class:SharedWidget");
    expect(Boolean(deadCode)).toBe(!nested.exported);
    if (deadCode) expect(deadCode).toMatchObject({ severity: "info", confidence: "low", affectedFiles: ["src/Container.java"] });
    const duplicate = result.issues.find(({ id }) => id.includes("duplicate-declaration-candidate:class:sharedwidget"));
    expect(Boolean(duplicate)).toBe(nested.exported && topLevel.exported);
    // These witnesses lock consumer predicates against qualified facts. They
    // do not authorize replacing the legacy visibility policy or its counts.
  }, 120000);
});

describe("unchanged Java dead-code JSON acquisition", () => {
  it("rejects explicitly required JSON semantic evidence", async () => {
    const root = path.resolve("tests/fixtures/audits/kit-differential-v010/java");
    await expect(collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root),
      requiredPaths: ["tests/fixtures/payload.json"], requiredCapabilities: ["imports"], includeScriptsRoot: false }, candidate03Deps))
      .rejects.toMatchObject({ category: "capability-insufficient" });
  }, 120000);

  it("completes with qualified raw JSON and no native content fallback", async () => {
    const root = path.resolve("tests/fixtures/audits/kit-differential-v010/java");
    const calls: string[][] = [], occurrences: KitOccurrence[] = [], inventoryPages: { files?: { path: string; contentSha256: string; status: string }[] }[] = [];
    vi.mocked(readBoundedFileText).mockClear();
    const result = await runAudit({ config: config(root), toolRoot: process.cwd(), sourceProviderMode: "kit",
      registry: DEFAULT_AUDIT_REGISTRY.filter(({ id }) => id === "dead-code-candidate"),
      kitSourceProviderDependencies: { ...candidate03Deps, runCommand: async (options) => {
        calls.push([...(options.args ?? [])]);
        const result = await runMeasuredCommand(options);
        try {
          const value = JSON.parse(result.stdout);
          if (value.mode === "exact-file-occurrence") occurrences.push(value);
          if (value.mode === "audit-files") inventoryPages.push(value);
        } catch { /* Command validation owns malformed output. */ }
        return result;
      } } });
    expect(result.exitCode).toBe(0);
    expect(result.detectorErrors).toEqual([]);
    const index = calls.filter((args) => args.includes("index"));
    expect(index).toHaveLength(1);
    expect(index[0]).toEqual(expect.arrayContaining(["src", "tests/fixtures"]));
    expect(inventoryPages.flatMap((page) => page.files ?? []).find(({ path }) => path === "tests/fixtures/payload.json"))
      .toMatchObject({ status: "unsupported", contentSha256: "ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356" });
    const raw = occurrences.filter(({ filePath }) => filePath === "tests/fixtures/payload.json");
    expect(raw.map(({ value }) => value).sort()).toEqual(["from", "payload.json", "require("]);
    expect(raw.every(({ complete, truncated }) => complete && !truncated)).toBe(true);
    expect(vi.mocked(readBoundedFileText).mock.calls.filter((args) => args[1].endsWith(".java") || args[1].endsWith("payload.json"))).toEqual([]);
    // Acquisition succeeds; the existing nested-declaration difference stays visible.
    expect(result.issues).toHaveLength(6);
    expect(result.issues.some(({ id }) => id.endsWith(":class:NestedPublicWidget"))).toBe(true);
  }, 120000);
});

describe("real installed candidate exact-file reader", () => {
  let root: string, reader: KitSourceReader, facts: Awaited<ReturnType<typeof acquire>>["facts"];
  const calls: string[][] = [];
  beforeAll(async () => {
    root = project({ "src/a.ts": "// payload.json [a.*] payload.json\nexport class A {}\n", "src/b.js": "// payload.json\nexport class B {}\n",
      "py/a.py": "# payload.json\nclass P: pass\n", "src/A.java": "// payload.json\npublic class A {}\n", "src/B.kt": "// payload.json\nclass B\n",
      "src/peer.ts": "export class Peer {}\n", "src/peer.js": "export class Peer {}\n", "tests/check.test.ts": 'import "../src/peer";\nimport "../src/missing";\n' });
    ({ reader, facts } = await acquire(root, async (options) => { calls.push([...(options.args ?? [])]); return runMeasuredCommand(options); }));
  }, 120000);
  it.each(["src/a.ts", "src/b.js", "py/a.py", "src/A.java", "src/B.kt"])("uses literal evidence for %s including comments", async (file) => {
    const result = await reader.occurrences(file, "payload.json");
    expect(result.complete).toBe(true); expect(result.matches[0]).toMatchObject({ line: 1, column: 4 - (file.endsWith(".py") ? 1 : 0), windowStart: 1 });
    expect(result.matchCount).toBe(file.endsWith("a.ts") ? 2 : 1); expect(result.returnedMatches).toBe(result.matchCount);
    expect(result.matches[0]?.content).toContain("payload.json");
  });
  it("preserves complete zero matches and literal regex metacharacters", async () => {
    expect(await reader.occurrences("src/a.ts", "absent")).toMatchObject({ complete: true, matchCount: 0, truncated: false });
    expect(await reader.occurrences("src/a.ts", "[a.*]")).toMatchObject({ complete: true, matchCount: 1 });
  });
  it("shares identical acquisitions within the snapshot", async () => {
    await Promise.all([reader.occurrences("src/a.ts", "cache"), reader.occurrences("src/a.ts", "cache")]);
    expect(calls.filter((args) => args.includes("cache"))).toHaveLength(1);
  });
  it("queries actual validated import fact IDs, including ambiguous presence and proven absence", async () => {
    const imports = facts.files.find((f) => f.relativePath === "tests/check.test.ts")!.imports;
    expect(await reader.importTarget(imports[0]!.provenance!.factId)).toMatchObject({ status: "present", reasonCode: "MULTIPLE_TARGETS_IN_SELECTED_INVENTORY" });
    expect(await reader.importTarget(imports[1]!.provenance!.factId)).toMatchObject({ status: "proven-missing", selectionComplete: true });
    expect(() => reader.importTarget("invented")).toThrow(/validated fact/);
  });
  it("rejects unselected file identities", () => { expect(() => reader.occurrences("src/no.ts", "x")).toThrow(/coverage/); });
  it("does not reuse cache across changed snapshots", async () => {
    const other = project({ "src/a.ts": "// different snapshot\n" }); const acquired = await acquire(other);
    expect(acquired.reader.snapshotId).not.toBe(reader.snapshotId);
    expect(await acquired.reader.occurrences("src/a.ts", "payload.json")).toMatchObject({ complete: true, matchCount: 0 });
  }, 120000);
  it.each(["stale", "deleted"])("rejects %s source after acquisition", async (kind) => {
    const target = project({ "src/a.ts": "export const a = 1;\n" }); const { reader } = await acquire(target);
    if (kind === "stale") fs.appendFileSync(path.join(target, "src/a.ts"), "// changed"); else fs.unlinkSync(path.join(target, "src/a.ts"));
    await expect(reader.occurrences("src/a.ts", "not queried before")).rejects.toMatchObject({ category: "stale-evidence" });
  }, 120000);
  it.each(["cap", "bytes", "utf8"])("retains incomplete %s evidence, never absence", async (kind) => {
    const body = kind === "cap" ? "// x\n".repeat(201) : kind === "bytes" ? "// padding\n".repeat(20001) : Buffer.from([47,47,255,10]);
    const { reader } = await acquire(project({ "src/a.ts": body }));
    const result = await reader.occurrences("src/a.ts", kind === "cap" ? "x" : "absent");
    expect(result.complete).toBe(false); expect(() => requireCompleteKitOccurrence(result)).toThrow(/incomplete/);
    if (kind === "cap") expect(result).toMatchObject({ returnedMatches: 200, truncated: true });
  }, 120000);
  it("does not invent adjacency from insufficient context", async () => {
    const { reader } = await acquire(project({ "src/a.ts": "// first\n".repeat(100) + "// shell: true\n" + "// last\n".repeat(100) }));
    await expect(kitPredicateContent(reader, "src/a.ts", ["shell:"])).rejects.toThrow(/contiguous/);
  }, 120000);
  it("retains real outside-selection and JVM indeterminate import proofs", async () => {
    const target = project({ "src/peer.ts": "export class Peer {}\n", "tests/check.test.ts": 'import "../src/peer";\n',
      "tests/SomeTest.java": 'import com.example.AbsentWidget;\npublic class SomeTest {}\n' });
    let selected!: KitSourceReader;
    const facts = await collectKitSourceFacts({ targetRoot: target, inventory: scanProjectInventory(target), requiredCapabilities: [], includeScriptsRoot: false,
      requiredPaths: ["tests/check.test.ts", "tests/SomeTest.java"], onReader(reader) { selected = reader; readers.push(reader); } }, { installedPackageRoot: candidate, expectation: historicalCandidate01 });
    const ts = facts.files.find((file) => file.relativePath === "tests/check.test.ts")!;
    expect(await selected.importTarget(ts.imports[0]!.provenance!.factId)).toMatchObject({ status: "outside-selected-roots", selectionComplete: true });
    const java = facts.files.find((file) => file.relativePath === "tests/SomeTest.java")!;
    expect(await selected.importTarget(java.imports[0]!.provenance!.factId)).toMatchObject({ status: "indeterminate" });
  }, 120000);
  it.each(["source", "proof", "json", "throw"])("propagates failed %s command", async (kind) => {
    const target = project({ "src/a.ts": 'import "./missing";\n' });
    const { reader, facts } = await acquire(target, async (options) => {
      const args = options.args ?? [];
      if (kind === "throw" && args.includes("--contains")) throw new Error("executor unavailable");
      if (kind === "json" && args.includes("--contains")) return { ...(await runMeasuredCommand(options)), stdout: "not JSON" };
      if (args.includes(kind === "source" ? "--contains" : "--audit-import-target")) return { ...(await runMeasuredCommand({ commandId: options.commandId, cwd: options.cwd, outDir: options.outDir, executable: process.execPath, args: ["-e", "process.exit(2)"], resolveCommand: false })), ok: false };
      return runMeasuredCommand(options);
    });
    await expect(kind !== "proof" ? reader.occurrences("src/a.ts", "x") : reader.importTarget(facts.files[0]!.imports[0]!.provenance!.factId)).rejects.toMatchObject({ category: kind === "json" ? "invalid-json" : "subprocess-failed" });
  }, 120000);
});

describe("strict response validation", () => {
  const file = { path: "src/a.ts", contentSha256: "a".repeat(64), sizeBytes: 1, lineCount: 1 } as ReturnType<KitSourceReader["selectedFile"]>;
  const good: KitOccurrence = { schemaVersion: "1.0.0", mode: "exact-file-occurrence", snapshotId: "a".repeat(64), filePath: file.path, value: "x", complete: true,
    scannedBytes: 1, reasonCode: null, matchCount: 1, returnedMatches: 1, truncated: false, matches: [{ line: 1, column: 1, windowStart: 1, windowEnd: 1, content: "x" }] };
  it.each([
    { mode: "source" }, { schemaVersion: "2" }, { snapshotId: "wrong" }, { filePath: "src/b.ts" }, { value: "y" },
    { matchCount: -1 }, { returnedMatches: 201 }, { scannedBytes: 200001 }, { complete: undefined }, { truncated: true },
    { matches: [] }, { matches: [{ line: 0, column: 1, windowStart: 1, windowEnd: 1, content: "x" }] },
    { matches: [{ line: 1, column: 2, windowStart: 1, windowEnd: 1, content: "x" }] }, { complete: false, reasonCode: null },
  ])("rejects malformed or inconsistent occurrence %j", (patch) => {
    expect(() => validateKitOccurrence({ ...good, ...patch }, { snapshotId: good.snapshotId, file, value: "x" })).toThrow(KitSourceEvidenceAcquisitionError);
  });
  it("rejects complete evidence without a content hash", () => { expect(() => validateKitOccurrence(good, { snapshotId: good.snapshotId, file: { ...file, contentSha256: null }, value: "x" })).toThrow(); });
  it.each(["outside-selected-roots", "indeterminate"])("preserves %s without upgrading it", (status) => {
    const fact = { id: "known", span: { path: file.path }, sourceSpecifier: "./x" } as KitFact;
    const result = validateKitImportProof({ schemaVersion: "1.0.0", mode: "audit-import-target", snapshotId: good.snapshotId, importFactId: "known", originFile: file.path,
      sourceSpecifier: "./x", status, candidatePaths: [], selectionComplete: false, reasonCode: "UNDETERMINED" }, { snapshotId: good.snapshotId, fact });
    expect(result.status).toBe(status);
  });
});

describe("detector integration and fatal boundary", () => {
  it("does not broaden Kit proven-missing into the legacy candidate policy", async () => {
    const root = project({ "src/peer.ts": "export class Peer {}\n", "tests/check.test.ts": 'import "../src/peer";\nimport "../src/missing";\n' });
    const registry = DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot");
    const left = await runAudit({ config: config(root), toolRoot: process.cwd(), registry, sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps });
    await expect(runAudit({ config: config(root), toolRoot: process.cwd(), registry, sourceProviderMode: "kit", kitSourceProviderDependencies: { installedPackageRoot: candidate, expectation: historicalCandidate01 } })).rejects.toThrow(/legacy .mjs\/extensionless/);
    expect(left.issues.some((issue) => issue.id.includes("missing-source-import"))).toBe(true);
  }, 120000);
  it("witnesses the real .mjs candidate counterexample without a false missing-source finding", async () => {
    const root = project({ "src/peer.mjs": 'export const peer = 1;\n', "tests/check.test.ts": 'import "../src/peer";\n' });
    const registry = DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot");
    const left = await runAudit({ config: config(root), toolRoot: process.cwd(), registry, sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps });
    expect(left.issues).toEqual([]);
    await expect(runAudit({ config: config(root), toolRoot: process.cwd(), registry, sourceProviderMode: "kit", kitSourceProviderDependencies: { installedPackageRoot: candidate, expectation: historicalCandidate01 } })).rejects.toThrow(/legacy .mjs\/extensionless/);
  }, 120000);
  it.each(["tests/test_check.py", "tests/CheckTest.java", "tests/CheckTest.kt"])("preserves neutral npm-run policy in %s with CRLF", async (file) => {
    const marker = file.endsWith(".py") ? "#" : "//";
    const root = project({ [file]: `${marker} npm run vanished\r\n${marker} ${onlyCall}("v0.1.0", () => {});\r\n` });
    const registry = DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot");
    const left = await runAudit({ config: config(root), toolRoot: process.cwd(), registry, sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps });
    const right = await runAudit({ config: config(root), toolRoot: process.cwd(), registry, sourceProviderMode: "kit", kitSourceProviderDependencies: { installedPackageRoot: candidate, expectation: historicalCandidate01 } });
    expect(right.issues).toEqual(left.issues);
    expect(right.issues.some((issue) => issue.title.includes("npm run vanished"))).toBe(true);
  }, 120000);
  it("preserves ordinary detector isolation but propagates required Kit errors inside run", async () => {
    const root = project({});
    const make = (error: Error): AuditDetector => ({ id: "stale-command-reference", auditType: "code-rot", title: "test", description: "test", supportedIncludeAreas: ["docs"], run() { throw error; } });
    const ordinary = await runAudit({ config: config(root), toolRoot: process.cwd(), registry: [make(new Error("ordinary"))], sourceProviderMode: "kit" });
    expect(ordinary.detectorErrors).toHaveLength(1);
    await expect(runAudit({ config: config(root), toolRoot: process.cwd(), registry: [make(new KitSourceEvidenceAcquisitionError("subprocess-failed", "required query"))], sourceProviderMode: "kit" })).rejects.toMatchObject({ category: "subprocess-failed" });
  });
  it("preserves skip/only/npm/title and cross-platform finding identities through Kit context", async () => {
    const root = project({ "package.json": '{"name":"reader","version":"1.0.0","scripts":{}}',
      "tests/check.test.ts": `// ${skipCall}("comment", () => {});\n${onlyCall}("v0.1.0", () => {});\n// npm run vanished\n`,
      "src/audits/a.ts": 'text.split("\\n");\npath.split("\\\\");\nspawn("cmd", { shell: true });\n' });
    const registry = DEFAULT_AUDIT_REGISTRY.filter((d) => ["test-rot", "cross-platform-rot"].includes(d.id));
    const left = await runAudit({ config: config(root), toolRoot: process.cwd(), registry, sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps });
    expect(vi.mocked(readBoundedFileText).mock.calls.some((call) => call[0] === root && call[1].endsWith(".ts"))).toBe(false);
    vi.mocked(readBoundedFileText).mockClear();
    const before = ["package.json", "tests/check.test.ts", "src/audits/a.ts"].map((file) => fs.readFileSync(path.join(root, file)));
    const right = await runAudit({ config: config(root), toolRoot: process.cwd(), registry, sourceProviderMode: "kit", kitSourceProviderDependencies: { installedPackageRoot: candidate, expectation: historicalCandidate01 } });
    expect(right.issues).toEqual(left.issues); expect(right.detectorErrors).toEqual([]); expect(right.issues.length).toBeGreaterThan(4);
    expect(vi.mocked(readBoundedFileText).mock.calls.some((call) => call[0] === root && call[1].endsWith(".ts"))).toBe(false);
    expect(["package.json", "tests/check.test.ts", "src/audits/a.ts"].map((file) => fs.readFileSync(path.join(root, file)))).toEqual(before);
  }, 120000);
  it("rejects a missing Kit reader instead of invoking native source acquisition", async () => {
    const root = project({ "tests/check.test.ts": '// npm run vanished\n' });
    const original = DEFAULT_AUDIT_REGISTRY.find((d) => d.id === "test-rot")!;
    vi.mocked(readBoundedFileText).mockClear();
    await expect(runAudit({ config: config(root), toolRoot: process.cwd(), registry: [{ ...original, run(ctx) { return original.run({ ...ctx, kitSourceReader: undefined }); } }],
      sourceProviderMode: "kit", kitSourceProviderDependencies: { installedPackageRoot: candidate, expectation: historicalCandidate01 } })).rejects.toMatchObject({ category: "invalid-request" });
    expect(vi.mocked(readBoundedFileText).mock.calls.some((call) => call[0] === root)).toBe(false);
  }, 120000);
  it.each([true, false])("fixture basename referenced=%s retains the weak candidate", async (referenced) => {
    const root = project({ "tests/check.test.ts": referenced ? '// payload.json\n' : '// no fixture\n', "fixtures/payload.json": '{}' });
    const cfg = normalizeAuditConfig({ target: root, types: "code-rot", include: "tests", failOn: "none" }, process.cwd());
    const result = await runAudit({ config: cfg, toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "dead-code-candidate"), sourceProviderMode: "kit", kitSourceProviderDependencies: { installedPackageRoot: candidate, expectation: historicalCandidate01 } });
    expect(result.issues.some((i) => i.title.includes('Fixture'))).toBe(!referenced);
    if (!referenced) expect(result.issues.find((i) => i.title.includes('Fixture'))).toMatchObject({ severity: "info", confidence: "low" });
  }, 120000);
  it.each(["unsupported", "one-incomplete"])("does not certify fixture absence with %s selected tests", async (kind) => {
    const root = project({ "tests/check.test.ts": '// no fixture\n', "fixtures/payload.json": '{}',
      ...(kind === "unsupported" ? { "tests/data.json": '{}' } : { "tests/many.test.ts": '// payload.json\n'.repeat(201) }) });
    const cfg = normalizeAuditConfig({ target: root, types: "code-rot", include: "tests", failOn: "none" }, process.cwd());
    await expect(runAudit({ config: cfg, toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "dead-code-candidate"),
      sourceProviderMode: "kit", kitSourceProviderDependencies: { installedPackageRoot: candidate, expectation: historicalCandidate01 } })).rejects.toBeInstanceOf(KitSourceEvidenceAcquisitionError);
  }, 120000);
});

it("keeps original ambiguous JSON content evidence required with Candidate 02", async () => {
  const root = path.resolve("tests/fixtures/audits/kit-differential-v010/ambiguous");
  const candidate02 = path.resolve(".my-dev-kit-workflow/tools/v010-lab-kit-gate4/kit-candidate-02/node_modules/@dailephd/my-dev-kit");
  const { QUALIFIED_KIT_CANDIDATE } = await import("../../src/audits/core/kitSourceProvider.js");
  const registry = DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot");
  const legacy = await runAudit({ config: config(root), toolRoot: process.cwd(), registry, sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps });
  // The path is now explicitly selected; Candidate 02 still lacks qualified JSON raw content.
  await expect(runAudit({ config: config(root), toolRoot: process.cwd(), registry, sourceProviderMode: "kit", kitSourceProviderDependencies: { installedPackageRoot: candidate02, expectation: { ...historicalCandidate01, cliSha256: "c024614168a747764811926a403fb7e75d32c8b7be77d7a7cba16344d8848c1e" } } })).rejects.toMatchObject({ category: "capability-insufficient", message: expect.stringContaining("tests/fixtures/payload.json") });
  const id = "test-rot:tests/check.sample.ts:missing-source-import:../src/absent";
  expect(legacy.issues.find((issue) => issue.id === id)).toMatchObject({ severity: "medium", confidence: "high" });
}, 120000);

it("consumes mixed Candidate 02 import proofs without a JSON fixture", async () => {
  const root = project({ "src/peer.ts": "export const peer = 1;\n", "tests/check.test.ts": 'import "../src/peer";\nimport "../src/absent";\n' });
  const candidate02 = path.resolve(".my-dev-kit-workflow/tools/v010-lab-kit-gate4/kit-candidate-02/node_modules/@dailephd/my-dev-kit");
  const { QUALIFIED_KIT_CANDIDATE } = await import("../../src/audits/core/kitSourceProvider.js");
  const registry = DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot");
  const result = await runAudit({ config: config(root), toolRoot: process.cwd(), registry, sourceProviderMode: "kit", kitSourceProviderDependencies: { installedPackageRoot: candidate02, expectation: { ...historicalCandidate01, cliSha256: "c024614168a747764811926a403fb7e75d32c8b7be77d7a7cba16344d8848c1e" } } });
  expect(result.issues.filter((issue) => issue.id.includes("missing-source-import"))).toMatchObject([{ id: "test-rot:tests/check.test.ts:missing-source-import:../src/absent", severity: "medium", confidence: "high" }]);
}, 120000);

it.each([false, true])("qualifies verified producer semantics for peer.mjs Candidate02=%s", async (second) => {
  const root = project({ "src/peer.mjs": "export const peer = 1;\n", "tests/check.test.ts": 'import "../src/peer";\n' });
  const { QUALIFIED_KIT_CANDIDATE } = await import("../../src/audits/core/kitSourceProvider.js");
  const installedPackageRoot = second ? path.resolve(".my-dev-kit-workflow/tools/v010-lab-kit-gate4/kit-candidate-02/node_modules/@dailephd/my-dev-kit") : candidate;
  const deps = { installedPackageRoot, expectation: { ...historicalCandidate01, cliSha256: second ? "c024614168a747764811926a403fb7e75d32c8b7be77d7a7cba16344d8848c1e" : historicalCandidate01.cliSha256 } };
  let reader!: KitSourceReader;
  const facts = await collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root), requiredCapabilities: [], includeScriptsRoot: true, onReader(value) { reader = value; readers.push(value); } }, deps);
  const imp = facts.files.find((file) => file.relativePath === "tests/check.test.ts")!.imports[0]!;
  expect(await reader.importTarget(imp.provenance!.factId)).toMatchObject({ status: second ? "present" : "proven-missing", selectionComplete: true });
  expect(reader.jsTsRelativeImportCandidateProof).toBe(second ? "mjs-extensionless-complete-v1" : undefined);
  expect(reader.jsonRawLiteralContent).toBeUndefined();
  const audit = runAudit({ config: config(root), toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot"), sourceProviderMode: "kit", kitSourceProviderDependencies: deps });
  if (second) expect((await audit).issues).toEqual([]);
  else await expect(audit).rejects.toMatchObject({ category: "capability-insufficient" });
}, 120000);

describe("Candidate 03 separate proof and JSON raw contracts", () => {
  const original = path.resolve("tests/fixtures/audits/kit-differential-v010/ambiguous");
  async function selected(root: string, runCommand?: KitCommandRunner) {
    let reader!: KitSourceReader;
    const facts = await collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root), requiredCapabilities: [], includeScriptsRoot: true,
      onReader(value) { reader = value; readers.push(value); } }, { ...candidate03Deps, runCommand });
    return { reader, facts };
  }
  it("qualifies installed Candidate 03 positive and absent proofs independently of metadata", async () => {
    const { reader, facts } = await selected(original);
    expect(reader.jsTsRelativeImportCandidateProof).toBe("mjs-extensionless-complete-v1");
    expect(reader.jsonRawLiteralContent).toBe("selected-test-json-v1");
    const imports = facts.files.find((f) => f.relativePath === "tests/check.sample.ts")!.imports;
    expect(await reader.importTarget(imports[0]!.provenance!.factId)).toMatchObject({ status: "present" });
    expect(await reader.importTarget(imports[1]!.provenance!.factId)).toMatchObject({ status: "proven-missing", selectionComplete: true });
  }, 120000);
  it("preserves valid Candidate 01 positive existence without absence qualification", async () => {
    const root = project({ "src/peer.ts": "export const peer = 1;\n", "tests/check.test.ts": 'import "../src/peer";\n' });
    const result = await runAudit({ config: config(root), toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot"), sourceProviderMode: "kit", kitSourceProviderDependencies: { installedPackageRoot: candidate, expectation: historicalCandidate01 } });
    expect(result.issues).toEqual([]); expect(result.exitCode).toBe(0);
  }, 120000);
  it("completes the unchanged mixed-ts-js index target with installed Candidate 03", async () => {
    const root = path.resolve("tests/fixtures/audits/mixed-language/mixed-ts-js");
    const registry = DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot");
    const legacy = await runAudit({ config: config(root), toolRoot: process.cwd(), registry, sourceProviderMode: "kit", kitSourceProviderDependencies: candidate05Deps });
    expect(legacy.issues).toEqual([]); expect(legacy.exitCode).toBe(0);
    const { reader, facts } = await selected(root);
    const imp = facts.files.find((f) => f.relativePath === "tests/index.sample.ts")!.imports[0]!;
    expect(imp).toMatchObject({ source: "../src/index.js", targetPaths: ["src/index.ts"],
      provenance: { factId: "audit-fact:tests%2Findex.sample.ts#import#1#0#0" } });
    expect(await reader.importTarget(imp.provenance!.factId)).toMatchObject({
      status: "present", candidatePaths: ["src/index.ts"], selectionComplete: true, reasonCode: "TARGET_IN_SELECTED_INVENTORY" });
    vi.mocked(readBoundedFileText).mockClear();
    const result = await runAudit({ config: config(root), toolRoot: process.cwd(), registry,
      sourceProviderMode: "kit", kitSourceProviderDependencies: candidate03Deps });
    expect(result.sourceFacts.provider).toBe("kit"); expect(result.detectorErrors).toEqual([]);
    expect(result.issues).toEqual([]); expect(result.exitCode).toBe(0);
    expect(vi.mocked(readBoundedFileText).mock.calls.some((call) => call[0] === root)).toBe(false);
  }, 120000);
  it("accepts original selected JSON raw evidence while semantic imports stay unsupported", async () => {
    const { reader, facts } = await selected(original);
    const file = reader.selectedFile("tests/fixtures/payload.json");
    expect(file).toMatchObject({ status: "unsupported", lineCount: null,
      contentSha256: "ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356", capabilities: { imports: "unsupported" } });
    expect(facts.files.find((f) => f.relativePath === file.path)).toMatchObject({ parseStatus: "unsupported", imports: [], declarations: [] });
    expect(await reader.occurrences(file.path, "{}")).toMatchObject({ complete: true, matchCount: 1, matches: [{ line: 1, column: 1 }] });
    expect(await reader.occurrences(file.path, "from")).toMatchObject({ complete: true, matchCount: 0 });
    expect(() => reader.occurrences("unselected.json", "from")).toThrow(KitSourceEvidenceAcquisitionError);
  }, 120000);
  it.each<{ label: string; files: Record<string, string>; specifier: string; targets: string[] }>([
    { label: "directory index", files: { "src/widget/index.ts": "export const widget = 1;\n" }, specifier: "../src/widget", targets: ["src/widget/index.ts"] },
    { label: "multiple index candidates", files: { "src/index.ts": "export const value = 1;\n", "src/index.js": "export const value = 1;\n" }, specifier: "../src/index", targets: ["src/index.js", "src/index.ts"] },
  ])("accepts validated $label existence without claiming unique binding", async ({ files, specifier, targets }) => {
    const root = project({ ...files, "tests/check.test.ts": `import "${specifier}";\n` });
    const { reader, facts } = await selected(root);
    const imp = facts.files.find((f) => f.relativePath === "tests/check.test.ts")!.imports[0]!;
    const proof = await reader.importTarget(imp.provenance!.factId);
    expect(proof.status).toBe("present"); expect([...proof.candidatePaths].sort()).toEqual(targets);
    const result = await runAudit({ config: config(root), toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot"),
      sourceProviderMode: "kit", kitSourceProviderDependencies: candidate03Deps });
    expect(result.issues).toEqual([]); expect(result.exitCode).toBe(0);
  }, 120000);
  it("does not use an unrelated index file to satisfy a proven-missing import", async () => {
    const root = project({ "src/index.ts": "export const value = 1;\n", "tests/check.sample.ts": 'import "../src/absent";\n' });
    const result = await runAudit({ config: config(root), toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot"),
      sourceProviderMode: "kit", kitSourceProviderDependencies: candidate03Deps });
    expect(result.issues).toMatchObject([{ id: "test-rot:tests/check.sample.ts:missing-source-import:../src/absent", severity: "medium", confidence: "high" }]);
    expect(result.issues).toHaveLength(1); expect(result.exitCode).toBe(0);
  }, 120000);
  it("retains the unsupported JSX target extension restriction for a real present proof", async () => {
    const root = project({ "src/index.jsx": "export const value = 1;\n", "tests/check.test.ts": 'import "../src/index.jsx";\n' });
    const { reader, facts } = await selected(root);
    const imp = facts.files.find((f) => f.relativePath === "tests/check.test.ts")!.imports[0]!;
    expect(await reader.importTarget(imp.provenance!.factId)).toMatchObject({ status: "present", candidatePaths: ["src/index.jsx"] });
    await expect(runAudit({ config: config(root), toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot"),
      sourceProviderMode: "kit", kitSourceProviderDependencies: candidate03Deps })).rejects.toMatchObject({ category: "capability-insufficient" });
  }, 120000);
  it.each(["candidate", "path", "extension", "fact", "snapshot"])("rejects invalid present index %s evidence", async (kind) => {
    const root = path.resolve("tests/fixtures/audits/mixed-language/mixed-ts-js");
    let queried = false;
    const deps = { ...candidate03Deps, runCommand: async (options: Parameters<KitCommandRunner>[0]) => {
      const result = await runMeasuredCommand(options);
      if (!options.args?.includes("--audit-import-target")) return result;
      queried = true;
      const proof = JSON.parse(result.stdout);
      if (kind === "candidate") proof.candidatePaths = ["src/helper.js"];
      if (kind === "path") proof.candidatePaths = ["../index.ts"];
      if (kind === "extension") proof.candidatePaths = ["src/index.json"];
      if (kind === "fact") proof.importFactId = "wrong";
      if (kind === "snapshot") proof.snapshotId = "wrong";
      return { ...result, stdout: JSON.stringify(proof) };
    } };
    vi.mocked(readBoundedFileText).mockClear();
    await expect(runAudit({ config: config(root), toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot"),
      sourceProviderMode: "kit", kitSourceProviderDependencies: deps })).rejects.toBeInstanceOf(KitSourceEvidenceAcquisitionError);
    expect(queried).toBe(true);
    expect(vi.mocked(readBoundedFileText).mock.calls.some((call) => call[0] === root)).toBe(false);
  }, 120000);
  it("completes the original combined fixture with its existing missing-import finding and no native read", async () => {
    vi.mocked(readBoundedFileText).mockClear();
    const result = await runAudit({ config: config(original), toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot"),
      sourceProviderMode: "kit", kitSourceProviderDependencies: candidate03Deps });
    expect(result.exitCode).toBe(0); expect(result.sourceFacts.provider).toBe("kit"); expect(result.detectorErrors).toEqual([]);
    expect(result.issues).toMatchObject([
      { id: "test-rot:tests/check.sample.ts:missing-source-import:../src/absent", severity: "medium", confidence: "high" },
      { id: "test-rot:script-references-missing-test-path:test:tests/missing.ts", severity: "medium", confidence: "high" },
    ]);
    expect(result.issues).toHaveLength(2);
    expect(vi.mocked(readBoundedFileText).mock.calls.some((call) => call[0] === original)).toBe(false);
  }, 120000);
  it("retains installed Candidate 03 .mjs presence without a missing finding", async () => {
    const root = project({ "src/peer.mjs": "export const peer = 1;\n", "tests/check.test.ts": 'import "../src/peer";\n' });
    const result = await runAudit({ config: config(root), toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot"), sourceProviderMode: "kit", kitSourceProviderDependencies: candidate03Deps });
    expect(result.issues).toEqual([]); expect(result.exitCode).toBe(0);
  }, 120000);
  it.each(["matches", "stale", "snapshot", "failed"])("fails closed on JSON %s required evidence", async (kind) => {
    const root = project({ "tests/check.test.ts": "// no imports\n", "tests/fixtures/payload.json": "{}\n",
    });
    if (kind === "matches") fs.writeFileSync(path.join(root, "tests/fixtures/payload.json"), JSON.stringify("describe".repeat(201)));
    let changed = false;
    const deps = { ...candidate03Deps, runCommand: async (options: Parameters<KitCommandRunner>[0]) => {
      if (options.args?.includes("--contains") && options.args.includes("tests/fixtures/payload.json")) {
        if (kind === "stale" && !changed) { fs.appendFileSync(path.join(root, "tests/fixtures/payload.json"), " "); changed = true; }
        const result = await runMeasuredCommand(options);
        if (kind === "snapshot") return { ...result, stdout: JSON.stringify({ ...JSON.parse(result.stdout), snapshotId: "wrong" }) };
        if (kind === "failed") return { ...result, ok: false, exitCode: 2 };
        return result;
      }
      return runMeasuredCommand(options);
    } };
    vi.mocked(readBoundedFileText).mockClear();
    await expect(runAudit({ config: config(root), toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot"), sourceProviderMode: "kit", kitSourceProviderDependencies: deps }))
      .rejects.toMatchObject({ category: kind === "snapshot" ? "snapshot-mismatch" : kind === "failed" ? "subprocess-failed" : kind === "stale" ? "stale-evidence" : "capability-insufficient" });
    expect(vi.mocked(readBoundedFileText).mock.calls.some((call) => call[0] === root)).toBe(false);
  }, 120000);
  it("does not grant a blanket JSON reader outside selected test content", async () => {
    const root = project({ "src/a.ts": "export const a = 1;\n", "src/data.json": "{}\n", "tests/check.test.ts": "// test\n", "excluded/data.json": "{}\n" });
    const { reader } = await selected(root);
    expect(() => reader.occurrences("src/data.json", "{}")).toThrow(KitSourceEvidenceAcquisitionError);
    expect(() => reader.occurrences("excluded/data.json", "{}")).toThrow(KitSourceEvidenceAcquisitionError);
  }, 120000);
  it("does not treat JSON lexical import candidates as parsed imports", async () => {
    const root = project({ "tests/check.test.ts": "// no imports\n", "tests/fixtures/payload.json": '{"text":"from \\\"../src/absent\\\""}\n' });
    await expect(runAudit({ config: config(root), toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "test-rot"), sourceProviderMode: "kit", kitSourceProviderDependencies: candidate03Deps }))
      .rejects.toBeInstanceOf(KitSourceEvidenceAcquisitionError);
  }, 120000);
});

// Historical facts are immutable accepted evidence, never an executable provider.
function historicalAccepted(fixture: string, detectorId: string): Pick<AuditResult, "issues" | "exitCode" | "detectorErrors"> & { sourceFacts: { files: SourceFileFacts[] } } {
 const base = path.resolve(".my-dev-kit-workflow/tmp/v010-lab-kit-gate4/gate4-owner-authorized-closeout/comparisons");
 const replayBytes = fs.readFileSync(path.join(base,"150-decision-post-closeout-replay.json"));
 const reconciliationBytes = fs.readFileSync(path.join(base,"150-decision-post-closeout-reconciliation.json"));
 expect(createHash("sha256").update(replayBytes).digest("hex")).toBe("e80e53b5afd8975e007e0c104514d4cf5719f0004df14a9323914e0980a48680");
 expect(createHash("sha256").update(reconciliationBytes).digest("hex")).toBe("462f15e8f5ee871c8d10fbaba5b7e555e71b7e3db9560578c4e64e227ca8654e");
 const comparison = JSON.parse(replayBytes.toString()).comparisons.find((c: any) => c.fixture === fixture);
 const decision = JSON.parse(reconciliationBytes.toString()).decisions.find((d: any) => d.canonicalDecisionId === fixture+"::"+detectorId);
 return { issues: decision.legacyFindings, exitCode: decision.legacyExitCode, detectorErrors: [], sourceFacts: { files: comparison.runs.find((r: any) => r.providerMode === "legacy-comparison").sourceFiles } };
}
