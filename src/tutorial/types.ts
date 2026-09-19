import type { LocalHttpReadinessProbe } from "../runtime/managedProcess.js";

/**
 * v0.4.7 tutorial domain contracts.
 *
 * Everything here is declarative and serializable by design. A scenario can
 * describe what to do, but it can never carry JavaScript, a shell command, or
 * an arbitrary URL -- those escape hatches are deliberately absent from the
 * union types below and are rejected by validation, not merely undocumented.
 */

export const TUTORIAL_SCHEMA_VERSION = "1.0.0";
export const TARGET_CONTRACT_SCHEMA_VERSION = "1.0.0";

/** Result schema version for TutorialRunResultV1. */
export const TUTORIAL_RUN_RESULT_SCHEMA_VERSION = "1.0.0";

export const MAX_TUTORIAL_STEPS = 500;
export const MAX_STEP_PAUSE_MS = 60_000;

export const MIN_VIEWPORT_WIDTH = 320;
export const MAX_VIEWPORT_WIDTH = 3840;
export const MIN_VIEWPORT_HEIGHT = 240;
export const MAX_VIEWPORT_HEIGHT = 2160;

export const DEFAULT_TUTORIAL_ACTION_TIMEOUT_MS = 5_000;
export const DEFAULT_TUTORIAL_ASSERTION_TIMEOUT_MS = 5_000;

/** Stable, path-safe, lowercase identifier shape shared by every tutorial id. */
export const TUTORIAL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** The only placeholder a trusted target contract may use. */
export const TARGET_ROOT_PLACEHOLDER = "{{targetRoot}}";

export type TutorialJsonScalar = string | number | boolean | null;

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------

export type TutorialLocatorV1 =
  | { kind: "role"; role: string; name?: string; exact?: boolean }
  | { kind: "text"; text: string; exact?: boolean }
  | { kind: "css"; selector: string }
  | { kind: "test-id"; testId: string };

export const TUTORIAL_LOCATOR_KINDS = ["role", "text", "css", "test-id"] as const;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type TutorialFractionPointV1 = {
  x: number;
  y: number;
};

export const TUTORIAL_POINTER_COORDINATE_SPACES = ["fraction"] as const;

export type TutorialActionV1 =
  | { type: "goto"; path: string; waitUntil?: "load" | "domcontentloaded" | "networkidle" }
  | { type: "click"; locator: TutorialLocatorV1; timeoutMs?: number }
  | { type: "fill"; locator: TutorialLocatorV1; value: string; timeoutMs?: number }
  | { type: "press"; locator: TutorialLocatorV1; key: string; timeoutMs?: number }
  | { type: "hover"; locator: TutorialLocatorV1; timeoutMs?: number }
  | { type: "drag"; source: TutorialLocatorV1; target: TutorialLocatorV1; timeoutMs?: number }
  | {
      type: "pointer-click";
      locator: TutorialLocatorV1;
      position: TutorialFractionPointV1;
      coordinateSpace: "fraction";
      timeoutMs?: number;
    }
  | {
      type: "pointer-drag";
      locator: TutorialLocatorV1;
      from: TutorialFractionPointV1;
      to: TutorialFractionPointV1;
      coordinateSpace: "fraction";
      timeoutMs?: number;
    }
  | {
      type: "wait-for";
      locator: TutorialLocatorV1;
      state?: "visible" | "hidden" | "attached" | "detached";
      timeoutMs?: number;
    };

export const TUTORIAL_ACTION_TYPES = [
  "goto",
  "click",
  "fill",
  "press",
  "hover",
  "drag",
  "wait-for",
  "pointer-click",
  "pointer-drag"
] as const;

export const TUTORIAL_GOTO_WAIT_UNTIL = ["load", "domcontentloaded", "networkidle"] as const;
export const TUTORIAL_WAIT_FOR_STATES = ["visible", "hidden", "attached", "detached"] as const;

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export type TutorialAssertionV1 =
  | { type: "element-visible"; locator: TutorialLocatorV1; timeoutMs?: number }
  | { type: "text-equals"; locator: TutorialLocatorV1; expected: string; timeoutMs?: number }
  | { type: "text-contains"; locator: TutorialLocatorV1; expected: string; timeoutMs?: number }
  | { type: "url-path-equals"; expected: string }
  | {
      type: "attribute-equals";
      locator: TutorialLocatorV1;
      name: string;
      expected: string;
      timeoutMs?: number;
    }
  | {
      type: "http-json-equals";
      path: string;
      pointer: string;
      expected: TutorialJsonScalar;
      timeoutMs?: number;
    }
  | { type: "json-file-equals"; path: string; pointer: string; expected: TutorialJsonScalar }
  | { type: "file-exists"; path: string };

export const TUTORIAL_ASSERTION_TYPES = [
  "element-visible",
  "text-equals",
  "text-contains",
  "url-path-equals",
  "attribute-equals",
  "http-json-equals",
  "json-file-equals",
  "file-exists"
] as const;

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export type TutorialCalloutPlacement = "auto" | "top" | "right" | "bottom" | "left";

export const TUTORIAL_CALLOUT_PLACEMENTS = ["auto", "top", "right", "bottom", "left"] as const;

