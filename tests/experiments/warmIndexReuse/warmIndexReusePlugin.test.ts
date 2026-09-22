import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EvaluationCase } from "../../../src/evaluation/types.js";
import {
  contextStrategyComparisonPlugin,
  createDefaultExperimentPluginRegistry,
  runExperiment,
} from "../../../src/experiments/index.js";
import {
  defaultWarmIndexReuseConfig,
  groupWarmIndexCases,
  selectWarmIndexCases,
  validateWarmIndexReuseConfig,
  warmIndexReusePlugin,
  type WarmIndexExecutionArtifactV1,
  type WarmIndexReuseRun,
} from "../../../src/experiments/plugins/warmIndexReuse/index.js";
import {
  fakeKitCommand,
  findFiles,
  loadBundledProjectProfiles,
  loadProductionWarmIndexCases,
  makeCase,
  makeCases,
  writeFakeKitVariant,
} from "./warmIndexTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tempDir(prefix = "warm-plugin-"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function runWarm(
  cases: EvaluationCase[],
  kitCommand = fakeKitCommand,
  extraConfig: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = {}
) {
  const outputRoot = tempDir();
  const run = (await runExperiment({
    pluginId: "warm-index-reuse",
    registry: createDefaultExperimentPluginRegistry(),
    outputRoot,
    config: { kitCommand, ...extraConfig },
    inputs: { cases, projectProfiles: await loadBundledProjectProfiles(), env },
    toolRoot: process.cwd(),
    runId: "warm-test-run",
  })) as WarmIndexReuseRun;
  const artifactPath = path.join(outputRoot, "warm-index-execution.json");
  const artifactText = existsSync(artifactPath) ? readFileSync(artifactPath, "utf8") : "";
  const artifact = artifactText ? (JSON.parse(artifactText) as WarmIndexExecutionArtifactV1) : undefined;
  return { run, outputRoot, artifact, artifactText };
}

function argAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe("warm-index-reuse registration and config", () => {
  it("is registered next to the unchanged context-strategy-comparison plugin", () => {
    const registry = createDefaultExperimentPluginRegistry();
    expect(registry.list().map((metadata) => metadata.id)).toEqual(["context-strategy-comparison", "warm-index-reuse"]);
    expect(registry.get("context-strategy-comparison")).toBe(contextStrategyComparisonPlugin);
    expect(registry.get("warm-index-reuse")).toBe(warmIndexReusePlugin);
  });

  it("declares experimental metadata, targets, outputs, variants, and bundled defaults", () => {
    expect(warmIndexReusePlugin.metadata).toEqual(
      expect.objectContaining({
        id: "warm-index-reuse",
        name: "Warm Index Reuse",
        status: "experimental",
        supportedTargets: ["self", "external-local"],
        supportedOutputs: ["json", "html", "text", "plot", "artifact"],
      })
    );
    expect(warmIndexReusePlugin.supportedVariants).toEqual(["raw-full-file", "warm-index-reuse"]);
    expect(defaultWarmIndexReuseConfig).toEqual({
      casesPath: "examples/token-savings-cases.json",
      projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
      outDir: "lab-output/warm-index-reuse",
      kitCommand: "npx @dailephd/my-dev-kit@latest",
    });
    expect(warmIndexReusePlugin.configDefinition?.fields.map((field) => field.name)).toEqual([
      "casesPath",
      "outDir",
      "projectProfilesPath",
      "kitCommand",
      "caseIds",
      "benchmarkProjects",
    ]);
  });

  it("accepts its supported fields and rejects agent-matrix fields and malformed values", () => {
    const valid = validateWarmIndexReuseConfig({ kitCommand: "kit", caseIds: ["a"], benchmarkProjects: ["todo-ts"] });
    expect(valid.valid).toBe(true);
    expect(valid.config?.kitCommand).toBe("kit");

    for (const field of ["agents", "strategies", "complexityLevels", "timeoutMs", "maxRuns", "commandTemplates", "includeRealAgents", "requireAgents"]) {
      const result = validateWarmIndexReuseConfig({ [field]: ["x"] });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toContain(`Unsupported warm-index-reuse config field(s): ${field}`);
    }
    expect(validateWarmIndexReuseConfig("nope").valid).toBe(false);
    expect(validateWarmIndexReuseConfig({ kitCommand: "  " }).valid).toBe(false);
    expect(validateWarmIndexReuseConfig({ caseIds: [] }).valid).toBe(false);
    expect(validateWarmIndexReuseConfig({ benchmarkProjects: [1] }).valid).toBe(false);
  });
});

