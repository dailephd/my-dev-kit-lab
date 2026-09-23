import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
import { SCREENSHOT_SKIP_WARNING } from "../../src/screenshot/index.js";
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

// ---------------------------------------------------------------------------
// v0.5.2 Batch 4 -- deterministic public-command Codex/Claude campaign fixtures.
// Mirrors the fake provider shims in tests/experiments/warmIndexReuse/warmIndexRealAgent.test.ts;
// duplicated here (not commandTemplate) because these tests exercise the real public CLI surface.
// ---------------------------------------------------------------------------

function writeShim(filePath: string, script: string): void {
  if (process.platform === "win32") {
    writeFileSync(filePath, `@echo off\r\nnode -e "${script.replace(/"/g, '\\"')}" -- %*\r\n`, "utf8");
    return;
  }
  const unixScript = script.replace(/process\.argv\.slice\(1\)/g, "process.argv.slice(2)");
  writeFileSync(filePath, `#!/usr/bin/env node\n${unixScript}\n`, "utf8");
  chmodSync(filePath, 0o755);
}

function writeFakeCodexExecutable(filePath: string, options: { withTokens?: boolean; failWhenStdinContains?: string } = {}): void {
  const withTokens = options.withTokens !== false;
  const failToken = options.failWhenStdinContains ? JSON.stringify(options.failWhenStdinContains) : "null";
  const usageLine = withTokens
    ? "console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 } })); "
    : "";
  const script =
    "const args = process.argv.slice(1); if (args.includes('--version')) { console.log('codex 1.0.0-fake'); process.exit(0); } " +
    "let data = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { data += c; }); " +
    "process.stdin.on('end', () => { " +
    `const failToken = ${failToken}; ` +
    "if (failToken && data.includes(failToken)) { process.stderr.write('forced provider failure'); process.exit(1); } " +
    "console.log(JSON.stringify({ type: 'thread.started' })); " +
    "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'answer: ok\\nrelevantFiles: src/example.ts\\nrelevantSymbols: exampleSymbol\\nexpectedFactsFound: \\nconfidence: high' } })); " +
    `${usageLine}` +
    "});";
  writeShim(filePath, script);
}

function writeFakeClaudeExecutable(filePath: string, options: { withTokens?: boolean } = {}): void {
  const withTokens = options.withTokens !== false;
  const usagePart = withTokens ? ", usage: { input_tokens: 6, output_tokens: 4 }" : "";
  const script =
    "const args = process.argv.slice(1); if (args.includes('--version')) { console.log('claude 1.0.0-fake'); process.exit(0); } " +
    "let data = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { data += c; }); " +
    "process.stdin.on('end', () => { " +
    `console.log(JSON.stringify({ result: 'answer: ok\\nrelevantFiles: src/example.ts\\nrelevantSymbols: exampleSymbol\\nconfidence: high', session_id: 'fixture'${usagePart} })); ` +
    "});";
  writeShim(filePath, script);
}

function makeCampaignBin(prefix: string): string {
  const binDir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(binDir);
  return binDir;
}

function shimName(agent: "codex" | "claude"): string {
  return process.platform === "win32" ? `${agent}.cmd` : agent;
}

// The public command owner reads process.env directly (loadCampaignCasesAndProjectProfiles), so a
// fake provider on PATH must be injected into the real process environment for the call's duration.
// includeOriginalPath stays true for happy-path fixtures (node must resolve fakeKitCommand); the
// provider-unavailable fixture passes false so a real provider possibly on the host PATH cannot leak in.
async function withPatchedPath<T>(binDir: string, fn: () => Promise<T>, includeOriginalPath = true): Promise<T> {
  const originalPath = process.env.PATH;
  const originalPathCap = process.env.Path;
  const nodeBinDir = path.dirname(process.execPath);
  const tail = includeOriginalPath ? `${path.delimiter}${originalPath ?? ""}` : "";
  const tailCap = includeOriginalPath ? `${path.delimiter}${originalPathCap ?? ""}` : "";
  process.env.PATH = `${binDir}${path.delimiter}${nodeBinDir}${tail}`;
  process.env.Path = `${binDir}${path.delimiter}${nodeBinDir}${tailCap}`;
  try {
    return await fn();
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalPathCap === undefined) delete process.env.Path;
    else process.env.Path = originalPathCap;
  }
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