export type TutorialStepV1 = {
  id: string;
  narration: string;
  pauseBeforeMs?: number;
  pauseAfterMs?: number;
  action?: TutorialActionV1;
  highlight?: TutorialLocatorV1;
  callout?: {
    text: string;
    locator?: TutorialLocatorV1;
    placement?: TutorialCalloutPlacement;
  };
  screenshot?: {
    id: string;
    fullPage?: boolean;
  };
  assertions?: TutorialAssertionV1[];
};

export type TutorialScenarioV1 = {
  schemaVersion: "1.0.0";
  id: string;
  title: string;
  description?: string;
  targetId: string;
  browser: {
    viewport: { width: number; height: number };
  };
  steps: TutorialStepV1[];
};

// ---------------------------------------------------------------------------
// Target contract
// ---------------------------------------------------------------------------

export type TutorialTargetCommandV1 = {
  executable: string;
  args?: string[];
  env?: Record<string, string>;
};

export type TutorialTargetProcessCwd = "contract-root" | "target-root";

export const TUTORIAL_TARGET_PROCESS_CWDS = ["contract-root", "target-root"] as const;

export type TutorialTargetProcessV1 = {
  id: string;
  executable: string;
  args?: string[];
  cwd?: TutorialTargetProcessCwd;
  env?: Record<string, string>;
  readiness: LocalHttpReadinessProbe;
};

export type TutorialTargetContractV1 = {
  schemaVersion: "1.0.0";
  id: string;
  prepare: TutorialTargetCommandV1;
  processes: TutorialTargetProcessV1[];
  applicationUrl: string;
};

// ---------------------------------------------------------------------------
// Run paths
// ---------------------------------------------------------------------------

export type TutorialRunPaths = {
  runRoot: string;
  targetRoot: string;
  artifactsRoot: string;
  screenshotsRoot: string;
  logsRoot: string;
  temporaryRoot: string;
};

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type TutorialActionResultV1 = {
  type: TutorialActionV1["type"];
  status: "passed" | "failed";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  error?: string;
};

export type TutorialAssertionResultV1 = {
  type: TutorialAssertionV1["type"];
  status: "passed" | "failed";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  error?: string;
};

export type TutorialStepStatus = "passed" | "failed" | "not-run";

export type TutorialStepResultV1 = {
  id: string;
  status: TutorialStepStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  /**
   * Milliseconds from the start of the recorded tutorial session, measured with
   * a monotonic clock. These -- not the wall-clock ISO fields -- are what
   * subtitles are timed from. Present for executed steps only; a not-run step
   * has no timeline because it never happened.
   */
  timelineStartMs?: number;
  timelineEndMs?: number;
  action?: TutorialActionResultV1;
  assertions: TutorialAssertionResultV1[];
  /**
   * Prompt 2 records that a visual artifact was declared. Rendering and capture
   * are Prompt 3 behavior; nothing is drawn or written for these in this batch.
   */
  screenshotRequested: boolean;
  highlightRequested: boolean;
  calloutRequested: boolean;
  error?: string;
};

export type TutorialRunStatus =
  | "passed"
  | "scenario-invalid"
  | "target-invalid"
  | "target-mismatch"
  | "prepare-failed"
  | "process-start-failed"
  | "readiness-failed"
  | "browser-unavailable"
  | "browser-failed"
  | "step-failed"
  | "video-finalization-failed"
  | "artifact-failed"
  | "cleanup-failed";

export type TutorialArtifactStatus = "written" | "skipped" | "failed";

export type TutorialArtifactKind =
  | "video"
  | "srt"
  | "vtt"
  | "markdown"
  | "manifest"
  | "screenshot"
  | "stdout-log"
  | "stderr-log";

export type TutorialArtifactRecordV1 = {
  kind: TutorialArtifactKind;
  /** Screenshot id for screenshot records; process id for log records. */
  id?: string;
  status: TutorialArtifactStatus;
  /** Run-root-relative POSIX path. Never an absolute machine path. */
  path?: string;
  sizeBytes?: number;
  error?: string;
};

/**
 * Bounded artifact summary carried on the run result so a CLI consumer never has
 * to open tutorial-manifest.json just to learn whether artifact generation
 * succeeded.
 */
export type TutorialRunArtifactsV1 = {
  video?: TutorialArtifactRecordV1;
  srt?: TutorialArtifactRecordV1;
  vtt?: TutorialArtifactRecordV1;
  markdown?: TutorialArtifactRecordV1;
  manifest?: TutorialArtifactRecordV1;
  screenshots: TutorialArtifactRecordV1[];
};

export type TutorialRunResultV1 = {
  schemaVersion: "1.0.0";
  scenarioId?: string;
  targetId?: string;
  runId?: string;
  status: TutorialRunStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  paths?: TutorialRunPaths;
  steps: TutorialStepResultV1[];
  artifacts: TutorialRunArtifactsV1;
  warnings: string[];
  cleanupErrors: string[];
  error?: string;
};

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

/**
 * Validation never throws for content problems: a malformed scenario is an
 * expected outcome that the CLI reports with exit code 1, so the errors are
 * returned as data with enough location detail to fix the file.
 */
export type TutorialValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };
