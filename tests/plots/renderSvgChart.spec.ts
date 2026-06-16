import { describe, expect, it } from "vitest";
import { renderSvgChart } from "../../src/plots/index.js";
import type { PlotSeries } from "../../src/plots/types.js";

describe("renderSvgChart", () => {
  it("renders deterministic escaped SVG with labels", () => {
    const plot: PlotSeries = {
      id: "p",
      title: "A <chart>",
      xLabel: "X",
      yLabel: "Y",
      kind: "scatter",
      points: [{ x: 1, y: 2, group: "fake-agent", label: "case <one>" }],
      warnings: []
    };
    const first = renderSvgChart(plot);
    const second = renderSvgChart(plot);
    expect(first).toBe(second);
    expect(first).toContain("<svg");
    expect(first).toContain("A &lt;chart&gt;");
    expect(first).toContain("case &lt;one&gt;");
    expect(first).not.toContain("<script");
    expect(first).not.toContain("<link");
  });

  it("renders a no-data message", () => {
    expect(renderSvgChart({ id: "empty", title: "Empty", xLabel: "X", yLabel: "Y", kind: "scatter", points: [], warnings: [] })).toContain(
      "No comparable data available"
    );
  });
});
