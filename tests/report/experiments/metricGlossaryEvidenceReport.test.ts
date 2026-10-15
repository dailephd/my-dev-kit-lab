import { describe, expect, it } from "vitest";
import type { ExperimentMetric, ExperimentRun } from "../../../src/experiments/index.js";
import { contextStrategyComparisonMetadata } from "../../../src/experiments/plugins/contextStrategyComparison/index.js";
import { AGENT_SUCCESS_METRIC_IDS, AGENT_SUCCESS_MEAN_SOURCES } from "../../../src/experiments/plugins/agentSuccessRate/analysisTypes.js";
import { toExperimentMetric, availableMetric, notApplicableMetric, unavailableMetric } from "../../../src/experiments/plugins/agentSuccessRate/metrics.js";
import { buildPluginExperimentReport } from "../../../src/report/experiments/buildPluginExperimentReport.js";
import type { PluginExperimentReport } from "../../../src/report/experiments/experimentReportModel.js";
import { renderPluginExperimentReportHtml } from "../../../src/report/experiments/renderPluginExperimentReportHtml.js";
import { renderPluginExperimentReportText } from "../../../src/report/experiments/renderPluginExperimentReportText.js";
import { escapeHtml, safeInternalHref } from "../../../src/report/experiments/htmlSafety.js";
import {
  AGENT_SUCCESS_UNMAPPED_METRIC_IDS,
  listMetricDescriptors,
  metricGlossaryAnchor,
  resolveMetricDescriptor,
} from "../../../src/report/experiments/metricGlossary.js";
import { buildMetricEvidenceCaveats, buildMetricEvidenceViews } from "../../../src/report/experiments/metricEvidence.js";

const GENERATED_AT = "2026-06-23T00:00:00.000Z";
const AGENT = "agent-success-rate";
const WARM = "warm-index-reuse";

function makeRun(metrics: ExperimentMetric[], overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    runId: "run-1",
    pluginId: "metric-evidence-test-plugin",
    startedAt: GENERATED_AT,
    completedAt: GENERATED_AT,
    status: "completed",
    target: {
      kind: "external-local",
      toolRoot: "T:\\tool",
      targetRoot: "T:\\target",
      packageName: "pkg",
      packageVersion: "1.0.0",
      hasPackageJson: true,
      hasLockfile: true,
      branch: "main",
      commit: "abc",
      hasGit: true,
      isSelf: false,
    } as ExperimentRun["target"],
    variants: [{ id: "a", name: "A" }],
    cases: [],
    metrics,
    artifacts: [{ id: "x", label: "X", path: "T:\\out\\x.json", kind: "json" }],
    warnings: [],
    failures: [],
    summary: undefined,
    metadata: { outputRoot: "T:\\out" },
    ...overrides,
  } as unknown as ExperimentRun;
}

/** Builds through the real report builder, then presents the report as a given plugin (no family projection). */
function reportFor(pluginId: string, metrics: ExperimentMetric[], overrides: Partial<ExperimentRun> = {}): PluginExperimentReport {
  const built = buildPluginExperimentReport({
    run: makeRun(metrics, overrides),
    plugin: { ...contextStrategyComparisonMetadata, id: "metric-evidence-test-plugin" },
    outputRoot: "T:\\out",
    generatedAt: GENERATED_AT,
  });
  return { ...built, plugin: { ...built.plugin, id: pluginId } };
}

function metric(id: string, value: ExperimentMetric["value"], extra: Partial<ExperimentMetric> = {}): ExperimentMetric {
  return { id, name: id, value, ...extra };
}

function withWarmIndex(report: PluginExperimentReport, tasks: unknown[], tokenEvidenceStatus: string | null): PluginExperimentReport {
  return {
    ...report,
    warmIndexReuse: {
      projects: [{ benchmarkProject: "p", tasks }],
      agentCampaign: tokenEvidenceStatus === null ? null : { tokenEvidenceStatus },
    },
  } as unknown as PluginExperimentReport;
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] as string);
}

function ids(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1] as string));
}

