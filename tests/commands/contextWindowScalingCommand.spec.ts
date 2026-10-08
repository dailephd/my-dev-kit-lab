import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runExperimentDescribeCommandFromArgs } from "../../src/commands/runExperimentDescribeCommand.js";
import { runExperimentListCommandFromArgs } from "../../src/commands/runExperimentListCommand.js";
import { parseRunExperimentArgs, runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { runGenerateExperimentPlotsCommand } from "../../src/commands/generateExperimentPlotsCommand.js";
import { parseContextBudgetsCliValue } from "../../src/experiments/plugins/contextWindowScaling/index.js";
import { CONTEXT_WINDOW_SCALING_PLOT_IDS } from "../../src/plots/index.js";
import { renderExperimentRunHelp } from "../../src/cli/help.js";

const ID = "context-window-scaling";
const FAKE_KIT = `node ${path.join(process.cwd(), "tests", "fixtures", "fake-context-scaling-kit-cli.js")}`;
const parse = (...args: string[]) => parseRunExperimentArgs(["--experiment", ID, ...args]);

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
  return { stdout: () => out.join("\n"), stderr: () => err.join("\n") };
}
afterEach(() => vi.restoreAllMocks());

describe("--context-budgets parsing", () => {
  it.each([
    ["8k", [8192]],
    ["16k", [16384]],
    ["32k", [32768]],
    ["64k", [65536]],
    ["8k,16k,32k,64k", [8192, 16384, 32768, 65536]],
    ["12000", [12000]],
    ["1", [1]],
    ["8k,12000,32k", [8192, 12000, 32768]],
    ["32k,8k,12000", [8192, 12000, 32768]],
    [" 8k , 12000 ", [8192, 12000]],
  ])("normalizes %s", (value, expected) => {
    expect(parseContextBudgetsCliValue(value)).toEqual(expected);
  });

  it.each(["12k", "8K", "8kb", "0", "-1", "1.5", "NaN", "Infinity", "0x2000", "1e4", "8192tokens", "007", "", " ", "8k,,16k", "99999999999999999999"])(
    "rejects %j",
    (value) => {
      expect(() => parseContextBudgetsCliValue(value)).toThrow(/--context-budgets/);
    }
  );

  it("rejects duplicates after normalization instead of deduplicating", () => {
    expect(() => parseContextBudgetsCliValue("8k,8192")).toThrow(/duplicate/);
    expect(() => parseContextBudgetsCliValue("12000,12000")).toThrow(/duplicate/);
  });

  it("maps to the plugin config and defaults to the internal standard budgets", () => {
    expect(parse("--context-budgets", "32k,8k,12000").config).toEqual({ contextBudgets: [8192, 12000, 32768] });
    expect(parse().config).toEqual({});
  });
});

