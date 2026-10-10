import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotProjectTree } from "../../../src/evaluation/benchmarkSandbox/index.js";
import { useSandboxTestCleanup, makeTempDir } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { makeToolRoot, runAgentSuccess, makeTask } from "./agentSuccessRateTestHelpers.js";
import {
  DECOY_REFERENCE_PATCH,
  GOOD_ANSWER,
  NOOP_ANSWER,
  makeScriptedProvider,
  makeSourceBackedKit,
  readJson,
  treatmentOf,
  type Json
} from "./repairTestHelpers.js";

/**
 * PACK-054..058: dedicated regression evidence for the cleanup observability added with repair mode. Every failure is
 * injected through a plugin seam, so the tests depend on no file-system permission behavior, no timing and no platform.
 */
useSandboxTestCleanup();

const taskNamed = (id: string) => makeTask({ id }, DECOY_REFERENCE_PATCH);

type Injection = {
  toolRoot: string;
  outDir: string;
  canonical: string;
  canonicalBefore: Awaited<ReturnType<typeof snapshotProjectTree>>;
};

async function injection(): Promise<Injection> {
  const toolRoot = makeToolRoot();
  const canonical = path.join(toolRoot, "benchmarks", "projects", "fixture");
  const outDir = path.join(makeTempDir("lab-asr-clean-out-"), "out");
  mkdirSync(outDir, { recursive: true });
  return { toolRoot, outDir, canonical, canonicalBefore: await snapshotProjectTree(canonical, { excludedNames: [".git"] }) };
}

function realRun(args: { inj: Injection; repairAttempts?: number; extraInputs?: Record<string, unknown>; answer?: string }) {
  const provider = makeScriptedProvider(() => ({ answer: args.answer ?? GOOD_ANSWER }));
  const kit = makeSourceBackedKit();
  return runAgentSuccess({
    toolRoot: args.inj.toolRoot,
    tasks: [taskNamed("case-a")],
    outputRoot: args.inj.outDir,
    config: { agentId: "codex", includeRealAgents: true, timeoutMs: 30_000, ...(args.repairAttempts === undefined ? {} : { repairAttempts: args.repairAttempts }) },
    extraInputs: { agentSuccessContextDependencies: kit.dependencies, agentSuccessRunAgent: provider.runAgent, ...args.extraInputs }
  }).then((result) => ({ ...result, provider }));
}

/** An artifact-IO seam that fails persistence after the attempt directories exist, forcing attempt-directory cleanup. */
const failingPersistence = {
  agentSuccessArtifactIo: {
    writeFile: async (filePath: string, content: string) => {
      if (filePath.endsWith("agent-success-rate-analysis.json")) throw new Error("injected persistence failure");
      writeFileSync(filePath, content);
    }
  }
};

const attemptDirectories = (outDir: string): string[] => {
  const root = path.join(outDir, "agents");
  if (!existsSync(root)) return [];
  return (readdirSync(root, { recursive: true, encoding: "utf8" }) as string[]).map((entry) => entry.replace(/\\/g, "/")).filter((entry) => /\/attempt-\d+$/.test(entry)).sort();
};

