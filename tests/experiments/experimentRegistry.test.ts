import { describe, expect, it } from "vitest";
import {
  ExperimentPluginRegistry,
  type ExperimentExecutionContext,
  type ExperimentPlugin,
  type ExperimentRun,
} from "../../src/experiments/index.js";

function makePlugin(id = "example-plugin"): ExperimentPlugin {
  return {
    metadata: {
      id,
      name: "Example Plugin",
      description: "A plugin used by registry tests.",
      schemaVersion: "1.0.0",
      status: "experimental",
      supportedTargets: ["self", "external-local"],
      supportedOutputs: ["json"],
    },
    validateConfig(config: unknown) {
      return { valid: true, config, errors: [], warnings: [] };
    },
    async run(context: ExperimentExecutionContext): Promise<ExperimentRun> {
      return {
        runId: context.runId,
        pluginId: id,
        startedAt: context.startedAt.toISOString(),
        completedAt: context.startedAt.toISOString(),
        status: "completed",
        target: context.target,
        variants: [],
        cases: [],
        metrics: [],
        artifacts: [],
        warnings: [],
        failures: [],
      };
    },
  };
}

describe("ExperimentPluginRegistry", () => {
  it("starts empty", () => {
    const registry = new ExperimentPluginRegistry();
    expect(registry.list()).toEqual([]);
  });

  it("registers one plugin", () => {
    const registry = new ExperimentPluginRegistry();
    registry.register(makePlugin());
    expect(registry.list()).toHaveLength(1);
  });

  it("lists plugin metadata", () => {
    const registry = new ExperimentPluginRegistry();
    registry.register(makePlugin("listed-plugin"));
    expect(registry.list()).toEqual([
      expect.objectContaining({
        id: "listed-plugin",
        name: "Example Plugin",
        supportedTargets: ["self", "external-local"],
      }),
    ]);
  });

  it("gets a plugin by id", () => {
    const registry = new ExperimentPluginRegistry();
    const plugin = makePlugin("lookup-plugin");
    registry.register(plugin);
    expect(registry.get("lookup-plugin")).toBe(plugin);
  });

  it("rejects duplicate plugin ids", () => {
    const registry = new ExperimentPluginRegistry();
    registry.register(makePlugin("duplicate-plugin"));
    expect(() => registry.register(makePlugin("duplicate-plugin"))).toThrow(
      /already registered/
    );
  });

  it("throws a clear error for missing plugin ids", () => {
    const registry = new ExperimentPluginRegistry();
    expect(() => registry.get("missing-plugin")).toThrow(
      /Experiment plugin not found: missing-plugin/
    );
  });

  it("returns stable metadata snapshots", () => {
    const registry = new ExperimentPluginRegistry();
    const plugin = makePlugin("stable-plugin");
    registry.register(plugin);

    plugin.metadata.name = "Mutated Plugin";
    const listed = registry.list();
    listed[0].supportedTargets.push("self");
    listed[0].name = "Mutated Snapshot";

    expect(registry.describe("stable-plugin")).toEqual(
      expect.objectContaining({
        id: "stable-plugin",
        name: "Example Plugin",
        supportedTargets: ["self", "external-local"],
      })
    );
  });
});