describe("context-window-scaling option isolation", () => {
  it("accepts --out, --case, --context-budgets and --kit-command", () => {
    const parsed = parse("--out", "o", "--case", "a,b", "--context-budgets", "8k", "--kit-command", "kit");
    expect(parsed.outDir).toBe("o");
    expect(parsed.config).toEqual({ caseIds: ["a", "b"], contextBudgets: [8192], kitCommand: "kit" });
  });

  it.each([
    ["--cases", "x.json"],
    ["--project-profiles", "x.json"],
    ["--benchmark-project", "p"],
    ["--campaign", "codex-full"],
    ["--include-real-agents"],
    ["--agents", "fake-agent"],
    ["--strategies", "raw-full-file"],
    ["--complexities", "short"],
    ["--timeout-ms", "5"],
    ["--max-runs", "1"],
    ["--require-agents"],
  ])("rejects %s", (...flag) => {
    expect(() => parse(...flag)).toThrow(new RegExp(`${flag[0]} is not supported for --experiment ${ID}`));
  });

  it("rejects an empty --case list", () => {
    expect(() => parse("--case", ",")).toThrow(/at least one case id/);
  });

  it("rejects --context-budgets for every other plugin", () => {
    for (const other of ["context-strategy-comparison", "warm-index-reuse", "incremental-change-staleness"]) {
      expect(() => parseRunExperimentArgs(["--experiment", other, "--context-budgets", "8k"])).toThrow(
        `--context-budgets is only supported for --experiment ${ID}.`
      );
    }
  });

  it("rejects invalid budgets through the public command with a nonzero exit", async () => {
    for (const bad of ["12k", "8k,8192", "0"]) {
      const output = capture();
      expect(await runExperimentRunCommandFromArgs(["--experiment", ID, "--context-budgets", bad])).toBe(1);
      expect(output.stderr()).toContain("--context-budgets");
      vi.restoreAllMocks();
    }
  });

  it("rejects --target, --cases, and unknown cases through the public command", async () => {
    for (const args of [["--target", "."], ["--cases", "something.json"], ["--case", "not-a-real-case"], ["--case", "ctx-scale-a-8k-16k,ctx-scale-a-8k-16k"]]) {
      const output = capture();
      expect(await runExperimentRunCommandFromArgs(["--experiment", ID, "--kit-command", FAKE_KIT, ...args])).toBe(1);
      expect(output.stderr().length).toBeGreaterThan(0);
      vi.restoreAllMocks();
    }
  });

  it("documents the options in bounded help", () => {
    const help = renderExperimentRunHelp();
    expect(help).toContain("context-window-scaling only:");
    expect(help).toContain("--context-budgets <values>");
    expect(help).toContain("warm-index-reuse, incremental-change-staleness, context-window-scaling, retrieval-precision-recall, retrieval-query-strategy-comparison, and context-pack-generation");
  });
});

describe("public list and describe", () => {
  it("lists the plugin as experimental with the final outputs", async () => {
    const output = capture();
    expect(await runExperimentListCommandFromArgs(["--json"])).toBe(0);
    const listed = JSON.parse(output.stdout()) as { experiments: Array<Record<string, unknown>> };
    expect(listed.experiments.map((e) => e.id)).toEqual(["context-strategy-comparison", "warm-index-reuse", "incremental-change-staleness", ID, "retrieval-precision-recall", "retrieval-query-strategy-comparison", "context-pack-generation", "agent-success-rate"]);
    expect(listed.experiments.find((e) => e.id === ID)).toMatchObject({
      id: ID,
      status: "experimental",
      supportedTargets: ["self", "external-local"],
      supportedVariants: ["raw-full-file", "my-dev-kit-guided"],
      supportedOutputs: ["json", "text", "html", "plot"],
    });
  });

  it("describes identity, targets, variants, outputs and config fields", async () => {
    const output = capture();
    expect(await runExperimentDescribeCommandFromArgs(["--experiment", ID, "--json"])).toBe(0);
    const described = JSON.parse(output.stdout()) as {
      metadata: Record<string, unknown>;
      supportedVariants: string[];
      optionalConfigFields: Array<{ name: string }>;
    };
    expect(described.metadata).toMatchObject({
      id: ID,
      name: "Context Window Scaling",
      status: "experimental",
      schemaVersion: "1.0.0",
      supportedTargets: ["self", "external-local"],
      supportedOutputs: ["json", "text", "html", "plot"],
    });
    expect(described.supportedVariants).toEqual(["raw-full-file", "my-dev-kit-guided"]);
    expect(described.optionalConfigFields.map((f) => f.name)).toEqual(["contextBudgets", "kitCommand"]);
  });
});

