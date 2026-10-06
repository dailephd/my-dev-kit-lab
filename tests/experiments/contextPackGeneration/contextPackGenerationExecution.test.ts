import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir, readKitLog, writeRecordingFakeKit } from "../contextWindowScaling/localSubjectFixture.js";
import { removeTempDir } from "../../evaluation/localRepositorySubject/fixtureRepository.js";
import {
  executeContextPackGeneration,
  type ContextPackGenerationCaseResult
} from "../../../src/experiments/plugins/contextPackGeneration/index.js";
import {
  SOURCE_TEXT_SENTINEL,
  STANDARD_SYMBOL_INDEX,
  makeEvaluationCase,
  makeHarness,
  standardWorld,
  type FakeHarness,
  type FakeKitWorld
} from "./contextPackGenerationTestHelpers.js";

const OUT = path.resolve("lab-output-test-context-pack");

async function run(harness: FakeHarness, cases = [makeEvaluationCase({ id: "c1" })]): Promise<ContextPackGenerationCaseResult[]> {
  return executeContextPackGeneration({ cases, kitCommand: "fake-kit", outputRoot: OUT, dependencies: harness.dependencies });
}

const commandsOf = (harness: FakeHarness, family: string) => harness.commands.filter((command) => command.args[0] === family);
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe("matched execution", () => {
  it("runs raw-full-file then context-pack for every case, in corpus order", async () => {
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
    const cases = [makeEvaluationCase({ id: "c1" }), makeEvaluationCase({ id: "c2" }), makeEvaluationCase({ id: "c3", project: "project-two" })];
    const results = await run(harness, cases);
    expect(results.map((result) => result.evidence.caseId)).toEqual(["c1", "c2", "c3"]);
    for (const result of results) expect(result.evidence.treatments.map((treatment) => treatment.treatmentId)).toEqual(["raw-full-file", "context-pack"]);
    const order = harness.events.filter((event) => event.startsWith("raw:") || event.startsWith("cmd:search"));
    expect(order).toEqual(["raw:c1", "cmd:search", "raw:c2", "cmd:search", "raw:c3", "cmd:search"]);
  });

  it("builds exactly one base index per benchmark project and reuses it for every command", async () => {
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
    await run(harness, [makeEvaluationCase({ id: "c1" }), makeEvaluationCase({ id: "c2" }), makeEvaluationCase({ id: "c3", project: "project-two" })]);
    expect(harness.indexBuilds).toHaveLength(2);
    const indexDirs = new Set(harness.indexBuilds.map((build) => build.indexDir));
    expect(indexDirs.size).toBe(2);
    const first = harness.indexBuilds[0].indexDir;
    const projectOneCommands = harness.commands.slice(0, harness.commands.findIndex((command, i) => i > 0 && flag(command.args, "--index") !== first));
    expect(projectOneCommands.length).toBeGreaterThan(0);
    expect(projectOneCommands.every((command) => flag(command.args, "--index") === first)).toBe(true);
  });

  it("performs one capped search per case and honors the 12-result cap", async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ kind: "file", nodeId: `file:src/f${String(i).padStart(2, "0")}.ts`, path: `src/f${String(i).padStart(2, "0")}.ts`, label: `f${i}` }));
    const harness = makeHarness({ world: standardWorld({ search: many }), symbolIndex: STANDARD_SYMBOL_INDEX });
    const [result] = await run(harness);
    const searches = commandsOf(harness, "search");
    expect(searches).toHaveLength(1);
    expect(flag(searches[0].args, "--limit")).toBe("12");
    expect(flag(searches[0].args, "--query")).toBe("query for c1");
    const packFiles = result.pack?.files.map((file) => file.path) ?? [];
    expect(packFiles).not.toContain("src/f12.ts");
    expect(packFiles).not.toContain("src/f14.ts");
    expect(packFiles).toHaveLength(12);
  });

  it("limits lookup and slice to at most 8 seeds, in upstream order, at depth exactly 1", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ kind: "file", nodeId: `file:src/f${String(i).padStart(2, "0")}.ts`, path: `src/f${String(i).padStart(2, "0")}.ts`, label: `f${i}` }));
    const harness = makeHarness({ world: standardWorld({ search: many }), symbolIndex: STANDARD_SYMBOL_INDEX });
    const [result] = await run(harness);
    const lookups = commandsOf(harness, "lookup");
    const slices = commandsOf(harness, "slice");
    expect(lookups.map((command) => flag(command.args, "--node"))).toEqual(many.slice(0, 8).map((hit) => hit.nodeId));
    expect(slices.map((command) => flag(command.args, "--node"))).toEqual(many.slice(0, 8).map((hit) => hit.nodeId));
    for (const command of [...lookups, ...slices]) expect(flag(command.args, "--depth")).toBe("1");
    expect(result.pack?.evidenceNotes).toContain("seed-cap-reached");
  });

  it("retrieves bounded index-derived source ranges through my-dev-kit and never continues to EOF", async () => {
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
    const [result] = await run(harness);
    const sources = commandsOf(harness, "source");
    expect(sources).toHaveLength(2);
    // A: defined at line 1, the next indexed symbol (A2) starts at 12 => 1-11.
    expect(sources[0].args).toEqual(expect.arrayContaining(["--file", "src/a.ts", "--start", "1", "--end", "11", "--json"]));
    // B: last symbol of a 300-line file => capped at 160 lines (5-164).
    expect(sources[1].args).toEqual(expect.arrayContaining(["--file", "src/b.ts", "--start", "5", "--end", "164", "--json"]));
    for (const source of sources) {
      expect(source.args).not.toContain("--continue");
      expect(source.args).not.toContain("--continue-from");
    }
    const slices = result.pack?.sourceSlices ?? [];
    expect(slices.map((slice) => [slice.file, slice.startLine, slice.boundaryKnown])).toEqual([["src/a.ts", 1, true], ["src/b.ts", 5, true]]);
    // Source text comes only from the source command evidence.
    expect(slices[0].text).toContain(`${SOURCE_TEXT_SENTINEL} src/a.ts L1`);
    // Natural range above 160 lines is cut and noted.
    expect(result.pack?.evidenceNotes).toContain("source-slice-cap-reached");
    expect(slices[1].truncated).toBe(true);
    expect(slices[1].continuationAvailable).toBe(true);
  });

  it("falls back to bounded source by node and records symbol-end-unknown as partial evidence", async () => {
    const world = standardWorld({
      sourceNode: (nodeId) => ({ startLine: 1, endLine: 20, content: `${SOURCE_TEXT_SENTINEL} ${nodeId}`, boundaryKnown: false, eof: false })
    });
    const harness = makeHarness({ world, symbolIndex: { not: "a symbol index" } });
    const [result] = await run(harness);
    const sources = commandsOf(harness, "source");
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.args).toEqual(expect.arrayContaining(["--node", "--max-lines", "160", "--json"]));
      expect(source.args).not.toContain("--file");
      expect(source.args).not.toContain("--continue");
    }
    const slice = result.pack?.sourceSlices[0];
    expect(slice?.boundaryKnown).toBe(false);
    expect(slice?.continuationAvailable).toBe(true);
    expect(slice?.truncated).toBe(false);
    expect(result.pack?.evidenceNotes).toContain("symbol-end-unknown");
    expect(result.pack?.availability).toBe("partial");
    const pack = result.evidence.treatments[1];
    expect(pack.status).toBe("partial");
    expect(pack.sections?.find((section) => section.id === "sourceSlices")).toMatchObject({ availability: "partial", reason: "symbol-end-unknown" });
    // Without a symbol index raw symbol evidence is explicitly partial, never guessed.
    expect(result.evidence.treatments[0]).toMatchObject({ status: "partial", availabilityReason: "symbol-index-unavailable" });
  });

  it("uses the same project index state for the raw and context-pack symbol evidence", async () => {
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
    const [result] = await run(harness);
    const [raw, pack] = result.evidence.treatments;
    expect(raw.identityEvidence?.symbols).toEqual([
      { name: "A", file: "src/a.ts" },
      { name: "A2", file: "src/a.ts" },
      { name: "B", file: "src/b.ts" },
      { name: "C", file: "src/c.ts" }
    ]);
    // Pack: explicit A and B plus indexed symbols defined inside the included ranges (A2 lies outside 1-11).
    expect(pack.identityEvidence?.symbols).toEqual([
      { name: "A", file: "src/a.ts" },
      { name: "B", file: "src/b.ts" }
    ]);
    expect(raw.size).toEqual({ totalChars: 4000, totalEstimatedTokens: 1000, tokenCountMethod: "estimated_chars_div_4" });
    expect(pack.size).toEqual(result.pack?.size);
  });

  it("keeps tests and call relationships descriptive and includes only calls edges", async () => {
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
    const [result] = await run(harness);
    expect(result.pack?.tests.map((test) => test.path)).toEqual(["tests/a.test.ts"]);
    expect(result.pack?.callRelationships.map((call) => [call.fromNodeId, call.toNodeId, call.kind])).toEqual([["symbol:src/a.ts#A", "symbol:src/b.ts#B", "calls"]]);
    expect(JSON.stringify(result.evidence)).not.toContain("defines");
  });

  it("is not driven by the answer key", async () => {
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
    const evaluationCase = makeEvaluationCase({ id: "c1", files: ["src/never-retrieved.ts", "src/also-missing.ts"], symbols: ["Nope", "Missing"] });
    const [result] = await run(harness, [evaluationCase]);
    expect(result.pack?.files.map((file) => file.path)).not.toContain("src/never-retrieved.ts");
    expect(result.pack?.symbols.map((symbol) => symbol.name)).not.toContain("Nope");
    for (const command of harness.commands) expect(command.args.join(" ")).not.toContain("never-retrieved");
  });

  it("produces deterministic evidence and command order across repeated runs", async () => {
    const first = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
    const second = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
    const a = await run(first);
    const b = await run(second);
    expect(b).toEqual(a);
    expect(second.commands).toEqual(first.commands);
    expect(a[0].evidence.treatments[1].steps.map((step) => `${step.kind}:${step.nodeId}`)).toEqual([
      "search:null",
      "lookup:symbol:src/a.ts#A",
      "slice:symbol:src/a.ts#A",
      "lookup:symbol:src/b.ts#B",
      "slice:symbol:src/b.ts#B",
      "lookup:file:tests/a.test.ts",
      "slice:file:tests/a.test.ts",
      "source:symbol:src/a.ts#A",
      "source:symbol:src/b.ts#B"
    ]);
  });
});

