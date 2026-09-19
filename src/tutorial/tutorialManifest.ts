import type {
  TutorialActionResultV1,
  TutorialArtifactRecordV1,
  TutorialArtifactStatus,
  TutorialAssertionResultV1,
  TutorialRunStatus,
  TutorialScenarioV1,
  TutorialStepResultV1,
  TutorialStepStatus,
  TutorialTargetContractV1
} from "./types.js";

/**
 * Canonical tutorial run manifest.
 *
 * Deliberately its own schema rather than an overloaded GalleryManifest: a
 * tutorial run records step/action/assertion outcomes, a timeline, and artifact
 * statuses, none of which a gallery index models. It is built from the
 * structured runtime results that are already in hand -- output directories are
 * scanned only to confirm the size of files this run itself wrote.
 */

export const TUTORIAL_MANIFEST_SCHEMA_VERSION = "1.0.0";

export type TutorialManifestStepV1 = {
  id: string;
  status: TutorialStepStatus;
  narration: string;
  timelineStartMs?: number;
  timelineEndMs?: number;
  action?: TutorialActionResultV1;
  assertions: TutorialAssertionResultV1[];
  screenshot?: {
    requested: boolean;
    id?: string;
    status?: TutorialArtifactStatus;
    path?: string;
    error?: string;
  };
  highlightRequested: boolean;
  calloutRequested: boolean;
  error?: string;
};

export type TutorialManifestV1 = {
  schemaVersion: "1.0.0";
  scenario: {
    schemaVersion: "1.0.0";
    id: string;
    title: string;
    description?: string;
    targetId: string;
  };
  target: {
    schemaVersion: "1.0.0";
    id: string;
    applicationUrl: string;
  };
  run: {
    id: string;
    status: TutorialRunStatus;
    startedAt: string;
    endedAt: string;
    durationMs: number;
  };
  environment: {
    platform: NodeJS.Platform;
    nodeVersion: string;
  };
  steps: TutorialManifestStepV1[];
  artifacts: TutorialArtifactRecordV1[];
  warnings: string[];
  cleanupErrors: string[];
};

export type BuildTutorialManifestOptions = {
  scenario: TutorialScenarioV1;
  targetContract: TutorialTargetContractV1;
  run: {
    id: string;
    status: TutorialRunStatus;
    startedAt: string;
    endedAt: string;
    durationMs: number;
  };
  steps: readonly TutorialStepResultV1[];
  /** Every artifact record, already carrying run-root-relative POSIX paths. */
  artifacts: readonly TutorialArtifactRecordV1[];
  warnings: readonly string[];
  cleanupErrors: readonly string[];
  environment?: { platform: NodeJS.Platform; nodeVersion: string };
};

export function buildTutorialManifest(options: BuildTutorialManifestOptions): TutorialManifestV1 {
  const stepById = new Map(options.scenario.steps.map((step) => [step.id, step]));
  const screenshotRecordById = new Map(
    options.artifacts
      .filter((record) => record.kind === "screenshot" && record.id !== undefined)
      .map((record) => [record.id as string, record])
  );

  // Step order is scenario order; assertion order is execution order. Neither is
  // re-sorted, so a diff between two runs stays readable.
  const steps: TutorialManifestStepV1[] = options.steps.map((stepResult) => {
    const step = stepById.get(stepResult.id);
    const requestedScreenshotId = step?.screenshot?.id;
    const record = requestedScreenshotId ? screenshotRecordById.get(requestedScreenshotId) : undefined;

    return {
      id: stepResult.id,
      status: stepResult.status,
      narration: step?.narration ?? "",
      ...(stepResult.timelineStartMs !== undefined ? { timelineStartMs: stepResult.timelineStartMs } : {}),
      ...(stepResult.timelineEndMs !== undefined ? { timelineEndMs: stepResult.timelineEndMs } : {}),
      ...(stepResult.action ? { action: stepResult.action } : {}),
      assertions: stepResult.assertions,
      ...(stepResult.screenshotRequested || record
        ? {
            screenshot: {
              requested: stepResult.screenshotRequested,
              ...(requestedScreenshotId !== undefined ? { id: requestedScreenshotId } : {}),
              ...(record?.status !== undefined ? { status: record.status } : {}),
              ...(record?.path !== undefined ? { path: record.path } : {}),
              ...(record?.error !== undefined ? { error: record.error } : {})
            }
          }
        : {}),
      highlightRequested: stepResult.highlightRequested,
      calloutRequested: stepResult.calloutRequested,
      ...(stepResult.error !== undefined ? { error: stepResult.error } : {})
    };
  });

  return {
    schemaVersion: TUTORIAL_MANIFEST_SCHEMA_VERSION,
    scenario: {
      schemaVersion: options.scenario.schemaVersion,
      id: options.scenario.id,
      title: options.scenario.title,
      ...(options.scenario.description !== undefined ? { description: options.scenario.description } : {}),
      targetId: options.scenario.targetId
    },
    target: {
      schemaVersion: options.targetContract.schemaVersion,
      id: options.targetContract.id,
      applicationUrl: options.targetContract.applicationUrl
    },
    run: { ...options.run },
    environment: options.environment ?? {
      platform: process.platform,
      nodeVersion: process.version
    },
    steps,
    artifacts: [...options.artifacts],
    warnings: [...options.warnings],
    cleanupErrors: [...options.cleanupErrors]
  };
}

/** Pretty JSON with a single trailing newline. */
export function renderTutorialManifest(manifest: TutorialManifestV1): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
