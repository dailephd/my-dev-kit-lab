import type {
  PlaywrightLikeBrowser,
  PlaywrightLikeBrowserContext,
  PlaywrightLikeLocator,
  PlaywrightLikeTutorialPage
} from "../../src/browser/types.js";
import type { TutorialScenarioV1, TutorialTargetContractV1 } from "../../src/tutorial/types.js";

/**
 * Structural fakes for the tutorial browser surface.
 *
 * Nothing here needs a real Chromium install: the production code only ever
 * touches the narrow structural types, so a plain object is a complete stand-in.
 */

export type LocatorCall = { method: string; args: unknown[] };

export type FakeLocatorBehavior = {
  clickError?: Error;
  fillError?: Error;
  pressError?: Error;
  hoverError?: Error;
  dragError?: Error;
  waitForError?: Error;
  visible?: boolean;
  text?: string | null;
  attributes?: Record<string, string>;
};

export type FakeLocator = PlaywrightLikeLocator & {
  readonly key: string;
  readonly calls: LocatorCall[];
};

export function createFakeLocator(key: string, behavior: FakeLocatorBehavior = {}): FakeLocator {
  const calls: LocatorCall[] = [];
  const record = (method: string, ...args: unknown[]): void => {
    calls.push({ method, args });
  };
  const locator: FakeLocator = {
    key,
    calls,
    async click(options) {
      record("click", options);
      if (behavior.clickError) throw behavior.clickError;
    },
    async fill(value, options) {
      record("fill", value, options);
      if (behavior.fillError) throw behavior.fillError;
    },
    async press(key2, options) {
      record("press", key2, options);
      if (behavior.pressError) throw behavior.pressError;
    },
    async hover(options) {
      record("hover", options);
      if (behavior.hoverError) throw behavior.hoverError;
    },
    async dragTo(target, options) {
      record("dragTo", (target as FakeLocator).key, options);
      if (behavior.dragError) throw behavior.dragError;
    },
    async waitFor(options) {
      record("waitFor", options);
      if (behavior.waitForError) throw behavior.waitForError;
      if (options?.state === "visible" && behavior.visible === false) {
        throw new Error(`Timeout waiting for ${key} to be visible`);
      }
    },
    async isVisible(options) {
      record("isVisible", options);
      return behavior.visible !== false;
    },
    async textContent(options) {
      record("textContent", options);
      return behavior.text ?? null;
    },
    async getAttribute(name, options) {
      record("getAttribute", name, options);
      return behavior.attributes?.[name] ?? null;
    }
  };
  return locator;
}

export type PageCall = { method: string; args: unknown[] };

export type FakePageOptions = {
  url?: string;
  gotoError?: Error;
  /** Behavior keyed by the canonical locator key the resolver produces. */
  locators?: Record<string, FakeLocatorBehavior>;
  defaultLocator?: FakeLocatorBehavior;
};

export type FakePage = PlaywrightLikeTutorialPage & {
  readonly calls: PageCall[];
  readonly locators: Map<string, FakeLocator>;
  readonly closed: () => number;
  setUrl(url: string): void;
};

/**
 * Locator keys are the identity a test asserts on: "role:button|name=Save",
 * "text:Hello|exact=true", "css:.x", "test-id:save". They encode exactly what
 * the canonical resolver forwarded, so a test can prove the mapping without
 * mocking Playwright itself.
 */
