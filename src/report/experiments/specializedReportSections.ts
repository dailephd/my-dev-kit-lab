// The registered specialized report families. Each descriptor adapts an existing family builder and
// renderer; no builder or renderer is cloned here. Order values reproduce the established section order
// (plugin families are mutually exclusive, so at most one family projection is present for a given run).

import { AGENT_SUCCESS_RATE_PLUGIN_ID } from "../../experiments/plugins/agentSuccessRate/metadata.js";
import { CONTEXT_PACK_GENERATION_PLUGIN_ID } from "../../experiments/plugins/contextPackGeneration/metadata.js";
import { CONTEXT_WINDOW_SCALING_PLUGIN_ID } from "../../experiments/plugins/contextWindowScaling/metadata.js";
import { INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID } from "../../experiments/plugins/incrementalChangeStaleness/plugin.js";
import { RETRIEVAL_PRECISION_RECALL_PLUGIN_ID } from "../../experiments/plugins/retrievalPrecisionRecall/metadata.js";
import { RETRIEVAL_QUERY_STRATEGY_COMPARISON_PLUGIN_ID } from "../../experiments/plugins/retrievalQueryStrategyComparison/metadata.js";
import { buildAgentSuccessRateReport } from "./buildAgentSuccessRateReport.js";
import { buildContextPackGenerationReport } from "./buildContextPackGenerationReport.js";
import { buildContextStrategyComparisonV043Report } from "./buildContextStrategyComparisonV043Report.js";
import { buildContextWindowScalingReport } from "./buildContextWindowScalingReport.js";
import { buildIncrementalChangeStalenessPluginReport } from "./buildIncrementalChangeStalenessPluginReport.js";
import { buildRetrievalPrecisionRecallReport } from "./buildRetrievalPrecisionRecallReport.js";
import { buildRetrievalQueryStrategyComparisonReport } from "./buildRetrievalQueryStrategyComparisonReport.js";
import { buildWarmIndexReuseReport } from "./buildWarmIndexReuseReport.js";
import { renderAgentSuccessRateHtml } from "./renderAgentSuccessRateHtml.js";
import { renderAgentSuccessRateTextLines } from "./renderAgentSuccessRateText.js";
import { renderContextPackGenerationHtml } from "./renderContextPackGenerationHtml.js";
import { renderContextPackGenerationTextLines } from "./renderContextPackGenerationText.js";
import { renderContextStrategyComparisonV043Html } from "./renderContextStrategyComparisonV043Html.js";
import { renderContextWindowScalingHtml } from "./renderContextWindowScalingHtml.js";
import { renderContextWindowScalingTextLines } from "./renderContextWindowScalingText.js";
import { renderIncrementalChangeStalenessHtml } from "./renderIncrementalChangeStalenessHtml.js";
import { renderRetrievalPrecisionRecallHtml } from "./renderRetrievalPrecisionRecallHtml.js";
import { renderRetrievalPrecisionRecallTextLines } from "./renderRetrievalPrecisionRecallText.js";
import { renderRetrievalQueryStrategyComparisonHtml } from "./renderRetrievalQueryStrategyComparisonHtml.js";
import { renderRetrievalQueryStrategyComparisonTextLines } from "./renderRetrievalQueryStrategyComparisonText.js";
import { renderWarmIndexReuseHtml } from "./renderWarmIndexReuseHtml.js";
import {
  renderIncrementalChangeStalenessSection,
  renderV043Section,
  renderWarmIndexReuseSection,
} from "./renderSpecializedTextSections.js";
import type { PluginExperimentReport } from "./experimentReportModel.js";
import {
  createReportSectionRegistry,
  type ReportSectionBuildContext,
  type ReportSectionDescriptorV1,
  type ReportSectionRegistry,
  type SpecializedReportProjectionKey,
} from "./reportSectionRegistry.js";

const WARM_INDEX_REUSE_PLUGIN_ID = "warm-index-reuse";
const CONTEXT_STRATEGY_COMPARISON_PLUGIN_ID = "context-strategy-comparison";

