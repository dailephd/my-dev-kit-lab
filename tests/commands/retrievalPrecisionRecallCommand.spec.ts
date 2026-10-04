import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRunExperimentArgs, runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { createLabExecutionContext } from "../../src/runtime/index.js";

const ID = "retrieval-precision-recall";
const tempDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

/** An upstream-shaped stand-in kit: indexes succeed and search returns a trustworthy empty result. Every call is logged. */
function writeEmptySearchKit(dir: string): { kitCommand: string; log: string } {
  const log = path.join(dir, "kit-calls.log");
  const script = path.join(dir, "empty-search-kit.mjs");
  writeFileSync(
    script,
    [
      `import fs from "node:fs";`,
      `const argv = process.argv.slice(2);`,
      `fs.appendFileSync(${JSON.stringify(log)}, argv[0] + "\\n");`,
      `if (argv[0] === "index") {`,
      `  const out = argv[argv.indexOf("--out") + 1];`,
      `  fs.mkdirSync(out, { recursive: true });`,
      `  fs.writeFileSync(out + "/manifest.json", "{}");`,
      `  console.log(JSON.stringify({ mode: "index" }));`,
      `} else if (argv[0] === "search") {`,
      `  console.log(JSON.stringify({ artifactKind: "my-dev-kit-v1-search-result", version: "1.0.0", results: [] }));`,
      `} else { process.exit(1); }`
    ].join("\n")
  );
  return { kitCommand: `node ${script}`, log };
}

const callsOf = (log: string) => readFileSync(log, "utf8").split("\n").filter(Boolean);

async function runCommand(argv: string[], context = createLabExecutionContext()): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void err.push(args.join(" ")));
  const exitCode = await runExperimentRunCommandFromArgs(argv, { context });
  return { exitCode, stdout: out.join("\n"), stderr: err.join("\n") };
}

function runNpm(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const execPath = process.env.npm_execpath;
  const [command, prefix] = execPath ? [process.execPath, [execPath]] : [process.platform === "win32" ? "npm.cmd" : "npm", []];
  const result = spawnSync(command, [...prefix, ...args], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 1024 * 1024 * 10 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr || (result.error ? String(result.error) : "") };
}

describe("experiment npm scripts for retrieval-precision-recall", () => {
  it("TST-B3-018 experiment:list exposes the plugin", () => {
    const result = runNpm(["run", "--silent", "experiment:list", "--", "--json"]);
    expect(result.status).toBe(0);
    const entry = JSON.parse(result.stdout).experiments.find((candidate: { id: string }) => candidate.id === ID);
    expect(entry).toEqual(expect.objectContaining({ id: ID, status: "experimental", supportedVariants: ["my-dev-kit-retrieval"] }));
    expect(entry.supportedOutputs).toEqual(["json", "html", "text", "artifact"]);
  }, 30000);

  it("TST-B3-019 experiment:describe reports the contract accurately", () => {
    const result = runNpm(["run", "--silent", "experiment:describe", "--", "--experiment", ID]);
    expect(result.status).toBe(0);
    for (const line of [
      "Retrieval Precision/Recall",
      "Status: experimental",
      "Schema version: 1.0.0",
      "Supported targets: self",
      "Supported outputs: json, html, text, artifact",
      "Supported variants: my-dev-kit-retrieval",
      "outDir (string)",
      "kitCommand (string)",
      "caseIds (array)",
      "benchmarkProjects (array)"
    ]) {
      expect(result.stdout, line).toContain(line);
    }
    expect(result.stdout).not.toMatch(/casesPath|projectProfilesPath|plot|screenshot/);
  }, 30000);
});

