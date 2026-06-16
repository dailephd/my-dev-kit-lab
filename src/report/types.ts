export type LabReportStepStatus = "pass" | "fail" | "skipped";

export type LabReportStep = {
  id: string;
  label: string;
  command?: string;
  status: LabReportStepStatus;
  durationMs?: number;
  notes?: string;
};

export type LabReportMetric = {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
  interpretation?: string;
};

export type LabReportArtifactKind = "json" | "html" | "png" | "text" | "graph" | "log" | "other";

export type LabReportArtifact = {
  id: string;
  label: string;
  path: string;
  kind: LabReportArtifactKind;
};

export type LabReportInput = {
  reportId: string;
  title: string;
  projectName: string;
  benchmarkProject: string;
  workflowName: string;
  generatedAt?: string;
  summary: string;
  steps: LabReportStep[];
  metrics: LabReportMetric[];
  artifacts: LabReportArtifact[];
  warnings: string[];
};

export type NormalizedLabReport = LabReportInput & {
  generatedAt: string;
};

export type ReportArtifactPaths = {
  outDir: string;
  jsonPath: string;
  htmlPath: string;
  pngPath: string;
};

export function normalizeLabReport(input: LabReportInput, generatedAt?: string): NormalizedLabReport {
  return {
    ...input,
    generatedAt: generatedAt ?? input.generatedAt ?? new Date().toISOString(),
    steps: input.steps.map((step) => ({ ...step })),
    metrics: input.metrics.map((metric) => ({ ...metric })),
    artifacts: input.artifacts.map((artifact) => ({ ...artifact })),
    warnings: [...input.warnings]
  };
}
