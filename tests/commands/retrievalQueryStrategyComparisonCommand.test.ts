import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRunExperimentArgs, runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { runExperimentDescribeCommandFromArgs } from "../../src/commands/runExperimentDescribeCommand.js";
import { runExperimentListCommandFromArgs } from "../../src/commands/runExperimentListCommand.js";
import { renderExperimentRunHelp } from "../../src/cli/help.js";
import { RETRIEVAL_QUERY_STRATEGY_IDS } from "../../src/evaluation/retrievalQueryStrategies.js";
import { createDefaultExperimentPluginRegistry } from "../../src/experiments/index.js";
import { createLabExecutionContext } from "../../src/runtime/index.js";
import { git, makeTempDir, removeTempDir } from "../evaluation/localRepositorySubject/fixtureRepository.js";
import { listTree } from "../experiments/contextWindowScaling/localSubjectFixture.js";
import type { LocalSubjectFixture } from "../experiments/contextWindowScaling/localSubjectFixture.js";
import { createRprLocalSubjectFixture, readKitLog, RPR_MARKERS, rprLocalSubjectCases, writeUpstreamShapedKit } from "../experiments/retrievalPrecisionRecall/localSubjectFixture.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const ID = "retrieval-query-strategy-comparison";
const KIT_ENV = ["RPR_KIT_LOG", "RPR_KIT_FILES", "RPR_KIT_SYMBOLS", "RPR_KIT_DATA_MODEL_ENTITY", "RPR_KIT_DATA_MODEL_FIELD", "RPR_KIT_INDEX_FAIL"];
const SEVEN = [...RETRIEVAL_QUERY_STRATEGY_IDS];

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
  return { stdout: () => out.join("\n"), stderr: () => err.join("\n") };
}

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const name of KIT_ENV) delete process.env[name];
  for (const directory of dirs.splice(0)) removeTempDir(directory);
});

describe("registry, list and describe", () => {
  it("TST-081-108 registers the plugin exactly once, preserving earlier order (v0.8.2 appends context-pack-generation after it)", () => {
    const ids = createDefaultExperimentPluginRegistry().list().map((plugin) => plugin.id);
    expect(ids).toEqual([
      "context-strategy-comparison",
      "warm-index-reuse",
      "incremental-change-staleness",
      "context-window-scaling",
      "retrieval-precision-recall",
      ID,
      "context-pack-generation"
    ]);
    expect(ids.filter((id) => id === ID)).toHaveLength(1);
  });

  it("TST-081-109 lists and describes the exact public contract", async () => {
    const listOutput = capture();
    expect(await runExperimentListCommandFromArgs(["--json"])).toBe(0);
    const entry = JSON.parse(listOutput.stdout()).experiments.find((candidate: { id: string }) => candidate.id === ID);
    expect(entry).toMatchObject({
      id: ID,
      status: "experimental",
      schemaVersion: "1.0.0",
      supportedTargets: ["self", "external-local"],
      supportedOutputs: ["json", "html", "text", "artifact"],
      supportedVariants: SEVEN
    });
    vi.restoreAllMocks();
    const describeOutput = capture();
    expect(await runExperimentDescribeCommandFromArgs(["--experiment", ID, "--json"])).toBe(0);
    const description = JSON.parse(describeOutput.stdout());
    expect(description.metadata.supportedOutputs).toEqual(["json", "html", "text", "artifact"]);
    expect(description.supportedVariants).toEqual(SEVEN);
    expect(description.requiredConfigFields.map((field: { name: string }) => field.name)).toEqual(["outDir"]);
    expect(description.optionalConfigFields.map((field: { name: string }) => field.name)).toEqual(["kitCommand", "caseIds", "benchmarkProjects"]);
    expect(JSON.stringify(description)).not.toMatch(/"strategies"|--strategies/);
    expect(description.targetBehavior).toBe(
      "Two subject modes. Bundled (default): the frozen 12-case warm-index corpus compares all seven retrieval query strategies and may be narrowed with --case and --benchmark-project. External local repository: an explicitly selected local Git worktree via --target <path> together with --local-subject-config <path>; the local-subject config owns the case set, one private base index is built per configured case, core strategies share that base, semantic strategies use isolated copies, the repository is never modified, and durable output withholds private file, symbol, fact, semantic-node, warning and case-title identities while preserving numeric scientific results. Bundled filters are not accepted in external-local mode."
    );
    expect(description.examples).toEqual(
      expect.arrayContaining([
        `my-dev-kit-lab experiment run --experiment ${ID} --case <case-id> --out <run-dir>`,
        `my-dev-kit-lab experiment run --experiment ${ID} --target <local-git-repository> --local-subject-config <path-to-local-subject-config.json> --out <run-dir-outside-the-repository>`
      ])
    );
  });
});

