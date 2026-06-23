import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExperimentPluginRegistry, runExperiment } from "../../src/experiments/index.js";
import type {
  ExperimentExecutionContext,
  ExperimentPlugin,
  ExperimentRun,
} from "../../src/experiments/index.js";
import { contextStrategyComparisonPlugin } from "../../src/experiments/plugins/contextStrategyComparison/index.js";
import { loadExperimentFixtures } from "../evaluation/experimentTestHelpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runExperiment", () => {
  it("runs a plugin in self mode with tool and target roots separated in context", async () => {
    let receivedContext: ExperimentExecutionContext | undefined;
    const registry = registryWithProbe(async (context) => {
      receivedContext = context;
      return makeRun(context);
    });

    const result = await runExperiment({
      pluginId: "probe",
      registry,
      runId: "probe-self",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
    });

    expect(result.status).toBe("completed");
    expect(receivedContext?.toolRoot).toBe(path.resolve(process.cwd()));
    expect(receivedContext?.targetRoot).toBe(path.resolve(process.cwd()));
    expect(receivedContext?.isSelfTarget).toBe(true);
    expect(receivedContext?.pluginId).toBe("probe");
    expect(receivedContext?.environment?.nodeVersion).toBe(process.version);
  });

  it("resolves an external target with package metadata and no git metadata", async () => {
    const targetRoot = makeTargetProject("external target", {
      packageJson: { name: "@scope/sample-target", version: "1.2.3" },
      lockfile: true,
    });
    let receivedContext: ExperimentExecutionContext | undefined;
    const registry = registryWithProbe(async (context) => {
      receivedContext = context;
      return makeRun(context);
    });

    const result = await runExperiment({
      pluginId: "probe",
      registry,
      runId: "probe-external",
      targetPath: targetRoot,
      toolRoot: process.cwd(),
    });

    expect(result.target.isSelf).toBe(false);
    expect(result.target.kind).toBe("external-local");
    expect(result.target.packageName).toBe("@scope/sample-target");
    expect(result.target.packageVersion).toBe("1.2.3");
    expect(result.target.hasPackageJson).toBe(true);
    expect(result.target.hasLockfile).toBe(true);
    expect(result.target.hasGit).toBe(false);
    expect(receivedContext?.targetRoot).toBe(targetRoot);
  });

  it("resolves an external target without package.json", async () => {
    const targetRoot = makeTargetProject("no package");
    const registry = registryWithProbe((context) => makeRun(context));
    const result = await runExperiment({
      pluginId: "probe",
      registry,
      runId: "probe-no-package",
      targetPath: targetRoot,
      toolRoot: process.cwd(),
    });

    expect(result.target.hasPackageJson).toBe(false);
    expect(result.target.packageName).toBeNull();
    expect(result.target.packageVersion).toBeNull();
  });

  it("fails cleanly for nonexistent and file targets", async () => {
    const registry = registryWithProbe((context) => makeRun(context));
    await expect(
      runExperiment({
        pluginId: "probe",
        registry,
        targetPath: path.join(os.tmpdir(), "missing-target-for-experiment"),
      })
    ).rejects.toThrow(/Target path does not exist/);

    const fileTarget = path.join(makeTargetProject("file target"), "target.txt");
    writeFileSync(fileTarget, "not a directory");
    await expect(
      runExperiment({ pluginId: "probe", registry, targetPath: fileTarget })
    ).rejects.toThrow(/Target path is not a directory/);
  });

  it("supports target paths with spaces", async () => {
    const targetRoot = makeTargetProject("target with spaces", {
      packageJson: { name: "space-target", version: "0.0.1" },
    });
    const registry = registryWithProbe((context) => makeRun(context));

    const result = await runExperiment({
      pluginId: "probe",
      registry,
      targetPath: targetRoot,
      toolRoot: process.cwd(),
    });

    expect(result.target.targetRoot).toContain("target with spaces");
    expect(result.target.packageName).toBe("space-target");
  });

  it("writes artifacts under outputRoot and refuses external target output roots", async () => {
    const targetRoot = makeTargetProject("artifact target");
    const outputRoot = mkdtempSync(path.join(os.tmpdir(), "experiment-output-"));
    tempDirs.push(outputRoot);
    const registry = registryWithProbe(async (context) => {
      await writeFile(path.join(context.outputRoot ?? "", "probe-artifact.txt"), "ok", "utf8");
      return makeRun(context);
    });

    await runExperiment({
      pluginId: "probe",
      registry,
      targetPath: targetRoot,
      outputRoot,
      toolRoot: process.cwd(),
    });

    expect(existsSync(path.join(outputRoot, "probe-artifact.txt"))).toBe(true);
    expect(existsSync(path.join(targetRoot, "probe-artifact.txt"))).toBe(false);
    await expect(
      runExperiment({
        pluginId: "probe",
        registry,
        targetPath: targetRoot,
        outputRoot: path.join(targetRoot, "lab-output"),
        toolRoot: process.cwd(),
      })
    ).rejects.toThrow(/must not be inside the external target project/);
  });

  it("runs context-strategy-comparison against a fixture external target without modifying it", async () => {
    const targetRoot = makeTargetProject("context target", {
      packageJson: { name: "context-target", version: "0.1.0" },
    });
    await writeFile(path.join(targetRoot, "README.md"), "# Target\n", "utf8");
    const before = listFiles(targetRoot);
    const outputRoot = mkdtempSync(path.join(os.tmpdir(), "context-target-output-"));
    tempDirs.push(outputRoot);
    const { cases, projectProfiles } = await loadExperimentFixtures();

    const result = await runExperiment({
      pluginId: "context-strategy-comparison",
      registry: contextRegistry(),
      runId: "context-target-run",
      targetPath: targetRoot,
      outputRoot,
      toolRoot: process.cwd(),
      config: {
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
        continueOnFailure: true,
      },
      inputs: { cases, projectProfiles, env: process.env },
    });

    expect(result.status).toBe("completed");
    expect(result.target.targetRoot).toBe(targetRoot);
    expect(result.variants.map((variant) => variant.id).sort()).toEqual([
      "my-dev-kit-guided",
      "raw-full-file",
    ]);
    expect(existsSync(path.join(outputRoot, "experiment-summary.json"))).toBe(true);
    expect(existsSync(path.join(outputRoot, "experiment-plugin-result.json"))).toBe(true);
    expect(listFiles(targetRoot)).toEqual(before);
  });

  it("runs context-strategy-comparison in self mode through the runner", async () => {
    const outputRoot = mkdtempSync(path.join(os.tmpdir(), "context-self-output-"));
    tempDirs.push(outputRoot);
    const { cases, projectProfiles } = await loadExperimentFixtures();

    const result = await runExperiment({
      pluginId: "context-strategy-comparison",
      registry: contextRegistry(),
      runId: "context-self-run",
      outputRoot,
      toolRoot: process.cwd(),
      config: {
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
      },
      inputs: { cases, projectProfiles },
    });

    expect(result.target.isSelf).toBe(true);
    expect(result.status).toBe("completed");
    expect(String(result.metadata?.outputRoot)).toBe(outputRoot);
  });
});

