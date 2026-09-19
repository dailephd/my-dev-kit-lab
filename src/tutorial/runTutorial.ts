import { stat } from "node:fs/promises";
import path from "node:path";
import { launchChromium, type BrowserLaunchResult, type LaunchChromiumOptions } from "../browser/index.js";
import { runMeasuredCommand } from "../core/runMeasuredCommand.js";
import { startManagedProcess, type ManagedProcessHandle } from "../runtime/managedProcess.js";
import type { LabExecutionContext } from "../runtime/labExecutionContext.js";
import { loadTutorialScenario, loadTutorialTargetContract } from "./loadTutorialContracts.js";
import { describeTargetIdMismatch, tutorialTargetIdsMatch } from "./targetContractValidation.js";
import { buildTutorialRunPaths, createTutorialRunDirectories, generateTutorialRunId } from "./tutorialPaths.js";
import { closeTutorialSession, executeTutorialSteps, openTutorialSession } from "./tutorialSession.js";
import {
  buildTutorialArtifactPaths,
  finalizeTutorialVideo,
  writeTextArtifact
} from "./tutorialArtifacts.js";
import { buildSubtitleCues, renderSrt, renderVtt } from "./subtitleWriter.js";
import { renderTutorialMarkdown } from "./markdownTutorialWriter.js";
import { buildTutorialManifest, renderTutorialManifest } from "./tutorialManifest.js";
import {
  TARGET_ROOT_PLACEHOLDER,
  TUTORIAL_RUN_RESULT_SCHEMA_VERSION,
  type TutorialArtifactRecordV1,
  type TutorialRunArtifactsV1,
  type TutorialRunPaths,
  type TutorialRunResultV1,
  type TutorialRunStatus,
  type TutorialScenarioV1,
  type TutorialStepResultV1,
  type TutorialTargetContractV1,
  type TutorialTargetProcessV1
} from "./types.js";

/**
 * Full tutorial orchestration.
 *
 * Ordering is deliberate and sequential: validate, match identity, prepare a
 * disposable target, start declared processes and wait for each to be ready,
 * then and only then launch one browser. Nothing later is attempted after an
 * earlier stage fails, and anything already started is torn down in reverse.
 */

export type RunTutorialOptions = {
  scenarioPath: string;
  targetContractPath: string;
  context: LabExecutionContext;
  /** Explicit --out. Absolute is used as-is; relative resolves against invocationCwd. */
  outDir?: string;
  /** Test seam: substitutes the shared Chromium launcher without touching its owner. */
  launchBrowser?: (options: LaunchChromiumOptions) => Promise<BrowserLaunchResult>;
  /** Test seam: deterministic run identifiers. */
  generateRunId?: () => string;
  /** Test seam: deterministic step pauses. */
  sleep?: (ms: number) => Promise<void>;
};

