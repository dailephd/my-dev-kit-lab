import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeWarmIndexReuse } from "../../../src/experiments/plugins/warmIndexReuse/execution.js";
import { makeCase, writeGraphFakeKit } from "./warmIndexTestHelpers.js";

// Forces the defensive session/target identity check to fail after a session was prepared.
vi.mock("../../../src/experiments/plugins/warmIndexReuse/warmIndexSession.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/experiments/plugins/warmIndexReuse/warmIndexSession.js")>();
  return {
    ...actual,
    assertWarmIndexSessionMatchesTarget: () => {
      throw new Error("forced target mismatch");
    },
  };
});

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("warm-index affected-neighborhood on session/target identity failure", () => {
  // TST-B3-006
  it("performs no assessment and keeps the existing mismatch behavior", async () => {
    const targetRoot = path.join(tempDir("warm-an-mm-target-"), "target");
    mkdirSync(path.join(targetRoot, "src"), { recursive: true });
    writeFileSync(path.join(targetRoot, "src", "a.ts"), "export const alpha = 1;\n");
    const kit = writeGraphFakeKit(tempDir("warm-an-mm-kit-"), { symbols: { "src/a.ts": ["alpha"] } });
    const evaluationCase = makeCase({
      id: "mm-1",
      benchmarkProject: "todo-ts",
      targetRoot,
      absoluteTargetRoot: targetRoot,
      sourceRoots: ["src"],
      rawIncludeGlobs: ["src/**/*"],
      expectedFiles: ["src/a.ts"],
      expectedSymbols: ["alpha"],
    });

    const [project] = await executeWarmIndexReuse({ cases: [evaluationCase], kitCommand: kit.command, outputRoot: tempDir("warm-an-mm-out-") });
    const [task] = project.tasks;

    expect(project.session).toBeDefined();
    expect(task.affectedNeighborhood).toBeNull();
    expect(task.indexFreshness).toBeUndefined();
    expect(task.warmRetrieval).toBeUndefined();
    expect(task.warmStatus).toBe("failed");
    expect(task.errors.map((error) => error.code)).toEqual(["warm-session-target-mismatch"]);
    expect(task.rawStatus).toBe("completed");
  });
});
