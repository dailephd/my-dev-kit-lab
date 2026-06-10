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

async function browserRuntimeAvailable(): Promise<boolean> {
  try {
    const playwright = await import("playwright");
    const browser = await playwright.chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

describe("demo report screenshot e2e", () => {
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

    if (await browserRuntimeAvailable()) {
      const playwright = await import("playwright");
      const browser = await playwright.chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
      await page.goto(`file:///${path.join(outDir, "demo-report.html").replace(/\\/g, "/")}`);
      const bodyText = await page.locator("body").textContent();
      expect(bodyText).toContain("my-dev-kit-lab");
      expect(bodyText).toContain("benchmark validation demo");
      expect(bodyText).toContain("todo-ts");
      expect(bodyText).toContain("Workflow steps");
      expect(bodyText).toContain("Metrics");
      expect(bodyText).toContain("Artifacts");
      await browser.close();
    }
  }, 15000);
});