export async function runTutorial(options: RunTutorialOptions): Promise<TutorialRunResultV1> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const warnings: string[] = [];
  const cleanupErrors: string[] = [];

  const finish = (
    status: TutorialRunStatus,
    extra: Partial<TutorialRunResultV1> = {}
  ): TutorialRunResultV1 => {
    const endedAtMs = Date.now();
    return {
      schemaVersion: TUTORIAL_RUN_RESULT_SCHEMA_VERSION,
      status,
      startedAt,
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: endedAtMs - startedAtMs,
      steps: [],
      artifacts: { screenshots: [] },
      warnings,
      cleanupErrors,
      ...extra
    };
  };

  // ---- 1. Contracts -------------------------------------------------------
  const loadedScenario = await loadTutorialScenario(options.context.invocationCwd, options.scenarioPath);
  if (!loadedScenario.ok) {
    return finish("scenario-invalid", { error: loadedScenario.errors.join("\n") });
  }
  const { scenario } = loadedScenario.value;

  const loadedTarget = await loadTutorialTargetContract(
    options.context.invocationCwd,
    options.targetContractPath
  );
  if (!loadedTarget.ok) {
    return finish("target-invalid", {
      scenarioId: scenario.id,
      error: loadedTarget.errors.join("\n")
    });
  }
  const { targetContract, contractRoot } = loadedTarget.value;

  // ---- 2. Identity --------------------------------------------------------
  // Checked before any directory is created, any command runs, or any process
  // starts, so a mismatched pair costs nothing but a comparison.
  if (!tutorialTargetIdsMatch(scenario.targetId, targetContract.id)) {
    return finish("target-mismatch", {
      scenarioId: scenario.id,
      targetId: targetContract.id,
      error: describeTargetIdMismatch(scenario.targetId, targetContract.id)
    });
  }

  // ---- 3. Run directory ---------------------------------------------------
  const runId = (options.generateRunId ?? generateTutorialRunId)();
  const paths = buildTutorialRunPaths({
    workspaceRoot: options.context.workspaceRoot,
    invocationCwd: options.context.invocationCwd,
    scenarioId: scenario.id,
    runId,
    outDir: options.outDir
  });
  const identity = { scenarioId: scenario.id, targetId: targetContract.id, runId, paths };

  try {
    await createTutorialRunDirectories(paths);
  } catch (error) {
    // No run layout, so no artifacts and no manifest are possible or expected.
    return finish("prepare-failed", {
      ...identity,
      error: `Tutorial run directory could not be created at ${paths.runRoot}: ${messageOf(error)}`
    });
  }

  /**
   * Ends a run that failed before step execution produced anything recordable.
   *
   * The run layout exists, so a manifest is still written: it reports the real
   * failure and marks every tutorial artifact as skipped rather than pretending
   * one was produced. The failure status is never replaced by an artifact
   * status -- an early failure is not a video problem.
   */
  const finishBeforeArtifacts = async (
    status: TutorialRunStatus,
    error: string,
    reason: string
  ): Promise<TutorialRunResultV1> => {
    const skipped = (kind: TutorialArtifactRecordV1["kind"]): TutorialArtifactRecordV1 => ({
      kind,
      status: "skipped",
      error: reason
    });
    const artifacts: TutorialRunArtifactsV1 = {
      video: skipped("video"),
      srt: skipped("srt"),
      vtt: skipped("vtt"),
      markdown: skipped("markdown"),
      screenshots: []
    };

    const endedAtMs = Date.now();
    const manifest = buildTutorialManifest({
      scenario,
      targetContract,
      run: {
        id: runId,
        status,
        startedAt,
        endedAt: new Date(endedAtMs).toISOString(),
        durationMs: endedAtMs - startedAtMs
      },
      steps: [],
      artifacts: [artifacts.video!, artifacts.srt!, artifacts.vtt!, artifacts.markdown!],
      warnings,
      cleanupErrors
    });
    artifacts.manifest = await writeTextArtifact({
      kind: "manifest",
      runRoot: paths.runRoot,
      filePath: buildTutorialArtifactPaths(paths).manifest,
      contents: renderTutorialManifest(manifest)
    });
    if (artifacts.manifest.status === "failed") {
      warnings.push(artifacts.manifest.error ?? "Tutorial manifest could not be written.");
    }

    return finish(status, { ...identity, artifacts, error });
  };

  // ---- 4. Prepare ---------------------------------------------------------
  const prepareResult = await runPrepare(targetContract, contractRoot, paths);
  if (prepareResult) {
    return finishBeforeArtifacts(
      "prepare-failed",
      prepareResult,
      "Tutorial preparation failed before any recording started."
    );
  }

  // ---- 5. Processes + readiness ------------------------------------------
  const started: ManagedProcessHandle[] = [];
  const startup = await startTargetProcesses(targetContract, contractRoot, paths, started);
  if (startup) {
    cleanupErrors.push(...(await stopProcessesInReverse(started)));
    return finishBeforeArtifacts(
      startup.status,
      startup.error,
      "Target processes did not become ready, so no recording started."
    );
  }

  // ---- 6. Browser ---------------------------------------------------------
  const launch = await (options.launchBrowser ?? launchChromium)({ headless: true });
  if (launch.status !== "launched") {
    cleanupErrors.push(...(await stopProcessesInReverse(started)));
    const status: TutorialRunStatus = launch.status === "unavailable" ? "browser-unavailable" : "browser-failed";
    const error =
      launch.status === "unavailable"
        ? `Tutorial browser runtime is unavailable (${launch.reason}): ${launch.error}`
        : `Tutorial browser failed to launch: ${launch.error}`;
    return finishBeforeArtifacts(
      status,
      error,
      "Tutorial recording never started because the browser was not available."
    );
  }
  const browser = launch.browser;

  // ---- 7. Session + steps -------------------------------------------------
  const artifactPaths = buildTutorialArtifactPaths(paths);
  let steps: TutorialStepResultV1[] = [];
  let screenshots: TutorialArtifactRecordV1[] = [];
  let primaryStatus: TutorialRunStatus = "passed";
  let primaryError: string | undefined;
  let videoRecordingStarted = false;
  let videoRecord: TutorialArtifactRecordV1 | undefined;

  const opened = await openTutorialSession(browser, {
    viewport: scenario.browser.viewport,
    recordVideoDir: artifactPaths.videoTempDir
  });
  if (!opened.ok) {
    primaryStatus = "browser-failed";
    primaryError = opened.error;
  } else {
    videoRecordingStarted = true;
    const execution = await executeTutorialSteps({
      page: opened.session.page,
      scenario,
      applicationUrl: targetContract.applicationUrl,
      targetRoot: paths.targetRoot,
      visuals: true,
      paths,
      ...(options.sleep ? { sleep: options.sleep } : {})
    });
    steps = execution.steps;
    screenshots = execution.screenshots;
    warnings.push(...execution.visualWarnings);
    if (execution.failedStepId !== undefined) {
      primaryStatus = "step-failed";
      primaryError = execution.error;
    }

    // Playwright finalizes a recording only on page close, so the session is
    // closed before the video is saved. A failed tutorial still gets its video.
    cleanupErrors.push(...(await closeTutorialSession(opened.session)));

    const finalized = await finalizeTutorialVideo({
      video: opened.session.video,
      runRoot: paths.runRoot,
      videoPath: artifactPaths.video,
      videoTempDir: artifactPaths.videoTempDir
    });
    videoRecord = finalized.record;
    warnings.push(...finalized.warnings);
  }

  // ---- 8. Browser cleanup -------------------------------------------------
  // Browser resources are released before the processes they were talking to.
  const browserCloseError = await closeQuietly(() => browser.close());
  if (browserCloseError) {
    cleanupErrors.push(`Tutorial browser close failed: ${browserCloseError}`);
  }

  // ---- 9. Artifacts -------------------------------------------------------
  if (!videoRecord) {
    videoRecord = {
      kind: "video",
      status: "skipped",
      error: "Tutorial recording never started, so no canonical WebM was expected."
    };
  }

  const cues = buildSubtitleCues({ scenario, steps });
  const srtRecord = await writeTextArtifact({
    kind: "srt",
    runRoot: paths.runRoot,
    filePath: artifactPaths.srt,
    contents: renderSrt(cues)
  });
  const vttRecord = await writeTextArtifact({
    kind: "vtt",
    runRoot: paths.runRoot,
    filePath: artifactPaths.vtt,
    contents: renderVtt(cues)
  });
  const markdownRecord = await writeTextArtifact({
    kind: "markdown",
    runRoot: paths.runRoot,
    filePath: artifactPaths.markdown,
    contents: renderTutorialMarkdown({ scenario, steps, screenshots })
  });

  // ---- 10. Process cleanup ------------------------------------------------
  cleanupErrors.push(...(await stopProcessesInReverse(started)));

  // ---- 11. Final status ---------------------------------------------------
  // Precedence for an otherwise-passing run, most specific first: a missing
  // required video, then any other failed required artifact, then cleanup.
  // A real execution failure is never replaced by an artifact problem.
  const artifactFailures = [videoRecord, srtRecord, vttRecord, markdownRecord, ...screenshots].filter(
    (record) => record.status === "failed"
  );
  const videoFailed = videoRecord.status === "failed" || (videoRecordingStarted && videoRecord.status === "skipped");
  const nonVideoArtifactFailed = artifactFailures.some((record) => record.kind !== "video");

  let finalStatus: TutorialRunStatus = primaryStatus;
  let finalError: string | undefined = primaryError;
  if (primaryStatus === "passed") {
    if (videoFailed) {
      finalStatus = "video-finalization-failed";
      finalError = videoRecord.error ?? "Canonical tutorial video could not be finalized.";
    } else if (nonVideoArtifactFailed) {
      finalStatus = "artifact-failed";
      finalError = artifactFailures
        .filter((record) => record.kind !== "video")
        .map((record) => record.error ?? `${record.kind} artifact failed`)
        .join("; ");
    }
  } else {
    // Artifact problems are recorded but must not mask the real failure.
    for (const record of artifactFailures) {
      warnings.push(record.error ?? `${record.kind} artifact failed`);
    }
  }

  // ---- 12. Manifest -------------------------------------------------------
  const allArtifacts: TutorialArtifactRecordV1[] = [
    videoRecord,
    srtRecord,
    vttRecord,
    markdownRecord,
    ...screenshots,
    ...collectProcessLogRecords(targetContract, paths)
  ];

  const manifestEndedAtMs = Date.now();
  const manifest = buildTutorialManifest({
    scenario,
    targetContract,
    run: {
      id: runId,
      status: finalStatus,
      startedAt,
      endedAt: new Date(manifestEndedAtMs).toISOString(),
      durationMs: manifestEndedAtMs - startedAtMs
    },
    steps,
    artifacts: allArtifacts,
    warnings,
    cleanupErrors
  });
  const manifestRecord = await writeTextArtifact({
    kind: "manifest",
    runRoot: paths.runRoot,
    filePath: artifactPaths.manifest,
    contents: renderTutorialManifest(manifest)
  });

  if (manifestRecord.status === "failed") {
    if (finalStatus === "passed") {
      finalStatus = "artifact-failed";
      finalError = manifestRecord.error;
    } else {
      warnings.push(manifestRecord.error ?? "Tutorial manifest could not be written.");
    }
  }

  const artifacts: TutorialRunArtifactsV1 = {
    video: videoRecord,
    srt: srtRecord,
    vtt: vttRecord,
    markdown: markdownRecord,
    manifest: manifestRecord,
    screenshots
  };

  // A cleanup failure only downgrades an otherwise-clean run, because "passed"
  // would misreport a leaked resource.
  if (finalStatus === "passed" && cleanupErrors.length > 0) {
    return finish("cleanup-failed", {
      ...identity,
      steps,
      artifacts,
      error: `Tutorial run completed but cleanup failed: ${cleanupErrors.join("; ")}`
    });
  }

  return finish(finalStatus, {
    ...identity,
    steps,
    artifacts,
    ...(finalError !== undefined ? { error: finalError } : {})
  });
}

