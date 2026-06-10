export type ScreenshotCaptureStatus = "captured" | "skipped" | "failed";

export type ScreenshotCaptureResult = {
  status: ScreenshotCaptureStatus;
  htmlPath: string;
  pngPath: string;
  warning?: string;
  error?: string;
};

export type PlaywrightLikePage = {
  goto(url: string, options?: { waitUntil?: string }): Promise<void>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<void>;
};

export type PlaywrightLikeBrowser = {
  newPage(options: { viewport: { width: number; height: number } }): Promise<PlaywrightLikePage>;
  close(): Promise<void>;
};

export type PlaywrightLikeModule = {
  chromium: {
    launch(options: { headless: boolean }): Promise<PlaywrightLikeBrowser>;
  };
};
