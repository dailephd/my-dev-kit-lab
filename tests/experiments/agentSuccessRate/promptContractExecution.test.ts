import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIX_PATCH, useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { PROTECTED_PATCH, makeTask, makeToolRoot, runAgentSuccess } from "./agentSuccessRateTestHelpers.js";
import { makeProviderShim, makeSourceBackedKit, type ProviderShim } from "./realAgentTestHelpers.js";
import { createPromptContract, renderPromptContractArtifact } from "../../../src/experiments/plugins/agentSuccessRate/promptContract.js";

useSandboxTestCleanup();

const CASE_ID = "fixture-add-fix";
const MODES = ["raw-full-file", "context-pack"] as const;
const FROZEN_CODEX_ARGS = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "-"];
const FROZEN_CLAUDE_ARGS = ["--restricted", "-p", "--output-format", "json", "--no-session-persistence", "--tools", "", "--disallowedTools", "mcp__*"];
const REFERENCE_DECOY = FIX_PATCH.replace("a + b", "a * b");

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const readJson = (outDir: string, file: string): Json => JSON.parse(readFileSync(path.join(outDir, ...file.split("/")), "utf8")) as Json;
const strict = (patch: string): string => JSON.stringify({ schemaVersion: "1.0.0", patch });

async function runReal(args: { provider: "codex" | "claude"; shim: ProviderShim; config?: Record<string, unknown>; tasks?: unknown }) {
  const toolRoot = makeToolRoot();
  const kit = makeSourceBackedKit();
  const { run, outDir } = await runAgentSuccess({
    toolRoot,
    tasks: args.tasks ?? [makeTask({}, REFERENCE_DECOY)],
    config: { agentId: args.provider, includeRealAgents: true, timeoutMs: 30_000, ...args.config },
    extraInputs: { agentSuccessContextDependencies: kit.dependencies, agentSuccessAgentEnv: args.shim.env }
  });
  return { run, outDir, execution: readJson(outDir, "agent-success-rate-execution.json") };
}

const treatmentOf = (execution: Json, mode: string): Json => execution.cases.find((entry: Json) => entry.caseId === CASE_ID).treatments.find((entry: Json) => entry.treatmentId === mode);
const respondAll = (shim: ProviderShim, text: string): void => MODES.forEach((mode) => shim.respond(CASE_ID, mode, text));

