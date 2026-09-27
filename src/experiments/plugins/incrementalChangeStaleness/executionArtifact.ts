import { mkdir, writeFile } from "node:fs/promises";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import type { AffectedNeighborhoodAssessmentV1 } from "../../../evaluation/affectedNeighborhood.js";
import type { MeasuredCommandResult } from "../../../core/runMeasuredCommand.js";
import type { IndexFreshnessAssessmentV1 } from "../../../evaluation/indexFreshness.js";
import type { RequiredFileEvidenceV1 } from "./comparison.js";
import type { IncrementalChangeStalenessTreatmentId } from "./disposableTarget.js";
import type {
  IncrementalChangeStalenessComparisonV1,
  IncrementalChangeStalenessFakeAgentEvidenceV1,
  IncrementalChangeStalenessScenarioExecutionV1,
  IncrementalChangeStalenessTreatmentExecutionV1
} from "./execution.js";
import type { IncrementalChangeStalenessIndexRole } from "./treatmentSession.js";

// ---------------------------------------------------------------------------
// v0.6.2 Batch 4 -- final persisted execution/comparison artifact. Owns only
// the artifact types, the schema constant, the bounded projection from
// runtime evidence, summary counts, and writing the artifact file. No
// comparison formula and no artifact serialization logic for another plugin
// lives here.
// ---------------------------------------------------------------------------

export const INCREMENTAL_CHANGE_STALENESS_EXECUTION_ARTIFACT_FILE = "incremental-change-staleness-execution.json";
export const INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION = "my-dev-kit-lab-incremental-change-staleness-execution-v1";

export type IncrementalChangeStalenessCommandTelemetryV1 = {
  commandId: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  telemetryPath: string;
  error: string | null;
};

export type IncrementalChangeStalenessRetrievalSummaryV1 = {
  status: "completed" | "skipped" | "failed" | "not-run";
  warnings: string[];
  totalChars: number;
  totalEstimatedTokens: number;
  tokenCountMethod: string;
  filesRead: string[];
  selectedNodeId: string | null;
  selectedFile: string | null;
  selectedSymbol: string | null;
  durationMs: number;
  commands: IncrementalChangeStalenessCommandTelemetryV1[];
};

export type IncrementalChangeStalenessFakeAgentSummaryV1 = {
  status: string;
  correctness: {
    available: boolean;
    score: number | null;
    passed: boolean | null;
    failureReasons: string[];
  };
  correctnessDetail: IncrementalChangeStalenessFakeAgentEvidenceV1["correctnessDetail"];
  durationMs: number | null;
  warnings: string[];
  errors: string[];
} | null;

export type IncrementalChangeStalenessTreatmentSummaryV1 = {
  treatmentId: IncrementalChangeStalenessTreatmentId;
  status: "completed" | "partial" | "failed";
  failureReason: string | null;
  activeIndexPhase: IncrementalChangeStalenessIndexRole;
  baselineFreshness: IndexFreshnessAssessmentV1;
  affectedNeighborhood: AffectedNeighborhoodAssessmentV1;
  retrieval: IncrementalChangeStalenessRetrievalSummaryV1;
  fakeAgent: IncrementalChangeStalenessFakeAgentSummaryV1;
  requiredFileEvidence: RequiredFileEvidenceV1;
};

export type IncrementalChangeStalenessLifecycleSummaryV1 = {
  preMutationEquivalence: "equivalent" | "different" | "unknown";
  postMutationEquivalence: "equivalent" | "different" | "unknown";
  controlledFilePaths: string[];
  staleBaselineFreshnessStatus: IndexFreshnessAssessmentV1["status"];
  fullRefreshBaselineFreshnessStatus: IndexFreshnessAssessmentV1["status"];
  fullRefreshRefreshedFreshnessStatus: IndexFreshnessAssessmentV1["status"] | null;
  myDevKitVersion: string | null;
  sourceRoots: string[];
};

