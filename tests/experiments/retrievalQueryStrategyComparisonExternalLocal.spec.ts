import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeLocalRepositorySubjectManifest, type LocalRepositorySubject } from "../../src/evaluation/localRepositorySubject/index.js";
import { RETRIEVAL_QUERY_STRATEGY_IDS, type RetrievalQueryStrategyId } from "../../src/evaluation/retrievalQueryStrategies.js";
import type { RetrievalQueryStrategyEvidenceV1 } from "../../src/evaluation/retrievalQueryStrategyEvidence.js";
import type { RetrievalQualityMetricsV1 } from "../../src/evaluation/retrievalQuality/index.js";
import {
  RETRIEVAL_QUERY_STRATEGY_IDENTITY_REDACTION,
  RETRIEVAL_QUERY_STRATEGY_REDACTED_CASE_TITLE,
  RETRIEVAL_QUERY_STRATEGY_UNEXPECTED_EXTERNAL_FAILURE_MESSAGE,
  analyzeRetrievalQueryStrategyComparison,
  assertRetrievalQueryStrategyExternalProjectionIsPrivate,
  countRetrievalQueryStrategyFilesOutsideEligibleUniverse,
  describeRetrievalQueryStrategyLocalSubjectFailureForPersistence,
  executeLocalRepositorySubjectRetrievalQueryStrategyComparison,
  executeRetrievalQueryStrategyCaseFromPreparedIndex,
  projectRetrievalQueryStrategyAnalysisForExternalLocalPersistence,
  projectRetrievalQueryStrategyExecutionForExternalLocalPersistence,
  retrievalQueryStrategyComparisonMetadata,
  retrievalQueryStrategyComparisonPlugin,
  validateRetrievalQueryStrategyComparisonConfig,
  type RetrievalQueryStrategyComparisonCaseEvidenceV1,
  type RetrievalQueryStrategyComparisonConfig,
  type RetrievalQueryStrategyComparisonDependencies,
  type RetrievalQueryStrategyLocalSubjectDependencies
} from "../../src/experiments/plugins/retrievalQueryStrategyComparison/index.js";
import { LocalSubjectExecutionError } from "../../src/experiments/plugins/contextWindowScaling/localSubjectErrors.js";
import { deriveGuidedIndexExclusions } from "../../src/experiments/plugins/contextWindowScaling/localSubjectExclusions.js";
import type { ExperimentExecutionContext, ExperimentTarget } from "../../src/experiments/types.js";
import { removeTempDir } from "../evaluation/localRepositorySubject/fixtureRepository.js";
import { git, listTree, makeTempDir } from "./contextWindowScaling/localSubjectFixture.js";
import type { LocalSubjectFixture } from "./contextWindowScaling/localSubjectFixture.js";
import { createRprLocalSubjectFixture, RPR_MARKERS, rprLocalSubjectCases } from "./retrievalPrecisionRecall/localSubjectFixture.js";
import { indexResultOf, makeEvaluationCase, retrievalResultOf, SOURCE_SENTINEL, STDERR_SENTINEL, STDOUT_SENTINEL } from "./retrievalPrecisionRecall/retrievalPrecisionRecallTestHelpers.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let fixture: LocalSubjectFixture;
const extraDirs: string[] = [];
afterEach(() => {
  for (const directory of [...(fixture?.directories ?? []), ...extraDirs.splice(0)]) removeTempDir(directory);
});

async function setup(cases?: Record<string, unknown>[]): Promise<LocalRepositorySubject> {
  fixture = await createRprLocalSubjectFixture({ cases });
  return fixture.subject;
}

// ------------------------------------------------------------ fake harness

type BuildCall = { sourceRoots: string[]; absoluteTargetRoot: string; excludePaths: readonly string[] | undefined; indexDir: string; commandsDir: string };
type StrategyCall = { strategyId: RetrievalQueryStrategyId; caseId: string; indexDir: string; commandsDir: string; hadBaseMarker?: boolean };

const NODE_PREFIX = "symbol:src/main.ts#";

/** Identities that match the case's answer key, each symbol at the file its fact target names. */
function matchingEvidence(
  strategyId: RetrievalQueryStrategyId,
  evaluationCase: { expectedFiles: string[]; expectedSymbols: string[] }
): RetrievalQueryStrategyEvidenceV1 {
  return {
    schemaVersion: "retrieval-query-strategy-evidence-v1",
    strategyId,
    availability: "available",
    availabilityReason: null,
    files: evaluationCase.expectedFiles.map((file) => ({ path: file })),
    symbols: evaluationCase.expectedSymbols.map((name, index) => ({
      name,
      nodeId: `${NODE_PREFIX}${name}`,
      file: evaluationCase.expectedFiles[index] ?? evaluationCase.expectedFiles[0]
    })),
    steps: [{ kind: "search", succeeded: true, evidenceAvailable: true, reason: null }]
  };
}

type HarnessOptions = {
  evidence?: (strategyId: RetrievalQueryStrategyId, evaluationCase: { id: string; expectedFiles: string[]; expectedSymbols: string[] }) => RetrievalQueryStrategyEvidenceV1;
  buildOk?: boolean;
  throwFor?: RetrievalQueryStrategyId;
  warnings?: string[];
  onRun?: (strategyId: RetrievalQueryStrategyId, caseId: string) => void;
};

function makeHarness(options: HarnessOptions = {}) {
  const builds: BuildCall[] = [];
  const calls: StrategyCall[] = [];
  const evidenceFor = options.evidence ?? ((strategyId, evaluationCase) => matchingEvidence(strategyId, evaluationCase));
  const tokensFor = (strategyId: RetrievalQueryStrategyId) => 100 + RETRIEVAL_QUERY_STRATEGY_IDS.indexOf(strategyId);
  const dependencies: RetrievalQueryStrategyComparisonDependencies = {
    async buildIndex(args) {
      builds.push({
        sourceRoots: [...args.target.sourceRoots],
        absoluteTargetRoot: args.target.absoluteTargetRoot,
        excludePaths: args.excludePaths,
        indexDir: args.indexDir,
        commandsDir: args.commandsDir
      });
      mkdirSync(args.indexDir, { recursive: true });
      writeFileSync(path.join(args.indexDir, "base-marker.txt"), "base");
      return indexResultOf(args.indexDir, options.buildOk ?? true);
    },
    async runCoreStrategy(args) {
      calls.push({ strategyId: args.strategyId, caseId: args.evaluationCase.id, indexDir: args.indexDir, commandsDir: args.commandsDir });
      options.onRun?.(args.strategyId, args.evaluationCase.id);
      if (options.throwFor === args.strategyId) throw new Error(`thrown ${STDERR_SENTINEL} ${fixture.root}`);
      return {
        ...retrievalResultOf(args.evaluationCase, undefined, { tokens: tokensFor(args.strategyId), warnings: options.warnings }),
        queryStrategyEvidence: evidenceFor(args.strategyId, args.evaluationCase)
      };
    },
    async runSemanticStrategy(args) {
      calls.push({
        strategyId: args.strategyId,
        caseId: args.evaluationCase.id,
        indexDir: args.indexDir,
        commandsDir: args.commandsDir,
        hadBaseMarker: existsSync(path.join(args.indexDir, "base-marker.txt"))
      });
      options.onRun?.(args.strategyId, args.evaluationCase.id);
      writeFileSync(path.join(args.indexDir, `derived-${args.strategyId}.json`), "{}");
      if (options.throwFor === args.strategyId) throw new Error(`thrown ${STDERR_SENTINEL}`);
      return {
        caseId: args.evaluationCase.id,
        strategyId: args.strategyId,
        skipped: false,
        warnings: options.warnings ?? [],
        totalChars: 400,
        totalEstimatedTokens: tokensFor(args.strategyId),
        tokenCountMethod: "estimated_chars_div_4",
        contextText: SOURCE_SENTINEL,
        commands: [{ ...retrievalResultOf(args.evaluationCase, undefined).commands[0], stdout: STDOUT_SENTINEL, stderr: STDERR_SENTINEL }],
        queryStrategyEvidence: evidenceFor(args.strategyId, args.evaluationCase),
        durationMs: 5
      };
    }
  };
  const localDependencies: Partial<RetrievalQueryStrategyLocalSubjectDependencies> = {
    buildIndex: dependencies.buildIndex,
    executeCase: (opts) =>
      executeRetrievalQueryStrategyCaseFromPreparedIndex({
        ...opts,
        dependencies: { runCoreStrategy: dependencies.runCoreStrategy, runSemanticStrategy: dependencies.runSemanticStrategy }
      })
  };
  return { builds, calls, dependencies, localDependencies };
}
type Harness = ReturnType<typeof makeHarness>;

