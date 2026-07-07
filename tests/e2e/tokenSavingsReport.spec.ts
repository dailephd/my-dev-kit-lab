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

describe("token savings report e2e", () => {
  it(
    "runs the CLI and verifies generated evaluation artifacts",
    async () => {
      const outDir = mkdtempSync(path.join(os.tmpdir(), "token-e2e-"));
      tempDirs.push(outDir);
      const result = spawnSync(
        process.execPath,
        [
          "node_modules/tsx/dist/cli.mjs",
          "scripts/evaluate-token-savings.ts",
          "--cases",
          "examples/token-savings-cases.json",
          "--kit-command",
          `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`,
          "--out",
          outDir
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(0);
      expect(existsSync(path.join(outDir, "token-savings-summary.json"))).toBe(true);
      expect(existsSync(path.join(outDir, "token-savings-runs.json"))).toBe(true);
      expect(existsSync(path.join(outDir, "token-savings-report.html"))).toBe(true);

      const payload = JSON.parse(await readFile(path.join(outDir, "token-savings-summary.json"), "utf8")) as {
        warnings: string[];
        screenshot: { status: string };
      };
      if (payload.screenshot.status === "captured") {
        expect(existsSync(path.join(outDir, "token-savings-report.png"))).toBe(true);
      } else {
        expect(payload.warnings.some((warning) => warning.includes("PNG screenshot skipped") || warning.includes("failed"))).toBe(true);
      }

      if (await browserRuntimeAvailable()) {
        const playwright = await import("playwright");
        const browser = await playwright.chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
        await page.goto(`file:///${path.join(outDir, "token-savings-report.html").replace(/\\/g, "/")}`);
        const bodyText = await page.locator("body").textContent();
        expect(bodyText).toContain("Token savings evaluation");
        expect(bodyText).toContain("raw full-file context vs my-dev-kit retrieval");
        expect(bodyText).toContain("estimated_chars_div_4");
        expect(bodyText).toContain("Metrics");
        expect(bodyText).toContain("Artifacts");
        expect(bodyText).toContain("Warnings");
        await browser.close();
      }
    },
    60000
  );
});
