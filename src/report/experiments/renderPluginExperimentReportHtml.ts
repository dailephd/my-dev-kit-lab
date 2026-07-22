import type { PluginExperimentReport } from "./experimentReportModel.js";
import { renderContextStrategyComparisonV043Html } from "./renderContextStrategyComparisonV043Html.js";

export function renderPluginExperimentReportHtml(report: PluginExperimentReport): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(report.plugin.name)} Report</title>
  <style>
    :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; }
    body { margin: 0; color: #18212b; background: #f6f8fb; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    h1 { margin: 0 0 6px; font-size: 32px; }
    h2 { margin: 0 0 12px; font-size: 22px; }
    h3 { margin: 14px 0 8px; font-size: 17px; }
    p, li { line-height: 1.45; }
    section, .hero { background: #fff; border: 1px solid #d7e0ea; border-radius: 8px; padding: 18px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; background: #fff; }
    th, td { border: 1px solid #d9e1ea; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #edf2f7; }
    code { font-family: Consolas, "Courier New", monospace; }
    .muted { color: #5b6b7b; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .card { border: 1px solid #d9e1ea; border-radius: 6px; padding: 12px; background: #fbfcfe; }
    .badge { display: inline-block; border-radius: 999px; padding: 3px 9px; font-size: 12px; font-weight: 700; text-transform: uppercase; background: #e8eef7; }
    .status-completed { background: #dcf4e4; color: #0c6b30; }
    .status-partial, .status-skipped { background: #fff0ce; color: #785400; }
    .status-failed { background: #fde2e2; color: #8a1f1f; }
    @media (max-width: 860px) { main { padding: 14px; } .grid { grid-template-columns: 1fr; } table { font-size: 13px; } }
  </style>
</head>
<body>
<main>
  <header class="hero">
    <h1>${escapeHtml(report.plugin.name)}</h1>
    <p>${escapeHtml(report.plugin.description)}</p>
    <p><span class="badge status-${escapeHtml(report.metadata.status)}">${escapeHtml(report.metadata.status)}</span></p>
    <p class="muted">Generated ${escapeHtml(report.metadata.generatedAt)} for run <code>${escapeHtml(report.metadata.runId)}</code></p>
  </header>

  <section>
    <h2>Plugin And Target</h2>
    ${table(["Field", "Value"], [
      ["Plugin ID", report.plugin.id],
      ["Plugin schema", report.plugin.schemaVersion],
      ["Mode", report.target.mode],
      ["Tool root", report.target.toolRoot],
      ["Target root", report.target.targetRoot],
      ["Target package", report.target.packageName ? `${report.target.packageName}@${report.target.packageVersion ?? "unknown"}` : "unavailable"],
      ["Target branch/commit", report.target.hasGit ? `${report.target.branch ?? "unknown"} / ${report.target.commit ?? "unknown"}` : "unavailable"],
      ["Has package.json", String(report.target.hasPackageJson)],
      ["Has lockfile", String(report.target.hasLockfile)],
      ["Output root", report.metadata.outputRoot ?? "unavailable"],
    ])}
  </section>

  <section>
    <h2>Interpretation</h2>
    <p>${escapeHtml(report.interpretation.summary)}</p>
    <p><strong>Recommended next step:</strong> ${escapeHtml(report.interpretation.recommendedNextStep)}</p>
  </section>

  <section>
    <h2>Variants</h2>
    ${table(["Variant", "Completed", "Partial", "Failed", "Skipped"], report.variants.map((variant) => [
      `${variant.name} (${variant.id})`,
      String(variant.completedOutcomes),
      String(variant.partialOutcomes),
      String(variant.failedOutcomes),
      String(variant.skippedOutcomes),
    ]))}
  </section>

  <section>
    <h2>Cases</h2>
    ${table(["Case", "Status", "Completed", "Partial", "Failed", "Skipped"], report.cases.map((experimentCase) => [
      `${experimentCase.name} (${experimentCase.id})`,
      experimentCase.status,
      String(experimentCase.completedOutcomes),
      String(experimentCase.partialOutcomes),
      String(experimentCase.failedOutcomes),
      String(experimentCase.skippedOutcomes),
    ]))}
  </section>

  <section>
    <h2>Metrics</h2>
    ${table(["Metric", "Value", "Unit", "Variant", "Case"], report.metrics.map((metric) => [
      `${metric.name} (${metric.id})`,
      String(metric.value ?? ""),
      metric.unit ?? "",
      metric.variantId ?? "",
      metric.caseId ?? "",
    ]))}
  </section>

  ${renderContextStrategyComparisonV043Html(report.contextStrategyComparisonV043)}

  <section>
    <h2>Warnings, Skips, And Failures</h2>
    ${report.findings.length ? table(["Severity", "Code", "Message", "Variant", "Case"], report.findings.map((finding) => [
      finding.severity,
      finding.code,
      finding.message,
      finding.variantId ?? "",
      finding.caseId ?? "",
    ])) : "<p>No warnings, skips, or failures.</p>"}
  </section>

  <section>
    <h2>Artifacts</h2>
    ${table(["Artifact", "Kind", "Path", "Variant", "Case"], report.artifacts.map((artifact) => [
      `${artifact.label} (${artifact.id})`,
      artifact.kind,
      artifact.path ?? "",
      artifact.variantId ?? "",
      artifact.caseId ?? "",
    ]))}
  </section>
</main>
</body>
</html>`;
}

function table(headers: string[], rows: string[][]): string {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function escapeHtml(value: string | number | boolean | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

