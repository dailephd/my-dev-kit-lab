import { describe, expect, it } from "vitest";
import { validateTutorialScenario } from "../../src/tutorial/scenarioValidation.js";
import { MAX_STEP_PAUSE_MS, TUTORIAL_ACTION_TYPES } from "../../src/tutorial/types.js";
import { minimalScenario } from "./tutorialTestHelpers.js";

function expectInvalid(value: unknown, fragment: string): string[] {
  const result = validateTutorialScenario(value, "scenario.json");
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected invalid");
  const joined = result.errors.join("\n");
  expect(joined).toContain(fragment);
  return result.errors;
}

function scenarioWithAction(action: unknown) {
  return minimalScenario({
    steps: [{ id: "pointer", narration: "Use the pointer.", action: action as never }]
  });
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
        { id: "click-step", narration: "Click it.", action: { type: "click", locator: { kind: "css", selector: ".a" } } },
        { id: "select-step", narration: "Choose an option.", action: { type: "select-option", locator: { kind: "css", selector: "#op" }, value: "preserve" } }
      ]
    });

    const result = validateTutorialScenario(scenario);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.value.steps).toHaveLength(8);
  });

  it("exposes the complete supported action set in stable order", () => {
    expect([...TUTORIAL_ACTION_TYPES]).toEqual([
      "goto",
      "click",
      "fill",
      "press",
      "hover",
      "drag",
      "select-option",
      "wait-for",
      "pointer-click",
      "pointer-drag"
    ]);
  });

  describe("pointer-click", () => {
    const valid = {
      type: "pointer-click",
      locator: { kind: "css", selector: "#surface" },
      position: { x: 0.25, y: 0.5 },
      coordinateSpace: "fraction"
    };

    it.each([
      [{ x: 0.25, y: 0.5 }, "interior"],
      [{ x: 0, y: 0.5 }, "x=0"],
      [{ x: 0.5, y: 0 }, "y=0"],
      [{ x: 1, y: 0.5 }, "x=1"],
      [{ x: 0.5, y: 1 }, "y=1"]
    ])("accepts %s", (position) => {
      expect(validateTutorialScenario(scenarioWithAction({ ...valid, position })).ok).toBe(true);
    });

    it.each([
      [{ x: -0.01, y: 0.5 }, "negative x"],
      [{ x: 0.5, y: -0.01 }, "negative y"],
      [{ x: 1.01, y: 0.5 }, "x above one"],
      [{ x: 0.5, y: 1.01 }, "y above one"],
      [{ x: Number.NaN, y: 0.5 }, "NaN"],
      [{ x: Number.POSITIVE_INFINITY, y: 0.5 }, "Infinity"]
    ])("rejects %s", (position) => {
      expectInvalid(scenarioWithAction({ ...valid, position }), "inclusive bounds [0, 1]");
    });

    it.each([
      ["locator", "locator"],
      ["position", "position"],
      ["coordinateSpace", "coordinateSpace"]
    ])("rejects a missing %s", (field, fragment) => {
      const action = { ...valid } as Record<string, unknown>;
      delete action[field];
      expectInvalid(scenarioWithAction(action), fragment);
    });

    it("rejects coordinate spaces other than fraction", () => {
      expectInvalid(scenarioWithAction({ ...valid, coordinateSpace: "page" }), 'expected "fraction"');
    });

    it("rejects unknown action and point fields", () => {
      expectInvalid(scenarioWithAction({ ...valid, pageX: 100 }), "unknown field");
      expectInvalid(scenarioWithAction({ ...valid, position: { x: 0.5, y: 0.5, z: 0 } }), "unknown field");
    });

    it("rejects an invalid timeout", () => {
      expectInvalid(scenarioWithAction({ ...valid, timeoutMs: 0 }), "finite positive integer");
    });
  });

  describe("pointer-drag", () => {
    const valid = {
      type: "pointer-drag",
      locator: { kind: "test-id", testId: "surface" },
      from: { x: 0.25, y: 0.25 },
      to: { x: 0.75, y: 0.75 },
      coordinateSpace: "fraction"
    };

    it.each([
      [valid, "distinct interior endpoints"],
      [{ ...valid, from: { x: 0, y: 0 }, to: { x: 0.5, y: 0.5 } }, "zero boundary"],
      [{ ...valid, from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 1 } }, "one boundary"],
      [{ ...valid, to: { x: 0.75, y: 0.25 } }, "only x changes"],
      [{ ...valid, to: { x: 0.25, y: 0.75 } }, "only y changes"]
    ])("accepts %s", (action) => {
      expect(validateTutorialScenario(scenarioWithAction(action)).ok).toBe(true);
    });

    it.each([
      [{ x: -0.01, y: 0.25 }, "negative"],
      [{ x: 1.01, y: 0.25 }, "above one"],
      [{ x: Number.NEGATIVE_INFINITY, y: 0.25 }, "non-finite"]
    ])("rejects a %s coordinate", (from) => {
      expectInvalid(scenarioWithAction({ ...valid, from }), "inclusive bounds [0, 1]");
    });

    it.each([
      ["locator", "locator"],
      ["from", "from"],
      ["to", "to"],
      ["coordinateSpace", "coordinateSpace"]
    ])("rejects a missing %s", (field, fragment) => {
      const action = { ...valid } as Record<string, unknown>;
      delete action[field];
      expectInvalid(scenarioWithAction(action), fragment);
    });

    it("rejects an invalid coordinate space", () => {
      expectInvalid(scenarioWithAction({ ...valid, coordinateSpace: "screen" }), 'expected "fraction"');
    });

    it("rejects identical endpoints", () => {
      expectInvalid(scenarioWithAction({ ...valid, to: { ...valid.from } }), "zero-length drags");
    });

    it("rejects unknown fields", () => {
      expectInvalid(scenarioWithAction({ ...valid, steps: 8 }), "unknown field");
    });

    it("rejects an invalid timeout", () => {
      expectInvalid(scenarioWithAction({ ...valid, timeoutMs: 1.5 }), "finite positive integer");
    });
  });

  describe("select-option", () => {
    const valid = {
      type: "select-option",
      locator: { kind: "role", role: "combobox", name: "Operation" },
      value: "preserve"
    };

    it("accepts a locator plus one non-empty option value", () => {
      const result = validateTutorialScenario(scenarioWithAction(valid));
      if (!result.ok) throw new Error(result.errors.join("\n"));
      expect(result.value.steps[0].action).toEqual(valid);
    });

    it("accepts an explicit timeout", () => {
      expect(validateTutorialScenario(scenarioWithAction({ ...valid, timeoutMs: 1234 })).ok).toBe(true);
    });

    it("rejects a missing locator", () => {
      const action = { ...valid } as Record<string, unknown>;
      delete action.locator;
      expectInvalid(scenarioWithAction(action), "locator");
    });

    it("rejects a missing value", () => {
      const action = { ...valid } as Record<string, unknown>;
      delete action.value;
      expectInvalid(scenarioWithAction(action), "non-empty option value");
    });

    it.each([
      ["", "empty string"],
      ["   ", "whitespace only"]
    ])("rejects a value that is %s", (value) => {
      expectInvalid(scenarioWithAction({ ...valid, value }), "non-empty option value");
    });

    it.each<[unknown, string]>([
      [42, "number"],
      [null, "null"],
      [["preserve"], "array"]
    ])("rejects a non-string value (%s)", (value) => {
      expectInvalid(scenarioWithAction({ ...valid, value }), "non-empty option value");
    });

    // Label, index and multi-select are the selection modes v0.4.9 deliberately
    // does not express; each must fail as an unknown field rather than be
    // ignored, so a scenario cannot half-declare an unsupported mode.
    it.each<[Record<string, unknown>, string]>([
      [{ label: "Preserve" }, "label"],
      [{ index: 3 }, "index"],
      [{ values: ["preserve"] }, "values array"],
      [{ script: "alert(1)" }, "script"],
      [{ evaluate: "() => 1" }, "evaluate"],
      [{ dispatchEvent: "change" }, "dispatchEvent"]
    ])("rejects the unsupported field %s", (extra) => {
      expectInvalid(scenarioWithAction({ ...valid, ...extra }), "unknown field");
    });

    it("rejects label even when a valid value is also present", () => {
      const errors = expectInvalid(
        scenarioWithAction({ ...valid, value: "preserve", label: "Preserve" }),
        "unknown field"
      );
      expect(errors.join("\n")).toContain("label");
    });

    it("rejects a value-less selector-only action", () => {
      expectInvalid(
        scenarioWithAction({ type: "select-option", locator: valid.locator, index: 0 }),
        "unknown field"
      );
    });

    it.each<[unknown, string]>([
      [0, "zero"],
      [-1, "negative"],
      [1.5, "non-integer"],
      [Number.NaN, "NaN"],
      [Number.POSITIVE_INFINITY, "Infinity"],
      ["1000", "string"]
    ])("rejects an invalid timeout (%s)", (timeoutMs) => {
      expectInvalid(scenarioWithAction({ ...valid, timeoutMs }), "finite positive integer");
    });
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