describe("argument contract", () => {
  it("TST-081-110 accepts exactly the bundled flags and rejects everything else", () => {
    const parsed = parseRunExperimentArgs(["--experiment", ID, "--out", "d", "--case", "a,b", "--case", "c", "--benchmark-project", "p", "--kit-command", "node kit.js"]);
    expect(parsed.experimentId).toBe(ID);
    expect(parsed.outDir).toBe("d");
    expect(parsed.targetPath).toBeUndefined();
    expect(parsed.config).toEqual({ caseIds: ["a", "b", "c"], benchmarkProjects: ["p"], kitCommand: "node kit.js" });
    expect(parseRunExperimentArgs(["--experiment", ID]).config).toEqual({});

    const supported = "supported options: --experiment, --out, --case, --benchmark-project, --kit-command.";
    for (const extra of [
      ["--strategies", "raw-full-file"],
      ["--agents", "fake-agent"],
      ["--complexities", "short"],
      ["--cases", "x.json"],
      ["--project-profiles", "x.json"],
      ["--synthetic-config", "x.json"],
      ["--context-budgets", "8k"],
      ["--campaign", "codex-full"],
      ["--timeout-ms", "10"]
    ]) {
      expect(() => parseRunExperimentArgs(["--experiment", ID, ...extra]), extra[0]).toThrow(supported);
    }
    expect(() => parseRunExperimentArgs(["--experiment", ID, "--strategy", "keyword-search"])).toThrow();
    expect(() => parseRunExperimentArgs(["--experiment", ID, "--target", "C:\\repo"])).toThrow(
      "External retrieval-query-strategy-comparison targets require --local-subject-config."
    );
    expect(() => parseRunExperimentArgs(["--experiment", ID, "--local-subject-config", "c.json"])).toThrow(
      "--local-subject-config requires an external --target for retrieval-query-strategy-comparison."
    );
    expect(() => parseRunExperimentArgs(["--experiment", ID, "--case", ","])).toThrow("--case must list at least one case id.");
    expect(() => parseRunExperimentArgs(["--experiment", ID, "--benchmark-project", ","])).toThrow("--benchmark-project must list at least one benchmark project id.");
  });

  it("TST-081-111 accepts exactly the external flags and rejects filters and unrelated flags", () => {
    const external = ["--experiment", ID, "--target", "C:\\repo", "--local-subject-config", "c.json", "--kit-command", "node kit.js", "--out", "o"];
    const parsed = parseRunExperimentArgs(external);
    expect(parsed.targetPath).toBe("C:\\repo");
    expect(parsed.localSubjectConfigPath).toBe("c.json");
    expect(parsed.config).toEqual({ kitCommand: "node kit.js" });
    const filterError = "--case and --benchmark-project cannot be combined with --local-subject-config; the local subject config owns the case set.";
    expect(() => parseRunExperimentArgs([...external, "--case", "a"])).toThrow(filterError);
    expect(() => parseRunExperimentArgs([...external, "--benchmark-project", "p"])).toThrow(filterError);
    expect(() => parseRunExperimentArgs([...external, "--strategies", "raw-full-file"])).toThrow(
      "supported options: --experiment, --out, --target, --local-subject-config, --kit-command."
    );
    expect(() => parseRunExperimentArgs(["--experiment", ID, "--local-subject-config", "c.json"])).toThrow("requires an external --target");
  });

  it("limits --local-subject-config and --kit-command to supporting plugins only", () => {
    expect(() => parseRunExperimentArgs(["--experiment", "warm-index-reuse", "--local-subject-config", "c.json"])).toThrow(
      "--local-subject-config is only supported for --experiment context-window-scaling, retrieval-precision-recall, retrieval-query-strategy-comparison, or context-pack-generation."
    );
    expect(() => parseRunExperimentArgs(["--experiment", "context-strategy-comparison", "--kit-command", "k"])).toThrow(
      "retrieval-precision-recall or retrieval-query-strategy-comparison or context-pack-generation."
    );
  });
});