describe("warm-index-reuse case selection and grouping", () => {
  const cases = [
    makeCase({ id: "b-ts" }),
    makeCase({ id: "a-js", benchmarkProject: "todo-js" }),
    makeCase({ id: "c-ts" }),
  ];

  it("keeps source order and applies case and benchmark-project filters", () => {
    expect(selectWarmIndexCases(cases, {}).map((c) => c.id)).toEqual(["b-ts", "a-js", "c-ts"]);
    expect(selectWarmIndexCases(cases, { caseIds: ["c-ts", "b-ts"] }).map((c) => c.id)).toEqual(["b-ts", "c-ts"]);
    expect(selectWarmIndexCases(cases, { benchmarkProjects: ["todo-ts"] }).map((c) => c.id)).toEqual(["b-ts", "c-ts"]);
    expect(
      selectWarmIndexCases(cases, { caseIds: ["a-js", "c-ts"], benchmarkProjects: ["todo-ts"] }).map((c) => c.id)
    ).toEqual(["c-ts"]);
  });

  it("fails clearly for unknown IDs and for an empty selection", () => {
    expect(() => selectWarmIndexCases(cases, { caseIds: ["missing"] })).toThrow("Evaluation case not found: missing");
    expect(() => selectWarmIndexCases(cases, { benchmarkProjects: ["nope"] })).toThrow("Benchmark project not found: nope");
    expect(() => selectWarmIndexCases(cases, { caseIds: ["a-js"], benchmarkProjects: ["todo-ts"] })).toThrow(
      "No evaluation cases matched"
    );
  });

  it("groups by benchmark project in first-seen order and keeps task order", () => {
    const groups = groupWarmIndexCases(cases);
    expect(groups.map((group) => [group.benchmarkProject, group.cases.map((c) => c.id)])).toEqual([
      ["todo-ts", ["b-ts", "c-ts"]],
      ["todo-js", ["a-js"]],
    ]);
    expect(groups.every((group) => group.structuralErrors.length === 0)).toBe(true);
  });

  it("marks a project whose cases disagree on target or source roots as structurally invalid", () => {
    const [group] = groupWarmIndexCases([
      makeCase({ id: "one" }),
      makeCase({ id: "two", sourceRoots: ["tests", "src"] }),
      makeCase({ id: "three", absoluteTargetRoot: path.resolve(process.cwd(), "benchmarks/projects/todo-js") }),
    ]);
    expect(group.structuralErrors).toHaveLength(2);
    expect(group.structuralErrors[0]).toContain("source roots");
    expect(group.structuralErrors[1]).toContain("target root");
  });

  it("rejects project IDs that cannot form a safe output path segment", () => {
    expect(() => groupWarmIndexCases([makeCase({ id: "x", benchmarkProject: ".." })])).toThrow("Unsafe benchmark project ID");
    expect(() =>
      groupWarmIndexCases([makeCase({ id: "x", benchmarkProject: "a/b" }), makeCase({ id: "y", benchmarkProject: "a-b" })])
    ).toThrow("map to the same output path segment");
  });
});