describe("metric glossary descriptors", () => {
  it("links a recognized metric to its own plugin-scoped glossary anchor", () => {
    const html = renderPluginExperimentReportHtml(reportFor(AGENT, [metric(`${AGENT}.taskSuccess`, true)]));
    const descriptor = resolveMetricDescriptor(AGENT, `${AGENT}.taskSuccess`);
    expect(descriptor?.anchor).toBe(metricGlossaryAnchor(AGENT, "taskSuccess"));
    expect(html).toContain(`<a href="#${descriptor?.anchor}">`);
    expect(ids(html).has(descriptor?.anchor as string)).toBe(true);
  });

  it("keeps identical short ids from different plugins distinct", () => {
    const a = resolveMetricDescriptor("retrieval-precision-recall", "retrieved-token-count");
    const b = resolveMetricDescriptor("retrieval-query-strategy-comparison", "retrieved-token-count");
    expect(a && b).toBeTruthy();
    expect(a?.anchor).not.toBe(b?.anchor);
    expect(a?.key).not.toBe(b?.key);
    // An id known only under another plugin must not resolve.
    expect(resolveMetricDescriptor("context-window-scaling", "retrieved-token-count")).toBeNull();
    expect(resolveMetricDescriptor(AGENT, "agent-total-tokens")).toBeNull();
    expect(resolveMetricDescriptor(WARM, "agent-total-tokens")).not.toBeNull();
  });

  it("has unique anchors and every agent-success metric is mapped or explicitly recorded as unmapped", () => {
    const anchors = listMetricDescriptors().map((descriptor) => descriptor.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const descriptor of listMetricDescriptors()) {
      expect(descriptor.definition.length).toBeGreaterThan(0);
      expect(descriptor.anchor).toMatch(/^[a-z][a-z0-9-]*$/);
    }
    const emitted = [...AGENT_SUCCESS_METRIC_IDS, ...Object.keys(AGENT_SUCCESS_MEAN_SOURCES)];
    for (const id of emitted) {
      const mapped = resolveMetricDescriptor(AGENT, `${AGENT}.${id}`) !== null;
      const unmapped = AGENT_SUCCESS_UNMAPPED_METRIC_IDS.includes(id);
      expect(mapped !== unmapped, `${id} must be exactly one of mapped or unmapped`).toBe(true);
    }
    for (const id of AGENT_SUCCESS_UNMAPPED_METRIC_IDS) {
      expect(resolveMetricDescriptor(AGENT, `${AGENT}.${id}`)).toBeNull();
    }
  });

  it("renders an unknown metric without a definition, link or invented unit, and warns about the missing metadata", () => {
    const report = reportFor(AGENT, [metric(`${AGENT}.notARealMetric`, 7)]);
    const html = renderPluginExperimentReportHtml(report);
    expect(html).toContain("notARealMetric");
    expect(html).toContain("(no glossary entry)");
    expect(hrefs(html).some((href) => href.includes("notarealmetric"))).toBe(false);
    expect(html).not.toContain('id="section-metric-glossary"');
    const view = buildMetricEvidenceViews(report)[0]!;
    expect(view.glossaryAnchor).toBeNull();
    expect(view.unit).toBeNull();
    const caveat = buildMetricEvidenceCaveats(report, [view]).find((entry) => entry.kind === "glossary-missing");
    expect(caveat?.text).toContain("notARealMetric");
  });
});

