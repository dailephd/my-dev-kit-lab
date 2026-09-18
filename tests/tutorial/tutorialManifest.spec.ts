import { describe, expect, it } from "vitest";
import {
  TUTORIAL_MANIFEST_SCHEMA_VERSION,
  buildTutorialManifest,
  renderTutorialManifest,
  type TutorialManifestV1
} from "../../src/tutorial/tutorialManifest.js";
import type { TutorialArtifactRecordV1, TutorialStepResultV1 } from "../../src/tutorial/types.js";
import { minimalScenario, minimalTargetContract } from "./tutorialTestHelpers.js";

const SCENARIO = minimalScenario({
  description: "A described tutorial.",
  steps: [
    {
      id: "one",
      narration: "First narration.",
      screenshot: { id: "shot-one" },
      highlight: { kind: "css", selector: ".a" },
      callout: { text: "look" }
    },
    { id: "two", narration: "Second narration." },
    { id: "three", narration: "Third narration." }
  ]
});

const STEPS: TutorialStepResultV1[] = [
  {
    id: "one",
    status: "passed",
    startedAt: "2026-09-18T12:00:00.000Z",
    endedAt: "2026-09-18T12:00:02.000Z",
    durationMs: 2000,
    timelineStartMs: 0,
    timelineEndMs: 2000,
    action: {
      type: "click",
      status: "passed",
      startedAt: "2026-09-18T12:00:00.100Z",
      endedAt: "2026-09-18T12:00:00.400Z",
      durationMs: 300
    },
    assertions: [
      {
        type: "element-visible",
        status: "passed",
        startedAt: "2026-09-18T12:00:00.500Z",
        endedAt: "2026-09-18T12:00:00.600Z",
        durationMs: 100
      },
      {
        type: "text-equals",
        status: "passed",
        startedAt: "2026-09-18T12:00:00.600Z",
        endedAt: "2026-09-18T12:00:00.700Z",
        durationMs: 100
      }
    ],
    screenshotRequested: true,
    highlightRequested: true,
    calloutRequested: true
  },
  {
    id: "two",
    status: "failed",
    startedAt: "2026-09-18T12:00:02.000Z",
    endedAt: "2026-09-18T12:00:03.000Z",
    durationMs: 1000,
    timelineStartMs: 2000,
    timelineEndMs: 3000,
    assertions: [],
    screenshotRequested: false,
    highlightRequested: false,
    calloutRequested: false,
    error: "assertion failed"
  },
  {
    id: "three",
    status: "not-run",
    assertions: [],
    screenshotRequested: false,
    highlightRequested: false,
    calloutRequested: false
  }
];

const ARTIFACTS: TutorialArtifactRecordV1[] = [
  { kind: "video", status: "written", path: "artifacts/tutorial.webm", sizeBytes: 4096 },
  { kind: "srt", status: "written", path: "artifacts/tutorial.srt", sizeBytes: 120 },
  { kind: "vtt", status: "written", path: "artifacts/tutorial.vtt", sizeBytes: 130 },
  { kind: "markdown", status: "written", path: "artifacts/tutorial.md", sizeBytes: 300 },
  { kind: "screenshot", id: "shot-one", status: "written", path: "screenshots/shot-one.png", sizeBytes: 900 },
  { kind: "stdout-log", id: "viewer", status: "written", path: "logs/processes/viewer.stdout.txt" }
];

function build(overrides: Partial<Parameters<typeof buildTutorialManifest>[0]> = {}): TutorialManifestV1 {
  return buildTutorialManifest({
    scenario: SCENARIO,
    targetContract: minimalTargetContract(),
    run: {
      id: "run-1",
      status: "step-failed",
      startedAt: "2026-09-18T12:00:00.000Z",
      endedAt: "2026-09-18T12:00:04.000Z",
      durationMs: 4000
    },
    steps: STEPS,
    artifacts: ARTIFACTS,
    warnings: ["a warning"],
    cleanupErrors: ["a cleanup error"],
    ...overrides
  });
}

