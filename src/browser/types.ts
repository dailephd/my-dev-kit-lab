/**
 * Minimal structural types for the parts of Playwright this repository actually
 * uses. They exist so production code and tests can depend on a narrow shape
 * instead of the full Playwright type surface, and so a fake runtime can be
 * injected without installing a browser.
 *
 * These are deliberately generic: they describe a browser runtime, not report
 * screenshots and not tutorials. Action, locator, keyboard, and video members
 * are intentionally absent -- they belong to the later v0.4.7 tutorial-domain
 * work, not to this shared runtime owner.
 */

export type PlaywrightLikePage = {
  goto(url: string, options?: { waitUntil?: string }): Promise<void>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<void>;
};

/**
 * Optional today: only the persistent-session consumer planned for a later batch
 * needs contexts. Declaring it now keeps the extension point explicit without
 * requiring existing one-shot consumers to provide it.
 */
export type PlaywrightLikeBrowserContext = {
  newPage(): Promise<PlaywrightLikePage>;
  close(): Promise<void>;
};

export type PlaywrightLikeBrowser = {
  newPage(options: { viewport: { width: number; height: number } }): Promise<PlaywrightLikePage>;
  newContext?(options?: unknown): Promise<PlaywrightLikeBrowserContext>;
  close(): Promise<void>;
};

export type PlaywrightLikeModule = {
  chromium: {
    launch(options: { headless: boolean }): Promise<PlaywrightLikeBrowser>;
  };
};