describe("base index", () => {
  it("asks the shared index builder for a call-graph index, once per project", async () => {
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
    const cases = [makeEvaluationCase({ id: "c1" }), makeEvaluationCase({ id: "c2" }), makeEvaluationCase({ id: "c3", project: "project-two" })];
    await run(harness, cases);
    expect(harness.indexBuilds).toHaveLength(2);
    expect(harness.indexBuilds.every((build) => build.callGraph === true)).toBe(true);
  });

  it("uses the shared buildMyDevKitIndex by default, so the real index command carries exactly one --call-graph", async () => {
    const directory = makeTempDir("cpg-index-");
    process.env.LRS_FAKE_KIT_LOG = path.join(directory, "log.jsonl");
    try {
      const kit = writeRecordingFakeKit(directory).command;
      const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
      const { buildIndex: _fake, ...withoutBuild } = harness.dependencies;
      const evaluationCase = makeEvaluationCase({ id: "c1", targetRoot: path.join(directory, "target") });
      await executeContextPackGeneration({ cases: [evaluationCase], kitCommand: kit, outputRoot: path.join(directory, "out"), dependencies: withoutBuild });
      const indexCalls = readKitLog(path.join(directory, "log.jsonl")).filter((entry) => entry.argv[0] === "index");
      expect(indexCalls).toHaveLength(1);
      expect(indexCalls[0].argv.filter((arg) => arg === "--call-graph")).toHaveLength(1);
      expect(indexCalls[0].argv).toEqual(["index", "--root", path.join(directory, "target"), "--src", "src", "--out", expect.any(String), "--call-graph", "--json"]);
      // Retrieval commands go through the injected runner and never carry the flag.
      for (const command of harness.commands) expect(command.args).not.toContain("--call-graph");
    } finally {
      delete process.env.LRS_FAKE_KIT_LOG;
      removeTempDir(directory);
    }
  });

  it("has no plugin-local index builder export", async () => {
    const exported = await import("../../../src/experiments/plugins/contextPackGeneration/index.js");
    expect(Object.keys(exported).filter((name) => /IndexBuilder/i.test(name))).toEqual([]);
  });
});
describe("case-level failure semantics", () => {
  it("fails every case of a project when its index cannot be prepared, with fixed codes", async () => {
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX, indexOk: () => false });
    const [result] = await run(harness);
    expect(result.pack).toBeNull();
    for (const treatment of result.evidence.treatments) {
      expect(treatment.status).toBe("failed");
      expect(treatment.errors).toEqual([{ code: "project-index-failed", message: "The my-dev-kit index could not be prepared." }]);
    }
    expect(harness.commands).toHaveLength(0);
  });

  it("marks an invalid ground truth without running anything for that case", async () => {
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
    const broken = makeEvaluationCase({ id: "bad" });
    broken.answerKey = undefined;
    const [bad, good] = await run(harness, [broken, makeEvaluationCase({ id: "good" })]);
    expect(bad.evidence.treatments[0].errors[0].code).toBe("ground-truth-invalid");
    expect(good.evidence.treatments[1].status).toBe("completed");
    expect(harness.events.filter((event) => event.startsWith("raw:"))).toEqual(["raw:good"]);
  });

  it("keeps the pack treatment when only the raw baseline fails, without leaking the thrown message", async () => {
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX, raw: () => "throw" });
    const [result] = await run(harness);
    expect(result.evidence.treatments[0].errors).toEqual([{ code: "raw-baseline-failed", message: "The raw full-file baseline could not be built." }]);
    expect(result.evidence.treatments[1].status).toBe("completed");
    expect(JSON.stringify(result.evidence)).not.toContain("secret");
  });

  it("reports retrieval-failed and no pack when search fails, leaving the raw treatment intact", async () => {
    const harness = makeHarness({ world: standardWorld({ failSearch: true }), symbolIndex: STANDARD_SYMBOL_INDEX });
    const [result] = await run(harness);
    expect(result.pack).toBeNull();
    expect(result.evidence.treatments[1].errors[0].code).toBe("retrieval-failed");
    expect(result.evidence.treatments[1].steps).toEqual([{ kind: "search", nodeId: null, sourceMode: null, succeeded: false, reason: "command-failed" }]);
    expect(result.evidence.treatments[0].status).toBe("completed");
  });

  it("degrades to partial when a lookup or slice step fails but continues", async () => {
    const world: FakeKitWorld = standardWorld({ lookup: () => null });
    const harness = makeHarness({ world, symbolIndex: STANDARD_SYMBOL_INDEX });
    const [result] = await run(harness);
    expect(result.evidence.treatments[1].status).toBe("partial");
    expect(result.pack?.sections.find((section) => section.id === "files")).toMatchObject({ availability: "partial", reason: "graph-step-incomplete" });
    expect(result.evidence.treatments[1].steps.filter((step) => step.kind === "lookup").every((step) => !step.succeeded)).toBe(true);
  });

  it("does not put command output, stderr or absolute paths in the durable evidence", async () => {
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX });
    const [result] = await run(harness);
    const serialized = JSON.stringify(result.evidence);
    expect(serialized).not.toContain(SOURCE_TEXT_SENTINEL);
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(serialized).not.toContain("stdout");
  });

  it("treats a missing symbol index as unavailable symbol evidence for slice-contained symbols", async () => {
    const world = standardWorld({ sourceNode: (nodeId) => ({ startLine: 1, endLine: 5, content: `${SOURCE_TEXT_SENTINEL} ${nodeId}`, boundaryKnown: true, eof: true }) });
    const harness = makeHarness({ world, symbolIndex: async () => { throw new Error("no file"); } });
    const [result] = await run(harness);
    expect(result.evidence.treatments[0]).toMatchObject({ status: "partial", availabilityReason: "symbol-index-unavailable" });
    expect(result.evidence.treatments[1]).toMatchObject({ status: "partial", availabilityReason: "symbol-index-unavailable" });
  });
});
