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
  listMetricDescriptors,
  metricGlossaryAnchor,
  resolveMetricDescriptor,
} from "../../../src/report/experiments/metricGlossary.js";
import { buildMetricEvidenceCaveats, buildMetricEvidenceViews, type MetricReportEvidence } from "../../../src/report/experiments/metricEvidence.js";
import { readFileSync } from "node:fs";

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

  it("has unique, well-formed anchors and a definition for every descriptor", () => {
    const anchors = listMetricDescriptors().map((descriptor) => descriptor.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const descriptor of listMetricDescriptors()) {
      expect(descriptor.definition.length, descriptor.key).toBeGreaterThan(0);
      expect(descriptor.interpretation.length, descriptor.key).toBeGreaterThan(0);
      expect(descriptor.anchor).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("resolves every metric id the metric calculation owners can emit (source-to-glossary inventory)", () => {
    const read = (file: string): string => readFileSync(file, "utf8");
    const literals = (text: string, pattern: RegExp): string[] => [...text.matchAll(pattern)].map((match) => match[1] as string);

    // agent-success-rate: ids constructed by the metric constructors, plus the declared id vocabularies.
    const agentFiles = ["analysis.ts", "repairAnalysis.ts", "metrics.ts"].map((name) => read(`src/experiments/plugins/agentSuccessRate/${name}`));
    const agentIds = new Set<string>([...AGENT_SUCCESS_METRIC_IDS, ...Object.keys(AGENT_SUCCESS_MEAN_SOURCES)]);
    for (const text of agentFiles) {
      for (const id of literals(text, /\b(?:availableMetric|unavailableMetric|notApplicableMetric|ratioMetric|triMetric|duration|rate|un)\(\s*"([A-Za-z]+)"/g)) agentIds.add(id);
      for (const id of literals(text, /\bretag\([^,]+,\s*"([A-Za-z]+)"/g)) agentIds.add(id);
    }
    expect(agentIds.size).toBeGreaterThan(50);
    const unresolvedAgent = [...agentIds].filter((id) => resolveMetricDescriptor(AGENT, `${AGENT}.${id}`) === null).sort();
    expect(unresolvedAgent).toEqual([]);

    const NON_METRIC = /(^local-repository-subject-manifest$|-execution$|-analysis$|^raw-full-file$|^context-pack$|^my-dev-kit-guided$|^legacy-|^plugin-result$)/;
    const emitted: Array<[string, string[]]> = [
      ["warm-index-reuse", ["src/experiments/plugins/warmIndexReuse/metrics.ts"]],
      ["incremental-change-staleness", ["src/experiments/plugins/incrementalChangeStaleness/plugin.ts"]],
      ["context-window-scaling", ["src/experiments/plugins/contextWindowScaling/plugin.ts", "src/experiments/plugins/contextWindowScaling/metrics.ts"]],
      ["retrieval-precision-recall", ["src/experiments/plugins/retrievalPrecisionRecall/metrics.ts"]],
      ["retrieval-query-strategy-comparison", ["src/experiments/plugins/retrievalQueryStrategyComparison/metrics.ts"]],
      ["context-pack-generation", ["src/experiments/plugins/contextPackGeneration/metrics.ts"]],
      ["context-strategy-comparison", ["src/experiments/plugins/contextStrategyComparison/resultMapping.ts"]]
    ];
    for (const [pluginId, files] of emitted) {
      const ids = new Set<string>();
      for (const source of files) {
        const text = read(source);
        for (const id of literals(text, /(?:\bid:\s*|\b(?:ratio|count|metric)\(\s*)"([a-z0-9][a-z0-9-]*)"/g)) if (!NON_METRIC.test(id)) ids.add(id);
      }
      expect(ids.size, pluginId).toBeGreaterThan(0);
      const unresolved = [...ids].filter((id) => resolveMetricDescriptor(pluginId, id) === null).sort();
      expect({ pluginId, unresolved }).toEqual({ pluginId, unresolved: [] });
    }
  });

  it("resolves documented bounded dynamic families deterministically and rejects everything else", () => {
    const cws = "context-window-scaling";
    for (const id of ["budget-8192-success", "budget-65536-correctness-score", "budget-8192-context-budget-utilization-percent", "context-budget-16384-fit-count", "context-budget-8192-success-rate-percent", "context-budget-8192-mean-context-budget-utilization-percent"]) {
      expect(resolveMetricDescriptor(cws, id), id).not.toBeNull();
    }
    // One shared descriptor and anchor per family, independent of the parameter.
    expect(resolveMetricDescriptor(cws, "budget-8192-success")).toBe(resolveMetricDescriptor(cws, "budget-65536-success"));
    for (const plugin of ["retrieval-query-strategy-comparison", "context-pack-generation"]) {
      for (const scope of ["overall", "localized", "cross-module", "broad-change"]) {
        for (const suffix of ["comparison-case-count", "mean-file-f1", "mean-symbol-f1", "mean-fact-coverage"]) expect(resolveMetricDescriptor(plugin, `${scope}-${suffix}`), `${plugin}/${scope}-${suffix}`).not.toBeNull();
      }
    }
    expect(resolveMetricDescriptor("context-pack-generation", "overall-mean-estimated-token-count")).not.toBeNull();
    expect(resolveMetricDescriptor("retrieval-query-strategy-comparison", "overall-mean-retrieved-token-count")).not.toBeNull();
    expect(resolveMetricDescriptor("context-strategy-comparison", "case-7-token-savings-percent")).not.toBeNull();
    for (const [plugin, id] of [
      [cws, "budget-0-success"],
      [cws, "budget--1-success"],
      [cws, "budget-8192-bogus"],
      [cws, "budget-8192-success<script>"],
      [cws, "context-budget-abc-fit-count"],
      ["retrieval-query-strategy-comparison", "overall-mean-estimated-token-count"],
      ["retrieval-query-strategy-comparison", "nonsense-mean-file-f1"],
      ["warm-index-reuse", "budget-8192-success"],
      ["retrieval-precision-recall", "x-token-savings-percent"]
    ] as const) {
      expect(resolveMetricDescriptor(plugin, id), `${plugin}/${id}`).toBeNull();
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

  it("keeps the existing text sections and adds the same evidence caveats the HTML report shows", () => {
    const report = reportFor(AGENT, [toExperimentMetric(unavailableMetric("agentTotalTokens", "tokens", "no usage."), { caseId: "c1" }), metric(`${AGENT}.taskSuccess`, true)]);
    const text = renderPluginExperimentReportText(report);
    expect(text).toContain("value=true");
    expect(text).toContain("Warnings, Skips, And Failures");
    expect(text).toContain("Metric Evidence Caveats");
    const caveats = buildMetricEvidenceCaveats(report, buildMetricEvidenceViews(report));
    expect(caveats.length).toBeGreaterThan(0);
    const html = renderPluginExperimentReportHtml(report);
    for (const caveat of caveats) {
      expect(text).toContain(caveat.text);
      expect(html).toContain(escapeHtml(caveat.text));
    }
  });

  it("preserves recorded token provenance and keeps aggregates unknown unless every contributor agrees", () => {
    const attempt = (n: number, source: string | null, reliability: string | null, invoked = true, available = true) => ({
      caseId: "c1",
      treatmentId: "raw-full-file",
      attemptNumber: n,
      providerInvoked: invoked,
      tokenSource: source,
      tokenReliability: reliability,
      totalTokensAvailable: available
    });
    const view = (id: string, evidence: MetricReportEvidence) =>
      buildMetricEvidenceViews(reportFor(AGENT, [metric(`${AGENT}.${id}`, 10, { caseId: "c1", variantId: "raw-full-file", unit: "tokens" })]), evidence)[0]!;
    const same: MetricReportEvidence = { agentSuccessAttempts: [attempt(1, "provider-reported", "high"), attempt(2, "provider-reported", "high")] };
    expect(view("agentTotalTokens", same)).toMatchObject({ provenance: "provider-reported", reliability: "high" });
    expect(view("firstAttemptProviderTokens", same)).toMatchObject({ provenance: "provider-reported", reliability: "high" });
    expect(view("totalProviderTokens", same)).toMatchObject({ provenance: "provider-reported", reliability: "high" });
    // Differing reliability: the aggregate provenance is shared, but no aggregate reliability is attributed.
    const mixed: MetricReportEvidence = { agentSuccessAttempts: [attempt(1, "provider-reported", "high"), attempt(2, "provider-reported", "low")] };
    expect(view("totalProviderTokens", mixed)).toMatchObject({ provenance: "provider-reported", reliability: "unknown" });
    expect(view("agentTotalTokens", mixed)).toMatchObject({ reliability: "low" });
    // An incomplete contributor leaves the aggregate fully unknown.
    const incomplete: MetricReportEvidence = { agentSuccessAttempts: [attempt(1, "provider-reported", "high"), attempt(2, null, null, true, false)] };
    expect(view("totalProviderTokens", incomplete)).toMatchObject({ provenance: "unknown", reliability: "unknown" });
    // Estimated usage is never relabeled as provider usage; absent evidence stays unknown.
    expect(view("agentTotalTokens", { agentSuccessAttempts: [attempt(1, "estimated-from-text", "low")] })).toMatchObject({ provenance: "estimated", reliability: "low" });
    expect(view("agentTotalTokens", {})).toMatchObject({ provenance: "unknown", reliability: "unknown" });
    expect(view("agentTotalTokens", { agentSuccessAttempts: [attempt(1, "otel", "medium")] })).toMatchObject({ provenance: "unknown" });
  });

  it("attributes cumulative warm-index token telemetry only over a uniformly known strict prefix", () => {
    const agent = (source: string, reliability: string) => ({ tokenUsageSource: source, tokenUsageReliability: reliability });
    const task = (ordinal: number, caseId: string, raw: ReturnType<typeof agent> | null) => ({ taskOrdinal: ordinal, caseId, rawAgent: raw, warmAgent: null, raw: {}, warm: {} });
    const build = (tasks: unknown[]) =>
      withWarmIndex(
        reportFor(WARM, [
          metric("cumulative-agent-total-tokens", 20, { variantId: "raw-full-file", caseId: "c2", unit: "tokens" }),
          metric("agent-total-tokens", 10, { variantId: "raw-full-file", caseId: "c2", unit: "tokens" })
        ]),
        tasks,
        null
      );
    const uniform = buildMetricEvidenceViews(build([task(1, "c1", agent("provider-reported", "high")), task(2, "c2", agent("provider-reported", "high"))]));
    expect(uniform[0]).toMatchObject({ provenance: "provider-reported", reliability: "high" });
    const mixed = buildMetricEvidenceViews(build([task(1, "c1", agent("provider-reported", "high")), task(2, "c2", agent("estimated-from-text", "low"))]));
    expect(mixed[0]).toMatchObject({ provenance: "unknown", reliability: "unknown" });
    expect(mixed[1]).toMatchObject({ provenance: "estimated", reliability: "low" });
    const missing = buildMetricEvidenceViews(build([task(1, "c1", null), task(2, "c2", agent("provider-reported", "high"))]));
    expect(missing[0]).toMatchObject({ provenance: "unknown", reliability: "unknown" });
  });
});
