import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderExperimentRunHelp } from "../../src/cli/help.js";
import { parseRunExperimentArgs, runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { runExperimentDescribeCommandFromArgs } from "../../src/commands/runExperimentDescribeCommand.js";
import { runExperimentListCommandFromArgs } from "../../src/commands/runExperimentListCommand.js";
import { RETRIEVAL_QUERY_STRATEGY_IDS } from "../../src/evaluation/retrievalQueryStrategies.js";
import { createDefaultExperimentPluginRegistry } from "../../src/experiments/index.js";
import { createLabExecutionContext } from "../../src/runtime/index.js";
import { makeTempDir, removeTempDir } from "../evaluation/localRepositorySubject/fixtureRepository.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const ID = "context-pack-generation";
const PRIOR_IDS = [
  "context-strategy-comparison",
  "warm-index-reuse",
  "incremental-change-staleness",
  "context-window-scaling",
  "retrieval-precision-recall",
  "retrieval-query-strategy-comparison"
];

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
  delete process.env.CPG_KIT_LOG;
  for (const directory of dirs.splice(0)) removeTempDir(directory);
});

/** Small deterministic stand-in for my-dev-kit that speaks the JSON shapes the plugin consumes and logs every argv. */
function writeFakeKit(directory: string): string {
  mkdirSync(directory, { recursive: true });
  const script = path.join(directory, "fake-kit.mjs");
  writeFileSync(
    script,
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      "const argv = process.argv.slice(2);",
      "const value = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };",
      "if (process.env.CPG_KIT_LOG) fs.appendFileSync(process.env.CPG_KIT_LOG, JSON.stringify({ argv }) + '\\n');",
      "const command = argv[0];",
      'if (command === "--version") console.log("1.12.5");',
      'else if (command === "index") {',
      '  const out = value("--out"); fs.mkdirSync(out, { recursive: true });',
      '  fs.writeFileSync(path.join(out, "symbol-index.json"), JSON.stringify({ schemaVersion: "2", fileCount: 1, files: [{ path: "src/a.ts", lineCount: 10, symbols: [{ name: "A", location: { file: "src/a.ts", line: 1 } }] }] }));',
      '  console.log("{}");',
      '} else if (command === "search") console.log(JSON.stringify({ results: [{ kind: "symbol", id: "symbol:src/a.ts#A", nodeId: "symbol:src/a.ts#A", label: "A", path: "src/a.ts" }] }));',
      'else if (command === "lookup") console.log(JSON.stringify({ status: "found", node: { id: value("--node"), kind: "symbol", path: "src/a.ts", symbolName: "A", line: 1 } }));',
      'else if (command === "slice") console.log(JSON.stringify({ nodes: [{ id: "symbol:src/a.ts#A", kind: "symbol", path: "src/a.ts", symbolName: "A", line: 1 }], edges: [] }));',
      'else if (command === "source") console.log(JSON.stringify({ status: "ok", mode: "line-range", startLine: 1, endLine: 10, content: "a\\nb", continuationCursor: { eof: true, symbolBoundaryKnown: true } }));',
      "else process.exit(1);"
    ].join("\n")
  );
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
}

const readLog = (logPath: string): { argv: string[] }[] =>
  existsSync(logPath)
    ? readFileSync(logPath, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { argv: string[] })
    : [];

