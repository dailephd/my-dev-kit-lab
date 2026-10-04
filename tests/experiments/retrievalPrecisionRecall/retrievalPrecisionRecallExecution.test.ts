import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../../../src/evaluation/index.js";
import type { EvaluationCase } from "../../../src/evaluation/types.js";
import {
  boundedRetrievalSafeMessage,
  executeRetrievalPrecisionRecall,
  type RetrievalPrecisionRecallDependencies
} from "../../../src/experiments/plugins/retrievalPrecisionRecall/index.js";
import { evidenceOf, indexResultOf, makeEvaluationCase, retrievalResultOf, SOURCE_SENTINEL } from "./retrievalPrecisionRecallTestHelpers.js";

type Calls = { builds: Array<{ indexDir: string; root: string }>; retrievals: Array<{ caseId: string; indexDir: string }> };

function fakeDependencies(options: {
  evidenceFor?: (evaluationCase: EvaluationCase) => ReturnType<typeof evidenceOf> | undefined;
  failIndexFor?: (root: string) => "not-ok" | "throw" | undefined;
  throwRetrievalFor?: (caseId: string) => boolean;
} = {}): { dependencies: RetrievalPrecisionRecallDependencies; calls: Calls } {
  const calls: Calls = { builds: [], retrievals: [] };
  const dependencies: RetrievalPrecisionRecallDependencies = {
    async buildIndex(args) {
      calls.builds.push({ indexDir: args.indexDir, root: args.target.absoluteTargetRoot });
      const failure = options.failIndexFor?.(args.target.absoluteTargetRoot);
      if (failure === "throw") throw new Error(`index exploded at ${args.target.absoluteTargetRoot}`);
      return indexResultOf(args.indexDir, failure !== "not-ok");
    },
    async retrieveFromIndex(args) {
      calls.retrievals.push({ caseId: args.evaluationCase.id, indexDir: args.indexDir });
      if (options.throwRetrievalFor?.(args.evaluationCase.id)) throw new Error(`retrieval exploded in ${args.indexDir}`);
      const evidence = options.evidenceFor ? options.evidenceFor(args.evaluationCase) : evidenceOf(args.evaluationCase.expectedFiles, args.evaluationCase.expectedSymbols.map((name) => ({ name, file: args.evaluationCase.expectedFiles[0] })));
      return retrievalResultOf(args.evaluationCase, evidence);
    }
  };
  return { dependencies, calls };
}

const outputRoot = path.resolve("lab-output", "retrieval-precision-recall-unit-never-written");
const twoProjects = () => [
  makeEvaluationCase({ id: "a1", project: "project-a" }),
  makeEvaluationCase({ id: "a2", project: "project-a" }),
  makeEvaluationCase({ id: "b1", project: "project-b" }),
  makeEvaluationCase({ id: "b2", project: "project-b" })
];

