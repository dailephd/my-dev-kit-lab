import { describe, expect, it } from "vitest";
import {
  adaptKitDeclaration,
  adaptKitEvidenceToSourceFacts,
  adaptKitExport,
  adaptKitImport,
  adaptKitFile,
  mapKitLanguage,
} from "../../src/audits/core/kitSourceAdapter.js";
import type {
  KitCapabilityName,
  KitFact,
  KitFileEvidence,
  KitFileRecord,
  KitSourceEvidence,
} from "../../src/audits/core/kitSourceEvidence.js";

const HASH = "a".repeat(64);

function capabilities(overrides: Partial<Record<KitCapabilityName, string>> = {}): KitFileRecord["capabilities"] {
  return {
    declarations: "complete",
    imports: "complete",
    exports: "complete",
    "identifier-literals": "unsupported",
    "test-observations": "unsupported",
    "fixture-references": "unsupported",
    "process-observations": "unsupported",
    "api-client-calls": "not-applicable",
    "source-ranges": "complete",
    ...overrides,
  } as KitFileRecord["capabilities"];
}

function record(filePath: string, overrides: Partial<KitFileRecord> = {}): KitFileRecord {
  return {
    path: filePath,
    sizeBytes: 10,
    contentSha256: HASH,
    language: "typescript",
    role: "source",
    status: "parsed",
    lineCount: 3,
    analyzerId: "typescript-ast",
    capabilities: capabilities(),
    warnings: [],
    diagnostics: [],
    ...overrides,
  };
}

function fact(filePath: string, id: number, extra: Partial<KitFact> & { kind: string }): KitFact {
  return {
    id: `audit-fact:${encodeURIComponent(filePath)}#${extra.kind}#${id}#0#0`,
    span: { path: filePath, startLine: id, startColumn: 0, endLine: id, endColumn: 8 },
    extractionMethod: "typescript-ast",
    ...extra,
  };
}

const labEntry = (relativePath: string, role: "source" | "test" = "source", language = "typescript") =>
  ({ relativePath, role, language, sizeBytes: 10 }) as never;

describe("declaration mapping", () => {
  it.each([
    ["java", "class", "com.example.Outer.Inner", "type", "java/class:Outer"],
    ["kotlin", "object", "com.example.Outer.Inner", "type", "kotlin/class:Outer"],
    ["kotlin", "function", "com.example.work", "kotlin-top-level-function", null],
    ["kotlin", "variable", "com.example.value", "kotlin-top-level-property", null],
  ] as const)("preserves qualified %s %s identities independently of mapped categories", (language, kind, qualifiedName, role, ownerKey) => {
    const input = fact(`src/A.${language === "java" ? "java" : "kt"}`, 4, {
      kind: "declaration", name: qualifiedName.split(".").at(-1), declarationKind: kind,
      extractionMethod: `${language}-lexical`, symbolId: "audit-symbol:qualified",
      ownerKey, jvmDeclaration: { packageName: "com.example", qualifiedName, role },
    });
    const output = adaptKitDeclaration(input);
    expect(output).toMatchObject({ symbolId: input.symbolId, ownerKey, jvmDeclaration: input.jvmDeclaration });
    expect(output.jvmDeclaration).not.toBe(input.jvmDeclaration);
    expect(output.provenance?.factId).toBe(input.id);
    expect(output.provenance?.startLine).toBe(4);
    if (kind === "object") expect(output).toMatchObject({ kind: "unknown", providerKind: "object" });
  });

  it("does not invent a qualified identity or known owner for unqualified facts", () => {
    const output = adaptKitDeclaration(fact("src/A.java", 2, { kind: "declaration", name: "A", declarationKind: "class" }));
    expect(output).not.toHaveProperty("jvmDeclaration");
    expect(output).not.toHaveProperty("ownerKey");
    expect(output).not.toHaveProperty("symbolId");
  });

  it("maps supported kinds and keeps the raw kind for unmapped ones", () => {
    const base = { kind: "declaration", name: "X", visibility: "public", exported: true, exportOrigin: "declared-export", ownerKey: null };
    expect(adaptKitDeclaration(fact("src/a.ts", 1, { ...base, declarationKind: "class" })).kind).toBe("class");
    expect(adaptKitDeclaration(fact("src/a.ts", 1, { ...base, declarationKind: "interface" })).kind).toBe("interface");
    expect(adaptKitDeclaration(fact("src/a.ts", 1, { ...base, declarationKind: "enum" })).kind).toBe("enum");
    expect(adaptKitDeclaration(fact("src/a.ts", 1, { ...base, declarationKind: "function" })).kind).toBe("function");
    const kotlinObject = adaptKitDeclaration(fact("src/a.kt", 1, { ...base, declarationKind: "object" }));
    expect(kotlinObject.kind).toBe("unknown");
    expect(kotlinObject.providerKind).toBe("object");
  });

  it("does not turn an unknown export state into a not-exported or exported claim", () => {
    const declaration = adaptKitDeclaration(
      fact("src/a.py", 1, { kind: "declaration", name: "dyn", declarationKind: "function", exported: null, visibility: "unknown", exportOrigin: "unknown" })
    );
    expect(declaration.exportState).toBe("unknown");
    expect(declaration.exported).toBe(false);
    expect(declaration.visibility).toBe("unknown");
  });

  it("preserves Java and Kotlin visibility instead of collapsing it to a boolean", () => {
    const visibility = (value: string) =>
      adaptKitDeclaration(fact("src/A.java", 1, { kind: "declaration", name: "A", declarationKind: "class", visibility: value, exported: value === "public" })).visibility;
    expect(visibility("package")).toBe("package");
    expect(visibility("protected")).toBe("protected");
    expect(visibility("internal")).toBe("internal");
    expect(visibility("private")).toBe("private");
    // An unrecognized producer value is unknown, never guessed.
    expect(visibility("sealed-ish")).toBe("unknown");
  });

  it("keeps nested declaration provenance and source spans", () => {
    const declaration = adaptKitDeclaration(
      fact("src/A.java", 4, { kind: "declaration", name: "Inner", declarationKind: "class", ownerKey: "Outer", exported: false, visibility: "private" })
    );
    expect(declaration.ownerKey).toBe("Outer");
    expect(declaration.provenance).toEqual({
      producer: "kit",
      factId: "audit-fact:src%2FA.java#declaration#4#0#0",
      extractionMethod: "typescript-ast",
      startLine: 4,
      startColumn: 0,
      endLine: 4,
      endColumn: 8,
    });
    expect(declaration.line).toBe(4);
  });
});

