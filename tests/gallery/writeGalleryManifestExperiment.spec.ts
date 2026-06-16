import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeExperimentGalleryManifest } from "../../src/gallery/index.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writeExperimentGalleryManifest", () => {
  it("includes report, plot, visualization, screenshot, and final demo items", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "gallery-exp-"));
    tempDirs.push(root);
    const reportDir = path.join(root, "report");
    const plotsDir = path.join(root, "plots");
    const visualizationsDir = path.join(root, "viz");
    await mkdir(path.join(plotsDir, "charts"), { recursive: true });
    await mkdir(path.join(visualizationsDir, "artifacts"), { recursive: true });
    await mkdir(reportDir, { recursive: true });
    await writeFile(path.join(reportDir, "experiment-report.html"), "<html></html>");
    await writeFile(path.join(reportDir, "experiment-report.json"), "{}");
    await writeFile(path.join(reportDir, "experiment-report.png"), "png");
    await writeFile(path.join(plotsDir, "plots-summary.json"), "{}");
    await writeFile(path.join(plotsDir, "plot-data.json"), "{}");
    await writeFile(path.join(plotsDir, "charts", "chart.svg"), "<svg />");
    await writeFile(path.join(visualizationsDir, "visualization-demo-summary.json"), "{}");
    await writeFile(path.join(visualizationsDir, "visualization-demo-runs.json"), "{}");
    await writeFile(path.join(visualizationsDir, "artifacts", "call-graph.svg"), "<svg />");
    const result = await writeExperimentGalleryManifest({ outDir: path.join(root, "gallery"), reportDir, plotsDir, visualizationsDir });
    expect(existsSync(result.manifestPath)).toBe(true);
    expect(existsSync(result.indexPath)).toBe(true);
    expect(result.manifest.items.map((item) => item.kind)).toContain("experiment-report");
    expect(result.manifest.items.map((item) => item.kind)).toContain("experiment-plots");
    expect(result.manifest.items.map((item) => item.kind)).toContain("visualization-demo");
    expect(result.manifest.items.find((item) => item.id === "experiment-report")?.screenshotPath).toBeTruthy();
  });
});
