import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderExperimentRunHelp } from "../../src/cli/help.js";
import { runExperimentDescribeCommandFromArgs } from "../../src/commands/runExperimentDescribeCommand.js";
import { runExperimentListCommandFromArgs } from "../../src/commands/runExperimentListCommand.js";
import { parseRunExperimentArgs, runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { verifySyntheticRepositoryMaterialization } from "../../src/evaluation/syntheticRepository/index.js";
import { buildDefaultExperimentOutputRoot } from "../../src/experiments/outputPaths.js";
import { resolveExperimentTarget } from "../../src/experiments/index.js";
import { contextWindowScalingConfigDefinition } from "../../src/experiments/plugins/contextWindowScaling/index.js";
import { createLabExecutionContext } from "../../src/runtime/index.js";

const ID = "context-window-scaling";
const repoRoot = process.cwd();
const FAKE_KIT = `node ${path.join(repoRoot, "tests", "fixtures", "fake-synthetic-kit-cli.cjs")}`;
const SMALL_TS = { id: "synth-ts", language: "typescript", seed: "ctx", sourceFileCount: 6, moduleDepth: 3, internalImportCount: 6, symbolCount: 12, testFileCount: 3, taskLocality: "cross-module", repeatedPatternCount: 3 };
const SMALL_PY = { id: "synth-py", language: "python", seed: "ctx", sourceFileCount: 6, moduleDepth: 3, internalImportCount: 6, symbolCount: 12, testFileCount: 3, taskLocality: "localized", repeatedPatternCount: 3 };
const THIRD_TS = { ...SMALL_TS, id: "aaa-ts", seed: "other", taskLocality: "localized" };
const config = (...cases: unknown[]) => ({ schemaVersion: "1.0.0", cases });
const ARTIFACT = "context-window-scaling-execution.json";
const MANIFEST = "synthetic-repository-manifest.json";

const tempDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(label = "ctx-synth-cmd-"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), label));
  tempDirs.push(dir);
  return dir;
}
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
  return { stdout: () => out.join("\n"), stderr: () => err.join("\n") };
}
function outputLine(stdout: string): string {
  const line = stdout.split("\n").find((entry) => entry.startsWith("Output: "));
  expect(line).toBeDefined();
  return line!.slice("Output: ".length);
}
function writeJson(file: string, value: unknown): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return file;
}
function hashTree(target: string): string {
  const hash = createHash("sha256");
  const walk = (current: string): void => {
    if (statSync(current).isDirectory()) {
      for (const entry of readdirSync(current).sort()) walk(path.join(current, entry));
    } else {
      hash.update(path.relative(target, current)).update(readFileSync(current));
    }
  };
  walk(target);
  return hash.digest("hex");
}
function frozenCorpusHashes(): string[] {
  return [
    "benchmarks/projects/context-window-scaling-fixed-ts",
    "benchmarks/contracts/context-window-scaling-cases.json",
    "benchmarks/contracts/benchmark-project-profiles.json",
  ].map((relative) => hashTree(path.join(repoRoot, relative)));
}
function assertManifests(runDir: string, caseIds: string[]): void {
  for (const caseId of caseIds) {
    const caseDir = path.join(runDir, "synthetic-repositories", caseId);
    const verification = verifySyntheticRepositoryMaterialization({
      manifestPath: path.join(caseDir, MANIFEST),
      repositoryRoot: path.join(caseDir, "repository"),
    });
    expect(verification.issues).toEqual([]);
    expect(verification.ok).toBe(true);
  }
}

