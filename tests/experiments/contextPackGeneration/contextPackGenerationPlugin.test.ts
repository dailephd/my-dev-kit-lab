import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultExperimentPluginRegistry } from "../../../src/experiments/defaultRegistry.js";
import {
  CONTEXT_PACK_GENERATION_ANALYSIS_SCHEMA_VERSION,
  CONTEXT_PACK_GENERATION_EXECUTION_SCHEMA_VERSION,
  CONTEXT_PACK_GENERATION_PERSISTENCE_FAILURE_MESSAGE,
  CONTEXT_PACK_SCHEMA_VERSION,
  CONTEXT_PACK_SECTION_IDS,
  buildContextPackGenerationAnalysisArtifact,
  buildContextPackGenerationExecutionArtifact,
  contextPackArtifactRelativePath,
  contextPackGenerationPlugin,
  defaultContextPackGenerationConfig,
  type ContextPackGenerationArtifactIo,
  type ContextPackGenerationRun
} from "../../../src/experiments/plugins/contextPackGeneration/index.js";
import type { ExperimentExecutionContext, ExperimentTarget } from "../../../src/experiments/types.js";
import { RETRIEVAL_QUERY_STRATEGY_IDS } from "../../../src/evaluation/retrievalQueryStrategies.js";
import { makeEvaluationCase, makeHarness, standardWorld, STANDARD_SYMBOL_INDEX, SOURCE_TEXT_SENTINEL } from "./contextPackGenerationTestHelpers.js";

const OUT = path.resolve("lab-output-test-context-pack-plugin");
const rel = (absolute: string): string => path.relative(OUT, absolute).replace(/\\/g, "/");

const selfTarget: ExperimentTarget = {
  kind: "self",
  targetRoot: process.cwd(),
  toolRoot: process.cwd(),
  packageName: "@dailephd/my-dev-kit-lab",
  packageVersion: "0.8.1",
  hasPackageJson: true,
  hasLockfile: true,
  branch: null,
  commit: null,
  hasGit: false,
  isSelf: true
};

function contextOf(inputs: Record<string, unknown>, target: ExperimentTarget = selfTarget): ExperimentExecutionContext<typeof defaultContextPackGenerationConfig> {
  return {
    runId: "run-1",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    toolRoot: process.cwd(),
    target,
    config: { ...defaultContextPackGenerationConfig, kitCommand: "fake-kit" },
    outputRoot: OUT,
    inputs
  };
}

type IoRecorder = { io: ContextPackGenerationArtifactIo; writes: string[]; removed: string[]; files: Map<string, string> };

function makeIo(events: string[], options: { failOn?: (filePath: string) => boolean; existing?: string[] } = {}): IoRecorder {
  const writes: string[] = [];
  const removed: string[] = [];
  const files = new Map<string, string>((options.existing ?? []).map((existing) => [existing, "old"]));
  return {
    writes,
    removed,
    files,
    io: {
      ensureDirectory: async () => undefined,
      exists: async (filePath) => files.has(filePath),
      writeFile: async (filePath, content) => {
        events.push(`write:${rel(filePath)}`);
        if (options.failOn?.(filePath)) throw new Error("disk full at C:\\private\\path");
        writes.push(rel(filePath));
        files.set(filePath, content);
      },
      removeFile: async (filePath) => {
        removed.push(rel(filePath));
        files.delete(filePath);
      }
    }
  };
}

const twoCases = () => [makeEvaluationCase({ id: "case/one", locality: "localized" }), makeEvaluationCase({ id: "case-two", locality: "cross-module" })];

async function runPlugin(options: { failOn?: (filePath: string) => boolean; existing?: string[]; cases?: ReturnType<typeof twoCases> } = {}) {
  const events: string[] = [];
  const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX, events });
  const recorder = makeIo(events, options);
  const promise = contextPackGenerationPlugin.run(contextOf({ cases: options.cases ?? twoCases(), contextPackDependencies: harness.dependencies, contextPackArtifactIo: recorder.io }));
  return { events, harness, recorder, promise };
}