describe("metric evidence views", () => {
  it("keeps a measured zero as zero, never as unavailable", () => {
    const [view] = buildMetricEvidenceViews(reportFor(AGENT, [toExperimentMetric(availableMetric("changedFileCount", 0, "count"), {})]));
    expect(view).toMatchObject({ value: 0, availability: "available", reason: null, unit: "count" });
    const html = renderPluginExperimentReportHtml(reportFor(AGENT, [toExperimentMetric(availableMetric("changedFileCount", 0, "count"), {})]));
    expect(html).toContain("<td>0</td>");
  });

  it("keeps unavailable and not-applicable distinct, with their recorded reasons, and never as zero", () => {
    const report = reportFor(AGENT, [
      toExperimentMetric(unavailableMetric("agentTotalTokens", "tokens", "the provider reported no token usage."), { caseId: "c1" }),
      toExperimentMetric(notApplicableMetric("repairSucceeded", "boolean", "no repair attempt ran."), { caseId: "c1" }),
    ]);
    const [tokens, repair] = buildMetricEvidenceViews(report);
    expect(tokens).toMatchObject({ availability: "unavailable", value: null, reason: "the provider reported no token usage." });
    expect(repair).toMatchObject({ availability: "not-applicable", value: null, reason: "no repair attempt ran." });
    const html = renderPluginExperimentReportHtml(report);
    expect(html).toContain("availability-unavailable");
    expect(html).toContain("availability-not-applicable");
    const metricsSection = html.slice(html.indexOf("section-metrics-title"), html.indexOf("section-evidence-caveats"));
    expect(metricsSection).not.toMatch(/<td>0<\/td>/);
  });

  it("does not invent a reason for a null value without one", () => {
    const [view] = buildMetricEvidenceViews(reportFor("retrieval-precision-recall", [metric("file-recall", null)]));
    expect(view).toMatchObject({ availability: "unavailable", reason: null });
    expect(renderPluginExperimentReportHtml(reportFor("retrieval-precision-recall", [metric("file-recall", null)]))).toContain("no reason recorded");
  });

  it("does not change the metric values or mutate the report", () => {
    const report = reportFor(WARM, [metric("agent-total-tokens", 0, { variantId: "raw-full-file", caseId: "c1", unit: "tokens" })]);
    const before = JSON.stringify(report);
    buildMetricEvidenceViews(report);
    renderPluginExperimentReportHtml(report);
    renderPluginExperimentReportText(report);
    expect(JSON.stringify(report)).toBe(before);
    expect(JSON.stringify(report)).not.toMatch(/glossary|MetricEvidenceView/i);
  });
});

