export type PlotPoint = {
  x: number;
  y: number;
  group: string;
  label: string;
  metadata?: Record<string, string | number | boolean | undefined>;
};

export type PlotSkippedPoint = {
  plotId: string;
  label: string;
  reason: string;
};

export type PlotSeries = {
  id: string;
  title: string;
  xLabel: string;
  yLabel: string;
  kind: "scatter" | "bar";
  points: PlotPoint[];
  warnings: string[];
};

export type ExperimentPlotData = {
  generatedAt: string;
  sourceExperimentDir: string;
  plots: PlotSeries[];
  skippedPoints: PlotSkippedPoint[];
  warnings: string[];
};

export type PlotArtifacts = {
  summary: {
    generatedAt: string;
    sourceExperimentDir: string;
    chartCount: number;
    skippedPointCount: number;
    warnings: string[];
  };
  data: ExperimentPlotData;
  artifactPaths: {
    summaryPath: string;
    dataPath: string;
    chartsDir: string;
    charts: Record<string, string>;
  };
};
