import { mkdtempSync } from "node:fs";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCaptureDemoReportCommand } from "../../src/commands/captureDemoReport.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runCaptureDemoReportCommand", () => {
  it("runs with the example input and writes HTML and JSON", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "capture-demo-"));
    tempDirs.push(outDir);
    const code = await runCaptureDemoReportCommand([
      "--input",
      "examples/demo-report-input.json",
      "--out",
      outDir,
      "--no-screenshot"
    ]);
    expect(code).toBe(0);
    await expect(access(path.join(outDir, "demo-report.html"))).resolves.toBeUndefined();
    await expect(access(path.join(outDir, "demo-report.json"))).resolves.toBeUndefined();
  });

  it("writes PNG or records screenshot skipped warning", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "capture-demo-"));
    tempDirs.push(outDir);
    const code = await runCaptureDemoReportCommand(["--input", "examples/demo-report-input.json", "--out", outDir]);
    expect([0, 1]).toContain(code);
    const json = JSON.parse(await readFile(path.join(outDir, "demo-report.json"), "utf8")) as {
      screenshot: { status: string };
      warnings: string[];
    };
    expect(["captured", "skipped", "failed"]).toContain(json.screenshot.status);
    if (json.screenshot.status !== "captured") {
      expect(json.warnings.some((warning) => warning.includes("PNG screenshot skipped") || warning.includes("--no-screenshot") || warning.includes("failed"))).toBe(true);
    }
  }, 15000);

  it("supports --no-screenshot", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "capture-demo-"));
    tempDirs.push(outDir);
    const code = await runCaptureDemoReportCommand(["--input", "examples/demo-report-input.json", "--out", outDir, "--no-screenshot"]);
    const json = JSON.parse(await readFile(path.join(outDir, "demo-report.json"), "utf8")) as { screenshot: { status: string } };
    expect(code).toBe(0);
    expect(json.screenshot.status).toBe("skipped");
  });

  it("fails clearly for a missing input file", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "capture-demo-"));
    tempDirs.push(outDir);
    await expect(runCaptureDemoReportCommand(["--input", "missing.json", "--out", outDir])).resolves.toBe(1);
  });

  it("fails clearly for invalid JSON", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "capture-demo-"));
    tempDirs.push(outDir);
    const inputPath = path.join(outDir, "invalid.json");
    await writeFile(inputPath, "{ invalid", "utf8");
    await expect(runCaptureDemoReportCommand(["--input", inputPath, "--out", outDir])).resolves.toBe(1);
  });

  it("fails clearly for missing required fields", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "capture-demo-"));
    tempDirs.push(outDir);
    const inputPath = path.join(outDir, "missing-fields.json");
    await writeFile(inputPath, JSON.stringify({ reportId: "x" }), "utf8");
    await expect(runCaptureDemoReportCommand(["--input", inputPath, "--out", outDir])).resolves.toBe(1);
  });
});
