import type { PlotSeries } from "./types.js";

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2"];

export function renderSvgChart(plot: PlotSeries): string {
  const width = 760;
  const height = 420;
  const margin = { left: 72, right: 28, top: 58, bottom: 72 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const groups = [...new Set(plot.points.map((point) => point.group))].sort();
  const colorFor = (group: string) => COLORS[Math.max(0, groups.indexOf(group)) % COLORS.length];

  if (plot.points.length === 0) {
    return wrapSvg(width, height, `${title(plot.title)}${text(width / 2, height / 2, "No comparable data available", "middle", "empty")}`);
  }

  const xs = plot.points.map((point) => point.x);
  const ys = plot.points.map((point) => point.y);
  const xDomain = domain(xs);
  const yDomain = domain(ys);
  const xScale = (value: number) => margin.left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * innerWidth;
  const yScale = (value: number) => margin.top + innerHeight - ((value - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerHeight;

  const body =
    plot.kind === "bar"
      ? renderBars(plot, margin, innerWidth, innerHeight, colorFor)
      : plot.points
          .map(
            (point) =>
              `<circle cx="${round(xScale(point.x))}" cy="${round(yScale(point.y))}" r="5" fill="${colorFor(point.group)}"><title>${escapeXml(point.label)} (${point.x}, ${point.y})</title></circle>`
          )
          .join("");

  return wrapSvg(
    width,
    height,
    [
      title(plot.title),
      `<line x1="${margin.left}" y1="${margin.top + innerHeight}" x2="${margin.left + innerWidth}" y2="${margin.top + innerHeight}" stroke="#344054" />`,
      `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + innerHeight}" stroke="#344054" />`,
      text(width / 2, height - 20, plot.xLabel, "middle", "axis-label"),
      `<text x="20" y="${height / 2}" class="axis-label" transform="rotate(-90 20 ${height / 2})" text-anchor="middle">${escapeXml(plot.yLabel)}</text>`,
      text(margin.left, margin.top + innerHeight + 20, String(round(xDomain[0])), "middle", "tick"),
      text(margin.left + innerWidth, margin.top + innerHeight + 20, String(round(xDomain[1])), "middle", "tick"),
      text(margin.left - 10, margin.top + innerHeight, String(round(yDomain[0])), "end", "tick"),
      text(margin.left - 10, margin.top + 4, String(round(yDomain[1])), "end", "tick"),
      body,
      renderLegend(groups, colorFor, width - 180, 70)
    ].join("")
  );
}

function renderBars(
  plot: PlotSeries,
  margin: { left: number; top: number; bottom: number; right: number },
  innerWidth: number,
  innerHeight: number,
  colorFor: (group: string) => string
): string {
  const maxY = Math.max(1, ...plot.points.map((point) => point.y));
  const barWidth = Math.max(12, innerWidth / Math.max(1, plot.points.length) - 6);
  return plot.points
    .map((point, index) => {
      const height = (point.y / maxY) * innerHeight;
      const x = margin.left + index * (barWidth + 6);
      const y = margin.top + innerHeight - height;
      return `<rect x="${round(x)}" y="${round(y)}" width="${round(barWidth)}" height="${round(height)}" fill="${colorFor(point.group)}"><title>${escapeXml(point.label)}: ${point.y}</title></rect>`;
    })
    .join("");
}

function renderLegend(groups: string[], colorFor: (group: string) => string, x: number, y: number): string {
  if (groups.length === 0) return "";
  return groups
    .map((group, index) => {
      const rowY = y + index * 20;
      return `<rect x="${x}" y="${rowY - 10}" width="10" height="10" fill="${colorFor(group)}" /><text x="${x + 16}" y="${rowY}" class="legend">${escapeXml(group)}</text>`;
    })
    .join("");
}

function wrapSvg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>text{font-family:Arial,Helvetica,sans-serif;fill:#17212b}.title{font-size:20px;font-weight:700}.axis-label{font-size:13px}.tick,.legend{font-size:12px}.empty{font-size:18px;fill:#667085}</style>${body}</svg>\n`;
}

function title(value: string): string {
  return text(28, 34, value, "start", "title");
}

function text(x: number, y: number, value: string, anchor: "start" | "middle" | "end", className: string): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${className}">${escapeXml(value)}</text>`;
}

function domain(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [min - 1, max + 1];
  const padding = (max - min) * 0.1;
  return [min - padding, max + padding];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
