import { rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBenchmarkProjectProfiles } from "../../../src/evaluation/benchmarkMetadata.js";
import {
  executeIncrementalChangeStalenessScenario,
  type IncrementalChangeStalenessScenarioExecutionV1
} from "../../../src/experiments/plugins/incrementalChangeStaleness/execution.js";
import {
  INCREMENTAL_CHANGE_STALENESS_EXECUTION_ARTIFACT_FILE,
  INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION,
  buildIncrementalChangeStalenessExecutionArtifact,
  writeIncrementalChangeStalenessExecutionArtifact
} from "../../../src/experiments/plugins/incrementalChangeStaleness/executionArtifact.js";
import { prepareIncrementalChangeStalenessScenarioLifecycle } from "../../../src/experiments/plugins/incrementalChangeStaleness/lifecycle.js";
import { BENCHMARK_PROJECT_PROFILES_PATH } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioCatalog.js";
import { writeGraphFakeKit } from "../warmIndexReuse/warmIndexTestHelpers.js";
import { expectCanonicalFilesUnchanged, expectNoIndexOutputInCanonicalProjects, makeKitDir, makeRunOwnedRoot, repoRoot, resolveScenario } from "./lifecycleTestHelpers.js";

const tracked: string[] = [];
afterEach(async () => {
  await Promise.all(tracked.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  expectCanonicalFilesUnchanged();
  expectNoIndexOutputInCanonicalProjects();
});

async function runScenarioExecution(scenarioId: string, prefix: string): Promise<IncrementalChangeStalenessScenarioExecutionV1> {
  const resolved = await resolveScenario(scenarioId);
  const runOwnedRoot = makeRunOwnedRoot(tracked, prefix);
  const kit = writeGraphFakeKit(makeKitDir(tracked), { symbols: {} });
  const lifecycle = await prepareIncrementalChangeStalenessScenarioLifecycle({
    repoRoot,
    runOwnedRoot,
    scenario: resolved.scenario,
    baseCase: resolved.baseCase,
    kitCommand: kit.command
  });
  const projectProfiles = await readBenchmarkProjectProfiles(path.resolve(repoRoot, BENCHMARK_PROJECT_PROFILES_PATH), repoRoot);
  return executeIncrementalChangeStalenessScenario({
    repoRoot,
    scenario: resolved.scenario,
    lifecycle,
    baseCase: resolved.baseCase,
    projectProfiles,
    runOwnedRoot,
    cwd: repoRoot
  });
}

describe("execution artifact", () => {
  it("uses the exact frozen schema identifier and filename (TST-B4-057, 058)", async () => {
    expect(INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION).toBe("my-dev-kit-lab-incremental-change-staleness-execution-v1");
    expect(INCREMENTAL_CHANGE_STALENESS_EXECUTION_ARTIFACT_FILE).toBe("incremental-change-staleness-execution.json");
  });

  it("builds a deterministic artifact with scenario/treatment order, bounded content, and correct summary counts (TST-B4-059..068)", async () => {
    const [u1, l2] = await Promise.all([runScenarioExecution("U1", "ics-batch4-art-u1-"), runScenarioExecution("L2", "ics-batch4-art-l2-")]);
    const artifact = buildIncrementalChangeStalenessExecutionArtifact({ runId: "test-run", pluginId: "incremental-change-staleness", executions: [u1, l2] });

    expect(artifact.schemaVersion).toBe(INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION);
    // TST-B4-059: scenario order preserved exactly as given (canonical selected-scenario order).
    expect(artifact.scenarios.map((scenario) => scenario.scenarioId)).toEqual(["U1", "L2"]);

    for (const scenario of artifact.scenarios) {
      // TST-B4-060: treatment order is always stale then full-refresh.
      expect(scenario.stale?.treatmentId).toBe("stale-index");
      expect(scenario.fullRefresh?.treatmentId).toBe("full-refresh");
      // TST-B4-061: lifecycle summary present, no source contents.
      expect(scenario.lifecycle).not.toBeNull();
      expect(JSON.stringify(scenario.lifecycle)).not.toMatch(/completedAt|updated_day/);
      // TST-B4-062: affected-neighborhood evidence present on both treatments.
      expect(scenario.stale?.affectedNeighborhood).toBeDefined();
      expect(scenario.fullRefresh?.affectedNeighborhood).toBeDefined();
      // TST-B4-063: retrieval summary present but no raw context body embedded.
      expect(scenario.stale?.retrieval).toBeDefined();
      expect((scenario.stale?.retrieval as unknown as Record<string, unknown>).contextText).toBeUndefined();
      // TST-B4-064: fake-agent/correctness evidence present.
      expect(scenario.stale?.fakeAgent).not.toBeNull();
      // TST-B4-065: required-file evidence present.
      expect(scenario.stale?.requiredFileEvidence).toBeDefined();
      // TST-B4-066: comparison classification present.
      expect(scenario.comparison.staleRiskClassification).toBeTruthy();
      // Arrays normalized + sorted (TST-B4-052).
      expect(scenario.expectedFiles).toEqual([...scenario.expectedFiles].sort());
      expect(scenario.stale!.requiredFileEvidence.requiredFiles).toEqual([...scenario.stale!.requiredFileEvidence.requiredFiles].sort());
    }

    // TST-B4-067: summary counts match the scenario array.
    expect(artifact.summary.scenarioCount).toBe(2);
    expect(artifact.summary.readyScenarioCount).toBe(2);
    expect(artifact.summary.failedScenarioCount).toBe(0);
    expect(
      artifact.summary.observedStaleRegressionCount + artifact.summary.noObservedStaleRegressionCount + artifact.summary.inconclusiveCount
    ).toBe(2);

    // TST-B4-068: no overall numeric score/grade/winner field exists anywhere in the artifact.
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toMatch(/"winner"|"overallScore"|"grade"|"recommendedTreatment"/);
  });

  it("partial scenario failure is persisted as failed/inconclusive without breaking the batch (TST-B4-069)", async () => {
    const resolved = await resolveScenario("L2");
    const failedLifecycle = {
      status: "failed" as const,
      scenarioId: resolved.scenario.id,
      failure: { code: "baseline-index-build-failed" as const, message: "simulated", treatmentId: "stale-index" as const },
      lifecycleEvents: [],
      indexBuildCounts: { "stale-index": 0, "full-refresh": 0 }
    };
    const projectProfiles = await readBenchmarkProjectProfiles(path.resolve(repoRoot, BENCHMARK_PROJECT_PROFILES_PATH), repoRoot);
    const failedExecution = await executeIncrementalChangeStalenessScenario({
      repoRoot,
      scenario: resolved.scenario,
      lifecycle: failedLifecycle,
      baseCase: resolved.baseCase,
      projectProfiles,
      runOwnedRoot: makeRunOwnedRoot(tracked, "ics-batch4-art-fail-"),
      cwd: repoRoot
    });
    const okExecution = await runScenarioExecution("U1", "ics-batch4-art-ok-");
    const artifact = buildIncrementalChangeStalenessExecutionArtifact({
      runId: "test-run",
      pluginId: "incremental-change-staleness",
      executions: [failedExecution, okExecution]
    });
    expect(artifact.scenarios[0].status).toBe("failed");
    expect(artifact.scenarios[0].stale).toBeNull();
    expect(artifact.scenarios[0].comparison.staleRiskClassification).toBe("inconclusive");
    expect(artifact.scenarios[1].status).toBe("ready");
    expect(artifact.summary.scenarioCount).toBe(2);
    expect(artifact.summary.failedScenarioCount).toBe(1);
    expect(artifact.summary.readyScenarioCount).toBe(1);
  });

  it("writes the artifact to the exact frozen filename inside the output directory", async () => {
    const okExecution = await runScenarioExecution("U1", "ics-batch4-art-write-");
    const artifact = buildIncrementalChangeStalenessExecutionArtifact({ runId: "test-run", pluginId: "incremental-change-staleness", executions: [okExecution] });
    const outDir = makeRunOwnedRoot(tracked, "ics-batch4-art-outdir-");
    const artifactPath = await writeIncrementalChangeStalenessExecutionArtifact(outDir, artifact);
    expect(path.basename(artifactPath)).toBe(INCREMENTAL_CHANGE_STALENESS_EXECUTION_ARTIFACT_FILE);
    expect(existsSync(artifactPath)).toBe(true);
    const written = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(written.schemaVersion).toBe(INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION);
  });
});