describe("plugin runtime (bundled)", () => {
  it("is registered exactly once in the default registry (Batch 3), and the seven v0.8.1 strategies are unchanged", () => {
    const registry = createDefaultExperimentPluginRegistry();
    expect(registry.find("context-pack-generation")).toBe(contextPackGenerationPlugin);
    expect(registry.list().filter((entry) => entry.id === "context-pack-generation")).toHaveLength(1);
    expect(RETRIEVAL_QUERY_STRATEGY_IDS).toHaveLength(7);
  });

  it("runs both treatments per case and maps them to an ExperimentRun", async () => {
    const { promise } = await runPlugin();
    const run: ContextPackGenerationRun = await promise;
    expect(run.pluginId).toBe("context-pack-generation");
    expect(run.status).toBe("completed");
    expect(run.variants.map((variant) => variant.id)).toEqual(["raw-full-file", "context-pack"]);
    expect(run.cases.map((entry) => entry.outcomes.map((outcome) => outcome.variantId))).toEqual([
      ["raw-full-file", "context-pack"],
      ["raw-full-file", "context-pack"]
    ]);
    expect(run.artifacts.map((artifact) => artifact.id)).toEqual([
      "context-pack-generation-execution",
      "context-pack-generation-analysis",
      "context-pack:case/one",
      "context-pack:case-two"
    ]);
    expect(run.summary?.status).toBe("completed");
    expect(JSON.stringify(run)).not.toContain(SOURCE_TEXT_SENTINEL);
  });

  it("writes nothing while cases are still executing, then packs in corpus order, then execution, then analysis last", async () => {
    const { events, promise } = await runPlugin();
    await promise;
    const firstWrite = events.findIndex((event) => event.startsWith("write:"));
    const lastCommand = events.map((event, index) => (event.startsWith("cmd:") || event.startsWith("raw:") || event.startsWith("index:") ? index : -1)).reduce((a, b) => Math.max(a, b));
    expect(firstWrite).toBeGreaterThan(lastCommand);
    expect(events.filter((event) => event.startsWith("write:"))).toEqual([
      `write:${contextPackArtifactRelativePath("case/one")}`,
      `write:${contextPackArtifactRelativePath("case-two")}`,
      "write:context-pack-generation-execution.json",
      "write:context-pack-generation-analysis.json"
    ]);
  });

  it("uses the safe case segment for pack files and never the raw case id", async () => {
    const { promise, recorder } = await runPlugin();
    await promise;
    const packPaths = recorder.writes.filter((entry) => entry.startsWith("packs/"));
    expect(packPaths).toEqual(["packs/case-one.context-pack.json", "packs/case-two.context-pack.json"]);
    expect(packPaths.join()).not.toContain("case/one");
  });

  it("persists complete pack artifacts, and source-free, path-free execution and analysis artifacts", async () => {
    const { promise, recorder } = await runPlugin();
    await promise;
    const byName = (suffix: string) => JSON.parse([...recorder.files.entries()].find(([filePath]) => filePath.replace(/\\/g, "/").endsWith(suffix))![1]);
    const pack = byName("packs/case-one.context-pack.json");
    expect(pack.schemaVersion).toBe(CONTEXT_PACK_SCHEMA_VERSION);
    expect(pack.sections.map((section: { id: string }) => section.id)).toEqual([...CONTEXT_PACK_SECTION_IDS]);
    expect(pack.renderedText).toContain(SOURCE_TEXT_SENTINEL);
    for (const heading of ["## Task", "## Relevant files", "## Relevant symbols", "## Source slices", "## Call relationships", "## Tests", "## Evidence notes"]) expect(pack.renderedText).toContain(heading);

    const execution = byName("context-pack-generation-execution.json");
    const analysis = byName("context-pack-generation-analysis.json");
    expect(execution.schemaVersion).toBe("my-dev-kit-lab-context-pack-generation-execution-v1");
    expect(analysis.schemaVersion).toBe("my-dev-kit-lab-context-pack-generation-analysis-v1");
    expect(execution.treatmentOrder).toEqual(["raw-full-file", "context-pack"]);
    expect(execution.selectionPolicyId).toBe("bounded-multiseed-v1");
    // Execution artifact does not recalculate science; analysis artifact carries no command/source clutter.
    expect(JSON.stringify(execution)).not.toMatch(/fileF1|symbolF1|fact-coverage|"quality"/);
    expect(JSON.stringify(execution)).not.toContain(SOURCE_TEXT_SENTINEL);
    expect(JSON.stringify(analysis)).not.toContain(SOURCE_TEXT_SENTINEL);
    expect(JSON.stringify(analysis)).not.toMatch(/"steps"|renderedText|"text"/);
    for (const artifact of [execution, analysis]) expect(JSON.stringify(artifact)).not.toMatch(/[A-Za-z]:[\\/]/);
    // Timestamps live only in the envelope, never inside scientific values.
    expect(JSON.stringify(analysis.analysis)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(execution.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(["case/one", "case-two"]);
  });

  it("removes only files created by the failed attempt and leaves unrelated and pre-existing files alone", async () => {
    const preexisting = path.join(OUT, "packs", "case-one.context-pack.json");
    const unrelated = path.join(OUT, "unrelated-notes.txt");
    const { promise, recorder } = await runPlugin({ existing: [preexisting, unrelated], failOn: (filePath) => filePath.endsWith("context-pack-generation-analysis.json") });
    await expect(promise).rejects.toThrow(CONTEXT_PACK_GENERATION_PERSISTENCE_FAILURE_MESSAGE);
    // The run wrote packs 1 (overwrite of a pre-existing file), 2 and the execution artifact before failing.
    expect(recorder.removed.sort()).toEqual(["context-pack-generation-execution.json", "packs/case-two.context-pack.json"]);
    expect(recorder.files.has(unrelated)).toBe(true);
    expect(recorder.files.has(preexisting)).toBe(true);
  });

  it("does not leak the underlying persistence error text", async () => {
    const { promise } = await runPlugin({ failOn: () => true });
    await expect(promise).rejects.toThrow(/^Context pack generation artifact persistence failed\.$/);
  });

  it("still writes execution and analysis artifacts when every pack failed, with no pack files", async () => {
    const events: string[] = [];
    const harness = makeHarness({ world: standardWorld({ failSearch: true }), symbolIndex: STANDARD_SYMBOL_INDEX, events });
    const recorder = makeIo(events);
    const run = await contextPackGenerationPlugin.run(contextOf({ cases: twoCases(), contextPackDependencies: harness.dependencies, contextPackArtifactIo: recorder.io }));
    expect(recorder.writes).toEqual(["context-pack-generation-execution.json", "context-pack-generation-analysis.json"]);
    expect(run.status).toBe("partial");
    expect(run.artifacts).toHaveLength(2);
  });

  it("refuses non-self targets and local subjects without executing anything", async () => {
    const events: string[] = [];
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX, events });
    const external: ExperimentTarget = { ...selfTarget, kind: "external-local", isSelf: false };
    await expect(contextPackGenerationPlugin.run(contextOf({ cases: twoCases(), contextPackDependencies: harness.dependencies }, external))).rejects.toThrow(/bundled self target/);
    await expect(contextPackGenerationPlugin.run(contextOf({ cases: twoCases(), localSubject: {}, contextPackDependencies: harness.dependencies }))).rejects.toThrow(/bundled self target/);
    expect(events).toEqual([]);
  });

  it("applies case filters through the existing selection owner", async () => {
    const events: string[] = [];
    const harness = makeHarness({ world: standardWorld(), symbolIndex: STANDARD_SYMBOL_INDEX, events });
    const recorder = makeIo(events);
    const context = contextOf({ cases: twoCases(), contextPackDependencies: harness.dependencies, contextPackArtifactIo: recorder.io });
    context.config = { ...context.config, caseIds: ["case-two"] };
    const run = await contextPackGenerationPlugin.run(context);
    expect(run.cases.map((entry) => entry.id)).toEqual(["case-two"]);
  });
});

