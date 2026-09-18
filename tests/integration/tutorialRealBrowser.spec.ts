import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { launchChromium } from "../../src/browser/index.js";
import { createLabExecutionContext } from "../../src/runtime/labExecutionContext.js";
import { runTutorial } from "../../src/tutorial/runTutorial.js";
import {
  TUTORIAL_CURSOR_ID,
  TUTORIAL_VISUAL_ROOT_ID
} from "../../src/tutorial/tutorialCursor.js";
import { TUTORIAL_CALLOUT_ID, TUTORIAL_HIGHLIGHT_ID } from "../../src/tutorial/tutorialOverlay.js";
import type { TutorialManifestV1 } from "../../src/tutorial/tutorialManifest.js";
import {
  materializeTutorialFixtureContract,
  reserveLoopbackPort
} from "../fixtures/tutorial-browser/tutorialBrowserFixture.js";

/**
 * Genuine Chromium integration.
 *
 * This suite uses the real installed Playwright package and a real Chromium
 * runtime -- no structural fake browser. It is the only proof that the video,
 * cursor, overlay and screenshot layers actually work against a browser.
 *
 * It is kept out of the default unit suites (its own file, in tests/integration)
 * and skips with a visible reason when Chromium is not installed, so a clean
 * machine without browsers does not fail the ordinary test run. Prompt 4 owns
 * the final CI/browser provisioning policy.
 */

const tempDirs: string[] = [];
let chromiumAvailable = false;
let chromiumUnavailableReason = "";

