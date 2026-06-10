import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PlaywrightLikeModule, ScreenshotCaptureResult } from "./types.js";

const SKIP_WARNING = "PNG screenshot skipped because Playwright or browser runtime is unavailable.";

function isMissingBrowserRuntime(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("browserType.launch") ||
    message.includes("playwright install") ||
    message.includes("Failed to launch") ||
    message.includes("Could not find Chrome") ||
    message.includes("ENOENT")
  );
}

async function defaultLoadPlaywright(): Promise<PlaywrightLikeModule> {
  return (await import("playwright")) as unknown as PlaywrightLikeModule;
}

export async function captureReportScreenshot(
  htmlPath: string,
  pngPath: string,
  options?: { loadPlaywright?: () => Promise<PlaywrightLikeModule> }
): Promise<ScreenshotCaptureResult> {
  const loadPlaywright = options?.loadPlaywright ?? defaultLoadPlaywright;

  try {
    await access(htmlPath);
  } catch (error) {
    return {
      status: "failed",
      htmlPath,
      pngPath,
      error: `HTML report not found: ${htmlPath}`
    };
  }

  let playwright: PlaywrightLikeModule;
  try {
    playwright = await loadPlaywright();
  } catch {
    return {
      status: "skipped",
      htmlPath,
      pngPath,
      warning: SKIP_WARNING
    };
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: "load" });
    await page.screenshot({ path: pngPath, fullPage: true });
    await browser.close();
    return {
      status: "captured",
      htmlPath,
      pngPath
    };
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => undefined);
    }

    if (isMissingBrowserRuntime(error)) {
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
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export { SKIP_WARNING as SCREENSHOT_SKIP_WARNING };