describe("public run, persisted-artifact plots, and plot routing", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "ctx-cli-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs a filtered bundled case with custom budgets and writes artifact, reports, then plots", async () => {
    const runDir = path.join(root, "run");
    const plotsDir = path.join(root, "plots");
    const run = capture();
    const code = await runExperimentRunCommandFromArgs([
      "--experiment", ID,
      "--case", "ctx-scale-b-16k-32k",
      "--context-budgets", "32k,8k,12000",
      "--kit-command", FAKE_KIT,
      "--out", runDir,
    ]);
    expect(run.stderr()).toBe("");
    expect(code).toBe(0);
    vi.restoreAllMocks();
    expect((await readdir(runDir)).filter((n) => /^(context-window-scaling-execution\.json|report\.(json|txt|html))$/.test(n)).sort()).toEqual([
      "context-window-scaling-execution.json",
      "report.html",
      "report.json",
      "report.txt",
    ]);
    expect(existsSync(path.join(runDir, "charts"))).toBe(false);

    const artifact = JSON.parse(await readFile(path.join(runDir, "context-window-scaling-execution.json"), "utf8"));
    expect(artifact.schemaVersion).toBe("my-dev-kit-lab-context-window-scaling-execution-v1");
    expect(artifact.contextBudgets).toEqual([8192, 12000, 32768]);
    expect(artifact.cases.map((c: { caseId: string }) => c.caseId)).toEqual(["ctx-scale-b-16k-32k"]);

    const plots = capture();
    expect(await runGenerateExperimentPlotsCommand(["--experiment", runDir, "--out", plotsDir])).toBe(0);
    expect(plots.stdout()).toContain("Charts: 3");
    expect((await readdir(path.join(plotsDir, "charts"))).sort()).toEqual(CONTEXT_WINDOW_SCALING_PLOT_IDS.map((id) => `${id}.svg`).sort());
    const data = JSON.parse(await readFile(path.join(plotsDir, "plot-data.json"), "utf8")) as {
      plots: Array<{ id: string; points: Array<{ x: number; y: number; group: string }> }>;
      skippedPoints: Array<{ plotId: string; label: string }>;
    };
    const rate = data.plots.find((p) => p.id === "context-window-scaling-success-rate-by-budget")!;
    expect([...new Set(rate.points.map((p) => p.x))]).toEqual([8192, 12000, 32768]);
    const correctness = data.plots.find((p) => p.id === "context-window-scaling-correctness-by-budget")!;
    expect(correctness.points.some((p) => p.group === "raw-full-file" && p.x === 8192)).toBe(false);
    expect(data.skippedPoints).toContainEqual({ plotId: correctness.id, label: "raw-full-file 8k", reason: "correctness-unavailable" });
  }, 180_000);

  it("fails plot generation cleanly for an invalid or foreign-schema artifact", async () => {
    const dir = path.join(root, "bad");
    const artifactPath = path.join(dir, "context-window-scaling-execution.json");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    for (const [content, message] of [
      [JSON.stringify({ schemaVersion: "my-dev-kit-lab-context-window-scaling-execution-v2" }), "unsupported schemaVersion"],
      [JSON.stringify({ schemaVersion: "my-dev-kit-lab-context-window-scaling-execution-v1", contextBudgets: [0], cases: [] }), "contextBudgets"],
      ["{not json", "not valid JSON"],
    ] as const) {
      await writeFile(artifactPath, content, "utf8");
      const output = capture();
      expect(await runGenerateExperimentPlotsCommand(["--experiment", dir, "--out", path.join(root, "bad-out")])).toBe(1);
      expect(output.stderr()).toContain(message);
      vi.restoreAllMocks();
    }
  });

  it("fails as ambiguous when scaling and warm-index evidence share a directory", async () => {
    const source = path.join(root, "run");
    const dir = path.join(root, "ambiguous");
    const { mkdir, copyFile } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await copyFile(path.join(source, "context-window-scaling-execution.json"), path.join(dir, "context-window-scaling-execution.json"));
    await writeFile(
      path.join(dir, "report.json"),
      JSON.stringify({ report: { plugin: { id: "warm-index-reuse" }, warmIndexReuse: { schemaVersion: "my-dev-kit-lab-warm-index-reuse-report-v1", projects: [] } } }),
      "utf8"
    );
    const output = capture();
    const code = await runGenerateExperimentPlotsCommand(["--experiment", dir, "--out", path.join(root, "amb-out")]);
    expect(code).toBe(1);
    expect(output.stderr()).toMatch(/Ambiguous experiment directory|Invalid warm-index-reuse/);
  });
});
