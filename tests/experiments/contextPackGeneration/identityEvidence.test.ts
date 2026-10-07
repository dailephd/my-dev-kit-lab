import { describe, expect, it } from "vitest";
import {
  buildContextPack,
  buildContextPackIdentityEvidence,
  buildRawFullFileIdentityEvidence,
  collectContextPackSymbols,
  collectRawFullFileSymbols,
  type IndexedSourceFileSymbols
} from "../../../src/experiments/plugins/contextPackGeneration/index.js";

const sym = (name: string, line: number) => ({ name, location: { line } });

const indexed: IndexedSourceFileSymbols[] = [
  { path: "src/b.ts", symbols: [sym("zeta", 20), sym("beta", 3)] },
  { path: "src/a.ts", symbols: [sym("alpha", 1), sym("alphaTwo", 12), sym("alphaFar", 80)] },
  { path: "src/unused.ts", symbols: [sym("hidden", 1)] }
];

describe("raw-full-file symbol adapter", () => {
  it("returns symbols defined in included files only, in deterministic order", () => {
    expect(collectRawFullFileSymbols(indexed, ["src/b.ts", "./src/a.ts"])).toEqual([
      { name: "alpha", file: "src/a.ts" },
      { name: "alphaFar", file: "src/a.ts" },
      { name: "alphaTwo", file: "src/a.ts" },
      { name: "beta", file: "src/b.ts" },
      { name: "zeta", file: "src/b.ts" }
    ]);
  });

  it("excludes files that were not included and is independent of input order", () => {
    const result = collectRawFullFileSymbols([...indexed].reverse(), ["src/a.ts"]);
    expect(result.map((s) => s.name)).toEqual(["alpha", "alphaFar", "alphaTwo"]);
    expect(collectRawFullFileSymbols(indexed, [])).toEqual([]);
  });

  it("builds identity evidence with caller-supplied availability and no answer-key input", () => {
    const evidence = buildRawFullFileIdentityEvidence({ includedFiles: ["src/b.ts", "src/a.ts"], indexedFiles: indexed, availability: "available", reason: null });
    expect(evidence.files).toEqual(["src/a.ts", "src/b.ts"]);
    expect(evidence.availability).toBe("available");
    expect("availabilityReason" in evidence).toBe(false);
    const partial = buildRawFullFileIdentityEvidence({ includedFiles: [], indexedFiles: indexed, availability: "partial", reason: "r" });
    expect(partial).toEqual({ availability: "partial", availabilityReason: "r", files: [], symbols: [] });
  });
});

describe("context-pack symbol adapter", () => {
  const pack = buildContextPack({
    caseId: "c",
    benchmarkProject: "p",
    taskLocality: null,
    task: { title: "t", summary: "s" },
    myDevKitVersion: "1.12.5",
    fileCandidates: [{ path: "src/a.ts", origin: "search", rank: 1 }],
    symbolCandidates: [
      { name: "alpha", nodeId: "n1", file: "src/a.ts", origin: "search", rank: 1 },
      { name: "outside", nodeId: "n9", file: "src/other.ts", origin: "search", rank: 2 },
      { name: "nofile", nodeId: null, file: null, origin: "search", rank: 3 }
    ],
    sourceSliceCandidates: [{ file: "src/a.ts", nodeId: "n1", startLine: 1, endLine: 15, text: Array.from({ length: 15 }, (_, i) => `l${i}`).join("\n"), boundaryKnown: true, rank: 1 }],
    callCandidates: [],
    testCandidates: [{ path: "tests/a.test.ts", origin: "search-candidate" }],
    sectionAvailability: {
      files: { availability: "available", reason: null },
      symbols: { availability: "available", reason: null },
      sourceSlices: { availability: "available", reason: null },
      callRelationships: { availability: "available", reason: null },
      tests: { availability: "available", reason: null },
      evidenceNotes: { availability: "available", reason: null }
    },
    availability: "available",
    reason: null
  });

  it("unions explicit symbols with indexed symbols whose definition is inside a selected slice", () => {
    const symbols = collectContextPackSymbols(pack, indexed);
    expect(symbols).toEqual([
      { name: "nofile" },
      { name: "alpha", file: "src/a.ts" },
      { name: "alphaTwo", file: "src/a.ts" },
      { name: "outside", file: "src/other.ts" }
    ]);
  });

  it("excludes definitions outside selected ranges and other files, and deduplicates overlap", () => {
    const names = collectContextPackSymbols(pack, indexed).map((s) => s.name);
    expect(names).not.toContain("alphaFar");
    expect(names).not.toContain("beta");
    expect(names.filter((name) => name === "alpha")).toHaveLength(1);
  });

  it("is deterministic regardless of index order", () => {
    expect(collectContextPackSymbols(pack, [...indexed].reverse())).toEqual(collectContextPackSymbols(pack, indexed));
  });

  it("builds identity evidence from actual pack files and symbols, excluding tests, with pack availability", () => {
    const evidence = buildContextPackIdentityEvidence(pack, indexed);
    expect(evidence.files).toEqual(["src/a.ts"]);
    expect(evidence.files).not.toContain("tests/a.test.ts");
    expect(evidence.availability).toBe("available");
    expect(evidence.symbols).toEqual(collectContextPackSymbols(pack, indexed));
    expect(buildContextPackIdentityEvidence({ ...pack, availability: "unavailable", reason: "x" }, indexed)).toMatchObject({
      availability: "unavailable",
      availabilityReason: "x"
    });
  });
});
