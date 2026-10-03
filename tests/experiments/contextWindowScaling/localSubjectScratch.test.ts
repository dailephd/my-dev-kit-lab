import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalSubjectExecutionError } from "../../../src/experiments/plugins/contextWindowScaling/localSubjectErrors.js";
import {
  assertWorkRootOutsideTarget,
  createPrivateScratch,
  removePrivateScratch,
} from "../../../src/experiments/plugins/contextWindowScaling/localSubjectScratch.js";
import { makeTempDir, removeTempDir, tryCreateSymlink } from "../../evaluation/localRepositorySubject/fixtureRepository.js";

let target: string;
let area: string;
beforeEach(() => {
  target = makeTempDir("lrs-scratch-target-");
  area = makeTempDir("lrs-scratch-area-");
});
afterEach(() => {
  removeTempDir(target);
  removeTempDir(area);
});

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LocalSubjectExecutionError);
    return (error as LocalSubjectExecutionError).code;
  }
  return "none";
}

describe("RSP-015 work root containment helpers", () => {
  it("rejects equal, nested, and not-yet-existing nested work roots without writing", async () => {
    for (const workRoot of [target, path.join(target, "a"), path.join(target, "a", "b", "c")]) {
      expect(await code(assertWorkRootOutsideTarget(workRoot, target))).toBe("WORK_ROOT_INSIDE_TARGET");
    }
    expect(readdirSync(target)).toEqual([]);
  });

  it("accepts siblings, parents of the target, and not-yet-existing outside work roots", async () => {
    for (const workRoot of [area, path.join(area, "new", "nested"), path.dirname(target)]) {
      expect(await code(assertWorkRootOutsideTarget(workRoot, target))).toBe("none");
    }
  });

  it("rejects a work root that reaches the target through a link", async () => {
    const link = path.join(area, "link-to-target");
    const created = tryCreateSymlink(target, link, "dir");
    if (!created.ok) {
      console.warn(`skipping: ${created.reason}`);
      return;
    }
    expect(await code(assertWorkRootOutsideTarget(link, target))).toBe("WORK_ROOT_INSIDE_TARGET");
    expect(await code(assertWorkRootOutsideTarget(path.join(link, "child"), target))).toBe("WORK_ROOT_INSIDE_TARGET");
    expect(await code(createPrivateScratch(link, target))).toBe("WORK_ROOT_INSIDE_TARGET");
    expect(readdirSync(target)).toEqual([]);
  });
});

describe("RSP-007 and RSP-008 private scratch creation and removal", () => {
  it("creates a short run-owned directory outside the target and removes it with its contents", async () => {
    const workRoot = path.join(area, "lab");
    const scratch = await createPrivateScratch(workRoot, target);
    expect(path.basename(scratch.path)).toMatch(/^s-[A-Za-z0-9]{6}$/);
    expect(path.dirname(scratch.path)).toBe(workRoot);
    expect(path.relative(target, scratch.path).startsWith("..")).toBe(true);
    mkdirSync(path.join(scratch.path, "a", "b"), { recursive: true });
    writeFileSync(path.join(scratch.path, "a", "b", "file.txt"), "private");
    expect(await removePrivateScratch(scratch)).toBeNull();
    expect(existsSync(scratch.path)).toBe(false);
    expect(readdirSync(workRoot)).toEqual([]);
  });

  it("gives two scratches distinct names", async () => {
    const first = await createPrivateScratch(area, target);
    const second = await createPrivateScratch(area, target);
    expect(first.path).not.toBe(second.path);
  });

  it("treats an already-removed scratch as cleaned", async () => {
    const scratch = await createPrivateScratch(area, target);
    rmSync(scratch.path, { recursive: true });
    expect(await removePrivateScratch(scratch)).toBeNull();
  });

  it("reports a failing removal and a removal that leaves the scratch behind, without retrying", async () => {
    const scratch = await createPrivateScratch(area, target);
    let calls = 0;
    const failure = await removePrivateScratch(scratch, { removeDirectory: async () => { calls += 1; throw new Error("denied"); } });
    expect(failure).toContain("could not be removed");
    expect(failure).toContain("denied");
    expect(calls).toBe(1);
    const lingering = await removePrivateScratch(scratch, { removeDirectory: async () => { calls += 1; } });
    expect(lingering).toBe("private scratch still exists after removal.");
    expect(calls).toBe(2);
    expect(existsSync(scratch.path)).toBe(true);
  });
});
