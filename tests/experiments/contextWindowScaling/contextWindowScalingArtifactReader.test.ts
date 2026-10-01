import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import {
  aggregateContextWindowScaling,
  buildContextWindowScalingExecutionArtifact,
  parseContextWindowScalingExecutionArtifact,
  type ContextWindowScalingExecutionArtifactV1,
} from "../../../src/experiments/plugins/contextWindowScaling/index.js";
import {
  CONTEXT_WINDOW_SCALING_PLOT_IDS,
  buildContextWindowScalingPlotData,
  writePlotArtifacts,
} from "../../../src/plots/index.js";
import { PASS, caseEvidence, treatmentEvidence } from "./evidenceFactory.js";

const BUDGETS = [8192, 12000];

function validArtifact(): ContextWindowScalingExecutionArtifactV1 {
  return buildContextWindowScalingExecutionArtifact({
    runId: "r",
    pluginId: "context-window-scaling",
    pluginSchemaVersion: "1.0.0",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    tokenCountMethod: "estimated_chars_div_4",
    contextBudgets: BUDGETS,
    cases: [
      caseEvidence("a", [
        treatmentEvidence({ variantId: "raw-full-file", budgets: BUDGETS, tokens: 9000, shared: PASS }),
        treatmentEvidence({ variantId: "my-dev-kit-guided", budgets: BUDGETS, tokens: 100, shared: PASS }),
      ]),
    ],
  });
}
const clone = () => structuredClone(validArtifact()) as unknown as Record<string, any>;

describe("parseContextWindowScalingExecutionArtifact", () => {
  it("accepts a real V1 artifact and returns it unchanged", () => {
    const artifact = validArtifact();
    expect(parseContextWindowScalingExecutionArtifact(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact);
  });

  it.each([
    ["wrong schemaVersion", (a: any) => void (a.schemaVersion = "my-dev-kit-lab-context-window-scaling-execution-v2"), "unsupported schemaVersion"],
    ["missing top-level field", (a: any) => void delete a.runId, "runId"],
    ["wrong plugin id", (a: any) => void (a.pluginId = "warm-index-reuse"), "pluginId"],
    ["invalid budget", (a: any) => void (a.contextBudgets = [0, 8192]), "contextBudgets"],
    ["duplicate budgets", (a: any) => void (a.contextBudgets = [8192, 8192]), "duplicate"],
    ["unordered budgets", (a: any) => void (a.contextBudgets = [12000, 8192]), "ascending"],
    ["empty cases", (a: any) => void (a.cases = []), "cases"],
    ["missing treatment", (a: any) => void a.cases[0].treatments.pop(), "exactly raw-full-file and my-dev-kit-guided"],
    ["unknown treatment id", (a: any) => void (a.cases[0].treatments[0].variantId = "other"), "exactly raw-full-file"],
    ["unknown fit status", (a: any) => void (a.cases[0].treatments[0].budgetCells[0].contextFitStatus = "maybe"), "contextFitStatus"],
    ["cells not matching budgets", (a: any) => void a.cases[0].treatments[0].budgetCells.pop(), "do not match contextBudgets"],
    ["malformed correctness", (a: any) => void (a.cases[0].treatments[0].budgetCells[0].correctness = { availability: "available", score: "1", pass: true }), "correctness"],
    ["malformed success evidence", (a: any) => void (a.cases[0].treatments[0].budgetCells[0].successEvidence = { status: "available" }), "successEvidence"],
    ["string token count", (a: any) => void (a.cases[0].treatments[0].context.estimatedTokens = "9000"), "context counts"],
  ])("rejects %s", (_name, mutate, message) => {
    const artifact = clone();
    mutate(artifact);
    expect(() => parseContextWindowScalingExecutionArtifact(artifact)).toThrow(message);
  });

  it("rejects non-objects", () => {
    expect(() => parseContextWindowScalingExecutionArtifact(null)).toThrow("expected a JSON object");
    expect(() => parseContextWindowScalingExecutionArtifact([])).toThrow("expected a JSON object");
  });
});

describe("persisted-artifact plot routing", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });
  const temp = async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ctx-route-"));
    dirs.push(dir);
    return dir;
  };

  it("routes an execution artifact through the canonical aggregate and builder to exactly three plots", async () => {
    const experimentDir = await temp();
    const outDir = await temp();
    const artifact = validArtifact();
    await writeFile(path.join(experimentDir, "context-window-scaling-execution.json"), JSON.stringify(artifact), "utf8");
    const written = await writePlotArtifacts({ experimentDir, outDir });
    expect(Object.keys(written.artifactPaths.charts)).toEqual([...CONTEXT_WINDOW_SCALING_PLOT_IDS]);
    expect((await readdir(path.join(outDir, "charts"))).length).toBe(3);
    const expected = buildContextWindowScalingPlotData({
      aggregate: aggregateContextWindowScaling({ contextBudgets: artifact.contextBudgets, cases: artifact.cases }),
      experimentDir,
      generatedAt: artifact.completedAt,
    });
    expect(written.data).toEqual(expected);
    expect(written.data.plots[1]!.points.map((p) => p.x)).toEqual([8192, 8192, 12000, 12000]);
  });

  it("is deterministic across repeated routing of identical evidence", async () => {
    const experimentDir = await temp();
    await writeFile(path.join(experimentDir, "context-window-scaling-execution.json"), JSON.stringify(validArtifact()), "utf8");
    const first = await writePlotArtifacts({ experimentDir, outDir: await temp() });
    const second = await writePlotArtifacts({ experimentDir, outDir: await temp() });
    expect(first.data).toEqual(second.data);
  });

  it("fails instead of silently producing no plots for an invalid artifact", async () => {
    const experimentDir = await temp();
    await writeFile(path.join(experimentDir, "context-window-scaling-execution.json"), JSON.stringify({ schemaVersion: "nope" }), "utf8");
    await expect(writePlotArtifacts({ experimentDir, outDir: await temp() })).rejects.toThrow("unsupported schemaVersion");
  });
});
