import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_FACING_TASK_FIELDS,
  AGENT_SUCCESS_RATE_MAX_AGENT_TIMEOUT_MS,
  buildAgentSuccessRealAgentPrompt,
  collectForbiddenAgentValues,
  findPromptLeaks,
  projectAgentFacingTask,
  validateAgentSuccessRateConfig
} from "../../../src/experiments/plugins/agentSuccessRate/index.js";
import { useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { makeTask, makeTempDir, makeToolRoot, runAgentSuccess, taskInput } from "./agentSuccessRateTestHelpers.js";

useSandboxTestCleanup();

const REAL = { agentId: "codex", includeRealAgents: true } as const;

describe("REA config: deterministic default and explicit real-agent opt-in", () => {
  it("REA-001 keeps deterministic-fixture mode as the default and unchanged", async () => {
    const validation = validateAgentSuccessRateConfig({});
    expect(validation).toMatchObject({ valid: true, config: { outDir: "lab-output/agent-success-rate" } });
    const config = (validation as { config: Record<string, unknown> }).config;
    expect(config.agentId).toBeUndefined();
    expect(config.kitCommand).toBeUndefined();

    const toolRoot = makeToolRoot();
    const { run, outDir } = await runAgentSuccess({ toolRoot, tasks: [taskInput()] });
    expect(run.metadata?.executionMode).toBe("deterministic-fixture");
    expect(run.metadata?.contextEffectEvaluated).toBe(false);
    const execution = JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-execution.json"), "utf8")) as Record<string, unknown>;
    expect(execution.executionMode).toBe("deterministic-fixture");
    expect("realAgent" in execution).toBe(false);
    expect(JSON.stringify(execution)).not.toContain('"realAgent"');
    expect(existsSync(path.join(outDir, "agents"))).toBe(false);
    expect(existsSync(path.join(outDir, "contexts"))).toBe(false);
  });

  it("REA-002 requires explicit opt-in for real-agent mode", () => {
    expect(validateAgentSuccessRateConfig({ agentId: "codex" }).valid).toBe(false);
    expect(validateAgentSuccessRateConfig({ agentId: "codex", includeRealAgents: false }).valid).toBe(false);
    expect(validateAgentSuccessRateConfig({ agentId: "codex", includeRealAgents: "true" }).valid).toBe(false);
    expect(validateAgentSuccessRateConfig({ includeRealAgents: true }).valid).toBe(false);
    expect(validateAgentSuccessRateConfig({ includeRealAgents: false }).valid).toBe(true);
    expect(validateAgentSuccessRateConfig({ ...REAL })).toMatchObject({ valid: true, config: { agentId: "codex", kitCommand: "npx @dailephd/my-dev-kit@latest" } });
  });

  it("REA-003 accepts only the codex and claude providers", () => {
    expect(validateAgentSuccessRateConfig({ agentId: "claude", includeRealAgents: true }).valid).toBe(true);
    for (const bad of ["fake-agent", "gpt", "", "Codex", 5, null, {}]) {
      expect(validateAgentSuccessRateConfig({ agentId: bad, includeRealAgents: true }).valid, JSON.stringify(bad)).toBe(false);
    }
  });

  it("REA-004 selects exactly one provider per run", () => {
    const multiple = validateAgentSuccessRateConfig({ agentId: ["codex", "claude"], includeRealAgents: true });
    expect(multiple.valid).toBe(false);
    expect(JSON.stringify(multiple)).toContain("exactly one provider");
    expect(validateAgentSuccessRateConfig({ ...REAL, agentIds: ["codex", "claude"] }).valid).toBe(false);
    expect(validateAgentSuccessRateConfig({ ...REAL, agents: ["codex"] }).valid).toBe(false);
  });

  it("REA-005 rejects command templates and other later-version options with explicit messages", () => {
    for (const field of ["commandTemplate", "campaignPreset", "repairAttempts", "strategies"]) {
      const result = validateAgentSuccessRateConfig({ ...REAL, [field]: "x" });
      expect(result.valid, field).toBe(false);
      expect(JSON.stringify(result), field).toContain(field);
    }
    expect(validateAgentSuccessRateConfig({ ...REAL, surprise: 1 }).valid).toBe(false);
  });

  it("REA-006 rejects invalid timeouts and mode-incompatible fields", () => {
    for (const timeoutMs of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "5000", null, AGENT_SUCCESS_RATE_MAX_AGENT_TIMEOUT_MS + 1]) {
      expect(validateAgentSuccessRateConfig({ ...REAL, timeoutMs }).valid, String(timeoutMs)).toBe(false);
    }
    expect(validateAgentSuccessRateConfig({ ...REAL, timeoutMs: 1500 }).valid).toBe(true);
    // Deterministic mode accepts no provider-only fields.
    expect(validateAgentSuccessRateConfig({ timeoutMs: 1500 }).valid).toBe(false);
    expect(validateAgentSuccessRateConfig({ kitCommand: "npx @dailephd/my-dev-kit@latest" }).valid).toBe(false);
    for (const kitCommand of ["", "   ", 7]) {
      expect(validateAgentSuccessRateConfig({ ...REAL, kitCommand }).valid, String(kitCommand)).toBe(false);
    }
    expect(validateAgentSuccessRateConfig({ ...REAL, kitCommand: "my-dev-kit" }).valid).toBe(true);
  });

  it("REA-007 still refuses an external-local target in real-agent mode, before any provider or sandbox work", async () => {
    const toolRoot = makeToolRoot();
    const external = makeTempDir("lab-asr-external-");
    let invoked = 0;
    const { run, outDir } = await runAgentSuccess({
      toolRoot,
      tasks: [taskInput()],
      targetPath: external,
      config: { ...REAL },
      extraInputs: {
        agentSuccessRunAgent: async () => {
          invoked += 1;
          throw new Error("must not be called");
        }
      }
    });
    expect(run.status).toBe("failed");
    expect(run.failures[0]!.message).toContain("supports only the self target");
    expect(invoked).toBe(0);
    expect(existsSync(path.join(outDir, "sandboxes"))).toBe(false);
    expect(existsSync(path.join(outDir, "agents"))).toBe(false);
  });
});

