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
