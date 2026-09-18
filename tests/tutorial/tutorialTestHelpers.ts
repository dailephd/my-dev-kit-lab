import { writeFile } from "node:fs/promises";
import type {
  PlaywrightLikeBrowser,
  PlaywrightLikeBrowserContext,
  PlaywrightLikeLocator,
  PlaywrightLikeTutorialPage,
  PlaywrightLikeVideo
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
  boundingBox?: { x: number; y: number; width: number; height: number } | null;
  boundingBoxError?: Error;
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
    },
    async boundingBox() {
      record("boundingBox");
      if (behavior.boundingBoxError) throw behavior.boundingBoxError;
      // Default geometry so visual code paths run without every test declaring one.
      return behavior.boundingBox === undefined
        ? { x: 10, y: 20, width: 100, height: 40 }
        : behavior.boundingBox;
    }
  };
  return locator;
}

export type PageCall = { method: string; args: unknown[] };

export type EvaluateCall = { fnName: string; arg: unknown };

export type FakePageOptions = {
  url?: string;
  gotoError?: Error;
  screenshotError?: Error;
  /** Runs injected scripts against a stub document instead of recording only. */
  document?: unknown;
  evaluateError?: Error;
  /**
   * Recorded video for this page. Defaults to a working fake, mirroring real
   * Playwright with recordVideo enabled; pass null to simulate no recording.
   */
  video?: PlaywrightLikeVideo | null;
  /** Behavior keyed by the canonical locator key the resolver produces. */
  locators?: Record<string, FakeLocatorBehavior>;
  defaultLocator?: FakeLocatorBehavior;
};

export type FakePage = PlaywrightLikeTutorialPage & {
  readonly calls: PageCall[];
  readonly locators: Map<string, FakeLocator>;
  readonly evaluateCalls: EvaluateCall[];
  readonly screenshotCalls: Array<{ path: string; fullPage: boolean }>;
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
  const evaluateCalls: EvaluateCall[] = [];
  const screenshotCalls: Array<{ path: string; fullPage: boolean }> = [];
  let url = options.url ?? "http://127.0.0.1:3000/";
  let closeCount = 0;
  const defaultVideo = createFakeVideo();

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
    evaluateCalls,
    screenshotCalls,
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
      screenshotCalls.push({ path: screenshotOptions.path, fullPage: screenshotOptions.fullPage });
      if (options.screenshotError) throw options.screenshotError;
      // Writes real bytes so artifact size verification is exercised honestly.
      await writeFile(screenshotOptions.path, FAKE_PNG_BYTES);
    },
    video() {
      calls.push({ method: "video", args: [] });
      return options.video === undefined ? defaultVideo : options.video;
    },
    async evaluate(fn, arg) {
      evaluateCalls.push({ fnName: fn.name, arg });
      if (options.evaluateError) throw options.evaluateError;
      if (options.document !== undefined) {
        // Runs the real injected script against a stub document so DOM effects
        // (ids, pointer-events, geometry, removal) are genuinely covered.
        return withStubDocument(options.document, () => fn(arg)) as never;
      }
      return undefined as never;
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
  readonly recordVideoOptions: Array<{ dir: string; size: { width: number; height: number } } | undefined>;
};

export function createFakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  const page = options.page ?? createFakePage();
  const events: string[] = [];
  const viewports: Array<{ width: number; height: number } | undefined> = [];
  const recordVideoOptions: Array<{ dir: string; size: { width: number; height: number } } | undefined> = [];
  let contextsCreated = 0;
  let pagesCreated = 0;

  const browser: FakeBrowser = {
    page,
    events,
    viewports,
    recordVideoOptions,
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
      recordVideoOptions.push(contextOptions?.recordVideo);
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

// ---------------------------------------------------------------------------
// Stub DOM
//
// The injected cursor/overlay scripts only use a handful of document APIs, so a
// tiny stub lets unit tests drive the real browser-side code (ids, styles,
// pointer-events, geometry, removal) without launching a browser. The scripts
// read `globalThis.document`, so it is swapped in for the duration of one call.
// ---------------------------------------------------------------------------

export type StubElement = {
  id: string;
  tagName: string;
  textContent: string;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  children: StubElement[];
  parent: StubElement | null;
  setAttribute(name: string, value: string): void;
  appendChild(node: StubElement): void;
  remove(): void;
  style: { setProperty(name: string, value: string): void };
};

export type StubDocument = {
  body: StubElement;
  byId: Map<string, StubElement>;
  getElementById(id: string): StubElement | null;
  createElement(tag: string): StubElement;
  /** Every element currently attached anywhere beneath body. */
  all(): StubElement[];
};

export function createStubDocument(): StubDocument {
  const byId = new Map<string, StubElement>();

  const makeElement = (tagName: string): StubElement => {
    const element: StubElement = {
      id: "",
      tagName,
      textContent: "",
      attributes: {},
      styles: {},
      children: [],
      parent: null,
      setAttribute(name, value) {
        element.attributes[name] = value;
      },
      appendChild(node) {
        node.parent = element;
        element.children.push(node);
        if (node.id) {
          byId.set(node.id, node);
        }
      },
      remove() {
        if (element.parent) {
          element.parent.children = element.parent.children.filter((child) => child !== element);
          element.parent = null;
        }
        // A real getElementById cannot find anything in a detached subtree, so
        // the whole subtree is deregistered, not just this node.
        const deregister = (node: StubElement): void => {
          if (node.id) {
            byId.delete(node.id);
          }
          for (const child of node.children) {
            deregister(child);
          }
        };
        deregister(element);
      },
      style: {
        setProperty(name, value) {
          element.styles[name] = value;
        }
      }
    };
    return element;
  };

  const body = makeElement("body");
  const document: StubDocument = {
    body,
    byId,
    getElementById(id) {
      return byId.get(id) ?? null;
    },
    createElement(tag) {
      return makeElement(tag);
    },
    all() {
      const collected: StubElement[] = [];
      const walk = (node: StubElement): void => {
        for (const child of node.children) {
          collected.push(child);
          walk(child);
        }
      };
      walk(body);
      return collected;
    }
  };
  return document;
}

/** Runs `operation` with `globalThis.document` temporarily set to `document`. */
export function withStubDocument<T>(document: unknown, operation: () => T): T {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = globals.document;
  globals.document = document;
  try {
    return operation();
  } finally {
    if (previous === undefined) {
      delete globals.document;
    } else {
      globals.document = previous;
    }
  }
}

/** Minimal valid PNG header bytes; enough to prove a non-empty artifact. */
export const FAKE_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
]);

export type FakeVideo = PlaywrightLikeVideo & { readonly savedTo: string[] };

export function createFakeVideo(options: {
  rawPath?: string;
  pathError?: Error;
  saveAsError?: Error;
  onSave?: (target: string) => Promise<void> | void;
} = {}): FakeVideo {
  const savedTo: string[] = [];
  return {
    savedTo,
    async path() {
      if (options.pathError) throw options.pathError;
      return options.rawPath ?? "/tmp/raw-tutorial-video.webm";
    },
    async saveAs(target) {
      savedTo.push(target);
      if (options.saveAsError) throw options.saveAsError;
      if (options.onSave) {
        await options.onSave(target);
        return;
      }
      await writeFile(target, Buffer.from("fake-webm-bytes"));
    }
  };
}