describe("buildTutorialManifest", () => {
  it("uses schema version 1.0.0", () => {
    expect(TUTORIAL_MANIFEST_SCHEMA_VERSION).toBe("1.0.0");
    expect(build().schemaVersion).toBe("1.0.0");
  });

  it("records scenario metadata", () => {
    expect(build().scenario).toEqual({
      schemaVersion: "1.0.0",
      id: "demo-tutorial",
      title: "Demo tutorial",
      description: "A described tutorial.",
      targetId: "demo-target"
    });
  });

  it("records target metadata", () => {
    expect(build().target).toEqual({
      schemaVersion: "1.0.0",
      id: "demo-target",
      applicationUrl: "http://127.0.0.1:3000/"
    });
  });

  it("records run metadata", () => {
    expect(build().run).toEqual({
      id: "run-1",
      status: "step-failed",
      startedAt: "2026-09-18T12:00:00.000Z",
      endedAt: "2026-09-18T12:00:04.000Z",
      durationMs: 4000
    });
  });

  it("populates environment metadata", () => {
    const manifest = build();
    expect(manifest.environment.platform).toBe(process.platform);
    expect(manifest.environment.nodeVersion).toBe(process.version);
  });

  it("keeps steps in scenario order including the not-run step", () => {
    expect(build().steps.map((step) => step.id)).toEqual(["one", "two", "three"]);
    expect(build().steps.map((step) => step.status)).toEqual(["passed", "failed", "not-run"]);
  });

  it("copies narration exactly from the scenario", () => {
    expect(build().steps.map((step) => step.narration)).toEqual([
      "First narration.",
      "Second narration.",
      "Third narration."
    ]);
  });

  it("preserves timeline values only for executed steps", () => {
    const steps = build().steps;
    expect(steps[0]).toMatchObject({ timelineStartMs: 0, timelineEndMs: 2000 });
    expect(steps[2].timelineStartMs).toBeUndefined();
    expect(steps[2].timelineEndMs).toBeUndefined();
  });

  it("preserves action and assertion results in execution order", () => {
    const step = build().steps[0];
    expect(step.action).toMatchObject({ type: "click", status: "passed", durationMs: 300 });
    expect(step.assertions.map((assertion) => assertion.type)).toEqual(["element-visible", "text-equals"]);
  });

  it("records screenshot request, id, status and path", () => {
    expect(build().steps[0].screenshot).toEqual({
      requested: true,
      id: "shot-one",
      status: "written",
      path: "screenshots/shot-one.png"
    });
    expect(build().steps[1].screenshot).toBeUndefined();
  });

  it("records highlight and callout requests", () => {
    const steps = build().steps;
    expect(steps[0]).toMatchObject({ highlightRequested: true, calloutRequested: true });
    expect(steps[1]).toMatchObject({ highlightRequested: false, calloutRequested: false });
  });

  it("lists every artifact record", () => {
    expect(build().artifacts.map((record) => record.kind)).toEqual([
      "video",
      "srt",
      "vtt",
      "markdown",
      "screenshot",
      "stdout-log"
    ]);
  });

  it("stores only run-root-relative POSIX artifact paths", () => {
    for (const record of build().artifacts) {
      if (record.path === undefined) continue;
      expect(record.path).not.toMatch(/^[A-Za-z]:/);
      expect(record.path).not.toMatch(/^\//);
      expect(record.path).not.toContain("\\");
      expect(record.path).not.toContain("C:\\Users");
      expect(record.path).not.toContain("/home/runner");
    }
  });

  it("preserves warnings and cleanup errors", () => {
    expect(build().warnings).toEqual(["a warning"]);
    expect(build().cleanupErrors).toEqual(["a cleanup error"]);
  });

  it("preserves the step error message", () => {
    expect(build().steps[1].error).toBe("assertion failed");
  });
});

describe("renderTutorialManifest", () => {
  it("writes pretty JSON with a single trailing newline", () => {
    const rendered = renderTutorialManifest(build());
    expect(rendered.endsWith("}\n")).toBe(true);
    expect(rendered.endsWith("}\n\n")).toBe(false);
    expect(rendered).toContain('\n  "schemaVersion": "1.0.0"');
    expect(JSON.parse(rendered)).toEqual(build());
  });

  it("is structurally deterministic for the same model", () => {
    const manifest = build();
    expect(renderTutorialManifest(manifest)).toBe(renderTutorialManifest(manifest));
  });
});