const errorOf = async (promise: Promise<unknown>): Promise<LocalSubjectExecutionError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LocalSubjectExecutionError);
    return error as LocalSubjectExecutionError;
  }
  throw new Error("expected the external-local execution to fail");
};

const runLocal = (subject: LocalRepositorySubject, harness = makeHarness(), extra: Record<string, unknown> = {}) =>
  executeLocalRepositorySubjectRetrievalQueryStrategyComparison({
    subject,
    kitCommand: "kit",
    workRoot: fixture.workRoot,
    dependencies: harness.localDependencies,
    ...extra
  });

function externalTarget(root: string): ExperimentTarget {
  return {
    kind: "external-local",
    targetRoot: root,
    toolRoot: process.cwd(),
    packageName: null,
    packageVersion: null,
    hasPackageJson: false,
    hasLockfile: false,
    branch: null,
    commit: null,
    hasGit: true,
    isSelf: false
  };
}

function configOf(config?: unknown): RetrievalQueryStrategyComparisonConfig {
  const validated = validateRetrievalQueryStrategyComparisonConfig(config);
  if (!validated.valid) throw new Error(validated.errors.join(" "));
  return validated.config as RetrievalQueryStrategyComparisonConfig;
}

async function runPlugin(options: {
  target?: ExperimentTarget;
  inputs?: Record<string, unknown>;
  config?: unknown;
  outputRoot?: string;
}) {
  const outputRoot = options.outputRoot ?? path.join(makeTempDir("rqs-ext-out-"), "run");
  extraDirs.push(path.dirname(outputRoot));
  const context: ExperimentExecutionContext<RetrievalQueryStrategyComparisonConfig> = {
    runId: "run-ext",
    startedAt: new Date(),
    toolRoot: process.cwd(),
    target: options.target ?? externalTarget(fixture.root),
    config: configOf(options.config),
    outputRoot,
    inputs: options.inputs
  };
  return { outputRoot, run: () => retrievalQueryStrategyComparisonPlugin.run(context) };
}

const pluginInputs = (subject: LocalRepositorySubject, harness: Harness) => ({
  localSubject: subject,
  retrievalDependencies: harness.dependencies
});

const MANIFEST = "local-repository-subject-manifest.json";
const EXEC = "retrieval-query-strategy-comparison-execution.json";
const ANALYSIS = "retrieval-query-strategy-comparison-analysis.json";

// -------------------------------------------------------- prepared executor

describe("prepared-case executor and bundled delegation", () => {
  it("TST-081-073 executes seven ordered treatments from one prepared base without building an index", async () => {
    const harness = makeHarness();
    const base = path.join(makeTempDir("rqs-prep-"), "base");
    extraDirs.push(path.dirname(base));
    mkdirSync(base, { recursive: true });
    writeFileSync(path.join(base, "base-marker.txt"), "base");
    const semanticRoot = path.join(path.dirname(base), "strategies");
    const evaluationCase = makeEvaluationCase({ id: "prep-1" });
    const result = await executeRetrievalQueryStrategyCaseFromPreparedIndex({
      evaluationCase,
      kitCommand: "kit",
      baseIndexDir: base,
      commandsDir: path.join(path.dirname(base), "commands"),
      semanticIndexesRoot: semanticRoot,
      dependencies: { runCoreStrategy: harness.dependencies.runCoreStrategy, runSemanticStrategy: harness.dependencies.runSemanticStrategy }
    });
    expect(harness.builds).toHaveLength(0);
    expect(result).toMatchObject({ caseId: "prep-1", caseName: evaluationCase.title, benchmarkProject: evaluationCase.benchmarkProject, taskLocality: "localized" });
    expect(result.treatments.map((treatment) => treatment.strategyId)).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
    expect(result.identityRedaction).toBeUndefined();
    for (const call of harness.calls) {
      const semantic = call.strategyId === "data-model-graph" || call.strategyId === "model-view-lineage";
      expect(call.indexDir).toBe(semantic ? path.join(semanticRoot, call.strategyId) : base);
      if (semantic) expect(call.hadBaseMarker).toBe(true);
    }
    expect(existsSync(semanticRoot) ? readdirSync(semanticRoot) : []).toEqual([]);
  });

  it("the bundled executor owns no second treatment loop and delegates per valid case", () => {
    const text = readFileSync(path.resolve("src/experiments/plugins/retrievalQueryStrategyComparison/execution.ts"), "utf8");
    expect(text.match(/for \(const strategyId of RETRIEVAL_QUERY_STRATEGY_IDS\)/g)).toHaveLength(1);
    const bundled = text.slice(text.indexOf("export async function executeRetrievalQueryStrategyComparison"), text.indexOf("export async function executeRetrievalQueryStrategyCaseFromPreparedIndex"));
    expect(bundled).toContain("executeRetrievalQueryStrategyCaseFromPreparedIndex(");
    expect(bundled).not.toMatch(/executeCoreTreatment|executeSemanticTreatment|RETRIEVAL_QUERY_STRATEGY_IDS\)/);
  });
});

// ------------------------------------------------------ external execution

