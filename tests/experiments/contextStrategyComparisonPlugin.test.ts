import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contextStrategyComparisonPlugin,
  createDefaultExperimentPluginRegistry,
  resolveExperimentTarget,
} from "../../src/experiments/index.js";
import { loadExperimentFixtures } from "../evaluation/experimentTestHelpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("context-strategy-comparison plugin", () => {
  it("is registered under a stable plugin id", () => {
    const registry = createDefaultExperimentPluginRegistry();
    const plugin = registry.get("context-strategy-comparison");
    expect(plugin).toBe(contextStrategyComparisonPlugin);
    expect(registry.describe("context-strategy-comparison")).toEqual(
      expect.objectContaining({
        id: "context-strategy-comparison",
        name: "Context Strategy Comparison",
        description:
          "Compare raw full-file context against my-dev-kit guided retrieval/context strategies.",
        schemaVersion: "1.0.0",
        supportedTargets: ["self", "external-local"],
        supportedOutputs: ["json", "html", "plot", "screenshot", "artifact"],
      })
    );
  });

  it("normalizes default config to the current fake-agent comparison defaults", () => {
    const result = contextStrategyComparisonPlugin.validateConfig({});
    expect(result.valid).toBe(true);
    expect(result.config).toEqual(
      expect.objectContaining({
        casesPath: "examples/token-savings-cases.json",
        projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
      })
    );
  });

  it("runs the fake-agent workflow through the plugin and preserves legacy artifacts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-"));
    tempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
        outDir,
      },
      inputs: { cases, projectProfiles },
    });

    expect(result.pluginId).toBe("context-strategy-comparison");
    expect(result.status).toBe("completed");
    expect(result.variants.map((variant) => variant.id).sort()).toEqual([
      "my-dev-kit-guided",
      "raw-full-file",
    ]);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0].outcomes).toHaveLength(2);
    expect(result.metrics.map((metric) => metric.id)).toContain("total-runs");
    expect(result.artifacts.map((artifact) => artifact.id)).toContain("plugin-result");
    expect(result.legacyArtifacts.runs).toHaveLength(2);
    expect(result.legacyArtifacts.comparisons).toHaveLength(1);
    expect(existsSync(path.join(outDir, "experiment-summary.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-runs.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-comparisons.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-plugin-result.json"))).toBe(true);
    const pluginJson = JSON.parse(
      await readFile(path.join(outDir, "experiment-plugin-result.json"), "utf8")
    );
    expect(pluginJson.pluginId).toBe("context-strategy-comparison");
    expect(pluginJson.target.packageName).toBe("@dailephd/my-dev-kit-lab");
    expect(pluginJson.legacyArtifactPaths.summaryPath).toBe(
      path.join(outDir, "experiment-summary.json")
    );
  });

  it("preserves partial outcome information from fake-agent failures", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-failure-"));
    tempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-failure-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
        outDir,
        continueOnFailure: true,
      },
      inputs: {
        cases,
        projectProfiles,
        env: { ...process.env, FAKE_AGENT_MODE: "failure" },
      },
    });

    expect(result.status).toBe("failed");
    expect(result.legacyArtifacts.summary.failedRuns).toBe(2);
    expect(result.cases[0].outcomes.every((outcome) => outcome.status === "failed")).toBe(true);
  });
});
