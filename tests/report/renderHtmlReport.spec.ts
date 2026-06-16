import { describe, expect, it } from "vitest";
import { normalizeLabReport } from "../../src/report/types.js";
import { renderHtmlReport } from "../../src/report/renderHtmlReport.js";

const baseReport = normalizeLabReport({
  reportId: "demo-report",
  title: "Demo <Report>",
  projectName: "my-dev-kit-lab",
  benchmarkProject: "todo-ts",
  workflowName: "benchmark validation demo",
  generatedAt: "2026-06-10T15:00:00.000Z",
  summary: "Summary <unsafe>",
  steps: [
    { id: "step-1", label: "Run <tests>", status: "pass", command: "npm run test", notes: "Done" }
  ],
  metrics: [{ id: "metric-1", label: "Count", value: 4, interpretation: "Stable" }],
  artifacts: [{ id: "artifact-1", label: "HTML", path: "lab-output/demo-report/demo-report.html", kind: "html" }],
  warnings: ["Warning <b>unsafe</b>"]
});

describe("renderHtmlReport", () => {
  it("renders title, project name, benchmark project, and workflow name", () => {
    const html = renderHtmlReport(baseReport);
    expect(html).toContain("Demo &lt;Report&gt;");
    expect(html).toContain("my-dev-kit-lab");
    expect(html).toContain("todo-ts");
    expect(html).toContain("benchmark validation demo");
  });

  it("renders steps, metrics, artifacts, warnings, and generated timestamp", () => {
    const html = renderHtmlReport(baseReport);
    expect(html).toContain("Workflow steps");
    expect(html).toContain("Metrics");
    expect(html).toContain("Artifacts");
    expect(html).toContain("Warnings");
    expect(html).toContain("2026-06-10T15:00:00.000Z");
    expect(html).toContain("npm run test");
  });

  it("escapes unsafe html content", () => {
    const html = renderHtmlReport(baseReport);
    expect(html).toContain("Summary &lt;unsafe&gt;");
    expect(html).toContain("Warning &lt;b&gt;unsafe&lt;/b&gt;");
    expect(html).not.toContain("<b>unsafe</b>");
  });

  it("handles empty warnings", () => {
    const html = renderHtmlReport({ ...baseReport, warnings: [] });
    expect(html).toContain("No warnings.");
  });

  it("is deterministic for the same normalized input", () => {
    expect(renderHtmlReport(baseReport)).toBe(renderHtmlReport(baseReport));
  });
});
