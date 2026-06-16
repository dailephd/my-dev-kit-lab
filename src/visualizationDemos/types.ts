import type { MeasuredCommandResult } from "../core/runMeasuredCommand.js";

export type VisualizationDemoCommand = {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  expectedArtifacts: string[];
};

export type VisualizationDemoRun = {
  id: string;
  name: string;
  commandString: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  producedArtifactPaths: string[];
  expectedArtifacts: Array<{ path: string; exists: boolean }>;
  warnings: string[];
  errors: string[];
  ok: boolean;
  measured: MeasuredCommandResult;
};

export type VisualizationDemoSummary = {
  generatedAt: string;
  projectPath: string;
  kitCommand: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  warnings: string[];
};

export type VisualizationDemoArtifacts = {
  summary: VisualizationDemoSummary;
  runs: VisualizationDemoRun[];
  artifactPaths: {
    summaryPath: string;
    runsPath: string;
    commandsDir: string;
    artifactsDir: string;
  };
  warnings: string[];
};
