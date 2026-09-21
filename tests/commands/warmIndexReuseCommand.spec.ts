import { mkdtempSync, readFileSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runExperimentDescribeCommandFromArgs } from "../../src/commands/runExperimentDescribeCommand.js";
import { runExperimentListCommandFromArgs } from "../../src/commands/runExperimentListCommand.js";
import { parseRunExperimentArgs, runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import type { WarmIndexExecutionArtifactV1 } from "../../src/experiments/plugins/warmIndexReuse/index.js";
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
