import { describe, expect, it } from "vitest";
import {
  MIN_SUBTITLE_DURATION_MS,
  buildSubtitleCues,
  formatSubtitleTimestamp,
  renderSrt,
  renderVtt
} from "../../src/tutorial/subtitleWriter.js";
import type { TutorialStepResultV1 } from "../../src/tutorial/types.js";
import { minimalScenario } from "./tutorialTestHelpers.js";

function stepResult(
  id: string,
  timelineStartMs: number | undefined,
  timelineEndMs: number | undefined,
  status: TutorialStepResultV1["status"] = "passed"
): TutorialStepResultV1 {
  return {
    id,
    status,
    assertions: [],
    screenshotRequested: false,
    highlightRequested: false,
    calloutRequested: false,
    ...(timelineStartMs !== undefined ? { timelineStartMs } : {}),
    ...(timelineEndMs !== undefined ? { timelineEndMs } : {})
  };
}

const SCENARIO = minimalScenario({
  steps: [
    { id: "one", narration: "First narration." },
    { id: "two", narration: "Second narration." },
    { id: "three", narration: "Third narration." }
  ]
});

describe("formatSubtitleTimestamp", () => {
  it("formats SRT timestamps with comma milliseconds", () => {
    expect(formatSubtitleTimestamp(0, ",")).toBe("00:00:00,000");
    expect(formatSubtitleTimestamp(1234, ",")).toBe("00:00:01,234");
    expect(formatSubtitleTimestamp(3_723_456, ",")).toBe("01:02:03,456");
  });

  it("formats VTT timestamps with period milliseconds", () => {
    expect(formatSubtitleTimestamp(3_723_456, ".")).toBe("01:02:03.456");
  });

  it("never emits a negative timestamp", () => {
    expect(formatSubtitleTimestamp(-500, ",")).toBe("00:00:00,000");
  });
});

describe("buildSubtitleCues", () => {
  it("creates one cue per executed step, numbered from 1", () => {
    const cues = buildSubtitleCues({
      scenario: SCENARIO,
      steps: [
        stepResult("one", 0, 2000),
        stepResult("two", 2000, 5000),
        stepResult("three", 5000, 9000)
      ]
    });

    expect(cues.map((cue) => cue.index)).toEqual([1, 2, 3]);
    expect(cues.map((cue) => cue.text)).toEqual([
      "First narration.",
      "Second narration.",
      "Third narration."
    ]);
  });

  it("omits not-run steps entirely", () => {
    const cues = buildSubtitleCues({
      scenario: SCENARIO,
      steps: [stepResult("one", 0, 2000), stepResult("two", undefined, undefined, "not-run")]
    });

    expect(cues).toHaveLength(1);
    expect(cues[0].stepId).toBe("one");
  });

  it("extends a cue shorter than the readable minimum", () => {
    const cues = buildSubtitleCues({
      scenario: SCENARIO,
      steps: [stepResult("one", 0, 100), stepResult("two", 5000, 6000)]
    });

    expect(MIN_SUBTITLE_DURATION_MS).toBe(500);
    expect(cues[0].endMs).toBe(500);
  });

  it("caps an extended cue at the next cue start instead of overlapping", () => {
    const cues = buildSubtitleCues({
      scenario: SCENARIO,
      steps: [stepResult("one", 0, 50), stepResult("two", 200, 1200)]
    });

    expect(cues[0].endMs).toBe(200);
    expect(cues[0].endMs).toBeLessThanOrEqual(cues[1].startMs);
  });

  it("never produces a reversed or negative cue", () => {
    const cues = buildSubtitleCues({
      scenario: SCENARIO,
      steps: [stepResult("one", 100, 50), stepResult("two", 100, 900)]
    });

    for (const cue of cues) {
      expect(cue.endMs).toBeGreaterThanOrEqual(cue.startMs);
      expect(cue.startMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("skips steps with no recorded timeline", () => {
    const cues = buildSubtitleCues({
      scenario: SCENARIO,
      steps: [stepResult("one", undefined, undefined), stepResult("two", 0, 1000)]
    });

    expect(cues).toHaveLength(1);
    expect(cues[0].stepId).toBe("two");
  });

  it("uses the scenario narration verbatim", () => {
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "Exact wording, with punctuation!" }]
    });
    const cues = buildSubtitleCues({ scenario, steps: [stepResult("one", 0, 1000)] });

    expect(cues[0].text).toBe("Exact wording, with punctuation!");
  });
});

describe("renderSrt", () => {
  const cues = buildSubtitleCues({
    scenario: SCENARIO,
    steps: [stepResult("one", 0, 2000), stepResult("two", 2000, 5000)]
  });

  it("starts at cue 1 and increments", () => {
    const srt = renderSrt(cues);
    expect(srt.startsWith("1\n")).toBe(true);
    expect(srt).toContain("\n2\n");
  });

  it("uses comma-millisecond timestamps and blank-line separated blocks", () => {
    const srt = renderSrt(cues);
    expect(srt).toContain("00:00:00,000 --> 00:00:02,000");
    expect(srt).toContain("00:00:02,000 --> 00:00:05,000");
    expect(srt).toContain("First narration.\n\n2\n");
  });

  it("uses deterministic LF endings and a single trailing newline", () => {
    const srt = renderSrt(cues);
    expect(srt).not.toContain("\r");
    expect(srt.endsWith("\n")).toBe(true);
    expect(srt.endsWith("\n\n")).toBe(false);
    expect(renderSrt(cues)).toBe(srt);
  });

  it("includes no styling markup", () => {
    expect(renderSrt(cues)).not.toMatch(/<[a-z/]/i);
  });

  it("returns an empty document when there are no cues", () => {
    expect(renderSrt([])).toBe("");
  });
});

describe("renderVtt", () => {
  const cues = buildSubtitleCues({
    scenario: SCENARIO,
    steps: [stepResult("one", 0, 2000), stepResult("two", 2000, 5000)]
  });

  it("begins with the WEBVTT header", () => {
    expect(renderVtt(cues).startsWith("WEBVTT\n")).toBe(true);
    expect(renderVtt([])).toBe("WEBVTT\n");
  });

  it("uses period-millisecond timestamps", () => {
    const vtt = renderVtt(cues);
    expect(vtt).toContain("00:00:00.000 --> 00:00:02.000");
    expect(vtt).not.toContain(",000 -->");
  });

  it("carries the same narration as SRT", () => {
    const vtt = renderVtt(cues);
    const srt = renderSrt(cues);
    for (const cue of cues) {
      expect(vtt).toContain(cue.text);
      expect(srt).toContain(cue.text);
    }
  });

  it("adds no cue settings, identifiers or styling metadata", () => {
    const vtt = renderVtt(cues);
    expect(vtt).not.toContain("STYLE");
    expect(vtt).not.toContain("NOTE");
    expect(vtt).not.toContain("align:");
    expect(vtt).not.toContain("line:");
  });

  it("is deterministic", () => {
    expect(renderVtt(cues)).toBe(renderVtt(cues));
  });
});
