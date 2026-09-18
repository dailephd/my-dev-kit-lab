/**
 * Minimal structural types for the parts of Playwright this repository actually
 * uses. They exist so production code and tests can depend on a narrow shape
 * instead of the full Playwright type surface, and so a fake runtime can be
 * injected without installing a browser.
 *
 * These are deliberately generic: they describe a browser runtime, not report
 * screenshots and not tutorials. Video/recording members remain absent -- video
 * belongs to a later v0.4.7 batch, not to this shared runtime owner.
 */

export type PlaywrightLikePage = {
  goto(url: string, options?: { waitUntil?: string }): Promise<void>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<void>;
};

/**
 * Locator surface used by declarative tutorial actions and assertions.
 *
 * Every member here maps to exactly one Playwright locator method that a
 * tutorial action or assertion needs. There is deliberately no `evaluate`,
 * `evaluateHandle` or script-injection member: a scenario must not be able to
 * reach arbitrary page JavaScript through the locator type.
 */
export type PlaywrightLikeLocator = {
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  press(key: string, options?: { timeout?: number }): Promise<void>;
  hover(options?: { timeout?: number }): Promise<void>;
  dragTo(target: PlaywrightLikeLocator, options?: { timeout?: number }): Promise<void>;
  waitFor(options?: {
    state?: "visible" | "hidden" | "attached" | "detached";
    timeout?: number;
  }): Promise<void>;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  textContent(options?: { timeout?: number }): Promise<string | null>;
  getAttribute(name: string, options?: { timeout?: number }): Promise<string | null>;
};

/**
 * A page that also exposes the locator/navigation-state surface a persistent
 * tutorial session needs.
 *
 * Kept as an extension of `PlaywrightLikePage` rather than folded into it so the
 * one-shot screenshot consumer -- and every existing fake that stands in for a
 * screenshot page -- keeps working against the smaller contract it actually
 * uses. A real Playwright `Page` satisfies both.
 */
export type PlaywrightLikeTutorialPage = PlaywrightLikePage & {
  locator(selector: string): PlaywrightLikeLocator;
  getByText(text: string, options?: { exact?: boolean }): PlaywrightLikeLocator;
  getByTestId(testId: string): PlaywrightLikeLocator;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): PlaywrightLikeLocator;
  url(): string;
  close?(): Promise<void>;
};

/**
 * A browser context is the persistent-session boundary: a tutorial run creates
 * exactly one, so its pages carry the full tutorial surface.
 */
export type PlaywrightLikeBrowserContext = {
  newPage(): Promise<PlaywrightLikeTutorialPage>;
  close(): Promise<void>;
};

export type PlaywrightLikeBrowserContextOptions = {
  viewport?: { width: number; height: number };
};

export type PlaywrightLikeBrowser = {
  newPage(options: { viewport: { width: number; height: number } }): Promise<PlaywrightLikePage>;
  /**
   * Optional so a one-shot screenshot fake need not provide it. The tutorial
   * session requires it and reports a clear browser failure when it is absent.
   */
  newContext?(options?: PlaywrightLikeBrowserContextOptions): Promise<PlaywrightLikeBrowserContext>;
  close(): Promise<void>;
};

export type PlaywrightLikeModule = {
  chromium: {
    launch(options: { headless: boolean }): Promise<PlaywrightLikeBrowser>;
  };
};