describe("--synthetic-config parsing", () => {
  const parse = (...args: string[]) => parseRunExperimentArgs(["--experiment", ID, ...args]);

  it("accepts the selector alone and with --out, --context-budgets and --kit-command", () => {
    expect(parse("--synthetic-config", "config.json").syntheticConfigPath).toBe("config.json");
    expect(parse("--synthetic-config", "config.json", "--out", "out")).toMatchObject({ syntheticConfigPath: "config.json", outDir: "out" });
    expect(parse("--synthetic-config", "config.json", "--context-budgets", "8k,16k").config).toEqual({ contextBudgets: [8192, 16384] });
    expect(parse("--synthetic-config", "config.json", "--kit-command", "kit").config).toEqual({ kitCommand: "kit" });
  });

  it("keeps the selector out of the scientific plugin config", () => {
    expect(parse("--synthetic-config", "config.json").config).toEqual({});
    expect(contextWindowScalingConfigDefinition.fields.map((field) => field.name)).toEqual(["contextBudgets", "kitCommand"]);
  });

  it("keeps the bundled default when the selector is absent", () => {
    expect(parse().syntheticConfigPath).toBeUndefined();
    expect(parse("--case", "a").config).toEqual({ caseIds: ["a"] });
  });

  it("rejects --case together with --synthetic-config in either order", () => {
    expect(() => parse("--synthetic-config", "c.json", "--case", "a")).toThrow(/mutually exclusive/);
    expect(() => parse("--case", "a", "--synthetic-config", "c.json")).toThrow(/mutually exclusive/);
  });

  it("rejects a repeated or valueless selector", () => {
    expect(() => parse("--synthetic-config", "a.json", "--synthetic-config", "b.json")).toThrow(/only once/);
    expect(() => parse("--synthetic-config")).toThrow(/requires a value/);
  });

  it("rejects the selector for every other plugin", () => {
    for (const other of ["context-strategy-comparison", "warm-index-reuse", "incremental-change-staleness"]) {
      expect(() => parseRunExperimentArgs(["--experiment", other, "--synthetic-config", "c.json"])).toThrow(
        `--synthetic-config is only supported for --experiment ${ID}.`
      );
    }
  });

  it("keeps the other context-window-scaling flags unsupported", () => {
    for (const flag of ["--cases", "--project-profiles", "--benchmark-project", "--campaign", "--agents", "--include-real-agents", "--strategies", "--complexities", "--timeout-ms", "--max-runs", "--require-agents"]) {
      const extra = ["--include-real-agents", "--require-agents"].includes(flag) ? [] : [flag === "--campaign" ? "codex-full" : flag === "--agents" ? "fake-agent" : flag === "--strategies" ? "raw-full-file" : flag === "--complexities" ? "short" : flag === "--timeout-ms" || flag === "--max-runs" ? "5" : "x"];
      expect(() => parse("--synthetic-config", "c.json", flag, ...extra)).toThrow(new RegExp(`${flag} is not supported`));
    }
  });
});

describe("public surface text", () => {
  it("documents the selector in help", () => {
    const help = renderExperimentRunHelp();
    expect(help).toContain("--synthetic-config <path>");
    expect(help).toMatch(/Mutually exclusive\s+with --case/);
    expect(help).toContain("bundled four-case catalog");
  });

  it("lists one plugin entry and describes the selector without making it a config field", async () => {
    const list = capture();
    expect(await runExperimentListCommandFromArgs(["--json"])).toBe(0);
    const listed = JSON.parse(list.stdout()) as { experiments: Array<{ id: string; description: string }> };
    expect(listed.experiments.filter((entry) => entry.id === ID)).toHaveLength(1);
    expect(listed.experiments.find((entry) => entry.id === ID)!.description).toContain("synthetic");
    vi.restoreAllMocks();

    const described = capture();
    expect(await runExperimentDescribeCommandFromArgs(["--experiment", ID, "--json"])).toBe(0);
    const body = JSON.parse(described.stdout()) as { optionalConfigFields: Array<{ name: string }>; requiredConfigFields: unknown[]; examples: string[]; targetBehavior: string };
    expect(body.optionalConfigFields.map((field) => field.name)).toEqual(["contextBudgets", "kitCommand"]);
    expect(body.requiredConfigFields).toEqual([]);
    expect(body.examples.some((example) => example.includes("--synthetic-config"))).toBe(true);
    expect(body.targetBehavior).toContain("--synthetic-config");
  });
});

