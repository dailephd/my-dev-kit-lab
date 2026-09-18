import { describe, expect, it } from "vitest";
import { validateTutorialScenario } from "../../src/tutorial/scenarioValidation.js";
import { MAX_STEP_PAUSE_MS } from "../../src/tutorial/types.js";
import { minimalScenario } from "./tutorialTestHelpers.js";

function expectInvalid(value: unknown, fragment: string): string[] {
  const result = validateTutorialScenario(value, "scenario.json");
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected invalid");
  const joined = result.errors.join("\n");
  expect(joined).toContain(fragment);
  return result.errors;
}

describe("validateTutorialScenario", () => {
  it("accepts a minimal valid scenario", () => {
    const result = validateTutorialScenario(minimalScenario());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.value.steps).toHaveLength(1);
  });

  it("accepts a full scenario using every declaration kind", () => {
    const scenario = minimalScenario({
      description: "A complete scenario.",
      steps: [
        {
          id: "open",
          narration: "Open the dashboard.",
          pauseBeforeMs: 100,
          pauseAfterMs: 250,
          action: { type: "goto", path: "/dashboard", waitUntil: "networkidle" },
          highlight: { kind: "test-id", testId: "dashboard" },
          callout: { text: "This is the dashboard.", locator: { kind: "css", selector: "#main" }, placement: "top" },
          screenshot: { id: "dashboard-open", fullPage: true },
          assertions: [
            { type: "element-visible", locator: { kind: "role", role: "heading", name: "Dashboard", exact: true } },
            { type: "text-equals", locator: { kind: "text", text: "Dashboard", exact: false }, expected: "Dashboard" },
            { type: "text-contains", locator: { kind: "css", selector: "#main" }, expected: "Dash" },
            { type: "url-path-equals", expected: "/dashboard" },
            { type: "attribute-equals", locator: { kind: "css", selector: "#main" }, name: "data-state", expected: "ready" },
            { type: "http-json-equals", path: "/api/status", pointer: "/ok", expected: true, timeoutMs: 1000 },
            { type: "json-file-equals", path: "out/report.json", pointer: "/count", expected: 3 },
            { type: "file-exists", path: "out/report.json" }
          ]
        },
        {
          id: "interact",
          narration: "Interact with the form.",
          action: { type: "fill", locator: { kind: "test-id", testId: "name" }, value: "Ada", timeoutMs: 2000 }
        },
        { id: "drag-step", narration: "Drag it.", action: { type: "drag", source: { kind: "css", selector: ".a" }, target: { kind: "css", selector: ".b" } } },
        { id: "press-step", narration: "Press enter.", action: { type: "press", locator: { kind: "css", selector: ".a" }, key: "Enter" } },
        { id: "hover-step", narration: "Hover it.", action: { type: "hover", locator: { kind: "css", selector: ".a" } } },
        { id: "wait-step", narration: "Wait for it.", action: { type: "wait-for", locator: { kind: "css", selector: ".a" }, state: "hidden" } },
        { id: "click-step", narration: "Click it.", action: { type: "click", locator: { kind: "css", selector: ".a" } } }
      ]
    });

    const result = validateTutorialScenario(scenario);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.value.steps).toHaveLength(7);
  });

  it("rejects a missing schemaVersion", () => {
    const scenario = minimalScenario();
    delete (scenario as Record<string, unknown>).schemaVersion;
    expectInvalid(scenario, "missing required schemaVersion");
  });

  it("rejects an unsupported schemaVersion, including another minor", () => {
    expectInvalid(minimalScenario({ schemaVersion: "1.1.0" as never }), "unsupported schemaVersion");
    expectInvalid(minimalScenario({ schemaVersion: "2.0.0" as never }), "unsupported schemaVersion");
    expectInvalid(minimalScenario({ schemaVersion: "not-a-version" as never }), "unsupported schemaVersion");
  });

  it("rejects an empty or malformed scenario id", () => {
    expectInvalid(minimalScenario({ id: "" }), "id");
    expectInvalid(minimalScenario({ id: "Has Spaces" }), "must match");
    expectInvalid(minimalScenario({ id: "../escape" }), "must match");
    expectInvalid(minimalScenario({ id: "UPPER" }), "must match");
  });

  it("rejects an empty title", () => {
    expectInvalid(minimalScenario({ title: "   " }), "non-empty title");
  });

  it("rejects an empty or malformed targetId", () => {
    expectInvalid(minimalScenario({ targetId: "" }), "targetId");
    expectInvalid(minimalScenario({ targetId: "Bad Id" }), "must match");
  });

  it("rejects a scenario with no steps", () => {
    expectInvalid(minimalScenario({ steps: [] }), "at least one step");
  });

  it("rejects duplicate step ids", () => {
    expectInvalid(
      minimalScenario({
        steps: [
          { id: "same", narration: "one" },
          { id: "same", narration: "two" }
        ]
      }),
      "duplicate step id"
    );
  });

  it("rejects duplicate screenshot ids across steps", () => {
    expectInvalid(
      minimalScenario({
        steps: [
          { id: "one", narration: "one", screenshot: { id: "shot" } },
          { id: "two", narration: "two", screenshot: { id: "shot" } }
        ]
      }),
      "duplicate screenshot id"
    );
  });

  it("rejects narration that is empty after trimming", () => {
    expectInvalid(minimalScenario({ steps: [{ id: "one", narration: "   " }] }), "non-empty narration");
  });

  it("rejects negative and over-limit pauses", () => {
    expectInvalid(
      minimalScenario({ steps: [{ id: "one", narration: "n", pauseBeforeMs: -1 }] }),
      "non-negative integer"
    );
    expectInvalid(
      minimalScenario({ steps: [{ id: "one", narration: "n", pauseAfterMs: MAX_STEP_PAUSE_MS + 1 }] }),
      `at most ${MAX_STEP_PAUSE_MS}ms`
    );
    expectInvalid(
      minimalScenario({ steps: [{ id: "one", narration: "n", pauseBeforeMs: Number.NaN }] }),
      "non-negative integer"
    );
  });

  it("rejects viewports outside the supported bounds", () => {
    expectInvalid(minimalScenario({ browser: { viewport: { width: 100, height: 720 } } }), "between 320 and 3840");
    expectInvalid(minimalScenario({ browser: { viewport: { width: 5000, height: 720 } } }), "between 320 and 3840");
    expectInvalid(minimalScenario({ browser: { viewport: { width: 1280, height: 100 } } }), "between 240 and 2160");
    expectInvalid(minimalScenario({ browser: { viewport: { width: 1280, height: 5000 } } }), "between 240 and 2160");
  });

  it("rejects an unknown action type", () => {
    expectInvalid(
      minimalScenario({
        steps: [{ id: "one", narration: "n", action: { type: "evaluate", script: "alert(1)" } as never }]
      }),
      'unsupported action "evaluate"'
    );
  });

  it("rejects an unknown assertion type", () => {
    expectInvalid(
      minimalScenario({
        steps: [{ id: "one", narration: "n", assertions: [{ type: "eval-equals" } as never] }]
      }),
      'unsupported assertion "eval-equals"'
    );
  });

  it("rejects an unknown locator kind", () => {
    expectInvalid(
      minimalScenario({
        steps: [
          {
            id: "one",
            narration: "n",
            action: { type: "click", locator: { kind: "xpath", expression: "//div" } as never }
          }
        ]
      }),
      "unsupported locator kind"
    );
  });

  it("rejects an invalid highlight declaration", () => {
    expectInvalid(
      minimalScenario({ steps: [{ id: "one", narration: "n", highlight: { kind: "css", selector: "" } }] }),
      "non-empty CSS selector"
    );
  });

  it("rejects an invalid callout declaration", () => {
    expectInvalid(
      minimalScenario({ steps: [{ id: "one", narration: "n", callout: { text: "" } }] }),
      "non-empty callout text"
    );
    expectInvalid(
      minimalScenario({
        steps: [{ id: "one", narration: "n", callout: { text: "ok", placement: "diagonal" as never } }]
      }),
      "auto, top, right, bottom, left"
    );
  });

  it("rejects an invalid screenshot declaration", () => {
    expectInvalid(
      minimalScenario({ steps: [{ id: "one", narration: "n", screenshot: { id: "Bad Id" } }] }),
      "must match"
    );
    expectInvalid(
      minimalScenario({ steps: [{ id: "one", narration: "n", screenshot: { id: "ok", fullPage: "yes" as never } }] }),
      "expected a boolean"
    );
  });

  it("rejects absolute and scheme-qualified goto targets", () => {
    for (const target of [
      "http://evil.example.com/",
      "https://evil.example.com/",
      "file:///etc/hosts",
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>"
    ]) {
      expectInvalid(
        minimalScenario({ steps: [{ id: "one", narration: "n", action: { type: "goto", path: target } }] }),
        "root-relative path"
      );
    }
  });

  it("rejects a protocol-relative goto target", () => {
    expectInvalid(
      minimalScenario({ steps: [{ id: "one", narration: "n", action: { type: "goto", path: "//evil.example.com/x" } }] }),
      "protocol-relative paths are not allowed"
    );
  });

  it("rejects invalid action timeouts", () => {
    for (const timeoutMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expectInvalid(
        minimalScenario({
          steps: [
            { id: "one", narration: "n", action: { type: "click", locator: { kind: "css", selector: ".a" }, timeoutMs } }
          ]
        }),
        "finite positive integer"
      );
    }
  });

  it("rejects unknown fields rather than ignoring them", () => {
    expectInvalid(minimalScenario({ shell: "rm -rf /" } as never), "unknown field");
    expectInvalid(
      minimalScenario({ steps: [{ id: "one", narration: "n", script: "alert(1)" } as never] }),
      "unknown field"
    );
  });

  it("rejects a malformed JSON Pointer escape in an assertion", () => {
    expectInvalid(
      minimalScenario({
        steps: [
          {
            id: "one",
            narration: "n",
            assertions: [{ type: "json-file-equals", path: "a.json", pointer: "/a~2b", expected: 1 }]
          }
        ]
      }),
      "malformed JSON Pointer escape"
    );
  });
});
