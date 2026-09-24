import type { MeasuredCommandResult } from "../../../core/runMeasuredCommand.js";
import type { IndexSnapshotV1 } from "../../../evaluation/indexSnapshot.js";
import type { ExperimentRunStatus } from "../../types.js";
import type { WarmIndexExecutionError, WarmIndexProjectExecutionV1, WarmIndexTaskExecutionV1 } from "./execution.js";

export const WARM_INDEX_EXECUTION_ARTIFACT_FILE = "warm-index-execution.json";
export const WARM_INDEX_EXECUTION_SCHEMA_VERSION = "my-dev-kit-lab-warm-index-execution-v1";

/** Command evidence by reference: stdout/stderr stay in their files and are not copied. */
export type WarmIndexCommandTelemetryV1 = {
  commandId: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  telemetryPath: string;
  error: string | null;
};

export type WarmIndexRawBaselineSummaryV1 = {
  targetRoot: string;
  filesIncluded: string[];
  totalFiles: number;
  totalChars: number;
  totalEstimatedTokens: number;
  tokenCountMethod: string;
  durationMs: number;
};

export type WarmIndexRetrievalSummaryV1 = {
  skipped: boolean;
  warnings: string[];
  totalChars: number;
  totalEstimatedTokens: number;
  tokenCountMethod: string;
  filesRead: string[];
  selectedNodeId: string | null;
  selectedFile: string | null;
  selectedSymbol: string | null;
  durationMs: number;
  commands: WarmIndexCommandTelemetryV1[];
};

export type WarmIndexTaskSummaryV1 = {
  caseId: string;
  status: ExperimentRunStatus;
  rawStatus: ExperimentRunStatus;
  warmStatus: ExperimentRunStatus;
  rawBaseline: WarmIndexRawBaselineSummaryV1 | null;
  warmRetrieval: WarmIndexRetrievalSummaryV1 | null;
  warnings: string[];
  errors: WarmIndexExecutionError[];
};

export type WarmIndexProjectSummaryV1 = {
  benchmarkProject: string;
  sessionKey: string;
  status: ExperimentRunStatus;
  targetRoot: string;
  sourceRoots: string[];
  indexDir: string;
  sessionPrepared: boolean;
  buildDurationMs: number | null;
  indexCommand: WarmIndexCommandTelemetryV1 | null;
  /**
   * Additive to schema v1: baseline index-build evidence (indexed-file hashes, generated artifact
   * inventory). `null` when no session was prepared; absent in artifacts written before it existed.
   */
  indexSnapshot?: IndexSnapshotV1 | null;
  tasks: WarmIndexTaskSummaryV1[];
  warnings: string[];
  errors: string[];
};

export type WarmIndexExecutionArtifactV1 = {
  schemaVersion: typeof WARM_INDEX_EXECUTION_SCHEMA_VERSION;
  runId: string;
  pluginId: string;
  projects: WarmIndexProjectSummaryV1[];
};

export function summarizeCommand(command: MeasuredCommandResult): WarmIndexCommandTelemetryV1 {
  return {
    commandId: command.commandId,
    ok: command.ok,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
    stdoutPath: command.stdoutPath,
    stderrPath: command.stderrPath,
    telemetryPath: command.telemetryPath,
    error: command.error ?? null,
  };
}

function summarizeTask(task: WarmIndexTaskExecutionV1): WarmIndexTaskSummaryV1 {
  const raw = task.rawBaseline;
  const warm = task.warmRetrieval;
  return {
    caseId: task.caseId,
    status: task.status,
    rawStatus: task.rawStatus,
    warmStatus: task.warmStatus,
    rawBaseline: raw
      ? {
          targetRoot: raw.targetRoot,
          filesIncluded: [...raw.filesIncluded],
          totalFiles: raw.totalFiles,
          totalChars: raw.totalChars,
          totalEstimatedTokens: raw.totalEstimatedTokens,
          tokenCountMethod: raw.tokenCountMethod,
          durationMs: raw.durationMs,
        }
      : null,
    warmRetrieval: warm
      ? {
          skipped: warm.skipped,
          warnings: [...warm.warnings],
          totalChars: warm.totalChars,
          totalEstimatedTokens: warm.totalEstimatedTokens,
          tokenCountMethod: warm.tokenCountMethod,
          filesRead: [...warm.filesRead],
          selectedNodeId: warm.selectedNodeId ?? null,
          selectedFile: warm.selectedFile ?? null,
          selectedSymbol: warm.selectedSymbol ?? null,
          durationMs: warm.durationMs,
          commands: warm.commands.map(summarizeCommand),
        }
      : null,
    warnings: [...task.warnings],
    errors: task.errors.map((error) => ({ ...error })),
  };
}

/** Bounded, context-free project summary used for both the persisted artifact and the run record. */
export function summarizeProjectExecution(project: WarmIndexProjectExecutionV1): WarmIndexProjectSummaryV1 {
  return {
    benchmarkProject: project.benchmarkProject,
    sessionKey: project.projectSegment,
    status: project.status,
    targetRoot: project.targetRoot,
    sourceRoots: [...project.sourceRoots],
    indexDir: project.indexDir,
    sessionPrepared: project.session !== undefined,
    buildDurationMs: project.build ? project.build.durationMs : null,
    indexCommand: project.build ? summarizeCommand(project.build.command) : null,
    indexSnapshot: project.session ? structuredClone(project.session.indexSnapshot) : null,
    tasks: project.tasks.map(summarizeTask),
    warnings: [...project.warnings],
    errors: [...project.errors],
  };
}

export function buildWarmIndexExecutionArtifact(args: {
  runId: string;
  pluginId: string;
  projects: readonly WarmIndexProjectExecutionV1[];
}): WarmIndexExecutionArtifactV1 {
  return {
    schemaVersion: WARM_INDEX_EXECUTION_SCHEMA_VERSION,
    runId: args.runId,
    pluginId: args.pluginId,
    projects: args.projects.map(summarizeProjectExecution),
  };
}
