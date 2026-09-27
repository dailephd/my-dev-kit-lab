import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBenchmarkProjectProfiles } from "../../../src/evaluation/benchmarkMetadata.js";
import { executeIncrementalChangeStalenessScenario } from "../../../src/experiments/plugins/incrementalChangeStaleness/execution.js";
import { buildIncrementalChangeStalenessExecutionArtifact, writeIncrementalChangeStalenessExecutionArtifact } from "../../../src/experiments/plugins/incrementalChangeStaleness/executionArtifact.js";
import { prepareIncrementalChangeStalenessScenarioLifecycle } from "../../../src/experiments/plugins/incrementalChangeStaleness/lifecycle.js";
import { incrementalChangeStalenessMetadata, mapIncrementalChangeStalenessExecutionsToRun } from "../../../src/experiments/plugins/incrementalChangeStaleness/plugin.js";
import { BENCHMARK_PROJECT_PROFILES_PATH } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioCatalog.js";
import { writePluginExperimentReports } from "../../../src/report/index.js";
import { writeGraphFakeKit } from "../../experiments/warmIndexReuse/warmIndexTestHelpers.js";
import { expectCanonicalFilesUnchanged, expectNoIndexOutputInCanonicalProjects, makeKitDir, makeRunOwnedRoot, repoRoot, resolveScenario } from "../../experiments/incrementalChangeStaleness/lifecycleTestHelpers.js";

const tracked: string[] = [];
afterEach(async () => {
  await Promise.all(tracked.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  expectCanonicalFilesUnchanged();
  expectNoIndexOutputInCanonicalProjects();
});

// Section 71: L2 real Batch 4 execution artifact -> report.json/report.txt/report.html smoke.
describe("incremental-change-staleness real-artifact report smoke (L2)", () => {
  it(
    "consumes a real generated execution artifact and produces consistent report.json/report.txt/report.html with limitations and no recomputation",
    async () => {
      const resolved = await resolveScenario("L2");
      const runOwnedRoot = makeRunOwnedRoot(tracked, "ics-report-smoke-l2-");
      const kit = writeGraphFakeKit(makeKitDir(tracked), { symbols: {} });
      const lifecycle = await prepareIncrementalChangeStalenessScenarioLifecycle({
        repoRoot,
        runOwnedRoot,
        scenario: resolved.scenario,
        baseCase: resolved.baseCase,
        kitCommand: kit.command
      });
      const projectProfiles = await readBenchmarkProjectProfiles(path.resolve(repoRoot, BENCHMARK_PROJECT_PROFILES_PATH), repoRoot);
      const execution = await executeIncrementalChangeStalenessScenario({
        repoRoot,
        scenario: resolved.scenario,
        lifecycle,
        baseCase: resolved.baseCase,
        projectProfiles,
        runOwnedRoot,
        cwd: repoRoot
      });

      const artifact = buildIncrementalChangeStalenessExecutionArtifact({
        runId: "report-smoke-l2",
        pluginId: "incremental-change-staleness",
        executions: [execution]
      });
      const outDir = makeRunOwnedRoot(tracked, "ics-report-smoke-out-");
      const artifactPath = await writeIncrementalChangeStalenessExecutionArtifact(outDir, artifact);

      const run = mapIncrementalChangeStalenessExecutionsToRun({
        runId: "report-smoke-l2",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        target: {
          kind: "self",
          targetRoot: repoRoot,
          toolRoot: repoRoot,
          packageName: "@dailephd/my-dev-kit-lab",
          packageVersion: "0.6.2",
          hasPackageJson: true,
          hasLockfile: true,
          branch: null,
          commit: null,
          hasGit: true,
          isSelf: true
        },
        kitCommand: kit.command,
        executions: [execution],
        artifactPath
      });

      const { outputPaths } = await writePluginExperimentReports({
        run,
        plugin: incrementalChangeStalenessMetadata,
        outputRoot: outDir
      });

      const jsonReport = JSON.parse(readFileSync(outputPaths.jsonPath, "utf8")) as { report: { incrementalChangeStaleness: unknown } };
      const textReport = readFileSync(outputPaths.textPath, "utf8");
      const htmlReport = readFileSync(outputPaths.htmlPath, "utf8");

      const section = jsonReport.report.incrementalChangeStaleness as {
        scenarios: Array<{ scenarioId: string; comparison: { staleRiskClassification: string } }>;
      };
      expect(section).toBeTruthy();
      expect(section.scenarios).toHaveLength(1);
      const classification = section.scenarios[0].comparison.staleRiskClassification;
      expect(["observed-stale-regression", "no-observed-stale-regression", "inconclusive"]).toContain(classification);

      // Consistency across json/txt/html: the same classification string appears in every rendering.
      expect(textReport).toContain(classification);
      expect(htmlReport).toContain(classification);
      expect(textReport).toContain("Limitations");
      expect(htmlReport).toContain("Limitations");

      // No source/index recomputation: the report never embeds the raw retrieved context body.
      expect(JSON.stringify(jsonReport)).not.toContain("contextText");
    },
    60_000
  );
});