function registryWithProbe(run: (context: ExperimentExecutionContext<Record<string, unknown>>) => Promise<ExperimentRun> | ExperimentRun): ExperimentPluginRegistry {
  const registry = new ExperimentPluginRegistry();
  registry.register(makeProbePlugin(run));
  return registry;
}

function contextRegistry(): ExperimentPluginRegistry {
  const registry = new ExperimentPluginRegistry();
  registry.register(contextStrategyComparisonPlugin);
  return registry;
}

function makeProbePlugin(run: (context: ExperimentExecutionContext<Record<string, unknown>>) => Promise<ExperimentRun> | ExperimentRun): ExperimentPlugin<Record<string, unknown>> {
  return {
    metadata: {
      id: "probe",
      name: "Probe",
      description: "Probe plugin for runner tests.",
      schemaVersion: "1.0.0",
      status: "experimental",
      supportedTargets: ["self", "external-local"],
      supportedOutputs: ["json", "artifact"],
    },
    validateConfig(config) {
      return {
        valid: true,
        config: config && typeof config === "object" && !Array.isArray(config) ? config as Record<string, unknown> : {},
        errors: [],
        warnings: [],
      };
    },
    async run(context) {
      return run(context);
    },
  };
}

function makeRun(context: ExperimentExecutionContext): ExperimentRun {
  return {
    runId: context.runId,
    pluginId: context.pluginId ?? "probe",
    startedAt: context.startedAt.toISOString(),
    completedAt: "2026-06-23T00:00:01.000Z",
    status: "completed",
    target: context.target,
    variants: [],
    cases: [],
    metrics: [],
    artifacts: [],
    warnings: [],
    failures: [],
    summary: {
      status: "completed",
      totalCases: 0,
      completedCases: 0,
      partialCases: 0,
      failedCases: 0,
      skippedCases: 0,
      metrics: [],
      warnings: [],
      failures: [],
    },
  };
}

function makeTargetProject(name: string, options: { packageJson?: Record<string, unknown>; lockfile?: boolean } = {}): string {
  const targetRoot = mkdtempSync(path.join(os.tmpdir(), name.replaceAll(" ", "-")));
  const spacedRoot = path.join(targetRoot, name);
  tempDirs.push(targetRoot);
  mkdirSync(spacedRoot);
  if (options.packageJson) {
    writeFileSync(path.join(spacedRoot, "package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`);
  }
  if (options.lockfile) {
    writeFileSync(path.join(spacedRoot, "package-lock.json"), "{}\n");
  }
  return path.resolve(spacedRoot);
}

function listFiles(root: string): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      entries.push(...listFiles(fullPath).map((child) => path.join(entry.name, child)));
    } else {
      entries.push(entry.name);
    }
  }
  return entries.sort();
}
