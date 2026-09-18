import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildTutorialRunPaths,
  createTutorialRunDirectories,
  generateTutorialRunId,
  resolveTargetFilePath
} from "../../src/tutorial/tutorialPaths.js";
import { validateTutorialScenario } from "../../src/tutorial/scenarioValidation.js";
import { minimalScenario } from "./tutorialTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const BASE = {
  workspaceRoot: path.join(path.sep === "\\" ? "C:\\lab-workspace" : "/lab-workspace"),
  invocationCwd: path.join(path.sep === "\\" ? "C:\\projects\\caller" : "/projects/caller"),
  scenarioId: "demo-tutorial",
  runId: "20260918t120000z-abcd1234"
};

describe("buildTutorialRunPaths", () => {
  it("uses the workspace tutorial layout when --out is omitted", () => {
    const paths = buildTutorialRunPaths(BASE);
    expect(paths.runRoot).toBe(
      path.join(BASE.workspaceRoot, "tutorials", BASE.scenarioId, BASE.runId)
    );
  });

  it("uses an absolute --out exactly as given", () => {
    const explicit = path.sep === "\\" ? "D:\\explicit\\run" : "/explicit/run";
    const paths = buildTutorialRunPaths({ ...BASE, outDir: explicit });
    expect(paths.runRoot).toBe(path.resolve(explicit));
    // Explicit output is never relocated beneath the workspace.
    expect(paths.runRoot.startsWith(BASE.workspaceRoot)).toBe(false);
  });

  it("resolves a relative --out against invocationCwd, not the workspace", () => {
    const paths = buildTutorialRunPaths({ ...BASE, outDir: "out/tutorial" });
    expect(paths.runRoot).toBe(path.resolve(BASE.invocationCwd, "out/tutorial"));
  });

  it("places every declared root beneath runRoot", () => {
    const paths = buildTutorialRunPaths(BASE);
    for (const child of [
      paths.targetRoot,
      paths.artifactsRoot,
      paths.screenshotsRoot,
      paths.logsRoot,
      paths.temporaryRoot
    ]) {
      const relative = path.relative(paths.runRoot, child);
      expect(relative).not.toBe("");
      expect(relative.startsWith("..")).toBe(false);
      expect(path.isAbsolute(relative)).toBe(false);
    }
    expect(path.basename(paths.targetRoot)).toBe("target");
    expect(path.basename(paths.artifactsRoot)).toBe("artifacts");
    expect(path.basename(paths.screenshotsRoot)).toBe("screenshots");
    expect(path.basename(paths.logsRoot)).toBe("logs");
    expect(path.basename(paths.temporaryRoot)).toBe("temporary");
  });

  it("creates the reserved run layout on disk", async () => {
    const runRoot = path.join(makeTempDir("tutorial-paths-"), "run");
    const paths = buildTutorialRunPaths({ ...BASE, outDir: runRoot });
    await createTutorialRunDirectories(paths);
    for (const directory of [
      paths.runRoot,
      paths.artifactsRoot,
      paths.screenshotsRoot,
      paths.logsRoot,
      paths.temporaryRoot
    ]) {
      expect((await stat(directory)).isDirectory()).toBe(true);
    }
  });

  it("cannot be influenced by an unsafe scenario id because validation rejects it", () => {
    for (const unsafe of ["../escape", "a/b", "..", "C:evil"]) {
      const result = validateTutorialScenario(minimalScenario({ id: unsafe }));
      expect(result.ok).toBe(false);
    }
  });
});

describe("generateTutorialRunId", () => {
  it("produces a distinct, path-safe single segment", () => {
    const first = generateTutorialRunId(new Date("2026-09-18T12:00:00.000Z"));
    const second = generateTutorialRunId(new Date("2026-09-18T12:00:00.000Z"));
    expect(first).not.toBe(second);
    for (const id of [first, second]) {
      expect(id).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
      expect(path.basename(id)).toBe(id);
    }
  });
});

describe("resolveTargetFilePath", () => {
  it("accepts a normal relative path beneath the target root", () => {
    const targetRoot = makeTempDir("tutorial-target-");
    const resolved = resolveTargetFilePath(targetRoot, "out/report.json");
    expect(resolved).toBe(path.join(targetRoot, "out", "report.json"));
  });

  it("accepts a nested relative path that stays inside after normalization", () => {
    const targetRoot = makeTempDir("tutorial-target-");
    const resolved = resolveTargetFilePath(targetRoot, "out/../out/report.json");
    expect(resolved).toBe(path.join(targetRoot, "out", "report.json"));
  });

  it("rejects parent traversal", () => {
    const targetRoot = makeTempDir("tutorial-target-");
    expect(() => resolveTargetFilePath(targetRoot, "../secret.json")).toThrow(/escapes targetRoot/);
    expect(() => resolveTargetFilePath(targetRoot, "out/../../secret.json")).toThrow(/escapes targetRoot/);
  });

  it("rejects an absolute path even when it points inside the root", () => {
    const targetRoot = makeTempDir("tutorial-target-");
    expect(() => resolveTargetFilePath(targetRoot, path.join(targetRoot, "inside.json"))).toThrow(
      /must be relative to targetRoot/
    );
    expect(() => resolveTargetFilePath(targetRoot, "/etc/hosts")).toThrow(/must be relative to targetRoot/);
  });

  it("rejects a Windows drive-qualified path", () => {
    const targetRoot = makeTempDir("tutorial-target-");
    expect(() => resolveTargetFilePath(targetRoot, "C:\\Windows\\win.ini")).toThrow(
      /must be relative to targetRoot|drive-qualified/
    );
    expect(() => resolveTargetFilePath(targetRoot, "C:relative.json")).toThrow(/drive-qualified/);
  });

  it("rejects an empty path", () => {
    const targetRoot = makeTempDir("tutorial-target-");
    expect(() => resolveTargetFilePath(targetRoot, "")).toThrow(/non-empty/);
    expect(() => resolveTargetFilePath(targetRoot, "   ")).toThrow(/non-empty/);
  });

  // A string-prefix containment check would wrongly accept "<root>-sibling".
  it("does not treat a sibling directory sharing a name prefix as contained", () => {
    const parent = makeTempDir("tutorial-sibling-");
    const targetRoot = path.join(parent, "target");
    const sibling = path.join(parent, "target-other");
    mkdirSync(targetRoot, { recursive: true });
    mkdirSync(sibling, { recursive: true });
    writeFileSync(path.join(sibling, "leak.json"), "{}", "utf8");

    expect(() => resolveTargetFilePath(targetRoot, "../target-other/leak.json")).toThrow(/escapes targetRoot/);
  });
});
