import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLocalRepositorySubject, serializeLocalRepositorySubjectManifest } from "../../../src/evaluation/localRepositorySubject/index.js";
import type { LocalRepositorySubject } from "../../../src/evaluation/localRepositorySubject/index.js";
import { runExperiment, type RetrievalPrecisionRecallDependencies } from "../../../src/experiments/index.js";
import { LocalSubjectExecutionError } from "../../../src/experiments/plugins/contextWindowScaling/localSubjectErrors.js";
import { executeLocalRepositorySubjectRetrievalPrecisionRecall } from "../../../src/experiments/plugins/retrievalPrecisionRecall/index.js";
import { removeTempDir } from "../../evaluation/localRepositorySubject/fixtureRepository.js";
import { git, listTree, makeTempDir } from "../contextWindowScaling/localSubjectFixture.js";
import type { LocalSubjectFixture } from "../contextWindowScaling/localSubjectFixture.js";
import { createRprLocalSubjectFixture, RPR_MARKERS, rprLocalSubjectCases } from "./localSubjectFixture.js";
import { evidenceOf, indexResultOf, retrievalResultOf, STDERR_SENTINEL } from "./retrievalPrecisionRecallTestHelpers.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

type BuildCall = { sourceRoots: string[]; absoluteTargetRoot: string; excludePaths: readonly string[] | undefined; indexDir: string; commandsDir: string };

let fixture: LocalSubjectFixture;
const extraDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of [...(fixture?.directories ?? []), ...extraDirs.splice(0)]) removeTempDir(directory);
});

async function setup(cases?: Record<string, unknown>[]): Promise<LocalRepositorySubject> {
  fixture = await createRprLocalSubjectFixture({ cases });
  return fixture.subject;
}

function fakeDependencies(options: {
  evidenceFor?: (caseId: string) => ReturnType<typeof evidenceOf> | undefined;
  buildOk?: (caseId: string) => boolean;
  onRetrieve?: (caseId: string) => void | Promise<void>;
  selectedFile?: string;
  warnings?: string[];
} = {}): { dependencies: RetrievalPrecisionRecallDependencies; builds: BuildCall[]; retrievals: string[] } {
  const builds: BuildCall[] = [];
  const retrievals: string[] = [];
  const dependencies: RetrievalPrecisionRecallDependencies = {
    async buildIndex(args) {
      builds.push({
        sourceRoots: [...args.target.sourceRoots],
        absoluteTargetRoot: args.target.absoluteTargetRoot,
        excludePaths: args.excludePaths,
        indexDir: args.indexDir,
        commandsDir: args.commandsDir
      });
      mkdirSync(args.indexDir, { recursive: true });
      writeFileSync(path.join(args.indexDir, "manifest.json"), "{}");
      const caseId = [...builds].length === 1 ? "first" : "later";
      return indexResultOf(args.indexDir, options.buildOk ? options.buildOk(caseId) : true);
    },
    async retrieveFromIndex(args) {
      retrievals.push(args.evaluationCase.id);
      mkdirSync(args.commandsDir, { recursive: true });
      writeFileSync(path.join(args.commandsDir, "stdout.txt"), "raw command output");
      await options.onRetrieve?.(args.evaluationCase.id);
      const evidence = options.evidenceFor
        ? options.evidenceFor(args.evaluationCase.id)
        : evidenceOf(args.evaluationCase.expectedFiles, args.evaluationCase.expectedSymbols.map((name) => ({ name, file: args.evaluationCase.expectedFiles[0] })));
      return retrievalResultOf(args.evaluationCase, evidence, { selectedFile: options.selectedFile ?? "src/main.ts", warnings: options.warnings });
    }
  };
  return { dependencies, builds, retrievals };
}

const errorOf = async (promise: Promise<unknown>): Promise<LocalSubjectExecutionError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LocalSubjectExecutionError);
    return error as LocalSubjectExecutionError;
  }
  throw new Error("expected the external-local execution to fail");
};

const run = (subject: LocalRepositorySubject, deps = fakeDependencies(), extra: Record<string, unknown> = {}) =>
  executeLocalRepositorySubjectRetrievalPrecisionRecall({ subject, kitCommand: "kit", workRoot: fixture.workRoot, dependencies: deps.dependencies, ...extra });