beforeAll(async () => {
  const launch = await launchChromium({ headless: true });
  if (launch.status === "launched") {
    chromiumAvailable = true;
    await launch.browser.close();
    return;
  }
  chromiumUnavailableReason =
    launch.status === "unavailable" ? `${launch.reason}: ${launch.error}` : launch.error;
  // Surfaced rather than hidden: a skipped real-browser suite must be visible.
  console.warn(`[tutorialRealBrowser] Chromium unavailable, skipping: ${chromiumUnavailableReason}`);
}, 120_000);

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("tutorial run against real Chromium", () => {
  it(
    "records video, renders visuals, captures screenshots and writes every canonical artifact",
    async () => {
      if (!chromiumAvailable) {
        expect(chromiumUnavailableReason).toBeTruthy();
        return;
      }

      const port = await reserveLoopbackPort();
      const fixture = materializeTutorialFixtureContract({
        contractRoot: makeTempDir("tutorial-real-contract-"),
        port
      });
      const invocationCwd = makeTempDir("tutorial-real-cwd-");
      const workspaceRoot = makeTempDir("tutorial-real-ws-");
      const outDir = path.join(makeTempDir("tutorial-real-out-"), "run");

      // Observed live from the real page while the tutorial is running.
      const liveVisualState: Array<Record<string, unknown>> = [];

      const result = await runTutorial({
        scenarioPath: fixture.scenarioPath,
        targetContractPath: fixture.targetContractPath,
        context: createLabExecutionContext({ invocationCwd, workspaceRoot }),
        outDir,
        generateRunId: () => "real-browser-run",
        sleep: async (ms) => {
          await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 60)));
        },
        launchBrowser: async (launchOptions) => {
          const launch = await launchChromium(launchOptions);
          if (launch.status !== "launched") {
            return launch;
          }
          // Wrap newContext/newPage so the test can inspect the live DOM the
          // tutorial runtime is producing, without altering runtime behavior.
          const browser = launch.browser;
          const originalNewContext = browser.newContext!.bind(browser);
          browser.newContext = async (contextOptions) => {
            const context = await originalNewContext(contextOptions);
            const originalNewPage = context.newPage.bind(context);
            context.newPage = async () => {
              const page = await originalNewPage();
              const originalScreenshot = page.screenshot.bind(page);
              page.screenshot = async (screenshotOptions) => {
                liveVisualState.push(
                  (await page.evaluate(
                    (ids: { root: string; cursor: string; highlight: string; callout: string }) => {
                      const read = (id: string) => {
                        const node = document.getElementById(id);
                        if (!node) return null;
                        const style = window.getComputedStyle(node);
                        return {
                          present: true,
                          pointerEvents: style.pointerEvents,
                          text: node.textContent ?? ""
                        };
                      };
                      return {
                        root: read(ids.root),
                        cursor: read(ids.cursor),
                        highlight: read(ids.highlight),
                        callout: read(ids.callout)
                      };
                    },
                    {
                      root: TUTORIAL_VISUAL_ROOT_ID,
                      cursor: TUTORIAL_CURSOR_ID,
                      highlight: TUTORIAL_HIGHLIGHT_ID,
                      callout: TUTORIAL_CALLOUT_ID
                    }
                  )) as Record<string, unknown>
                );
                return originalScreenshot(screenshotOptions);
              };
              return page;
            };
            return context;
          };
          return { status: "launched", browser };
        }
      });

      // ---- Run outcome ----------------------------------------------------
      expect(result.error ?? "").toBe("");
      expect(result.status).toBe("passed");
      expect(result.steps.map((step) => step.status)).toEqual([
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "passed"
      ]);

      // At least one real action and one real assertion actually ran.
      const clickStep = result.steps.find((step) => step.id === "activate");
      expect(clickStep?.action).toMatchObject({ type: "click", status: "passed" });
      expect(clickStep?.assertions.every((assertion) => assertion.status === "passed")).toBe(true);
      expect(result.steps.flatMap((step) => step.assertions).length).toBeGreaterThan(5);

      // ---- Live visual state during execution ------------------------------
      expect(liveVisualState.length).toBeGreaterThan(0);
      const firstCapture = liveVisualState[0] as {
        root: { present: boolean; pointerEvents: string } | null;
        cursor: { present: boolean; pointerEvents: string } | null;
        highlight: { present: boolean; pointerEvents: string } | null;
        callout: { present: boolean; pointerEvents: string; text: string } | null;
      };
      expect(firstCapture.root?.present).toBe(true);
      expect(firstCapture.cursor?.present).toBe(true);
      expect(firstCapture.cursor?.pointerEvents).toBe("none");
      expect(firstCapture.highlight?.present).toBe(true);
      expect(firstCapture.highlight?.pointerEvents).toBe("none");
      expect(firstCapture.callout?.present).toBe(true);
      expect(firstCapture.callout?.pointerEvents).toBe("none");
      expect(firstCapture.callout?.text).toBe("This is the fixture application.");

      // ---- Canonical artifacts --------------------------------------------
      const paths = result.paths!;
      const videoPath = path.join(paths.artifactsRoot, "tutorial.webm");
      const videoStats = statSync(videoPath);
      expect(videoStats.isFile()).toBe(true);
      expect(videoStats.size).toBeGreaterThan(0);
      expect(result.artifacts.video).toMatchObject({ status: "written", path: "artifacts/tutorial.webm" });

      for (const [name, record] of [
        ["tutorial.srt", result.artifacts.srt],
        ["tutorial.vtt", result.artifacts.vtt],
        ["tutorial.md", result.artifacts.markdown],
        ["tutorial-manifest.json", result.artifacts.manifest]
      ] as const) {
        const filePath = path.join(paths.artifactsRoot, name);
        expect(statSync(filePath).size).toBeGreaterThan(0);
        expect(record?.status).toBe("written");
      }

      // ---- Screenshots from the live page ----------------------------------
      const screenshotFiles = readdirSync(paths.screenshotsRoot).sort();
      expect(screenshotFiles).toEqual([
        "activated.png",
        "app-open.png",
        "banner-visible.png",
        "dropped.png",
        "submitted.png"
      ]);
      for (const file of screenshotFiles) {
        const png = readFileSync(path.join(paths.screenshotsRoot, file));
        expect(png.length).toBeGreaterThan(0);
        // Real PNG signature plus non-zero IHDR dimensions.
        expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        expect(png.readUInt32BE(16)).toBeGreaterThan(0);
        expect(png.readUInt32BE(20)).toBeGreaterThan(0);
      }
      // Default (non-fullPage) captures match the scenario viewport width.
      const viewportShot = readFileSync(path.join(paths.screenshotsRoot, "app-open.png"));
      expect(viewportShot.readUInt32BE(16)).toBe(1024);

      // ---- Subtitles and manifest content ----------------------------------
      const srt = readFileSync(path.join(paths.artifactsRoot, "tutorial.srt"), "utf8");
      expect(srt.startsWith("1\n")).toBe(true);
      expect(srt).toContain("Open the fixture application in the browser.");
      const vtt = readFileSync(path.join(paths.artifactsRoot, "tutorial.vtt"), "utf8");
      expect(vtt.startsWith("WEBVTT\n")).toBe(true);

      const markdown = readFileSync(path.join(paths.artifactsRoot, "tutorial.md"), "utf8");
      expect(markdown).toContain("# Lab browser fixture tutorial");
      // Alt text is the step id; the link target is the screenshot id.
      expect(markdown).toContain("![open-app](../screenshots/app-open.png)");
      expect(markdown).toContain("## Step 1: open-app");

      const manifest = JSON.parse(
        readFileSync(path.join(paths.artifactsRoot, "tutorial-manifest.json"), "utf8")
      ) as TutorialManifestV1;
      expect(manifest.schemaVersion).toBe("1.0.0");
      expect(manifest.run.status).toBe("passed");
      expect(manifest.steps).toHaveLength(7);
      expect(manifest.steps[0].timelineStartMs).toBeGreaterThanOrEqual(0);
      for (const record of manifest.artifacts) {
        if (record.path !== undefined) {
          expect(record.path).not.toMatch(/^([A-Za-z]:|\/)/);
          expect(record.path).not.toContain("\\");
        }
      }

      // ---- Cleanup ---------------------------------------------------------
      expect(result.cleanupErrors).toEqual([]);
      await expect(
        fetch(fixture.applicationUrl, { signal: AbortSignal.timeout(1000) })
      ).rejects.toThrow();
      // Raw temporary recordings were removed once the canonical video existed.
      const tempVideoDir = path.join(paths.temporaryRoot, "video");
      const leftovers = readdirSync(tempVideoDir).filter((entry) => entry.endsWith(".webm"));
      expect(leftovers).toEqual([]);
    },
    240_000
  );
});