describe("public synthetic run", () => {
  it("resolves config and --out against the invocation cwd and generates TypeScript, Python and extra cases in order", async () => {
    const cwd = tempDir("ctx synth cwd ");
    const configPath = writeJson(path.join(cwd, "inputs", "synthetic.json"), config(SMALL_TS, SMALL_PY, THIRD_TS));
    const configBefore = readFileSync(configPath, "utf8");
    const corpusBefore = frozenCorpusHashes();
    const repoEntriesBefore = readdirSync(repoRoot).sort();
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(
      ["--experiment", ID, "--synthetic-config", path.join("inputs", "synthetic.json"), "--out", "run", "--context-budgets", "8k,16k", "--kit-command", FAKE_KIT],
      { context: createLabExecutionContext({ invocationCwd: cwd }) }
    );
    expect(output.stderr()).toBe("");
    expect(code).toBe(0);

    const runDir = path.join(cwd, "run");
    expect(path.resolve(outputLine(output.stdout()))).toBe(runDir);
    expect(readdirSync(path.join(runDir, "synthetic-repositories")).sort()).toEqual(["aaa-ts", "synth-py", "synth-ts"]);
    assertManifests(runDir, ["aaa-ts", "synth-py", "synth-ts"]);
    for (const name of [ARTIFACT, "report.json", "report.txt", "report.html"]) expect(existsSync(path.join(runDir, name))).toBe(true);

    const artifactText = readFileSync(path.join(runDir, ARTIFACT), "utf8");
    const artifact = JSON.parse(artifactText);
    expect(artifact.schemaVersion).toBe("my-dev-kit-lab-context-window-scaling-execution-v1");
    expect(artifact.contextBudgets).toEqual([8192, 16384]);
    expect(artifact.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(["aaa-ts-task", "synth-py-task", "synth-ts-task"]);
    for (const hostPath of [cwd, runDir, configPath, "synthetic-repositories", MANIFEST]) {
      expect(artifactText).not.toContain(hostPath);
      expect(artifactText).not.toContain(JSON.stringify(hostPath).slice(1, -1));
    }
    expect(artifactText).toContain("raw-full-file");
    expect(artifactText).toContain("my-dev-kit-guided");

    expect(readFileSync(configPath, "utf8")).toBe(configBefore);
    expect(readdirSync(repoRoot).sort()).toEqual(repoEntriesBefore);
    expect(frozenCorpusHashes()).toEqual(corpusBefore);
  }, 180_000);

  it("lands synthetic repositories and artifacts under the same installed workspace default", async () => {
    const workspaceRoot = tempDir("ctx-synth-ws-");
    const packageRoot = tempDir("ctx-synth-pkg-");
    const cwd = tempDir("ctx-synth-cwd-");
    const configPath = writeJson(path.join(cwd, "c.json"), config(SMALL_TS));
    const packageBefore = readdirSync(packageRoot);
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(["--experiment", ID, "--synthetic-config", configPath, "--context-budgets", "8k", "--kit-command", FAKE_KIT], {
      context: { ...createLabExecutionContext({ invocationCwd: cwd, workspaceRoot }), packageRoot },
      installedDefaultOutputRoot: workspaceRoot,
    });
    expect(output.stderr()).toBe("");
    expect(code).toBe(0);
    const runDir = outputLine(output.stdout());
    expect(path.relative(path.join(workspaceRoot, "lab-output", "experiments", ID), runDir).startsWith("..")).toBe(false);
    expect(existsSync(path.join(runDir, ARTIFACT))).toBe(true);
    assertManifests(runDir, ["synth-ts"]);
    expect(readdirSync(packageRoot)).toEqual(packageBefore);
  }, 120_000);

  it("uses the generic runner default root when neither --out nor an installed root is given", async () => {
    const toolRoot = tempDir("ctx-synth-tool-");
    writeJson(path.join(toolRoot, "package.json"), { name: "synthetic-tool", version: "1.2.3" });
    const cwd = tempDir("ctx-synth-cwd-");
    const configPath = writeJson(path.join(cwd, "c.json"), config(SMALL_PY));
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(["--experiment", ID, "--synthetic-config", configPath, "--context-budgets", "8k", "--kit-command", FAKE_KIT], {
      context: createLabExecutionContext({ invocationCwd: cwd, packageRoot: toolRoot }),
    });
    expect(output.stderr()).toBe("");
    expect(code).toBe(0);
    const runDir = path.resolve(outputLine(output.stdout()));
    const runId = path.basename(runDir);
    expect(runId.startsWith(`${ID}-`)).toBe(true);
    expect(runDir).toBe(
      path.resolve(buildDefaultExperimentOutputRoot({ toolRoot, pluginId: ID, target: resolveExperimentTarget(undefined, toolRoot), runId }))
    );
    expect(existsSync(path.join(runDir, ARTIFACT))).toBe(true);
    assertManifests(runDir, ["synth-py"]);
  }, 120_000);

  it.each([
    ["missing file", () => undefined],
    ["malformed JSON", () => "{not json"],
    ["non-object", () => "[]"],
    ["wrong schema id", () => ({ schemaVersion: "9.9.9", cases: [SMALL_TS] })],
    ["unknown config field", () => ({ schemaVersion: "1.0.0", cases: [SMALL_TS], extra: true })],
    ["empty cases", () => config()],
    ["unsafe case id", () => config({ ...SMALL_TS, id: "../escape" })],
    ["infeasible dimensions", () => config({ ...SMALL_TS, internalImportCount: 9999 })],
  ])("fails before execution for %s", async (_label, build) => {
    const cwd = tempDir();
    const content = build();
    if (content !== undefined) writeJson(path.join(cwd, "bad.json"), content);
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(["--experiment", ID, "--synthetic-config", "bad.json", "--out", "run", "--kit-command", FAKE_KIT], {
      context: createLabExecutionContext({ invocationCwd: cwd }),
    });
    expect(code).toBe(1);
    expect(output.stderr().length).toBeGreaterThan(0);
    const runDir = path.join(cwd, "run");
    for (const name of [ARTIFACT, "report.json", "report.txt", "report.html"]) expect(existsSync(path.join(runDir, name))).toBe(false);
  });

  it("fails before execution on a materialization collision", async () => {
    const cwd = tempDir();
    writeJson(path.join(cwd, "c.json"), config(SMALL_TS));
    writeJson(path.join(cwd, "run", "synthetic-repositories", "synth-ts", "foreign.txt"), "x");
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(["--experiment", ID, "--synthetic-config", "c.json", "--out", "run", "--kit-command", FAKE_KIT], {
      context: createLabExecutionContext({ invocationCwd: cwd }),
    });
    expect(code).toBe(1);
    expect(output.stderr()).toMatch(/collision/);
    for (const name of [ARTIFACT, "report.json", "report.txt", "report.html"]) expect(existsSync(path.join(cwd, "run", name))).toBe(false);
  });
});
