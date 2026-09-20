import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateTutorialScenario } from "../../src/tutorial/scenarioValidation.js";
import { validateTutorialTargetContract } from "../../src/tutorial/targetContractValidation.js";
import { resolveTutorialNavigationUrl } from "../../src/tutorial/tutorialActions.js";
import { executeTutorialAssertion, resolveAssertionRequestUrl } from "../../src/tutorial/tutorialAssertions.js";
import { resolveTargetFilePath } from "../../src/tutorial/tutorialPaths.js";
import { buildTutorialRunPaths } from "../../src/tutorial/tutorialPaths.js";
import {
  TUTORIAL_ACTION_TYPES,
  TUTORIAL_ASSERTION_TYPES,
  TUTORIAL_LOCATOR_KINDS
} from "../../src/tutorial/types.js";
import { createFakePage, minimalScenario, minimalTargetContract } from "./tutorialTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tutorial-security-"));
  tempDirs.push(dir);
  return dir;
}

const APP_URL = "http://127.0.0.1:3000/";

describe("scenario navigation cannot leave the application origin", () => {
  it("rejects every cross-origin navigation form at validation time", () => {
    for (const target of [
      "http://evil.example.com/",
      "https://evil.example.com/",
      "//evil.example.com/",
      "file:///etc/passwd",
      "javascript:fetch('http://evil.example.com')",
      "data:text/html,<script>1</script>"
    ]) {
      const result = validateTutorialScenario(
        minimalScenario({ steps: [{ id: "s", narration: "n", action: { type: "goto", path: target } }] })
      );
      expect(result.ok).toBe(false);
    }
  });

  it("rejects the same forms again at navigation time", () => {
    for (const target of ["http://evil.example.com/", "//evil.example.com/", "https://127.0.0.1:3000/"]) {
      expect(() => resolveTutorialNavigationUrl(APP_URL, target)).toThrow();
    }
  });

  it("keeps a legitimate root-relative path on the application origin", () => {
    expect(new URL(resolveTutorialNavigationUrl(APP_URL, "/deep/path?x=1")).origin).toBe("http://127.0.0.1:3000");
  });
});

describe("HTTP assertions cannot leave the application origin", () => {
  it("rejects absolute and protocol-relative assertion paths", () => {
    for (const target of ["http://example.com/api", "//example.com/api", "https://example.com/api"]) {
      expect(() => resolveAssertionRequestUrl(APP_URL, target)).toThrow();
    }
  });

  it("rejects an absolute assertion path during validation", () => {
    const result = validateTutorialScenario(
      minimalScenario({
        steps: [
          {
            id: "s",
            narration: "n",
            assertions: [{ type: "http-json-equals", path: "http://example.com/api", pointer: "/ok", expected: true }]
          }
        ]
      })
    );
    expect(result.ok).toBe(false);
  });
});

describe("the application origin must be loopback", () => {
  it("rejects a public applicationUrl and a public readiness url", () => {
    expect(validateTutorialTargetContract(minimalTargetContract({ applicationUrl: "http://example.com/" })).ok).toBe(
      false
    );
    const contract = minimalTargetContract();
    contract.processes[0].readiness = { kind: "http", url: "http://example.com/", timeoutMs: 1000 };
    expect(validateTutorialTargetContract(contract).ok).toBe(false);
  });
});

