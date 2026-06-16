import { mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureReportScreenshot, SCREENSHOT_SKIP_WARNING } from "../../src/screenshot/captureReportScreenshot.js";
import type { PlaywrightLikeModule } from "../../src/screenshot/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createHtmlFixture(): Promise<{ dir: string; htmlPath: string; pngPath: string }> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lab-shot-"));
  tempDirs.push(dir);
  const htmlPath = path.join(dir, "report.html");
  const pngPath = path.join(dir, "report.png");
  await writeFile(htmlPath, "<html><body><h1>demo</h1></body></html>", "utf8");
  return { dir, htmlPath, pngPath };
}

describe("captureReportScreenshot", () => {
  it("returns skipped when Playwright is unavailable", async () => {
    const fixture = await createHtmlFixture();
    const result = await captureReportScreenshot(fixture.htmlPath, fixture.pngPath, {
      loadPlaywright: async () => {
        throw new Error("Cannot find module 'playwright'");
      }
    });
    expect(result.status).toBe("skipped");
    expect(result.warning).toBe(SCREENSHOT_SKIP_WARNING);
  });

  it("returns captured when a mocked Playwright runtime succeeds", async () => {
    const fixture = await createHtmlFixture();
    const fakePlaywright: PlaywrightLikeModule = {
      chromium: {
        async launch() {
          return {
            async newPage() {
              return {
                async goto() {},
                async screenshot(options) {
                  await writeFile(options.path, "png-data", "utf8");
                }
              };
            },
            async close() {}
          };
        }
      }
    };
    const result = await captureReportScreenshot(fixture.htmlPath, fixture.pngPath, {
      loadPlaywright: async () => fakePlaywright
    });
    expect(result.status).toBe("captured");
    expect(await readFile(fixture.pngPath, "utf8")).toBe("png-data");
  });

  it("returns failed for an invalid HTML path", async () => {
    const result = await captureReportScreenshot("missing.html", "missing.png", {
      loadPlaywright: async () => {
        throw new Error("Cannot find module 'playwright'");
      }
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("HTML report not found");
  });

  it("does not throw unhandled errors for expected missing browser runtime cases", async () => {
    const fixture = await createHtmlFixture();
    const result = await captureReportScreenshot(fixture.htmlPath, fixture.pngPath, {
      loadPlaywright: async () => ({
        chromium: {
          async launch() {
            throw new Error("Executable doesn't exist. Please run npx playwright install");
          }
        }
      })
    });
    expect(result.status).toBe("skipped");
    expect(result.warning).toBe(SCREENSHOT_SKIP_WARNING);
  });
});