describe("registry, list and describe", () => {
  it("registers exactly one new plugin and keeps every earlier id and order", () => {
    const registry = createDefaultExperimentPluginRegistry();
    const ids = registry.list().map((plugin) => plugin.id);
    expect(ids).toEqual([...PRIOR_IDS, ID, "agent-success-rate"]);
    expect(ids.filter((id) => id === ID)).toHaveLength(1);
    expect(registry.describe(ID)).toEqual({
      id: ID,
      name: "Context Pack Generation",
      description: expect.any(String),
      schemaVersion: "1.0.0",
      status: "experimental",
      supportedTargets: ["self", "external-local"],
      supportedOutputs: ["json", "html", "text", "artifact"]
    });
    expect(registry.get(ID).supportedVariants).toEqual(["raw-full-file", "context-pack"]);
  });

  it("lists the new experiment and still lists every existing one", async () => {
    const output = capture();
    expect(await runExperimentListCommandFromArgs(["--json"])).toBe(0);
    const listed = JSON.parse(output.stdout()) as { experiments: Array<{ id: string; supportedVariants: string[] }> };
    expect(listed.experiments.map((entry) => entry.id)).toEqual([...PRIOR_IDS, ID, "agent-success-rate"]);
    expect(listed.experiments.find((entry) => entry.id === ID)).toMatchObject({
      status: "experimental",
      supportedTargets: ["self", "external-local"],
      supportedOutputs: ["json", "html", "text", "artifact"],
      supportedVariants: ["raw-full-file", "context-pack"]
    });
    vi.restoreAllMocks();
    const text = capture();
    expect(await runExperimentListCommandFromArgs([])).toBe(0);
    expect(text.stdout()).toContain(`${ID}\n  Name: Context Pack Generation`);
    for (const id of PRIOR_IDS) expect(text.stdout()).toContain(id);
  });

  it("describes identity, variants, targets, outputs and accepted behavior without internal knobs", async () => {
    const output = capture();
    expect(await runExperimentDescribeCommandFromArgs(["--experiment", ID, "--json"])).toBe(0);
    const description = JSON.parse(output.stdout());
    expect(description.metadata).toMatchObject({ id: ID, name: "Context Pack Generation", status: "experimental" });
    expect(description.metadata.supportedTargets).toEqual(["self", "external-local"]);
    expect(description.metadata.supportedOutputs).toEqual(["json", "html", "text", "artifact"]);
    expect(description.supportedVariants).toEqual(["raw-full-file", "context-pack"]);
    expect(description.requiredConfigFields.map((field: { name: string }) => field.name)).toEqual(["outDir"]);
    expect(description.optionalConfigFields.map((field: { name: string }) => field.name)).toEqual(["kitCommand", "caseIds", "benchmarkProjects"]);
    expect(description.targetBehavior).toContain("Two subject modes");
    expect(description.targetBehavior).toContain("External local repository");
    expect(description.targetBehavior).toContain("no context-pack body is written externally");
    expect(description.examples).toEqual([
      `my-dev-kit-lab experiment describe --experiment ${ID}`,
      `my-dev-kit-lab experiment run --experiment ${ID}`,
      `my-dev-kit-lab experiment run --experiment ${ID} --case <case-id> --out <run-dir>`,
      `my-dev-kit-lab experiment run --experiment ${ID} --target <local-git-repository> --local-subject-config <path-to-local-subject-config.json> --out <run-dir-outside-the-repository>`
    ]);
    expect(JSON.stringify(description)).not.toMatch(/--strateg|--treatment|--max-files|--max-symbols|--graph-depth|--source-lines/);
  });

  it("keeps unknown-experiment describe behavior unchanged", async () => {
    const output = capture();
    expect(await runExperimentDescribeCommandFromArgs(["--experiment", "no-such-experiment"])).toBe(1);
    expect(output.stderr()).toContain("Experiment plugin not found: no-such-experiment");
  });
});