describe("experiment:run argument contract for retrieval-precision-recall", () => {
  it("TST-B3-021 accepts exactly --case, --benchmark-project, --out and --kit-command", () => {
    const parsed = parseRunExperimentArgs(["--experiment", ID, "--out", "some/dir", "--case", "a,b", "--case", "c", "--benchmark-project", "p", "--kit-command", "node kit.js"]);
    expect(parsed.experimentId).toBe(ID);
    expect(parsed.outDir).toBe("some/dir");
    expect(parsed.targetPath).toBeUndefined();
    expect(parsed.config).toEqual({ caseIds: ["a", "b", "c"], benchmarkProjects: ["p"], kitCommand: "node kit.js" });
    expect(parseRunExperimentArgs(["--experiment", ID]).config).toEqual({});
  });

  it("TST-B3-022 rejects every unsupported flag instead of ignoring it", () => {
    const unsupported: string[][] = [
      ["--target", "C:\\somewhere"],
      ["--cases", "x.json"],
      ["--project-profiles", "x.json"],
      ["--synthetic-config", "x.json"],
      ["--local-subject-config", "x.json"],
      ["--agents", "fake-agent"],
      ["--strategies", "raw-full-file"],
      ["--complexities", "short"],
      ["--timeout-ms", "100"],
      ["--max-runs", "1"],
      ["--continue-on-failure"],
      ["--no-continue-on-failure"],
      ["--require-agents"],
      ["--include-real-agents"],
      ["--command-template-codex", "codex {prompt}"],
      ["--command-template-claude", "claude {prompt}"],
      ["--context-budgets", "100,200"],
      ["--campaign", "some-campaign"],
      ["--no-screenshot"]
    ];
    for (const extra of unsupported) {
      expect(() => parseRunExperimentArgs(["--experiment", ID, ...extra]), extra[0]).toThrow();
    }
    expect(() => parseRunExperimentArgs(["--experiment", ID, "--target", "x"])).toThrow(
      `--target is not supported for --experiment ${ID}; supported options: --experiment, --out, --case, --benchmark-project, --kit-command.`
    );
    expect(() => parseRunExperimentArgs(["--experiment", ID, "--cases", "x", "--agents", "fake-agent"])).toThrow(/--cases, --agents are not supported/);
  });
});