describe("file assertions cannot escape targetRoot", () => {
  it("rejects traversal, absolute and drive-qualified paths", async () => {
    const targetRoot = makeTempDir();
    const outsideDir = makeTempDir();
    writeFileSync(path.join(outsideDir, "secret.json"), JSON.stringify({ secret: true }), "utf8");

    for (const attempt of ["../secret.json", "a/../../secret.json", "C:evil.json"]) {
      expect(() => resolveTargetFilePath(targetRoot, attempt)).toThrow();
    }
    expect(() => resolveTargetFilePath(targetRoot, path.join(outsideDir, "secret.json"))).toThrow();

    // Reaching the same conclusion through the real assertion surface.
    const result = await executeTutorialAssertion(
      createFakePage(),
      { type: "json-file-equals", path: "../secret.json", pointer: "/secret", expected: true },
      { applicationUrl: APP_URL, targetRoot }
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("escapes targetRoot");
  });
});

describe("target contracts cannot express shell execution", () => {
  it("rejects every shell-shaped field", () => {
    for (const field of ["shell", "commandString", "script", "javascript", "eval", "command"]) {
      const contract = { ...minimalTargetContract(), [field]: "anything" } as unknown;
      expect(validateTutorialTargetContract(contract).ok).toBe(false);
    }
  });

  it("rejects an unsupported placeholder anywhere it could be substituted", () => {
    for (const placeholder of ["{{cwd}}", "{{shell}}", "{{env:PATH}}", "{{command}}"]) {
      expect(
        validateTutorialTargetContract(
          minimalTargetContract({ prepare: { executable: "node", args: [placeholder] } })
        ).ok
      ).toBe(false);
    }
  });

  it("keeps arguments structural rather than a single interpolated string", () => {
    const result = validateTutorialTargetContract(minimalTargetContract());
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(Array.isArray(result.value.prepare.args)).toBe(true);
    expect(Array.isArray(result.value.processes[0].args)).toBe(true);
    // No field exists anywhere in the contract type that would carry a command line.
    expect(Object.keys(result.value.prepare).sort()).toEqual(["args", "executable"]);
  });
});

describe("scenarios cannot express JavaScript execution", () => {
  it("has no evaluate-style action, assertion or locator in the closed unions", () => {
    for (const forbidden of ["evaluate", "javascript", "script", "shell", "exec", "command", "eval"]) {
      expect(TUTORIAL_ACTION_TYPES as readonly string[]).not.toContain(forbidden);
      expect(TUTORIAL_ASSERTION_TYPES as readonly string[]).not.toContain(forbidden);
      expect(TUTORIAL_LOCATOR_KINDS as readonly string[]).not.toContain(forbidden);
    }
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
    expect([...TUTORIAL_ASSERTION_TYPES]).toEqual([
      "element-visible",
      "text-equals",
      "text-contains",
      "url-path-equals",
      "attribute-equals",
      "http-json-equals",
      "json-file-equals",
      "file-exists"
    ]);
    expect([...TUTORIAL_LOCATOR_KINDS]).toEqual(["role", "text", "css", "test-id"]);
  });

  it("rejects a scenario that tries to smuggle a script field into a step", () => {
    expect(
      validateTutorialScenario(
        minimalScenario({ steps: [{ id: "s", narration: "n", script: "alert(1)" } as never] })
      ).ok
    ).toBe(false);
  });

  it("keeps pointer-drag locator-anchored and rejects page/screen/script/event controls", () => {
    const base = {
      type: "pointer-drag",
      locator: { kind: "css", selector: "#surface" },
      from: { x: 0.1, y: 0.2 },
      to: { x: 0.8, y: 0.9 },
      coordinateSpace: "fraction"
    };
    for (const field of [
      "pageX",
      "pageY",
      "screenX",
      "screenY",
      "javascript",
      "script",
      "event",
      "eventType",
      "button",
      "pointerType",
      "steps"
    ]) {
      const action = { ...base, [field]: field === "steps" ? 8 : "forbidden" };
      expect(
        validateTutorialScenario(
          minimalScenario({ steps: [{ id: "s", narration: "n", action: action as never }] })
        ).ok
      ).toBe(false);
    }
  });

  it("keeps select-option value-only and rejects script/event/DOM-mutation controls", () => {
    const base = {
      type: "select-option",
      locator: { kind: "css", selector: "#op" },
      value: "preserve"
    };
    for (const field of [
      "script",
      "evaluate",
      "javascript",
      "shell",
      "command",
      "dispatchEvent",
      "event",
      "eventType",
      "eventInit",
      "property",
      "propertyValue",
      "url"
    ]) {
      const action = { ...base, [field]: "forbidden" };
      expect(
        validateTutorialScenario(
          minimalScenario({ steps: [{ id: "s", narration: "n", action: action as never }] })
        ).ok
      ).toBe(false);
    }
  });

  it("rejects page-coordinate-shaped pointer endpoints instead of treating them as fractions", () => {
    const result = validateTutorialScenario(
      minimalScenario({
        steps: [{
          id: "s",
          narration: "n",
          action: {
            type: "pointer-drag",
            locator: { kind: "css", selector: "#surface" },
            from: { pageX: 100, pageY: 100 },
            to: { pageX: 200, pageY: 200 },
            coordinateSpace: "fraction"
          } as never
        }]
      })
    );
    expect(result.ok).toBe(false);
  });
});

describe("the target source is never the default output location", () => {
  it("places the default run root under the workspace, not the contract directory", () => {
    const contractRoot = makeTempDir();
    const workspaceRoot = makeTempDir();
    const paths = buildTutorialRunPaths({
      workspaceRoot,
      invocationCwd: contractRoot,
      scenarioId: "demo-tutorial",
      runId: "run-1"
    });

    expect(paths.runRoot.startsWith(path.resolve(workspaceRoot))).toBe(true);
    expect(path.relative(contractRoot, paths.runRoot).startsWith("..")).toBe(true);
    expect(readdirSync(contractRoot)).toEqual([]);
  });
});
