import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocalRepositorySubject, type LocalRepositorySubject } from "../../../src/evaluation/localRepositorySubject/index.js";
import { buildMyDevKitIndex } from "../../../src/evaluation/runMyDevKitRetrieval.js";
import { runRawFullFileBaseline } from "../../../src/evaluation/runRawFullFileBaseline.js";
import {
  collectContextPackFileIdentities,
  countContextPackFilesOutsideEligibleUniverse,
  executeLocalRepositorySubjectContextPackGeneration,
  repositoryPathOfNodeId,
  type ContextPackGenerationCaseResult,
  type ContextPackGenerationDependencies
} from "../../../src/experiments/plugins/contextPackGeneration/index.js";
import { LocalSubjectExecutionError } from "../../../src/experiments/plugins/contextWindowScaling/localSubjectErrors.js";
import { makeTempDir, removeTempDir } from "../../evaluation/localRepositorySubject/fixtureRepository.js";
import type { LocalSubjectFixture } from "../contextWindowScaling/localSubjectFixture.js";
import { clearCpgKitEnv, CPG_MARKERS, cpgKitCommand, cpgLocalSubjectCases, createCpgLocalSubjectFixture, hashTree, readKitLog } from "./externalLocalFixture.js";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let fixture: LocalSubjectFixture;
let subject: LocalRepositorySubject;
let workParent: string;
let workRoot: string;
let logPath: string;

beforeEach(async () => {
  fixture = await createCpgLocalSubjectFixture();
  subject = await loadLocalRepositorySubject({ config: { schemaVersion: "1.0.0", subjectId: "cpg-subject", cases: cpgLocalSubjectCases() }, repositoryPath: fixture.root });
  workParent = makeTempDir("cpg-seam-work-");
  workRoot = path.join(workParent, "lab");
  logPath = path.join(workParent, "kit.log");
  process.env.CPG_KIT_LOG = logPath;
});

afterEach(() => {
  clearCpgKitEnv();
  for (const directory of [...fixture.directories, workParent]) removeTempDir(directory);
});

const run = (extra: Record<string, unknown> = {}) =>
  executeLocalRepositorySubjectContextPackGeneration({ subject, kitCommand: cpgKitCommand(), workRoot, ...extra } as Parameters<typeof executeLocalRepositorySubjectContextPackGeneration>[0]);

async function errorOf(promise: Promise<unknown>): Promise<LocalSubjectExecutionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LocalSubjectExecutionError) return error;
    throw error;
  }
  throw new Error("expected a LocalSubjectExecutionError");
}

const indexCalls = () => readKitLog(logPath).filter((entry) => entry.argv[0] === "index");

describe("safe execution seam: success", () => {
  it("returns real in-memory results, leaves the target unchanged, writes nothing durable and removes the scratch", async () => {
    const hashesBefore = hashTree(fixture.root);
    const result = await run();
    expect(result.immutability).toMatchObject({ status: "unchanged", newMutationCount: 0 });
    expect(result.results.map((entry) => entry.evidence.caseId)).toEqual(["cpg-case-one", "cpg-case-two"]);
    expect(result.results.every((entry) => entry.pack !== null)).toBe(true);
    expect(JSON.stringify(result.results[0].pack)).toContain(CPG_MARKERS.engineSource);
    expect(hashTree(fixture.root)).toEqual(hashesBefore);
    // The seam performs no durable output writes itself: the work root holds nothing once the scratch is gone.
    expect(readdirSync(workRoot)).toEqual([]);
  });

  it("indexes each case with exactly its own source roots, the call graph, and the guided exclusions, all inside the scratch", async () => {
    const seen: { sourceRoots: string[]; excludePaths: readonly string[] | undefined; indexDir: string; callGraph: boolean | undefined }[] = [];
    const buildIndex: ContextPackGenerationDependencies["buildIndex"] = (options) => {
      seen.push({ sourceRoots: [...options.target.sourceRoots], excludePaths: options.excludePaths, indexDir: options.indexDir, callGraph: options.callGraph });
      return buildMyDevKitIndex(options);
    };
    await run({ dependencies: { buildIndex } });
    expect(seen.map((entry) => entry.sourceRoots)).toEqual([["src"], ["src/zeta-private"]]);
    for (const entry of seen) {
      expect(entry.callGraph).toBe(true);
      expect(entry.excludePaths).toEqual(expect.arrayContaining(["src/gen", "src/huge.ts", "src/ignored.ts"]));
      expect(path.relative(workRoot, entry.indexDir).split(path.sep)[0]).toMatch(/^s-/);
      expect(path.relative(fixture.root, entry.indexDir).startsWith("..")).toBe(true);
    }
  });

  it("restricts the raw baseline to the eligible universe and passes the exact eligible list", async () => {
    const received: { eligibleFiles?: readonly string[] }[] = [];
    const runRawBaseline: ContextPackGenerationDependencies["runRawBaseline"] = (evaluationCase, options) => {
      received.push(options ?? {});
      return runRawFullFileBaseline(evaluationCase, options);
    };
    const { results } = await run({ dependencies: { runRawBaseline } });
    expect(received).toHaveLength(2);
    for (const options of received) expect(options.eligibleFiles).toEqual(subject.eligibleFiles);
    const raw = results[0].evidence.treatments[0];
    for (const outside of ["src/ignored.ts", "src/gen/out.ts", "src/huge.ts", "src/linked.ts"]) expect(raw.includedFiles).not.toContain(outside);
    expect(raw.includedFiles).toEqual(expect.arrayContaining([CPG_MARKERS.engineFile, CPG_MARKERS.helperFile, CPG_MARKERS.testFile, "src/main.ts"]));
    for (const entry of results) for (const identity of collectContextPackFileIdentities(entry)) expect(subject.eligibleFiles).toContain(identity);
  });
});

