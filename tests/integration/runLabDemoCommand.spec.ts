import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLabDemoCommand } from "../../src/commands/runLabDemo.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runLabDemoCommand integration", () => {
  it("runs the full lab demo workflow and preserves telemetry references", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "lab-demo-integration-"));
    tempDirs.push(outDir);
    const code = await runLabDemoCommand([
      "--cases",
      "examples/lab-demo-cases.json",
      "--kit-command",
      `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`,
      "--out",
      outDir,
      "--no-screenshot"
    ]);

    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "gallery-manifest.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "token-savings-summary.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "token-savings-runs.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "token-savings-report.html"))).toBe(true);

    const manifest = JSON.parse(await readFile(path.join(outDir, "gallery-manifest.json"), "utf8")) as {
      items: Array<{ htmlPath: string; summaryPath?: string; runsPath?: string }>;
      warnings: string[];
    };
    expect(existsSync(path.join(outDir, manifest.items[0]!.htmlPath))).toBe(true);
    expect(existsSync(path.join(outDir, manifest.items[0]!.summaryPath!))).toBe(true);
    expect(existsSync(path.join(outDir, manifest.items[0]!.runsPath!))).toBe(true);

    const runs = JSON.parse(await readFile(path.join(outDir, "token-savings-runs.json"), "utf8")) as {
      runs: Array<{ myDevKit: { commandTelemetry: Array<{ stdoutPath: string; stderrPath: string; telemetryPath: string }> } }>;
    };
    const telemetry = runs.runs[0]?.myDevKit.commandTelemetry ?? [];
    expect(telemetry.length).toBeGreaterThan(0);
    for (const entry of telemetry) {
      expect(existsSync(entry.stdoutPath)).toBe(true);
      expect(existsSync(entry.stderrPath)).toBe(true);
      expect(existsSync(entry.telemetryPath)).toBe(true);
    }
    expect(manifest.warnings.some((warning) => warning.includes("--no-screenshot"))).toBe(true);
  }, 20000);
});
