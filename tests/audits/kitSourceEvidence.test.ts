import { describe, expect, it } from "vitest";
import {
  KIT_FACT_PAGE_SIZE,
  KIT_INVENTORY_PAGE_SIZE,
  KitSourceEvidenceAcquisitionError,
  assertRequiredCapabilities,
  assertKitJsonRawContent,
  assertSelectionCoversRequired,
  collectAllPages,
  crossValidateFileRecord,
  crossValidateInventory,
  flattenFactPages,
  flattenInventoryPages,
  sha256Hex,
  validateFactPage,
  validateKitFact,
  validateKitFileRecord,
  validateKitImportProof,
  validateKitImportDomain,
  type KitFact,
  validateKitOrdinarySourceReference,
  validateKitTestModifierProof,
  type KitSourceEvidence,
  validateInventoryPage,
  validateKitArtifact,
  validateKitManifestReference,
  validateKitRelativePath,
  type KitCapabilityName,
  type KitFileRecord,
} from "../../src/audits/core/kitSourceEvidence.js";

const SNAPSHOT = "a".repeat(64);
const HASH = "b".repeat(64);

function capabilities(overrides: Partial<Record<KitCapabilityName, string>> = {}): Record<string, string> {
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
  };
}

function fileJson(filePath: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path: filePath,
    sizeBytes: 10,
    contentSha256: HASH,
    language: "typescript",
    role: "source",
    status: "parsed",
    lineCount: 1,
    analyzerId: "typescript-ast",
    capabilities: capabilities(),
    warnings: [],
    ...overrides,
  };
}

const COVERAGE = {
  selectedFileCount: 2,
  recordedFileCount: 2,
  unreadableFileCount: 0,
  excludedPathCount: 0,
  unsupportedFileCount: 0,
  inventoryComplete: true,
  exclusionsAreExplicit: true,
};

function inventoryJson(pageIndex: number, total: number, files: unknown[], overrides: Record<string, unknown> = {}) {
  const totalPages = Math.max(1, Math.ceil(total / KIT_INVENTORY_PAGE_SIZE));
  return {
    schemaVersion: "1.0.0",
    snapshotId: SNAPSHOT,
    pageIndex,
    pageSize: KIT_INVENTORY_PAGE_SIZE,
    totalItems: total,
    totalPages,
    nextPageIndex: pageIndex === totalPages - 1 ? null : pageIndex + 1,
    mode: "audit-files",
    coverage: { ...COVERAGE, selectedFileCount: total, recordedFileCount: total },
    files,
    ...overrides,
  };
}

function factJson(filePath: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "declaration",
    span: { path: filePath, startLine: 1, startColumn: 0, endLine: 1, endColumn: 5 },
    extractionMethod: "typescript-ast",
    name: "thing",
    declarationKind: "function",
    ...extra,
  };
}

function factPageJson(filePath: string, pageIndex: number, total: number, facts: unknown[], overrides: Record<string, unknown> = {}) {
  const totalPages = Math.max(1, Math.ceil(total / KIT_FACT_PAGE_SIZE));
  return {
    schemaVersion: "1.0.0",
    snapshotId: SNAPSHOT,
    pageIndex,
    pageSize: KIT_FACT_PAGE_SIZE,
    totalItems: total,
    totalPages,
    nextPageIndex: pageIndex === totalPages - 1 ? null : pageIndex + 1,
    mode: "audit-file",
    status: "found",
    file: fileJson(filePath, { diagnostics: [] }),
    facts,
    ...overrides,
  };
}

function expectFailure(fn: () => unknown, category: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(KitSourceEvidenceAcquisitionError);
    expect((error as KitSourceEvidenceAcquisitionError).category).toBe(category);
    return;
  }
  throw new Error(`expected ${category} failure`);
}

describe("path validation", () => {
  it.each(["../outside.ts", "src/../x.ts", "/abs.ts", "C:/x.ts", "src\\x.ts", "./x.ts", "src//x.ts", "", "src/"])(
    "rejects %j",
    (value) => {
      expectFailure(() => validateKitRelativePath(value, "p"), "path-invalid");
    }
  );
  it("accepts canonical paths", () => {
    expect(validateKitRelativePath("src/a/b.ts", "p")).toBe("src/a/b.ts");
  });
});

