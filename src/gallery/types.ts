export type GalleryManifestMetric = {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
  interpretation?: string;
};

export type GalleryManifestItemStatus = "pass" | "skipped" | "warning";

export type GalleryManifestItem = {
  id: string;
  title: string;
  description: string;
  kind: string;
  status: GalleryManifestItemStatus;
  htmlPath: string;
  screenshotPath?: string;
  summaryPath?: string;
  runsPath?: string;
  artifactPaths?: string[];
  /** Additive (v0.9.3): artifact family a `--source` reader recognized; absent for legacy items. */
  sourceFamily?: string;
  /** Additive (v0.9.3): producer identity such as `<scenario>/<run>` or `<plugin>/<run>`. */
  sourceId?: string;
  /** Additive (v0.9.3): output-relative path to a verified WebM video. */
  videoPath?: string;
  /** Additive (v0.9.3): output-relative path to a verified generated Markdown file. */
  markdownPath?: string;
  /** Additive (v0.9.3): output-relative paths to verified PNG/JPEG/WebP screenshots. */
  screenshotPaths?: string[];
  tags?: string[];
  metrics: GalleryManifestMetric[];
  warnings: string[];
};

export type GalleryManifest = {
  generatedAt: string;
  projectName: string;
  title: string;
  description: string;
  outputDirectory: string;
  items: GalleryManifestItem[];
  warnings: string[];
};

export type GalleryManifestArtifactPaths = {
  summaryPath: string;
  runsPath: string;
  htmlPath: string;
  pngPath: string;
};