describe("external-local index model", () => {
  it("TST-B4-010 builds each case's private index with exactly that case's source roots, rooted at the repository", async () => {
    const subject = await setup();
    const deps = fakeDependencies();
    await run(subject, deps);
    expect(deps.builds[0].sourceRoots).toEqual(["src"]);
    expect(deps.builds[0].absoluteTargetRoot).toBe(subject.repositoryRoot);
    // The manifest union of source roots is never substituted for a case's own roots.
    expect(subject.manifest.sourceRoots).toEqual(expect.arrayContaining(["src", "src/util"]));
    expect(deps.builds[1].sourceRoots).toEqual(["src/util"]);
  });

  it("TST-B4-011 builds one index per configured case and does not treat different source roots as one inconsistent project", async () => {
    const subject = await setup();
    expect(new Set(subject.evaluationCases.map((entry) => entry.benchmarkProject)).size).toBe(1);
    const deps = fakeDependencies();
    const result = await run(subject, deps);
    expect(deps.builds).toHaveLength(2);
    expect(new Set(deps.builds.map((build) => build.indexDir)).size).toBe(2);
    expect(deps.retrievals).toEqual(["rpr-case-one", "rpr-case-two"]);
    expect(result.caseEvidence.map((entry) => [entry.caseId, entry.status])).toEqual([["rpr-case-one", "completed"], ["rpr-case-two", "completed"]]);
  });

  it("TST-B4-012 invokes no agent owner", () => {
    for (const file of ["localSubjectExecution.ts", "localSubjectPrivacy.ts"]) {
      const text = readFileSync(path.resolve("src/experiments/plugins/retrievalPrecisionRecall", file), "utf8");
      expect(text, file).not.toMatch(/from\s+["'][^"']*\/agents\//);
      expect(text, file).not.toMatch(/runRawFullFileBaseline|fakeAgent|evaluateWarmIndex/);
    }
  });

  it("TST-B4-013 keeps a trustworthy empty retrieval as completed scientific evidence", async () => {
    const subject = await setup();
    const result = await run(subject, fakeDependencies({ evidenceFor: () => evidenceOf([]) }));
    expect(result.caseEvidence.map((entry) => entry.status)).toEqual(["completed", "completed"]);
    expect(result.caseEvidence[0].quality?.file.recall).toMatchObject({ availability: "available", value: 0 });
    expect(result.caseEvidence[0].quality?.file.precision).toMatchObject({ availability: "not-applicable", reason: "no-retrieved-files" });
  });

  it("TST-B4-014 keeps partial retrieval partial, not fatal, when no safety violation exists", async () => {
    const subject = await setup();
    const result = await run(subject, fakeDependencies({ evidenceFor: () => evidenceOf(["src/main.ts"], [], "partial") }));
    expect(result.caseEvidence.map((entry) => entry.status)).toEqual(["partial", "partial"]);
    expect(result.caseEvidence[0].quality?.file.precision).toMatchObject({ availability: "unavailable", reason: "retrieval-evidence-partial" });
    // The fixture's untracked symlink is a pre-existing status entry; only a NEW mutation would fail the run.
    expect(result.immutability).toMatchObject({ status: "unchanged", newMutationCount: 0 });
  });
});

describe("external-local safety", () => {
  it("TST-B4-015 passes exact ignored and oversized exclusions to every case index", async () => {
    const subject = await setup();
    const deps = fakeDependencies();
    await run(subject, deps);
    expect(subject.runtimeSafetyExclusions.gitIgnoredFiles.length).toBeGreaterThan(0);
    expect(subject.runtimeSafetyExclusions.oversizedFiles).toContain("src/huge.ts");
    for (const build of deps.builds) {
      expect(build.excludePaths).toEqual(expect.arrayContaining(["src/gen", "src/huge.ts", "src/ignored.ts"]));
      // Never a bare name, which my-dev-kit treats as "every directory with this name".
      for (const entry of build.excludePaths ?? []) expect(entry).toContain("/");
    }
    expect(deps.builds[0].excludePaths).toEqual(deps.builds[1].excludePaths);
  });

  it("TST-B4-016 fails closed on a retrieved file outside the eligible universe without naming it", async () => {
    const subject = await setup();
    for (const outside of ["src/ignored.ts", "src/gen/out.ts", "src/huge.ts", "src/linked.ts", "not-in-the-repository/secret.ts"]) {
      expect(subject.eligibleFiles).not.toContain(outside);
      const deps = fakeDependencies({ evidenceFor: () => evidenceOf(["src/main.ts", outside]) });
      const error = await errorOf(run(subject, deps));
      expect(error.code, outside).toBe("RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE");
      expect(error.message).toContain("case rpr-case-one: retrieval exposed 1 file identity outside the eligible subject universe.");
      expect(error.message).not.toContain(path.basename(outside));
      expect(JSON.stringify(error.issues)).not.toContain(outside);
      // Stops at the unsafe case: the second case is never executed.
      expect(deps.retrievals).toEqual(["rpr-case-one"]);
      expect(readdirSync(fixture.workRoot)).toEqual([]);
    }
  });

  it("TST-B4-017 also fails closed when only a retrieved symbol's file, the selected file or the files read are outside", async () => {
    const subject = await setup();
    const symbolOutside = await errorOf(
      run(subject, fakeDependencies({ evidenceFor: () => evidenceOf(["src/main.ts"], [{ name: RPR_MARKERS.symbol, file: "src/ignored.ts" }]) }))
    );
    expect(symbolOutside.code).toBe("RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE");
    expect(symbolOutside.message).not.toContain("ignored");
    const selectedOutside = await errorOf(run(subject, fakeDependencies({ selectedFile: "src/gen/out.ts" })));
    expect(selectedOutside.code).toBe("RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE");
    const absoluteOutside = await errorOf(run(subject, fakeDependencies({ selectedFile: path.join(fixture.outside, "secret.ts") })));
    expect(absoluteOutside.code).toBe("RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE");
    expect(absoluteOutside.message).not.toContain("secret");
    // An absolute path that is inside the repository and eligible is accepted.
    await expect(run(subject, fakeDependencies({ selectedFile: path.join(subject.repositoryRoot, "src", "main.ts") }))).resolves.toBeDefined();
  });

  it("TST-B4-018 rejects a work root inside, or equal to, the target before any index or scratch exists", async () => {
    const subject = await setup();
    for (const workRoot of [path.join(subject.repositoryRoot, "lab-out"), subject.repositoryRoot]) {
      const deps = fakeDependencies();
      const error = await errorOf(run(subject, deps, { workRoot }));
      expect(error.code).toBe("WORK_ROOT_INSIDE_TARGET");
      expect(deps.builds).toEqual([]);
      expect(existsSync(path.join(subject.repositoryRoot, "lab-out"))).toBe(false);
    }
  });

  it("TST-B4-019 leaves the target unchanged on success and creates nothing inside it", async () => {
    const subject = await setup();
    const treeBefore = listTree(fixture.root);
    const statusBefore = git(fixture.root, "status", "--porcelain=v1", "--ignored");
    const result = await run(subject);
    expect(result.immutability.status).toBe("unchanged");
    expect(listTree(fixture.root)).toEqual(treeBefore);
    expect(git(fixture.root, "status", "--porcelain=v1", "--ignored")).toBe(statusBefore);
    for (const forbidden of [".my-dev-kit", ".my-dev-kit-lab", "lab-output", "indexes", "commands"]) expect(existsSync(path.join(fixture.root, forbidden))).toBe(false);
  });

  it("TST-B4-020 allows a pre-existing dirty working tree and does not clean it", async () => {
    await setup();
    writeFileSync(path.join(fixture.root, "src", "util", "helper.ts"), "export const helper = 2; // uncommitted user edit\n");
    const config = { schemaVersion: "1.0.0", subjectId: "fixture-subject", cases: rprLocalSubjectCases() };
    const dirtySubject = await loadLocalRepositorySubject({ config, repositoryPath: fixture.root, maxFileBytes: 400 });
    expect(dirtySubject.manifest.repository.workingTreeDirty).toBe(true);
    const result = await run(dirtySubject);
    expect(result.immutability.newMutationCount).toBe(0);
    expect(result.immutability.preExistingGitStatusEntryCount).toBeGreaterThan(0);
    expect(readFileSync(path.join(fixture.root, "src", "util", "helper.ts"), "utf8")).toContain("uncommitted user edit");
    expect(git(fixture.root, "status", "--porcelain=v1")).toContain("helper.ts");
  });

  it("TST-B4-021 detects a new mutation, fails the run, does not revert it, and describes only kinds", async () => {
    const subject = await setup();
    const mainPath = path.join(fixture.root, "src", "main.ts");
    const before = readFileSync(mainPath, "utf8");
    const deps = fakeDependencies({ onRetrieve: () => appendFileSync(mainPath, "\n// mutated during the run\n") });
    const error = await errorOf(run(subject, deps));
    expect(error.code).toBe("TARGET_MUTATED");
    // Never reverted: the hook ran once per case, and every byte it wrote is still there.
    const after = readFileSync(mainPath, "utf8");
    expect(after.startsWith(before)).toBe(true);
    expect(after).toContain("// mutated during the run");
    expect(error.immutability?.status).toBe("mutated");
    expect(error.message).not.toContain("main.ts");
    expect(readdirSync(fixture.workRoot)).toEqual([]);
  });

  it("TST-B4-022 fails the run when the private scratch cannot be removed", async () => {
    const subject = await setup();
    const error = await errorOf(
      run(subject, fakeDependencies(), { scratchIo: { removeDirectory: async () => { throw new Error(`cannot remove ${fixture.workRoot}`); } } })
    );
    expect(error.code).toBe("SCRATCH_CLEANUP_FAILED");
    expect(error.message).not.toContain(fixture.workRoot);
  });

  it("keeps every index, command file and stdout beneath the private scratch and removes it all on success", async () => {
    const subject = await setup();
    const deps = fakeDependencies();
    await run(subject, deps);
    const workRoot = path.resolve(fixture.workRoot);
    for (const build of deps.builds) {
      for (const candidate of [build.indexDir, build.commandsDir]) {
        const relative = path.relative(workRoot, candidate);
        expect(relative.startsWith("..")).toBe(false);
        expect(relative.split(path.sep)[0]).toMatch(/^s-/);
        // Short fixed segments only: no private repository or case names become directory names.
        expect(relative).not.toMatch(/fixture|rpr-case|lrs-b2|src/);
      }
    }
    expect(readdirSync(workRoot)).toEqual([]);
  });

  it("fails on invalid external ground truth before any index, scratch or snapshot", async () => {
    const broken = rprLocalSubjectCases();
    delete (broken[0].answerKey as { expectedContextTargets?: unknown }).expectedContextTargets;
    const subject = await setup(broken);
    const deps = fakeDependencies();
    const error = await errorOf(run(subject, deps));
    expect(error.code).toBe("GROUND_TRUTH_INVALID");
    expect(error.message).toContain("rpr-case-one");
    expect(error.message).not.toContain(RPR_MARKERS.fact);
    expect(deps.builds).toEqual([]);
    expect(existsSync(fixture.workRoot)).toBe(false);
  });

  it("fails on an index failure or a thrown retrieval without exposing caught error text, and still cleans up", async () => {
    const subject = await setup();
    const indexFailure = await errorOf(run(subject, fakeDependencies({ buildOk: () => false })));
    expect(indexFailure.code).toBe("EXECUTION_FAILED");
    expect(indexFailure.message).toContain("case rpr-case-one: the my-dev-kit index could not be prepared.");
    expect(readdirSync(fixture.workRoot)).toEqual([]);

    const thrown = await errorOf(
      run(subject, fakeDependencies({ onRetrieve: () => { throw new Error(`boom ${STDERR_SENTINEL} ${fixture.root}`); } }))
    );
    expect(thrown.code).toBe("EXECUTION_FAILED");
    expect(thrown.message).toContain("execution threw before completing (details withheld)");
    expect(thrown.message).not.toContain(STDERR_SENTINEL);
    expect(thrown.message).not.toContain(fixture.root);
    expect(readdirSync(fixture.workRoot)).toEqual([]);
  });
});

describe("retrieval-precision-recall plugin external-local boundary", () => {
  async function runPlugin(options: { targetPath?: string; inputs?: Record<string, unknown>; config?: unknown; outputRoot?: string }) {
    const outputRoot = options.outputRoot ?? path.join(makeTempDir("rpr-plugin-out-"), "run");
    extraDirs.push(path.dirname(outputRoot));
    const result = await runExperiment({
      pluginId: "retrieval-precision-recall",
      outputRoot,
      toolRoot: process.cwd(),
      targetPath: options.targetPath,
      config: options.config,
      inputs: options.inputs
    });
    return { result, outputRoot };
  }

  it("TST-B4-007 fails closed for an external target without a local subject and never falls back to bundled cases", async () => {
    const subject = await setup();
    const deps = fakeDependencies();
    const { result, outputRoot } = await runPlugin({ targetPath: fixture.root, inputs: { cases: subject.evaluationCases, retrievalDependencies: deps.dependencies } });
    expect(result.status).toBe("failed");
    expect(result.failures[0].message).toBe("External-local retrieval-precision-recall targets require a loaded local repository subject (--local-subject-config).");
    expect(deps.builds).toEqual([]);
    expect(existsSync(outputRoot)).toBe(false);
  });

  it("TST-B4-008 fails closed for a self target that carries a local subject", async () => {
    const subject = await setup();
    const deps = fakeDependencies();
    const { result } = await runPlugin({ inputs: { cases: subject.evaluationCases, localSubject: subject, retrievalDependencies: deps.dependencies } });
    expect(result.status).toBe("failed");
    expect(result.failures[0].message).toBe("Local-repository subject mode requires an external-local target.");
    expect(deps.builds).toEqual([]);
  });

  it("TST-B4-009 fails closed when the selected target is not the repository the subject was loaded from", async () => {
    const subject = await setup();
    const other = makeTempDir("rpr-other-target-");
    extraDirs.push(other);
    const deps = fakeDependencies();
    const { result } = await runPlugin({ targetPath: other, inputs: { cases: subject.evaluationCases, localSubject: subject, retrievalDependencies: deps.dependencies } });
    expect(result.status).toBe("failed");
    expect(result.failures[0].message).toBe("The selected --target is not the repository the local subject was loaded from.");
    expect(deps.builds).toEqual([]);
  });

  it("rejects bundled case and project filters in external mode even when invoked programmatically", async () => {
    const subject = await setup();
    for (const config of [{ caseIds: ["rpr-case-one"] }, { benchmarkProjects: ["fixture-subject"] }]) {
      const deps = fakeDependencies();
      const { result } = await runPlugin({ targetPath: fixture.root, config, inputs: { cases: subject.evaluationCases, localSubject: subject, retrievalDependencies: deps.dependencies } });
      expect(result.status, JSON.stringify(config)).toBe("failed");
      expect(result.failures[0].message).toContain("not supported for an external local repository subject");
      expect(deps.builds).toEqual([]);
    }
  });

  it("on success writes only the artifact and manifest, projects the target, and never serializes the physical roots", async () => {
    const subject = await setup();
    const deps = fakeDependencies({ warnings: [`upstream warning ${RPR_MARKERS.warning}`] });
    const { result, outputRoot } = await runPlugin({ targetPath: fixture.root, inputs: { cases: subject.evaluationCases, localSubject: subject, retrievalDependencies: deps.dependencies } });
    expect(result.status).toBe("completed");
    expect(readdirSync(outputRoot).sort()).toEqual(["local-repository-subject-manifest.json", "retrieval-precision-recall-execution.json"]);
    expect(readFileSync(path.join(outputRoot, "local-repository-subject-manifest.json"), "utf8")).toBe(serializeLocalRepositorySubjectManifest(subject.manifest));
    expect(result.target).toMatchObject({
      kind: "external-local",
      targetRoot: "local-repository:fixture-subject",
      toolRoot: "[redacted]",
      packageName: null,
      packageVersion: null,
      hasGit: true,
      isSelf: false,
      privacyProjection: "external-local-redacted",
      commit: subject.manifest.repository.commit,
      branch: "main"
    });
    expect(result.artifacts.map((artifact) => artifact.id)).toEqual(["retrieval-precision-recall-execution", "local-repository-subject-manifest"]);
    expect(result.artifacts[1]).toMatchObject({ kind: "artifact", mimeType: "application/json" });
    const serialized = JSON.stringify(result) + readFileSync(path.join(outputRoot, "retrieval-precision-recall-execution.json"), "utf8");
    for (const forbidden of [fixture.root, outputRoot, RPR_MARKERS.title, RPR_MARKERS.symbol, RPR_MARKERS.fact, RPR_MARKERS.warning, "src/main.ts", "helper.ts"]) {
      expect(serialized.includes(forbidden), forbidden).toBe(false);
    }
    expect(JSON.stringify(result.cases)).toContain("<redacted case title>");
  });

  it("on any safety failure writes no normal durable file", async () => {
    const subject = await setup();
    const { result, outputRoot } = await runPlugin({
      targetPath: fixture.root,
      inputs: { cases: subject.evaluationCases, localSubject: subject, retrievalDependencies: fakeDependencies({ evidenceFor: () => evidenceOf(["src/ignored.ts"]) }).dependencies }
    });
    expect(result.status).toBe("failed");
    expect(result.failures[0].message).toBe(
      "Local subject execution failed (RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE): case rpr-case-one: retrieval exposed 1 file identity outside the eligible subject universe."
    );
    expect(result.failures[0].message).not.toContain("ignored");
    const files = existsSync(outputRoot) ? readdirSync(outputRoot) : [];
    expect(files).toEqual([]);
  });
});