describe("PACK-054..058 cleanup evidence hardening (fault injection)", () => {
  it("CH-1/2: normal cleanup removes every sandbox and, after a failed persistence, every attempt directory", async () => {
    const inj = await injection();
    const ok = await realRun({ inj });
    expect(ok.run.status).toBe("completed");
    expect(existsSync(path.join(inj.outDir, "sandboxes"))).toBe(false);
    expect(ok.run.warnings.map((warning) => warning.code)).not.toContain("sandbox-runtime-root-not-removed");
    const execution = readJson(inj.outDir, "agent-success-rate-execution.json");
    for (const treatment of execution.cases[0].treatments) expect(treatment.cleanup).toMatchObject({ attempted: true, removed: true });

    // A failed persistence in a second, independent output root: the normal removal path leaves no attempt directory behind.
    const failedInj = await injection();
    const failed = await realRun({ inj: failedInj, extraInputs: failingPersistence });
    expect(failed.run.status).toBe("failed");
    expect(failed.run.failures[0]!.message).toBe("Agent success rate artifact persistence failed.");
    expect(attemptDirectories(failedInj.outDir)).toEqual([]);
  }, 600_000);

  it("CH-3/7: an injected attempt-directory removal failure is recorded with a count equal to the injected failures", async () => {
    for (const failOn of [["raw-full-file"], ["raw-full-file", "context-pack"]]) {
      const inj = await injection();
      const attempted: string[] = [];
      const leftovers: string[] = [];
      const removeAttemptDirectory = async (directory: string) => {
        attempted.push(directory);
        if (failOn.some((treatment) => directory.replace(/\\/g, "/").includes(`/${treatment}/`))) {
          leftovers.push(directory);
          throw new Error(`refused ${directory}`);
        }
        await rm(directory, { recursive: true, force: true });
      };
      const { run } = await realRun({ inj, extraInputs: { ...failingPersistence, agentSuccessRemoveAttemptDirectory: removeAttemptDirectory } });
      const noun = failOn.length === 1 ? "directory" : "directories";
      expect(run.status).toBe("failed");
      expect(run.failures[0]!.message).toBe(`Agent success rate artifact persistence failed. ${failOn.length} agent attempt ${noun} could not be removed.`);
      // the recorded count is exactly the number of injected failures, and each treatment was attempted exactly once
      expect(attempted).toHaveLength(2);
      expect(leftovers).toHaveLength(failOn.length);
      expect(attemptDirectories(inj.outDir)).toHaveLength(failOn.length);
      // the message never exposes a private path
      expect(run.failures[0]!.message).not.toContain(inj.outDir);
      expect(run.failures[0]!.message).not.toContain("refused");
    }
  }, 600_000);

  it("CH-4/5: a failed sandbox removal is recorded, cannot read as an unqualified success and triggers no repair", async () => {
    const inj = await injection();
    const removals: string[] = [];
    const { run, provider } = await realRun({
      inj,
      repairAttempts: 2,
      answer: NOOP_ANSWER,
      extraInputs: {
        agentSuccessDependencies: {
          removeSandbox: async (options: { runtimeRoot: string; sandboxId: string }) => {
            removals.push(options.sandboxId);
            return { removed: false, reason: "injected sandbox removal failure" };
          }
        }
      }
    });
    const execution = readJson(inj.outDir, "agent-success-rate-execution.json");
    for (const mode of ["raw-full-file", "context-pack"]) {
      const treatment = treatmentOf(execution, "case-a", mode);
      expect(treatment.cleanup).toMatchObject({ attempted: true, removed: false });
      expect(treatment.errors.map((error: Json) => error.code)).toContain("CLEANUP_FAILED");
      expect(treatment.status).not.toBe("completed");
      expect(treatment.availability).not.toBe("complete");
      expect(treatment.attempts).toHaveLength(1);
      expect(treatment.attempts[0]).toMatchObject({ failureCategory: "cleanup-failed", repairEligible: false });
    }
    // No repair prompt was ever issued: one provider invocation per treatment.
    expect(provider.facts.map((fact) => `${fact.mode}:${fact.attempt}`).sort()).toEqual(["context-pack:1", "raw-full-file:1"]);
    expect(removals).toHaveLength(2);
    expect(run.status).not.toBe("completed");
    expect(run.summary!.failures.some((failure) => failure.code === "CLEANUP_FAILED")).toBe(true);
    // The analysis agrees: the attempt is not a clean task success.
    const analysis = readJson(inj.outDir, "agent-success-rate-analysis.json");
    for (const treatment of analysis.analysis.cases[0].treatments) expect(treatment.evidenceAvailability).not.toBe("complete");
  }, 600_000);

  it("CH-6: a leftover sandbox keeps the runtime root and the runtime-root warning is preserved on the run", async () => {
    const inj = await injection();
    const { run } = await realRun({
      inj,
      extraInputs: { agentSuccessDependencies: { removeSandbox: async () => ({ removed: false, reason: "injected sandbox removal failure" }) } }
    });
    const warning = run.warnings.find((entry) => entry.code === "sandbox-runtime-root-not-removed");
    expect(warning, JSON.stringify(run.warnings)).toBeDefined();
    expect(warning!.message).toContain("could not be removed");
    expect(warning!.message).not.toContain(inj.outDir);
    // The leftover is real and reported, never silently deleted by the Lab.
    const runtimeRoot = path.join(inj.outDir, "sandboxes");
    expect(existsSync(runtimeRoot)).toBe(true);
    expect(readdirSync(runtimeRoot).length).toBeGreaterThan(0);
  }, 600_000);

  it("CH-8/9/10: unrelated siblings survive, a later independent run succeeds and canonical benchmarks are unchanged", async () => {
    const inj = await injection();
    // Unrelated content beside the run's own directories, including an agents/ subtree the run did not create.
    const unrelated = path.join(inj.outDir, "agents", "someone-else", "attempt-1");
    mkdirSync(unrelated, { recursive: true });
    writeFileSync(path.join(unrelated, "keep.txt"), "precious");
    mkdirSync(path.join(inj.outDir, "notes"), { recursive: true });
    writeFileSync(path.join(inj.outDir, "notes", "keep.md"), "notes");

    const removed: string[] = [];
    const { run } = await realRun({
      inj,
      extraInputs: { ...failingPersistence, agentSuccessRemoveAttemptDirectory: async (directory: string) => { removed.push(directory); await rm(directory, { recursive: true, force: true }); } }
    });
    expect(run.status).toBe("failed");
    // only the run's own two attempt directories were named; nothing else was touched
    expect(removed).toHaveLength(2);
    for (const directory of removed) expect(directory.replace(/\\/g, "/")).toMatch(/\/agents\/fixture\/case-a\/(raw-full-file|context-pack)\/attempt-1$/);
    expect(readFileSync(path.join(unrelated, "keep.txt"), "utf8")).toBe("precious");
    expect(readFileSync(path.join(inj.outDir, "notes", "keep.md"), "utf8")).toBe("notes");
    expect(attemptDirectories(inj.outDir)).toEqual(["someone-else/attempt-1"]);

    // The failed run did not poison the environment: an independent run completes.
    const later = await realRun({ inj: await injection() });
    expect(later.run.status).toBe("completed");

    expect(await snapshotProjectTree(inj.canonical, { excludedNames: [".git"] })).toEqual(inj.canonicalBefore);
  }, 600_000);
});