/**
 * Managed-process log paths are known from the contract and the run layout, so
 * they are recorded from structured data rather than by scanning the directory.
 */
function collectProcessLogRecords(
  targetContract: TutorialTargetContractV1,
  paths: TutorialRunPaths
): TutorialArtifactRecordV1[] {
  const records: TutorialArtifactRecordV1[] = [];
  for (const declared of targetContract.processes) {
    records.push({
      kind: "stdout-log",
      id: declared.id,
      status: "written",
      path: `logs/processes/${declared.id}.stdout.txt`
    });
    records.push({
      kind: "stderr-log",
      id: declared.id,
      status: "written",
      path: `logs/processes/${declared.id}.stderr.txt`
    });
  }
  return records;
}

/** Returns an error message when prepare failed, otherwise undefined. */
async function runPrepare(
  targetContract: TutorialTargetContractV1,
  contractRoot: string,
  paths: TutorialRunPaths
): Promise<string | undefined> {
  const prepareLogDir = path.join(paths.logsRoot, "prepare");
  const measured = await runMeasuredCommand({
    commandId: "prepare",
    executable: targetContract.prepare.executable,
    args: expandPlaceholders(targetContract.prepare.args ?? [], paths.targetRoot),
    cwd: contractRoot,
    outDir: prepareLogDir,
    env: expandEnvPlaceholders(targetContract.prepare.env, paths.targetRoot),
    timeoutMs: undefined
  });

  if (!measured.ok || measured.exitCode !== 0) {
    const detail = measured.error ?? `exit code ${String(measured.exitCode)}`;
    return `Tutorial prepare command exited with ${detail}. See ${measured.stdoutPath} and ${measured.stderrPath}.`;
  }

  // The prepare command is the only thing allowed to populate targetRoot, so its
  // success is not enough -- the directory it promised must actually be there.
  try {
    const stats = await stat(paths.targetRoot);
    if (!stats.isDirectory()) {
      return `Tutorial prepare command succeeded but ${paths.targetRoot} is not a directory.`;
    }
  } catch {
    return `Tutorial prepare command succeeded but did not create the target directory ${paths.targetRoot}.`;
  }
  return undefined;
}

