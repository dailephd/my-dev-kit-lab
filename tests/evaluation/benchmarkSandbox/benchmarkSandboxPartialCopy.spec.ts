import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BenchmarkSandboxError,
  createBenchmarkSandbox,
  snapshotProjectTree,
  type BenchmarkSandbox
} from "../../../src/evaluation/benchmarkSandbox/index.js";
import { makeCanonicalFixture, makeSandbox, makeTempDir, useSandboxTestCleanup } from "./sandboxTestHelpers.js";

/**
 * Deterministic post-copy-start failure injection. node:fs/promises is wrapped so every function passes
 * through to the real implementation; only copyFile can be told to fail on one specific call number.
 * This file is isolated from benchmarkSandbox.spec.ts so the wrapper cannot affect any other test.
 */
const control = vi.hoisted(() => ({
  failOnCall: 0,
  calls: 0,
  copiedDestinations: [] as string[],
  failureObservedPriorCopiesOnDisk: false
}));

const INJECTED_MESSAGE = "injected copy failure (test-controlled)";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const fs = await import("node:fs");
  return {
    ...actual,
    copyFile: async (source: string, destination: string, mode?: number): Promise<void> => {
      control.calls += 1;
      if (control.failOnCall > 0 && control.calls === control.failOnCall) {
        control.failureObservedPriorCopiesOnDisk =
          control.copiedDestinations.length > 0 && control.copiedDestinations.every((copied) => fs.existsSync(copied));
        throw new Error(INJECTED_MESSAGE);
      }
      await actual.copyFile(source, destination, mode);
      control.copiedDestinations.push(destination);
    }
  };
});

useSandboxTestCleanup();

const SNAPSHOT_ALL = { excludedNames: [] as string[] };

beforeEach(() => {
  control.failOnCall = 0;
  control.calls = 0;
  control.copiedDestinations = [];
  control.failureObservedPriorCopiesOnDisk = false;
});

function resetControl(failOnCall: number): void {
  control.failOnCall = failOnCall;
  control.calls = 0;
  control.copiedDestinations = [];
  control.failureObservedPriorCopiesOnDisk = false;
}

describe("benchmark sandbox partial-copy failure (TRN-006)", () => {
  it("RSP-050 removes the owned partial sandbox, preserves canonical and unrelated runtime data, and returns a failure", async () => {
    const canonical = makeCanonicalFixture();
    const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");

    // Unrelated data that lives in the same caller-owned runtime root and must survive the failed attempt.
    mkdirSync(path.join(runtimeRoot, "sibling-data"), { recursive: true });
    writeFileSync(path.join(runtimeRoot, "sibling-data", "keep.txt"), "unrelated runtime data\n");
    const existing: BenchmarkSandbox = await makeSandbox(canonical, "existing-sandbox", runtimeRoot);

    const canonicalBefore = await snapshotProjectTree(canonical, SNAPSHOT_ALL);
    const runtimeBefore = await snapshotProjectTree(runtimeRoot, SNAPSHOT_ALL);
    const runtimeEntriesBefore = readdirSync(runtimeRoot).sort();
    expect(runtimeEntriesBefore).toEqual(["existing-sandbox", "sibling-data"]);

    // Fail on the second file copy: the first copy has already succeeded, so copying has started.
    resetControl(2);
    const sandboxRoot = path.join(runtimeRoot, "failing-sandbox");
    let handle: BenchmarkSandbox | undefined;
    let failure: unknown;
    try {
      handle = await createBenchmarkSandbox({ canonicalProjectRoot: canonical, runtimeRoot, sandboxId: "failing-sandbox" });
    } catch (error) {
      failure = error;
    }

    // The failure path was really entered after copying began (not a pre-copy refusal).
    expect(control.calls).toBe(2);
    expect(control.copiedDestinations).toHaveLength(1);
    expect(control.copiedDestinations[0]?.startsWith(path.join(sandboxRoot, "project"))).toBe(true);
    expect(control.failureObservedPriorCopiesOnDisk).toBe(true);

    // A failure is returned, never a ready sandbox.
    expect(handle).toBeUndefined();
    expect(failure).toBeInstanceOf(BenchmarkSandboxError);
    expect((failure as BenchmarkSandboxError).code).toBe("COPY_FAILED");
    expect((failure as BenchmarkSandboxError).message).toContain(INJECTED_MESSAGE);

    // The owned partial sandbox is gone, including any would-be baseline.
    expect(existsSync(sandboxRoot)).toBe(false);
    expect(existsSync(path.join(sandboxRoot, "project", ".git"))).toBe(false);
    expect(existsSync(path.join(sandboxRoot, "sandbox-owner.json"))).toBe(false);

    // Canonical benchmark is byte-for-byte unchanged (snapshot entries carry content digests).
    expect(await snapshotProjectTree(canonical, SNAPSHOT_ALL)).toEqual(canonicalBefore);

    // Unrelated runtime data, including a previously created sandbox, is untouched and nothing new remains.
    expect(readdirSync(runtimeRoot).sort()).toEqual(runtimeEntriesBefore);
    expect(await snapshotProjectTree(runtimeRoot, SNAPSHOT_ALL)).toEqual(runtimeBefore);
    expect(existsSync(path.join(existing.sandboxRoot, "sandbox-owner.json"))).toBe(true);

    // Nothing was left behind that blocks a clean retry with the same id.
    resetControl(0);
    const retried = await makeSandbox(canonical, "failing-sandbox", runtimeRoot);
    expect(retried.baseline.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(retried.baseline.fileCount).toBe(canonicalBefore.length);
  });

  it("RSP-050 never removes a sandbox directory it does not own when creation is refused", async () => {
    const canonical = makeCanonicalFixture();
    const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");
    const owned = await makeSandbox(canonical, "owned-by-someone-else", runtimeRoot);
    const ownedBefore = await snapshotProjectTree(owned.sandboxRoot, SNAPSHOT_ALL);

    // Injection is armed for the first copy; a refusal must happen before any copy, so it must never fire.
    resetControl(1);
    let failure: unknown;
    try {
      await createBenchmarkSandbox({ canonicalProjectRoot: canonical, runtimeRoot, sandboxId: "owned-by-someone-else" });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(BenchmarkSandboxError);
    expect((failure as BenchmarkSandboxError).code).toBe("SANDBOX_EXISTS");
    expect(control.calls).toBe(0);
    expect(existsSync(owned.sandboxRoot)).toBe(true);
    expect(await snapshotProjectTree(owned.sandboxRoot, SNAPSHOT_ALL)).toEqual(ownedBefore);
  });
});