export type IncrementalChangeStalenessScenarioExecutionArtifactRecordV1 = {
  scenarioId: string;
  category: string;
  benchmarkProjectId: string;
  baseCaseId: string;
  answerPolicy: string;
  query: string | null;
  expectedFiles: string[];
  expectedSymbols: string[];
  status: "ready" | "failed";
  failureReason: string | null;
  lifecycle: IncrementalChangeStalenessLifecycleSummaryV1 | null;
  stale: IncrementalChangeStalenessTreatmentSummaryV1 | null;
  fullRefresh: IncrementalChangeStalenessTreatmentSummaryV1 | null;
  comparison: IncrementalChangeStalenessComparisonV1;
};

export type IncrementalChangeStalenessExecutionSummaryV1 = {
  scenarioCount: number;
  readyScenarioCount: number;
  failedScenarioCount: number;
  observedStaleRegressionCount: number;
  noObservedStaleRegressionCount: number;
  inconclusiveCount: number;
};

export type IncrementalChangeStalenessExecutionArtifactV1 = {
  schemaVersion: typeof INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION;
  runId: string;
  pluginId: string;
  scenarios: IncrementalChangeStalenessScenarioExecutionArtifactRecordV1[];
  summary: IncrementalChangeStalenessExecutionSummaryV1;
};

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function summarizeCommand(command: MeasuredCommandResult): IncrementalChangeStalenessCommandTelemetryV1 {
  return {
    commandId: command.commandId,
    ok: command.ok,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
    stdoutPath: command.stdoutPath,
    stderrPath: command.stderrPath,
    telemetryPath: command.telemetryPath,
    error: command.error ?? null
  };
}

function summarizeRetrieval(treatment: IncrementalChangeStalenessTreatmentExecutionV1): IncrementalChangeStalenessRetrievalSummaryV1 {
  const retrieval = treatment.retrieval;
  if (!retrieval) {
    return {
      status: "not-run",
      warnings: [],
      totalChars: 0,
      totalEstimatedTokens: 0,
      tokenCountMethod: "unavailable",
      filesRead: [],
      selectedNodeId: null,
      selectedFile: null,
      selectedSymbol: null,
      durationMs: 0,
      commands: []
    };
  }
  return {
    // Bounded status only; never embeds retrieval.contextText (the full context body).
    status: treatment.retrievalStatus === "not-run" ? "not-run" : treatment.retrievalStatus,
    warnings: [...retrieval.warnings],
    totalChars: retrieval.totalChars,
    totalEstimatedTokens: retrieval.totalEstimatedTokens,
    tokenCountMethod: retrieval.tokenCountMethod,
    filesRead: sortedUnique(retrieval.filesRead),
    selectedNodeId: retrieval.selectedNodeId ?? null,
    selectedFile: retrieval.selectedFile ?? null,
    selectedSymbol: retrieval.selectedSymbol ?? null,
    durationMs: retrieval.durationMs,
    commands: retrieval.commands.map(summarizeCommand)
  };
}

function summarizeFakeAgent(treatment: IncrementalChangeStalenessTreatmentExecutionV1): IncrementalChangeStalenessFakeAgentSummaryV1 {
  if (!treatment.fakeAgent) return null;
  const agent = treatment.fakeAgent;
  return {
    status: agent.status,
    correctness: { ...agent.correctness, failureReasons: [...agent.correctness.failureReasons] },
    correctnessDetail: agent.correctnessDetail ? { ...agent.correctnessDetail, failureReasons: [...agent.correctnessDetail.failureReasons] } : null,
    durationMs: agent.durationMs,
    warnings: [...agent.warnings],
    errors: [...agent.errors]
  };
}

function summarizeRequiredFileEvidence(evidence: RequiredFileEvidenceV1): RequiredFileEvidenceV1 {
  return {
    status: evidence.status,
    requiredFiles: sortedUnique(evidence.requiredFiles),
    observedFiles: sortedUnique(evidence.observedFiles),
    missingFiles: sortedUnique(evidence.missingFiles),
    reason: evidence.reason
  };
}

function summarizeTreatment(treatment: IncrementalChangeStalenessTreatmentExecutionV1 | null): IncrementalChangeStalenessTreatmentSummaryV1 | null {
  if (!treatment) return null;
  return {
    treatmentId: treatment.treatmentId,
    status: treatment.status,
    failureReason: treatment.failureReason,
    activeIndexPhase: treatment.activeIndexPhase,
    baselineFreshness: structuredClone(treatment.baselineFreshness),
    affectedNeighborhood: structuredClone(treatment.affectedNeighborhood),
    retrieval: summarizeRetrieval(treatment),
    fakeAgent: summarizeFakeAgent(treatment),
    requiredFileEvidence: summarizeRequiredFileEvidence(treatment.requiredFileEvidence)
  };
}