describe("experiment run --campaign (v0.5.2 Batch 1)", () => {
  it("parses --campaign for warm-index-reuse", () => {
    const parsed = parseRunExperimentArgs([
      "--experiment",
      "warm-index-reuse",
      "--campaign",
      "codex-full",
      "--include-real-agents",
    ]);
    expect(parsed.config).toEqual({ campaignPreset: "codex-full", includeRealAgents: true });
  });

  it("rejects --campaign for context-strategy-comparison", () => {
    expect(() =>
      parseRunExperimentArgs(["--experiment", "context-strategy-comparison", "--campaign", "codex-full"])
    ).toThrow("--campaign is only supported for --experiment warm-index-reuse.");
  });

  it("rejects an unknown campaign preset value", () => {
    expect(() => parseRunExperimentArgs(["--experiment", "warm-index-reuse", "--campaign", "nope"])).toThrow(
      "Unknown warm-index campaign preset: nope"
    );
  });

  it("rejects --campaign combined with --target", () => {
    expect(() =>
      parseRunExperimentArgs(["--experiment", "warm-index-reuse", "--campaign", "codex-full", "--target", "/tmp/x"])
    ).toThrow("--campaign cannot be combined with --target");
  });

  it("rejects --campaign combined with explicit --cases", () => {
    expect(() =>
      parseRunExperimentArgs([
        "--experiment",
        "warm-index-reuse",
        "--campaign",
        "codex-full",
        "--cases",
        "examples/token-savings-cases.json",
      ])
    ).toThrow("--campaign cannot be combined with --cases");
  });

  it("rejects --campaign combined with explicit --project-profiles", () => {
    expect(() =>
      parseRunExperimentArgs([
        "--experiment",
        "warm-index-reuse",
        "--campaign",
        "codex-full",
        "--project-profiles",
        "benchmarks/contracts/benchmark-project-profiles.json",
      ])
    ).toThrow("--campaign cannot be combined with --project-profiles");
  });

  it("accepts --campaign together with --kit-command and --timeout-ms", () => {
    const parsed = parseRunExperimentArgs([
      "--experiment",
      "warm-index-reuse",
      "--campaign",
      "codex-full",
      "--include-real-agents",
      "--kit-command",
      "npx @dailephd/my-dev-kit@latest",
      "--timeout-ms",
      "120000",
    ]);
    expect(parsed.config).toEqual({
      campaignPreset: "codex-full",
      includeRealAgents: true,
      kitCommand: "npx @dailephd/my-dev-kit@latest",
      timeoutMs: 120000,
    });
  });

  it("leaves legacy warm-index-reuse parsing unchanged when --campaign is absent", () => {
    const parsed = parseRunExperimentArgs([
      "--experiment",
      "warm-index-reuse",
      "--kit-command",
      "npx @dailephd/my-dev-kit@latest",
      "--case",
      "a,b",
    ]);
    expect(parsed.config).toEqual({ kitCommand: "npx @dailephd/my-dev-kit@latest", caseIds: ["a", "b"] });
  });

  it("rejects a campaign missing --include-real-agents before any index/command/agent directory is produced", async () => {
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-campaign-"));
    tempDirs.push(outRoot);
    const output = captureConsole();
    const exitCode = await runExperimentRunCommandFromArgs([
      "--experiment",
      "warm-index-reuse",
      "--campaign",
      "codex-full",
      "--kit-command",
      fakeKitCommand,
      "--out",
      outRoot,
    ]);
    expect(exitCode).toBe(1);
    expect(output.stderr()).toContain("campaignPreset requires includeRealAgents to be exactly true");
    expect(existsSync(path.join(outRoot, "warm-index-execution.json"))).toBe(false);
    expect(existsSync(path.join(outRoot, "report.json"))).toBe(false);
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

  it("exposes campaignPreset as an optional config field with campaign examples (v0.5.2 Batch 1)", async () => {
    const output = captureConsole();
    expect(await runExperimentDescribeCommandFromArgs(["--experiment", "warm-index-reuse", "--json"])).toBe(0);
    const described = JSON.parse(output.stdout()) as {
      optionalConfigFields: Array<{ name: string }>;
      examples: string[];
    };
    expect(described.optionalConfigFields.map((field) => field.name)).toEqual(
      expect.arrayContaining(["campaignPreset", "includeRealAgents", "timeoutMs"])
    );
    expect(described.examples.some((example) => example.includes("--campaign codex-full"))).toBe(true);
    expect(described.examples.some((example) => example.includes("--campaign claude-full"))).toBe(true);
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
    expect(warmSection).toContain("--campaign <preset>");
    expect(warmSection).toContain("codex-full");
    expect(warmSection).toContain("claude-full");
    expect(warmSection).toContain("codex-timeout-isolation");
    expect(warmSection).not.toContain("guarded");
    expect(warmSection).toContain("infrastructure status from agent/provider outcome status");
    expect(warmSection).not.toMatch(/--agents|--strategies|--complexities|--command-template/);
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

describe("v0.5.2 Batch 4/5 -- public real-agent campaign commands and presentation", () => {
  function campaignArgs(preset: "codex-full" | "claude-full", caseId: string, outRoot: string, extra: string[] = []) {
    return [
      "--experiment",
      "warm-index-reuse",
      "--campaign",
      preset,
      "--include-real-agents",
      "--case",
      caseId,
      "--kit-command",
      fakeKitCommand,
      "--out",
      outRoot,
      ...extra,
    ];
  }

  type RunOptions = Parameters<typeof runExperimentRunCommandFromArgs>[1];

  function capturedScreenshotOptions(): RunOptions {
    return {
      presentation: {
        captureScreenshot: async (htmlPath: string, pngPath: string) => {
          writeFileSync(pngPath, "png-data");
          return { status: "captured" as const, htmlPath, pngPath };
        },
      },
    };
  }

  function skippedScreenshotOptions(): RunOptions {
    return {
      presentation: {
        captureScreenshot: async (htmlPath: string, pngPath: string) => ({
          status: "skipped" as const,
          htmlPath,
          pngPath,
          warning: SCREENSHOT_SKIP_WARNING,
        }),
      },
    };
  }

  function failedScreenshotOptions(): RunOptions {
    return {
      presentation: {
        captureScreenshot: async (htmlPath: string, pngPath: string) => ({
          status: "failed" as const,
          htmlPath,
          pngPath,
          error: "forced screenshot failure",
        }),
      },
    };
  }

  function expectFullCampaignTopology(outRoot: string, expectPng: boolean) {
    expect(existsSync(path.join(outRoot, "warm-index-execution.json"))).toBe(true);
    expect(existsSync(path.join(outRoot, "report.json"))).toBe(true);
    expect(existsSync(path.join(outRoot, "report.txt"))).toBe(true);
    expect(existsSync(path.join(outRoot, "report.html"))).toBe(true);
    expect(existsSync(path.join(outRoot, "report.png"))).toBe(expectPng);
    expect(existsSync(path.join(outRoot, "plots", "plot-data.json"))).toBe(true);
    expect(existsSync(path.join(outRoot, "plots", "plots-summary.json"))).toBe(true);
    for (const id of [
      "warm-index-amortized-index-cost",
      "warm-index-context-size",
      "warm-index-correctness",
      "warm-index-cumulative-token-usage",
    ]) {
      expect(existsSync(path.join(outRoot, "plots", "charts", `${id}.svg`))).toBe(true);
    }
    expect(existsSync(path.join(outRoot, "gallery", "gallery-manifest.json"))).toBe(true);
    expect(existsSync(path.join(outRoot, "gallery", "gallery-index.html"))).toBe(true);
  }

  it("executes a deterministic Codex campaign end to end with complete agent/token evidence and full presentation (sections 29, 32)", async () => {
    const binDir = makeCampaignBin("codex-public-bin-");
    writeFakeCodexExecutable(path.join(binDir, shimName("codex")));
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-public-codex-"));
    tempDirs.push(outRoot);
    const output = captureConsole();

    const exitCode = await withPatchedPath(binDir, () =>
      runExperimentRunCommandFromArgs(campaignArgs("codex-full", "warm-medium-import-dedupe", outRoot), capturedScreenshotOptions())
    );

    expect(exitCode).toBe(0);
    expect(output.stdout()).toContain("Experiment: warm-index-reuse");
    expectFullCampaignTopology(outRoot, true);

    const artifact = JSON.parse(readFileSync(path.join(outRoot, "warm-index-execution.json"), "utf8")) as WarmIndexExecutionArtifactV1;
    expect(artifact.projects).toHaveLength(1);

    const { report } = JSON.parse(readFileSync(path.join(outRoot, "report.json"), "utf8")) as { report: { warmIndexReuse: WarmIndexReuseReportV1 } };
    const section = report.warmIndexReuse;
    expect(section.agent).toEqual({ id: "codex", mode: "real-provider" });
    expect(section.agentCampaign).toEqual(
      expect.objectContaining({
        presetId: "codex-full",
        agentId: "codex",
        selectedCaseCount: 1,
        scheduledSideCount: 2,
        executedSideCount: 2,
        notRunForMissingContextCount: 0,
        agentEvidenceStatus: "complete",
        tokenEvidenceStatus: "complete",
        outcomeCounts: { completed: 2, failed: 0, timeout: 0, invalidOutput: 0, agentUnavailable: 0, agentLimitReached: 0, skipped: 0 },
      })
    );

    const stdout = output.stdout();
    for (const label of ["Report JSON:", "Report HTML:", "Plots:", "Screenshot:", "Gallery manifest:", "Gallery index:"]) {
      expect(stdout).toContain(label);
    }

    const manifest = JSON.parse(readFileSync(path.join(outRoot, "gallery", "gallery-manifest.json"), "utf8")) as {
      items: Array<{ id: string; tags?: string[] }>;
    };
    expect(manifest.items.map((item) => item.id)).toEqual(["warm-index-campaign-report", "warm-index-campaign-plots", "warm-index-execution"]);
    expect(manifest.items[0].tags).toContain("codex");
    expect(manifest.items[1].tags).toContain("codex");
    const manifestText = JSON.stringify(manifest);
    for (const forbidden of ["agents/", "contextText", "promptText", "finalAnswerText", "stdout", "stderr"]) {
      expect(manifestText).not.toContain(forbidden);
    }
  });

  it("executes a deterministic Claude campaign end to end with complete agent/token evidence and full presentation (sections 30, 33)", async () => {
    const binDir = makeCampaignBin("claude-public-bin-");
    writeFakeClaudeExecutable(path.join(binDir, shimName("claude")));
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-public-claude-"));
    tempDirs.push(outRoot);
    const output = captureConsole();

    const exitCode = await withPatchedPath(binDir, () =>
      runExperimentRunCommandFromArgs(campaignArgs("claude-full", "warm-medium-complete-idempotent", outRoot), capturedScreenshotOptions())
    );

    expect(exitCode).toBe(0);
    expectFullCampaignTopology(outRoot, true);
    const { report } = JSON.parse(readFileSync(path.join(outRoot, "report.json"), "utf8")) as { report: { warmIndexReuse: WarmIndexReuseReportV1 } };
    const section = report.warmIndexReuse;
    expect(section.agent).toEqual({ id: "claude", mode: "real-provider" });
    expect(section.agentCampaign).toEqual(
      expect.objectContaining({
        presetId: "claude-full",
        agentId: "claude",
        selectedCaseCount: 1,
        scheduledSideCount: 2,
        executedSideCount: 2,
        notRunForMissingContextCount: 0,
        agentEvidenceStatus: "complete",
        tokenEvidenceStatus: "complete",
      })
    );

    const manifest = JSON.parse(readFileSync(path.join(outRoot, "gallery", "gallery-manifest.json"), "utf8")) as {
      items: Array<{ id: string; tags?: string[] }>;
    };
    expect(manifest.items).toHaveLength(3);
    expect(manifest.items[0].tags).toContain("claude");
    expect(manifest.items[1].tags).toContain("claude");
  });

  it("reports Claude token evidence as unavailable, never zero, when the CLI emits no usage (section 31)", async () => {
    const binDir = makeCampaignBin("claude-no-usage-bin-");
    writeFakeClaudeExecutable(path.join(binDir, shimName("claude")), { withTokens: false });
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-public-claude-no-usage-"));
    tempDirs.push(outRoot);

    const exitCode = await withPatchedPath(binDir, () =>
      runExperimentRunCommandFromArgs(campaignArgs("claude-full", "warm-medium-complete-idempotent", outRoot), capturedScreenshotOptions())
    );

    expect(exitCode).toBe(0);
    const reportText = readFileSync(path.join(outRoot, "report.json"), "utf8");
    const { report } = JSON.parse(reportText) as { report: { warmIndexReuse: WarmIndexReuseReportV1 } };
    const section = report.warmIndexReuse;
    expect(section.agentCampaign?.agentEvidenceStatus).toBe("complete");
    expect(section.agentCampaign?.tokenEvidenceStatus).toBe("unavailable");
    expect(section.summary.agentTotalTokensAvailableCount).toBe(0);
    for (const project of section.projects) {
      for (const task of project.tasks) {
        expect(task.raw.agentTotalTokens.availability).not.toBe("available");
        expect(task.warm.agentTotalTokens.availability).not.toBe("available");
      }
    }
    expect(reportText).not.toMatch(/"agentTotalTokens":\s*\{\s*"availability":\s*"available",\s*"value":\s*0/);
    const text = readFileSync(path.join(outRoot, "report.txt"), "utf8");
    expect(text).toContain("Token Evidence Status: unavailable");
  });

  it("keeps report/plots/gallery when screenshot capture is skipped (section 34)", async () => {
    const binDir = makeCampaignBin("codex-skip-bin-");
    writeFakeCodexExecutable(path.join(binDir, shimName("codex")));
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-public-codex-skip-"));
    tempDirs.push(outRoot);
    const output = captureConsole();

    const exitCode = await withPatchedPath(binDir, () =>
      runExperimentRunCommandFromArgs(campaignArgs("codex-full", "warm-medium-import-dedupe", outRoot), skippedScreenshotOptions())
    );

    expect(exitCode).toBe(0);
    expectFullCampaignTopology(outRoot, false);
    const manifest = JSON.parse(readFileSync(path.join(outRoot, "gallery", "gallery-manifest.json"), "utf8")) as {
      items: Array<{ id: string; status: string; screenshotPath?: string }>;
    };
    expect(manifest.items[0].status).toBe("warning");
    expect(manifest.items[0].screenshotPath).toBeUndefined();
    const stdout = output.stdout();
    expect(stdout).toContain("Screenshot: skipped");
    expect(stdout).toContain(SCREENSHOT_SKIP_WARNING);
  });

  it("returns exit 1 but preserves report/plots/gallery when screenshot capture fails (section 35)", async () => {
    const binDir = makeCampaignBin("codex-fail-bin-");
    writeFakeCodexExecutable(path.join(binDir, shimName("codex")));
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-public-codex-shotfail-"));
    tempDirs.push(outRoot);
    const output = captureConsole();

    const exitCode = await withPatchedPath(binDir, () =>
      runExperimentRunCommandFromArgs(campaignArgs("codex-full", "warm-medium-import-dedupe", outRoot), failedScreenshotOptions())
    );

    expect(exitCode).toBe(1);
    expectFullCampaignTopology(outRoot, false);
    const manifest = JSON.parse(readFileSync(path.join(outRoot, "gallery", "gallery-manifest.json"), "utf8")) as {
      items: Array<{ id: string; status: string; warnings: string[] }>;
    };
    expect(manifest.items[0].status).toBe("warning");
    expect(manifest.items[0].warnings.some((warning) => warning.includes("forced screenshot failure"))).toBe(true);
    const stdout = output.stdout();
    expect(stdout).toContain("Screenshot: failed");
    expect(stdout).toContain("forced screenshot failure");
  });

  it("reports a partial campaign when one provider side fails while later sides succeed, and still generates full presentation (sections 32, 36)", async () => {
    const binDir = makeCampaignBin("codex-partial-bin-");
    writeFakeCodexExecutable(path.join(binDir, shimName("codex")), { failWhenStdinContains: "Case ID: warm-medium-import-dedupe" });
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-public-codex-partial-"));
    tempDirs.push(outRoot);

    const exitCode = await withPatchedPath(binDir, () =>
      runExperimentRunCommandFromArgs(
        campaignArgs("codex-full", "warm-medium-import-dedupe,warm-medium-create-project-task", outRoot),
        capturedScreenshotOptions()
      )
    );

    // Infrastructure (index/raw/warm) succeeded, so the command's exit code follows the
    // infrastructure ExperimentRun.status rule and is unaffected by the provider failure.
    expect(exitCode).toBe(0);
    expectFullCampaignTopology(outRoot, true);
    const { report } = JSON.parse(readFileSync(path.join(outRoot, "report.json"), "utf8")) as {
      report: { warmIndexReuse: WarmIndexReuseReportV1; interpretation: { summary: string; recommendedNextStep: string } };
    };
    expect(report.warmIndexReuse.agentCampaign?.agentEvidenceStatus).toBe("partial");
    expect(report.warmIndexReuse.agentCampaign?.outcomeCounts.failed).toBeGreaterThan(0);
    expect(report.warmIndexReuse.agentCampaign?.outcomeCounts.completed).toBeGreaterThan(0);
    expect(report.warmIndexReuse.projects[0].status).toBe("completed");
    expect(report.interpretation.summary).not.toMatch(/infrastructure.*failed|the (warm-index )?run failed/i);
    expect(report.interpretation.recommendedNextStep).toContain("provider/agent limitations");

    // Presentation artifacts stay clean of provider errors; those already belong to the report.
    const manifestText = readFileSync(path.join(outRoot, "gallery", "gallery-manifest.json"), "utf8");
    expect(manifestText).not.toContain("forced provider failure");
  });

  it("reports agent-unavailable evidence when the provider executable is missing, and still generates full presentation (sections 33, 37)", async () => {
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-public-codex-unavailable-"));
    tempDirs.push(outRoot);
    const emptyBinDir = makeCampaignBin("codex-empty-bin-");

    const exitCode = await withPatchedPath(
      emptyBinDir,
      () =>
        runExperimentRunCommandFromArgs(
          campaignArgs("codex-full", "warm-medium-import-dedupe", outRoot),
          capturedScreenshotOptions()
        ),
      false
    );

    expect(exitCode).toBe(0);
    expectFullCampaignTopology(outRoot, true);
    const { report } = JSON.parse(readFileSync(path.join(outRoot, "report.json"), "utf8")) as { report: { warmIndexReuse: WarmIndexReuseReportV1 } };
    const section = report.warmIndexReuse;
    expect(section.agentCampaign?.outcomeCounts.agentUnavailable).toBeGreaterThan(0);
    expect(section.agentCampaign?.agentEvidenceStatus).toBe("partial");
    expect(section.agentCampaign?.tokenEvidenceStatus).toBe("unavailable");
    const text = readFileSync(path.join(outRoot, "report.txt"), "utf8");
    expect(text).toContain("Agent-Unavailable Sides:");
  });
});

describe("v0.5.2 Batch 5 -- legacy and context-strategy presentation regression", () => {
  it("keeps legacy non-campaign warm-index runs report-only, with no plots/screenshot/gallery (section 38)", async () => {
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "warm-legacy-no-presentation-"));
    tempDirs.push(outRoot);
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
    expect(existsSync(path.join(outRoot, "report.json"))).toBe(true);
    expect(existsSync(path.join(outRoot, "report.txt"))).toBe(true);
    expect(existsSync(path.join(outRoot, "report.html"))).toBe(true);
    expect(existsSync(path.join(outRoot, "warm-index-execution.json"))).toBe(true);
    expect(existsSync(path.join(outRoot, "report.png"))).toBe(false);
    expect(existsSync(path.join(outRoot, "plots"))).toBe(false);
    expect(existsSync(path.join(outRoot, "gallery"))).toBe(false);
  });

  it("keeps context-strategy-comparison free of automatic plots/screenshot/gallery (section 39)", async () => {
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "context-strategy-no-presentation-"));
    tempDirs.push(outRoot);
    captureConsole();

    const exitCode = await runExperimentRunCommandFromArgs([
      "--experiment",
      "context-strategy-comparison",
      "--case",
      "todo-ts-create-task",
      "--agents",
      "fake-agent",
      "--complexities",
      "short",
      "--no-screenshot",
      "--out",
      outRoot,
    ]);

    expect(exitCode).toBe(0);
    expect(existsSync(path.join(outRoot, "report.json"))).toBe(true);
    expect(existsSync(path.join(outRoot, "report.png"))).toBe(false);
    expect(existsSync(path.join(outRoot, "plots"))).toBe(false);
    expect(existsSync(path.join(outRoot, "gallery"))).toBe(false);
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
