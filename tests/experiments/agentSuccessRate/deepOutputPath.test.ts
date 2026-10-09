import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotProjectTree } from "../../../src/evaluation/benchmarkSandbox/index.js";
import { makeTempDir, useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { makeToolRoot, runAgentSuccess, taskInput } from "./agentSuccessRateTestHelpers.js";

/**
 * PATH-001..009, 013: the output root decides the sandbox working directory, and the OS (not this tool) decides whether a
 * process can be started in a long directory. These tests never assume a length limit: they PROBE the host with a plain
 * Node spawn and assert the behavior that matches what the host actually does.
 */
useSandboxTestCleanup();

const SEGMENT = "n".repeat(40);

function nestedOutputRoot(parent: string, targetLength: number): string {
  let dir = path.join(parent, "out");
  while (dir.length < targetLength) dir = path.join(dir, SEGMENT.slice(0, Math.max(1, Math.min(SEGMENT.length, targetLength - dir.length - 1))));
  return dir;
}

/** True when this host can start a process whose working directory is exactly this deep. */
function hostCanSpawnIn(parent: string, length: number): boolean {
  const dir = nestedOutputRoot(parent, length);
  mkdirSync(dir, { recursive: true });
  const probe = spawnSync(process.execPath, ["-e", "1"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  return probe.status === 0;
}

const readExecution = (outDir: string) => JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-execution.json"), "utf8"));

async function guardedRun(outDir: string, toolRoot: string) {
  const canonical = path.join(toolRoot, "benchmarks", "projects", "fixture");
  const before = await snapshotProjectTree(canonical, { excludedNames: [".git"] });
  const { run } = await runAgentSuccess({ toolRoot, tasks: [taskInput()], outputRoot: outDir });
  const after = await snapshotProjectTree(canonical, { excludedNames: [".git"] });
  return { run, before, after };
}

describe("agent-success-rate output path depth", () => {
  it("PATH-001/002/006/013: short and nested supported output paths still complete with unchanged canonical files", async () => {
    for (const length of [0, 120]) {
      const toolRoot = makeToolRoot();
      const parent = makeTempDir("lab-asr-path-");
      const outDir = length === 0 ? path.join(parent, "out") : nestedOutputRoot(parent, length);
      const { run, before, after } = await guardedRun(outDir, toolRoot);
      expect(run.status).toBe("completed");
      expect(run.failures).toEqual([]);
      expect(after).toEqual(before);
      for (const treatment of readExecution(outDir).cases[0].treatments) expect(treatment.status).toBe("completed");
    }
  }, 600_000);

  it("PATH-003..009: a very deep output root never crashes; it either completes or fails with a controlled diagnostic", async () => {
    const toolRoot = makeToolRoot();
    const parent = makeTempDir("lab-asr-deep-");
    const sibling = path.join(parent, "sibling-keep");
    mkdirSync(sibling, { recursive: true });
    writeFileSync(path.join(sibling, "keep.txt"), "untouched");
    const outDir = nestedOutputRoot(parent, 300);
    const canHost = hostCanSpawnIn(makeTempDir("lab-asr-probe-"), 300);
    const canonical = path.join(toolRoot, "benchmarks", "projects", "fixture");
    const before = await snapshotProjectTree(canonical, { excludedNames: [".git"] });

    // Resolving at all (instead of an unhandled 'error' event ending the process) is the PATH-003 assertion.
    const { run } = await runAgentSuccess({ toolRoot, tasks: [taskInput()], outputRoot: outDir });

    expect(await snapshotProjectTree(canonical, { excludedNames: [".git"] })).toEqual(before);
    expect(readFileSync(path.join(sibling, "keep.txt"), "utf8")).toBe("untouched");
    expect(readdirSync(sibling)).toEqual(["keep.txt"]);
    // no owned sandbox directory survives, whichever way the run ended
    expect(existsSync(path.join(outDir, "sandboxes")) ? readdirSync(path.join(outDir, "sandboxes")) : []).toEqual([]);

    const execution = readExecution(outDir);
    const treatments = execution.cases[0].treatments as Array<Record<string, any>>;
    if (canHost) {
      expect(run.status).toBe("completed");
      for (const treatment of treatments) expect(treatment.status).toBe("completed");
    } else {
      expect(run.status).toBe("failed");
      for (const treatment of treatments) {
        expect(treatment.status).toBe("failed");
        expect(treatment.availability).toBe("infrastructure-failure");
        expect(treatment.errors[0].code).toBe("SANDBOX_GIT_FAILED");
        expect(treatment.errors[0].message).toMatch(/ENOENT/);
        expect(treatment.errors[0].message).toMatch(/cwd length \d+ characters/);
        // PATH-005: a failed treatment never reports task success, and the unavailable verdict is explicit
        expect(JSON.stringify(treatment)).not.toMatch(/"taskSuccess":true/);
        expect(treatment.change).toBeNull();
        expect(treatment.postEditVerification).toBeNull();
      }
      const analysis = JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-analysis.json"), "utf8"));
      expect(JSON.stringify(analysis)).not.toMatch(/"taskSuccess":true/);
    }
  }, 600_000);
});