describe("safe execution seam: gates", () => {
  it("rejects a work root inside, or equal to, the target before any index, scratch or snapshot", async () => {
    for (const bad of [fixture.root, path.join(fixture.root, "lab-out")]) {
      const error = await errorOf(run({ workRoot: bad }));
      expect(error.code).toBe("WORK_ROOT_INSIDE_TARGET");
      expect(existsSync(path.join(fixture.root, "lab-out"))).toBe(false);
    }
    expect(readKitLog(logPath)).toEqual([]);
  });

  it("fails invalid ground truth with a fixed message before any index, scratch or snapshot", async () => {
    const broken = structuredClone(subject);
    broken.evaluationCases[1].expectedFacts = undefined;
    delete broken.evaluationCases[1].answerKey;
    const error = await errorOf(run({ subject: broken }));
    expect(error.code).toBe("GROUND_TRUTH_INVALID");
    expect(error.issues[0].message).toBe("context-pack ground truth is incomplete for configured case(s).");
    expect(readKitLog(logPath)).toEqual([]);
    expect(existsSync(workRoot) ? readdirSync(workRoot) : []).toEqual([]);
  });

  it("detects mutation, never restores it, removes the scratch and keeps the issue free of identities", async () => {
    const mutated = path.join(fixture.root, CPG_MARKERS.engineFile);
    process.env.CPG_KIT_MUTATE_FILE = mutated;
    const error = await errorOf(run());
    expect(error.code).toBe("TARGET_MUTATED");
    expect(error.issues.map((issue) => issue.message)).toContain("the target changed during execution; it was not restored.");
    expect(error.message).not.toContain(CPG_MARKERS.engineFile);
    expect(error.immutability?.status).toBe("mutated");
    expect(readFileSync(mutated, "utf8")).toContain("mutated by the kit");
    expect(readdirSync(workRoot)).toEqual([]);
  });

  it("fails closed on a file identity outside the eligible universe, naming only a count, and stops later cases", async () => {
    for (const outside of ["src/ignored.ts", "src/gen/out.ts", "src/huge.ts", "not-in-the-repository/secret.ts"]) {
      expect(subject.eligibleFiles).not.toContain(outside);
      process.env.CPG_KIT_SEARCH_EXTRA = outside;
      const before = indexCalls().length;
      const error = await errorOf(run());
      expect(error.code, outside).toBe("RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE");
      expect(error.issues[0].message).toBe("context-pack generation exposed 1 file identity outside the eligible subject universe.");
      expect(error.message).not.toContain(path.basename(outside));
      // Case one failed, so case two was never indexed.
      expect(indexCalls().length - before).toBe(1);
      expect(readdirSync(workRoot)).toEqual([]);
    }
  });

  it("fails an index failure with fixed text, stops later cases and removes the scratch", async () => {
    process.env.CPG_KIT_INDEX_FAIL = "1";
    const error = await errorOf(run());
    expect(error.code).toBe("EXECUTION_FAILED");
    expect(error.issues[0].message).toBe("context-pack index preparation failed for a configured case.");
    expect(error.message).not.toContain(CPG_MARKERS.stderr);
    expect(indexCalls()).toHaveLength(1);
    expect(readdirSync(workRoot)).toEqual([]);
  });

  it("turns an unexpected throw into fixed text without its message", async () => {
    const buildIndex: ContextPackGenerationDependencies["buildIndex"] = () => {
      throw new Error(`exploded at ${fixture.root} ${CPG_MARKERS.engineSource}`);
    };
    const error = await errorOf(run({ dependencies: { buildIndex } }));
    expect(error.code).toBe("EXECUTION_FAILED");
    expect(error.message).not.toContain(fixture.root);
    expect(error.message).not.toContain(CPG_MARKERS.engineSource);
    expect(readdirSync(workRoot)).toEqual([]);
  });

  it("treats scratch cleanup failure as a safety gate without leaking the scratch path", async () => {
    const error = await errorOf(run({ scratchIo: { removeDirectory: async () => { throw new Error(`cannot remove ${workRoot}`); } } }));
    expect(error.code).toBe("SCRATCH_CLEANUP_FAILED");
    expect(error.issues[0].message).toBe("the private scratch could not be removed.");
    expect(error.message).not.toContain(workRoot);
  });

  it("keeps the primary issue first when a secondary gate also fails", async () => {
    process.env.CPG_KIT_INDEX_FAIL = "1";
    const error = await errorOf(run({ scratchIo: { removeDirectory: async () => { throw new Error("nope"); } } }));
    expect(error.issues.map((issue) => issue.code)).toEqual(["EXECUTION_FAILED", "SCRATCH_CLEANUP_FAILED"]);
    expect(error.code).toBe("EXECUTION_FAILED");
  });
});

