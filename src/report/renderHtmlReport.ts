import type { NormalizedLabReport } from "./types.js";

function escapeHtml(value: string | number | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderWarnings(warnings: string[]): string {
  if (warnings.length === 0) {
    return "<p data-testid=\"warnings-empty\">No warnings.</p>";
  }

  return `<ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`;
}

export function renderHtmlReport(report: NormalizedLabReport): string {
  const stepsHtml = report.steps
    .map(
      (step) => `
        <li class="card step" data-testid="step-${escapeHtml(step.id)}">
          <div class="row"><strong>${escapeHtml(step.label)}</strong><span class="badge status-${escapeHtml(step.status)}">${escapeHtml(step.status)}</span></div>
          ${step.command ? `<div class="muted"><code>${escapeHtml(step.command)}</code></div>` : ""}
          ${typeof step.durationMs === "number" ? `<div class="muted">Duration: ${escapeHtml(step.durationMs)} ms</div>` : ""}
          ${step.notes ? `<div>${escapeHtml(step.notes)}</div>` : ""}
        </li>`
    )
    .join("");

  const metricsHtml = report.metrics
    .map(
      (metric) => `
        <li class="card metric" data-testid="metric-${escapeHtml(metric.id)}">
          <div><strong>${escapeHtml(metric.label)}</strong></div>
          <div class="metric-value">${escapeHtml(metric.value)}${metric.unit ? ` ${escapeHtml(metric.unit)}` : ""}</div>
          ${metric.interpretation ? `<div class="muted">${escapeHtml(metric.interpretation)}</div>` : ""}
        </li>`
    )
    .join("");

  const artifactsHtml = report.artifacts
    .map(
      (artifact) => `
        <li class="card artifact" data-testid="artifact-${escapeHtml(artifact.id)}">
          <div class="row"><strong>${escapeHtml(artifact.label)}</strong><span class="badge">${escapeHtml(artifact.kind)}</span></div>
          <div><code>${escapeHtml(artifact.path)}</code></div>
        </li>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(report.title)}</title>
    <style>
      :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; }
      body { margin: 0; background: #f4f6fb; color: #16202a; }
      main { max-width: 1120px; margin: 0 auto; padding: 32px; }
      h1, h2 { margin: 0 0 12px; }
      h1 { font-size: 32px; }
      h2 { font-size: 22px; margin-top: 28px; }
      p { line-height: 1.5; }
      .hero, .section, .card { background: #ffffff; border: 1px solid #d8e0ea; border-radius: 8px; }
      .hero { padding: 24px; }
      .section { padding: 20px; margin-top: 20px; }
      .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
      .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 0; list-style: none; }
      .stack { padding: 0; list-style: none; display: grid; gap: 12px; }
      .card { padding: 16px; }
      .badge { display: inline-block; padding: 4px 10px; background: #e8eef8; border-radius: 999px; font-size: 12px; text-transform: uppercase; }
      .status-pass { background: #dff5e3; color: #0e6b2f; }
      .status-fail { background: #fde2e2; color: #8a1f1f; }
      .status-skipped { background: #ece8ff; color: #5e41b7; }
      .muted { color: #546474; margin-top: 6px; }
      .metric-value { font-size: 28px; margin-top: 8px; }
      code { font-family: Consolas, monospace; font-size: 14px; word-break: break-word; }
      @media (max-width: 800px) { .meta, .grid { grid-template-columns: 1fr; } main { padding: 20px; } }
    </style>
  </head>
  <body>
    <main>
      <section class="hero" data-testid="report-header">
        <h1>${escapeHtml(report.title)}</h1>
        <p>${escapeHtml(report.summary)}</p>
        <div class="meta">
          <div><strong>Project name</strong><div>${escapeHtml(report.projectName)}</div></div>
          <div><strong>Benchmark project</strong><div>${escapeHtml(report.benchmarkProject)}</div></div>
          <div><strong>Workflow name</strong><div>${escapeHtml(report.workflowName)}</div></div>
          <div><strong>Generated timestamp</strong><div>${escapeHtml(report.generatedAt)}</div></div>
        </div>
      </section>
      <section class="section" data-testid="workflow-steps">
        <h2>Workflow steps</h2>
        <ul class="stack">${stepsHtml}</ul>
      </section>
      <section class="section" data-testid="metrics">
        <h2>Metrics</h2>
        <ul class="grid">${metricsHtml}</ul>
      </section>
      <section class="section" data-testid="artifacts">
        <h2>Artifacts</h2>
        <ul class="stack">${artifactsHtml}</ul>
      </section>
      <section class="section" data-testid="warnings">
        <h2>Warnings</h2>
        ${renderWarnings(report.warnings)}
      </section>
    </main>
  </body>
</html>`;
}