describe("import and export mapping", () => {
  it("keeps specifier, names, resolution and target paths; does not invent an import form", () => {
    const imported = adaptKitImport(
      fact("src/a.ts", 1, { kind: "import", sourceSpecifier: "./b", importedNames: ["b"], importResolution: "ambiguous", targetPaths: ["src/b.ts", "src/b.js"] })
    );
    expect(imported).toMatchObject({ source: "./b", kind: "unknown", importedNames: ["b"], importResolution: "ambiguous", targetPaths: ["src/b.ts", "src/b.js"] });
  });

  it("preserves the Python export origin", () => {
    const explicit = adaptKitExport(fact("src/a.py", 1, { kind: "export", name: "pub", exportOrigin: "python-all", visibility: "unknown", exported: true }));
    const inferred = adaptKitExport(fact("src/a.py", 2, { kind: "export", name: "conv", exportOrigin: "python-convention", exported: true }));
    expect(explicit).toMatchObject({ kind: "named", exportOrigin: "python-all" });
    expect(inferred.exportOrigin).toBe("python-convention");
    expect(adaptKitExport(fact("src/a.js", 3, { kind: "export", name: "x", exportOrigin: "commonjs" })).kind).toBe("commonjs");
    expect(adaptKitExport(fact("src/a.kt", 3, { kind: "export", name: "x", exportOrigin: "visibility-inferred" })).kind).toBe("unknown");
  });
});

