// v0.6.2 Batch 5 -- projects the persisted Batch 4 incremental-change-staleness-execution.json
// artifact into the plugin report model. This is a deterministic projection only: no retrieval,
// no fake-agent evaluation, no correctness scoring, no affected-neighborhood assessment, no
// freshness assessment, no stale-risk classification, and no source/index/benchmark reads happen
// here. The persisted artifact is the only plugin-specific evidence source (frozen batch plan
// Section 4); this file's only I/O is reading that one JSON file.

import { readFileSync } from "node:fs";
import type { ExperimentRun } from "../../experiments/index.js";
import type { StaleRiskClassificationV1 } from "../../experiments/plugins/incrementalChangeStaleness/comparison.js";
import {
  INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION,
  type IncrementalChangeStalenessExecutionArtifactV1,
  type IncrementalChangeStalenessScenarioExecutionArtifactRecordV1
} from "../../experiments/plugins/incrementalChangeStaleness/executionArtifact.js";
import { INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID } from "../../experiments/plugins/incrementalChangeStaleness/plugin.js";
import {
  INCREMENTAL_CHANGE_STALENESS_REPORT_SCHEMA_VERSION,
  type IncrementalChangeStalenessReportScenarioV1,
  type IncrementalChangeStalenessReportV1
} from "./incrementalChangeStalenessReportModel.js";

// Frozen wording (Section 25). Every point must appear in report.txt and report.html.
const LIMITATIONS: string[] = [
  "Results are scoped to the executed benchmark scenarios, deterministic controlled changes, configured my-dev-kit version, and observed retrieval/evaluation evidence.",
  "\"no-observed-stale-regression\" means only that the frozen comparison did not observe a stale-specific regression in that matched run. It does not prove stale indexes are generally safe.",
  "\"reindexRecommendation\" is separate affected-neighborhood observational evidence; it did not select or trigger either experiment treatment.",
  "Required-file evidence is a bounded answer-key file-presence check, not retrieval precision/recall.",
  "Correctness is deterministic fake-agent/harness evidence unless a future version explicitly adds real-agent evidence.",
  "v0.6.2 compares stale full-index reuse with complete full refresh only.",
  "Partial refresh is not evaluated in v0.6.2.",
  "The experiment does not use graph-diff.",
  "\"changedSymbolCount\" does not mean source-level symbol-diff proof; it retains the released v0.6.1 definition."
];

/** Fixed neutral wording per stale-risk classification category (Section 21). Presentation only. */
export const STALE_RISK_CLASSIFICATION_EXPLANATIONS: Record<StaleRiskClassificationV1, string> = {
  "observed-stale-regression":
    "The persisted matched comparison observed at least one stale-specific regression under the frozen v0.6.2 evidence dimensions: correctness and/or required-file presence.",
  "no-observed-stale-regression":
    "This matched scenario/run did not observe a stale-specific regression under the frozen correctness and required-file evidence dimensions. This does not establish general stale-index safety and does not imply that reindexing should be skipped.",
  inconclusive:
    "Available persisted evidence was insufficient to determine whether a stale-specific regression occurred under the frozen comparison rules. Inconclusive is not the same as no regression."
};

/**
 * Builds the plugin report section for an incremental-change-staleness run, or `null` for any
 * other plugin. Every field is a deterministic projection of the persisted Batch 4 execution
 * artifact; this function performs no scientific recomputation of its own.
 */
export function buildIncrementalChangeStalenessReport(run: ExperimentRun): IncrementalChangeStalenessReportV1 | null {
  if (run.pluginId !== INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID) return null;

  const artifact = loadExecutionArtifact(run);
  const scenarios = artifact.scenarios.map(toReportScenario);

  return {
    schemaVersion: INCREMENTAL_CHANGE_STALENESS_REPORT_SCHEMA_VERSION,
    pluginId: artifact.pluginId,
    scenarioCount: artifact.summary.scenarioCount,
    readyScenarioCount: artifact.summary.readyScenarioCount,
    failedScenarioCount: artifact.summary.failedScenarioCount,
    observedStaleRegressionCount: artifact.summary.observedStaleRegressionCount,
    noObservedStaleRegressionCount: artifact.summary.noObservedStaleRegressionCount,
    inconclusiveCount: artifact.summary.inconclusiveCount,
    scenarios,
    limitations: [...LIMITATIONS]
  };
}

function toReportScenario(
  record: IncrementalChangeStalenessScenarioExecutionArtifactRecordV1
): IncrementalChangeStalenessReportScenarioV1 {
  return {
    scenarioId: record.scenarioId,
    category: record.category,
    benchmarkProjectId: record.benchmarkProjectId,
    baseCaseId: record.baseCaseId,
    status: record.status,
    failureReason: record.failureReason,
    query: record.query,
    answerPolicy: record.answerPolicy,
    expectedFiles: [...record.expectedFiles],
    expectedSymbols: [...record.expectedSymbols],
    lifecycle: record.lifecycle
      ? {
          ...record.lifecycle,
          controlledFilePaths: [...record.lifecycle.controlledFilePaths],
          sourceRoots: [...record.lifecycle.sourceRoots]
        }
      : null,
    // Section 12/34: always stale-index then full-refresh, never combined, never resorted.
    staleTreatment: record.stale ? structuredClone(record.stale) : null,
    fullRefreshTreatment: record.fullRefresh ? structuredClone(record.fullRefresh) : null,
    comparison: { ...record.comparison, reasonCodes: [...record.comparison.reasonCodes] }
  };
}

export function readArtifactPath(run: ExperimentRun): string | undefined {
  const fromMetadata = run.metadata?.executionArtifactPath;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;
  return run.artifacts.find((artifact) => artifact.id === "incremental-change-staleness-execution")?.path ?? undefined;
}

/**
 * The persisted execution artifact is the sole plugin-specific evidence source for this report
 * (Section 4/46). A missing, unreadable, malformed, or schema-mismatched artifact is a report
 * construction error, never silently reconstructed from source/index/retrieval state.
 */
function loadExecutionArtifact(run: ExperimentRun): IncrementalChangeStalenessExecutionArtifactV1 {
  const artifactPath = readArtifactPath(run);
  if (!artifactPath) {
    throw new Error("Invalid incremental-change-staleness report source: no execution artifact path was found on the run.");
  }

  let raw: string;
  try {
    raw = readFileSync(artifactPath, "utf8");
  } catch (error) {
    throw new Error(
      `Invalid incremental-change-staleness report source: execution artifact could not be read at ${artifactPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid incremental-change-staleness report source: execution artifact at ${artifactPath} is not valid JSON.`);
  }

  const candidate = parsed as Partial<IncrementalChangeStalenessExecutionArtifactV1>;
  if (candidate.schemaVersion !== INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION) {
    throw new Error(
      `Invalid incremental-change-staleness report source: unsupported execution artifact schema version ${String(candidate.schemaVersion)}.`
    );
  }
  return candidate as IncrementalChangeStalenessExecutionArtifactV1;
}