function summarizeLifecycle(execution: IncrementalChangeStalenessScenarioExecutionV1): IncrementalChangeStalenessLifecycleSummaryV1 | null {
  const session = execution.session;
  if (!session) return null;
  return {
    preMutationEquivalence: session.preMutationEquivalence.result,
    postMutationEquivalence: session.postMutationEquivalence.result,
    controlledFilePaths: [...session.controlledChangedPaths],
    staleBaselineFreshnessStatus: session.treatments["stale-index"].changeAuthority.postMutationBaselineFreshness.status,
    fullRefreshBaselineFreshnessStatus: session.treatments["full-refresh"].changeAuthority.postMutationBaselineFreshness.status,
    fullRefreshRefreshedFreshnessStatus: session.treatments["full-refresh"].refreshedFreshness?.status ?? null,
    myDevKitVersion: session.toolIdentity.version ?? null,
    sourceRoots: [...session.baseCase.sourceRoots]
  };
}

function summarizeScenario(execution: IncrementalChangeStalenessScenarioExecutionV1): IncrementalChangeStalenessScenarioExecutionArtifactRecordV1 {
  return {
    scenarioId: execution.scenarioId,
    category: execution.category,
    benchmarkProjectId: execution.benchmarkProjectId,
    baseCaseId: execution.baseCaseId,
    answerPolicy: execution.answerPolicy,
    query: execution.query,
    expectedFiles: sortedUnique(execution.expectedFiles),
    expectedSymbols: sortedUnique(execution.expectedSymbols),
    status: execution.status,
    failureReason: execution.failureReason,
    lifecycle: summarizeLifecycle(execution),
    // Treatment order in the persisted record is always stale-index then full-refresh.
    stale: summarizeTreatment(execution.stale),
    fullRefresh: summarizeTreatment(execution.fullRefresh),
    comparison: { ...execution.comparison, reasonCodes: [...execution.comparison.reasonCodes] }
  };
}

function summarize(scenarios: readonly IncrementalChangeStalenessScenarioExecutionArtifactRecordV1[]): IncrementalChangeStalenessExecutionSummaryV1 {
  return {
    scenarioCount: scenarios.length,
    readyScenarioCount: scenarios.filter((scenario) => scenario.status === "ready").length,
    failedScenarioCount: scenarios.filter((scenario) => scenario.status === "failed").length,
    observedStaleRegressionCount: scenarios.filter((scenario) => scenario.comparison.staleRiskClassification === "observed-stale-regression").length,
    noObservedStaleRegressionCount: scenarios.filter((scenario) => scenario.comparison.staleRiskClassification === "no-observed-stale-regression").length,
    inconclusiveCount: scenarios.filter((scenario) => scenario.comparison.staleRiskClassification === "inconclusive").length
  };
}

/**
 * Builds the final artifact from already-executed scenario evidence, in the exact order the
 * caller supplies (canonical selected-scenario order). Treatment order within each scenario is
 * always stale-index then full-refresh (`INCREMENTAL_CHANGE_STALENESS_TREATMENT_IDS`).
 */
export function buildIncrementalChangeStalenessExecutionArtifact(args: {
  runId: string;
  pluginId: string;
  executions: readonly IncrementalChangeStalenessScenarioExecutionV1[];
}): IncrementalChangeStalenessExecutionArtifactV1 {
  const scenarios = args.executions.map(summarizeScenario);
  return {
    schemaVersion: INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION,
    runId: args.runId,
    pluginId: args.pluginId,
    scenarios,
    summary: summarize(scenarios)
  };
}

export async function writeIncrementalChangeStalenessExecutionArtifact(
  outDir: string,
  artifact: IncrementalChangeStalenessExecutionArtifactV1
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const artifactPath = resolveWithinRoot(outDir, INCREMENTAL_CHANGE_STALENESS_EXECUTION_ARTIFACT_FILE);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifactPath;
}