export function createFakePage(options: FakePageOptions = {}): FakePage {
  const calls: PageCall[] = [];
  const locators = new Map<string, FakeLocator>();
  let url = options.url ?? "http://127.0.0.1:3000/";
  let closeCount = 0;

  const obtain = (key: string): FakeLocator => {
    const existing = locators.get(key);
    if (existing) return existing;
    const created = createFakeLocator(key, options.locators?.[key] ?? options.defaultLocator ?? {});
    locators.set(key, created);
    return created;
  };

  const page: FakePage = {
    calls,
    locators,
    closed: () => closeCount,
    setUrl(next: string) {
      url = next;
    },
    async goto(target, gotoOptions) {
      calls.push({ method: "goto", args: [target, gotoOptions] });
      if (options.gotoError) throw options.gotoError;
      url = target;
    },
    async screenshot(screenshotOptions) {
      calls.push({ method: "screenshot", args: [screenshotOptions] });
      throw new Error("Prompt 2 must never capture screenshots.");
    },
    locator(selector) {
      calls.push({ method: "locator", args: [selector] });
      return obtain(`css:${selector}`);
    },
    getByText(text, textOptions) {
      calls.push({ method: "getByText", args: [text, textOptions] });
      return obtain(`text:${text}|exact=${String(textOptions?.exact)}`);
    },
    getByTestId(testId) {
      calls.push({ method: "getByTestId", args: [testId] });
      return obtain(`test-id:${testId}`);
    },
    getByRole(role, roleOptions) {
      calls.push({ method: "getByRole", args: [role, roleOptions] });
      return obtain(`role:${role}|name=${String(roleOptions?.name)}|exact=${String(roleOptions?.exact)}`);
    },
    url() {
      return url;
    },
    async close() {
      closeCount += 1;
    }
  };
  return page;
}

export type FakeBrowserOptions = {
  page?: FakePage;
  newContextError?: Error;
  newPageError?: Error;
  contextCloseError?: Error;
  browserCloseError?: Error;
  omitNewContext?: boolean;
};

export type FakeBrowser = PlaywrightLikeBrowser & {
  readonly contextsCreated: () => number;
  readonly pagesCreated: () => number;
  readonly page: FakePage;
  readonly events: string[];
  readonly viewports: Array<{ width: number; height: number } | undefined>;
};

export function createFakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  const page = options.page ?? createFakePage();
  const events: string[] = [];
  const viewports: Array<{ width: number; height: number } | undefined> = [];
  let contextsCreated = 0;
  let pagesCreated = 0;

  const browser: FakeBrowser = {
    page,
    events,
    viewports,
    contextsCreated: () => contextsCreated,
    pagesCreated: () => pagesCreated,
    async newPage() {
      throw new Error("Tutorial runs must create pages through a browser context.");
    },
    async close() {
      events.push("browser.close");
      if (options.browserCloseError) throw options.browserCloseError;
    }
  };

  if (!options.omitNewContext) {
    browser.newContext = async (contextOptions): Promise<PlaywrightLikeBrowserContext> => {
      events.push("context.create");
      contextsCreated += 1;
      viewports.push(contextOptions?.viewport);
      if (options.newContextError) throw options.newContextError;
      return {
        async newPage() {
          pagesCreated += 1;
          if (options.newPageError) throw options.newPageError;
          return page;
        },
        async close() {
          events.push("context.close");
          if (options.contextCloseError) throw options.contextCloseError;
        }
      };
    };
  }

  return browser;
}

// ---------------------------------------------------------------------------
// Contract fixtures
// ---------------------------------------------------------------------------

export function minimalScenario(overrides: Partial<TutorialScenarioV1> = {}): TutorialScenarioV1 {
  return {
    schemaVersion: "1.0.0",
    id: "demo-tutorial",
    title: "Demo tutorial",
    targetId: "demo-target",
    browser: { viewport: { width: 1280, height: 720 } },
    steps: [{ id: "intro", narration: "Welcome to the demo." }],
    ...overrides
  } as TutorialScenarioV1;
}

export function minimalTargetContract(
  overrides: Partial<TutorialTargetContractV1> = {}
): TutorialTargetContractV1 {
  return {
    schemaVersion: "1.0.0",
    id: "demo-target",
    prepare: { executable: "node", args: ["prepare.js", "{{targetRoot}}"] },
    processes: [
      {
        id: "viewer",
        executable: "node",
        args: ["server.js"],
        cwd: "target-root",
        readiness: { kind: "http", url: "http://127.0.0.1:3000/", timeoutMs: 5000 }
      }
    ],
    applicationUrl: "http://127.0.0.1:3000/",
    ...overrides
  } as TutorialTargetContractV1;
}