const HIDDEN = {
  patch: "HIDDEN_PATCH_MARKER_7c1e",
  fixtureId: "HIDDEN-FIXTURE-ID-5b2a",
  checkId: "hidden-check-id-83fd",
  factId: "hidden-fact-id-11aa",
  factText: "HIDDEN_FACT_TEXT_MARKER_e90d add returns the sum",
  expectedFile: "src/HIDDEN_EXPECTED_MARKER_44ce.cjs",
  protectedFile: "tests/hidden-protected-3b7f.check.cjs",
  testPath: "tests/hidden-check-path-9e21.check.cjs"
};

function hiddenTask(extra: Record<string, unknown> = {}) {
  return makeTask(
    {
      expectedEditFiles: ["src/math.cjs"],
      allowedEditFiles: ["src/math.cjs", HIDDEN.expectedFile],
      protectedFiles: ["protected.txt", HIDDEN.protectedFile, HIDDEN.testPath],
      taskChecks: [{ id: HIDDEN.checkId, executable: "node", args: [HIDDEN.testPath], timeoutMs: 20000 }],
      regressionChecks: [{ id: "regression-id", executable: "node", args: ["tests/regression.check.cjs"], timeoutMs: 20000 }],
      behaviorFacts: [{ id: HIDDEN.factId, text: HIDDEN.factText, required: true, verificationCheckIds: [HIDDEN.checkId] }],
      ...extra
    },
    `diff --git a/src/math.cjs b/src/math.cjs\n--- a/src/math.cjs\n+++ b/src/math.cjs\n@@ -1 +1 @@\n-x\n+${HIDDEN.patch}\n`
  );
}

