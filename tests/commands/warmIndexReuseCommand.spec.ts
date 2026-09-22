import { mkdtempSync, readFileSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runExperimentDescribeCommandFromArgs } from "../../src/commands/runExperimentDescribeCommand.js";
import { runExperimentListCommandFromArgs } from "../../src/commands/runExperimentListCommand.js";
import { parseRunExperimentArgs, runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import type { WarmIndexExecutionArtifactV1 } from "../../src/experiments/plugins/warmIndexReuse/index.js";
import { runLabCli } from "../../src/cli/index.js";
import type { WarmIndexReuseReportV1 } from "../../src/report/index.js";
import { fakeKitCommand, multiTaskCasesPath } from "../experiments/warmIndexReuse/warmIndexTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function captureConsole() {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  return {
    stdout: () => log.mock.calls.map((call) => call.join(" ")).join("\n"),
    stderr: () => error.mock.calls.map((call) => call.join(" ")).join("\n"),
  };
}

describe("experiment run --kit-command", () => {
  it("passes --kit-command unchanged to the warm-index-reuse config", () => {
    const parsed = parseRunExperimentArgs([
      "--experiment",
      "warm-index-reuse",
      "--kit-command",
      "npx @dailephd/my-dev-kit@latest",
      "--case",
      "a,b",
      "--benchmark-project",
      "todo-ts",
    ]);
    expect(parsed.config).toEqual({
      kitCommand: "npx @dailephd/my-dev-kit@latest",
      caseIds: ["a", "b"],
      benchmarkProjects: ["todo-ts"],
    });
  });

  it("rejects --kit-command for context-strategy-comparison and a missing value", () => {
    expect(() =>
      parseRunExperimentArgs(["--experiment", "context-strategy-comparison", "--kit-command", "kit"])
    ).toThrow("--kit-command is only supported for --experiment warm-index-reuse.");
    expect(() => parseRunExperimentArgs(["--experiment", "warm-index-reuse", "--kit-command"])).toThrow(
      "--kit-command requires a value."
    );
  });

  it("leaves context-strategy-comparison parsing unchanged", () => {
    const parsed = parseRunExperimentArgs(["--experiment", "context-strategy-comparison", "--agents", "fake-agent"]);
    expect(parsed.config).toEqual({ agents: ["fake-agent"] });
  });

  it("rejects agent-matrix options for warm-index-reuse instead of ignoring them", async () => {
    const output = captureConsole();
    const exitCode = await runExperimentRunCommandFromArgs([
      "--experiment",
      "warm-index-reuse",
      "--kit-command",
      fakeKitCommand,
      "--agents",
      "fake-agent",
    ]);
    expect(exitCode).toBe(1);
    expect(output.stderr()).toContain("Unsupported warm-index-reuse config field(s): agents");
  });
});

describe("experiment run --experiment warm-index-reuse", () => {
  it("runs through the generic experiment command owner and writes bounded artifacts and reports", async () => {
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-command-"));
    tempDirs.push(outRoot);
    const output = captureConsole();

    const exitCode = await runExperimentRunCommandFromArgs([
      "--experiment",
      "warm-index-reuse",
      "--kit-command",
      fakeKitCommand,
      "--cases",
      multiTaskCasesPath,
      "--project-profiles",
      "benchmarks/contracts/benchmark-project-profiles.json",
      "--benchmark-project",
      "todo-ts",
      "--out",
      outRoot,
    ]);

    expect(output.stderr()).toBe("");
    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain("Experiment: warm-index-reuse");
    expect(output.stdout()).toContain("Status: completed");

    const artifact = JSON.parse(
      readFileSync(path.join(outRoot, "warm-index-execution.json"), "utf8")
    ) as WarmIndexExecutionArtifactV1;
    expect(artifact.projects.map((project) => project.benchmarkProject)).toEqual(["todo-ts"]);
    expect(artifact.projects[0].tasks.map((task) => task.caseId)).toEqual([
      "warm-todo-ts-create-task",
      "warm-todo-ts-complete-task",
    ]);

    const reportText = readFileSync(path.join(outRoot, "report.json"), "utf8");
    expect(reportText).not.toContain("contextText");
    const report = JSON.parse(reportText) as { report: { cases: unknown[]; rawRun: { projectExecutions: unknown[] } } };
    expect(report.report.cases).toHaveLength(2);
    expect(report.report.rawRun.projectExecutions).toHaveLength(1);
    await expect(stat(path.join(outRoot, "report.html"))).resolves.toBeTruthy();
  });

  it("fails cleanly when the requested case does not exist", async () => {
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-command-"));
    tempDirs.push(outRoot);
    const output = captureConsole();
    const exitCode = await runExperimentRunCommandFromArgs([
      "--experiment",
      "warm-index-reuse",
      "--kit-command",
      fakeKitCommand,
      "--cases",
      multiTaskCasesPath,
      "--case",
      "does-not-exist",
      "--out",
      outRoot,
    ]);
    expect(exitCode).toBe(1);
    expect(output.stdout()).toContain("Status: failed");
    const report = JSON.parse(readFileSync(path.join(outRoot, "report.json"), "utf8")) as {
      report: { failures: Array<{ message: string }> };
    };
    expect(report.report.failures.map((failure) => failure.message)).toEqual(["Evaluation case not found: does-not-exist"]);
  });
});

