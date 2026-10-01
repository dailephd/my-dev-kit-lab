import type { ExperimentRun } from "../../experiments/index.js";
import { CONTEXT_WINDOW_SCALING_PLUGIN_ID } from "../../experiments/plugins/contextWindowScaling/metadata.js";
import type { ContextWindowScalingRun } from "../../experiments/plugins/contextWindowScaling/plugin.js";
import {
  CONTEXT_WINDOW_SCALING_REPORT_SCHEMA_VERSION,
  MAX_REPORT_OMITTED_RELEVANT_FILES,
  type ContextWindowScalingReportBoundedListV1,
  type ContextWindowScalingReportCaseTreatmentV1,
  type ContextWindowScalingReportCellV1,
  type ContextWindowScalingReportV1,
} from "./contextWindowScalingReportModel.js";

/** Fixed wording; the report states observed evidence only and never ranks treatments. */
export const CONTEXT_WINDOW_SCALING_INTERPRETATION: readonly string[] = [
  "Estimated context tokens use the Lab deterministic heuristic (characters divided by four, rounded up); they are not provider billing telemetry or a provider model tokenizer result.",
  "The configured budgets are experiment budgets, not claims about actual provider model context-window limits.",
  "context-too-large is an expected measurement state under a budget and is not an operational execution failure.",
  "When a context is too large for a budget, evaluation did not occur, so correctness is unavailable; unavailable correctness is not zero and is excluded from mean correctness.",
  "Success combines context fit with the existing deterministic correctness pass evidence: success is true only when the context fits and correctness passes.",
  "context-too-large is an available, not-successful outcome for the applicable budget and remains in the success-rate denominator.",
  "Operational or evidence-unavailable cells are excluded from the success-rate denominator and are counted separately.",
  "Omitted relevant files are benchmark-expected files that were not observed in the treatment's context provenance.",
  "Omitted relevant files are not full retrieval precision or recall; no precision, recall, or irrelevant-context measure is calculated.",
  "The deterministic fake-agent correctness path is context-independent in the current harness: correctness tests the existing answer-key and evaluation pipeline, not semantic model sensitivity to different context content.",
  "Utilization is estimated context tokens divided by the budget, is not capped at 100 percent, and may exceed 100 for a context that is too large.",
  "No composite score, winner, or ranking is calculated; the treatments are reported side by side.",
];

/**
 * Presents the aggregate and cell evidence already calculated on the run. It performs no fit,
 * success, correctness, or utilization calculation of its own.
 */
export function buildContextWindowScalingReport(run: ExperimentRun): ContextWindowScalingReportV1 | null {
  if (run.pluginId !== CONTEXT_WINDOW_SCALING_PLUGIN_ID) return null;

  const candidate = run as Partial<ContextWindowScalingRun>;
  const evidence = candidate.executionEvidence;
  const aggregate = candidate.aggregate;
  if (!evidence || !aggregate) {
    throw new Error("Invalid context-window-scaling report source: execution evidence and aggregate are required.");
  }
  if (aggregate.caseTreatmentContextSummaries.length !== evidence.length * aggregate.treatments.length) {
    throw new Error("Invalid context-window-scaling report source: aggregate and execution evidence are inconsistent.");
  }

  const caseTreatmentContexts: ContextWindowScalingReportCaseTreatmentV1[] = aggregate.caseTreatmentContextSummaries.map((summary) => {
    const relevant = summary.relevantFileEvidence;
    return {
      caseId: summary.caseId,
      caseName: summary.caseName,
      variantId: summary.variantId,
      contextStatus: summary.contextStatus,
      characterCount: summary.characterCount,
      estimatedTokens: summary.estimatedTokens,
      tokenCountMethod: summary.tokenCountMethod,
      observedFileCount: summary.observedFileCount,
      relevantFileStatus: relevant.status,
      expectedRelevantFileCount: relevant.expectedRelevantFileCount,
      observedExpectedFileCount: relevant.observedExpectedFileCount,
      omittedRelevantFileCount: relevant.omittedRelevantFileCount,
      omittedRelevantFiles: boundedList(relevant.omittedRelevantFiles),
      relevantFileReason: relevant.reason,
    };
  });

  const caseBudgetCells: ContextWindowScalingReportCellV1[] = evidence.flatMap((caseEvidence) =>
    caseEvidence.treatments.flatMap((treatment) =>
      treatment.budgetCells.map((cell) => ({
        caseId: caseEvidence.caseId,
        variantId: treatment.variantId,
        contextEstimatedTokens: treatment.context.estimatedTokens,
        ...structuredClone(cell),
      }))
    )
  );

  return {
    schemaVersion: CONTEXT_WINDOW_SCALING_REPORT_SCHEMA_VERSION,
    budgets: [...aggregate.budgets],
    treatments: [...aggregate.treatments],
    tokenCountMethod: firstTokenCountMethod(aggregate.caseTreatmentContextSummaries.map((summary) => summary.tokenCountMethod)),
    runSummary: { ...aggregate.runSummary },
    budgetTreatmentSummaries: aggregate.budgetTreatmentSummaries.map((summary) => ({ ...summary })),
    caseTreatmentContexts,
    caseBudgetCells,
    relevantFileSummary: { ...aggregate.relevantFileSummary },
    interpretation: [...CONTEXT_WINDOW_SCALING_INTERPRETATION],
  };
}

function boundedList(items: readonly string[]): ContextWindowScalingReportBoundedListV1<string> {
  const displayed = items.slice(0, MAX_REPORT_OMITTED_RELEVANT_FILES);
  return {
    totalCount: items.length,
    displayedCount: displayed.length,
    omittedCount: items.length - displayed.length,
    truncated: items.length > displayed.length,
    items: [...displayed],
  };
}

function firstTokenCountMethod(methods: readonly (string | null)[]): string | null {
  return methods.find((method): method is string => method !== null) ?? null;
}
