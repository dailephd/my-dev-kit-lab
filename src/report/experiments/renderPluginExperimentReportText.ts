import type { PluginExperimentReport } from "./experimentReportModel.js";
import { pushDashList, fieldLine, pushSection } from "./renderSpecializedTextSections.js";
import { buildMetricEvidenceCaveats, buildMetricEvidenceViews, type MetricReportEvidence } from "./metricEvidence.js";
import { getSpecializedReportSectionRegistry } from "./specializedReportSections.js";

export function renderPluginExperimentReportText(report: PluginExperimentReport, evidence?: MetricReportEvidence): string {
  const lines: string[] = [];

  pushSection(lines, "Plugin Experiment Report");

  pushSection(lines, "Report Metadata");
  lines.push(fieldLine("Generated At", report.metadata.generatedAt));
  lines.push(fieldLine("Run ID", report.metadata.runId));
  lines.push(fieldLine("Started At", report.metadata.startedAt));
  lines.push(fieldLine("Completed At", report.metadata.completedAt));
  lines.push(fieldLine("Status", report.metadata.status));
  lines.push(fieldLine("Output Root", report.metadata.outputRoot));

  pushSection(lines, "Plugin And Target");
  lines.push(fieldLine("Plugin ID", report.plugin.id));
  lines.push(fieldLine("Plugin Name", report.plugin.name));
  lines.push(fieldLine("Plugin Schema Version", report.plugin.schemaVersion));
  lines.push(fieldLine("Mode", report.target.mode));
  lines.push(fieldLine("Tool Root", report.target.toolRoot));
  lines.push(fieldLine("Target Root", report.target.targetRoot));

  pushSection(lines, "Interpretation");
  lines.push(fieldLine("Summary", report.interpretation.summary));
  lines.push(fieldLine("Recommended Next Step", report.interpretation.recommendedNextStep));

  pushSection(lines, "Variants");
  pushDashList(
    lines,
    report.variants.map(
      (variant) =>
        `${variant.name} (${variant.id}) completed=${variant.completedOutcomes} partial=${variant.partialOutcomes} failed=${variant.failedOutcomes} skipped=${variant.skippedOutcomes}`
    )
  );

  pushSection(lines, "Cases");
  pushDashList(
    lines,
    report.cases.map(
      (experimentCase) =>
        `${experimentCase.name} (${experimentCase.id}) status=${experimentCase.status} completed=${experimentCase.completedOutcomes} partial=${experimentCase.partialOutcomes} failed=${experimentCase.failedOutcomes} skipped=${experimentCase.skippedOutcomes}`
    )
  );

  pushSection(lines, "Metrics");
  pushDashList(
    lines,
    report.metrics.map(
      (metric) => `${metric.name} (${metric.id}) value=${metric.value ?? "unavailable"} unit=${metric.unit ?? ""}`
    )
  );

  // Evidence caveats come from the same projection the HTML report uses; they supplement existing warnings.
  pushSection(lines, "Metric Evidence Caveats");
  const caveats = buildMetricEvidenceCaveats(report, buildMetricEvidenceViews(report, evidence));
  pushDashList(lines, caveats.length === 0 ? ["none derived from the recorded evidence"] : caveats.map((caveat) => `${caveat.severity} ${caveat.text}`));

  // Specialized family sections come from the shared registry, in its deterministic order.
  for (const section of getSpecializedReportSectionRegistry().resolve(report)) {
    const descriptor = section.descriptor;
    if (!descriptor) continue;
    if (section.availability === "available") {
      if (descriptor.text.title !== null) pushSection(lines, descriptor.text.title);
      (descriptor.renderText as (target: string[], projection: unknown) => void)(lines, report[descriptor.projectionKey]);
    } else if (descriptor.text.whenAbsent === "placeholder") {
      pushSection(lines, descriptor.text.title as string);
      lines.push("Not applicable to this plugin.");
    }
  }

  pushSection(lines, "Warnings, Skips, And Failures");
  pushDashList(
    lines,
    report.findings.map(
      (finding) => `${finding.severity} ${finding.code} ${finding.message} variant=${finding.variantId ?? ""} case=${finding.caseId ?? ""}`
    )
  );

  pushSection(lines, "Artifacts");
  pushDashList(
    lines,
    report.artifacts.map((artifact) => `${artifact.label} (${artifact.id}) kind=${artifact.kind} path=${artifact.path ?? ""}`)
  );

  return `${lines.join("\n")}\n`;
}
