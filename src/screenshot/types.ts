export type ScreenshotCaptureStatus = "captured" | "skipped" | "failed";

export type ScreenshotCaptureResult = {
  status: ScreenshotCaptureStatus;
  htmlPath: string;
  pngPath: string;
  warning?: string;
  error?: string;
};

/**
 * The structural Playwright types now live in the shared browser-runtime owner
 * (`src/browser/types.ts`) because one-shot report capture is no longer their
 * only consumer. They are re-exported here unchanged so every existing import
 * of `src/screenshot/types.js` -- including `src/index.ts`'s public surface and
 * the screenshot tests -- keeps working against the same declarations.
 */
export type {
  PlaywrightLikeBrowser,
  PlaywrightLikeBrowserContext,
  PlaywrightLikeModule,
  PlaywrightLikePage
} from "../browser/types.js";
