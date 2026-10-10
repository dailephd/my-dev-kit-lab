import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLabCli } from "../../src/cli/index.js";
import { parseRunExperimentArgs } from "../../src/commands/runExperimentRunCommand.js";
import { snapshotProjectTree } from "../../src/evaluation/benchmarkSandbox/index.js";

const ID = "agent-success-rate";
const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

const makeTemp = (prefix: string): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

async function capture(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void stdout.push(args.join(" ")));
  const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void stderr.push(args.join(" ")));
  try {
    const code = await runLabCli(argv, { writers: { stdout: (message) => void stdout.push(message), stderr: (message) => void stderr.push(message) } });
    return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

const parseFails = (args: string[]): string => {
  try {
    parseRunExperimentArgs(args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`expected the arguments to be rejected: ${args.join(" ")}`);
};

const asr = (...rest: string[]): string[] => ["--experiment", ID, ...rest];

describe("RPR agent-success-rate experiment run argument parsing", () => {
  it("RPR-031: accepts exactly the documented flags and builds the plugin config", () => {
    const parsed = parseRunExperimentArgs(
      asr("--out", "o", "--case", "a,b", "--benchmark-project", "p", "--kit-command", "npx kit", "--agent", "codex", "--include-real-agents", "--timeout-ms", "5000", "--repair-attempts", "2")
    );
    expect(parsed.experimentId).toBe(ID);
    expect(parsed.outDir).toBe("o");
    expect(parsed.config).toEqual({ caseIds: ["a", "b"], benchmarkProjects: ["p"], kitCommand: "npx kit", agentId: "codex", includeRealAgents: true, timeoutMs: 5000, repairAttempts: 2 });
    // the default is deterministic-fixture mode with no provider fields at all
    expect(parseRunExperimentArgs(asr()).config).toEqual({});
  });

  it("RPR-032: rejects every unsupported generic flag instead of ignoring it", () => {
    const flags: Array<[string, string[]]> = [
      ["--agents", ["fake-agent"]],
      ["--strategies", ["raw-full-file"]],
      ["--complexities", ["short"]],
      ["--campaign", ["codex-full"]],
      ["--max-runs", ["3"]],
      ["--continue-on-failure", []],
      ["--no-continue-on-failure", []],
      ["--require-agents", []],
      ["--command-template-codex", ["codex {prompt}"]],
      ["--command-template-claude", ["claude {prompt}"]],
      ["--target", ["somewhere"]],
      ["--local-subject-config", ["cfg.json"]],
      ["--synthetic-config", ["cfg.json"]],
      ["--cases", ["cases.json"]],
      ["--project-profiles", ["profiles.json"]],
      ["--context-budgets", ["8k"]],
      ["--no-screenshot", []]
    ];
    for (const [flag, values] of flags) {
      expect(parseFails(asr(flag, ...values)), flag).toContain(`${flag} is not supported for --experiment ${ID}`);
    }
    // flag order does not matter, and every offender is named
    expect(parseFails(["--agents", "codex", "--experiment", ID, "--strategies", "x"])).toContain("--agents, --strategies are not supported");
    // --agents is never coerced into --agent
    expect(parseFails(asr("--agents", "codex", "--include-real-agents"))).toContain("--agents is not supported");
  });

  it("RPR-033/034: real providers need explicit opt-in and every real-agent option needs a provider", () => {
    expect(parseFails(asr("--agent", "codex"))).toContain("--agent requires --include-real-agents");
    expect(parseFails(asr("--include-real-agents"))).toContain("--include-real-agents requires --agent");
    expect(parseFails(asr("--repair-attempts", "1"))).toContain("requires --agent and --include-real-agents");
    expect(parseFails(asr("--timeout-ms", "1000"))).toContain("only supported together with --agent");
    expect(parseFails(asr("--kit-command", "npx kit"))).toContain("only supported together with --agent");
    expect(parseRunExperimentArgs(asr("--repair-attempts", "0")).config).toEqual({ repairAttempts: 0 });
    // provider identity
    expect(parseFails(asr("--agent", "gpt", "--include-real-agents"))).toContain("exactly one of: codex, claude");
    expect(parseFails(asr("--agent", "codex,claude", "--include-real-agents"))).toContain("exactly one of: codex, claude");
    expect(parseFails(asr("--agent", "codex", "--agent", "claude", "--include-real-agents"))).toContain("only once");
    // numeric values
    const real = ["--agent", "codex", "--include-real-agents"];
    for (const value of ["3", "-1", "1.5", "abc", "Infinity", "01", "1e0", ""]) {
      expect(() => parseRunExperimentArgs(asr(...real, "--repair-attempts", value)), value).toThrow();
    }
    for (const value of ["0", "-5", "1.5", "NaN", "Infinity", "abc", "1800001"]) {
      expect(() => parseRunExperimentArgs(asr(...real, "--timeout-ms", value)), value).toThrow();
    }
    expect(parseRunExperimentArgs(asr(...real, "--timeout-ms", "1800000")).config.timeoutMs).toBe(1_800_000);
    // missing values
    for (const flag of ["--out", "--case", "--benchmark-project", "--agent", "--repair-attempts", "--timeout-ms", "--kit-command"]) {
      expect(parseFails(asr(flag)), flag).toContain(`${flag} requires a value`);
    }
    expect(parseFails(asr("--case", "--benchmark-project", "p"))).toContain("--case requires a value");
  });

  it("keeps the --agent and --repair-attempts flags plugin-specific and leaves other plugins' --agents behavior alone", () => {
    // plugins with their own strict option lists reject it as unsupported; the rest reject it as plugin-specific
    expect(parseFails(["--experiment", "context-pack-generation", "--agent", "codex"])).toMatch(/--agent is (not|only) supported/);
    expect(parseFails(["--experiment", "context-strategy-comparison", "--agent", "codex"])).toContain(`--agent is only supported for --experiment ${ID}`);
    expect(parseFails(["--experiment", "context-strategy-comparison", "--repair-attempts", "1"])).toContain(`--repair-attempts is only supported for --experiment ${ID}`);
    const legacy = parseRunExperimentArgs(["--experiment", "context-strategy-comparison", "--agents", "fake-agent", "--complexities", "short", "--include-real-agents"]);
    expect(legacy.config).toMatchObject({ agents: ["fake-agent"], complexityLevels: ["short"], includeRealAgents: true });
    expect(legacy.config).not.toHaveProperty("agentId");
  });
});

describe("RPR agent-success-rate experiment run, describe and help through the installed CLI router", () => {
  it("RPR-035/033: refuses an external target and never launches a provider without opt-in", async () => {
    const binDir = makeTemp("asr-cli-bin-");
    const marker = path.join(binDir, "provider-was-launched.txt");
    for (const provider of ["codex", "claude"]) {
      if (process.platform === "win32") writeFileSync(path.join(binDir, `${provider}.cmd`), `@echo off\r\necho launched> "${marker}"\r\n`, "utf8");
      else {
        const exe = path.join(binDir, provider);
        writeFileSync(exe, `#!/bin/sh\necho launched > "${marker}"\n`, "utf8");
        chmodSync(exe, 0o755);
      }
    }
    const savedPath = process.env.PATH;
    const savedWindowsPath = process.env.Path;
    process.env.PATH = `${binDir}${path.delimiter}${savedPath ?? ""}`;
    if (process.platform === "win32") process.env.Path = process.env.PATH;
    try {
      const workspace = makeTemp("asr-cli-ws-");
      const external = makeTemp("asr-cli-target-");
      writeFileSync(path.join(external, "package.json"), '{"name":"ext"}\n');
      const withTarget = await capture(["--workspace", workspace, "experiment", "run", ...asr("--target", external)]);
      expect(withTarget.code).toBe(1);
      expect(withTarget.stderr).toContain("--target is not supported");
      for (const argv of [asr("--agent", "codex"), asr("--include-real-agents"), asr("--agent", "claude", "--repair-attempts", "2")]) {
        const result = await capture(["--workspace", workspace, "experiment", "run", ...argv]);
        expect(result.code, argv.join(" ")).toBe(1);
      }
      const unknownCase = await capture(["--workspace", workspace, "experiment", "run", ...asr("--case", "no-such-case")]);
      expect(unknownCase.code).toBe(1);
      expect(unknownCase.stderr).toContain("Agent-success task not found: no-such-case");
      const unknownProject = await capture(["--workspace", workspace, "experiment", "run", ...asr("--benchmark-project", "no-such-project")]);
      expect(unknownProject.code).toBe(1);
      expect(unknownProject.stderr).toContain("Benchmark project not found: no-such-project");
      const duplicate = await capture(["--workspace", workspace, "experiment", "run", ...asr("--case", "asr-board-title-normalization,asr-board-title-normalization")]);
      expect(duplicate.code).toBe(1);
      expect(duplicate.stderr).toContain("duplicate");
      // nothing was written for any rejected invocation, and no provider executable ran (RPR-053)
      expect(existsSync(path.join(workspace, "lab-output"))).toBe(false);
      expect(existsSync(marker)).toBe(false);
    } finally {
      process.env.PATH = savedPath;
      if (process.platform === "win32") process.env.Path = savedWindowsPath;
    }
  }, 120_000);

  it("RPR-029/030/036/037/053 + deterministic CLI campaign: bundled six-task corpus, both treatments, reports, no mutation", async () => {
    const workspace = makeTemp("asr-cli-ws-");
    const outDir = path.join(makeTemp("asr-cli-out-"), "run");
    const repoRoot = process.cwd();
    const projectsRoot = path.join(repoRoot, "benchmarks", "projects");
    const projects = ["agent-success-task-board-node", "agent-success-inventory-node"];
    const before = new Map<string, Awaited<ReturnType<typeof snapshotProjectTree>>>();
    for (const project of projects) before.set(project, await snapshotProjectTree(path.join(projectsRoot, project), { excludedNames: [".git"] }));
    const packageHadLabOutput = existsSync(path.join(repoRoot, "lab-output"));

    const result = await capture(["--workspace", workspace, "experiment", "run", ...asr("--out", outDir)]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Execution mode: deterministic-fixture");
    expect(result.stdout).toContain("Provider: none");
    expect(result.stdout).toContain("Report Text:");

    // RPR-037: runtime output is outside the package root; canonical projects are unchanged
    const relativeOut = path.relative(repoRoot, outDir); // an absolute result means a different drive, which is also outside the package root
    expect(relativeOut.startsWith("..") || path.isAbsolute(relativeOut)).toBe(true);
    expect(existsSync(path.join(repoRoot, "lab-output")) && !packageHadLabOutput).toBe(false);
    for (const project of projects) expect(await snapshotProjectTree(path.join(projectsRoot, project), { excludedNames: [".git"] })).toEqual(before.get(project));
    expect(existsSync(path.join(outDir, "sandboxes"))).toBe(false);

    const execution = JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-execution.json"), "utf8"));
    const analysis = JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-analysis.json"), "utf8"));
    expect(execution).toMatchObject({ schemaVersion: "my-dev-kit-lab-agent-success-rate-execution-v1", executionMode: "deterministic-fixture", contextEffectEvaluated: false });
    expect(analysis.schemaVersion).toBe("my-dev-kit-lab-agent-success-rate-analysis-v1");
    // RPR-029/030: all six catalog tasks, in catalog order, with both treatments
    const catalog = JSON.parse(readFileSync(path.join(repoRoot, "benchmarks", "contracts", "agent-success-rate-tasks.json"), "utf8"));
    const catalogIds = (Array.isArray(catalog) ? catalog : catalog.tasks).map((task: { id: string }) => task.id);
    expect(catalogIds).toHaveLength(6);
    expect(execution.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(catalogIds);
    expect(execution.cases.flatMap((entry: { treatments: unknown[] }) => entry.treatments)).toHaveLength(12);
    expect(new Set(execution.cases.map((entry: { benchmarkProject: string }) => entry.benchmarkProject))).toEqual(new Set(projects));
    for (const entry of execution.cases) for (const treatment of entry.treatments) expect(treatment).toMatchObject({ status: "completed", availability: "complete" });
    expect(execution.realAgent).toBeUndefined();

    // the three plugin reports
    const report = JSON.parse(readFileSync(path.join(outDir, "report.json"), "utf8")).report;
    expect(report.agentSuccessRate).toMatchObject({ schemaVersion: "my-dev-kit-lab-agent-success-rate-report-v1", identity: { executionMode: "deterministic-fixture", caseCount: 6, treatmentOutcomeCount: 12 } });
    expect(report.plugin.supportedOutputs).toEqual(["json", "html", "text", "artifact"]);
    expect(report.rawRun.analysis).toBeUndefined();
    expect(readFileSync(path.join(outDir, "report.html"), "utf8")).toContain("does not measure a coding agent or the effect of context selection");
    expect(readFileSync(path.join(outDir, "report.txt"), "utf8")).toContain("does not measure a coding agent or the effect of context selection");
  }, 600_000);

  it("RPR-030: --case and --benchmark-project select without reordering the catalog", async () => {
    const workspace = makeTemp("asr-cli-ws-");
    const outDir = path.join(makeTemp("asr-cli-out-"), "run");
    const catalog = JSON.parse(readFileSync(path.join(process.cwd(), "benchmarks", "contracts", "agent-success-rate-tasks.json"), "utf8"));
    const tasks: Array<{ id: string; benchmarkProject: string }> = Array.isArray(catalog) ? catalog : catalog.tasks;
    const [first, second] = [tasks[0]!, tasks[1]!];
    const result = await capture(["--workspace", workspace, "experiment", "run", ...asr("--out", outDir, "--case", `${second.id},${first.id}`)]);
    expect(result.code, result.stderr).toBe(0);
    const execution = JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-execution.json"), "utf8"));
    expect(execution.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual([first.id, second.id]);
  }, 300_000);

  it("RPR-038/039: describe and help match the supported behavior and expose no hidden details", async () => {
    const described = await capture(["experiment", "describe", "--experiment", ID]);
    expect(described.code).toBe(0);
    const json = await capture(["experiment", "describe", "--experiment", ID, "--json"]);
    const description = JSON.parse(json.stdout);
    expect(description.metadata.supportedOutputs).toEqual(["json", "html", "text", "artifact"]);
    expect(description.metadata.supportedTargets).toEqual(["self"]);
    expect(description.agentSuccessRate).toMatchObject({
      treatments: ["raw-full-file", "context-pack"],
      providers: ["codex", "claude"],
      timeoutMs: { default: 240000, maximum: 1800000 },
      repairAttempts: { allowed: [0, 1, 2], default: 0, maximumTotalAttemptsPerTreatment: 3 }
    });
    const text = described.stdout;
    for (const expected of ["deterministic-fixture", "--agent <codex|claude>", "--include-real-agents", "default 240000 ms, maximum 1800000 ms", "Repair attempts: 0, 1, 2", "Source-only", "Guarded", "Self-target only", "report.html", "report.txt"]) {
      expect(text, expected).toContain(expected);
    }
    expect(text).toContain("never the default");
    for (const hidden of ["deterministicFixture", "taskChecks", "behaviorFacts", "expectedEditFiles", "allowedEditFiles", "protectedFiles", "verificationCheckIds"]) {
      expect(text + json.stdout, hidden).not.toContain(hidden);
    }
    expect(text).not.toMatch(/--agents|--strategies|--complexities/);

    const list = await capture(["experiment", "list", "--json"]);
    const entry = JSON.parse(list.stdout).experiments.find((candidate: { id: string }) => candidate.id === ID);
    expect(entry.supportedVariants).toEqual(["raw-full-file", "context-pack"]);

    const help = await capture(["experiment", "run", "--help"]);
    const section = help.stdout.slice(help.stdout.indexOf("agent-success-rate only:"));
    for (const flag of ["--out", "--case", "--benchmark-project", "--kit-command", "--agent <codex|claude>", "--include-real-agents", "--timeout-ms", "--repair-attempts <0|1|2>"]) {
      expect(section, flag).toContain(flag);
    }
    expect(section).toContain("default 240000, maximum 1800000");
    expect(section).toContain("deterministic-fixture mode");
    expect(section).toContain("no winner, ranking, composite score or significance claim");
    expect(help.stdout).toContain("every plugin rejects the options it does not support");
    // every flag the help documents is accepted by the parser; every parser-accepted flag is documented
    const accepted = ["--experiment", "--out", "--case", "--benchmark-project", "--kit-command", "--agent", "--include-real-agents", "--timeout-ms", "--repair-attempts"];
    for (const flag of accepted.slice(1)) expect(section.includes(flag), flag).toBe(true);
    const top = await capture(["experiment", "--help"]);
    expect(top.stdout).toContain("experiment run");
  }, 60_000);
});