describe("artifact builders", () => {
  const common = { runId: "r", pluginId: "context-pack-generation", pluginSchemaVersion: "1.0.0", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z" };

  it("uses the exact schema identifiers and is deterministic", () => {
    expect(CONTEXT_PACK_GENERATION_EXECUTION_SCHEMA_VERSION).toBe("my-dev-kit-lab-context-pack-generation-execution-v1");
    expect(CONTEXT_PACK_GENERATION_ANALYSIS_SCHEMA_VERSION).toBe("my-dev-kit-lab-context-pack-generation-analysis-v1");
    expect(CONTEXT_PACK_SCHEMA_VERSION).toBe("my-dev-kit-lab-context-pack-experiment-v1");
    const execution = buildContextPackGenerationExecutionArtifact({ ...common, cases: [] });
    expect(execution).toEqual(buildContextPackGenerationExecutionArtifact({ ...common, cases: [] }));
    expect(execution.schemaVersion).toBe(CONTEXT_PACK_GENERATION_EXECUTION_SCHEMA_VERSION);
    const analysis = buildContextPackGenerationAnalysisArtifact({ ...common, analysis: { cases: [], scopes: [] } });
    expect(analysis).toEqual(buildContextPackGenerationAnalysisArtifact({ ...common, analysis: { cases: [], scopes: [] } }));
    expect(analysis.methodology).toEqual({
      fileF1: "balanced-f1",
      symbolF1: "balanced-f1",
      aggregation: "matched-complete-case-macro-mean",
      treatmentComparison: "paired-descriptive-delta",
      sizeMeasure: "estimated-tokens-of-rendered-text"
    });
  });

  it("derives safe, stable pack paths", () => {
    expect(contextPackArtifactRelativePath("warm-medium-import-dedupe")).toBe("packs/warm-medium-import-dedupe.context-pack.json");
    const escaped = contextPackArtifactRelativePath("../escape");
    expect(escaped.split("/")).toHaveLength(2);
    expect(escaped.split("/")[1]).not.toMatch(/[\\/]/);
    expect(path.resolve(OUT, escaped).startsWith(OUT + path.sep)).toBe(true);
    expect(contextPackArtifactRelativePath("a/b\\c")).toBe("packs/a-b-c.context-pack.json");
    expect(() => contextPackArtifactRelativePath("..")).toThrow();
  });
});
