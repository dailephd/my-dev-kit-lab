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
