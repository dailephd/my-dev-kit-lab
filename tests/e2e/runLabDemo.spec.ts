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
    const browser = await playwright.chromium.launch({ headless: true });
    return browser;
  } catch {
    return null;
  }
}

describe("lab demo e2e", () => {
  it(
    "runs the CLI and verifies gallery artifacts",
    async () => {
      const outDir = mkdtempSync(path.join(os.tmpdir(), "lab-demo-e2e-"));
      tempDirs.push(outDir);
      const result = spawnSync(
        process.execPath,
        [
          "node_modules/tsx/dist/cli.mjs",
          "scripts/run-lab-demo.ts",
          "--cases",
          "examples/lab-demo-cases.json",
          "--kit-command",
          `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`,
          "--out",
          outDir,
          "--no-screenshot"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(0);
      expect(existsSync(path.join(outDir, "gallery-manifest.json"))).toBe(true);
      expect(existsSync(path.join(outDir, "token-savings-summary.json"))).toBe(true);
      expect(existsSync(path.join(outDir, "token-savings-runs.json"))).toBe(true);
      expect(existsSync(path.join(outDir, "token-savings-report.html"))).toBe(true);

      const manifest = JSON.parse(await readFile(path.join(outDir, "gallery-manifest.json"), "utf8")) as {
        warnings: string[];
        items: Array<{ screenshotPath?: string }>;
      };
      expect(manifest.warnings.some((warning) => warning.includes("--no-screenshot"))).toBe(true);

      const browser = await launchBrowserIfAvailable();
      if (browser) {
        try {
          const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
          await page.goto(`file:///${path.join(outDir, "token-savings-report.html").replace(/\\/g, "/")}`);
          const bodyText = await page.locator("body").textContent();
          expect(bodyText).toContain("Token savings evaluation");
          expect(bodyText).toContain("raw full-file context vs my-dev-kit retrieval");
          expect(bodyText).toContain("estimated_chars_div_4");
          expect(bodyText).toContain("Metrics");
          expect(bodyText).toContain("Artifacts");
          expect(bodyText).toContain("Warnings");
        } finally {
          await browser.close();
        }
      }
    },
    60000
  );
});