describe("experiment list/describe with warm-index-reuse", () => {
  it("lists warm-index-reuse after context-strategy-comparison with its variants", async () => {
    const output = captureConsole();
    expect(await runExperimentListCommandFromArgs(["--json"])).toBe(0);
    const listed = JSON.parse(output.stdout()) as { experiments: Array<{ id: string; supportedVariants: string[] }> };
    expect(listed.experiments.map((experiment) => [experiment.id, experiment.supportedVariants])).toEqual([
      ["context-strategy-comparison", ["raw-full-file", "my-dev-kit-guided"]],
      ["warm-index-reuse", ["raw-full-file", "warm-index-reuse"]],
    ]);
  });

  it("describes warm-index-reuse without advertising unsupported agent options", async () => {
    const output = captureConsole();
    expect(await runExperimentDescribeCommandFromArgs(["--experiment", "warm-index-reuse", "--json"])).toBe(0);
    const described = JSON.parse(output.stdout()) as {
      metadata: { id: string; status: string };
      supportedVariants: string[];
      optionalConfigFields: Array<{ name: string; defaultValue?: unknown }>;
      examples: string[];
    };
    expect(described.metadata).toEqual(expect.objectContaining({ id: "warm-index-reuse", status: "experimental" }));
    expect(described.supportedVariants).toEqual(["raw-full-file", "warm-index-reuse"]);
    expect(described.optionalConfigFields.find((field) => field.name === "kitCommand")?.defaultValue).toBe(
      "npx @dailephd/my-dev-kit@latest"
    );
    expect(described.examples.join("\n")).not.toContain("--agents");
  });

  it("keeps the context-strategy-comparison describe examples unchanged", async () => {
    const output = captureConsole();
    expect(await runExperimentDescribeCommandFromArgs(["--experiment", "context-strategy-comparison", "--json"])).toBe(0);
    const described = JSON.parse(output.stdout()) as { examples: string[] };
    expect(described.examples).toEqual([
      "my-dev-kit-lab experiment describe --experiment context-strategy-comparison",
      "my-dev-kit-lab experiment run --experiment context-strategy-comparison --agents fake-agent --complexities short",
      'my-dev-kit-lab experiment run --experiment context-strategy-comparison --target "Z:\\Users\\newuser\\Projects\\my-dev-kit-v1" --agents fake-agent --complexities short --no-screenshot',
    ]);
  });
});