describe("reliability-based caveats", () => {
  const task = (caseId: string, source: string, reliability: string, raw: unknown = { availability: "available" }) => ({
    caseId,
    raw: { agentTotalTokens: raw },
    warm: { agentTotalTokens: { availability: "available" } },
    rawAgent: { tokenUsageSource: source, tokenUsageReliability: reliability },
    warmAgent: null,
  });
  const tokens = (caseId: string, value = 10) =>
    metric("agent-total-tokens", value, { variantId: "raw-full-file", caseId, unit: "tokens" });

  it("labels provider-reported telemetry from the recorded source and reliability", () => {
    const base = reportFor(WARM, [tokens("c1")]);
    const report = withWarmIndex(base, [task("c1", "provider-reported", "high")], null);
    const [view] = buildMetricEvidenceViews(report);
    expect(view).toMatchObject({ provenance: "provider-reported", reliability: "high" });
    expect(buildMetricEvidenceCaveats(report, [view!]).map((c) => c.kind)).toEqual([]);
  });

  it("describes estimated telemetry as an estimate and never as provider usage", () => {
    const report = withWarmIndex(reportFor(WARM, [tokens("c1")]), [task("c1", "estimated-from-text", "low")], null);
    const views = buildMetricEvidenceViews(report);
    expect(views[0]).toMatchObject({ provenance: "estimated", reliability: "low" });
    const caveats = buildMetricEvidenceCaveats(report, views);
    expect(caveats.map((c) => c.kind)).toEqual(["telemetry-reliability-low", "estimated-not-provider-usage"]);
    expect(caveats.find((c) => c.kind === "estimated-not-provider-usage")?.text).toMatch(/not provider-reported usage/);
  });

  it("reports partial campaign telemetry and unavailable agent tokens without presenting them as zero", () => {
    const missing = { availability: "unavailable", value: null, unit: "tokens", source: "agent", reason: "agent reported no total", tokenCountMethod: null };
    const report = withWarmIndex(reportFor(WARM, [tokens("c1")]), [task("c1", "provider-reported", "high"), task("c2", "unavailable", "unavailable", missing)], "partial");
    const views = buildMetricEvidenceViews(report);
    const unavailable = views.find((view) => view.caseId === "c2");
    expect(unavailable).toMatchObject({ availability: "unavailable", value: null, reason: "agent reported no total", provenance: "unknown" });
    const kinds = buildMetricEvidenceCaveats(report, views).map((c) => c.kind);
    expect(kinds).toContain("telemetry-partial");
    expect(kinds).toContain("metric-unavailable");
  });

  it("keeps unknown provenance and missing reliability explicitly unknown", () => {
    const report = reportFor(AGENT, [toExperimentMetric(availableMetric("agentTotalTokens", 120, "tokens"), { caseId: "c1" })]);
    const views = buildMetricEvidenceViews(report);
    expect(views[0]).toMatchObject({ availability: "available", value: 120, provenance: "unknown", reliability: "unknown" });
    const caveats = buildMetricEvidenceCaveats(report, views);
    expect(caveats.map((c) => c.kind)).toEqual(["telemetry-provenance-unknown"]);
    expect(caveats[0]!.text).toMatch(/neither assumed provider-reported nor estimated/);
  });

  it("does not claim reliability for metrics that carry no telemetry", () => {
    const report = reportFor("retrieval-precision-recall", [metric("file-precision", 0.5)]);
    const views = buildMetricEvidenceViews(report);
    expect(views[0]).toMatchObject({ reliability: "unknown", provenance: "derived" });
    expect(buildMetricEvidenceCaveats(report, views)).toEqual([]);
  });

  it("orders caveats deterministically and de-duplicates repeated evidence", () => {
    const metrics = [
      toExperimentMetric(unavailableMetric("agentTotalTokens", "tokens", "no usage."), { caseId: "c2" }),
      toExperimentMetric(unavailableMetric("agentTotalTokens", "tokens", "no usage."), { caseId: "c1" }),
      toExperimentMetric(unavailableMetric("agentDurationMs", "ms", "not measured."), { caseId: "c1" }),
      toExperimentMetric(notApplicableMetric("repairSucceeded", "boolean", "no repair."), { caseId: "c1" }),
    ];
    const report = reportFor(AGENT, metrics);
    const views = buildMetricEvidenceViews(report);
    const first = buildMetricEvidenceCaveats(report, views);
    const second = buildMetricEvidenceCaveats(report, [...views].reverse());
    expect(second).toEqual(first);
    expect(new Set(first.map((c) => c.id)).size).toBe(first.length);
    expect(first.filter((c) => c.metricId === `${AGENT}.agentTotalTokens` && c.kind === "metric-unavailable")).toHaveLength(1);
    expect(first.map((c) => c.kind)).toEqual(["metric-unavailable", "metric-unavailable", "metric-not-applicable"]);
    expect(first.find((c) => c.metricId === `${AGENT}.agentTotalTokens`)!.text).toContain("2 of 2");
  });

  it("supplements and does not replace existing report warnings", () => {
    const report = reportFor(AGENT, [toExperimentMetric(unavailableMetric("agentTotalTokens", "tokens", "no usage."), {})], {
      warnings: [{ code: "legacy-warning", message: "an existing limitation" }],
    });
    const html = renderPluginExperimentReportHtml(report);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(html).toContain("legacy-warning");
    expect(html).toContain("an existing limitation");
    expect(html).toContain("Evidence Caveats");
  });
});