describe("help", () => {
  it("TST-081-113 documents the plugin without advertising a strategy option", () => {
    const help = renderExperimentRunHelp();
    expect(help).toContain("retrieval-query-strategy-comparison only:");
    expect(help).toContain("my-dev-kit command override (warm-index-reuse, incremental-change-staleness, context-window-scaling, retrieval-precision-recall, retrieval-query-strategy-comparison, and context-pack-generation):");
    const start = help.indexOf("retrieval-query-strategy-comparison only:");
    const section = help.slice(start, help.indexOf("warm-index-reuse only:"));
    for (const phrase of ["seven retrieval", "no strategy", "option", "--local-subject-config", "Pareto front has a single member", "tradeoff", "No scalar score or total", "ranking exists"]) {
      expect(section.replace(/\s+/g, " "), phrase).toContain(phrase);
    }
    expect(section).not.toMatch(/--strateg(y|ies) </);
  });
});

describe("input loaders through the public run command", () => {
  let fixture: LocalSubjectFixture;
  let kitCommand = "";
  let logPath = "";
  let parent = "";

  beforeEach(async () => {
    parent = makeTempDir("rqs-cmd-");
    dirs.push(parent);
    kitCommand = writeUpstreamShapedKit(path.join(parent, "kit")).command;
    logPath = path.join(parent, "kit.log");
    process.env.RPR_KIT_LOG = logPath;
  });

  it("TST-081-112 bundled: resolves the packaged corpus, validates ground truth, runs seven treatments, ignores the cwd", async () => {
    process.env.RPR_KIT_DATA_MODEL_ENTITY = "task";
    const out = path.join(parent, "out");
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(
      ["--experiment", ID, "--case", "warm-medium-complete-idempotent", "--kit-command", kitCommand, "--out", out],
      { context: createLabExecutionContext({ invocationCwd: parent }) }
    );
    expect(output.stderr()).toBe("");
    expect(code).toBe(0);
    const execution = JSON.parse(readFileSync(path.join(out, "retrieval-query-strategy-comparison-execution.json"), "utf8"));
    expect(execution.cases).toHaveLength(1);
    expect(execution.cases[0].treatments.map((t: { strategyId: string }) => t.strategyId)).toEqual(SEVEN);
    expect(readdirSync(out)).toEqual(expect.arrayContaining(["retrieval-query-strategy-comparison-analysis.json", "report.json", "report.html", "report.txt"]));
    const calls = readKitLog(logPath).map((entry) => entry.argv[0]);
    expect(calls.filter((name) => name === "index")).toHaveLength(1);
    expect(calls.filter((name) => name === "data-model").length).toBeGreaterThan(0);
    const analysis = JSON.parse(readFileSync(path.join(out, "retrieval-query-strategy-comparison-analysis.json"), "utf8"));
    expect(analysis.analysis.scopes[0]).toMatchObject({ scopeId: "overall", caseCount: 1, comparisonCaseCount: 1, excludedCaseCount: 0 });
    expect(analysis.analysis.cases[0].treatments.map((t: { executionStatus: string }) => t.executionStatus)).toEqual(Array(7).fill("completed"));
    const report = JSON.parse(readFileSync(path.join(out, "report.json"), "utf8")).report;
    expect(report.retrievalQueryStrategyComparison.scopes.map((scope: { scopeId: string }) => scope.scopeId)).toEqual(["overall", "localized", "cross-module", "broad-change"]);
  });

  it("bundled: an unknown case fails cleanly without a durable family", async () => {
    const out = path.join(parent, "out");
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(["--experiment", ID, "--case", "no-such-case", "--kit-command", kitCommand, "--out", out], {
      context: createLabExecutionContext({ invocationCwd: parent })
    });
    expect(code).not.toBe(0);
    expect(existsSync(path.join(out, "retrieval-query-strategy-comparison-analysis.json"))).toBe(false);
    expect(output.stdout()).toContain("Status: failed");
  });

  it("TST-081-112 external: uses the LocalRepositorySubject, checks the work root first, preserves the case set", async () => {
    fixture = await createRprLocalSubjectFixture();
    dirs.push(...fixture.directories);
    const configPath = path.join(parent, "config", "local-subject.json");
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ schemaVersion: "1.0.0", subjectId: "rqs-subject", cases: rprLocalSubjectCases() }));
    process.env.RPR_KIT_FILES = "src/main.ts,src/util/helper.ts";
    process.env.RPR_KIT_SYMBOLS = `${RPR_MARKERS.symbol}@src/main.ts`;
    process.env.RPR_KIT_DATA_MODEL_ENTITY = "private";

    // Output inside the target is rejected before anything is created or indexed.
    const inside = path.join(fixture.root, "lab-out");
    const rejected = capture();
    const rejectedCode = await runExperimentRunCommandFromArgs(
      ["--experiment", ID, "--target", fixture.root, "--local-subject-config", configPath, "--kit-command", kitCommand, "--out", inside],
      { context: createLabExecutionContext({ invocationCwd: process.cwd() }) }
    );
    expect(rejectedCode).not.toBe(0);
    expect(rejected.stderr()).toContain("Experiment output root must not be inside the external target project.");
    expect(existsSync(inside)).toBe(false);
    expect(existsSync(logPath)).toBe(false);
    vi.restoreAllMocks();

    const treeBefore = listTree(fixture.root);
    const statusBefore = git(fixture.root, "status", "--porcelain=v1", "--ignored");
    const out = path.join(parent, "out", "run");
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(
      ["--experiment", ID, "--target", fixture.root, "--local-subject-config", configPath, "--kit-command", kitCommand, "--out", out],
      { context: createLabExecutionContext({ invocationCwd: process.cwd() }) }
    );
    expect(output.stderr()).toBe("");
    expect(code).toBe(0);
    expect(output.stdout()).toContain("Mode: external-local repository subject");
    expect(listTree(fixture.root)).toEqual(treeBefore);
    expect(git(fixture.root, "status", "--porcelain=v1", "--ignored")).toBe(statusBefore);
    const execution = JSON.parse(readFileSync(path.join(out, "retrieval-query-strategy-comparison-execution.json"), "utf8"));
    expect(execution.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(["rpr-case-one", "rpr-case-two"]);
    expect(execution.cases.every((entry: { identityRedaction: unknown }) => entry.identityRedaction !== undefined)).toBe(true);
    expect(readdirSync(out).sort()).toEqual([
      "local-repository-subject-manifest.json",
      "report.html",
      "report.json",
      "report.txt",
      "retrieval-query-strategy-comparison-analysis.json",
      "retrieval-query-strategy-comparison-execution.json"
    ]);
    // One base index per configured case: exactly two index invocations.
    expect(readKitLog(logPath).filter((entry) => entry.argv[0] === "index")).toHaveLength(2);
    const serialized = readdirSync(out).map((name) => readFileSync(path.join(out, name), "utf8")).join("\n");
    for (const forbidden of [fixture.root, out, RPR_MARKERS.title, RPR_MARKERS.symbol, "src/main.ts", "helper.ts"]) expect(serialized.includes(forbidden), forbidden).toBe(false);
  });

  it("external: rejects incomplete ground truth naming only case ids and counts", async () => {
    const broken = rprLocalSubjectCases();
    delete (broken[0].answerKey as { expectedContextTargets?: unknown }).expectedContextTargets;
    fixture = await createRprLocalSubjectFixture({ cases: broken });
    dirs.push(...fixture.directories);
    const configPath = path.join(parent, "config.json");
    writeFileSync(configPath, JSON.stringify({ schemaVersion: "1.0.0", subjectId: "rqs-subject", cases: broken }));
    const out = path.join(parent, "out");
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(
      ["--experiment", ID, "--target", fixture.root, "--local-subject-config", configPath, "--kit-command", kitCommand, "--out", out],
      { context: createLabExecutionContext({ invocationCwd: process.cwd() }) }
    );
    expect(code).not.toBe(0);
    expect(output.stderr()).toMatch(/Invalid retrieval-query-strategy-comparison ground truth for the local subject \(case rpr-case-one: \d+ issues?\); details withheld\./);
    expect(output.stderr()).not.toContain(RPR_MARKERS.fact);
    expect(existsSync(out)).toBe(false);
  });
});
