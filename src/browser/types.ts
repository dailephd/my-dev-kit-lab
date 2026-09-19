/**
 * Minimal structural types for the parts of Playwright this repository actually
 * uses. They exist so production code and tests can depend on a narrow shape
 * instead of the full Playwright type surface, and so a fake runtime can be
 * injected without installing a browser.
 *
 * These are deliberately generic: they describe a browser runtime, not report
 * screenshots and not tutorials.
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
  /**
   * Viewport-relative geometry of the target element, or null when it has none
   * (detached, zero-sized, or not laid out). Used only to position presentation
   * overlays; it never participates in action or assertion outcomes.
   */
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
};

/**
 * Playwright's recorded-video handle for a page.
 *
 * `path()` resolves to the raw temporary recording; `saveAs()` copies it to a
 * caller-chosen location. Both require the page to be closed first, which is why
 * video finalization happens during session teardown rather than mid-run.
 */
export type PlaywrightLikeVideo = {
  path(): Promise<string>;
  saveAs(path: string): Promise<void>;
};

export type PlaywrightLikeMouse = {
  move(x: number, y: number, options?: { steps?: number }): Promise<void>;
  down(): Promise<void>;
  up(): Promise<void>;
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
  mouse: PlaywrightLikeMouse;
  locator(selector: string): PlaywrightLikeLocator;
  getByText(text: string, options?: { exact?: boolean }): PlaywrightLikeLocator;
  getByTestId(testId: string): PlaywrightLikeLocator;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): PlaywrightLikeLocator;
  url(): string;
  close?(): Promise<void>;
  /** Recorded video for this page, or null when the context has no recordVideo. */
  video(): PlaywrightLikeVideo | null;
  /**
   * Runs a serializable function in the page.
   *
   * This exists solely so the tutorial runtime can install and remove its OWN
   * fixed presentation DOM (cursor, click feedback, highlight, callout). It is
   * never reachable from a scenario: no action, assertion or locator kind
   * accepts script text, so a scenario author cannot get code in here.
   */
  evaluate<Result, Arg>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result>;
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
  /**
   * Enables Playwright's own WebM recording for every page in the context.
   * Only tutorial execution requests it; one-shot report screenshot capture
   * never does.
   */
  recordVideo?: {
    dir: string;
    size: { width: number; height: number };
  };
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