describe("static HTML report UX and safety", () => {
  const rich = (): PluginExperimentReport =>
    reportFor(AGENT, [
      toExperimentMetric(availableMetric("taskSuccess", true, "boolean"), { caseId: "c1", variantId: "raw-full-file" }),
      toExperimentMetric(unavailableMetric("agentTotalTokens", "tokens", "no usage."), { caseId: "c1" }),
    ]);

  it("provides navigation whose targets all exist and metric anchors that all resolve", () => {
    const html = renderPluginExperimentReportHtml(rich());
    const present = ids(html);
    const links = hrefs(html);
    expect(links.length).toBeGreaterThan(5);
    for (const href of links) {
      expect(href.startsWith("#"), `${href} must be an in-document anchor`).toBe(true);
      expect(present.has(href.slice(1)), `${href} must resolve`).toBe(true);
    }
    expect(html).toContain('<nav class="report-nav"');
    expect(html).toContain('href="#section-metrics"');
    expect(html).toContain("skip-link");
  });

  it("is self-contained, script-free and responsive", () => {
    const html = renderPluginExperimentReportHtml(rich());
    expect(html).not.toMatch(/<script|<link\b|<img\b|<iframe|<object|@import|url\(/i);
    expect(html).not.toMatch(/(?:src|href)="(?!#)/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('name="viewport"');
    expect(html).toContain("@media (max-width: 860px)");
    expect(html).toContain('class="table-wrap" role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('<th scope="col">');
    expect((html.match(/<h1>/g) ?? []).length).toBe(1);
  });

  it("escapes malicious metric names, ids, reasons, plugin text and caveat text", () => {
    const evil = '<script>alert(1)</script>"\' onmouseover="x';
    const report = reportFor(AGENT, [
      metric(`${AGENT}.${evil}`, 1, { name: evil, unit: evil, variantId: evil, caseId: evil, description: `unavailable: ${evil}` }),
    ]);
    report.plugin = { ...report.plugin, name: evil, description: evil };
    const html = renderPluginExperimentReportHtml(report);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toMatch(/ onmouseover="x/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;");
    expect(escapeHtml(evil)).not.toMatch(/[<>"']/);
  });

  it("rejects every non-fragment or unsafe link target", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html;base64,AAAA",
      "file:///C:/secret.txt",
      "https://example.com/x",
      "//example.com/x",
      "C:\\Users\\x\\file.html",
      "/etc/passwd",
      "#",
      '#a"onclick="x',
      "#Has Upper",
      "#a b",
      "# javascript:alert(1)",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(safeInternalHref(bad), String(bad)).toBeNull();
    }
    expect(safeInternalHref("#section-metrics")).toBe("#section-metrics");
    expect(safeInternalHref(`#${metricGlossaryAnchor(AGENT, "taskSuccess")}`)).not.toBeNull();
  });

  it("never emits an href or src derived from a malicious metric id", () => {
    const report = reportFor(AGENT, [metric(`${AGENT}.javascript:alert(1)`, 1), metric("data:text/html,x", 2)]);
    const html = renderPluginExperimentReportHtml(report);
    for (const href of hrefs(html)) expect(href.startsWith("#")).toBe(true);
    expect(html).not.toMatch(/(?:href|src)="(?:javascript|data|file):/i);
  });

  it("keeps the external-local target projection redacted", () => {
    const report = reportFor(AGENT, [metric(`${AGENT}.taskSuccess`, true)]);
    const redacted = {
      ...report,
      target: { ...report.target, privacyProjection: "external-local-redacted", packageName: "secret-package", branch: "main" },
    } as PluginExperimentReport;
    const html = renderPluginExperimentReportHtml(redacted);
    expect(html).toContain("<td>redacted</td>");
    expect(html).not.toContain("secret-package@");
  });
});

describe("compatibility", () => {
  it("renders reports for plugins without a glossary or specialized family", () => {
    const html = renderPluginExperimentReportHtml(reportFor("unregistered-plugin", [metric("anything", 3)]));
    expect(html).toContain("Plugin And Target");
    expect(html).toContain("Warnings, Skips, And Failures");
    expect(html).toContain("<h2 id=\"section-metrics-title\">Metrics</h2>");
  });

  it("leaves the plain-text report format unchanged by the glossary projection", () => {
    const text = renderPluginExperimentReportText(reportFor(AGENT, [metric(`${AGENT}.taskSuccess`, true)]));
    expect(text).not.toMatch(/glossary|Evidence Caveats/i);
    expect(text).toContain("value=true");
  });
});