describe("warm-index-reuse execution", () => {
  it("builds one index per benchmark project and reuses it for every task in that project", async () => {
    const { run, outputRoot, artifact } = await runWarm([makeCase({ id: "task-a" }), makeCase({ id: "task-b" })]);

    expect(run.status).toBe("completed");
    expect(findFiles(outputRoot, "index.telemetry.json")).toEqual(["commands/todo-ts/index/index.telemetry.json"]);
    const [project] = artifact!.projects;
    expect(project.sessionPrepared).toBe(true);
    expect(project.indexDir).toBe(path.join(outputRoot, "indexes", "todo-ts"));
    expect(project.indexCommand?.commandId).toBe("index");
    expect(project.tasks.map((task) => task.caseId)).toEqual(["task-a", "task-b"]);

    for (const task of project.tasks) {
      expect(task.rawBaseline?.totalFiles).toBeGreaterThan(0);
      const commands = task.warmRetrieval!.commands;
      expect(commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source"]);
      for (const command of commands) {
        const recorded = JSON.parse(readFileSync(command.telemetryPath, "utf8")) as { args: string[] };
        expect(recorded.args).not.toContain("index");
        expect(argAfter(recorded.args, "--index")).toBe(project.indexDir);
      }
    }
    expect(findFiles(outputRoot, "search.telemetry.json")).toEqual([
      "commands/todo-ts/task-a/search.telemetry.json",
      "commands/todo-ts/task-b/search.telemetry.json",
    ]);
  });

  it("isolates project groups: one index each, first-seen project order, own session per task", async () => {
    const { run, outputRoot, artifact } = await runWarm([
      makeCase({ id: "ts-1" }),
      makeCase({ id: "js-1", benchmarkProject: "todo-js" }),
      makeCase({ id: "ts-2" }),
    ]);

    expect(findFiles(outputRoot, "index.telemetry.json")).toEqual([
      "commands/todo-js/index/index.telemetry.json",
      "commands/todo-ts/index/index.telemetry.json",
    ]);
    expect(artifact!.projects.map((project) => [project.benchmarkProject, project.tasks.map((task) => task.caseId)])).toEqual([
      ["todo-ts", ["ts-1", "ts-2"]],
      ["todo-js", ["js-1"]],
    ]);
    for (const project of artifact!.projects) {
      for (const task of project.tasks) {
        const search = task.warmRetrieval!.commands[0];
        const recorded = JSON.parse(readFileSync(search.telemetryPath, "utf8")) as { args: string[] };
        expect(argAfter(recorded.args, "--index")).toBe(project.indexDir);
      }
    }
    expect(run.cases.map((experimentCase) => experimentCase.id)).toEqual(["ts-1", "ts-2", "js-1"]);
    expect(run.cases.find((c) => c.id === "js-1")?.metadata).toEqual({ benchmarkProject: "todo-js", sessionKey: "todo-js" });
  });

  it("maps every task to a raw-full-file then warm-index-reuse outcome with measured metrics and no comparison claims", async () => {
    const { run, artifactText } = await runWarm([makeCase({ id: "task-a" }), makeCase({ id: "task-b" })]);

    expect(run.variants.map((variant) => variant.id)).toEqual(["raw-full-file", "warm-index-reuse"]);
    for (const experimentCase of run.cases) {
      expect(experimentCase.outcomes.map((outcome) => outcome.variantId)).toEqual(["raw-full-file", "warm-index-reuse"]);
      expect(experimentCase.outcomes.map((outcome) => outcome.status)).toEqual(["completed", "completed"]);
      const [raw, warm] = experimentCase.outcomes;
      expect(raw.metrics.map((metric) => metric.id)).toEqual([
        "context-character-count",
        "context-estimated-token-count",
        "operation-duration-ms",
        "cumulative-component-duration-ms",
        "cumulative-context-estimated-token-count",
        "agent-correctness-score",
        "agent-total-tokens",
        "cumulative-agent-total-tokens",
      ]);
      expect(warm.metrics.map((metric) => metric.id)).toEqual([
        "context-character-count",
        "context-estimated-token-count",
        "operation-duration-ms",
        "cumulative-component-duration-ms",
        "cumulative-context-estimated-token-count",
        "amortized-index-build-duration-ms",
        "agent-correctness-score",
        "agent-total-tokens",
        "cumulative-agent-total-tokens",
      ]);
      for (const outcome of experimentCase.outcomes) {
        expect(outcome.metadata).toEqual({
          benchmarkProject: "todo-ts",
          sessionKey: "todo-ts",
          warmSessionAvailable: true,
          taskStatus: "completed",
          agentStatus: "completed",
        });
      }
    }
    expect(run.metrics.map((metric) => [metric.id, metric.value])).toEqual([
      ["warm-index-project-count", 1],
      ["warm-index-task-count", 2],
      ["warm-index-session-prepared-project-count", 1],
    ]);
    expect(run.summary).toEqual(expect.objectContaining({ status: "completed", totalCases: 2, completedCases: 2 }));
    expect(`${artifactText}${JSON.stringify(run)}`).not.toMatch(/breakEven|break-even|savings|speedup|winner/i);
    // Metrics stay on the run and report, not in the execution artifact (schema v1 unchanged).
    expect(artifactText).not.toMatch(/amortiz|cumulative/i);
  });

  it("keeps raw evidence and records failed warm outcomes when one project's index fails, without affecting other projects", async () => {
    const kitCommand = writeFakeKitVariant(tempDir("warm-kit-"), { failIndexWhenOutContains: "indexes/todo-js" });
    const { run, outputRoot, artifact } = await runWarm(
      [makeCase({ id: "ts-1" }), makeCase({ id: "js-1", benchmarkProject: "todo-js" }), makeCase({ id: "js-2", benchmarkProject: "todo-js" })],
      kitCommand
    );

    expect(run.status).toBe("partial");
    expect(findFiles(outputRoot, "index.telemetry.json")).toHaveLength(2);
    expect(findFiles(outputRoot, "search.telemetry.json")).toEqual(["commands/todo-ts/ts-1/search.telemetry.json"]);

    const jsProject = artifact!.projects.find((project) => project.benchmarkProject === "todo-js")!;
    expect(jsProject.sessionPrepared).toBe(false);
    expect(jsProject.indexCommand?.ok).toBe(false);
    expect(jsProject.status).toBe("partial");
    for (const caseId of ["js-1", "js-2"]) {
      const experimentCase = run.cases.find((c) => c.id === caseId)!;
      const [raw, warm] = experimentCase.outcomes;
      expect(raw.status).toBe("completed");
      expect(warm.status).toBe("failed");
      expect(warm.failures.map((failure) => failure.code)).toEqual(["warm-index-setup-failed"]);
      expect(warm.metadata?.warmSessionAvailable).toBe(false);
    }
    expect(run.cases.find((c) => c.id === "ts-1")!.outcomes.map((o) => o.status)).toEqual(["completed", "completed"]);
    expect(run.warnings.map((warning) => warning.code)).toContain("warm-index-setup-warning");
  });

  it("runs the raw baseline and warm retrieval independently when the raw side fails", async () => {
    const { run } = await runWarm([
      makeCase({ id: "ghost-1", benchmarkProject: "ghost", absoluteTargetRoot: path.join(tempDir("ghost-"), "missing") }),
    ]);
    const [raw, warm] = run.cases[0].outcomes;
    expect(raw.status).toBe("failed");
    expect(raw.failures[0].code).toBe("raw-baseline-failed");
    expect(warm.status).toBe("completed");
    expect(run.status).toBe("partial");
  });

  it("fails a structurally inconsistent project without indexing or retrieving, keeping raw outcomes", async () => {
    const { run, outputRoot, artifact } = await runWarm([
      makeCase({ id: "ok-roots" }),
      makeCase({ id: "other-roots", sourceRoots: ["src"] }),
    ]);
    expect(findFiles(outputRoot, "index.telemetry.json")).toEqual([]);
    expect(findFiles(outputRoot, "search.telemetry.json")).toEqual([]);
    expect(artifact!.projects[0].indexCommand).toBeNull();
    expect(artifact!.projects[0].errors[0]).toContain("source roots");
    for (const experimentCase of run.cases) {
      const [raw, warm] = experimentCase.outcomes;
      expect(raw.status).toBe("completed");
      expect(warm.status).toBe("failed");
      expect(warm.failures[0].code).toBe("warm-index-group-inconsistent");
    }
  });

  it("marks a retrieval without usable context as skipped and preserves its warnings", async () => {
    const kitCommand = writeFakeKitVariant(tempDir("warm-kit-"), { emptySearch: true });
    const { run } = await runWarm([makeCase({ id: "task-a" })], kitCommand);
    const warm = run.cases[0].outcomes[1];
    expect(warm.status).toBe("skipped");
    expect(warm.failures).toEqual([]);
    expect(warm.warnings.map((warning) => warning.message)).toEqual(["No my-dev-kit search candidate was found."]);
  });

  it("marks a retrieval whose command fails as failed rather than skipped and continues later tasks", async () => {
    const kitCommand = writeFakeKitVariant(tempDir("warm-kit-"), { failOn: "search" });
    const { run, artifact } = await runWarm([makeCase({ id: "task-a" }), makeCase({ id: "task-b" })], kitCommand);
    for (const experimentCase of run.cases) {
      const [raw, warm] = experimentCase.outcomes;
      expect(raw.status).toBe("completed");
      expect(warm.status).toBe("failed");
      expect(warm.failures[0].code).toBe("warm-retrieval-failed");
    }
    expect(artifact!.projects[0].tasks[1].warmRetrieval?.commands.map((c) => [c.commandId, c.ok])).toEqual([["search", false]]);
  });

  it("persists a bounded execution artifact without context text", async () => {
    const { run, artifact, artifactText } = await runWarm([makeCase({ id: "task-a" })]);
    expect(artifact!.schemaVersion).toBe("my-dev-kit-lab-warm-index-execution-v1");
    expect(artifact!.runId).toBe("warm-test-run");
    expect(artifactText).not.toContain("contextText");
    expect(artifactText).not.toContain("createTask(title: string)");
    expect(artifactText).not.toContain('"stdout":');
    const task = artifact!.projects[0].tasks[0];
    expect(Object.keys(task.warmRetrieval!.commands[0]).sort()).toEqual(
      ["commandId", "durationMs", "error", "exitCode", "ok", "stderrPath", "stdoutPath", "telemetryPath"]
    );
    expect(artifact!.projects[0].buildDurationMs).toEqual(expect.any(Number));
    expect(JSON.stringify(run)).not.toContain("contextText");
    expect(run.artifacts[0]).toEqual(expect.objectContaining({ id: "warm-index-execution", kind: "artifact" }));
  });
});

const MEDIUM_PROJECT = "task-workflow-medium-ts";
const LARGE_PROJECT = "task-analytics-large-mixed";
const MEDIUM_ORDER = [
  "warm-medium-import-dedupe",
  "warm-medium-create-project-task",
  "warm-medium-complete-idempotent",
  "warm-medium-composite-filter",
  "warm-medium-project-summary",
  "warm-medium-broad-workflow-map",
];
const LARGE_ORDER = [
  "warm-large-health-label",
  "warm-large-ts-analytics-snapshot",
  "warm-large-ts-leaderboard",
  "warm-large-python-parser-metrics",
  "warm-large-python-pipeline",
  "warm-large-broad-analytics-comparison",
];

function recordedArgs(telemetryPath: string): string[] {
  return (JSON.parse(readFileSync(telemetryPath, "utf8")) as { args: string[] }).args;
}

describe("warm-index-reuse expanded v0.5.1 suite runtime", () => {
  it("reuses exactly one index for six tasks in one project", async () => {
    const { run, outputRoot, artifact } = await runWarm(makeCases(6));

    expect(run.status).toBe("completed");
    expect(findFiles(outputRoot, "index.telemetry.json")).toEqual(["commands/todo-ts/index/index.telemetry.json"]);
    const [project] = artifact!.projects;
    expect(project.tasks.map((task) => task.caseId)).toEqual(["task-1", "task-2", "task-3", "task-4", "task-5", "task-6"]);
    expect(findFiles(outputRoot, "search.telemetry.json")).toEqual(
      project.tasks.map((task) => `commands/todo-ts/${task.caseId}/search.telemetry.json`)
    );
    for (const task of project.tasks) {
      expect(task.rawStatus).toBe("completed");
      expect(task.rawBaseline?.totalFiles).toBeGreaterThan(0);
      expect(task.warmRetrieval!.commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source"]);
      for (const command of task.warmRetrieval!.commands) {
        const args = recordedArgs(command.telemetryPath);
        expect(args).not.toContain("index");
        expect(argAfter(args, "--index")).toBe(project.indexDir);
      }
    }
    expect(run.warmIndexMetrics.projects[0].tasks.map((task) => task.taskOrdinal)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("executes the real 12-case production corpus as two six-task projects with one index each", async () => {
    const cases = await loadProductionWarmIndexCases();
    expect(cases).toHaveLength(12);
    const { run, outputRoot, artifact, artifactText } = await runWarm(cases);

    expect(run.status).toBe("completed");
    expect(artifact!.projects.map((project) => [project.benchmarkProject, project.tasks.map((task) => task.caseId)])).toEqual([
      [MEDIUM_PROJECT, MEDIUM_ORDER],
      [LARGE_PROJECT, LARGE_ORDER],
    ]);
    expect(run.cases.map((experimentCase) => experimentCase.id)).toEqual([...MEDIUM_ORDER, ...LARGE_ORDER]);
    expect(findFiles(outputRoot, "index.telemetry.json")).toEqual([
      `commands/${LARGE_PROJECT}/index/index.telemetry.json`,
      `commands/${MEDIUM_PROJECT}/index/index.telemetry.json`,
    ]);
    expect(findFiles(outputRoot, "search.telemetry.json")).toHaveLength(12);

    for (const project of artifact!.projects) {
      expect(project.status).toBe("completed");
      expect(project.sessionPrepared).toBe(true);
      expect(project.indexCommand?.commandId).toBe("index");
      expect(argAfter(recordedArgs(project.indexCommand!.telemetryPath), "--out")).toBe(project.indexDir);
      for (const task of project.tasks) {
        // Exactly one raw baseline and one warm retrieval per task, against the project's shared index.
        expect(task.rawStatus).toBe("completed");
        expect(task.rawBaseline?.totalFiles).toBeGreaterThan(0);
        expect(task.warmStatus).toBe("completed");
        expect(task.warmRetrieval!.commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source"]);
        for (const command of task.warmRetrieval!.commands) {
          const args = recordedArgs(command.telemetryPath);
          expect(args).not.toContain("index");
          expect(argAfter(args, "--index")).toBe(project.indexDir);
        }
      }
    }
    for (const experimentCase of run.cases) {
      expect(experimentCase.outcomes.map((outcome) => [outcome.variantId, outcome.status])).toEqual([
        ["raw-full-file", "completed"],
        ["warm-index-reuse", "completed"],
      ]);
    }
    expect(run.metrics.map((metric) => [metric.id, metric.value])).toEqual([
      ["warm-index-project-count", 2],
      ["warm-index-task-count", 12],
      ["warm-index-session-prepared-project-count", 2],
    ]);

    // All 24 fake-agent sides are evaluated once and scoreable under normal fake-agent operation.
    const sides = run.agentEvidence.flatMap((project) => project.tasks.flatMap((task) => [task.raw, task.warm]));
    expect(sides).toHaveLength(24);
    for (const side of sides) {
      expect(side?.status).toBe("completed");
      expect(side?.correctness.available).toBe(true);
      expect(side?.tokenUsage.totalTokens).toEqual(expect.any(Number));
    }

    // Every task maps to its own output segment; no collisions across 12 tasks.
    const taskSegments = findFiles(outputRoot, "search.telemetry.json").map((file) => file.split("/").slice(1, 3).join("/"));
    expect(new Set(taskSegments).size).toBe(12);
    expect(findFiles(outputRoot, "agent-run-result.json")).toHaveLength(24);

    // Bounded artifact: schema unchanged, no context text, command bodies, prompts, or answers.
    expect(artifact!.schemaVersion).toBe("my-dev-kit-lab-warm-index-execution-v1");
    for (const forbidden of ["contextText", '"stdout":', '"stderr":', "promptText", "finalAnswerText", "source for unknown"]) {
      expect(artifactText).not.toContain(forbidden);
    }
    expect(artifactText).not.toContain(
      readFileSync(path.resolve(`benchmarks/projects/${MEDIUM_PROJECT}/src/services/importTasks.ts`), "utf8").split("\n")[9].trim()
    );
    expect(JSON.stringify(run)).not.toContain("contextText");

    // No comparison claims or fields in the expanded run.
    expect(`${artifactText}${JSON.stringify(run)}`).not.toMatch(/breakEven|break-even|savings|speedup|winner|best strategy|ranked first/i);
  }, 120_000);

  it("keeps later tasks running when exactly one task's warm retrieval fails", async () => {
    const kitCommand = writeFakeKitVariant(tempDir("warm-kit-"), { failSearchWhenQueryContains: "task-3" });
    const { run, outputRoot, artifact } = await runWarm(makeCases(6), kitCommand);

    expect(findFiles(outputRoot, "index.telemetry.json")).toHaveLength(1);
    const [project] = artifact!.projects;
    expect(project.tasks.map((task) => [task.caseId, task.rawStatus, task.warmStatus])).toEqual([
      ["task-1", "completed", "completed"],
      ["task-2", "completed", "completed"],
      ["task-3", "completed", "failed"],
      ["task-4", "completed", "completed"],
      ["task-5", "completed", "completed"],
      ["task-6", "completed", "completed"],
    ]);
    expect(project.tasks[2].warmRetrieval?.commands.map((command) => [command.commandId, command.ok])).toEqual([["search", false]]);
    for (const task of [project.tasks[3], project.tasks[4], project.tasks[5]]) {
      expect(task.warmRetrieval?.commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source"]);
    }
    expect(run.cases[2].outcomes[1].failures.map((failure) => failure.code)).toEqual(["warm-retrieval-failed"]);
    expect(project.status).toBe("partial");
    expect(run.status).toBe("partial");
  });

  it("isolates a failed project index from a six-task project that succeeds", async () => {
    const kitCommand = writeFakeKitVariant(tempDir("warm-kit-"), { failIndexWhenOutContains: "indexes/todo-js" });
    const { run, outputRoot, artifact } = await runWarm(
      [...makeCases(6, "ts"), ...makeCases(3, "js", { benchmarkProject: "todo-js" })],
      kitCommand
    );

    expect(findFiles(outputRoot, "index.telemetry.json")).toEqual([
      "commands/todo-js/index/index.telemetry.json",
      "commands/todo-ts/index/index.telemetry.json",
    ]);
    expect(findFiles(outputRoot, "search.telemetry.json")).toEqual(
      ["ts-1", "ts-2", "ts-3", "ts-4", "ts-5", "ts-6"].map((caseId) => `commands/todo-ts/${caseId}/search.telemetry.json`)
    );
    const [tsProject, jsProject] = artifact!.projects;
    expect(tsProject.status).toBe("completed");
    expect(tsProject.tasks.every((task) => task.warmStatus === "completed")).toBe(true);
    expect(jsProject.sessionPrepared).toBe(false);
    for (const task of jsProject.tasks) {
      expect(task.rawStatus).toBe("completed");
      expect(task.rawBaseline?.totalFiles).toBeGreaterThan(0);
      expect(task.warmRetrieval).toBeNull();
    }
    for (const caseId of ["js-1", "js-2", "js-3"]) {
      expect(run.cases.find((c) => c.id === caseId)!.outcomes[1].failures.map((failure) => failure.code)).toEqual([
        "warm-index-setup-failed",
      ]);
    }
    expect(run.warmIndexMetrics.projects[1].tasks.map((task) => task.taskOrdinal)).toEqual([1, 2, 3]);
    expect(run.status).toBe("partial");
  });

  it("selects the expanded corpus by benchmark project and by case ID without a new selector", async () => {
    const cases = await loadProductionWarmIndexCases();
    expect(selectWarmIndexCases(cases, { benchmarkProjects: [MEDIUM_PROJECT] }).map((c) => c.id)).toEqual(MEDIUM_ORDER);
    expect(selectWarmIndexCases(cases, { benchmarkProjects: [LARGE_PROJECT] }).map((c) => c.id)).toEqual(LARGE_ORDER);
    expect(selectWarmIndexCases(cases, { caseIds: ["warm-large-ts-leaderboard"] }).map((c) => c.id)).toEqual([
      "warm-large-ts-leaderboard",
    ]);
    expect(groupWarmIndexCases(cases).map((group) => [group.benchmarkProject, group.cases.length, group.structuralErrors])).toEqual([
      [MEDIUM_PROJECT, 6, []],
      [LARGE_PROJECT, 6, []],
    ]);
  });
});
