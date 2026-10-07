import { describe, expect, it } from "vitest";
import { countEstimatedTokens, countTextChars, tokenCountMethod } from "../../../src/core/countTokens.js";
import {
  CONTEXT_PACK_SCHEMA_VERSION,
  CONTEXT_PACK_SECTION_IDS,
  buildContextPack,
  type BuildContextPackInput
} from "../../../src/experiments/plugins/contextPackGeneration/index.js";

const available = { availability: "available", reason: null } as const;

function input(overrides: Partial<BuildContextPackInput> = {}): BuildContextPackInput {
  return {
    caseId: "case-1",
    benchmarkProject: "proj",
    taskLocality: "cross-module",
    task: { title: "Import tasks", summary: "import tasks\r\nwith dedupe" },
    myDevKitVersion: "1.12.5",
    fileCandidates: [
      { path: "src/b.ts", origin: "search", rank: 2 },
      { path: "src/a.ts", origin: "search", rank: 1 },
      { path: "src/a.ts", origin: "graph", rank: 1 }
    ],
    symbolCandidates: [
      { name: "beta", nodeId: "symbol:src/b.ts#beta", file: "src/b.ts", origin: "search", rank: 2 },
      { name: "alpha", nodeId: "symbol:src/a.ts#alpha", file: "src/a.ts", origin: "search", rank: 1 }
    ],
    sourceSliceCandidates: [
      { file: "src/b.ts", nodeId: "symbol:src/b.ts#beta", symbolName: "beta", startLine: 3, endLine: 4, text: "line3\r\nline4\r\n", boundaryKnown: true, rank: 2 },
      { file: "src/a.ts", nodeId: "symbol:src/a.ts#alpha", symbolName: "alpha", startLine: 1, endLine: 2, text: "line1\nline2", boundaryKnown: false, continuationAvailable: true, rank: 1 }
    ],
    callCandidates: [
      { fromNodeId: "symbol:src/b.ts#beta", toNodeId: "symbol:src/a.ts#alpha", kind: "calls" },
      { fromNodeId: "symbol:src/a.ts#alpha", toNodeId: "symbol:src/b.ts#beta", kind: "defines" }
    ],
    testCandidates: [{ path: "tests/a.test.ts", origin: "search-candidate", rank: 3 }],
    sectionAvailability: {
      files: available,
      symbols: available,
      sourceSlices: { availability: "partial", reason: "continuation-not-attempted" },
      callRelationships: available,
      tests: available,
      evidenceNotes: available
    },
    availability: "partial",
    reason: "continuation-not-attempted",
    ...overrides
  };
}