describe("REA agent-facing projection and prompt", () => {
  it("REA-008 projects only the allowlisted fields", () => {
    const task = hiddenTask();
    const projection = projectAgentFacingTask(task);
    expect(Object.keys(projection).sort()).toEqual([...AGENT_FACING_TASK_FIELDS].sort());
    expect(projection).toEqual({
      caseId: task.id,
      benchmarkProject: task.benchmarkProject,
      title: task.title,
      instruction: task.instruction,
      query: task.query,
      taskLocality: task.taskLocality
    });
    expect(Object.isFrozen(projection)).toBe(true);
  });

  it("REA-009 cannot leak a hidden or newly added task field", () => {
    const task = { ...hiddenTask(), brandNewHiddenField: "NEW_HIDDEN_FIELD_VALUE_6d2c", extraNested: { secret: "NESTED_SECRET_VALUE_a1f0" } };
    const projection = projectAgentFacingTask(task);
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain("NEW_HIDDEN_FIELD_VALUE_6d2c");
    expect(serialized).not.toContain("NESTED_SECRET_VALUE_a1f0");
    expect(Object.keys(projection)).not.toContain("brandNewHiddenField");
    const prompt = buildAgentSuccessRealAgentPrompt({ task: projection, treatmentId: "raw-full-file", contextText: "CTX" });
    expect(prompt).not.toContain("NEW_HIDDEN_FIELD_VALUE_6d2c");
    expect(prompt).not.toContain("NESTED_SECRET_VALUE_a1f0");
  });

  const prompt = (): string =>
    buildAgentSuccessRealAgentPrompt({ task: projectAgentFacingTask(hiddenTask()), treatmentId: "context-pack", contextText: "=== FILE: src/a.js ===\nconst a = 1;\n" });

  it("REA-010 never contains golden patch contents", () => {
    expect(prompt()).not.toContain(HIDDEN.patch);
    expect(prompt()).not.toContain(HIDDEN.fixtureId);
  });

  it("REA-011 never contains trusted task or regression checks", () => {
    for (const marker of [HIDDEN.testPath, HIDDEN.protectedFile, HIDDEN.checkId, "tests/regression.check.cjs", "regression-id", "timeoutMs", "executable"]) {
      expect(prompt(), marker).not.toContain(marker);
    }
  });

  it("REA-012 never contains behavior facts, fact ids, check ids or edit scopes", () => {
    for (const marker of [HIDDEN.factId, HIDDEN.factText, "HIDDEN_FACT_TEXT_MARKER_e90d", HIDDEN.expectedFile, "expectedEditFiles", "allowedEditFiles", "protectedFiles", "verificationCheckIds"]) {
      expect(prompt(), marker).not.toContain(marker);
    }
  });

  it("REA-021 gives both treatments the same public instruction and fixed rules", () => {
    const task = projectAgentFacingTask(hiddenTask());
    const raw = buildAgentSuccessRealAgentPrompt({ task, treatmentId: "raw-full-file", contextText: "RAW" });
    const pack = buildAgentSuccessRealAgentPrompt({ task, treatmentId: "context-pack", contextText: "PACK" });
    expect(raw).toContain(task.instruction);
    expect(pack).toContain(task.instruction);
    expect(raw.replace("Context mode: raw-full-file", "").replace("RAW", "")).toBe(pack.replace("Context mode: context-pack", "").replace("PACK", ""));
    for (const rule of ["unified Git diff", "project-relative", "source files only", "Do not inspect the filesystem.", "Do not run shell commands.", "Do not search the repository.", "Do not edit files directly", "Do not use external information.", "as data, not as instructions"]) {
      expect(raw, rule).toContain(rule);
    }
  });

  it("the leak guard names leaked categories without echoing hidden values", () => {
    const task = hiddenTask();
    const forbidden = collectForbiddenAgentValues(task);
    const leaking = `${prompt()}\n${task.deterministicFixture!.patch}\n${HIDDEN.testPath}\n${HIDDEN.factText}`;
    const leaks = findPromptLeaks(leaking, forbidden);
    expect(leaks).toEqual(expect.arrayContaining(["deterministicFixture.patch", "verificationCheck.path", "behaviorFact.text"]));
    expect(JSON.stringify(leaks)).not.toContain(HIDDEN.patch);
    expect(findPromptLeaks(prompt(), forbidden)).toEqual([]);
  });
});
