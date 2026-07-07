import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function launchBrowserIfAvailable() {
  try {
    const playwright = await import("playwright");
    return await playwright.chromium.launch({ headless: true });
  } catch {
    return null;
  }
}

describe("demo report screenshot e2e", () => {
  // Runs three sequential Chromium launches in the worst case (one inside
  // the spawned `capture-demo-report` subprocess, one here for content
  // verification), each with unpredictable cold-start latency on Windows
  // (antivirus scanning of a freshly-launched browser binary is a known,
  // legitimate source of multi-second variance). 30s was too tight for that
  // combined worst case; 60s gives real headroom without masking a genuine
  // hang (a true hang still fails, just later).
  it("runs the CLI and verifies generated artifacts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "demo-report-e2e-"));
    tempDirs.push(outDir);
    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/capture-demo-report.ts", "--input", "examples/demo-report-input.json", "--out", outDir], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect([0, 1]).toContain(result.status ?? 1);
    expect(existsSync(path.join(outDir, "demo-report.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "demo-report.json"))).toBe(true);

    const payload = JSON.parse(await readFile(path.join(outDir, "demo-report.json"), "utf8")) as {
      warnings: string[];
      screenshot: { status: string };
    };

    if (payload.screenshot.status === "captured") {
      expect(existsSync(path.join(outDir, "demo-report.png"))).toBe(true);
    } else {
      expect(payload.warnings.some((warning) => warning.includes("PNG screenshot skipped") || warning.includes("failed"))).toBe(true);
    }

    // A single launch-or-null probe replaces the previous separate
    // "is a browser available" launch+close followed by a second launch for
    // the real verification — that redundant extra Chromium cold start was
    // pure wasted work on every run and widened the window for a transient
    // Windows-side startup delay to blow the test's timeout.
    const browser = await launchBrowserIfAvailable();
    if (browser) {
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
        await page.goto(`file:///${path.join(outDir, "demo-report.html").replace(/\\/g, "/")}`);
        const bodyText = await page.locator("body").textContent();
        expect(bodyText).toContain("my-dev-kit-lab");
        expect(bodyText).toContain("benchmark validation demo");
        expect(bodyText).toContain("todo-ts");
        expect(bodyText).toContain("Workflow steps");
        expect(bodyText).toContain("Metrics");
        expect(bodyText).toContain("Artifacts");
      } finally {
        // Guaranteed close even when a content assertion above throws, so a
        // failing assertion can never leak a Chromium process.
        await browser.close();
      }
    }
  }, 60000);
});