type ProcessStartupFailure = { status: TutorialRunStatus; error: string };

async function startTargetProcesses(
  targetContract: TutorialTargetContractV1,
  contractRoot: string,
  paths: TutorialRunPaths,
  started: ManagedProcessHandle[]
): Promise<ProcessStartupFailure | undefined> {
  for (const declared of targetContract.processes) {
    let handle: ManagedProcessHandle;
    try {
      handle = await startManagedProcess({
        id: declared.id,
        executable: declared.executable,
        args: expandPlaceholders(declared.args ?? [], paths.targetRoot),
        cwd: resolveProcessCwd(declared, contractRoot, paths),
        outDir: path.join(paths.logsRoot, "processes"),
        env: expandEnvPlaceholders(declared.env, paths.targetRoot)
      });
    } catch (error) {
      return {
        status: "process-start-failed",
        error: `Managed process ${JSON.stringify(declared.id)} failed to start: ${messageOf(error)}`
      };
    }
    started.push(handle);

    const readiness = await handle.waitForReadiness(declared.readiness);
    if (readiness.status !== "ready") {
      return {
        status: "readiness-failed",
        error: describeReadinessFailure(declared, readiness.status, readiness.error)
      };
    }
  }
  return undefined;
}

function describeReadinessFailure(
  declared: TutorialTargetProcessV1,
  status: string,
  error: string | undefined
): string {
  const id = JSON.stringify(declared.id);
  switch (status) {
    case "timeout":
      return `Managed process ${id} did not become ready before the readiness timeout (${declared.readiness.timeoutMs}ms) at ${declared.readiness.url}.`;
    case "process-exited":
      return `Managed process ${id} exited before it became ready at ${declared.readiness.url}.`;
    default:
      return `Managed process ${id} readiness probe failed at ${declared.readiness.url}: ${error ?? "unknown readiness error"}`;
  }
}