describe("eligible-universe counting", () => {
  const base = async (): Promise<ContextPackGenerationCaseResult> => (await run()).results[0];

  it("counts distinct outside identities from every treatment and every pack section", async () => {
    const result = await base();
    const eligible = new Set(subject.eligibleFiles);
    expect(countContextPackFilesOutsideEligibleUniverse(result, eligible)).toBe(0);

    const variants: Array<[string, (value: ContextPackGenerationCaseResult) => void]> = [
      ["raw included file", (value) => value.evidence.treatments[0].includedFiles.push("private/a.ts")],
      ["raw identity file", (value) => (value.evidence.treatments[0].identityEvidence?.files as string[]).push("private/a.ts")],
      ["raw identity symbol file", (value) => (value.evidence.treatments[0].identityEvidence?.symbols as { name: string; file?: string }[]).push({ name: "S", file: "private/a.ts" })],
      ["pack included file", (value) => value.evidence.treatments[1].includedFiles.push("private/a.ts")],
      ["pack file", (value) => value.pack?.files.push({ path: "private/a.ts", rank: 1, reason: "search-candidate", provenance: [] })],
      ["pack symbol file", (value) => value.pack?.symbols.push({ name: "S", nodeId: null, file: "private/a.ts", rank: 1, line: null, provenance: [] })],
      ["pack source slice", (value) => { if (value.pack) value.pack.sourceSlices[0].file = "private/a.ts"; }],
      ["pack test", (value) => value.pack?.tests.push({ path: "private/a.ts", rank: null, how: "search-candidate", provenance: [] })],
      ["call endpoint (file node)", (value) => value.pack?.callRelationships.push({ fromNodeId: "file:private/a.ts", toNodeId: "symbol:src/main.ts#x", kind: "calls", provenance: [] })],
      ["call endpoint (symbol node)", (value) => value.pack?.callRelationships.push({ fromNodeId: "symbol:src/main.ts#x", toNodeId: "symbol:private/a.ts#y", kind: "calls", provenance: [] })]
    ];
    for (const [label, mutate] of variants) {
      const copy = structuredClone(result);
      mutate(copy);
      expect(countContextPackFilesOutsideEligibleUniverse(copy, eligible), label).toBe(1);
    }
    const twice = structuredClone(result);
    twice.pack?.files.push({ path: "private/a.ts", rank: 1, reason: "search-candidate", provenance: [] });
    twice.pack?.tests.push({ path: "private/a.ts", rank: null, how: "search-candidate", provenance: [] });
    twice.pack?.tests.push({ path: "private/b.ts", rank: null, how: "search-candidate", provenance: [] });
    expect(countContextPackFilesOutsideEligibleUniverse(twice, eligible)).toBe(2);
  });

  it("derives a repository path only from file: and symbol: node IDs", () => {
    expect(repositoryPathOfNodeId("file:src/a.ts")).toBe("src/a.ts");
    expect(repositoryPathOfNodeId("symbol:src/a.ts#name")).toBe("src/a.ts");
    expect(repositoryPathOfNodeId("module:src/a.ts")).toBeNull();
    expect(repositoryPathOfNodeId("opaque")).toBeNull();
  });
});

describe("no durable writes by the seam", () => {
  it("leaves a pre-existing work root untouched except for removing its own scratch", async () => {
    mkdirSync(workRoot, { recursive: true });
    await run();
    expect(readdirSync(workRoot)).toEqual([]);
  });
});
