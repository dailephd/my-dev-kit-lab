import { describe, expect, it } from "vitest";
import {
  DEFAULT_BROWSER_HEADLESS,
  isMissingBrowserRuntimeError,
  launchChromium
} from "../../src/browser/index.js";
import type { PlaywrightLikeBrowser, PlaywrightLikeModule } from "../../src/browser/types.js";

type LaunchRecord = { headless: boolean };

function fakeBrowser(onClose?: () => void): PlaywrightLikeBrowser {
  return {
    async newPage() {
      return {
        async goto() {},
        async screenshot() {}
      };
    },
    async close() {
      onClose?.();
    }
  };
}

function fakePlaywright(
  launches: LaunchRecord[],
  behavior?: () => void,
  onClose?: () => void
): PlaywrightLikeModule {
  return {
    chromium: {
      async launch(options) {
        launches.push({ headless: options.headless });
        behavior?.();
        return fakeBrowser(onClose);
      }
    }
  };
}

describe("launchChromium", () => {
  it("returns launched when the Playwright module loads and Chromium starts", async () => {
    const launches: LaunchRecord[] = [];
    let loaderCalls = 0;
    const result = await launchChromium({
      loadPlaywright: async () => {
        loaderCalls += 1;
        return fakePlaywright(launches);
      }
    });

    expect(loaderCalls).toBe(1);
    expect(result.status).toBe("launched");
    expect(launches).toHaveLength(1);
  });

  it("classifies a failing module loader as playwright-module-unavailable", async () => {
    const result = await launchChromium({
      loadPlaywright: async () => {
        throw new Error("Cannot find module 'playwright'");
      }
    });

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") throw new Error("expected unavailable");
    expect(result.reason).toBe("playwright-module-unavailable");
    expect(result.error).toContain("Cannot find module");
  });

  it("classifies a known missing-browser launch error as browser-runtime-unavailable", async () => {
    const result = await launchChromium({
      loadPlaywright: async () => ({
        chromium: {
          async launch(): Promise<PlaywrightLikeBrowser> {
            throw new Error("Executable doesn't exist. Please run npx playwright install");
          }
        }
      })
    });

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") throw new Error("expected unavailable");
    expect(result.reason).toBe("browser-runtime-unavailable");
  });

  it("classifies an unexpected launch error as failed and preserves its message", async () => {
    const result = await launchChromium({
      loadPlaywright: async () => ({
        chromium: {
          async launch(): Promise<PlaywrightLikeBrowser> {
            throw new Error("unexpected protocol error while starting");
          }
        }
      })
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("expected failed");
    expect(result.error).toContain("unexpected protocol error");
  });

  it("defaults headless to true", async () => {
    const launches: LaunchRecord[] = [];
    await launchChromium({ loadPlaywright: async () => fakePlaywright(launches) });

    expect(DEFAULT_BROWSER_HEADLESS).toBe(true);
    expect(launches[0]).toEqual({ headless: true });
  });

  it("forwards an explicit headless value", async () => {
    const launches: LaunchRecord[] = [];
    await launchChromium({ headless: false, loadPlaywright: async () => fakePlaywright(launches) });

    expect(launches[0]).toEqual({ headless: false });
  });

  it("returns a browser whose close() can be invoked by the caller", async () => {
    const launches: LaunchRecord[] = [];
    let closed = 0;
    const result = await launchChromium({
      loadPlaywright: async () => fakePlaywright(launches, undefined, () => {
        closed += 1;
      })
    });

    if (result.status !== "launched") throw new Error("expected launched");
    await result.browser.close();
    expect(closed).toBe(1);
  });

  // The generic runtime must not leak consumer policy: report/screenshot status
  // names and warning text belong to src/screenshot, not here.
  it("produces results free of report/screenshot-specific vocabulary", async () => {
    const results = [
      await launchChromium({
        loadPlaywright: async () => {
          throw new Error("Cannot find module 'playwright'");
        }
      }),
      await launchChromium({
        loadPlaywright: async () => ({
          chromium: {
            async launch(): Promise<PlaywrightLikeBrowser> {
              throw new Error("Executable doesn't exist");
            }
          }
        })
      })
    ];

    for (const result of results) {
      const serialized = JSON.stringify(result).toLowerCase();
      expect(serialized).not.toContain("screenshot");
      expect(serialized).not.toContain("png");
      expect(serialized).not.toContain("skipped");
      expect(serialized).not.toContain("report");
    }
  });
});

describe("isMissingBrowserRuntimeError", () => {
  it("matches the closed set of known missing-browser messages", () => {
    for (const message of [
      "Executable doesn't exist",
      "browserType.launch: something failed",
      "Please run: npx playwright install",
      "Failed to launch the browser process",
      "Could not find Chrome",
      "spawn chrome ENOENT"
    ]) {
      expect(isMissingBrowserRuntimeError(new Error(message))).toBe(true);
    }
  });

  it("does not match unrelated errors", () => {
    expect(isMissingBrowserRuntimeError(new Error("navigation timeout of 30000ms exceeded"))).toBe(false);
    expect(isMissingBrowserRuntimeError("plain string failure")).toBe(false);
  });
});