describe("buildContextPack", () => {
  it("builds all seven sections in the exact order with the frozen schema and policy", () => {
    const pack = buildContextPack(input());
    expect(pack.schemaVersion).toBe("my-dev-kit-lab-context-pack-experiment-v1");
    expect(pack.schemaVersion).toBe(CONTEXT_PACK_SCHEMA_VERSION);
    expect(pack.sections.map((section) => section.id)).toEqual([...CONTEXT_PACK_SECTION_IDS]);
    expect(CONTEXT_PACK_SECTION_IDS).toEqual(["task", "files", "symbols", "sourceSlices", "callRelationships", "tests", "evidenceNotes"]);
    expect(pack.selectionPolicy.id).toBe("bounded-multiseed-v1");
    expect(pack.selectionPolicy.myDevKitVersion).toBe("1.12.5");
    const headings = pack.renderedText.split("\n").filter((line) => line.startsWith("## "));
    expect(headings).toEqual([
      "## Task",
      "## Relevant files",
      "## Relevant symbols",
      "## Source slices",
      "## Call relationships",
      "## Tests",
      "## Evidence notes"
    ]);
  });

  it("renders the exact frozen format", () => {
    const pack = buildContextPack(input());
    expect(pack.renderedText).toBe(
      [
        "## Task",
        "Title: Import tasks",
        "Summary: import tasks",
        "with dedupe",
        "",
        "## Relevant files",
        "- src/a.ts",
        "- src/b.ts",
        "",
        "## Relevant symbols",
        "- alpha (src/a.ts)",
        "- beta (src/b.ts)",
        "",
        "## Source slices",
        "file: src/a.ts",
        "lines: 1-2",
        "boundary: unknown",
        "truncated: no",
        "<<<SOURCE",
        "line1",
        "line2",
        "SOURCE>>>",
        "",
        "file: src/b.ts",
        "lines: 3-4",
        "boundary: known",
        "truncated: no",
        "<<<SOURCE",
        "line3",
        "line4",
        "SOURCE>>>",
        "",
        "## Call relationships",
        "symbol:src/b.ts#beta -> symbol:src/a.ts#alpha",
        "",
        "## Tests",
        "- tests/a.test.ts",
        "",
        "## Evidence notes",
        "- symbol-end-unknown",
        ""
      ].join("\n")
    );
  });

  it("uses LF only, ends with exactly one newline, and separates sections by exactly one blank line", () => {
    const { renderedText } = buildContextPack(input());
    expect(renderedText).not.toContain("\r");
    expect(renderedText.endsWith("\n")).toBe(true);
    expect(renderedText.endsWith("\n\n")).toBe(false);
    expect(renderedText).not.toContain("\n\n\n");
  });

  it("generates no machine paths or timestamps and keeps only normalized repository paths", () => {
    const pack = buildContextPack(
      input({ fileCandidates: [{ path: "C:\\Users\\x\\a.ts", origin: "search", rank: 1 }, { path: "/home/x/a.ts", origin: "search", rank: 2 }, { path: "src/ok.ts", origin: "search", rank: 3 }] })
    );
    expect(pack.files.map((file) => file.path)).toEqual(["src/ok.ts"]);
    expect(pack.renderedText).not.toMatch(/[A-Za-z]:[\\/]|\/home\//);
    expect(pack.renderedText).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(pack.evidenceNotes).toContain("invalid-repository-path-ignored");
  });

  it("orders files, symbols, slices, calls, tests and notes canonically and removes duplicates", () => {
    const pack = buildContextPack(
      input({
        testCandidates: [
          { path: "tests/z.test.ts", origin: "search-candidate", rank: 1 },
          { path: "tests/a.test.ts", origin: "search-candidate", rank: 1 },
          { path: "tests/a.test.ts", origin: "graph-neighbor", rank: 1 }
        ],
        callCandidates: [
          { fromNodeId: "b", toNodeId: "a", kind: "calls" },
          { fromNodeId: "a", toNodeId: "b", kind: "calls" },
          { fromNodeId: "a", toNodeId: "b", kind: "calls" }
        ],
        evidenceNotes: ["total-source-line-cap-reached", "symbol-end-unknown"]
      })
    );
    expect(pack.files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(pack.symbols.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(pack.sourceSlices.map((s) => s.file)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(pack.callRelationships.map((c) => `${c.fromNodeId}>${c.toNodeId}`)).toEqual(["a>b", "b>a"]);
    expect(pack.tests.map((t) => t.path)).toEqual(["tests/a.test.ts", "tests/z.test.ts"]);
    expect(pack.evidenceNotes).toEqual(["symbol-end-unknown", "total-source-line-cap-reached"]);
  });

  it("represents an unknown symbol end and never presents it as complete", () => {
    const pack = buildContextPack(input());
    const unknown = pack.sourceSlices.find((s) => s.file === "src/a.ts");
    expect(unknown?.boundaryKnown).toBe(false);
    expect(unknown?.continuationAvailable).toBe(true);
    expect(pack.evidenceNotes).toContain("symbol-end-unknown");
    expect(pack.renderedText).toContain("boundary: unknown");
  });

  it("applies the per-slice cap and notes it", () => {
    const text = Array.from({ length: 200 }, (_, i) => `l${i + 1}`).join("\n");
    const pack = buildContextPack(
      input({ sourceSliceCandidates: [{ file: "src/a.ts", nodeId: "n", startLine: 10, endLine: 209, text, boundaryKnown: true, rank: 1 }] })
    );
    expect(pack.sourceSlices[0]).toMatchObject({ startLine: 10, endLine: 169, lineCount: 160, truncated: true });
    expect(pack.evidenceNotes).toContain("source-slice-cap-reached");
    expect(pack.renderedText).toContain("lines: 10-169");
    expect(pack.renderedText).toContain("truncated: yes");
  });

  it("copies caller availability and keeps an empty available section distinct from unavailable", () => {
    const pack = buildContextPack(
      input({
        callCandidates: [],
        testCandidates: [],
        sectionAvailability: {
          files: available,
          symbols: available,
          sourceSlices: available,
          callRelationships: available,
          tests: { availability: "unavailable", reason: "tests-not-collected" },
          evidenceNotes: available
        },
        availability: "available",
        reason: null
      })
    );
    const byId = Object.fromEntries(pack.sections.map((section) => [section.id, section]));
    expect(byId.callRelationships).toMatchObject({ availability: "available", reason: null, itemCount: 0 });
    expect(byId.tests).toMatchObject({ availability: "unavailable", reason: "tests-not-collected", itemCount: 0 });
    expect(byId.task).toMatchObject({ availability: "available", itemCount: 1 });
    expect(pack.renderedText).toContain("## Call relationships\n(none)");
    expect(pack.renderedText).toContain("## Tests\n(unavailable: tests-not-collected)");
    expect(pack.availability).toBe("available");
  });

  it("measures pack size from the exact rendered text and sections from their exact strings", () => {
    const pack = buildContextPack(input());
    expect(pack.size).toEqual({
      totalChars: countTextChars(pack.renderedText),
      totalEstimatedTokens: countEstimatedTokens(pack.renderedText),
      tokenCountMethod
    });
    expect(pack.size.tokenCountMethod).toBe("estimated_chars_div_4");
    const sections = pack.renderedText.replace(/\n$/, "").split("\n\n");
    // Source slices contain an internal blank line, so compare by section heading boundaries instead.
    const starts = ["## Task", "## Relevant files", "## Relevant symbols", "## Source slices", "## Call relationships", "## Tests", "## Evidence notes"].map((h) =>
      pack.renderedText.indexOf(h)
    );
    const exact = starts.map((start, index) => pack.renderedText.slice(start, index + 1 < starts.length ? starts[index + 1] - 2 : pack.renderedText.length - 1));
    expect(pack.sections.map((section) => section.estimatedTokens)).toEqual(exact.map((text) => countEstimatedTokens(text)));
    expect(sections.length).toBeGreaterThanOrEqual(7);
  });

  it("is deterministic: identical input gives deeply equal output, independent of candidate order", () => {
    const first = buildContextPack(input());
    expect(buildContextPack(input())).toEqual(first);
    const base = input();
    const shuffled = input({
      fileCandidates: [...base.fileCandidates].reverse(),
      symbolCandidates: [...base.symbolCandidates].reverse(),
      sourceSliceCandidates: [...base.sourceSliceCandidates].reverse(),
      callCandidates: [...base.callCandidates].reverse()
    });
    expect(buildContextPack(shuffled)).toEqual(first);
  });

  it("does not mutate its input", () => {
    const original = input();
    const snapshot = JSON.parse(JSON.stringify(original));
    buildContextPack(original);
    expect(JSON.parse(JSON.stringify(original))).toEqual(snapshot);
  });
});
