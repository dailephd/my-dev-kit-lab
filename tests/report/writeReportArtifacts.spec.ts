import { mkdtempSync } from "node:fs";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeReportArtifacts } from "../../src/report/writeReportArtifacts.js";
import type { LabReportInput } from "../../src/report/types.js";

const tempDirs: string[] = [];

const report: LabReportInput = {
  reportId: "demo-report",
  title: "Demo Report",
  projectName: "my-dev-kit-lab",
  benchmarkProject: "todo-ts",
  workflowName: "benchmark validation demo",
  generatedAt: "2026-06-10T15:00:00.000Z",
  summary: "Deterministic test report",
  steps: [{ id: "step-1", label: "Run tests", status: "pass" }],
  metrics: [{ id: "metric-1", label: "Count", value: 1 }],
  artifacts: [{ id: "artifact-1", label: "HTML", path: "out/demo-report.html", kind: "html" }],
  warnings: ["Token comparison is not implemented."]
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writeReportArtifacts", () => {
  it("creates the output directory and writes JSON and HTML", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "lab-report-"));
    tempDirs.push(outDir);

    const result = await writeReportArtifacts({
      report,
      outDir,
      screenshot: { status: "skipped", htmlPath: path.join(outDir, "demo-report.html"), pngPath: path.join(outDir, "demo-report.png") }
    });

    await expect(access(result.outputPaths.htmlPath)).resolves.toBeUndefined();
    await expect(access(result.outputPaths.jsonPath)).resolves.toBeUndefined();
  });

  it("records artifact paths and preserves warnings", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "lab-report-"));
    tempDirs.push(outDir);

    const result = await writeReportArtifacts({
      report,
      outDir,
      screenshot: {
        status: "skipped",
        htmlPath: path.join(outDir, "demo-report.html"),
        pngPath: path.join(outDir, "demo-report.png"),
        warning: "PNG screenshot skipped because Playwright or browser runtime is unavailable."
      }
    });

    const json = JSON.parse(await readFile(result.outputPaths.jsonPath, "utf8")) as { warnings: string[]; outputPaths: { htmlPath: string } };
    expect(json.outputPaths.htmlPath).toBe(result.outputPaths.htmlPath);
    expect(json.warnings).toContain("Token comparison is not implemented.");
    expect(json.warnings).toContain("PNG screenshot skipped because Playwright or browser runtime is unavailable.");
  });

  it("handles screenshot skipped result", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "lab-report-"));
    tempDirs.push(outDir);
    const result = await writeReportArtifacts({
      report,
      outDir,
      screenshot: { status: "skipped", htmlPath: path.join(outDir, "demo-report.html"), pngPath: path.join(outDir, "demo-report.png"), warning: "skip" }
    });
    expect(result.screenshot.status).toBe("skipped");
  });

  it("fails clearly on an invalid output path", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "lab-report-"));
    tempDirs.push(tempRoot);
    const blockingFile = path.join(tempRoot, "blocked");
    await writeFile(blockingFile, "x", "utf8");

    await expect(
      writeReportArtifacts({
        report,
        outDir: path.join(blockingFile, "nested"),
        screenshot: { status: "skipped", htmlPath: "x", pngPath: "y" }
      })
    ).rejects.toThrow();
  });
});