describe("external-local execution", () => {
  it("TST-081-074 builds one base index per configured case with exactly that case's source roots", async () => {
    const subject = await setup();
    const harness = makeHarness();
    await runLocal(subject, harness);
    expect(new Set(subject.evaluationCases.map((entry) => entry.benchmarkProject)).size).toBe(1);
    expect(harness.builds).toHaveLength(2);
    expect(harness.builds[0].sourceRoots).toEqual(["src"]);
    expect(harness.builds[1].sourceRoots).toEqual(["src/util"]);
    for (const build of harness.builds) expect(build.absoluteTargetRoot).toBe(subject.repositoryRoot);
    expect(new Set(harness.builds.map((build) => build.indexDir)).size).toBe(2);
  });

  it("TST-081-075 passes the exact derived exclusions to every case index", async () => {
    const subject = await setup();
    const harness = makeHarness();
    await runLocal(subject, harness);
    const expected = deriveGuidedIndexExclusions({
      eligibleFiles: subject.eligibleFiles,
      excludedFiles: [...subject.runtimeSafetyExclusions.gitIgnoredFiles, ...subject.runtimeSafetyExclusions.oversizedFiles]
    });
    expect(expected.length).toBeGreaterThan(0);
    for (const build of harness.builds) expect(build.excludePaths).toEqual(expected);
  });

  it("TST-081-076 derives all seven treatments from one case base with isolated semantic copies in the scratch layout", async () => {
    const subject = await setup();
    const harness = makeHarness();
    const result = await runLocal(subject, harness);
    expect(harness.builds).toHaveLength(2);
    expect(result.caseEvidence.map((entry) => entry.treatments.map((t) => t.strategyId))).toEqual([
      [...RETRIEVAL_QUERY_STRATEGY_IDS],
      [...RETRIEVAL_QUERY_STRATEGY_IDS]
    ]);
    const workRoot = path.resolve(fixture.workRoot);
    for (const [position, build] of harness.builds.entries()) {
      const n = position + 1;
      const rel = (value: string) => path.relative(workRoot, value).split(path.sep).slice(1).join("/");
      expect(rel(build.indexDir)).toBe(`i${n}/base`);
      expect(rel(build.commandsDir)).toBe(`c${n}/index`);
      const caseId = subject.evaluationCases[position].id;
      const calls = harness.calls.filter((call) => call.caseId === caseId);
      expect(calls.map((call) => call.strategyId)).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
      for (const call of calls) {
        const semantic = call.strategyId === "data-model-graph" || call.strategyId === "model-view-lineage";
        expect(rel(call.indexDir)).toBe(semantic ? `i${n}/strategies/${call.strategyId}` : `i${n}/base`);
        expect(rel(call.commandsDir)).toBe(`c${n}/retrieval/${call.strategyId}`);
        if (semantic) expect(call.hadBaseMarker).toBe(true);
        expect(rel(call.indexDir)).not.toMatch(/fixture|rpr-case|lrs-b2|src\//);
      }
      const semanticDirs = calls.filter((call) => call.hadBaseMarker !== undefined).map((call) => call.indexDir);
      expect(new Set(semanticDirs).size).toBe(2);
    }
    expect(readdirSync(workRoot)).toEqual([]);
  });

  it("TST-081-082 keeps a failed strategy treatment as measurement evidence", async () => {
    const subject = await setup();
    const result = await runLocal(subject, makeHarness({ throwFor: "keyword-search" }));
    for (const entry of result.caseEvidence) {
      expect(entry.treatments).toHaveLength(7);
      expect(entry.treatments[0]).toMatchObject({ strategyId: "keyword-search", status: "failed", retrieval: null, evidence: null });
      expect(entry.treatments[0].errors.map((error) => error.code)).toEqual(["retrieval-failed"]);
      expect(entry.treatments.slice(1).every((treatment) => treatment.status === "completed")).toBe(true);
    }
    expect(result.immutability).toMatchObject({ status: "unchanged", newMutationCount: 0 });
  });

  it("fails on invalid external ground truth with a fixed message before any index, scratch or snapshot", async () => {
    const broken = rprLocalSubjectCases();
    delete (broken[0].answerKey as { expectedContextTargets?: unknown }).expectedContextTargets;
    const subject = await setup(broken);
    const harness = makeHarness();
    const error = await errorOf(runLocal(subject, harness));
    expect(error.code).toBe("GROUND_TRUTH_INVALID");
    expect(error.issues[0].message).toBe("retrieval comparison ground truth is incomplete for configured case(s).");
    for (const private_ of [RPR_MARKERS.title, RPR_MARKERS.fact, RPR_MARKERS.symbol, "src/main.ts"]) expect(error.message).not.toContain(private_);
    expect(harness.builds).toEqual([]);
    expect(existsSync(fixture.workRoot)).toBe(false);
  });

  it("fails on an index failure or an unexpected throw with fixed text and still cleans up", async () => {
    const subject = await setup();
    const indexFailure = await errorOf(runLocal(subject, makeHarness({ buildOk: false })));
    expect(indexFailure.issues).toEqual([{ code: "EXECUTION_FAILED", message: "retrieval comparison index preparation failed for a configured case." }]);
    expect(readdirSync(fixture.workRoot)).toEqual([]);

    const harness = makeHarness();
    const thrown = await errorOf(
      runLocal(subject, harness, {
        dependencies: { ...harness.localDependencies, executeCase: async () => { throw new Error(`boom ${STDERR_SENTINEL} ${fixture.root}`); } }
      })
    );
    expect(thrown.issues).toEqual([{ code: "EXECUTION_FAILED", message: "retrieval comparison execution failed for a configured case." }]);
    expect(thrown.message).not.toContain(STDERR_SENTINEL);
    expect(thrown.message).not.toContain(fixture.root);
    expect(readdirSync(fixture.workRoot)).toEqual([]);
  });
});

describe("eligible universe", () => {
  const evidenceWith = (files: string[], symbolFile: string | null = null) => {
    const evidence = matchingEvidence("keyword-search", { expectedFiles: files, expectedSymbols: [] });
    if (symbolFile !== null) evidence.symbols = [{ name: "S", nodeId: null, file: symbolFile }];
    return evidence;
  };
  const caseWith = (files: string[], symbolFile: string | null = null): RetrievalQueryStrategyComparisonCaseEvidenceV1 => ({
    caseId: "c",
    caseName: "t",
    benchmarkProject: "p",
    taskLocality: null,
    treatments: [
      {
        strategyId: "keyword-search",
        status: "completed",
        retrieval: null,
        evidence: evidenceWith(files, symbolFile),
        errors: []
      },
      { strategyId: "symbol-lookup", status: "failed", retrieval: null, evidence: null, errors: [] }
    ]
  });

  it("TST-081-077 counts distinct outside identities from evidence files and symbol files only", () => {
    const eligible = new Set(["src/a.ts"]);
    expect(countRetrievalQueryStrategyFilesOutsideEligibleUniverse(caseWith(["src/a.ts", "private/outside.ts"]), eligible)).toBe(1);
    expect(countRetrievalQueryStrategyFilesOutsideEligibleUniverse(caseWith(["src/a.ts"], "private/outside.ts"), eligible)).toBe(1);
    expect(countRetrievalQueryStrategyFilesOutsideEligibleUniverse(caseWith(["private/outside.ts"], "private/outside.ts"), eligible)).toBe(1);
    expect(countRetrievalQueryStrategyFilesOutsideEligibleUniverse(caseWith(["src/a.ts"]), eligible)).toBe(0);
  });

  it("TST-081-078 fails closed on an outside identity without naming it and stops later cases", async () => {
    const subject = await setup();
    for (const outside of ["src/ignored.ts", "src/gen/out.ts", "src/huge.ts", "not-in-the-repository/secret.ts"]) {
      expect(subject.eligibleFiles).not.toContain(outside);
      const harness = makeHarness({
        evidence: (strategyId, evaluationCase) =>
          strategyId === "graph-neighborhood" ? { ...matchingEvidence(strategyId, evaluationCase), files: [{ path: "src/main.ts" }, { path: outside }] } : matchingEvidence(strategyId, evaluationCase)
      });
      const error = await errorOf(runLocal(subject, harness));
      expect(error.code, outside).toBe("RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE");
      expect(error.issues[0].message).toBe("retrieval comparison exposed 1 file identity outside the eligible subject universe.");
      expect(error.message).not.toContain(path.basename(outside));
      expect(new Set(harness.calls.map((call) => call.caseId))).toEqual(new Set(["rpr-case-one"]));
      expect(readdirSync(fixture.workRoot)).toEqual([]);
    }
    // Symbol-file-only exposure also fails.
    const symbolOnly = makeHarness({
      evidence: (strategyId, evaluationCase) => {
        const evidence = matchingEvidence(strategyId, evaluationCase);
        evidence.symbols = [{ name: RPR_MARKERS.symbol, nodeId: null, file: "src/ignored.ts" }];
        return evidence;
      }
    });
    expect((await errorOf(runLocal(subject, symbolOnly))).code).toBe("RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE");
  });

  it("writes no durable plugin artifact when an outside identity is exposed", async () => {
    const subject = await setup();
    const harness = makeHarness({ evidence: (strategyId, evaluationCase) => ({ ...matchingEvidence(strategyId, evaluationCase), files: [{ path: "src/ignored.ts" }] }) });
    const { run, outputRoot } = await runPlugin({ inputs: pluginInputs(subject, harness) });
    await expect(run()).rejects.toThrow(
      "Local subject retrieval-query-strategy comparison failed (RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE): retrieval comparison exposed 1 file identity outside the eligible subject universe."
    );
    expect(existsSync(outputRoot) ? readdirSync(outputRoot) : []).toEqual([]);
  });
});

describe("safety gates", () => {
  it("TST-081-079 rejects a work root inside, or equal to, the target before any index or scratch", async () => {
    const subject = await setup();
    for (const workRoot of [path.join(subject.repositoryRoot, "lab-out"), subject.repositoryRoot]) {
      const harness = makeHarness();
      const error = await errorOf(runLocal(subject, harness, { workRoot }));
      expect(error.code).toBe("WORK_ROOT_INSIDE_TARGET");
      expect(harness.builds).toEqual([]);
      expect(existsSync(path.join(subject.repositoryRoot, "lab-out"))).toBe(false);
    }
  });

  it("leaves the target unchanged on success and creates nothing inside it", async () => {
    const subject = await setup();
    const treeBefore = listTree(fixture.root);
    const statusBefore = git(fixture.root, "status", "--porcelain=v1", "--ignored");
    const result = await runLocal(subject);
    expect(result.immutability.status).toBe("unchanged");
    expect(listTree(fixture.root)).toEqual(treeBefore);
    expect(git(fixture.root, "status", "--porcelain=v1", "--ignored")).toBe(statusBefore);
  });

  it("TST-081-080 detects mutation, never restores it, and writes no artifact", async () => {
    const subject = await setup();
    const mainPath = path.join(fixture.root, "src", "main.ts");
    const before = readFileSync(mainPath, "utf8");
    const harness = makeHarness({ onRun: (strategyId) => { if (strategyId === "source-slice") appendFileSync(mainPath, "\n// mutated during the run\n"); } });
    const direct = await errorOf(runLocal(subject, harness));
    expect(direct.code).toBe("TARGET_MUTATED");
    expect(direct.immutability?.status).toBe("mutated");
    expect(direct.message).not.toContain("main.ts");
    expect(readFileSync(mainPath, "utf8")).toContain("// mutated during the run");
    expect(readFileSync(mainPath, "utf8").startsWith(before)).toBe(true);
    expect(readdirSync(fixture.workRoot)).toEqual([]);

    const { run, outputRoot } = await runPlugin({ inputs: pluginInputs(subject, makeHarness({ onRun: (strategyId) => { if (strategyId === "source-slice") appendFileSync(mainPath, "\n// again\n"); } })) });
    await expect(run()).rejects.toThrow(/Local subject retrieval-query-strategy comparison failed \(TARGET_MUTATED\)/);
    expect(existsSync(outputRoot) ? readdirSync(outputRoot) : []).toEqual([]);
  });

  it("TST-081-081 treats run-level scratch cleanup failure as a safety gate", async () => {
    const subject = await setup();
    const error = await errorOf(
      runLocal(subject, makeHarness(), { scratchIo: { removeDirectory: async () => { throw new Error(`cannot remove ${fixture.workRoot}`); } } })
    );
    expect(error.code).toBe("SCRATCH_CLEANUP_FAILED");
    expect(error.message).not.toContain(fixture.workRoot);
  });

  it("keeps the primary issue first when secondary safety gates also fail", async () => {
    const subject = await setup();
    const error = await errorOf(
      runLocal(subject, makeHarness({ buildOk: false }), { scratchIo: { removeDirectory: async () => { throw new Error("x"); } } })
    );
    expect(error.issues.map((issue) => issue.code)).toEqual(["EXECUTION_FAILED", "SCRATCH_CLEANUP_FAILED"]);
  });
});

// ------------------------------------------------------------ privacy units

const PRIVATE = {
  title: "PRIVATE CASE TITLE sentinel-9f",
  file: "private-dir/PrivateFileSentinel.ts",
  fileTwo: "private-dir/Other.ts",
  symbol: "PrivateSymbolSentinelZeta",
  node: "symbol:private-dir/PrivateFileSentinel.ts#PrivateSymbolSentinelZeta",
  warning: "WARNING_PROSE_SENTINEL_31ac",
  fact: "private-fact-sentinel-id"
};

function privateEvidence(): RetrievalQueryStrategyComparisonCaseEvidenceV1 {
  const evidence: RetrievalQueryStrategyEvidenceV1 = {
    schemaVersion: "retrieval-query-strategy-evidence-v1",
    strategyId: "data-model-graph",
    availability: "partial",
    availabilityReason: "fixed-reason",
    files: [{ path: PRIVATE.fileTwo }, { path: PRIVATE.file }],
    symbols: [
      { name: PRIVATE.symbol, nodeId: PRIVATE.node, file: PRIVATE.file },
      { name: "Other", nodeId: null, file: "private-dir/UnionOnly.ts" },
      { name: "NoFile", nodeId: null, file: null }
    ],
    steps: [{ kind: "data-model", succeeded: true, evidenceAvailable: true, reason: null }]
  };
  return {
    caseId: "case-1",
    caseName: PRIVATE.title,
    benchmarkProject: "subject-x",
    taskLocality: "localized",
    treatments: [
      {
        strategyId: "data-model-graph",
        status: "partial",
        retrieval: {
          skipped: false,
          durationMs: 7,
          totalEstimatedTokens: 321,
          tokenCountMethod: "estimated_chars_div_4",
          warnings: [`a ${PRIVATE.warning}`, "second"],
          evidenceAvailability: "partial",
          evidenceAvailabilityReason: "fixed-reason",
          retrievedFileCount: 2,
          retrievedSymbolCount: 3,
          steps: evidence.steps
        },
        evidence,
        errors: [{ code: "retrieval-failed", message: `raw ${PRIVATE.file}` }]
      },
      {
        strategyId: "keyword-search",
        status: "failed",
        retrieval: null,
        evidence: null,
        errors: [
          { code: "strategy-index-cleanup-failed", message: `raw ${PRIVATE.file}` },
          { code: "project-index-failed", message: "x" }
        ]
      }
    ]
  };
}

describe("execution privacy projection", () => {
  it("TST-081-083 redacts titles, files, symbols, node IDs and warnings with deterministic placeholders", () => {
    const original = privateEvidence();
    const snapshot = JSON.stringify(original);
    const [projected] = projectRetrievalQueryStrategyExecutionForExternalLocalPersistence([original]);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(projected.caseName).toBe(RETRIEVAL_QUERY_STRATEGY_REDACTED_CASE_TITLE);
    expect(projected.caseName).toBe("<redacted case title>");
    expect(projected).toMatchObject({ caseId: "case-1", benchmarkProject: "subject-x", taskLocality: "localized" });
    expect(projected.identityRedaction).toEqual(RETRIEVAL_QUERY_STRATEGY_IDENTITY_REDACTION);
    expect(RETRIEVAL_QUERY_STRATEGY_IDENTITY_REDACTION).toEqual({
      fileIdentities: "redacted",
      symbolIdentities: "redacted",
      factIdentities: "redacted",
      warningText: "redacted",
      caseTitle: "redacted",
      semanticNodeIds: "redacted"
    });
    const treatment = projected.treatments[0];
    // Union of {Other, PrivateFileSentinel, UnionOnly} sorted by code unit.
    expect(treatment.evidence?.files).toEqual([{ path: "<redacted file 1>" }, { path: "<redacted file 2>" }]);
    expect(treatment.evidence?.symbols).toEqual([
      { name: "<redacted symbol 1>", nodeId: null, file: "<redacted file 2>" },
      { name: "<redacted symbol 2>", nodeId: null, file: "<redacted file 3>" },
      { name: "<redacted symbol 3>", nodeId: null, file: null }
    ]);
    expect(treatment.evidence).toMatchObject({ availability: "partial", availabilityReason: "fixed-reason" });
    expect(treatment.evidence?.steps).toEqual(original.treatments[0].evidence?.steps);
    expect(treatment.retrieval).toMatchObject({
      durationMs: 7,
      totalEstimatedTokens: 321,
      retrievedFileCount: 2,
      retrievedSymbolCount: 3,
      evidenceAvailability: "partial",
      warnings: ["<redacted warning 1>", "<redacted warning 2>"]
    });
    expect(treatment.errors).toEqual([{ code: "retrieval-failed", message: "The retrieval strategy did not complete." }]);
    expect(projected.treatments[1].errors).toEqual([
      { code: "strategy-index-cleanup-failed", message: "The isolated semantic-strategy index could not be removed." },
      { code: "project-index-failed", message: "The my-dev-kit index could not be prepared." }
    ]);
    expect(projected.treatments[1]).toMatchObject({ retrieval: null, evidence: null, status: "failed" });
    const serialized = JSON.stringify(projected);
    for (const value of [PRIVATE.title, PRIVATE.file, PRIVATE.fileTwo, PRIVATE.symbol, PRIVATE.node, PRIVATE.warning, "private-dir"]) {
      expect(serialized).not.toContain(value);
    }
    // Structural, not substring: every symbol name is a placeholder and no node ID survives.
    for (const symbol of treatment.evidence?.symbols ?? []) {
      expect(symbol.name).toMatch(/^<redacted symbol \d+>$/);
      expect(symbol.nodeId).toBeNull();
    }
  });

  const quality = (): RetrievalQualityMetricsV1 => ({
    schemaVersion: "retrieval-quality-metrics-v1",
    caseId: "c",
    evidence: { availability: "available", reason: null },
    expectations: { files: { availability: "available", reason: null }, symbols: { availability: "available", reason: null } },
    file: {
      relevantRetrievedFiles: [PRIVATE.file],
      irrelevantRetrievedFiles: [PRIVATE.fileTwo, "x/y.ts"],
      missedFiles: [],
      missedFileCount: 0,
      precision: { availability: "available", numerator: 1, denominator: 3, value: 1 / 3, reason: null },
      recall: { availability: "available", numerator: 1, denominator: 1, value: 1, reason: null }
    },
    symbol: {
      relevantRetrievedSymbols: [PRIVATE.symbol],
      irrelevantRetrievedSymbols: null,
      missedSymbols: ["Lost"],
      missedSymbolCount: 1,
      precision: { availability: "unavailable", numerator: null, denominator: null, value: null, reason: "r" },
      recall: { availability: "available", numerator: 1, denominator: 2, value: 0.5, reason: null }
    },
    fact: {
      coveredFactIds: [PRIVATE.fact],
      uncoveredFactIds: ["f2", "f3"],
      uncoveredFactCount: 2,
      coverage: { availability: "available", numerator: 1, denominator: 3, value: 1 / 3, reason: null }
    },
    irrelevantContextRatio: { availability: "available", numerator: 2, denominator: 3, value: 2 / 3, reason: null },
    retrievedTokenCount: 321,
    tokenCountMethod: "estimated_chars_div_4"
  });

  const analysisWith = (q: RetrievalQualityMetricsV1 | null) => ({
    cases: [
      {
        caseId: "c",
        benchmarkProject: "p",
        taskLocality: "localized",
        treatments: [
          {
            strategyId: "keyword-search" as const,
            executionStatus: "completed" as const,
            quality: q,
            fileF1: { availability: "available" as const, numerator: 2, denominator: 5, value: 0.4, reason: null },
            symbolF1: { availability: "not-applicable" as const, numerator: null, denominator: null, value: null, reason: "no-positive-or-retrieved-identities" }
          }
        ]
      }
    ],
    scopes: [
      {
        scopeId: "overall" as const,
        caseCount: 1,
        comparisonCaseCount: 1,
        excludedCaseCount: 0,
        comparisonCaseIds: ["c"],
        strategySummaries: [
          { strategyId: "keyword-search" as const, completedCaseCount: 1, partialCaseCount: 0, failedCaseCount: 0, objectives: { meanFileF1: 0.4, meanSymbolF1: 0.3, meanFactCoverage: 0.2, meanRetrievedTokenCount: 321 } }
        ],
        paretoFrontStrategyIds: ["keyword-search" as const],
        bestStrategyId: "keyword-search" as const,
        interpretation: "unique-best" as const
      }
    ]
  });

  it("TST-081-084 redacts every quality identity list and preserves every number exactly", () => {
    const original = quality();
    const projected = projectRetrievalQueryStrategyAnalysisForExternalLocalPersistence(analysisWith(original)).cases[0].treatments[0].quality as RetrievalQualityMetricsV1;
    expect(projected.file.relevantRetrievedFiles).toEqual(["<redacted file 1>"]);
    expect(projected.file.irrelevantRetrievedFiles).toEqual(["<redacted file 1>", "<redacted file 2>"]);
    expect(projected.file.missedFiles).toEqual([]);
    expect(projected.symbol.relevantRetrievedSymbols).toEqual(["<redacted symbol 1>"]);
    expect(projected.symbol.irrelevantRetrievedSymbols).toBeNull();
    expect(projected.symbol.missedSymbols).toEqual(["<redacted symbol 1>"]);
    expect(projected.fact.coveredFactIds).toEqual(["<redacted fact 1>"]);
    expect(projected.fact.uncoveredFactIds).toEqual(["<redacted fact 1>", "<redacted fact 2>"]);
    expect(projected.file.precision).toEqual(original.file.precision);
    expect(projected.file.recall).toEqual(original.file.recall);
    expect(projected.symbol.precision).toEqual(original.symbol.precision);
    expect(projected.symbol.recall).toEqual(original.symbol.recall);
    expect(projected.fact.coverage).toEqual(original.fact.coverage);
    expect(projected.irrelevantContextRatio).toEqual(original.irrelevantContextRatio);
    expect(projected.retrievedTokenCount).toBe(321);
    expect(projected.tokenCountMethod).toBe("estimated_chars_div_4");
    expect(projected.file.missedFileCount).toBe(0);
    expect(projected.symbol.missedSymbolCount).toBe(1);
    expect(projected.fact.uncoveredFactCount).toBe(2);
    expect(projected.evidence).toEqual(original.evidence);
    expect(projected.expectations).toEqual(original.expectations);
    expect(JSON.stringify(projected)).not.toContain(PRIVATE.symbol);
    expect(JSON.stringify(projected)).not.toContain(PRIVATE.fact);
  });

  it("TST-081-085 carries F1 values through unchanged", () => {
    const analysis = analysisWith(quality());
    const projected = projectRetrievalQueryStrategyAnalysisForExternalLocalPersistence(analysis);
    expect(projected.cases[0].treatments[0].fileF1).toEqual(analysis.cases[0].treatments[0].fileF1);
    expect(projected.cases[0].treatments[0].symbolF1).toEqual(analysis.cases[0].treatments[0].symbolF1);
    expect(projected.cases[0].treatments[0].executionStatus).toBe("completed");
    expect(projectRetrievalQueryStrategyAnalysisForExternalLocalPersistence(analysisWith(null)).cases[0].treatments[0].quality).toBeNull();
  });

  it("TST-081-086 preserves scope analysis and Pareto interpretation exactly", () => {
    const analysis = analysisWith(quality());
    const projected = projectRetrievalQueryStrategyAnalysisForExternalLocalPersistence(analysis);
    expect(projected.scopes).toEqual(analysis.scopes);
    expect(projected.scopes[0]).toMatchObject({
      caseCount: 1,
      comparisonCaseCount: 1,
      excludedCaseCount: 0,
      comparisonCaseIds: ["c"],
      paretoFrontStrategyIds: ["keyword-search"],
      bestStrategyId: "keyword-search",
      interpretation: "unique-best"
    });
    expect(projected.scopes[0].strategySummaries[0].objectives).toEqual({ meanFileF1: 0.4, meanSymbolF1: 0.3, meanFactCoverage: 0.2, meanRetrievedTokenCount: 321 });
    expect(projected.scopes).not.toBe(analysis.scopes);
  });
});

describe("privacy assertion", () => {
  const values = { filePaths: [PRIVATE.file], caseTitles: [PRIVATE.title], warnings: [PRIVATE.warning], privateRoots: ["C:\\private\\repo-root"] };
  const MESSAGE = "External-local retrieval-query-strategy-comparison privacy projection failed; no durable output was written.";

  it("TST-081-087 throws the exact failure for each surviving private value and passes clean projections", () => {
    const [clean] = projectRetrievalQueryStrategyExecutionForExternalLocalPersistence([privateEvidence()]);
    expect(() => assertRetrievalQueryStrategyExternalProjectionIsPrivate(clean, values)).not.toThrow();
    for (const survivor of [PRIVATE.file, PRIVATE.title, PRIVATE.warning, "C:\\private\\repo-root", "C:/private/repo-root", "c:\\private\\repo-root".replace("c:", "C:")]) {
      const dirty = { ...clean, extra: `prefix ${survivor} suffix` };
      expect(() => assertRetrievalQueryStrategyExternalProjectionIsPrivate(dirty, values), survivor).toThrow(MESSAGE);
    }
    const slashDirty = { note: PRIVATE.file.replace(/\//g, "\\") };
    expect(() => assertRetrievalQueryStrategyExternalProjectionIsPrivate(slashDirty, values)).toThrow(MESSAGE);
    expect(() => assertRetrievalQueryStrategyExternalProjectionIsPrivate({ x: 1 }, { filePaths: [""], caseTitles: [], warnings: [], privateRoots: [] })).not.toThrow();
  });
});

// ------------------------------------------------------------ plugin boundary

describe("plugin external-local boundary", () => {
  it("TST-081-099 declares self and external-local targets with the final report outputs", () => {
    expect(retrievalQueryStrategyComparisonMetadata.supportedTargets).toEqual(["self", "external-local"]);
    expect(retrievalQueryStrategyComparisonMetadata.supportedOutputs).toEqual(["json", "html", "text", "artifact"]);
  });

  it("TST-081-092 fails closed for an external target without a local subject", async () => {
    const subject = await setup();
    const harness = makeHarness();
    const { run, outputRoot } = await runPlugin({ inputs: { cases: subject.evaluationCases, retrievalDependencies: harness.dependencies } });
    await expect(run()).rejects.toThrow(
      "External-local retrieval-query-strategy-comparison targets require a loaded local repository subject (--local-subject-config)."
    );
    expect(harness.builds).toEqual([]);
    expect(existsSync(outputRoot)).toBe(false);
  });

  it("TST-081-093 rejects a local subject with a self target", async () => {
    const subject = await setup();
    const harness = makeHarness();
    const self: ExperimentTarget = { ...externalTarget(fixture.root), kind: "self", isSelf: true };
    const { run } = await runPlugin({ target: self, inputs: pluginInputs(subject, harness) });
    await expect(run()).rejects.toThrow("Local-repository subject mode requires an external-local target.");
    expect(harness.builds).toEqual([]);
  });

  it("TST-081-094 rejects a target that is not the repository the subject was loaded from", async () => {
    const subject = await setup();
    const other = makeTempDir("rqs-other-target-");
    extraDirs.push(other);
    const harness = makeHarness();
    const { run } = await runPlugin({ target: externalTarget(other), inputs: pluginInputs(subject, harness) });
    await expect(run()).rejects.toThrow("The selected --target is not the repository the local subject was loaded from.");
    expect(harness.builds).toEqual([]);
  });

  it("TST-081-095 rejects bundled case and project filters", async () => {
    const subject = await setup();
    for (const config of [{ caseIds: ["rpr-case-one"] }, { benchmarkProjects: ["fixture-subject"] }]) {
      const harness = makeHarness();
      const { run } = await runPlugin({ config, inputs: pluginInputs(subject, harness) });
      await expect(run(), JSON.stringify(config)).rejects.toThrow(
        "Case and benchmark-project filters are not supported for an external local repository subject; the subject config owns the case set."
      );
      expect(harness.builds).toEqual([]);
    }
  });

  it("requires an experiment output directory", async () => {
    const subject = await setup();
    const context: ExperimentExecutionContext<RetrievalQueryStrategyComparisonConfig> = {
      runId: "r",
      startedAt: new Date(),
      toolRoot: process.cwd(),
      target: externalTarget(fixture.root),
      config: configOf(),
      inputs: pluginInputs(subject, makeHarness())
    };
    await expect(retrievalQueryStrategyComparisonPlugin.run(context)).rejects.toThrow("Local-repository subject mode requires an experiment output directory.");
  });

  it("TST-081-088 writes no artifact when the privacy assertion fails", async () => {
    // A title equal to ordinary JSON text survives projection by coincidence, which the assertion must catch.
    const cases = rprLocalSubjectCases();
    cases[0].title = "completed";
    const subject = await setup(cases);
    const { run, outputRoot } = await runPlugin({ inputs: pluginInputs(subject, makeHarness()) });
    await expect(run()).rejects.toThrow(
      "External-local retrieval-query-strategy-comparison privacy projection failed; no durable output was written."
    );
    expect(existsSync(outputRoot) ? readdirSync(outputRoot) : []).toEqual([]);
  });

  it("TST-081-089 calculates science on real identities before redaction and persists the unchanged numbers", async () => {
    const subject = await setup();
    const harness = makeHarness();
    const { run, outputRoot } = await runPlugin({ inputs: pluginInputs(subject, harness) });
    const result = await run();
    const direct = await runLocal(subject, makeHarness());
    const expected = analyzeRetrievalQueryStrategyComparison(subject.evaluationCases, direct.caseEvidence);
    const persisted = JSON.parse(readFileSync(path.join(outputRoot, ANALYSIS), "utf8"));
    // Real identities match the answer key; placeholders could never produce these values.
    const first = expected.cases[0].treatments[0];
    expect(first.fileF1.value).toBe(1);
    expect(first.symbolF1.value).toBe(1);
    expect(first.quality?.fact.coverage.value).toBe(1);
    const persistedFirst = persisted.analysis.cases[0].treatments[0];
    expect(persistedFirst.fileF1).toEqual(first.fileF1);
    expect(persistedFirst.symbolF1).toEqual(first.symbolF1);
    expect(persistedFirst.quality.file.precision).toEqual(first.quality?.file.precision);
    expect(persistedFirst.quality.fact.coverage).toEqual(first.quality?.fact.coverage);
    expect(persisted.analysis.scopes).toEqual(expected.scopes);
    expect(persisted.analysis.scopes[0].bestStrategyId).toBe("keyword-search");
    expect(persisted.analysis.scopes[0].interpretation).toBe("unique-best");
    expect(result.metrics.find((metric) => metric.id === "overall-mean-file-f1" && metric.variantId === "keyword-search")?.value).toBe(1);
    expect(result.cases[0].outcomes[0].metrics.find((metric) => metric.id === "file-f1")?.value).toBe(1);
    expect(result.analysis.scopes).toEqual(expected.scopes);
  });

  it("TST-081-090 and TST-081-091 project the target and use only basenames for artifact paths", async () => {
    const subject = await setup();
    const { run, outputRoot } = await runPlugin({ inputs: pluginInputs(subject, makeHarness()) });
    const result = await run();
    expect(result.target).toMatchObject({
      kind: "external-local",
      targetRoot: subject.manifest.logicalTargetRoot,
      toolRoot: "[redacted]",
      packageName: null,
      packageVersion: null,
      branch: subject.manifest.repository.branch,
      commit: subject.manifest.repository.commit,
      isSelf: false,
      privacyProjection: "external-local-redacted"
    });
    expect(result.artifacts.map((artifact) => [artifact.id, artifact.path])).toEqual([
      ["retrieval-query-strategy-comparison-execution", EXEC],
      ["retrieval-query-strategy-comparison-analysis", ANALYSIS],
      ["local-repository-subject-manifest", MANIFEST]
    ]);
    expect(result.artifacts[2]).toMatchObject({ label: "Privacy-safe local repository subject manifest", kind: "artifact", mimeType: "application/json" });
    expect(result.metadata).toEqual({ executionArtifactPath: EXEC, analysisArtifactPath: ANALYSIS });
    const serialized = JSON.stringify(result);
    for (const forbidden of [fixture.root, outputRoot, path.dirname(outputRoot), fixture.root.replace(/\\/g, "/")]) expect(serialized).not.toContain(forbidden);
    expect(readdirSync(outputRoot).sort()).toEqual([ANALYSIS, EXEC, MANIFEST].sort());
  });

  it("TST-081-096 writes the existing privacy-safe manifest unchanged", async () => {
    const subject = await setup();
    const { run, outputRoot } = await runPlugin({ inputs: pluginInputs(subject, makeHarness()) });
    await run();
    const text = readFileSync(path.join(outputRoot, MANIFEST), "utf8");
    expect(text).toBe(serializeLocalRepositorySubjectManifest(subject.manifest));
    const manifest = JSON.parse(text);
    expect(manifest.subjectId).toBe(subject.manifest.subjectId);
    expect(manifest.logicalTargetRoot).toBe(subject.manifest.logicalTargetRoot);
    expect(manifest.sourceRoots).toEqual(subject.manifest.sourceRoots);
    for (const forbidden of ["repositoryRoot", "eligibleFiles", "gitIgnoredFiles", "oversizedFiles", RPR_MARKERS.title, "Where are the private symbols", "src/main.ts", RPR_MARKERS.symbol, RPR_MARKERS.fact, fixture.root]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("TST-081-097 leaks no private value anywhere in the run or the three durable files", async () => {
    const subject = await setup();
    const harness = makeHarness({ warnings: [`upstream warning ${RPR_MARKERS.warning}`] });
    const { run, outputRoot } = await runPlugin({ inputs: pluginInputs(subject, harness) });
    const result = await run();
    const files = [EXEC, ANALYSIS, MANIFEST].map((name) => readFileSync(path.join(outputRoot, name), "utf8"));
    const serialized = JSON.stringify(result) + files.join("\n");
    const forbidden = [
      fixture.root,
      outputRoot,
      path.dirname(outputRoot),
      RPR_MARKERS.title,
      RPR_MARKERS.titleTwo,
      RPR_MARKERS.symbol,
      RPR_MARKERS.symbolTwo,
      RPR_MARKERS.fact,
      RPR_MARKERS.factTwo,
      RPR_MARKERS.factThree,
      RPR_MARKERS.warning,
      NODE_PREFIX,
      "src/main.ts",
      "helper.ts",
      SOURCE_SENTINEL,
      STDOUT_SENTINEL,
      STDERR_SENTINEL,
      "Where are the private symbols",
      "contextText"
    ];
    for (const value of forbidden) expect(serialized.includes(value), value).toBe(false);
    expect(result.cases.map((entry) => entry.name)).toEqual(["<redacted case title>", "<redacted case title>"]);
    expect(result.cases.map((entry) => entry.id)).toEqual(["rpr-case-one", "rpr-case-two"]);
    // Structural checks for short identity values.
    const execution = JSON.parse(files[0]);
    for (const entry of execution.cases) {
      expect(entry.identityRedaction).toEqual(RETRIEVAL_QUERY_STRATEGY_IDENTITY_REDACTION);
      for (const treatment of entry.treatments) {
        for (const symbol of treatment.evidence.symbols) {
          expect(symbol.name).toMatch(/^<redacted symbol \d+>$/);
          expect(symbol.nodeId).toBeNull();
          expect(symbol.file === null || /^<redacted file \d+>$/.test(symbol.file)).toBe(true);
        }
        for (const file of treatment.evidence.files) expect(file.path).toMatch(/^<redacted file \d+>$/);
        for (const warning of treatment.retrieval.warnings) expect(warning).toMatch(/^<redacted warning \d+>$/);
      }
    }
    const analysis = JSON.parse(files[1]);
    for (const entry of analysis.analysis.cases) {
      for (const treatment of entry.treatments) {
        const quality = treatment.quality;
        for (const list of [quality.symbol.relevantRetrievedSymbols, quality.symbol.irrelevantRetrievedSymbols, quality.symbol.missedSymbols]) {
          for (const symbol of list ?? []) expect(symbol).toMatch(/^<redacted symbol \d+>$/);
        }
        for (const list of [quality.fact.coveredFactIds, quality.fact.uncoveredFactIds]) {
          for (const fact of list ?? []) expect(fact).toMatch(/^<redacted fact \d+>$/);
        }
      }
    }
  });

  it("persists a strategy-level failure as scientific evidence", async () => {
    const subject = await setup();
    const { run, outputRoot } = await runPlugin({ inputs: pluginInputs(subject, makeHarness({ throwFor: "symbol-lookup" })) });
    const result = await run();
    expect(result.status).toBe("partial");
    expect(readdirSync(outputRoot).sort()).toEqual([ANALYSIS, EXEC, MANIFEST].sort());
    const failed = result.cases[0].outcomes[1];
    expect(failed).toMatchObject({ variantId: "symbol-lookup", status: "failed" });
    expect(failed.failures[0].message).toBe("The retrieval strategy did not complete.");
    expect(failed.metrics.every((metric) => metric.value === null)).toBe(true);
    // The failed strategy leaves no matched-comparable case, so the scope is unavailable rather than a winner.
    expect(result.analysis.scopes[0]).toMatchObject({ comparisonCaseCount: 0, interpretation: "unavailable", bestStrategyId: null });
  });

  it("TST-081-098 leaves bundled self mode unchanged", async () => {
    const harness = makeHarness();
    const bundledCases = [makeEvaluationCase({ id: "b1", project: "project-a" })];
    const outputRoot = path.join(makeTempDir("rqs-bundled-out-"), "run");
    extraDirs.push(path.dirname(outputRoot));
    const self: ExperimentTarget = { ...externalTarget(process.cwd()), kind: "self", isSelf: true, hasGit: true };
    const run = await retrievalQueryStrategyComparisonPlugin.run({
      runId: "bundled",
      startedAt: new Date(),
      toolRoot: process.cwd(),
      target: self,
      config: configOf(),
      outputRoot,
      inputs: { cases: bundledCases, retrievalDependencies: harness.dependencies }
    });
    expect(run.cases[0].name).toBe(bundledCases[0].title);
    expect(run.cases[0].name).not.toBe("<redacted case title>");
    expect(run.caseExecutionEvidence[0].identityRedaction).toBeUndefined();
    expect(JSON.stringify(run.caseExecutionEvidence)).toContain("src/a.ts");
    expect(run.artifacts.map((artifact) => artifact.id)).toEqual([
      "retrieval-query-strategy-comparison-execution",
      "retrieval-query-strategy-comparison-analysis"
    ]);
    expect(run.target.kind).toBe("self");
    expect(existsSync(path.join(outputRoot, MANIFEST))).toBe(false);
    expect(readFileSync(path.join(outputRoot, EXEC), "utf8")).not.toContain("identityRedaction");
  });
});

describe("failure description", () => {
  it("TST-081-100 describes each failure kind without paths, identities, or raw text", () => {
    const secret = `${fixture?.root ?? "C:\\secret\\repo"}\\src\\Private.ts raw Error text`;
    const describe_ = (issues: ConstructorParameters<typeof LocalSubjectExecutionError>[0], immutability?: unknown) =>
      describeRetrievalQueryStrategyLocalSubjectFailureForPersistence(
        new LocalSubjectExecutionError(issues, { immutability: (immutability ?? null) as never })
      );
    const prefix = "Local subject retrieval-query-strategy comparison failed";
    expect(describe_([{ code: "EXECUTION_FAILED", message: "retrieval comparison execution failed for a configured case." }])).toBe(
      `${prefix} (EXECUTION_FAILED): retrieval comparison execution failed for a configured case.`
    );
    expect(describe_([{ code: "GROUND_TRUTH_INVALID", message: "retrieval comparison ground truth is incomplete for configured case(s)." }])).toBe(
      `${prefix} (GROUND_TRUTH_INVALID): retrieval comparison ground truth is incomplete for configured case(s).`
    );
    expect(describe_([{ code: "RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE", message: "retrieval comparison exposed 2 file identities outside the eligible subject universe." }])).toBe(
      `${prefix} (RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE): retrieval comparison exposed 2 file identities outside the eligible subject universe.`
    );
    const mutated = describe_([{ code: "TARGET_MUTATED", message: secret }], { status: "mutated", mutations: [{ kind: "modified", path: secret }, { kind: "added", path: secret }] });
    expect(mutated).toBe(`${prefix} (TARGET_MUTATED): the target changed during execution (added, modified); it was not restored.`);
    const cleanup = describe_([{ code: "SCRATCH_CLEANUP_FAILED", message: secret }]);
    expect(cleanup).toBe(`${prefix} (SCRATCH_CLEANUP_FAILED): the private scratch could not be removed.`);
    expect(describe_([{ code: "WORK_ROOT_INSIDE_TARGET", message: secret }])).toBe(
      `${prefix} (WORK_ROOT_INSIDE_TARGET): the output directory must be outside the local subject repository.`
    );
    for (const text of [mutated, cleanup]) {
      expect(text).not.toContain("Private.ts");
      expect(text).not.toContain("raw Error text");
    }
    expect(RETRIEVAL_QUERY_STRATEGY_UNEXPECTED_EXTERNAL_FAILURE_MESSAGE).toBe(
      "Local subject retrieval-query-strategy comparison failed (EXECUTION_FAILED): execution failed before completing (details withheld)."
    );
  });
});