describe("argument contract", () => {
  it("accepts exactly the bundled flags", () => {
    const parsed = parseRunExperimentArgs(["--experiment", ID, "--out", "d", "--case", "a,b", "--case", "c", "--benchmark-project", "p", "--kit-command", "node kit.js"]);
    expect(parsed.experimentId).toBe(ID);
    expect(parsed.outDir).toBe("d");
    expect(parsed.targetPath).toBeUndefined();
    expect(parsed.localSubjectConfigPath).toBeUndefined();
    expect(parsed.config).toEqual({ caseIds: ["a", "b", "c"], benchmarkProjects: ["p"], kitCommand: "node kit.js" });
    // The default kit command is left to the plugin's established default; nothing is hardcoded here.
    expect(parseRunExperimentArgs(["--experiment", ID]).config).toEqual({});
  });

  it("rejects unrelated plugin options and any treatment or strategy selector", () => {
    const supported = "supported options: --experiment, --out, --case, --benchmark-project, --kit-command.";
    for (const extra of [
      ["--synthetic-config", "x.json"],
      ["--context-budgets", "8k"],
      ["--campaign", "codex-full"],
      ["--strategies", "raw-full-file"],
      ["--agents", "fake-agent"],
      ["--complexities", "short"],
      ["--cases", "x.json"],
      ["--project-profiles", "x.json"],
      ["--timeout-ms", "10"],
      ["--max-runs", "3"],
      ["--include-real-agents"]
    ]) {
      expect(() => parseRunExperimentArgs(["--experiment", ID, ...extra]), extra[0]).toThrow(supported);
    }
    for (const selector of ["--strategy", "--treatment", "--treatments", "--max-files", "--max-symbols", "--graph-depth", "--source-lines"]) {
      expect(() => parseRunExperimentArgs(["--experiment", ID, selector, "x"]), selector).toThrow();
    }
  });

  it("requires non-empty --case and --benchmark-project lists", () => {
    expect(() => parseRunExperimentArgs(["--experiment", ID, "--case", ","])).toThrow("--case must list at least one case id.");
    expect(() => parseRunExperimentArgs(["--experiment", ID, "--benchmark-project", ","])).toThrow("--benchmark-project must list at least one benchmark project id.");
  });

  it("accepts the external-local combination and rejects exactly-one-of --target/--local-subject-config", () => {
    const parsed = parseRunExperimentArgs(["--experiment", ID, "--target", "C:\\some\\repo", "--local-subject-config", "cfg.json", "--out", "o", "--kit-command", "k"]);
    expect(parsed.targetPath).toBe("C:\\some\\repo");
    expect(parsed.localSubjectConfigPath).toBe("cfg.json");
    expect(parsed.config).toEqual({ kitCommand: "k" });
    expect(() => parseRunExperimentArgs(["--experiment", ID, "--target", "C:\\some\\repo"])).toThrow(`External ${ID} targets require --local-subject-config.`);
    expect(() => parseRunExperimentArgs(["--experiment", ID, "--local-subject-config", "cfg.json"])).toThrow(`--local-subject-config requires an external --target for ${ID}.`);
  });

  it("rejects bundled filters and every other flag in external-local mode, matching the sibling experiments", () => {
    const base = ["--experiment", ID, "--target", "C:\\some\\repo", "--local-subject-config", "cfg.json"];
    expect(() => parseRunExperimentArgs([...base, "--case", "x"])).toThrow("--case and --benchmark-project cannot be combined with --local-subject-config");
    expect(() => parseRunExperimentArgs([...base, "--benchmark-project", "x"])).toThrow("--case and --benchmark-project cannot be combined with --local-subject-config");
    expect(() => parseRunExperimentArgs([...base, "--synthetic-config", "s.json"])).toThrow("not supported for --experiment context-pack-generation in external-local mode");
    expect(() => parseRunExperimentArgs([...base, "--context-budgets", "8k"])).toThrow();
  });

  it("leaves other plugins' accepted flags unchanged", () => {
    expect(parseRunExperimentArgs(["--experiment", "retrieval-query-strategy-comparison", "--case", "x", "--kit-command", "k"]).config).toEqual({ caseIds: ["x"], kitCommand: "k" });
    expect(() => parseRunExperimentArgs(["--experiment", "retrieval-precision-recall", "--campaign", "codex-full"])).toThrow("not supported for --experiment retrieval-precision-recall");
    expect(parseRunExperimentArgs(["--experiment", "context-window-scaling", "--context-budgets", "8k"]).config.contextBudgets).toEqual([8192]);
    expect([...RETRIEVAL_QUERY_STRATEGY_IDS]).toHaveLength(7);
  });

  it("documents the experiment in help including the external-local mode, without a strategy option", () => {
    const help = renderExperimentRunHelp();
    const start = help.indexOf("context-pack-generation only:");
    expect(start).toBeGreaterThan(-1);
    const section = help.slice(start, help.indexOf("warm-index-reuse only:")).replace(/\s+/g, " ");
    for (const phrase of ["frozen 12-case corpus", "--out, --case, --benchmark-project and --kit-command", "raw-full-file", "context-pack", "no treatment, strategy, or selection-policy option", "External-local mode requires --target together with --local-subject-config", "no context-pack body is written for an external run"]) {
      expect(section, phrase).toContain(phrase);
    }
    expect(section).not.toMatch(/--strateg(y|ies) </);
    // The kit-command heading enumerates this experiment.
    expect(help).toContain("my-dev-kit command override (warm-index-reuse, incremental-change-staleness, context-window-scaling, retrieval-precision-recall, retrieval-query-strategy-comparison, and context-pack-generation):");
  });
});

