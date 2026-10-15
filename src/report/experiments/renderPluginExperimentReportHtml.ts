import { getSpecializedReportSectionRegistry } from "./specializedReportSections.js";
import type { PluginExperimentReport } from "./experimentReportModel.js";
import { escapeHtml, safeInternalHref, sectionAnchorId } from "./htmlSafety.js";
import { buildMetricEvidenceCaveats, buildMetricEvidenceViews, type MetricCaveatV1, type MetricEvidenceViewV1 } from "./metricEvidence.js";
import { listMetricDescriptors, type MetricDescriptorV1 } from "./metricGlossary.js";

type NavEntry = { anchor: string; label: string };

export function renderPluginExperimentReportHtml(report: PluginExperimentReport): string {
  const redactedTarget = report.target.privacyProjection === "external-local-redacted";
  const views = buildMetricEvidenceViews(report);
  const caveats = buildMetricEvidenceCaveats(report, views);
  const glossary = glossaryDescriptorsFor(views);
  const family = renderSpecializedSections(report);

  const nav: NavEntry[] = [
    { anchor: "section-plugin-target", label: "Plugin And Target" },
    { anchor: "section-interpretation", label: "Interpretation" },
    { anchor: "section-variants", label: "Variants" },
    { anchor: "section-cases", label: "Cases" },
    { anchor: "section-metrics", label: "Metrics" },
    { anchor: "section-evidence-caveats", label: "Evidence Caveats" },
    ...family.nav,
    { anchor: "section-findings", label: "Findings" },
    { anchor: "section-artifacts", label: "Artifacts" },
    ...(glossary.length > 0 ? [{ anchor: "section-metric-glossary", label: "Metric Glossary" }] : []),
  ];

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
    a { color: #0b4f9c; }
    a:focus-visible, .table-wrap:focus-visible { outline: 3px solid #1a5fb4; outline-offset: 2px; }
    .skip-link { position: absolute; left: -9999px; top: 0; background: #fff; padding: 8px 12px; z-index: 10; }
    .skip-link:focus { left: 8px; top: 8px; }
    section, .hero, .report-nav { background: #fff; border: 1px solid #d7e0ea; border-radius: 8px; padding: 18px; margin-bottom: 16px; }
    .report-nav h2 { font-size: 17px; }
    .report-nav ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 16px; }
    .table-wrap { overflow-x: auto; margin: 8px 0 16px; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    caption { text-align: left; font-weight: 700; padding: 4px 0; }
    th, td { border: 1px solid #d9e1ea; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #edf2f7; }
    code { font-family: Consolas, "Courier New", monospace; overflow-wrap: anywhere; }
    .muted { color: #5b6b7b; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .card { border: 1px solid #d9e1ea; border-radius: 6px; padding: 12px; background: #fbfcfe; }
    .badge { display: inline-block; border-radius: 999px; padding: 3px 9px; font-size: 12px; font-weight: 700; text-transform: uppercase; background: #e8eef7; }
    .status-completed { background: #dcf4e4; color: #0c6b30; }
    .status-partial, .status-skipped { background: #fff0ce; color: #785400; }
    .status-failed { background: #fde2e2; color: #8a1f1f; }
    .availability-available { background: #dcf4e4; color: #0c6b30; }
    .availability-unavailable { background: #fde2e2; color: #8a1f1f; border: 1px solid #8a1f1f; }
    .availability-not-applicable { background: #e8eef7; color: #26405e; border: 1px dashed #26405e; }
    .caveat-warning { border-left: 4px solid #a06a00; }
    .caveat-info { border-left: 4px solid #3c6ea8; }
    .caveats { list-style: none; margin: 0; padding: 0; }
    .caveats li { padding: 6px 10px; margin-bottom: 8px; background: #fbfcfe; }
    dt { font-weight: 700; margin-top: 12px; }
    dd { margin: 4px 0 0 16px; }
    @media (max-width: 860px) { main { padding: 14px; } .grid { grid-template-columns: 1fr; } table { font-size: 13px; } }
  </style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to report content</a>
<main id="main-content">
  <header class="hero">
    <h1>${escapeHtml(report.plugin.name)}</h1>
    <p>${escapeHtml(report.plugin.description)}</p>
    <p><span class="badge status-${escapeHtml(report.metadata.status)}">${escapeHtml(report.metadata.status)}</span></p>
    <p class="muted">Generated ${escapeHtml(report.metadata.generatedAt)} for run <code>${escapeHtml(report.metadata.runId)}</code></p>
  </header>

  <nav class="report-nav" aria-labelledby="report-nav-title">
    <h2 id="report-nav-title">Report sections</h2>
    <ul>${nav.map(renderNavLink).join("")}</ul>
  </nav>

  <section id="section-plugin-target" aria-labelledby="section-plugin-target-title">
    <h2 id="section-plugin-target-title">Plugin And Target</h2>
    ${table("Plugin and target", ["Field", "Value"], [
      ["Plugin ID", report.plugin.id],
      ["Plugin schema", report.plugin.schemaVersion],
      ["Mode", report.target.mode],
      ["Tool root", report.target.toolRoot],
      ["Target root", report.target.targetRoot],
      ["Target package", redactedTarget ? "redacted" : report.target.packageName ? `${report.target.packageName}@${report.target.packageVersion ?? "unknown"}` : "unavailable"],
      ["Target branch/commit", report.target.hasGit ? `${report.target.branch ?? "unknown"} / ${report.target.commit ?? "unknown"}` : "unavailable"],
      ["Has package.json", redactedTarget ? "redacted" : String(report.target.hasPackageJson)],
      ["Has lockfile", redactedTarget ? "redacted" : String(report.target.hasLockfile)],
      ["Output root", report.metadata.outputRoot ?? "unavailable"],
    ])}
  </section>

  <section id="section-interpretation" aria-labelledby="section-interpretation-title">
    <h2 id="section-interpretation-title">Interpretation</h2>
    <p>${escapeHtml(report.interpretation.summary)}</p>
    <p><strong>Recommended next step:</strong> ${escapeHtml(report.interpretation.recommendedNextStep)}</p>
  </section>

  <section id="section-variants" aria-labelledby="section-variants-title">
    <h2 id="section-variants-title">Variants</h2>
    ${table("Variant outcome counts", ["Variant", "Completed", "Partial", "Failed", "Skipped"], report.variants.map((variant) => [
      `${variant.name} (${variant.id})`,
      String(variant.completedOutcomes),
      String(variant.partialOutcomes),
      String(variant.failedOutcomes),
      String(variant.skippedOutcomes),
    ]))}
  </section>

  <section id="section-cases" aria-labelledby="section-cases-title">
    <h2 id="section-cases-title">Cases</h2>
    ${table("Case outcome counts", ["Case", "Status", "Completed", "Partial", "Failed", "Skipped"], report.cases.map((experimentCase) => [
      `${experimentCase.name} (${experimentCase.id})`,
      experimentCase.status,
      String(experimentCase.completedOutcomes),
      String(experimentCase.partialOutcomes),
      String(experimentCase.failedOutcomes),
      String(experimentCase.skippedOutcomes),
    ]))}
  </section>

  <section id="section-metrics" aria-labelledby="section-metrics-title">
    <h2 id="section-metrics-title">Metrics</h2>
    <p class="muted">Availability, provenance and reliability are taken from recorded evidence only. <em>Unavailable</em> and <em>not applicable</em> are never zero; <em>unknown</em> means the report does not record that information.</p>
    ${renderMetricsTable(views)}
  </section>

  <section id="section-evidence-caveats" aria-labelledby="section-evidence-caveats-title">
    <h2 id="section-evidence-caveats-title">Evidence Caveats</h2>
    ${renderCaveats(caveats)}
  </section>

  ${family.html}

  <section id="section-findings" aria-labelledby="section-findings-title">
    <h2 id="section-findings-title">Warnings, Skips, And Failures</h2>
    ${report.findings.length ? table("Warnings, skips, and failures", ["Severity", "Code", "Message", "Variant", "Case"], report.findings.map((finding) => [
      finding.severity,
      finding.code,
      finding.message,
      finding.variantId ?? "",
      finding.caseId ?? "",
    ])) : "<p>No warnings, skips, or failures.</p>"}
  </section>

  <section id="section-artifacts" aria-labelledby="section-artifacts-title">
    <h2 id="section-artifacts-title">Artifacts</h2>
    ${table("Artifacts", ["Artifact", "Kind", "Path", "Variant", "Case"], report.artifacts.map((artifact) => [
      `${artifact.label} (${artifact.id})`,
      artifact.kind,
      artifact.path ?? "",
      artifact.variantId ?? "",
      artifact.caseId ?? "",
    ]))}
  </section>
${renderGlossary(glossary)}
</main>
</body>
</html>`;
}

function renderNavLink(entry: NavEntry): string {
  const href = safeInternalHref(`#${entry.anchor}`);
  return href === null ? "" : `<li><a href="${escapeHtml(href)}">${escapeHtml(entry.label)}</a></li>`;
}

// Specialized family sections come from the shared registry, in its deterministic order. Each non-empty
// section is wrapped in an anchored container so the compact navigation can target it.
function renderSpecializedSections(report: PluginExperimentReport): { html: string; nav: NavEntry[] } {
  const nav: NavEntry[] = [];
  const parts: string[] = [];
  const used = new Set<string>();
  for (const descriptor of getSpecializedReportSectionRegistry().descriptors) {
    const rendered = (descriptor.renderHtml as (projection: unknown) => string)(report[descriptor.projectionKey] ?? null);
    if (rendered.trim() === "") continue;
    let anchor = sectionAnchorId(descriptor.id);
    for (let suffix = 2; used.has(anchor); suffix += 1) anchor = `${sectionAnchorId(descriptor.id)}-${suffix}`;
    used.add(anchor);
    nav.push({ anchor, label: descriptor.text.title ?? descriptor.id });
    parts.push(`<div id="${anchor}" class="family-section">${rendered}</div>`);
  }
  return { html: parts.join("\n\n  "), nav };
}

function glossaryDescriptorsFor(views: readonly MetricEvidenceViewV1[]): MetricDescriptorV1[] {
  const anchors = new Set(views.map((view) => view.glossaryAnchor).filter((anchor): anchor is string => anchor !== null));
  return listMetricDescriptors().filter((descriptor) => anchors.has(descriptor.anchor));
}

function renderMetricsTable(views: readonly MetricEvidenceViewV1[]): string {
  const headers = ["Metric", "Value", "Availability", "Unit", "Provenance", "Reliability", "Evidence note", "Variant", "Case"];
  const rows = views.map((view) => {
    const href = safeInternalHref(view.glossaryAnchor === null ? null : `#${view.glossaryAnchor}`);
    const name = href === null
      ? `${escapeHtml(view.displayName)} <code>${escapeHtml(view.metricId)}</code> <span class="muted">(no glossary entry)</span>`
      : `<a href="${escapeHtml(href)}">${escapeHtml(view.displayName)}</a> <code>${escapeHtml(view.metricId)}</code>`;
    const value = view.availability === "available" ? escapeHtml(view.value === null ? "" : String(view.value)) : escapeHtml(view.availability);
    const note = view.availability === "available" ? "" : view.reason ?? "no reason recorded";
    return [
      name,
      value,
      `<span class="badge availability-${escapeHtml(view.availability)}">${escapeHtml(view.availability.replace("-", " "))}</span>`,
      escapeHtml(view.unit ?? ""),
      escapeHtml(view.provenance),
      escapeHtml(view.reliability),
      escapeHtml(note),
      escapeHtml(view.variantId ?? ""),
      escapeHtml(view.caseId ?? ""),
    ];
  });
  return wrapTable("Metrics with availability, provenance and reliability", headers, rows);
}

function renderCaveats(caveats: readonly MetricCaveatV1[]): string {
  if (caveats.length === 0) return "<p>No metric evidence caveats were derived from the recorded evidence.</p>";
  return `<ul class="caveats">${caveats
    .map(
      (caveat) =>
        `<li class="caveat-${escapeHtml(caveat.severity)}"><span class="badge">${escapeHtml(caveat.severity)}</span> ${escapeHtml(caveat.text)}</li>`
    )
    .join("")}</ul>`;
}

function renderGlossary(descriptors: readonly MetricDescriptorV1[]): string {
  if (descriptors.length === 0) return "";
  return `
  <section id="section-metric-glossary" aria-labelledby="section-metric-glossary-title">
    <h2 id="section-metric-glossary-title">Metric Glossary</h2>
    <p class="muted">Definitions are condensed from docs/METRICS.md, the authoritative metric reference. They are descriptive; no composite score is produced.</p>
    <dl>${descriptors
      .map((descriptor) => {
        const caveats = descriptor.caveats.length ? `<br /><strong>Caveats:</strong> ${descriptor.caveats.map((c) => escapeHtml(c)).join(" ")}` : "";
        return `
      <dt id="${escapeHtml(descriptor.anchor)}">${escapeHtml(descriptor.displayName)} <code>${escapeHtml(descriptor.metricId)}</code></dt>
      <dd>${escapeHtml(descriptor.definition)}<br /><strong>Unit:</strong> ${escapeHtml(descriptor.unit ?? "not specified")}<br /><strong>Interpretation:</strong> ${escapeHtml(descriptor.interpretation)}${caveats}<br /><span class="muted">Plugin <code>${escapeHtml(descriptor.pluginId)}</code> · docs/METRICS.md: ${escapeHtml(descriptor.docsSection)}</span></dd>`;
      })
      .join("")}
    </dl>
  </section>
`;
}

function table(caption: string, headers: string[], rows: string[][]): string {
  return wrapTable(caption, headers, rows.map((row) => row.map((cell) => escapeHtml(cell))));
}

/** Cells are already safe HTML. */
function wrapTable(caption: string, headers: string[], rows: string[][]): string {
  return `<div class="table-wrap" role="region" aria-label="${escapeHtml(caption)}" tabindex="0"><table><caption>${escapeHtml(caption)}</caption><thead><tr>${headers
    .map((header) => `<th scope="col">${escapeHtml(header)}</th>`)
    .join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