describe("installed CLI help for warm-index-reuse and plots", () => {
  async function help(args: string[]) {
    const stdout: string[] = [];
    const code = await runLabCli(args, { writers: { stdout: (message) => stdout.push(message), stderr: () => undefined } });
    return { code, text: stdout.join("\n") };
  }

  it("documents --kit-command as warm-index-reuse only and keeps context-strategy options separate", async () => {
    const { code, text } = await help(["experiment", "run", "--help"]);
    expect(code).toBe(0);
    const common = text.indexOf("Common options (all plugins):");
    const warm = text.indexOf("warm-index-reuse only:");
    const context = text.indexOf("context-strategy-comparison only:");
    expect(common).toBeGreaterThan(-1);
    expect(warm).toBeGreaterThan(common);
    expect(context).toBeGreaterThan(warm);
    const warmSection = text.slice(warm, context);
    expect(warmSection).toContain("--kit-command <command>");
    expect(warmSection).toContain("deterministic fake agent only");
    expect(warmSection).not.toMatch(/--agents|codex|claude/);
    const contextSection = text.slice(context);
    for (const flag of ["--agents", "--strategies", "--complexities", "--include-real-agents", "--command-template-codex", "--no-screenshot"]) {
      expect(contextSection).toContain(flag);
    }
    for (const flag of ["--target", "--out", "--cases", "--project-profiles", "--case", "--benchmark-project"]) {
      expect(text.slice(common, warm)).toContain(flag);
    }
  });

  it("describes plots generate inputs accurately", async () => {
    const family = await help(["plots", "--help"]);
    expect(family.text).toContain("controlled-experiment or supported");
    expect(family.text).toContain("warm-index-reuse");
    const generate = await help(["plots", "generate", "--help"]);
    expect(generate.text).toContain("legacy controlled-experiment output directories");
    expect(generate.text).toContain("warm-index-reuse plugin output directories");
    expect(generate.text).toContain("Other plugin outputs are not plotted by this command.");
    expect(generate.text).not.toContain("Path to a controlled-experiment output directory");
  });
});

describe("warm-index-reuse fake-agent end-to-end through the command owners", () => {
  it("runs the multi-task experiment and plots it with fake-agent evidence and no context text", async () => {
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-e2e-"));
    const plotsOut = mkdtempSync(path.join(os.tmpdir(), "warm-e2e-plots-"));
    tempDirs.push(outRoot, plotsOut);
    captureConsole();
    const exitCode = await runExperimentRunCommandFromArgs([
      "--experiment",
      "warm-index-reuse",
      "--kit-command",
      fakeKitCommand,
      "--cases",
      multiTaskCasesPath,
      "--out",
      outRoot,
    ]);
    expect(exitCode).toBe(0);

    const reportText = readFileSync(path.join(outRoot, "report.json"), "utf8");
    const { report } = JSON.parse(reportText) as {
      report: {
        warmIndexReuse: WarmIndexReuseReportV1;
        interpretation: { summary: string; recommendedNextStep: string };
      };
    };
    const section = report.warmIndexReuse;
    expect(section.projects.map((project) => [project.benchmarkProject, project.taskCount])).toEqual([
      ["todo-ts", 2],
      ["todo-js", 1],
    ]);
    expect(section.summary).toEqual(
      expect.objectContaining({ agentSideCount: 6, agentCorrectnessAvailableCount: 6, agentTotalTokensAvailableCount: 6 })
    );
    const [first, second] = section.projects[0].tasks;
    expect(second.warm.cumulativeAgentTotalTokens.value).toBe(
      (first.warm.agentTotalTokens.value as number) + (second.warm.agentTotalTokens.value as number)
    );
    const artifact = JSON.parse(readFileSync(path.join(outRoot, "warm-index-execution.json"), "utf8")) as WarmIndexExecutionArtifactV1;
    expect(artifact.projects.map((project) => project.indexCommand?.commandId)).toEqual(["index", "index"]);

    const sourceLine = readFileSync(path.resolve("benchmarks/projects/todo-ts/src/taskService.ts"), "utf8")
      .split("\n")
      .find((line) => line.trim().length > 30)!
      .trim();
    expect(reportText).not.toContain("contextText");
    expect(reportText).not.toContain(sourceLine);
    const interpretation = `${report.interpretation.summary} ${report.interpretation.recommendedNextStep}`;
    expect(interpretation).not.toMatch(/is better|winner|best strategy|best-supported|faster overall|saves tokens|break-even|ranked first/i);

    const stdout: string[] = [];
    const plotCode = await runLabCli(["plots", "generate", "--experiment", outRoot, "--out", plotsOut], {
      writers: { stdout: (message) => stdout.push(message), stderr: () => undefined },
    });
    expect(plotCode).toBe(0);
    const summary = JSON.parse(readFileSync(path.join(plotsOut, "plots-summary.json"), "utf8")) as { chartCount: number };
    expect(summary.chartCount).toBe(4);
  });
});

