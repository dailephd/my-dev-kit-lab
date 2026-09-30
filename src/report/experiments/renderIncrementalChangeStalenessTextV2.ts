// v0.6.3 -- V2 text section for the incremental-change-staleness plugin report. Renders only persisted
// V2 report-model fields (via the shared row builders); no recomputation. Lists are bounded.

import {
  COMPARISON_PRESENTATION_ORDER,
  EVIDENCE_FAMILY_NOTE,
  SCENARIO_SUMMARY_ROWS,
  TREATMENT_PRESENTATION_ORDER,
  affectedNeighborhoodSummary,
  comparisonBlock,
  treatmentBlock
} from "./incrementalChangeStalenessReportRowsV2.js";
import type { IncrementalChangeStalenessReportScenarioV2, IncrementalChangeStalenessReportV2 } from "./incrementalChangeStalenessReportModelV2.js";

export type TextHelpers = {
  pushSection: (lines: string[], title: string) => void;
  fieldLine: (label: string, value: unknown) => string;
  pushDashList: (lines: string[], items: string[]) => void;
  pushBoundedStringList: (lines: string[], label: string, items: readonly string[]) => void;
};

function renderScenario(lines: string[], scenario: IncrementalChangeStalenessReportScenarioV2, h: TextHelpers): void {
  h.pushSection(lines, `Scenario: ${scenario.scenarioId}`);
  lines.push(h.fieldLine("Category", scenario.category));
  lines.push(h.fieldLine("Status", scenario.status));
  lines.push(h.fieldLine("Failure Reason", scenario.failureReason));
  lines.push(h.fieldLine("Benchmark Project", scenario.benchmarkProjectId));
  lines.push(h.fieldLine("Base Case", scenario.baseCaseId));
  lines.push(h.fieldLine("Answer Policy", scenario.answerPolicy));
  lines.push(h.fieldLine("Query", scenario.query));
  h.pushBoundedStringList(lines, "Expected Files", scenario.expectedFiles);
  h.pushBoundedStringList(lines, "Expected Symbols", scenario.expectedSymbols);

  h.pushSection(lines, "Lifecycle");
  const lifecycle = scenario.lifecycle;
  if (!lifecycle) {
    lines.push("Not available.");
  } else {
    lines.push(h.fieldLine("my-dev-kit Version", lifecycle.myDevKitVersion));
    lines.push(h.fieldLine("Index Invocations (total)", lifecycle.totalIndexInvocationCount));
    lines.push(h.fieldLine("Freshness Assessments (total)", lifecycle.totalFreshnessAssessmentCount));
    for (const [treatmentId, result] of Object.entries(lifecycle.preMutationEquivalence)) {
      lines.push(h.fieldLine(`Pre-Mutation Equivalence (${treatmentId} vs stale-index reference)`, result));
    }
    for (const [treatmentId, result] of Object.entries(lifecycle.postMutationEquivalence)) {
      lines.push(h.fieldLine(`Post-Mutation Equivalence (${treatmentId} vs stale-index reference)`, result));
    }
    h.pushBoundedStringList(lines, "Controlled File Paths", lifecycle.controlledFilePaths);
    h.pushBoundedStringList(lines, "Source Roots", lifecycle.sourceRoots);
  }

  h.pushSection(lines, "Affected-Neighborhood Evidence (changed baseline neighborhood relative to the task)");
  const affected = affectedNeighborhoodSummary(scenario);
  if (affected.state === "none") {
    lines.push("Not available.");
  } else if (affected.state === "inconsistent") {
    lines.push("inconsistent persisted evidence");
  } else {
    for (const [label, value] of affected.rows) lines.push(h.fieldLine(label, value));
    lines.push(h.fieldLine("Reindex Recommendation Explanation", affected.explanation));
  }
  lines.push(EVIDENCE_FAMILY_NOTE);

  if (scenario.treatments.length === 0) {
    h.pushSection(lines, "Treatments");
    lines.push("Not produced: the scenario failed before any treatment evidence existed.");
  } else {
    for (const entry of TREATMENT_PRESENTATION_ORDER) {
      const block = treatmentBlock(scenario, entry.id, entry.label);
      h.pushSection(lines, `${block.label} Treatment (${entry.id})`);
      if (!block.available) {
        lines.push("Not available.");
        continue;
      }
      for (const [label, value] of block.rows) lines.push(h.fieldLine(label, value));
      lines.push("Refresh Execution (upstream evidence of what my-dev-kit actually did):");
      for (const [label, value] of block.refreshRows) lines.push(h.fieldLine(label, value));
      if (block.fallbackStatement) lines.push(block.fallbackStatement);
      if (block.forcedNeighborSample) h.pushBoundedStringList(lines, "Forced-Neighbor Sample", block.forcedNeighborSample);
      h.pushBoundedStringList(lines, "Files Read", block.filesRead);
      h.pushBoundedStringList(lines, "Required Files", block.requiredFiles);
      h.pushBoundedStringList(lines, "Observed Files", block.observedFiles);
      h.pushBoundedStringList(lines, "Missing Files", block.missingFiles);
    }
  }

  h.pushSection(lines, "Reference Comparisons (against the full-refresh reference)");
  for (const entry of COMPARISON_PRESENTATION_ORDER) {
    const block = comparisonBlock(scenario, entry);
    lines.push(block.label);
    if (!block.available) {
      lines.push("Not available.");
      continue;
    }
    for (const [label, value] of block.rows) lines.push(h.fieldLine(label, value));
    h.pushDashList(lines, block.reasonCodes);
    lines.push(block.explanation);
  }
}

export function renderIncrementalChangeStalenessSectionV2(lines: string[], section: IncrementalChangeStalenessReportV2, h: TextHelpers): void {
  h.pushSection(lines, "Summary");
  for (const [label, value] of SCENARIO_SUMMARY_ROWS(section.summary)) lines.push(h.fieldLine(label, value));
  for (const scenario of section.scenarios) renderScenario(lines, scenario, h);
  h.pushSection(lines, "Limitations");
  h.pushDashList(lines, section.limitations);
}