describe("file adaptation", () => {
  it("retains duplicate qualified names as separate producer facts rather than a unique binding", () => {
    const rec = record("src/A.java", { language: "java", jvmPackageName: "com.example" });
    const declarations = [2, 5].map(line => fact(rec.path, line, { kind: "declaration", name: "A", declarationKind: "class",
      jvmDeclaration: { packageName: "com.example", qualifiedName: "com.example.A", role: "type" } }));
    const output = adaptKitFile({ record: rec, factPages: 1, facts: declarations }, rec, labEntry(rec.path, "source", "java"), ["declarations"]);
    expect(output.declarations).toHaveLength(2);
    expect(new Set(output.declarations.map(d => d.provenance?.factId)).size).toBe(2);
    expect(output.declarations.map(d => d.jvmDeclaration?.qualifiedName)).toEqual(["com.example.A", "com.example.A"]);
  });

  it.each(["", "com.example", undefined])("keeps known default, qualified and unknown package identities distinct: %s", jvmPackageName => {
    const rec = record("src/A.java", { language: "java", jvmPackageName });
    const output = adaptKitFile({ record: rec, factPages: 1, facts: [] }, rec, labEntry(rec.path, "source", "java"), ["declarations"]);
    expect(output.kit?.jvmPackageName).toBe(jvmPackageName);
    expect(Object.hasOwn(output.kit!, "jvmPackageName")).toBe(jvmPackageName !== undefined);
  });

  it.each(["partial", "unsupported", undefined] as const)("does not promote declaration profile coverage from a parsed inventory: %s", completeness => {
    const rec = record("src/A.java", { language: "java" });
    if (completeness === undefined) delete (rec.capabilities as Partial<KitFileRecord["capabilities"]>).declarations;
    else rec.capabilities.declarations = completeness;
    const output = adaptKitFile({ record: rec, factPages: 1, facts: [] }, rec, labEntry(rec.path, "source", "java"), ["declarations"]);
    expect(output.parseStatus).toBe("file-level-only");
    expect(output.kit?.capabilities.declarations).toBe(completeness);
  });

  it("adapts verified facts and keeps unsupported capability diagnostics", () => {
    const rec = record("src/A.java", {
      language: "java",
      analyzerId: "java-lexical",
      capabilities: capabilities({ exports: "partial", "source-ranges": "partial" }),
      diagnostics: [{ code: "visibility-inferred-exports", message: "Java exports are inferred." }],
    });
    const evidence: KitFileEvidence = {
      record: rec,
      factPages: 1,
      facts: [fact("src/A.java", 2, { kind: "declaration", name: "A", declarationKind: "class", visibility: "public", exported: true, exportOrigin: "visibility-inferred" })],
    };
    const adapted = adaptKitFile(evidence, rec, labEntry("src/A.java", "source", "java"), ["declarations"]);
    expect(adapted.parseStatus).toBe("parsed");
    expect(adapted.analyzerId).toBe("kit:java-lexical");
    expect(adapted.declarations).toHaveLength(1);
    const codes = adapted.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toEqual(expect.arrayContaining(["kit:visibility-inferred-exports", "kit:capability-partial", "kit:capability-unsupported"]));
    expect(adapted.kit).toMatchObject({ producerLanguage: "java", producerStatus: "parsed", contentSha256: HASH });
    expect(adapted.kit?.capabilities["identifier-literals"]).toBe("unsupported");
  });

  it("does not mark a file parsed when a required capability is not complete", () => {
    const rec = record("src/a.ts", { capabilities: capabilities({ imports: "partial" }) });
    const adapted = adaptKitFile({ record: rec, factPages: 1, facts: [] }, rec, labEntry("src/a.ts"), ["imports"]);
    expect(adapted.parseStatus).toBe("file-level-only");
    expect(adapted.diagnostics.map((d) => d.code)).toContain("kit:required-capability-not-complete");
  });

  it("maps non-parsed Kit statuses without inventing success", () => {
    const status = (kitStatus: KitFileRecord["status"]) =>
      adaptKitFile(undefined, record("src/a.ts", { status: kitStatus }), labEntry("src/a.ts"), []).parseStatus;
    expect(status("failed")).toBe("parse-error");
    expect(status("skipped")).toBe("skipped");
    expect(status("unsupported")).toBe("unsupported");
    expect(status("file-level-only")).toBe("file-level-only");
    expect(status("partial")).toBe("file-level-only");
  });

  it("treats facts that were not retrieved as unknown, not as empty success", () => {
    const adapted = adaptKitFile(undefined, record("src/a.ts"), labEntry("src/a.ts"), []);
    expect(adapted.parseStatus).toBe("file-level-only");
    expect(adapted.imports).toEqual([]);
    expect(adapted.diagnostics.map((d) => d.code)).toContain("kit:facts-not-retrieved");
  });

  it("records a language Lab does not model without forcing its facts", () => {
    const rec = record("src/lib.go", { language: "go", analyzerId: "unmodeled-producer" });
    const adapted = adaptKitFile(
      { record: rec, factPages: 1, facts: [fact("src/lib.go", 1, { kind: "declaration", name: "f", declarationKind: "function" })] },
      rec,
      labEntry("src/lib.go", "source", "unknown"),
      []
    );
    expect(adapted.language).toBe("unknown");
    expect(adapted.parseStatus).toBe("unsupported");
    expect(adapted.declarations).toEqual([]);
    expect(adapted.kit?.producerLanguage).toBe("go");
  });

  it("keeps TypeScript and JavaScript in one analyzer group and Java/Kotlin apart", () => {
    expect(adaptKitFile(undefined, record("a.ts"), labEntry("a.ts"), []).analyzerId).toBe(
      adaptKitFile(undefined, record("a.js", { language: "javascript" }), labEntry("a.js", "source", "javascript"), []).analyzerId
    );
    expect(mapKitLanguage("javascript")).toBe("javascript");
    expect(mapKitLanguage("rust")).toBe("rust");
    expect(adaptKitFile(undefined, record("A.java", { language: "java", analyzerId: "java-lexical" }), labEntry("A.java", "source", "java"), []).analyzerId).not.toBe(
      adaptKitFile(undefined, record("A.kt", { language: "kotlin", analyzerId: "kotlin-lexical" }), labEntry("A.kt", "source", "kotlin"), []).analyzerId
    );
  });
});