describe("executeRetrievalPrecisionRecall", () => {
  it("TST-B3-001 builds exactly one index per benchmark project", async () => {
    const { dependencies, calls } = fakeDependencies();
    await executeRetrievalPrecisionRecall({ cases: twoProjects(), kitCommand: "kit", outputRoot, dependencies });
    expect(calls.builds).toHaveLength(2);
    expect(calls.builds.map((build) => path.basename(build.indexDir))).toEqual(["project-a", "project-b"]);
  });

  it("TST-B3-002 runs retrieval once per case against its own project index", async () => {
    const { dependencies, calls } = fakeDependencies();
    await executeRetrievalPrecisionRecall({ cases: twoProjects(), kitCommand: "kit", outputRoot, dependencies });
    expect(calls.retrievals.map((call) => call.caseId)).toEqual(["a1", "a2", "b1", "b2"]);
    for (const call of calls.retrievals) {
      expect(path.basename(call.indexDir)).toBe(call.caseId.startsWith("a") ? "project-a" : "project-b");
    }
  });

  it("TST-B3-003 invokes no agent owner: the plugin sources import none", async () => {
    const dir = path.resolve("src/experiments/plugins/retrievalPrecisionRecall");
    for (const file of await readdir(dir)) {
      const text = await readFile(path.join(dir, file), "utf8");
      expect(text, file).not.toMatch(/from\s+["'][^"']*\/agents\//);
      expect(text, file).not.toMatch(/runRawFullFileBaseline|fakeAgent|evaluateWarmIndex/);
    }
  });

  it("TST-B3-004 treats a trustworthy empty retrieval as a completed measurement", async () => {
    const { dependencies } = fakeDependencies({ evidenceFor: () => evidenceOf([]) });
    const [entry] = await executeRetrievalPrecisionRecall({ cases: [makeEvaluationCase({ id: "empty" })], kitCommand: "kit", outputRoot, dependencies });
    expect(entry.status).toBe("completed");
    expect(entry.errors).toEqual([]);
    expect(entry.quality?.file.recall).toMatchObject({ availability: "available", value: 0 });
    expect(entry.quality?.symbol.recall).toMatchObject({ availability: "available", value: 0 });
    expect(entry.quality?.file.precision).toMatchObject({ availability: "not-applicable", reason: "no-retrieved-files" });
    expect(entry.quality?.irrelevantContextRatio).toMatchObject({ availability: "not-applicable", reason: "no-retrieved-files" });
    expect(entry.quality?.fact.coverage).toMatchObject({ availability: "available", value: 0 });
  });

  it("TST-B3-005 marks partial or unavailable retrieval evidence partial with unavailable ratios and preserved reasons", async () => {
    for (const availability of ["partial", "unavailable"] as const) {
      const { dependencies } = fakeDependencies({ evidenceFor: () => evidenceOf(["src/a.ts"], [], availability) });
      const [entry] = await executeRetrievalPrecisionRecall({ cases: [makeEvaluationCase({ id: availability })], kitCommand: "kit", outputRoot, dependencies });
      expect(entry.status).toBe("partial");
      expect(entry.retrieval).toMatchObject({ evidenceAvailability: availability, evidenceAvailabilityReason: "some-executed-commands-were-not-fully-interpreted" });
      expect(entry.quality?.file.precision).toMatchObject({ availability: "unavailable", reason: `retrieval-evidence-${availability}` });
      expect(entry.quality?.fact.coverage.availability).toBe("unavailable");
      expect(entry.quality?.retrievedTokenCount).toBe(100);
    }
  });

  it("treats missing retrieval evidence as partial, never as an empty success", async () => {
    const { dependencies } = fakeDependencies({ evidenceFor: () => undefined });
    const [entry] = await executeRetrievalPrecisionRecall({ cases: [makeEvaluationCase({ id: "missing" })], kitCommand: "kit", outputRoot, dependencies });
    expect(entry.status).toBe("partial");
    expect(entry.retrieval).toMatchObject({ evidenceAvailability: "missing", evidenceAvailabilityReason: "retrieval-evidence-missing" });
    expect(entry.quality?.file.recall.availability).toBe("unavailable");
  });

  it("TST-B3-006 isolates a failed project index to that project's cases", async () => {
    for (const mode of ["not-ok", "throw"] as const) {
      const cases = twoProjects();
      const failingRoot = cases[0].absoluteTargetRoot;
      const { dependencies, calls } = fakeDependencies({ failIndexFor: (root) => (root === failingRoot ? mode : undefined) });
      const result = await executeRetrievalPrecisionRecall({ cases, kitCommand: "kit", outputRoot, dependencies });
      expect(result.map((entry) => [entry.caseId, entry.status])).toEqual([["a1", "failed"], ["a2", "failed"], ["b1", "completed"], ["b2", "completed"]]);
      expect(result[0]).toMatchObject({ retrieval: null, quality: null, errors: [{ code: "project-index-failed" }] });
      expect(calls.retrievals.map((call) => call.caseId)).toEqual(["b1", "b2"]);
      // Machine-local paths from a thrown error never reach persisted evidence.
      expect(JSON.stringify(result)).not.toContain(failingRoot);
    }
  });

  it("TST-B3-007 rejects conflicting target or source roots inside one project instead of merging them", async () => {
    const cases = [
      makeEvaluationCase({ id: "c1", project: "project-a" }),
      makeEvaluationCase({ id: "c2", project: "project-a", sourceRoots: ["lib"] }),
      makeEvaluationCase({ id: "c3", project: "project-a", targetRoot: path.resolve("elsewhere") }),
      makeEvaluationCase({ id: "d1", project: "project-b" })
    ];
    const { dependencies, calls } = fakeDependencies();
    const result = await executeRetrievalPrecisionRecall({ cases, kitCommand: "kit", outputRoot, dependencies });
    expect(result.map((entry) => entry.status)).toEqual(["failed", "failed", "failed", "completed"]);
    expect(result[0].errors).toEqual([{ code: "project-group-inconsistent", message: "Cases of one benchmark project disagree on target root or source roots." }]);
    expect(calls.builds).toHaveLength(1);
    expect(calls.retrievals.map((call) => call.caseId)).toEqual(["d1"]);
  });

  it("fails a case with invalid ground truth without retrieving it, and a thrown retrieval without erasing other cases", async () => {
    const broken = makeEvaluationCase({ id: "broken", withFactMapping: false });
    const { dependencies, calls } = fakeDependencies({ throwRetrievalFor: (caseId) => caseId === "boom" });
    const result = await executeRetrievalPrecisionRecall({
      cases: [makeEvaluationCase({ id: "ok" }), broken, makeEvaluationCase({ id: "boom" })],
      kitCommand: "kit",
      outputRoot,
      dependencies
    });
    expect(result.map((entry) => [entry.caseId, entry.status, entry.errors[0]?.code])).toEqual([
      ["ok", "completed", undefined],
      ["broken", "failed", "ground-truth-invalid"],
      ["boom", "failed", "retrieval-failed"]
    ]);
    expect(calls.retrievals.map((call) => call.caseId)).toEqual(["ok", "boom"]);
    expect(JSON.stringify(result)).not.toContain(outputRoot);
  });

  it("TST-B3-025 returns every selected bundled case exactly once, in corpus order, with two index builds", async () => {
    const profiles = await readBenchmarkProjectProfiles(path.resolve("benchmarks/contracts/benchmark-project-profiles.json"), process.cwd());
    const corpus = await readEvaluationCases(path.resolve("benchmarks/contracts/warm-index-benchmark-cases.json"), process.cwd(), {
      projectProfiles: profiles,
      requireProjectProfileRef: true
    });
    const { dependencies, calls } = fakeDependencies();
    const result = await executeRetrievalPrecisionRecall({ cases: corpus, kitCommand: "kit", outputRoot, dependencies });
    expect(result.map((entry) => entry.caseId)).toEqual(corpus.map((entry) => entry.id));
    expect(new Set(result.map((entry) => entry.caseId)).size).toBe(12);
    expect(calls.builds).toHaveLength(2);
    expect(calls.retrievals).toHaveLength(12);
    expect(result.every((entry) => entry.status === "completed")).toBe(true);
    // Retrieval results carry contextText in memory; the returned evidence must not.
    expect(JSON.stringify(result)).not.toContain(SOURCE_SENTINEL);
  });

  it("keeps selection order stable even when projects interleave", async () => {
    const cases = [
      makeEvaluationCase({ id: "a1", project: "project-a" }),
      makeEvaluationCase({ id: "b1", project: "project-b" }),
      makeEvaluationCase({ id: "a2", project: "project-a" })
    ];
    const { dependencies } = fakeDependencies();
    const result = await executeRetrievalPrecisionRecall({ cases, kitCommand: "kit", outputRoot, dependencies });
    expect(result.map((entry) => entry.caseId)).toEqual(["a1", "b1", "a2"]);
  });
});

describe("boundedRetrievalSafeMessage", () => {
  it("redacts known roots and absolute paths and bounds length", () => {
    const message = boundedRetrievalSafeMessage("failed at C:\\Users\\x\\secret\\a.ts and /Users/x/secret/b.ts and /work/root/c.ts", ["/work/root"]);
    expect(message).not.toMatch(/secret|\/work\/root|C:\\/);
    expect(boundedRetrievalSafeMessage("x".repeat(1000)).length).toBeLessThanOrEqual(303);
    expect(boundedRetrievalSafeMessage("line1\nline2\u0000")).toBe("line1 line2 ");
  });
});