describe("experiment run warm-index-reuse with the v0.5.1 production corpus", () => {
  const productionArgs = (outRoot: string, ...extra: string[]) => [
    "--experiment",
    "warm-index-reuse",
    "--kit-command",
    fakeKitCommand,
    "--cases",
    "benchmarks/contracts/warm-index-benchmark-cases.json",
    "--project-profiles",
    "benchmarks/contracts/benchmark-project-profiles.json",
    ...extra,
    "--out",
    outRoot,
  ];

  it("runs all 12 cases as two six-task project groups through the existing command surface", async () => {
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-command-prod-"));
    tempDirs.push(outRoot);
    const output = captureConsole();

    const exitCode = await runExperimentRunCommandFromArgs(productionArgs(outRoot));

    expect(output.stderr()).toBe("");
    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain("Status: completed");
    const artifact = JSON.parse(readFileSync(path.join(outRoot, "warm-index-execution.json"), "utf8")) as WarmIndexExecutionArtifactV1;
    expect(artifact.projects.map((project) => [project.benchmarkProject, project.tasks.length])).toEqual([
      ["task-workflow-medium-ts", 6],
      ["task-analytics-large-mixed", 6],
    ]);
    expect(artifact.projects.map((project) => project.indexCommand?.commandId)).toEqual(["index", "index"]);
    const report = JSON.parse(readFileSync(path.join(outRoot, "report.json"), "utf8")) as {
      report: { cases: unknown[]; warmIndexReuse: WarmIndexReuseReportV1 };
    };
    expect(report.report.cases).toHaveLength(12);
    expect(report.report.warmIndexReuse.summary.taskCount).toBe(12);

    // experiment run -> report -> the existing `plots generate` command, with no warm-specific plot command.
    const plotsOut = mkdtempSync(path.join(os.tmpdir(), "warm-command-prod-plots-"));
    tempDirs.push(plotsOut);
    const plotCode = await runLabCli(["plots", "generate", "--experiment", outRoot, "--out", plotsOut], {
      writers: { stdout: () => undefined, stderr: () => undefined },
    });
    expect(plotCode).toBe(0);
    const summary = JSON.parse(readFileSync(path.join(plotsOut, "plots-summary.json"), "utf8")) as { chartCount: number };
    expect(summary.chartCount).toBe(4);
  }, 120_000);

  it("applies --benchmark-project and --case selectors to the expanded corpus", async () => {
    const mediumRoot = mkdtempSync(path.join(os.tmpdir(), "warm-command-medium-"));
    const caseRoot = mkdtempSync(path.join(os.tmpdir(), "warm-command-case-"));
    tempDirs.push(mediumRoot, caseRoot);
    captureConsole();

    expect(await runExperimentRunCommandFromArgs(productionArgs(mediumRoot, "--benchmark-project", "task-workflow-medium-ts"))).toBe(0);
    const medium = JSON.parse(readFileSync(path.join(mediumRoot, "warm-index-execution.json"), "utf8")) as WarmIndexExecutionArtifactV1;
    expect(medium.projects.map((project) => [project.benchmarkProject, project.tasks.map((task) => task.caseId)])).toEqual([
      [
        "task-workflow-medium-ts",
        [
          "warm-medium-import-dedupe",
          "warm-medium-create-project-task",
          "warm-medium-complete-idempotent",
          "warm-medium-composite-filter",
          "warm-medium-project-summary",
          "warm-medium-broad-workflow-map",
        ],
      ],
    ]);

    expect(await runExperimentRunCommandFromArgs(productionArgs(caseRoot, "--case", "warm-large-ts-leaderboard"))).toBe(0);
    const single = JSON.parse(readFileSync(path.join(caseRoot, "warm-index-execution.json"), "utf8")) as WarmIndexExecutionArtifactV1;
    expect(single.projects.map((project) => [project.benchmarkProject, project.tasks.map((task) => task.caseId)])).toEqual([
      ["task-analytics-large-mixed", ["warm-large-ts-leaderboard"]],
    ]);
  }, 120_000);
});