describe("snapshot adaptation", () => {
  function evidence(): KitSourceEvidence {
    const records = [record("src/a.ts"), record("tests/unknownrole.test.ts", { role: "unknown" }), record("fixtures/x.ts", { role: "unknown" })];
    return {
      producer: { packageName: "@dailephd/my-dev-kit", packageVersion: "1.14.0" },
      artifactSchemaVersion: "1.0.0",
      extractorRevision: "source-audit-v1.2.0",
      source: {
        projectRoot: "C:/t",
        sourceRoots: ["src", "tests"],
        excludes: ["default-directory:dist"],
        symbolIndexSchemaVersion: "3",
        codeGraphSchemaVersion: "1.1.0",
        selectionFingerprint: "b".repeat(64),
        snapshotId: "c".repeat(64),
      },
      coverage: { selectedFileCount: 3, recordedFileCount: 3, unreadableFileCount: 0, excludedPathCount: 0, unsupportedFileCount: 0, inventoryComplete: true, exclusionsAreExplicit: true },
      snapshotId: "c".repeat(64),
      inventory: records,
      inventoryPages: 1,
      fileEvidence: new Map(records.map((rec) => [rec.path, { record: rec, facts: [], factPages: 1 }])),
      factPages: 3,
      traversalComplete: true,
    };
  }

  it("matches by canonical path, keeps Lab roles, and records Kit files outside Lab policy", () => {
    const snapshot = adaptKitEvidenceToSourceFacts({
      evidence: evidence(),
      inventory: {
        files: [labEntry("src/a.ts"), labEntry("tests/unknownrole.test.ts", "test"), { relativePath: "docs/readme.md", role: "docs", language: "markdown", sizeBytes: 1 }],
      } as never,
      targetRoot: "C:/t",
      requiredCapabilities: ["declarations"],
    });
    expect(snapshot.provider).toBe("kit");
    // Kit says "unknown" for the tests file; Lab's inventory says test, so it is kept as test.
    const testFile = snapshot.files.find((file) => file.relativePath === "tests/unknownrole.test.ts")!;
    expect(testFile.role).toBe("test");
    expect(testFile.kit?.producerRole).toBe("unknown");
    expect(snapshot.files.map((file) => file.relativePath)).toEqual(["src/a.ts", "tests/unknownrole.test.ts"]);
    expect(snapshot.kitEvidence?.kitFilesOutsideLabPolicy).toEqual(["fixtures/x.ts"]);
    expect(snapshot.kitEvidence).toMatchObject({ packageVersion: "1.14.0", snapshotId: "c".repeat(64), traversalComplete: true, sourceRoots: ["src", "tests"] });
    expect(snapshot.filesByParseStatus.parsed).toBe(2);
    expect(snapshot.filesByLanguage.typescript).toBe(2);
  });

  it("produces no findings and never reads from the filesystem", () => {
    const snapshot = adaptKitEvidenceToSourceFacts({
      evidence: evidence(),
      inventory: { files: [] } as never,
      targetRoot: "C:/definitely/not/real",
      requiredCapabilities: [],
    });
    expect(snapshot.files).toEqual([]);
    expect(Object.keys(snapshot)).not.toContain("issues");
  });
});
