import type { PlaywrightLikeBrowser, PlaywrightLikeModule } from "./types.js";

/**
 * Why a browser runtime could not be provided.
 *
 * "playwright-module-unavailable" -- the Playwright npm package itself could not
 * be imported (not installed, or not resolvable from the executing context).
 *
 * "browser-runtime-unavailable" -- Playwright loaded, but the Chromium browser
 * binary it needs is missing. This is a separate, separately-fixable condition
 * ("npx playwright install") and callers are expected to distinguish it.
 */
export type BrowserRuntimeUnavailableReason =
  | "playwright-module-unavailable"
  | "browser-runtime-unavailable";

export type BrowserLaunchResult =
  | { status: "launched"; browser: PlaywrightLikeBrowser }
  | { status: "unavailable"; reason: BrowserRuntimeUnavailableReason; error: string }
  | { status: "failed"; error: string };

export type LaunchChromiumOptions = {
  headless?: boolean;
  /** Injectable module loader; tests supply a structural fake instead of Playwright. */
  loadPlaywright?: () => Promise<PlaywrightLikeModule>;
};

export const DEFAULT_BROWSER_HEADLESS = true;

/**
 * Message fragments that identify a genuinely missing Chromium/browser binary.
 *
 * This is an intentionally closed list carried over unchanged from the v0.4.6
 * screenshot classifier so existing skip/fail behavior is preserved exactly. It
 * is not a general-purpose error classifier and must not be broadened into one.
 */
export const MISSING_BROWSER_RUNTIME_MESSAGE_FRAGMENTS = [
  "Executable doesn't exist",
  "browserType.launch",
  "playwright install",
  "Failed to launch",
  "Could not find Chrome",
  "ENOENT"
] as const;

export function isMissingBrowserRuntimeError(error: unknown): boolean {
  const message = errorMessage(error);
  return MISSING_BROWSER_RUNTIME_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
}

export async function loadPlaywrightModule(): Promise<PlaywrightLikeModule> {
  return (await import("playwright")) as unknown as PlaywrightLikeModule;
}

/**
 * Launches Chromium and classifies the three outcomes callers care about.
 *
 * Returns a structured result rather than throwing for the two expected
 * environment states (module missing, browser binary missing), because every
 * current and planned consumer has to make its own policy decision about them.
 * This function owns no consumer-specific status names or warning text.
 */
export async function launchChromium(options: LaunchChromiumOptions = {}): Promise<BrowserLaunchResult> {
  const loadPlaywright = options.loadPlaywright ?? loadPlaywrightModule;
  const headless = options.headless ?? DEFAULT_BROWSER_HEADLESS;

  let playwright: PlaywrightLikeModule;
  try {
    playwright = await loadPlaywright();
  } catch (error) {
    return {
      status: "unavailable",
      reason: "playwright-module-unavailable",
      error: errorMessage(error)
    };
  }

  try {
    const browser = await playwright.chromium.launch({ headless });
    return { status: "launched", browser };
  } catch (error) {
    if (isMissingBrowserRuntimeError(error)) {
      return {
        status: "unavailable",
        reason: "browser-runtime-unavailable",
        error: errorMessage(error)
      };
    }
    return { status: "failed", error: errorMessage(error) };
  }
}

/**
 * Best-effort cleanup shared by every browser consumer. Closing a browser that
 * is already gone, or whose transport already failed, must never mask the error
 * the caller is actually reporting.
 */
export async function closeBrowserQuietly(browser: PlaywrightLikeBrowser | undefined): Promise<void> {
  if (!browser) {
    return;
  }
  await browser.close().catch(() => undefined);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