describe("bundled run through the public command", () => {
  let parent = "";
  let kit = "";
  let logPath = "";

  beforeEach(() => {
    parent = makeTempDir("cpg-cmd-");
    dirs.push(parent);
    kit = writeFakeKit(path.join(parent, "kit"));
    logPath = path.join(parent, "kit.log");
    process.env.CPG_KIT_LOG = logPath;
  });

  const run = (args: string[]) =>
    runExperimentRunCommandFromArgs(["--experiment", ID, "--kit-command", kit, ...args], { context: createLabExecutionContext({ invocationCwd: parent }) });

  it("runs the frozen 12-case corpus in corpus order, with both treatments and all artifacts under --out", async () => {
    const out = path.join(parent, "out");
    const output = capture();
    const code = await run(["--out", out]);
    expect(output.stderr()).toBe("");
    expect(code).toBe(0);

    const corpus = JSON.parse(readFileSync(path.resolve("benchmarks/contracts/warm-index-benchmark-cases.json"), "utf8")) as Array<{ id: string }>;
    expect(corpus).toHaveLength(12);
    const execution = JSON.parse(readFileSync(path.join(out, "context-pack-generation-execution.json"), "utf8"));
    expect(execution.schemaVersion).toBe("my-dev-kit-lab-context-pack-generation-execution-v1");
    expect(execution.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(corpus.map((entry) => entry.id));
    for (const entry of execution.cases) expect(entry.treatments.map((t: { treatmentId: string }) => t.treatmentId)).toEqual(["raw-full-file", "context-pack"]);
    const analysis = JSON.parse(readFileSync(path.join(out, "context-pack-generation-analysis.json"), "utf8"));
    expect(analysis.schemaVersion).toBe("my-dev-kit-lab-context-pack-generation-analysis-v1");
    expect(analysis.analysis.scopes.map((scope: { scopeId: string }) => scope.scopeId)).toEqual(["overall", "localized", "cross-module", "broad-change"]);
    expect(readdirSync(path.join(out, "packs")).sort()).toEqual(corpus.map((entry) => `${entry.id}.context-pack.json`).sort());
    const pack = JSON.parse(readFileSync(path.join(out, "packs", `${corpus[0].id}.context-pack.json`), "utf8"));
    expect(pack.schemaVersion).toBe("my-dev-kit-lab-context-pack-experiment-v1");
    expect(output.stdout()).toContain(`Experiment: ${ID}`);
  });

  it("builds one call-graph index per benchmark project and forwards --kit-command to every command", async () => {
    const out = path.join(parent, "out");
    expect(await run(["--out", out])).toBe(0);
    const calls = readLog(logPath).map((entry) => entry.argv);
    const indexCalls = calls.filter((argv) => argv[0] === "index");
    expect(indexCalls).toHaveLength(2);
    for (const argv of indexCalls) expect(argv.filter((arg) => arg === "--call-graph")).toHaveLength(1);
    for (const argv of calls.filter((argv) => argv[0] !== "index")) expect(argv).not.toContain("--call-graph");
    // Searches ran once per case (12), all through the supplied fake kit (nothing else could have written this log).
    expect(calls.filter((argv) => argv[0] === "search")).toHaveLength(12);
  });

  it("narrows with --case and keeps corpus order", async () => {
    const out = path.join(parent, "out");
    expect(await run(["--out", out, "--case", "warm-medium-project-summary,warm-medium-import-dedupe"])).toBe(0);
    const execution = JSON.parse(readFileSync(path.join(out, "context-pack-generation-execution.json"), "utf8"));
    expect(execution.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(["warm-medium-import-dedupe", "warm-medium-project-summary"]);
    expect(readdirSync(path.join(out, "packs")).sort()).toEqual(["warm-medium-import-dedupe.context-pack.json", "warm-medium-project-summary.context-pack.json"]);
  });

  it("narrows with --benchmark-project and builds only that project's index", async () => {
    const out = path.join(parent, "out");
    expect(await run(["--out", out, "--benchmark-project", "task-analytics-large-mixed"])).toBe(0);
    const execution = JSON.parse(readFileSync(path.join(out, "context-pack-generation-execution.json"), "utf8"));
    expect(execution.cases).toHaveLength(6);
    expect(new Set(execution.cases.map((entry: { benchmarkProject: string }) => entry.benchmarkProject))).toEqual(new Set(["task-analytics-large-mixed"]));
    expect(readLog(logPath).filter((entry) => entry.argv[0] === "index")).toHaveLength(1);
  });

  it("fails cleanly on an unknown case or project without writing artifacts", async () => {
    const out = path.join(parent, "out");
    const output = capture();
    expect(await run(["--out", out, "--case", "no-such-case"])).not.toBe(0);
    expect(existsSync(path.join(out, "context-pack-generation-execution.json"))).toBe(false);
    expect(existsSync(path.join(out, "context-pack-generation-analysis.json"))).toBe(false);
    expect(output.stdout()).toContain("Status: failed");
    vi.restoreAllMocks();
    capture();
    expect(await run(["--out", out, "--benchmark-project", "no-such-project"])).not.toBe(0);
  });

  it("writes the typed contextPackGeneration section into the generic reports without altering the evidence artifacts", async () => {
    const out = path.join(parent, "out");
    expect(await run(["--out", out, "--case", "warm-medium-project-summary,warm-medium-import-dedupe"])).toBe(0);

    const report = JSON.parse(readFileSync(path.join(out, "report.json"), "utf8")).report;
    const section = report.contextPackGeneration;
    expect(section).not.toBeNull();
    expect(section.schemaVersion).toBe("my-dev-kit-lab-context-pack-generation-report-v1");
    expect(section.treatmentOrder).toEqual(["raw-full-file", "context-pack"]);
    expect(section.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(["warm-medium-import-dedupe", "warm-medium-project-summary"]);
    expect(section.scopes.map((scope: { scopeId: string }) => scope.scopeId)).toEqual(["overall", "localized", "cross-module", "broad-change"]);
    expect(report.retrievalQueryStrategyComparison).toBeNull();

    // The section copies the persisted analysis exactly; reporting recalculated nothing.
    const analysis = JSON.parse(readFileSync(path.join(out, "context-pack-generation-analysis.json"), "utf8")).analysis;
    expect(section.scopes).toEqual(analysis.scopes);
    expect(section.cases.map((entry: { comparison: unknown }) => entry.comparison)).toEqual(analysis.cases.map((entry: { comparison: unknown }) => entry.comparison));

    // Previews come from the persisted pack artifacts, bounded, and without machine-local paths.
    for (const preview of section.previews) {
      expect(preview.status).toBe("available");
      expect(preview.files.items.length).toBeLessThanOrEqual(5);
      expect(preview.sourceSlices.items.length).toBeLessThanOrEqual(3);
    }
    expect(JSON.stringify(section)).not.toContain(parent.replaceAll("\\", "\\\\"));

    expect(readFileSync(path.join(out, "report.txt"), "utf8")).toContain("Context Pack Preview");
    expect(readFileSync(path.join(out, "report.html"), "utf8")).toContain("<h2>Context Pack Generation</h2>");

    // Evidence artifacts hold no report section: reporting only reads them.
    const execution = JSON.parse(readFileSync(path.join(out, "context-pack-generation-execution.json"), "utf8"));
    expect(execution).not.toHaveProperty("contextPackGeneration");
    expect(JSON.parse(readFileSync(path.join(out, "context-pack-generation-analysis.json"), "utf8"))).not.toHaveProperty("contextPackGeneration");
    const pack = JSON.parse(readFileSync(path.join(out, "packs", "warm-medium-import-dedupe.context-pack.json"), "utf8"));
    expect(pack.schemaVersion).toBe("my-dev-kit-lab-context-pack-experiment-v1");
  });

  it("refuses exactly one of --target and --local-subject-config at the command surface without running anything", async () => {
    const out = path.join(parent, "out");
    for (const [extra, message] of [
      [["--target", parent], `External ${ID} targets require --local-subject-config.`],
      [["--local-subject-config", path.join(parent, "cfg.json")], `--local-subject-config requires an external --target for ${ID}.`]
    ] as const) {
      const output = capture();
      expect(await run(["--out", out, ...extra])).toBe(1);
      expect(output.stderr()).toContain(message);
      vi.restoreAllMocks();
    }
    expect(readLog(logPath)).toEqual([]);
    expect(existsSync(out)).toBe(false);
  });
});
