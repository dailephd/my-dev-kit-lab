import type { TutorialScenarioV1, TutorialStepResultV1 } from "./types.js";

/**
 * Subtitle generation.
 *
 * Cues are built from the structured step results plus the scenario's own
 * narration. This module never reads tutorial.md or tutorial-manifest.json to
 * reconstruct text or timing -- there is exactly one narration source
 * (`TutorialStepV1.narration`) and exactly one timing source (the recorded
 * step timeline), and both arrive as data.
 */

/** A cue shorter than this is unreadable, so short steps are padded for display. */
export const MIN_SUBTITLE_DURATION_MS = 500;

export type TutorialSubtitleCue = {
  index: number;
  stepId: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type BuildSubtitleCuesOptions = {
  scenario: TutorialScenarioV1;
  steps: TutorialStepResultV1[];
};

/**
 * One cue per executed step that has narration and a recorded timeline.
 *
 * Not-run steps produce no cue: they never appeared in the recording. A cue is
 * extended to MIN_SUBTITLE_DURATION_MS when the step was faster than that, but
 * never past the next cue's start, so cues stay ordered and non-overlapping.
 * The padding affects subtitle output only; step timing evidence is untouched.
 */
export function buildSubtitleCues(options: BuildSubtitleCuesOptions): TutorialSubtitleCue[] {
  const narrationByStepId = new Map(options.scenario.steps.map((step) => [step.id, step.narration]));

  const raw: Array<Omit<TutorialSubtitleCue, "index">> = [];
  for (const step of options.steps) {
    if (step.status === "not-run") {
      continue;
    }
    if (step.timelineStartMs === undefined || step.timelineEndMs === undefined) {
      continue;
    }
    const text = (narrationByStepId.get(step.id) ?? "").trim();
    if (text.length === 0) {
      continue;
    }
    raw.push({
      stepId: step.id,
      startMs: Math.max(0, step.timelineStartMs),
      endMs: Math.max(step.timelineStartMs, step.timelineEndMs),
      text
    });
  }

  return raw.map((cue, position) => {
    let endMs = cue.endMs;
    if (endMs - cue.startMs < MIN_SUBTITLE_DURATION_MS) {
      endMs = cue.startMs + MIN_SUBTITLE_DURATION_MS;
    }
    const next = raw[position + 1];
    if (next && endMs > next.startMs) {
      // Cap at the next cue rather than overlap; never invert the cue.
      endMs = Math.max(cue.startMs, next.startMs);
    }
    return { index: position + 1, stepId: cue.stepId, startMs: cue.startMs, endMs, text: cue.text };
  });
}

/** `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (WebVTT). */
export function formatSubtitleTimestamp(totalMs: number, millisecondSeparator: "," | "."): string {
  const safeMs = Math.max(0, Math.round(totalMs));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const milliseconds = safeMs % 1000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${millisecondSeparator}${pad(milliseconds, 3)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** Deterministic LF line endings regardless of host platform. */
export function renderSrt(cues: readonly TutorialSubtitleCue[]): string {
  if (cues.length === 0) {
    return "";
  }
  const blocks = cues.map((cue) =>
    [
      String(cue.index),
      `${formatSubtitleTimestamp(cue.startMs, ",")} --> ${formatSubtitleTimestamp(cue.endMs, ",")}`,
      cue.text
    ].join("\n")
  );
  return `${blocks.join("\n\n")}\n`;
}

export function renderVtt(cues: readonly TutorialSubtitleCue[]): string {
  const header = "WEBVTT\n";
  if (cues.length === 0) {
    return header;
  }
  const blocks = cues.map((cue) =>
    [
      `${formatSubtitleTimestamp(cue.startMs, ".")} --> ${formatSubtitleTimestamp(cue.endMs, ".")}`,
      cue.text
    ].join("\n")
  );
  return `${header}\n${blocks.join("\n\n")}\n`;
}
