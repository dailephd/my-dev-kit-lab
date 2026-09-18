import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  closeBrowserQuietly,
  errorMessage,
  isMissingBrowserRuntimeError,
  launchChromium,
  type PlaywrightLikeBrowser,
  type PlaywrightLikeModule
} from "../browser/index.js";
import type { ScreenshotCaptureResult } from "./types.js";

const SKIP_WARNING = "PNG screenshot skipped because Playwright or browser runtime is unavailable.";

const REPORT_VIEWPORT = { width: 1440, height: 1080 } as const;

/**
 * Captures a one-shot PNG of a local HTML report.
 *
 * Playwright loading, Chromium launch, and browser-availability classification
 * are owned by `src/browser`; this module owns only the report-specific policy
 * of mapping a generic runtime outcome onto captured/skipped/failed. A missing
 * Playwright package and a missing Chromium binary are both non-fatal for a
 * report (the HTML report is still produced), so both become "skipped".
 */
export async function captureReportScreenshot(
  htmlPath: string,
  pngPath: string,
  options?: { loadPlaywright?: () => Promise<PlaywrightLikeModule> }
): Promise<ScreenshotCaptureResult> {
  try {
    await access(htmlPath);
  } catch {
    return {
      status: "failed",
      htmlPath,
      pngPath,
      error: `HTML report not found: ${htmlPath}`
    };
  }

  const launch = await launchChromium({ headless: true, loadPlaywright: options?.loadPlaywright });
  if (launch.status === "unavailable") {
    return {
      status: "skipped",
      htmlPath,
      pngPath,
      warning: SKIP_WARNING
    };
  }
  if (launch.status === "failed") {
    return {
      status: "failed",
      htmlPath,
      pngPath,
      error: launch.error
    };
  }

  const browser: PlaywrightLikeBrowser = launch.browser;
  try {
    const page = await browser.newPage({ viewport: { ...REPORT_VIEWPORT } });
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: "load" });
    await page.screenshot({ path: pngPath, fullPage: true });
    await browser.close();
    return {
      status: "captured",
      htmlPath,
      pngPath
    };
  } catch (error) {
    await closeBrowserQuietly(browser);

    // A post-launch failure can still be a missing-browser-runtime symptom (for
    // example a browser process that dies on first page use), so the same closed
    // classifier applies here as at launch time.
    if (isMissingBrowserRuntimeError(error)) {
      return {
        status: "skipped",
        htmlPath,
        pngPath,
        warning: SKIP_WARNING
      };
    }

    return {
      status: "failed",
      htmlPath,
      pngPath,
      error: errorMessage(error)
    };
  }
}

export { SKIP_WARNING as SCREENSHOT_SKIP_WARNING };