describe("experiment:run for retrieval-precision-recall over the bundled corpus", () => {
  it("TST-B3-020 loads the packaged corpus through the resource resolver, builds one index per project and writes the outputs", async () => {
    const dir = tempDir("rpr-cmd-");
    const { kitCommand, log } = writeEmptySearchKit(dir);
    const out = path.join(dir, "out");
    const result = await runCommand(["--experiment", ID, "--out", out, "--kit-command", kitCommand], createLabExecutionContext({ invocationCwd: dir }));
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Experiment: ${ID}`);
    expect(result.stdout).toContain("Status: completed");

    const calls = callsOf(log);
    expect(calls.filter((call) => call === "index")).toHaveLength(2);
    expect(calls.filter((call) => call === "search")).toHaveLength(12);
    expect(calls.filter((call) => call !== "index" && call !== "search")).toEqual([]);

    const artifact = JSON.parse(readFileSync(path.join(out, "retrieval-precision-recall-execution.json"), "utf8"));
    expect(artifact.cases).toHaveLength(12);
    expect(artifact.aggregate.runSummary).toMatchObject({ projectCount: 2, caseCount: 12, completedCaseCount: 12 });
    // A trustworthy empty retrieval is a completed measurement: recall is a real 0, precision is not-applicable, and
    // fact coverage is computed (not unavailable) because the bundled corpus carries complete fact mappings.
    expect(artifact.cases[0].quality.file.recall).toMatchObject({ availability: "available", value: 0 });
    expect(artifact.cases[0].quality.file.precision.availability).toBe("not-applicable");
    expect(artifact.cases[0].quality.fact.coverage).toMatchObject({ availability: "available", value: 0 });
    expect(artifact.aggregate.ratios.factCoverage).toMatchObject({ availableCount: 12, unavailableCount: 0 });

    const report = JSON.parse(readFileSync(path.join(out, "report.json"), "utf8")).report;
    expect(report.plugin.id).toBe(ID);
    expect(report.retrievalPrecisionRecall.cases).toHaveLength(12);
    expect(readFileSync(path.join(out, "report.txt"), "utf8")).toContain("Retrieval Precision/Recall");
    expect(readFileSync(path.join(out, "report.html"), "utf8")).toContain("Retrieval Precision/Recall");
  }, 60000);

  it("resolves the corpus from the context resource root, not the working directory", async () => {
    const dir = tempDir("rpr-cmd-");
    const resourceRoot = path.join(dir, "resources");
    mkdirSync(path.join(resourceRoot, "benchmarks", "contracts"), { recursive: true });
    cpSync(path.resolve("benchmarks/contracts/benchmark-project-profiles.json"), path.join(resourceRoot, "benchmarks/contracts/benchmark-project-profiles.json"));
    const corpus = JSON.parse(readFileSync(path.resolve("benchmarks/contracts/warm-index-benchmark-cases.json"), "utf8"));
    writeFileSync(path.join(resourceRoot, "benchmarks/contracts/warm-index-benchmark-cases.json"), JSON.stringify(corpus.slice(0, 3)));

    const { kitCommand } = writeEmptySearchKit(dir);
    const out = path.join(dir, "out");
    const base = createLabExecutionContext({ invocationCwd: dir });
    const result = await runCommand(["--experiment", ID, "--out", out, "--kit-command", kitCommand], { ...base, resourceRoot });
    expect(result.exitCode, result.stderr).toBe(0);
    const artifact = JSON.parse(readFileSync(path.join(out, "retrieval-precision-recall-execution.json"), "utf8"));
    expect(artifact.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(corpus.slice(0, 3).map((entry: { id: string }) => entry.id));
  }, 60000);

  it("applies --case and --benchmark-project filters in corpus order", async () => {
    const dir = tempDir("rpr-cmd-");
    const { kitCommand, log } = writeEmptySearchKit(dir);
    const out = path.join(dir, "out");
    const result = await runCommand(["--experiment", ID, "--out", out, "--kit-command", kitCommand, "--case", "warm-large-ts-leaderboard,warm-medium-complete-idempotent"]);
    expect(result.exitCode, result.stderr).toBe(0);
    const artifact = JSON.parse(readFileSync(path.join(out, "retrieval-precision-recall-execution.json"), "utf8"));
    expect(artifact.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(["warm-medium-complete-idempotent", "warm-large-ts-leaderboard"]);
    expect(callsOf(log).filter((call) => call === "index")).toHaveLength(2);

    const projectOut = path.join(dir, "out-project");
    const byProject = await runCommand(["--experiment", ID, "--out", projectOut, "--kit-command", kitCommand, "--benchmark-project", "task-analytics-large-mixed"]);
    expect(byProject.exitCode, byProject.stderr).toBe(0);
    const projectArtifact = JSON.parse(readFileSync(path.join(projectOut, "retrieval-precision-recall-execution.json"), "utf8"));
    expect(projectArtifact.cases).toHaveLength(6);
  }, 60000);

  it("fails cleanly for unknown selections without writing an artifact", async () => {
    const dir = tempDir("rpr-cmd-");
    const { kitCommand } = writeEmptySearchKit(dir);
    const out = path.join(dir, "out");
    const result = await runCommand(["--experiment", ID, "--out", out, "--kit-command", kitCommand, "--case", "does-not-exist"]);
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stdout).toContain("Status: failed");
    const report = JSON.parse(readFileSync(path.join(out, "report.json"), "utf8")).report;
    expect(report.metadata.status).toBe("failed");
    expect(report.retrievalPrecisionRecall).toBeNull();
    expect(report.failures[0].message).toContain("Evaluation case not found: does-not-exist");
    expect(() => readFileSync(path.join(out, "retrieval-precision-recall-execution.json"))).toThrow();
  }, 60000);
});