for (const provider of ["codex", "claude"] as const) {
  describe(`v0.9.3 prompt contracts through the ${provider} transport`, () => {
    it("default run keeps the legacy prompt, persists a legacy prompt-contract.json and changes no invocation flags", async () => {
      const shim = makeProviderShim(provider);
      respondAll(shim, `Here it is:\n\`\`\`diff\n${FIX_PATCH}\`\`\`\n`);
      const { execution, outDir } = await runReal({ provider, shim });
      for (const mode of MODES) {
        const treatment = treatmentOf(execution, mode);
        expect(treatment.patch).toMatchObject({ attempted: true, outcome: "success" });
        const prompt = shim.prompt(CASE_ID, mode)!;
        expect(prompt).toContain("single fenced ```diff block");
        expect(prompt).not.toContain("schemaVersion");
        expect(shim.meta(CASE_ID, mode)!.args).toEqual(provider === "codex" ? FROZEN_CODEX_ARGS : FROZEN_CLAUDE_ARGS);
        const attemptDir = `agents/fixture/${CASE_ID}/${mode}/attempt-1`;
        const persisted = readFileSync(path.join(outDir, `${attemptDir}/prompt-contract.json`), "utf8");
        expect(persisted).toBe(renderPromptContractArtifact(createPromptContract(provider)));
        expect(persisted).not.toContain("module.exports");
        // The closed V1 execution evidence is unchanged: the extra artifact is not referenced from it.
        expect(JSON.stringify(treatment.realAgent.agentArtifacts)).not.toContain("prompt-contract");
      }
    });

    it("strict-diff-v1 accepts one exact JSON response and feeds the decoded diff to the existing pipeline", async () => {
      const shim = makeProviderShim(provider);
      respondAll(shim, strict(FIX_PATCH));
      const { execution, outDir } = await runReal({ provider, shim, config: { promptTemplate: "strict-diff-v1" } });
      for (const mode of MODES) {
        const treatment = treatmentOf(execution, mode);
        expect(treatment.patch).toMatchObject({ attempted: true, outcome: "success" });
        expect(treatment.postEditVerification.taskResults[0]).toMatchObject({ status: "passed" });
        expect(readFileSync(path.join(outDir, treatment.proposedPatchPath), "utf8")).toBe(FIX_PATCH);
        const prompt = shim.prompt(CASE_ID, mode)!;
        expect(prompt).toContain('{"schemaVersion":"1.0.0","patch":"<one unified Git diff>"}');
        expect(prompt).toContain(provider === "codex" ? "final agent message" : "final result text");
        expect(shim.meta(CASE_ID, mode)!.args).toEqual(provider === "codex" ? FROZEN_CODEX_ARGS : FROZEN_CLAUDE_ARGS);
        const contract = readJson(outDir, `agents/fixture/${CASE_ID}/${mode}/attempt-1/prompt-contract.json`);
        expect(contract.promptContract).toMatchObject({ templateId: "strict-diff-v1", providerId: provider, schemaVersion: "1.0.0" });
        expect(contract.promptContractDigest).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    it("rejects an invalid strict response before patch application with a bounded diagnostic and no legacy fallback", async () => {
      const shim = makeProviderShim(provider);
      // A perfectly good diff, but not in the strict envelope: legacy extraction would have applied it.
      respondAll(shim, `Sure!\n${FIX_PATCH}`);
      const { execution, run } = await runReal({ provider, shim, config: { promptTemplate: "strict-diff-v1" } });
      expect(run.status).toBe("completed");
      for (const mode of MODES) {
        const treatment = treatmentOf(execution, mode);
        // Provider completed; the application response is what failed.
        expect(treatment.realAgent).toMatchObject({ providerInvoked: true, providerStatus: "completed", finalAnswerAvailable: true });
        expect(treatment.patch).toMatchObject({ attempted: true, outcome: "parse-failure", appliedFiles: [] });
        expect(treatment.errors.map((error: Json) => error.code)).toContain("OUTPUT_CONTRACT_STRICT_NOT_JSON");
        expect(treatment.change).toBeNull();
        expect(treatment.postEditVerification).toBeNull();
        expect(JSON.stringify(treatment.errors)).not.toContain("module.exports");
      }
    });

    it("rejects a schema-valid response whose diff touches a protected path through the existing patch policy", async () => {
      const shim = makeProviderShim(provider);
      respondAll(shim, strict(PROTECTED_PATCH));
      const { execution } = await runReal({ provider, shim, config: { promptTemplate: "strict-diff-v1" } });
      for (const mode of MODES) {
        const treatment = treatmentOf(execution, mode);
        expect(treatment.patch.outcome).toBe("policy-rejection");
        expect(treatment.patch.attemptedProtectedPaths.length).toBeGreaterThan(0);
        expect(treatment.errors.map((error: Json) => error.code).join(",")).not.toContain("OUTPUT_CONTRACT");
      }
    });

    it("explanation none rejects a fenced diff that the legacy default accepts", async () => {
      const fenced = `\`\`\`diff\n${FIX_PATCH}\`\`\`\n`;
      const shim = makeProviderShim(provider);
      respondAll(shim, fenced);
      const { execution } = await runReal({ provider, shim, config: { promptExplanation: "none" } });
      for (const mode of MODES) {
        const treatment = treatmentOf(execution, mode);
        expect(treatment.patch.outcome).toBe("parse-failure");
        expect(treatment.errors.map((error: Json) => error.code)).toContain("OUTPUT_CONTRACT_EXPLANATION_CODE_FENCE");
        expect(shim.prompt(CASE_ID, mode)).toContain("ONE raw unified Git diff and nothing else");
      }
      const shim2 = makeProviderShim(provider);
      respondAll(shim2, FIX_PATCH);
      const accepted = await runReal({ provider, shim: shim2, config: { promptExplanation: "none" } });
      expect(treatmentOf(accepted.execution, "raw-full-file").patch.outcome).toBe("success");
    });

    it("keeps provider failures distinct from application-output failures", async () => {
      const shim = makeProviderShim(provider);
      for (const mode of MODES) shim.behave(CASE_ID, mode, { exitCode: 2, stderr: "boom" });
      const { execution } = await runReal({ provider, shim, config: { promptTemplate: "strict-diff-v1" } });
      for (const mode of MODES) {
        const treatment = treatmentOf(execution, mode);
        expect(treatment.realAgent.providerStatus).not.toBe("completed");
        expect(treatment.patch.attempted).toBe(false);
        expect(treatment.errors.map((error: Json) => error.code).join(",")).not.toContain("OUTPUT_CONTRACT");
      }
    });

    it("keeps the same contract across repair attempts and a bounded attempt count", async () => {
      const shim = makeProviderShim(provider);
      respondAll(shim, `not json at all ${FIX_PATCH}`);
      const { execution, outDir } = await runReal({ provider, shim, config: { promptTemplate: "strict-diff-v1", promptLength: "short", repairAttempts: 2 } });
      const treatment = treatmentOf(execution, "raw-full-file");
      expect(treatment.attempts.length).toBeLessThanOrEqual(3);
      expect(treatment.attempts.length).toBe(3);
      const files = [1, 2, 3].map((n) => readFileSync(path.join(outDir, `agents/fixture/${CASE_ID}/raw-full-file/attempt-${n}/prompt-contract.json`), "utf8"));
      expect(new Set(files).size).toBe(1);
      expect(JSON.parse(files[0]!).promptContract).toMatchObject({ templateId: "strict-diff-v1", lengthMode: "short", providerId: provider });
      for (const attempt of treatment.attempts) {
        expect(attempt.evidence.errors.map((error: Json) => error.code)).toContain("OUTPUT_CONTRACT_STRICT_NOT_JSON");
        expect(attempt.providerId).toBe(provider);
      }
      expect(existsSync(path.join(outDir, `agents/fixture/${CASE_ID}/raw-full-file/attempt-4`))).toBe(false);
    });
  });
}