export const SPECIALIZED_REPORT_SECTION_DESCRIPTORS: readonly ReportSectionDescriptorV1[] = [
  {
    id: "context-strategy.v043",
    order: 10,
    projectionKey: "contextStrategyComparisonV043",
    appliesTo: { pluginIds: [CONTEXT_STRATEGY_COMPARISON_PLUGIN_ID] },
    text: { title: "V0.4.3 Stage-Context Evidence", whenAbsent: "placeholder" },
    build: ({ run }) => buildContextStrategyComparisonV043Report(run),
    renderText: (lines, projection) => renderV043Section(lines, projection),
    renderHtml: (projection) => renderContextStrategyComparisonV043Html(projection),
  } as ReportSectionDescriptorV1<"contextStrategyComparisonV043">,
  {
    id: "warm-index.reuse",
    order: 20,
    projectionKey: "warmIndexReuse",
    appliesTo: { pluginIds: [WARM_INDEX_REUSE_PLUGIN_ID] },
    text: { title: "Warm Index Reuse Evidence", whenAbsent: "placeholder" },
    build: ({ run }) => buildWarmIndexReuseReport(run),
    renderText: (lines, projection) => renderWarmIndexReuseSection(lines, projection),
    renderHtml: (projection) => renderWarmIndexReuseHtml(projection),
  } as ReportSectionDescriptorV1<"warmIndexReuse">,
  {
    id: "incremental-change.staleness",
    order: 30,
    projectionKey: "incrementalChangeStaleness",
    appliesTo: { pluginIds: [INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID] },
    text: { title: "Incremental-Change And Staleness Evidence", whenAbsent: "placeholder" },
    // The V1/V2 schema-version dispatch stays owned by the existing plugin report builder.
    build: ({ run }) => buildIncrementalChangeStalenessPluginReport(run),
    renderText: (lines, projection) => renderIncrementalChangeStalenessSection(lines, projection),
    renderHtml: (projection) => renderIncrementalChangeStalenessHtml(projection),
  } as ReportSectionDescriptorV1<"incrementalChangeStaleness">,
  {
    id: "context-window.scaling",
    order: 40,
    projectionKey: "contextWindowScaling",
    appliesTo: { pluginIds: [CONTEXT_WINDOW_SCALING_PLUGIN_ID] },
    text: { title: "Context Window Scaling", whenAbsent: "placeholder" },
    build: ({ run }) => buildContextWindowScalingReport(run),
    renderText: (lines, projection) => {
      lines.push(...renderContextWindowScalingTextLines(projection));
    },
    renderHtml: (projection) => renderContextWindowScalingHtml(projection),
  } as ReportSectionDescriptorV1<"contextWindowScaling">,
  {
    id: "retrieval.precision-recall",
    order: 50,
    projectionKey: "retrievalPrecisionRecall",
    appliesTo: { pluginIds: [RETRIEVAL_PRECISION_RECALL_PLUGIN_ID] },
    text: { title: "Retrieval Precision/Recall", whenAbsent: "placeholder" },
    build: ({ run }) => buildRetrievalPrecisionRecallReport(run),
    renderText: (lines, projection) => {
      lines.push(...renderRetrievalPrecisionRecallTextLines(projection));
    },
    renderHtml: (projection) => renderRetrievalPrecisionRecallHtml(projection ?? null),
  } as ReportSectionDescriptorV1<"retrievalPrecisionRecall">,
  {
    id: "retrieval.query-strategy-comparison",
    order: 60,
    projectionKey: "retrievalQueryStrategyComparison",
    appliesTo: { pluginIds: [RETRIEVAL_QUERY_STRATEGY_COMPARISON_PLUGIN_ID] },
    text: { title: "Retrieval Query Strategy Comparison", whenAbsent: "placeholder" },
    build: ({ run }) => buildRetrievalQueryStrategyComparisonReport(run),
    renderText: (lines, projection) => {
      lines.push(...renderRetrievalQueryStrategyComparisonTextLines(projection));
    },
    renderHtml: (projection) => renderRetrievalQueryStrategyComparisonHtml(projection ?? null),
  } as ReportSectionDescriptorV1<"retrievalQueryStrategyComparison">,
  {
    id: "retrieval.context-pack-generation",
    order: 70,
    projectionKey: "contextPackGeneration",
    appliesTo: { pluginIds: [CONTEXT_PACK_GENERATION_PLUGIN_ID] },
    text: { title: "Context Pack Generation", whenAbsent: "omit" },
    build: ({ run, contextPacks }) => buildContextPackGenerationReport(run, contextPacks),
    renderText: (lines, projection) => {
      lines.push(...renderContextPackGenerationTextLines(projection));
    },
    renderHtml: (projection) => renderContextPackGenerationHtml(projection ?? null),
  } as ReportSectionDescriptorV1<"contextPackGeneration">,
  {
    id: "agent-success.rate",
    order: 80,
    projectionKey: "agentSuccessRate",
    appliesTo: { pluginIds: [AGENT_SUCCESS_RATE_PLUGIN_ID] },
    // The family renderer writes its own headings.
    text: { title: null, whenAbsent: "omit" },
    build: ({ run }) => buildAgentSuccessRateReport(run),
    renderText: (lines, projection) => {
      lines.push(...renderAgentSuccessRateTextLines(projection));
    },
    renderHtml: (projection) => renderAgentSuccessRateHtml(projection ?? null),
  } as ReportSectionDescriptorV1<"agentSuccessRate">,
] as unknown as readonly ReportSectionDescriptorV1[];

let defaultRegistry: ReportSectionRegistry | undefined;

/** The shared registry used by report generation. Assembled once; immutable afterwards. */
export function getSpecializedReportSectionRegistry(): ReportSectionRegistry {
  defaultRegistry ??= createReportSectionRegistry(SPECIALIZED_REPORT_SECTION_DESCRIPTORS);
  return defaultRegistry;
}

export type SpecializedReportProjections = Pick<PluginExperimentReport, SpecializedReportProjectionKey>;

/** Builds every registered specialized projection once, in registry order, using the family builders. */
export function buildSpecializedReportProjections(context: ReportSectionBuildContext): SpecializedReportProjections {
  const projections: Record<string, unknown> = {};
  for (const descriptor of getSpecializedReportSectionRegistry().descriptors) {
    projections[descriptor.projectionKey] = descriptor.build(context);
  }
  return projections as SpecializedReportProjections;
}