function resolveProcessCwd(
  declared: TutorialTargetProcessV1,
  contractRoot: string,
  paths: TutorialRunPaths
): string {
  return declared.cwd === "target-root" ? paths.targetRoot : contractRoot;
}

/**
 * Substitutes the single supported placeholder. Validation has already rejected
 * every other `{{...}}` form, so this is a literal replacement and never a
 * template evaluation.
 */
export function expandPlaceholders(values: readonly string[], targetRoot: string): string[] {
  return values.map((value) => value.split(TARGET_ROOT_PLACEHOLDER).join(targetRoot));
}

export function expandEnvPlaceholders(
  env: Record<string, string> | undefined,
  targetRoot: string
): NodeJS.ProcessEnv | undefined {
  if (!env) {
    return undefined;
  }
  const expanded: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    expanded[key] = value.split(TARGET_ROOT_PLACEHOLDER).join(targetRoot);
  }
  return expanded;
}

/**
 * Stops managed processes in reverse startup order so a dependent process is
 * always shut down before whatever it depends on.
 */
async function stopProcessesInReverse(started: ManagedProcessHandle[]): Promise<string[]> {
  const errors: string[] = [];
  for (const handle of [...started].reverse()) {
    try {
      await handle.stop();
    } catch (error) {
      errors.push(`Managed process ${JSON.stringify(handle.id)} failed to stop: ${messageOf(error)}`);
    }
  }
  started.length = 0;
  return errors;
}

async function closeQuietly(close: () => Promise<void>): Promise<string | undefined> {
  try {
    await close();
    return undefined;
  } catch (error) {
    return messageOf(error);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