describe("inventory page validation", () => {
  it("accepts a complete single page", () => {
    const page = validateInventoryPage(inventoryJson(0, 2, [fileJson("src/a.ts"), fileJson("src/b.ts")]), {
      snapshotId: SNAPSHOT,
      pageIndex: 0,
    });
    expect(page.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(page.nextPageIndex).toBeNull();
  });

  it("rejects wrong schema, mode, snapshot, page index and page size", () => {
    const base = () => inventoryJson(0, 1, [fileJson("src/a.ts")]);
    expectFailure(() => validateInventoryPage({ ...base(), schemaVersion: "2.0.0" }, { snapshotId: SNAPSHOT, pageIndex: 0 }), "schema-mismatch");
    expectFailure(() => validateInventoryPage({ ...base(), mode: "audit-file" }, { snapshotId: SNAPSHOT, pageIndex: 0 }), "page-invalid");
    expectFailure(() => validateInventoryPage({ ...base(), snapshotId: "c".repeat(64) }, { snapshotId: SNAPSHOT, pageIndex: 0 }), "snapshot-mismatch");
    expectFailure(() => validateInventoryPage(base(), { snapshotId: SNAPSHOT, pageIndex: 1 }), "page-invalid");
    expectFailure(() => validateInventoryPage({ ...base(), pageSize: 32 }, { snapshotId: SNAPSHOT, pageIndex: 0 }), "page-invalid");
  });

  it("rejects inconsistent totals, bad nextPageIndex and wrong record count", () => {
    expectFailure(() => validateInventoryPage(inventoryJson(0, 1, [fileJson("src/a.ts")], { totalPages: 5 }), { snapshotId: SNAPSHOT, pageIndex: 0 }), "page-invalid");
    expectFailure(() => validateInventoryPage(inventoryJson(0, 1, [fileJson("src/a.ts")], { nextPageIndex: 1 }), { snapshotId: SNAPSHOT, pageIndex: 0 }), "page-invalid");
    expectFailure(() => validateInventoryPage(inventoryJson(0, 2, [fileJson("src/a.ts")]), { snapshotId: SNAPSHOT, pageIndex: 0 }), "page-invalid");
  });

  it("rejects an invalid path, role and capability status", () => {
    expectFailure(() => validateInventoryPage(inventoryJson(0, 1, [fileJson("../x.ts")]), { snapshotId: SNAPSHOT, pageIndex: 0 }), "path-invalid");
    expectFailure(() => validateInventoryPage(inventoryJson(0, 1, [fileJson("src/a.ts", { role: "weird" })]), { snapshotId: SNAPSHOT, pageIndex: 0 }), "page-invalid");
    expectFailure(
      () => validateInventoryPage(inventoryJson(0, 1, [fileJson("src/a.ts", { capabilities: capabilities({ imports: "great" }) })]), { snapshotId: SNAPSHOT, pageIndex: 0 }),
      "page-invalid"
    );
    const missing = capabilities() as Record<string, unknown>;
    delete missing.imports;
    expectFailure(() => validateInventoryPage(inventoryJson(0, 1, [fileJson("src/a.ts", { capabilities: missing })]), { snapshotId: SNAPSHOT, pageIndex: 0 }), "page-invalid");
  });
});

describe("multi-page traversal", () => {
  const total = KIT_INVENTORY_PAGE_SIZE + 3;
  const allFiles = Array.from({ length: total }, (_, index) => fileJson(`src/f${String(index).padStart(3, "0")}.ts`));
  const pageFor = (pageIndex: number) =>
    inventoryJson(pageIndex, total, allFiles.slice(pageIndex * KIT_INVENTORY_PAGE_SIZE, (pageIndex + 1) * KIT_INVENTORY_PAGE_SIZE));

  it("walks every declared page under one snapshot id", async () => {
    const requested: number[] = [];
    const pages = await collectAllPages(
      async (pageIndex) => {
        requested.push(pageIndex);
        return validateInventoryPage(pageFor(pageIndex), { snapshotId: SNAPSHOT, pageIndex });
      },
      { maxPages: 10, label: "inventory" }
    );
    expect(requested).toEqual([0, 1]);
    expect(new Set(pages.map((page) => page.snapshotId))).toEqual(new Set([SNAPSHOT]));
    expect(flattenInventoryPages(pages)).toHaveLength(total);
  });

  it("fails when the traversal limit is exceeded", async () => {
    await expect(
      collectAllPages(async (pageIndex) => validateInventoryPage(pageFor(pageIndex), { snapshotId: SNAPSHOT, pageIndex }), { maxPages: 1, label: "inventory" })
    ).rejects.toMatchObject({ category: "traversal-incomplete" });
  });

  it("fails on mixed snapshot ids", async () => {
    await expect(
      collectAllPages(
        async (pageIndex) => {
          const page = validateInventoryPage(pageFor(pageIndex), { snapshotId: SNAPSHOT, pageIndex });
          return pageIndex === 1 ? { ...page, snapshotId: "d".repeat(64) } : page;
        },
        { maxPages: 10, label: "inventory" }
      )
    ).rejects.toMatchObject({ category: "snapshot-mismatch" });
  });

  it("fails on inconsistent totals between pages", async () => {
    await expect(
      collectAllPages(
        async (pageIndex) => {
          const page = validateInventoryPage(pageFor(pageIndex), { snapshotId: SNAPSHOT, pageIndex });
          return pageIndex === 1 ? { ...page, totalItems: page.totalItems + 1 } : page;
        },
        { maxPages: 10, label: "inventory" }
      )
    ).rejects.toMatchObject({ category: "page-invalid" });
  });

  it("fails on a skipped page and on a missing terminal page", async () => {
    await expect(
      collectAllPages(
        async (pageIndex) => {
          const page = validateInventoryPage(pageFor(pageIndex), { snapshotId: SNAPSHOT, pageIndex });
          return pageIndex === 0 ? { ...page, nextPageIndex: 2 } : page;
        },
        { maxPages: 10, label: "inventory" }
      )
    ).rejects.toMatchObject({ category: "page-invalid" });
    // A terminal marker before the declared last page is a missing terminal page.
    expectFailure(
      () => validateInventoryPage(pageFor(0) && inventoryJson(0, total, allFiles.slice(0, KIT_INVENTORY_PAGE_SIZE), { nextPageIndex: null }), { snapshotId: SNAPSHOT, pageIndex: 0 }),
      "page-invalid"
    );
  });

  it("rejects a repeated inventory page (repeated file identities)", async () => {
    const pages = await collectAllPages(
      async (pageIndex) => validateInventoryPage(pageFor(pageIndex), { snapshotId: SNAPSHOT, pageIndex }),
      { maxPages: 10, label: "inventory" }
    );
    expectFailure(() => flattenInventoryPages([pages[0]!, pages[0]!, pages[1]!]), "page-invalid");
  });
});

describe("fact page validation and traversal", () => {
  it("validates facts spread over two pages and unique identities", async () => {
    const total = KIT_FACT_PAGE_SIZE + 2;
    const facts = Array.from({ length: total }, (_, index) => factJson("src/a.ts", `audit-fact:src%2Fa.ts#declaration#${index + 1}#0#0`));
    const pages = await collectAllPages(
      async (pageIndex) =>
        validateFactPage(factPageJson("src/a.ts", pageIndex, total, facts.slice(pageIndex * KIT_FACT_PAGE_SIZE, (pageIndex + 1) * KIT_FACT_PAGE_SIZE)), {
          snapshotId: SNAPSHOT,
          pageIndex,
          path: "src/a.ts",
        }),
      { maxPages: 10, label: "facts" }
    );
    expect(pages).toHaveLength(2);
    expect(flattenFactPages("src/a.ts", pages, new Set())).toHaveLength(total);
  });

  it("rejects duplicate fact identities", () => {
    const page = validateFactPage(
      factPageJson("src/a.ts", 0, 2, [factJson("src/a.ts", "audit-fact:x#1"), factJson("src/a.ts", "audit-fact:x#1")]),
      { snapshotId: SNAPSHOT, pageIndex: 0, path: "src/a.ts" }
    );
    expectFailure(() => flattenFactPages("src/a.ts", [page], new Set()), "page-invalid");
  });

  it("rejects facts for another file, bad ids and not-selected status", () => {
    const expected = { snapshotId: SNAPSHOT, pageIndex: 0, path: "src/a.ts" };
    expectFailure(() => validateFactPage(factPageJson("src/a.ts", 0, 1, [factJson("src/other.ts", "audit-fact:x#1")]), expected), "page-invalid");
    expectFailure(() => validateFactPage(factPageJson("src/a.ts", 0, 1, [factJson("src/a.ts", "nope")]), expected), "page-invalid");
    expectFailure(() => validateFactPage(factPageJson("src/a.ts", 0, 0, [], { status: "not-selected", file: null }), expected), "selection-incomplete");
    expectFailure(() => validateFactPage(factPageJson("src/other.ts", 0, 0, []), expected), "page-invalid");
  });

  it("preserves null export state, columns and import resolution", () => {
    const page = validateFactPage(
      factPageJson("src/a.ts", 0, 2, [
        factJson("src/a.ts", "audit-fact:x#1", { exported: null, span: { path: "src/a.ts", startLine: 3, startColumn: null, endLine: null, endColumn: null } }),
        {
          id: "audit-fact:x#2",
          kind: "import",
          span: { path: "src/a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 4 },
          extractionMethod: "typescript-ast",
          sourceSpecifier: "./b",
          importedNames: ["b"],
          importResolution: "unresolved",
          targetPaths: [],
        },
      ]),
      { snapshotId: SNAPSHOT, pageIndex: 0, path: "src/a.ts" }
    );
    expect(page.facts[0]!.exported).toBeNull();
    expect(page.facts[0]!.span.startColumn).toBeNull();
    expect(page.facts[1]!.importResolution).toBe("unresolved");
  });
});

describe("manifest reference and artifact validation", () => {
  const expectation = { packageName: "@dailephd/my-dev-kit", packageVersion: "1.14.0", artifactSchemaVersion: "1.0.0" };

  function artifact(overrides: Record<string, unknown> = {}): Uint8Array {
    return Buffer.from(
      JSON.stringify({
        artifactKind: "my-dev-kit-v1-source-audit-evidence",
        schemaVersion: "1.0.0",
        producer: { packageName: "@dailephd/my-dev-kit", packageVersion: "1.14.0" },
        source: {
          projectRoot: "C:/t",
          sourceRoots: ["src"],
          excludes: [],
          symbolIndexSchemaVersion: "3",
          codeGraphSchemaVersion: "1.1.0",
          selectionFingerprint: "e".repeat(64),
          snapshotId: SNAPSHOT,
        },
        coverage: COVERAGE,
        files: [fileJson("src/a.ts"), fileJson("src/b.ts")],
        ...overrides,
      })
    );
  }
  const reference = (bytes: Uint8Array, overrides: Record<string, unknown> = {}) =>
    validateKitManifestReference({
      sourceAuditEvidence: { path: "source-audit-evidence.json", schemaVersion: "1.0.0", sha256: sha256Hex(bytes), snapshotId: SNAPSHOT, ...overrides },
    });

  it("accepts a consistent manifest and artifact", () => {
    const bytes = artifact();
    const header = validateKitArtifact(bytes, reference(bytes), expectation);
    expect(header.producer.packageVersion).toBe("1.14.0");
    expect(header.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("rejects a missing reference, wrong schema, bad path and a wrong checksum", () => {
    const bytes = artifact();
    expectFailure(() => validateKitManifestReference({}), "artifact-missing");
    expectFailure(() => reference(bytes, { schemaVersion: "2.0.0" }), "schema-mismatch");
    expectFailure(() => reference(bytes, { path: "../x.json" }), "artifact-invalid");
    expectFailure(() => validateKitArtifact(bytes, reference(bytes, { sha256: "0".repeat(64) }), expectation), "artifact-invalid");
  });

  it("rejects wrong artifact schema, kind, producer and snapshot", () => {
    for (const [overrides, category] of [
      [{ schemaVersion: "9.9.9" }, "schema-mismatch"],
      [{ artifactKind: "other" }, "artifact-invalid"],
      [{ producer: { packageName: "@dailephd/other", packageVersion: "1.14.0" } }, "package-identity"],
      [{ producer: { packageName: "@dailephd/my-dev-kit", packageVersion: "1.13.0" } }, "package-identity"],
    ] as const) {
      const bytes = artifact(overrides);
      expectFailure(() => validateKitArtifact(bytes, reference(bytes), expectation), category);
    }
    const bytes = artifact();
    expectFailure(() => validateKitArtifact(bytes, reference(bytes, { snapshotId: "f".repeat(64) }), expectation), "snapshot-mismatch");
  });

  it("rejects invalid JSON with a consistent checksum", () => {
    const bytes = Buffer.from("{not json");
    expectFailure(() => validateKitArtifact(bytes, reference(bytes), expectation), "invalid-json");
  });
});

describe("cross validation and completeness", () => {
  const records = (): KitFileRecord[] =>
    ["src/a.ts", "src/b.ts"].map((entry) => validateInventoryPage(inventoryJson(0, 2, [fileJson("src/a.ts"), fileJson("src/b.ts")]), { snapshotId: SNAPSHOT, pageIndex: 0 }).files.find((file) => file.path === entry)!);
  const header = (overrides: Record<string, unknown> = {}) => ({
    artifactKind: "my-dev-kit-v1-source-audit-evidence",
    schemaVersion: "1.0.0",
    producer: { packageName: "@dailephd/my-dev-kit", packageVersion: "1.14.0" },
    source: {
      projectRoot: "C:/t",
      sourceRoots: ["src"],
      excludes: [],
      symbolIndexSchemaVersion: "3",
      codeGraphSchemaVersion: "1.1.0",
      selectionFingerprint: "e".repeat(64),
      snapshotId: SNAPSHOT,
    },
    coverage: COVERAGE,
    files: records().map((record) => ({ path: record.path, contentSha256: record.contentSha256, language: record.language, role: record.role, status: record.status })),
    ...overrides,
  });
  const pages = () => [validateInventoryPage(inventoryJson(0, 2, [fileJson("src/a.ts"), fileJson("src/b.ts")]), { snapshotId: SNAPSHOT, pageIndex: 0 })];

  it("accepts a matching selection", () => {
    expect(() => crossValidateInventory(header() as never, records(), pages(), ["src"])).not.toThrow();
  });

  it("rejects wrong source roots, incomplete coverage and unreadable files", () => {
    expectFailure(() => crossValidateInventory(header() as never, records(), pages(), ["tests"]), "root-mismatch");
    expectFailure(() => crossValidateInventory(header({ coverage: { ...COVERAGE, inventoryComplete: false } }) as never, records(), pages(), ["src"]), "selection-incomplete");
    expectFailure(() => crossValidateInventory(header({ coverage: { ...COVERAGE, unreadableFileCount: 1 } }) as never, records(), pages(), ["src"]), "selection-incomplete");
    expectFailure(() => crossValidateInventory(header({ coverage: { ...COVERAGE, selectedFileCount: 3, recordedFileCount: 3 } }) as never, records(), pages(), ["src"]), "selection-incomplete");
  });

  it("rejects an artifact/inventory disagreement and a changed exact-file record", () => {
    const tampered = header();
    (tampered.files[0] as { contentSha256: string }).contentSha256 = "9".repeat(64);
    expectFailure(() => crossValidateInventory(tampered as never, records(), pages(), ["src"]), "selection-incomplete");
    const original = records()[0]!;
    expectFailure(() => crossValidateFileRecord(original, { ...original, contentSha256: "9".repeat(64) }), "stale-evidence");
  });

  it("flags Lab files outside the Kit selection", () => {
    expect(() => assertSelectionCoversRequired(records(), ["src/a.ts"])).not.toThrow();
    expectFailure(() => assertSelectionCoversRequired(records(), ["src/a.ts", "lib/missing.ts"]), "selection-incomplete");
  });

  it("treats partial, unsupported and missing required capabilities as fatal", () => {
    const [record] = records();
    expect(() => assertRequiredCapabilities(record!, ["declarations", "imports"])).not.toThrow();
    expect(() => assertRequiredCapabilities(record!, [])).not.toThrow();
    expectFailure(() => assertRequiredCapabilities({ ...record!, capabilities: { ...record!.capabilities, imports: "partial" } }, ["imports"]), "capability-insufficient");
    expectFailure(() => assertRequiredCapabilities({ ...record!, capabilities: { ...record!.capabilities, imports: "unsupported" } }, ["imports"]), "capability-insufficient");
    const missing = { ...record!, capabilities: { ...record!.capabilities } } as { capabilities: Record<string, unknown> };
    delete missing.capabilities.imports;
    expectFailure(() => assertRequiredCapabilities(missing as never, ["imports"]), "capability-insufficient");
    expectFailure(() => assertRequiredCapabilities({ ...record!, status: "partial" }, ["declarations"]), "capability-insufficient");
  });
});

describe("JSON raw evidence is independent of semantic support", () => {
  const record = validateInventoryPage(inventoryJson(0, 1, [fileJson("tests/fixtures/payload.json", {
    status: "unsupported", language: "unsupported", role: "unknown", analyzerId: null, lineCount: null,
    capabilities: capabilities({ imports: "unsupported", declarations: "unsupported" }),
  })]), { snapshotId: SNAPSHOT, pageIndex: 0 }).files[0]!;
  it("accepts the qualified hash contract without accepting semantic facts", () => {
    expect(() => assertKitJsonRawContent(record, true)).not.toThrow();
    expectFailure(() => assertRequiredCapabilities(record, ["imports"]), "capability-insufficient");
    expectFailure(() => assertRequiredCapabilities(record, ["declarations"]), "capability-insufficient");
  });
  it.each([null, "", "wrong", "A".repeat(64)])("rejects missing or invalid content hash %s", (contentSha256) => {
    expectFailure(() => assertKitJsonRawContent({ ...record, contentSha256 }, true), "capability-insufficient");
  });
  it("rejects unqualified producers and arbitrary extensions", () => {
    expectFailure(() => assertKitJsonRawContent(record, false), "capability-insufficient");
    expectFailure(() => assertKitJsonRawContent({ ...record, path: "tests/file.txt" }, true), "capability-insufficient");
  });
});

describe("qualified bounded literal values", () => {
  const observation = () => factJson("tests/a.ts", "audit-fact:tests%2Fa.ts#test-observation#1#0#0", {
    kind: "test-observation", observationKind: "test-title", value: null,
    valueTruncated: true, valueSha256: HASH,
  });
  it("retains producer-redacted scalar values as unknown with their hash, never as absence", () => {
    const fact = validateKitFact(observation(), "fact", "tests/a.ts");
    expect(fact.value).toBeNull();
    expect(fact.valueTruncated).toBe(true);
    expect(fact.valueSha256).toBe(HASH);
  });
  it.each([
    {value: 42}, {value: "prefix", valueTruncated: true}, {valueSha256: undefined},
    {valueSha256: "bad"}, {valueTruncated: "true"}, {value: undefined},
  ])("refuses malformed or contradictory bounded literal metadata %j", override => {
    expectFailure(() => validateKitFact({...observation(),...override}, "fact", "tests/a.ts"), "page-invalid");
  });
});

describe("versioned direct modifier coverage", () => {
  const expected = { snapshotId: SNAPSHOT, pageIndex: 0 };
  const page = (status: string, schemaVersion = "1.2.0") => inventoryJson(0, 1, [fileJson("tests/a.ts", {
    status,
    capabilities: { ...capabilities({ "test-observations": "partial" }),
      "dynamic-import-expressions": "partial", "direct-test-modifiers": "complete" },
  })], { schemaVersion });
  it("retains an exact typed claim without upgrading the observation family", () => {
    const record = validateInventoryPage(page("parsed"), expected).files[0];
    expect(record.capabilities).toMatchObject({ "test-observations": "partial", "direct-test-modifiers": "complete" });
    expectFailure(() => crossValidateFileRecord(record, { ...record,
      capabilities: { ...record.capabilities, "direct-test-modifiers": "partial" } }), "stale-evidence");
  });
  it("rejects forged completeness on recovered files and at the legacy boundary", () => {
    expectFailure(() => validateInventoryPage(page("partial"), expected), "page-invalid");
    expectFailure(() => validateInventoryPage(page("parsed", "1.0.0"), expected), "schema-mismatch");
  });
})

describe("FACTS02-ORDINARY-SOURCE-REFERENCE/1.0.0", () => {
  const origin = "src/entry.ts";
  const peer = "src/peer.ts";
  const alternate = "src/peer.tsx";
  const absent = "src/peer.js";
  const selectionFingerprint = "c".repeat(64);
  const file = (filePath: string) => validateKitFileRecord(fileJson(filePath), filePath);
  const fact = validateKitFact({
    id: "audit-fact:src%2Fentry.ts#import#1#0#0", kind: "import", extractionMethod: "typescript-ast",
    span: { path: origin, startLine: 1, startColumn: 0, endLine: 1, endColumn: 19 },
    sourceSpecifier: "./peer.js", importedNames: [], importResolution: "observed",
  }, "ordinary import", origin);
  const extension = (targets: string[], qualified = false) => {
    const inventory = [origin, ...targets].map(file);
    const evidence: KitSourceEvidence = {
      producer: { packageName: "@dailephd/my-dev-kit", packageVersion: "1.16.0" },
      artifactSchemaVersion: "1.2.0", extractorRevision: "source-audit-v1.6.0",
      source: { projectRoot: "/fixture", sourceRoots: ["src"], excludes: [], symbolIndexSchemaVersion: "3",
        codeGraphSchemaVersion: "1.1.0", selectionFingerprint, snapshotId: SNAPSHOT },
      inventory, snapshotId: SNAPSHOT, coverage: { ...COVERAGE, selectedFileCount: inventory.length, recordedFileCount: inventory.length },
      fileEvidence: new Map([[origin, { record: inventory[0]!, facts: [fact], factPages: 1 }]]),
      inventoryPages: 1, factPages: 1, traversalComplete: true,
    };
    const parent = validateKitImportProof({
      schemaVersion: "1.1.0", mode: "audit-import-target", snapshotId: SNAPSHOT,
      importFactId: fact.id, originFile: origin, sourceSpecifier: fact.sourceSpecifier,
      status: targets.length ? "present" : "indeterminate", candidatePaths: targets,
      selectionComplete: true, reasonCode: targets.length === 1 ? "TARGET_IN_SELECTED_INVENTORY" : "FIXTURE",
    }, { snapshotId: SNAPSHOT, fact, evidence });
    const candidateDomain = [absent, ...targets].sort();
    const payload = {
      schemaVersion: "1.0.0", profile: "js-ts-selected-source-reference-v1",
      pathIdentityProfile: "selected-source-path-v1", snapshotId: SNAPSHOT, selectionFingerprint,
      selectedDomainDigest: sha256Hex(JSON.stringify(inventory.map(record => record.path).sort())),
      originFile: origin, originContentSha256: HASH, importFactId: fact.id, sourceSpecifier: fact.sourceSpecifier,
      resolutionPlatform: process.platform === "win32" ? "win32" : "posix",
      candidateEnumerationComplete: true, candidateDomain,
      qualifiedReference: qualified ? { targetPath: peer, targetContentSha256: HASH, referenceKind: "selected-source-reference" } : null,
      premiseRefs: candidateDomain.map(filePath => ({ role: "candidate", path: filePath,
        state: filePath === absent ? "absent" : "file", contentSha256: filePath === absent ? null : HASH })),
      reasonCode: null,
    };
    return { payload, parse: (raw: unknown) => validateKitOrdinarySourceReference(raw, parent, evidence, fact), parent };
  };

  it("keeps legacy envelopes readable and derives singleton, multiple, empty and unknown bounds independently", () => {
    const single = extension([peer], true);
    expect(single.parse(single.payload)).toMatchObject({ selectedTargetUpperBound: [peer], qualifiedSourceReferencePath: peer });
    expect(validateKitImportProof({ ...single.parent, sourceReferenceProof: { ignored: false } }, { snapshotId: SNAPSHOT, fact }))
      .toMatchObject({ candidatePaths: [peer], status: "present" });
    const multiple = extension([peer, alternate]);
    expect(multiple.parse(multiple.payload).selectedTargetUpperBound).toEqual([peer, alternate]);
    expect(multiple.parse(multiple.payload).qualifiedSourceReferencePath).toBeUndefined();
    const missing = extension([]);
    expect(missing.parse(missing.payload).selectedTargetUpperBound).toEqual([]);
    expect(single.parse({ ...single.payload, candidateEnumerationComplete: false, candidateDomain: null,
      qualifiedReference: null, reasonCode: "UNSUPPORTED_PROFILE" }).selectedTargetUpperBound).toBeUndefined();
  });

  it.each([
    ["schemaVersion", "2.0.0"], ["profile", "unknown"], ["pathIdentityProfile", "unknown"],
    ["snapshotId", "wrong"], ["selectionFingerprint", "wrong"], ["selectedDomainDigest", "wrong"],
    ["originFile", "src/other.ts"], ["originContentSha256", "d".repeat(64)],
    ["importFactId", "different-fact"], ["sourceSpecifier", "./other.js"],
    ["resolutionPlatform", process.platform === "win32" ? "posix" : "win32"],
    ["candidateDomain", ["../outside.ts"]], ["candidateDomain", Array(257).fill(peer)],
    ["candidateDomain", ["src/" + "x".repeat(4096) + ".ts"]],
    ["candidateDomain", [peer, peer]], ["candidateDomain", [peer, absent]], ["candidateDomain", []],
    ["qualifiedReference", { targetPath: peer, targetContentSha256: "d".repeat(64), referenceKind: "selected-source-reference" }],
    ["premiseRefs", Array(1025).fill({})], ["premiseRefs", []],
    ["reasonCode", "CONTRADICTORY"], ["extra", true],
  ])("rejects invalid closed proof data in %s", (key, value) => {
    const one = extension([peer], true);
    expect(() => one.parse({ ...one.payload, [key as string]: value })).toThrow(KitSourceEvidenceAcquisitionError);
  });

  it("rejects conflicting, noncanonical and non-closed premise records", () => {
    const one = extension([peer]);
    const first = one.payload.premiseRefs[0]!;
    for (const premise of [
      { ...first }, { ...first, extra: true }, { ...first, role: "path", state: "directory" },
      { role: "path", path: peer, state: "absent", contentSha256: null },
      ...(process.platform === "win32" ? [{ role: "path", path: "src/Peer.ts", state: "file", contentSha256: HASH }] : []),
    ]) {
      expect(() => one.parse({ ...one.payload, premiseRefs: [...one.payload.premiseRefs, premise] }))
        .toThrow(KitSourceEvidenceAcquisitionError);
    }
    expect(() => one.parse({ ...one.payload, candidateEnumerationComplete: false, candidateDomain: null,
      reasonCode: "x".repeat(1048576) })).toThrow(/serialized byte budget/);
  });
});

describe("FACTS02-PLAYWRIGHT-MODIFIER-PROVENANCE/1.0.0", () => {
  const originFile = "tests/check.test.ts";
  const wrapperPath = "tests/support/fixture.ts";
  const selectionFingerprint = "c".repeat(64);
  const span = (path: string, line: number, startColumn: number, endColumn: number) =>
    ({ path, startLine: line, startColumn, endLine: line, endColumn });

  function contract(kind: "direct" | "local" | "imported") {
    const baseImport = 'import { test as base } from "@playwright/test";';
    const originImport = 'import { test } from "./support/fixture";';
    const prefix = kind === "imported" ? [originImport] : kind === "local"
      ? [baseImport, "const test = base.extend({});"] : ['import { test } from "@playwright/test";'];
    const originText = [...prefix, 'test.skip(process.env.GUARD, "review");', 'test.only("focus", () => {});'].join("\r\n");
    const wrapperText = [baseImport, "export const test = base.extend({});"].join("\r\n");
    const record = (path: string, text: string) => validateKitFileRecord(fileJson(path, {
      sizeBytes: Buffer.byteLength(text), lineCount: text.split("\n").length, contentSha256: sha256Hex(text),
    }), path);
    const originRecord = record(originFile, originText);
    const wrapperRecord = record(wrapperPath, wrapperText);
    const inventory = kind === "imported" ? [originRecord, wrapperRecord] : [originRecord];
    const selected = new Map(inventory.map(file => [file.path, file]));
    const selectedDomainDigest = sha256Hex(JSON.stringify([...selected.keys()].sort()));
    const fact = validateKitFact(factJson(originFile, "audit-fact:tests%2Fcheck.test.ts#import#1#0#0", {
      kind: "import", span: span(originFile, 1, 0, 41),
      sourceSpecifier: "./support/fixture", importedNames: ["test"], importResolution: "resolved-local",
      targetPaths: [wrapperPath],
    }), "import", originFile);
    const origin = { record: originRecord, facts: kind === "imported" ? [fact] : [], factPages: 1 };
    const evidence: KitSourceEvidence = {
      producer: { packageName: "@dailephd/my-dev-kit", packageVersion: "1.16.0" },
      artifactSchemaVersion: "1.2.0", extractorRevision: "source-audit-v1.6.0",
      source: { projectRoot: "/fixture", sourceRoots: ["tests"], excludes: [], symbolIndexSchemaVersion: "3",
        codeGraphSchemaVersion: "1.1.0", selectionFingerprint, snapshotId: SNAPSHOT },
      inventory, snapshotId: SNAPSHOT, coverage: { ...COVERAGE, selectedFileCount: inventory.length, recordedFileCount: inventory.length },
      fileEvidence: new Map([[originFile, origin]]), inventoryPages: 1, factPages: 1, traversalComplete: true,
    };
    const identity = { schemaVersion: "1.0.0", snapshotId: SNAPSHOT, selectionFingerprint, selectedDomainDigest,
      originFile, originContentSha256: originRecord.contentSha256 };
    const importTargetProof = {
      schemaVersion: "1.1.0", mode: "audit-import-target", snapshotId: SNAPSHOT, originFile,
      importFactId: fact.id, sourceSpecifier: "./support/fixture", candidatePaths: [wrapperPath],
      status: "present", reasonCode: "TARGET_IN_SELECTED_INVENTORY", selectionComplete: true,
      sourceReferenceProof: {
        ...identity, profile: "js-ts-selected-source-reference-v1", pathIdentityProfile: "selected-source-path-v1",
        importFactId: fact.id, sourceSpecifier: "./support/fixture", resolutionPlatform: process.platform === "win32" ? "win32" : "posix",
        candidateEnumerationComplete: true, candidateDomain: [wrapperPath], reasonCode: null,
        qualifiedReference: { targetPath: wrapperPath, targetContentSha256: wrapperRecord.contentSha256, referenceKind: "selected-source-reference" },
        premiseRefs: [{ path: wrapperPath, role: "candidate", state: "file", contentSha256: wrapperRecord.contentSha256 }],
      },
    };
    const wrapper = { path: wrapperPath, contentSha256: wrapperRecord.contentSha256,
      exportBindingSpan: span(wrapperPath, 2, 13, 35), importTargetProof };
    const runnerBinding = {
      localName: "test", kind: kind === "direct" ? "direct-playwright" : `${kind}-extended-playwright`,
      bindingSpan: kind === "local" ? span(originFile, 2, 6, 28) : span(originFile, 1, 9, 13),
      baseLocalName: kind === "direct" ? "test" : "base",
      baseImportSpan: span(kind === "imported" ? wrapperPath : originFile, 1, 9, kind === "direct" ? 13 : 21),
      extensionSpan: kind === "local" ? span(originFile, 2, 13, 28) : kind === "imported" ? span(wrapperPath, 2, 20, 35) : null,
      wrapper: kind === "imported" ? wrapper : null,
    };
    const wire = {
      ...identity, profile: "js-ts-playwright-direct-extended-modifiers-v1", coverage: "complete", runnerBinding,
      observations: [
        { modifier: "skip", calleeSpan: span(originFile, prefix.length + 1, 0, 9), callSpan: span(originFile, prefix.length + 1, 0, 38) },
        { modifier: "only", calleeSpan: span(originFile, prefix.length + 2, 0, 9), callSpan: span(originFile, prefix.length + 2, 0, 28) },
      ],
      reasonCodes: [],
    };
    const parse = (raw: Record<string, unknown> = wire) => validateKitTestModifierProof(raw, origin, evidence, selected,
      selectedDomainDigest, file => Buffer.from(file.path === originFile ? originText : wrapperText));
    return { wire, parse, origin, wrapper, importTargetProof };
  }

  it.each(["direct", "local", "imported"] as const)("qualifies %s runner evidence and preserves exact conditional and focus spans", kind => {
    const { parse, wire } = contract(kind);
    expect(parse()).toMatchObject({ originFile, coverage: "complete", observations: wire.observations,
      runnerBinding: { kind: wire.runnerBinding.kind } });
    if (kind === "imported") expect(parse().runnerBinding.wrapper?.reference.qualifiedSourceReferencePath).toBe(wrapperPath);
  });

  it("admits the extension only in its authorized page and preserves all legacy pagination and identities", async () => {
    const { wire } = contract("direct");
    const file = fileJson(originFile, { capabilities: { ...capabilities(), "dynamic-import-expressions": "complete" } });
    const total = KIT_FACT_PAGE_SIZE + 1;
    const facts = Array.from({ length: total }, (_, index) => factJson(originFile, "audit-fact:legacy#" + index));
    const page = (pageIndex: number, extra: Record<string, unknown> = {}) => factPageJson(originFile, pageIndex, total,
      facts.slice(pageIndex * KIT_FACT_PAGE_SIZE, (pageIndex + 1) * KIT_FACT_PAGE_SIZE),
      { file, schemaVersion: "1.2.0", ...extra });
    const expected = { snapshotId: SNAPSHOT, path: originFile, qualifiedTestModifierProof: true } as const;
    const pages = await collectAllPages(async pageIndex => validateFactPage(
      page(pageIndex, pageIndex === 0 ? { testModifierProof: wire } : {}), { ...expected, pageIndex }),
    { maxPages: 2, label: "modifier fixture pages" });
    expect(pages[0]).toMatchObject({ totalItems: total, totalPages: 2, testModifierProof: wire });
    expect(flattenFactPages(originFile, pages, new Set()).map(fact => fact.id)).toEqual(facts.map(fact => fact.id));
    expectFailure(() => validateFactPage(page(1, { testModifierProof: wire }), { ...expected, pageIndex: 1 }), "page-invalid");
    expectFailure(() => validateFactPage(page(0, { testModifierProof: wire, status: "unsupported" }), { ...expected, pageIndex: 0 }), "page-invalid");
    const oldPage = page(0, { schemaVersion: "1.1.0", file: fileJson(originFile), testModifierProof: wire });
    expectFailure(() => validateFactPage(oldPage, { ...expected, pageIndex: 0 }), "page-invalid");
    expect(validateFactPage(oldPage, { ...expected, qualifiedTestModifierProof: undefined, pageIndex: 0 }))
      .not.toHaveProperty("testModifierProof");
    expectFailure(() => validateFactPage(page(0, { testModifierProof: { extra: "x".repeat(1024 * 1024) } }),
      { ...expected, pageIndex: 0 }), "page-invalid");
  });

  it("keeps qualified partial positives without granting complete coverage", () => {
    const { parse, wire } = contract("local");
    const partial = { ...wire, coverage: "partial", reasonCodes: ["UNRESOLVED_BINDING_USE", "UNSUPPORTED_MODIFIER_FORM"] };
    expect(parse(partial)).toMatchObject({ coverage: "partial", observations: wire.observations });
    for (const reasonCodes of [[], ["UNKNOWN"], ["UNRESOLVED_BINDING_USE", "UNRESOLVED_BINDING_USE"],
      ["UNSUPPORTED_MODIFIER_FORM", "UNRESOLVED_BINDING_USE"], Array(7).fill("PROOF_BUDGET_EXCEEDED")]) {
      expect(() => parse({ ...partial, reasonCodes })).toThrow(KitSourceEvidenceAcquisitionError);
    }
    expect(() => parse({ ...wire, reasonCodes: partial.reasonCodes })).toThrow(KitSourceEvidenceAcquisitionError);
  });

  it("rejects identity, binding, observation and closed shape contradictions", () => {
    const { parse, wire } = contract("direct");
    const [skip, only] = wire.observations;
    for (const change of [
      { snapshotId: HASH }, { selectionFingerprint: HASH }, { selectedDomainDigest: HASH }, { originContentSha256: HASH },
      { originFile: wrapperPath }, { originFile: "a".repeat(4097) }, { schemaVersion: "1.1.0" }, { profile: "unknown" },
      { runtimeExecuted: false }, { coverage: "unknown" }, { observations: Array(1025).fill(skip) },
      { observations: [only, skip] }, { observations: [skip, skip] },
      { observations: [{ ...skip, condition: true }] }, { observations: [{ ...skip, modifier: "fixme" }] },
      { observations: [{ ...skip, callSpan: skip!.calleeSpan }] },
      { observations: [{ ...skip, calleeSpan: { ...skip!.calleeSpan, startColumn: null } }] },
      { observations: [{ ...skip, calleeSpan: { ...skip!.calleeSpan, path: wrapperPath } }] },
      { observations: [{ ...skip, calleeSpan: { ...skip!.calleeSpan, startLine: 0 } }] },
      { observations: [{ ...skip, callSpan: { ...skip!.callSpan, endColumn: 40 } }] },
      { observations: [{ ...skip, callSpan: { ...skip!.callSpan, endLine: 4 } }] },
      ...[{ kind: "arbitrary-factory" }, { localName: "fake" }, { baseLocalName: "unrelated" },
        { baseImportSpan: span(originFile, 1, 9, 14) }, { extensionSpan: wire.runnerBinding.bindingSpan }, { extra: true }]
        .map(fields => ({ runnerBinding: { ...wire.runnerBinding, ...fields } })),
    ]) {
      expect(() => parse({ ...wire, ...change }), JSON.stringify(change).slice(0, 150)).toThrow(KitSourceEvidenceAcquisitionError);
    }
    const local = contract("local");
    expect(() => local.parse({ ...local.wire,
      runnerBinding: { ...local.wire.runnerBinding, extensionSpan: span(originFile, 1, 0, 10) } })).toThrow(/runner spans/);
  });

  it("requires the actual named origin import and a qualified ordinary target, even when the graph target agrees", () => {
    const { parse, wire, origin, wrapper, importTargetProof } = contract("imported");
    const withWrapper = (changed: Record<string, unknown>) => ({ ...wire,
      runnerBinding: { ...wire.runnerBinding, wrapper: { ...wrapper, ...changed } } });
    for (const changed of [
      { path: originFile }, { path: "tests/unselected.ts" }, { contentSha256: HASH }, { extra: true },
      { exportBindingSpan: span(originFile, 2, 13, 35) },
      { importTargetProof: { ...importTargetProof, sourceReferenceProof: undefined } },
      { importTargetProof: { ...importTargetProof, importFactId: "audit-fact:wrong" } },
      { importTargetProof: { ...importTargetProof, sourceSpecifier: "./different" } },
      { importTargetProof: { ...importTargetProof, sourceReferenceProof: { ...importTargetProof.sourceReferenceProof, qualifiedReference: null } } },
      { importTargetProof: { ...importTargetProof, sourceReferenceProof: { ...importTargetProof.sourceReferenceProof,
        qualifiedReference: { ...importTargetProof.sourceReferenceProof.qualifiedReference, targetPath: originFile } } } },
    ]) expect(() => parse(withWrapper(changed))).toThrow(KitSourceEvidenceAcquisitionError);
    expect(() => parse({ ...wire, runnerBinding: { ...wire.runnerBinding, bindingSpan: span(originFile, 2, 0, 4) } }))
      .toThrow(/named import fact/);
    const [fact] = origin.facts;
    origin.facts[0] = { ...fact!, importedNames: ["expect"] };
    expect(() => parse()).toThrow(/named import fact/);
    origin.facts.length = 0;
    expect(() => parse()).toThrow(/named import fact/);
  });
});

describe("FACTS02-COMPUTED-POSITIVE-REFERENCE/1.0.0", () => {
  const origin = "src/entry.mjs";
  const peer = "src/peer.mjs";
  const alternate = "src/peer.mts";
  const selectionFingerprint = "c".repeat(64);
  const span = { path: origin, startLine: 2, startColumn: 5, endLine: 2, endColumn: 18 };
  const operandSpan = { ...span, startColumn: 12, endColumn: 17 };
  const fact: KitFact = {
    id: "audit-fact:src%2Fentry.mjs#dynamic-import-expression#2#5#0",
    kind: "dynamic-import-expression", extractionMethod: "typescript-ast", span,
    dynamicImport: { operandForm: "computed", operandSpan },
  };
  const fixture = (targets = [peer]) => {
    const inventory = [origin, ...targets].map(filePath => validateKitFileRecord(fileJson(filePath, {
      language: filePath.endsWith(".mts") ? "typescript" : "javascript", lineCount: 2,
      capabilities: { ...capabilities(), "dynamic-import-expressions": "complete" },
    }), filePath, "1.2.0"));
    const evidence: KitSourceEvidence = {
      producer: { packageName: "@dailephd/my-dev-kit", packageVersion: "1.16.0" },
      artifactSchemaVersion: "1.2.0", extractorRevision: "source-audit-v1.6.0",
      source: { projectRoot: process.cwd(), sourceRoots: ["src"], excludes: [], symbolIndexSchemaVersion: "3",
        codeGraphSchemaVersion: "1.1.0", selectionFingerprint, snapshotId: SNAPSHOT },
      inventory, snapshotId: SNAPSHOT, coverage: { ...COVERAGE, selectedFileCount: inventory.length, recordedFileCount: inventory.length },
      fileEvidence: new Map([[origin, { record: inventory[0]!, facts: [fact], factPages: 1 }]]),
      inventoryPages: 1, factPages: 1, traversalComplete: true,
    };
    const source = { type: "source-span", filePath: origin, contentSha256: HASH };
    const alternative = {
      alternativeIndex: 0, specifier: "./peer.mjs", premiseIndexes: [0, 1],
      resolution: { status: "present", candidatePaths: [peer, alternate], reasonCode: "TARGET_IN_SELECTED_INVENTORY",
        candidateEnumerationComplete: true, selectionComplete: true },
    };
    const payload = {
      schemaVersion: "1.0.0", mode: "audit-import-domain", snapshotId: SNAPSHOT, selectionFingerprint,
      originFile: origin, originContentSha256: HASH, importExpressionFactId: fact.id, resolverProfile: "js-ts-dynamic-import-v1",
      pathIdentityProfile: "selected-source-path-v1", resolutionPlatform: process.platform === "win32" ? "win32" : "posix",
      selectedDomainDigest: sha256Hex(JSON.stringify(inventory.map(record => record.path).sort())),
      outcome: "finite", operandAlternatives: [alternative], domainComplete: true,
      premiseRefs: [
        { ...source, role: "operand", span: operandSpan },
        { ...source, role: "binding", span: { ...span, startLine: 1, endLine: 1 } },
        { ...source, role: "operation", span },
      ],
      qualifiedPositiveWitnesses: [],
      disjointProof: null, reasonCode: null,
    };
    const witness = {
      schemaVersion: "1.0.0", profile: "js-ts-computed-exact-source-reference-v1",
      expressionFactId: fact.id, alternativeIndex: 0, specifier: "./peer.mjs",
      targetPath: peer, targetContentSha256: HASH, premiseIndexes: [0, 1],
      resolutionPremiseRefs: [
        { role: "candidate", path: peer, state: "file", contentSha256: HASH },
        { role: "candidate", path: alternate, state: "absent", contentSha256: null },
        ...["jsconfig.json", "src/jsconfig.json", "src/tsconfig.json", "tsconfig.json"].map(filePath =>
          ({ role: "config", path: filePath, state: "absent", contentSha256: null })),
      ],
    };
    const parse = (raw: unknown, qualified: boolean = true) => validateKitImportDomain(raw, evidence, fact, qualified ? true : undefined);
    return { evidence, payload, witness, alternative, parse };
  };

  it("adds an expression-only positive without changing the finite bound or fabricating ordinary facts", () => {
    const f = fixture();
    const response = { ...f.payload, expressionReferenceProof: f.witness };
    expect(f.parse(response)).toMatchObject({ expressionFactId: fact.id, positivePaths: [peer], selectedTargetUpperBound: [peer] });
    for (const result of [f.parse(response, false), f.parse(f.payload)]) {
      expect(result.positivePaths).toEqual([]);
      expect(result.selectedTargetUpperBound).toEqual([peer]);
    }
    expect(f.evidence.fileEvidence.get(origin)?.facts).toEqual([fact]);
    expect(fact.dynamicImport?.literalImportFactId).toBeUndefined();
  });

  it.each([
    { alternativeIndex: 1 }, { expressionFactId: "other" }, { specifier: "./different.mjs" },
    { targetPath: alternate }, { targetContentSha256: "" }, { targetContentSha256: "d".repeat(64) },
    { premiseIndexes: [1, 0] }, { premiseIndexes: [0, 0] }, { premiseIndexes: [0, 2] },
    { premiseIndexes: [0, 256] }, { premiseIndexes: [0] }, { schemaVersion: "1.1.0" },
    { profile: "unqualified" }, { unexpected: true }, { resolutionPremiseRefs: [] },
    { resolutionPremiseRefs: Array(1025).fill({}) }, { targetPath: "../outside.js" },
  ])("rejects invalid extension fields %j", patch => {
    const f = fixture();
    expect(() => f.parse({ ...f.payload, expressionReferenceProof: { ...f.witness, ...patch } }))
      .toThrow(KitSourceEvidenceAcquisitionError);
  });

  it.each(["./peer", "./peer.mts", "@/peer.mjs", "./p%65er.mjs", "./peer.mjs?q", "./peer.mjs#x",
    "file:///src/peer.mjs", "/src/peer.mjs", "./peer/index.mjs"])("rejects nonexact operand %s", specifier => {
    const f = fixture();
    expect(() => f.parse({ ...f.payload, operandAlternatives: [{ ...f.alternative, specifier }],
      expressionReferenceProof: { ...f.witness, specifier } })).toThrow(KitSourceEvidenceAcquisitionError);
  });

  it("requires complete singleton destination and authenticated parent identity", () => {
    const f = fixture();
    for (const patch of [{ snapshotId: "other" }, { selectionFingerprint: "other" }, { originContentSha256: "other" },
      { originFile: "src/other.mjs" }, { resolutionPlatform: f.payload.resolutionPlatform === "win32" ? "posix" : "win32" },
      { extraBytes: "x".repeat(1048576) },
      { operandAlternatives: [{ ...f.alternative, resolution: { ...f.alternative.resolution, candidateEnumerationComplete: false } }] },
      { operandAlternatives: [{ ...f.alternative, resolution: { ...f.alternative.resolution, candidatePaths: [alternate] } }] },
      { operandAlternatives: [f.alternative, { ...f.alternative, alternativeIndex: 1, specifier: "./other.mjs" }] }]) {
      expect(() => f.parse({ ...f.payload, ...patch, expressionReferenceProof: f.witness })).toThrow(KitSourceEvidenceAcquisitionError);
    }
    const multiple = fixture([peer, alternate]);
    expect(() => multiple.parse({ ...multiple.payload, expressionReferenceProof: multiple.witness })).toThrow(KitSourceEvidenceAcquisitionError);
    expect(multiple.parse(multiple.payload).selectedTargetUpperBound).toEqual([peer, alternate]);
    const multiOperands = { ...f.payload, operandAlternatives: [f.alternative,
      { ...f.alternative, alternativeIndex: 1, specifier: "./other.mjs" }] };
    expect(f.parse(multiOperands).selectedTargetUpperBound).toEqual([peer]);
  });

  it("requires absent applicable configs and consistent candidate states", () => {
    const f = fixture();
    const refs = f.witness.resolutionPremiseRefs;
    const config = refs.find(p => p.path === "tsconfig.json")!;
    for (const resolutionPremiseRefs of [
      refs.filter(p => p !== config), refs.filter(p => p.path !== alternate),
      refs.map(p => p === config ? { ...p, state: "file", contentSha256: HASH } : p),
      refs.map(p => p.path === alternate ? { ...p, state: "file", contentSha256: HASH } : p),
      [...refs, { role: "path", path: peer, state: "absent", contentSha256: null }],
      [...refs, { role: "path", path: "../escape", state: "absent", contentSha256: null }],
      [...refs, { role: "path", path: "src", state: "directory", contentSha256: null, extra: true }],
    ]) {
      expect(() => f.parse({ ...f.payload, expressionReferenceProof: { ...f.witness, resolutionPremiseRefs } }))
        .toThrow(KitSourceEvidenceAcquisitionError);
    }
  });

  it("preserves separate literal-linked, unknown and disjoint behavior", () => {
    const f = fixture();
    const link: KitFact = { id: "audit-fact:src%2Fentry.mjs#import#2#5#0", kind: "import",
      extractionMethod: "typescript-ast", span, sourceSpecifier: "./peer.mjs" };
    const linked: KitFact = { ...fact, dynamicImport: { operandForm: "string-literal", operandSpan, literalImportFactId: link.id } };
    f.evidence.fileEvidence.get(origin)!.facts.push(link);
    const literal = { ...f.payload, qualifiedPositiveWitnesses: [{
      importFactId: link.id, targetPath: peer, targetContentSha256: HASH, targetProof: {
        schemaVersion: "1.1.0", mode: "audit-import-target", snapshotId: SNAPSHOT, importFactId: link.id,
        originFile: origin, sourceSpecifier: "./peer.mjs", status: "present", candidatePaths: [peer],
        selectionComplete: true, reasonCode: "TARGET_IN_SELECTED_INVENTORY",
      },
    }] };
    expect(validateKitImportDomain(literal, f.evidence, linked, true).positivePaths).toEqual([peer]);
    expect(() => validateKitImportDomain({ ...literal, expressionReferenceProof: f.witness }, f.evidence, linked, true))
      .toThrow(KitSourceEvidenceAcquisitionError);
    const unknown = { ...f.payload, outcome: "indeterminate", domainComplete: false,
      premiseRefs: [], operandAlternatives: [], reasonCode: "UNSUPPORTED_EXPRESSION" };
    expect(f.parse(unknown)).toMatchObject({ positivePaths: [], outcome: "indeterminate" });
    expect(f.parse(unknown).selectedTargetUpperBound).toBeUndefined();
    const missing = ["src/missing.mjs", "src/missing.mts"];
    const disjoint = { ...f.payload, outcome: "disjoint-selected-domain",
      operandAlternatives: [{ ...f.alternative, specifier: "./missing.mjs",
        resolution: { ...f.alternative.resolution, status: "proven-missing", candidatePaths: missing,
          reasonCode: "ALL_CANDIDATES_ABSENT_IN_COMPLETE_SELECTION" } }],
      disjointProof: { rule: "fixed-normalized-path-v1", values: missing, premiseIndexes: [0, 1] } };
    expect(f.parse(disjoint)).toMatchObject({ excludesSelectedDomain: true, positivePaths: [], selectedTargetUpperBound: [] });
  });
});
