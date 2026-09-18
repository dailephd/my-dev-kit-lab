import type { PlaywrightLikeLocator, PlaywrightLikeTutorialPage } from "../browser/types.js";
import type { TutorialLocatorV1 } from "./types.js";

/**
 * The single place a declarative locator becomes a Playwright locator.
 *
 * Actions, assertions, and (in a later batch) overlay targeting all call this,
 * so locator semantics cannot drift between them and a new locator kind has
 * exactly one implementation site.
 */
export function resolveTutorialLocator(
  page: PlaywrightLikeTutorialPage,
  locator: TutorialLocatorV1
): PlaywrightLikeLocator {
  switch (locator.kind) {
    case "role":
      return page.getByRole(locator.role, {
        ...(locator.name !== undefined ? { name: locator.name } : {}),
        ...(locator.exact !== undefined ? { exact: locator.exact } : {})
      });
    case "text":
      return page.getByText(
        locator.text,
        locator.exact !== undefined ? { exact: locator.exact } : undefined
      );
    case "css":
      return page.locator(locator.selector);
    case "test-id":
      return page.getByTestId(locator.testId);
  }
}

/** Short human-readable form used in action and assertion failure messages. */
export function describeTutorialLocator(locator: TutorialLocatorV1): string {
  switch (locator.kind) {
    case "role":
      return locator.name === undefined
        ? `role=${locator.role}`
        : `role=${locator.role} name=${JSON.stringify(locator.name)}`;
    case "text":
      return `text=${JSON.stringify(locator.text)}`;
    case "css":
      return `css=${locator.selector}`;
    case "test-id":
      return `test-id=${locator.testId}`;
  }
}
