import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotProjectTree } from "../../../src/evaluation/benchmarkSandbox/index.js";
import { FIXTURE_FILES, FIX_PATCH, makeTempDir, useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { PROTECTED_PATCH, README_PATCH, makeTask, makeToolRoot, runAgentSuccess } from "./agentSuccessRateTestHelpers.js";
import { fakeAgentResult, makeProviderShim, makeSeamAgent, makeSourceBackedKit, type ProviderShim } from "./realAgentTestHelpers.js";
import type { AgentRunResult, TokenUsageSource, TokenUsageReliability } from "../../../src/agents/types.js";
import { parseAgentTokenUsage } from "../../../src/agents/index.js";
import { projectAgentFacingTask } from "../../../src/experiments/plugins/agentSuccessRate/agentTaskProjection.js";
import { createRealAgentProposalSource, projectAgentSuccessProviderTelemetryV091 } from "../../../src/experiments/plugins/agentSuccessRate/realAgentExecution.js";

useSandboxTestCleanup();

const CASE_ID = "fixture-add-fix";
const MODES = ["raw-full-file", "context-pack"] as const;
const PROSE_MARKER = "AGENT_PROSE_MARKER_77aa";
const REFERENCE_MARKER = "REFERENCE_PATCH_MARKER_5e6d";
const GOOD_ANSWER = `${PROSE_MARKER} here is the fix\n\n\`\`\`diff\n${FIX_PATCH}\`\`\`\n`;
/** A syntactically valid reference patch that would NOT solve the task; if it were ever used the task would fail. */
const DECOY_REFERENCE_PATCH = README_PATCH.replace("+extra", `+${REFERENCE_MARKER}`);
const NOOP_PATCH = [
  "diff --git a/src/other.cjs b/src/other.cjs",
  "--- a/src/other.cjs",
  "+++ b/src/other.cjs",
  "@@ -1 +1,2 @@",
  " module.exports.id = (x) => x;",
  "+// harmless comment",
  ""
].join("\n");
const FROZEN_CODEX_ARGS = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "-"];
const FROZEN_CLAUDE_ARGS = ["--restricted", "-p", "--output-format", "json", "--no-session-persistence", "--tools", "", "--disallowedTools", "mcp__*"];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const readJson = (outDir: string, file: string): Json => JSON.parse(readFileSync(path.join(outDir, ...file.split("/")), "utf8")) as Json;
const isInside = (parent: string, child: string): boolean => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || !(relative.startsWith("..") || path.isAbsolute(relative));
};

function treatmentOf(execution: Json, caseId: string, treatmentId: string): Json {
  return execution.cases.find((entry: Json) => entry.caseId === caseId).treatments.find((entry: Json) => entry.treatmentId === treatmentId);
}
function metricOf(analysis: Json, caseId: string, treatmentId: string, metric: string): Json {
  return analysis.analysis.cases.find((entry: Json) => entry.caseId === caseId).treatments.find((entry: Json) => entry.treatmentId === treatmentId).metrics[metric];
}

async function runReal(args: {
  toolRoot?: string;
  tasks?: unknown;
  provider?: "codex" | "claude";
  shim?: ProviderShim;
  runAgent?: unknown;
  kit?: ReturnType<typeof makeSourceBackedKit>;
  config?: Record<string, unknown>;
  extraInputs?: Record<string, unknown>;
}) {
  const provider = args.provider ?? "codex";
  const toolRoot = args.toolRoot ?? makeToolRoot();
  const kit = args.kit ?? makeSourceBackedKit();
  const { run, outDir } = await runAgentSuccess({
    toolRoot,
    tasks: args.tasks ?? [makeTask({}, DECOY_REFERENCE_PATCH)],
    config: { agentId: provider, includeRealAgents: true, timeoutMs: 30_000, ...args.config },
    extraInputs: {
      agentSuccessContextDependencies: kit.dependencies,
      ...(args.shim ? { agentSuccessAgentEnv: args.shim.env } : {}),
      ...(args.runAgent ? { agentSuccessRunAgent: args.runAgent } : {}),
      ...args.extraInputs
    }
  });
  return {
    run,
    outDir,
    toolRoot,
    kit,
    execution: readJson(outDir, "agent-success-rate-execution.json"),
    analysis: readJson(outDir, "agent-success-rate-analysis.json")
  };
}

function respondAll(shim: ProviderShim, text = GOOD_ANSWER, caseId = CASE_ID): void {
  for (const mode of MODES) shim.respond(caseId, mode, text);
}

describe("REA simulated real-agent pipeline (codex shim, stdin transport)", () => {
  it("REA-023..053: runs one stdin provider attempt per treatment and evaluates the actual patch", async () => {
    const shim = makeProviderShim("codex");
    respondAll(shim);
    const toolRoot = makeToolRoot();
    const canonical = path.join(toolRoot, "benchmarks", "projects", "fixture");
    const canonicalBefore = await snapshotProjectTree(canonical, { excludedNames: [".git"] });

    const { run, outDir, execution, analysis } = await runReal({ toolRoot, shim });

    // one attempt per treatment, no repair (REA-053), no live provider (REA-060)
    expect(shim.invocationKeys()).toEqual(MODES.map((mode) => `${CASE_ID}.${mode}`).sort());
    expect(run.status).toBe("completed");
    expect(run.metadata).toMatchObject({ executionMode: "real-agent", providerId: "codex", contextEffectEvaluated: true });
    expect(execution).toMatchObject({ executionMode: "real-agent", contextEffectEvaluated: true, realAgent: { providerId: "codex", timeoutMs: 30000, attemptsPerTreatment: 1, promptTransport: "stdin" } });
    expect(analysis.analysis).toMatchObject({ executionMode: "real-agent", contextEffectEvaluated: true });
    expect(analysis.methodology.treatmentComparison).toBe("descriptive-matched-case");
    expect(analysis.analysis.comparison).toMatchObject({ matchedCaseIds: [CASE_ID], incompleteCases: [], pairedOutcomes: { bothSucceeded: 1, neitherSucceeded: 0 } });

    for (const mode of MODES) {
      const treatment = treatmentOf(execution, CASE_ID, mode);
      const real = treatment.realAgent;
      // REA-023/025: stdin transport with the frozen codex flags; the prompt is never in argv
      const meta = shim.meta(CASE_ID, mode)!;
      expect(meta.args).toEqual(FROZEN_CODEX_ARGS);
      const attemptDir = `agents/fixture/${CASE_ID}/${mode}/attempt-1`;
      expect(real).toMatchObject({ providerId: "codex", attempt: 1, promptTransport: "stdin", providerInvoked: true, providerStatus: "completed", finalAnswerAvailable: true, agentArtifactDirectory: attemptDir });
      const agentResult = readJson(outDir, `${attemptDir}/agent-run-result.json`);
      // Windows resolves the .cmd shim through cmd.exe, so the recorded argv ends with the frozen adapter flags.
      expect(agentResult.args.slice(-FROZEN_CODEX_ARGS.length)).toEqual(FROZEN_CODEX_ARGS);
      expect(JSON.stringify(agentResult.args)).not.toContain("Case ID");
      expect(existsSync(path.join(outDir, `${attemptDir}/prompt.txt`))).toBe(true);
      expect(existsSync(path.join(outDir, `agents/fixture/${CASE_ID}/${mode}/attempt-2`))).toBe(false);

      // REA-024/041: neutral cwd outside every protected root, removed afterwards
      const cwd = meta.cwd;
      for (const root of [toolRoot, outDir, canonical, process.cwd()]) expect(isInside(root, cwd), root).toBe(false);
      expect(existsSync(cwd)).toBe(false);
      expect(real.cwdCleanup).toEqual({ attempted: true, removed: true, reason: null });

      // REA-028/034/035/036: Batch 1 pipeline applies the answer and trusted checks decide success
      expect(treatment.patch).toMatchObject({ attempted: true, outcome: "success", appliedFiles: [{ path: "src/math.cjs", status: "modified" }] });
      expect(treatment.postEditVerification.taskResults[0]).toMatchObject({ checkId: "task-add", status: "passed" });
      expect(treatment.change.changedFiles.map((file: Json) => file.relativePath)).toEqual(["src/math.cjs"]);
      expect(metricOf(analysis, CASE_ID, mode, "taskSuccess")).toMatchObject({ availability: "available", value: true });
      expect(metricOf(analysis, CASE_ID, mode, "requiredFactsSatisfied")).toMatchObject({ value: true });
      expect(metricOf(analysis, CASE_ID, mode, "expectedEditCoverage").value).toBe(1);
      expect(metricOf(analysis, CASE_ID, mode, "editScopePrecision").value).toBe(1);
      expect(metricOf(analysis, CASE_ID, mode, "unexpectedChangedFileCount").value).toBe(0);
      expect(metricOf(analysis, CASE_ID, mode, "protectedMutationCount").value).toBe(0);

      // REA-043/044/046: duration measured; provider-reported tokens kept apart from the context estimate
      expect(metricOf(analysis, CASE_ID, mode, "agentDurationMs").availability).toBe("available");
      expect(treatment.agentTokenUsage).toMatchObject({ totalTokens: 100, inputTokens: 70, outputTokens: 30 });
      expect(metricOf(analysis, CASE_ID, mode, "agentTotalTokens")).toMatchObject({ availability: "available", value: 100, unit: "tokens" });
      expect(real.context.estimatedContextTokens).not.toBe(100);

      // REA-050/051: the proposed artifact is the provider answer; the applied artifact comes from ChangeSetV1
      const proposed = readFileSync(path.join(outDir, treatment.proposedPatchPath), "utf8");
      const applied = readFileSync(path.join(outDir, treatment.appliedPatchPath), "utf8");
      expect(proposed).toBe(GOOD_ANSWER);
      expect(applied).toContain("diff --git a/src/math.cjs b/src/math.cjs");
      expect(applied).not.toContain(PROSE_MARKER);
      expect(treatment.sandboxId).toMatch(/^asr-/);
      expect(existsSync(path.join(outDir, "sandboxes", treatment.sandboxId))).toBe(false);
    }

    // independent sandboxes (REA-038), identical clean baselines, no leakage between treatments (REA-039)
    const [raw, pack] = MODES.map((mode) => treatmentOf(execution, CASE_ID, mode));
    expect(raw.sandboxId).not.toBe(pack.sandboxId);
    expect(raw.sandboxBaseline.digest).toBe(pack.sandboxBaseline.digest);
    const packPrompt = shim.prompt(CASE_ID, "context-pack")!;
    const rawPrompt = shim.prompt(CASE_ID, "raw-full-file")!;
    expect(packPrompt).not.toContain(PROSE_MARKER);
    expect(packPrompt).not.toContain("a + b");
    expect(rawPrompt).toContain("module.exports.add = (a, b) => a - b;");
    expect(packPrompt).toContain("module.exports.add = (a, b) => a - b;");

    // REA-022: separate context evidence and artifacts per treatment, bodies outside the JSON
    expect(raw.realAgent.context).toMatchObject({ contextMode: "raw-full-file", availability: "available", selectionPolicyId: "raw-source-glob-v1", includedSourceFiles: ["src/math.cjs", "src/other.cjs"] });
    expect(pack.realAgent.context).toMatchObject({ contextMode: "context-pack", selectionPolicyId: "bounded-multiseed-v1", myDevKitVersion: "1.12.5-fake" });
    const rawContext = readFileSync(path.join(outDir, raw.realAgent.context.contextArtifactPath), "utf8");
    const packContext = readFileSync(path.join(outDir, pack.realAgent.context.contextArtifactPath), "utf8");
    expect(rawContext).not.toBe(packContext);
    expect(rawPrompt).toContain(rawContext);
    expect(packPrompt).toContain(packContext);
    expect(raw.realAgent.context.contextChars).toBe(rawContext.length);
    expect(pack.realAgent.context.contextChars).toBe(packContext.length);

    // REA-048/049: no full source, patch body or agent prose in the JSON artifacts
    for (const serialized of [JSON.stringify(execution), JSON.stringify(analysis)]) {
      expect(serialized).not.toContain("module.exports.add");
      expect(serialized).not.toContain("diff --git");
      expect(serialized).not.toContain(PROSE_MARKER);
      expect(serialized).not.toContain(toolRoot.replace(/\\/g, "\\\\"));
      expect(serialized).not.toContain(outDir.replace(/\\/g, "\\\\"));
    }

    // REA-052: identities agree across run, artifacts and outcomes
    expect(execution.runId).toBe(analysis.runId);
    expect(run.cases[0]!.outcomes.map((outcome) => outcome.variantId)).toEqual([...MODES]);
    expect(run.cases[0]!.outcomes.map((outcome) => outcome.metadata?.providerId)).toEqual(["codex", "codex"]);

    // REA-037/040: canonical benchmark project unchanged
    expect(await snapshotProjectTree(canonical, { excludedNames: [".git"] })).toEqual(canonicalBefore);
    expect(readdirSync(path.join(outDir, "agents", "fixture", CASE_ID, "raw-full-file"))).toEqual(["attempt-1"]);
  }, 120_000);

  it("REA-009/010/029: never uses or leaks the reference patch, and never substitutes it for the provider answer", async () => {
    const shim = makeProviderShim("codex");
    respondAll(shim, "I could not produce a diff, sorry.");
    const { outDir, execution, analysis } = await runReal({ shim, tasks: [makeTask({}, FIX_PATCH)] });
    for (const mode of MODES) {
      const treatment = treatmentOf(execution, CASE_ID, mode);
      expect(readFileSync(path.join(outDir, treatment.proposedPatchPath), "utf8")).toBe("I could not produce a diff, sorry.");
      expect(treatment.patch).toMatchObject({ attempted: true, outcome: "parse-failure", code: "NO_CANDIDATE" });
      expect(treatment.change).toBeNull();
      expect(treatment.appliedPatchPath).toBeNull();
      expect(metricOf(analysis, CASE_ID, mode, "taskSuccess")).toMatchObject({ availability: "available", value: false });
      expect(shim.prompt(CASE_ID, mode)).not.toContain("module.exports.add = (a, b) => a + b;");
    }
    // the correct reference patch would have solved the task; nothing in the outputs contains it
    for (const file of walkFiles(outDir)) {
      expect(readFileSync(file, "utf8"), file).not.toContain("module.exports.add = (a, b) => a + b;");
    }
  }, 120_000);

  it("REA-009/010: a decoy reference patch is not in prompts, artifacts or results", async () => {
    const shim = makeProviderShim("codex");
    respondAll(shim);
    const { outDir, analysis } = await runReal({ shim });
    for (const mode of MODES) {
      expect(shim.prompt(CASE_ID, mode)).not.toContain(REFERENCE_MARKER);
      expect(metricOf(analysis, CASE_ID, mode, "taskSuccess").value).toBe(true);
    }
    for (const file of walkFiles(outDir)) expect(readFileSync(file, "utf8"), file).not.toContain(REFERENCE_MARKER);
  }, 120_000);

  it("REA-011/012: prompts delivered to the provider contain no trusted checks, facts, ids or edit scopes", async () => {
    const shim = makeProviderShim("codex");
    respondAll(shim);
    await runReal({ shim });
    for (const mode of MODES) {
      const prompt = shim.prompt(CASE_ID, mode)!;
      for (const hidden of ["tests/task.check.cjs", "tests/regression.check.cjs", "task-add", "regression-id", "fact-add", "add returns the sum", "protected.txt", "expectedEditFiles", "allowedEditFiles", "deterministicFixture"]) {
        expect(prompt, `${mode}: ${hidden}`).not.toContain(hidden);
      }
      expect(prompt).toContain("Make add return the sum of its arguments.");
    }
  }, 120_000);

  it("REA-013: trusted test content never reaches the provider even when the kit offers it", async () => {
    const shim = makeProviderShim("codex");
    respondAll(shim);
    const kit = makeSourceBackedKit();
    await runReal({ shim, kit });
    for (const mode of MODES) {
      const prompt = shim.prompt(CASE_ID, mode)!;
      expect(prompt).not.toContain("DECOY_TRUSTED_TEST_CONTENT");
      expect(prompt).not.toContain("add failed");
      expect(prompt).not.toContain("decoy-trusted");
    }
    expect(kit.commands.some((command) => command.args.join(" ").includes("decoy") && command.args[0] !== "search")).toBe(false);
  }, 120_000);
});

describe("REA simulated real-agent pipeline (claude shim)", () => {
  it("REA-026/044/045: uses the frozen claude stdin flags and records usage exactly as reported", async () => {
    const shim = makeProviderShim("claude");
    respondAll(shim);
    shim.behave(CASE_ID, "context-pack", { noUsage: true });
    const { execution, analysis, run } = await runReal({ provider: "claude", shim });
    expect(run.metadata?.providerId).toBe("claude");
    for (const mode of MODES) expect(shim.meta(CASE_ID, mode)!.args).toEqual(FROZEN_CLAUDE_ARGS);
    const reported = treatmentOf(execution, CASE_ID, "raw-full-file").agentTokenUsage;
    expect(reported).toMatchObject({ inputTokens: 60, outputTokens: 40 });
    expect(reported.source).not.toBe("unavailable");
    const absent = treatmentOf(execution, CASE_ID, "context-pack").agentTokenUsage;
    expect(absent).toMatchObject({ totalTokens: null, inputTokens: null, outputTokens: null, source: "unavailable", reliability: "unavailable" });
    // REA-045/046: an absent total stays unavailable; the context estimate is never substituted
    const metric = metricOf(analysis, CASE_ID, "context-pack", "agentTotalTokens");
    expect(metric).toMatchObject({ availability: "unavailable", value: null });
    expect(metric.reason).toContain("source: unavailable");
    expect(treatmentOf(execution, CASE_ID, "context-pack").realAgent.context.estimatedContextTokens).toBeGreaterThan(0);
    const aggregate = analysis.analysis.aggregates.find((entry: Json) => entry.treatmentId === "context-pack");
    expect(aggregate.agentTokenMeasurementsAvailable).toBe(0);
    expect(aggregate.agentTokenMeasurementsUnavailable).toBe(1);
    expect(treatmentOf(execution, CASE_ID, "context-pack").realAgent.providerStatus).toBe("completed");
    expect(metricOf(analysis, CASE_ID, "context-pack", "taskSuccess")).toMatchObject({ availability: "available", value: true });
    expect(execution.schemaVersion).toBe("my-dev-kit-lab-agent-success-rate-execution-v1");
    expect(JSON.stringify([execution, analysis])).not.toMatch(/normalizedTelemetry|tokenUsageSourceConflict/);
  }, 120_000);
});

describe("P2 normalized telemetry at the provider proposal boundary", () => {
  async function proposal(result: AgentRunResult, invoke = true) {
    let calls = 0;
    const context = { availability: "available" as const, reason: null, selectionPolicyId: "test", myDevKitVersion: null, includedSourceFiles: [], contextChars: 4, estimatedContextTokens: 1, text: "code" };
    const source = createRealAgentProposalSource({
      settings: { providerId: "codex", timeoutMs: 100, outDir: makeTempDir("lab-asr-p2-out-"), protectedRoots: [process.cwd()], privateRoots: [], runAgent: async () => { calls++; return result; } },
      runId: "p2", task: projectAgentFacingTask(makeTask()), forbidden: [],
      contexts: { "raw-full-file": { ...context, treatmentId: "raw-full-file" }, "context-pack": { ...context, treatmentId: "context-pack" } }
    });
    const returned = await source({ treatmentId: "raw-full-file", invoke });
    return { returned, calls };
  }

  const sources: Array<[TokenUsageSource, string]> = [["provider-reported", "provider-reported"], ["cli-json", "cli-reported"], ["agent-reported", "parsed-from-output"], ["estimated-from-text", "estimated"], ["otel", "unavailable"], ["unavailable", "unavailable"]];
  it.each(sources)("P2-TEL-003/004 maps %s in the actual provider path", async (source, evidenceLevel) => {
    for (const reliability of ["high", "medium", "low", "unavailable"] as TokenUsageReliability[]) {
      const { returned, calls } = await proposal(fakeAgentResult({ finalAnswerText: FIX_PATCH, tokenUsage: { source, inputTokens: 0, totalTokens: 7 }, tokenUsageSource: source, tokenUsageReliability: reliability }));
      expect(calls).toBe(1);
      expect(returned.normalizedTelemetry.tokenUsage).toMatchObject({ source, reliability, evidenceLevel, inputTokens: 0, totalTokens: 7, outputTokens: null });
      expect(returned.normalizedTelemetry.providerStatus).toBe("completed");
      expect(returned.agentTokenUsage!.source).toBe(source);
      if (source === "estimated-from-text" || source === "unavailable") expect(returned.agentTokenUsage!.totalTokens).toBeNull();
    }
  });

  it.each([-1, 1.5, NaN, Infinity, -Infinity, "bad"])("P2-TEL-006 rejects invalid boundary count %s while preserving siblings", async (value) => {
    const result = fakeAgentResult({ finalAnswerText: FIX_PATCH, tokenUsage: { source: "cli-json", totalTokens: value as number, inputTokens: 4, outputTokens: value as number, cachedInputTokens: value as number, reasoningTokens: value as number }, tokenUsageSource: "cli-json" });
    const { returned } = await proposal(result);
    expect(returned.normalizedTelemetry.tokenUsage).toMatchObject({ totalTokens: null, inputTokens: 4, outputTokens: null, cachedInputTokens: null, reasoningTokens: null, numericAvailability: "available" });
    expect(returned.agentTokenUsage).toMatchObject({ totalTokens: null, inputTokens: 4, outputTokens: null });
  });

  it("P2-TEL-005/015 completed without tokens retains independent outcome and excludes sensitive evidence", async () => {
    const result = fakeAgentResult({ finalAnswerText: `${FIX_PATCH}\nquota timeout rate limit`, cwd: "PRIVATE_PATH", stdoutPath: "PRIVATE_STDOUT", stderrPath: "PRIVATE_STDERR", args: ["PRIVATE_PROMPT"], tokenUsage: { source: "unavailable", rawText: "PRIVATE_CREDENTIAL" } });
    const { returned } = await proposal(result);
    expect(returned.kind).toBe("proposal");
    expect(returned.normalizedTelemetry).toMatchObject({ providerStatus: "completed", tokenUsage: { condition: "token-unavailable", totalTokens: null, inputTokens: null, outputTokens: null } });
    expect(JSON.stringify(returned.normalizedTelemetry)).not.toMatch(/PRIVATE_|rawText|stdout|stderr|prompt|cwd|credential/);
  });

  it("P2-TEL-007 preserves parser-derived partial totals in the CLI channel", async () => {
    const parsed = parseAgentTokenUsage('{"usage":{"input_tokens":5}}');
    const { returned } = await proposal(fakeAgentResult({ ...parsed, finalAnswerText: FIX_PATCH }));
    expect(returned.normalizedTelemetry.tokenUsage).toMatchObject({ totalTokens: 5, inputTokens: 5, outputTokens: null, evidenceLevel: "cli-reported" });
  });

  it.each([["provider-reported", "estimated-from-text"], ["estimated-from-text", "provider-reported"], ["cli-json", "provider-reported"]] as Array<[TokenUsageSource, TokenUsageSource]>)("P2-TEL-008 retains source disagreement %s/%s without promotion", async (usageSource, resultSource) => {
    const { returned } = await proposal(fakeAgentResult({ finalAnswerText: FIX_PATCH, tokenUsage: { source: usageSource, totalTokens: 5 }, tokenUsageSource: resultSource, tokenUsageReliability: "high" }));
    expect(returned.tokenUsageSourceConflict).toEqual({ usageSource, resultSource });
    expect(returned.normalizedTelemetry.tokenUsage).toMatchObject({ source: usageSource, reliability: "high", evidenceLevel: "unavailable", classificationReason: "unattributed-source", totalTokens: 5 });
    expect(returned.agentTokenUsage!.source).toBe(resultSource);
    if ([usageSource, resultSource].includes("estimated-from-text")) expect(returned.agentTokenUsage!.totalTokens).toBeNull();
  });

  it.each([0, 12.5, NaN, Infinity, -1, undefined])("P2-TEL-009 preserves measurement provenance for %s", async (durationMs) => {
    const result = fakeAgentResult({ finalAnswerText: FIX_PATCH, durationMs: durationMs as number });
    const direct = projectAgentSuccessProviderTelemetryV091(result, "completed", durationMs);
    if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) expect(direct.normalizedTelemetry.duration.source).toBe("unavailable");
    const { returned } = await proposal(result);
    expect(returned.normalizedTelemetry.duration).toEqual({ durationMs: returned.agentDurationMs, source: "lab-wall-clock", reason: null });
    expect(returned.agentDurationMs).toBeGreaterThanOrEqual(0);
    if (durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0) expect(returned.agentDurationMs).toBe(durationMs);
  });

  it.each([
    [fakeAgentResult({ finalAnswerText: FIX_PATCH }), "completed"],
    [fakeAgentResult({ status: "failed", errors: ["exit 1"] }), "failed"],
    [fakeAgentResult({ status: "failed", errors: ["timed out after 1ms"] }), "timeout"],
    [fakeAgentResult({ status: "skipped", warnings: ["not available"] }), "agent-unavailable"],
    [fakeAgentResult({ status: "failed", errors: ["usage limit reached"] }), "agent-limit-reached"],
    [fakeAgentResult({ status: "skipped", warnings: ["intentionally skipped"] }), "skipped"]
  ] as const)("P2-TEL-010 normalizes classified provider status %#", async (result, status) => {
    const { returned } = await proposal(result);
    expect(returned.normalizedTelemetry.providerStatus).toBe(status);
    expect(returned.realAgent.providerStatus).toBe(status);
    expect(returned.normalizedTelemetry.tokenUsage.condition).toBe("token-unavailable");
  });

  it("P2-TEL-010 retains classifier invalid-output and inherited not-invoked", async () => {
    expect(projectAgentSuccessProviderTelemetryV091(fakeAgentResult(), "invalid-output", null).normalizedTelemetry.providerStatus).toBe("invalid-output");
    const { returned, calls } = await proposal(fakeAgentResult(), false);
    expect(calls).toBe(0);
    expect(returned.normalizedTelemetry).toMatchObject({ providerStatus: "not-invoked", duration: { source: "unavailable", durationMs: null }, tokenUsage: { condition: "token-unavailable" } });
  });
});

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else out.push(full);
    }
  };
  visit(root);
  return out;
}

describe("REA provider and patch failure semantics (runner seam)", () => {
  const cases: Array<{ name: string; id: string; result: ReturnType<typeof fakeAgentResult> | "throw"; status: string; code: string }> = [
    { name: "REA-031 provider unavailable", id: "unavailable", result: fakeAgentResult({ status: "skipped", warnings: ["Codex CLI was not available."] }), status: "agent-unavailable", code: "PROVIDER_UNAVAILABLE" },
    { name: "REA-032 provider timeout", id: "timeout", result: fakeAgentResult({ status: "failed", durationMs: 777, errors: ["Command timed out after 100ms."] }), status: "timeout", code: "PROVIDER_TIMEOUT" },
    { name: "REA-033 provider usage limit", id: "limit", result: fakeAgentResult({ status: "failed", errors: ["You have hit your usage limit."] }), status: "agent-limit-reached", code: "PROVIDER_LIMIT_REACHED" },
    { name: "provider process failure", id: "failed", result: fakeAgentResult({ status: "failed", exitCode: 1, errors: ["exit 1"] }), status: "failed", code: "PROVIDER_FAILED" },
    { name: "provider completed with an empty answer", id: "empty", result: fakeAgentResult({ finalAnswerText: "   ", finalAnswerParseStatus: "empty" }), status: "completed", code: "PROVIDER_EMPTY_ANSWER" },
    { name: "provider runner throwing", id: "throw", result: "throw", status: "failed", code: "PROVIDER_FAILED" }
  ];

  for (const scenario of cases) {
    it(`${scenario.name}: no patch, no fabricated change, task success unavailable, distinguishable status`, async () => {
      const seam = makeSeamAgent(() => scenario.result);
      const toolRoot = makeToolRoot();
      const canonical = path.join(toolRoot, "benchmarks", "projects", "fixture");
      const before = await snapshotProjectTree(canonical, { excludedNames: [".git"] });
      const { run, outDir, execution, analysis } = await runReal({ toolRoot, runAgent: seam.runAgent });
      expect(seam.requests).toHaveLength(2); // exactly one attempt per treatment
      for (const mode of MODES) {
        const treatment = treatmentOf(execution, CASE_ID, mode);
        expect(treatment.realAgent.providerStatus).toBe(scenario.status);
        expect(treatment.errors.map((error: Json) => error.code)).toContain(scenario.code);
        expect(treatment.patch.attempted).toBe(false);
        expect(treatment.change).toBeNull();
        expect(treatment.proposedPatchPath).toBeNull();
        expect(treatment.appliedPatchPath).toBeNull();
        expect(treatment.status).toBe("partial");
        expect(treatment.availability).toBe("incomplete");
        const success = metricOf(analysis, CASE_ID, mode, "taskSuccess");
        expect(success).toMatchObject({ availability: "unavailable", value: null });
        expect(success.reason).toContain("no usable answer");
        expect(metricOf(analysis, CASE_ID, mode, "changedFileCount").availability).toBe("unavailable");
        expect(treatment.cleanup).toMatchObject({ attempted: true, removed: true });
        expect(treatment.realAgent.cwdCleanup).toMatchObject({ attempted: true, removed: true });
      }
      if (scenario.id === "timeout") expect(treatmentOf(execution, CASE_ID, "raw-full-file").timing.agentDurationMs).toBe(777);
      expect(analysis.analysis.comparison).toMatchObject({ matchedCaseIds: [], incompleteCases: [{ caseId: CASE_ID, unavailableTreatmentIds: ["raw-full-file", "context-pack"] }] });
      expect(analysis.analysis.contextEffectEvaluated).toBe(false);
      expect(run.status).toBe("partial");
      expect(await snapshotProjectTree(canonical, { excludedNames: [".git"] })).toEqual(before);
      expect(existsSync(path.join(outDir, "diffs"))).toBe(false);
      for (const request of seam.requests) expect(existsSync(request.cwd)).toBe(false);
    }, 120_000);
  }

  it("REA-030 a completed attempt with a malformed or missing patch is a truthful task failure", async () => {
    for (const answer of ["```diff\n```\n", "diff --git a/src/math.cjs b/src/math.cjs\nthis is not a hunk\n", "no diff here at all"]) {
      const seam = makeSeamAgent(() => fakeAgentResult({ finalAnswerText: answer }));
      const { execution, analysis } = await runReal({ runAgent: seam.runAgent });
      for (const mode of MODES) {
        const treatment = treatmentOf(execution, CASE_ID, mode);
        expect(treatment.patch).toMatchObject({ attempted: true, outcome: "parse-failure" });
        expect(treatment.realAgent).toMatchObject({ providerStatus: "completed", finalAnswerAvailable: true });
        expect(treatment.status).toBe("completed");
        expect(metricOf(analysis, CASE_ID, mode, "taskSuccess")).toMatchObject({ availability: "available", value: false });
        expect(metricOf(analysis, CASE_ID, mode, "patchApplied").value).toBe(false);
      }
    }
  }, 180_000);

  it("a limit-looking word inside a completed patch does not reclassify the provider", async () => {
    const answer = FIX_PATCH.replace("a + b", "a + b /* quota exhausted: timed out, rate limit, usage limit */");
    const seam = makeSeamAgent(() => fakeAgentResult({ finalAnswerText: answer }));
    const { execution } = await runReal({ runAgent: seam.runAgent });
    for (const mode of MODES) expect(treatmentOf(execution, CASE_ID, mode).realAgent.providerStatus).toBe("completed");
  }, 120_000);

  it("protected-path patch is rejected before application and leaves protected files intact", async () => {
    const seam = makeSeamAgent(() => fakeAgentResult({ finalAnswerText: PROTECTED_PATCH }));
    const { execution, analysis } = await runReal({ runAgent: seam.runAgent });
    for (const mode of MODES) {
      const treatment = treatmentOf(execution, CASE_ID, mode);
      expect(treatment.patch).toMatchObject({ attempted: true, outcome: "policy-rejection", attemptedProtectedPaths: ["protected.txt"] });
      expect(treatment.protectedIntegrity).toMatchObject({ status: "intact", mutatedPaths: [] });
      expect(metricOf(analysis, CASE_ID, mode, "taskSuccess")).toMatchObject({ availability: "available", value: false });
      expect(metricOf(analysis, CASE_ID, mode, "attemptedProtectedEditCount").value).toBe(1);
      expect(metricOf(analysis, CASE_ID, mode, "protectedMutationCount").value).toBe(0);
    }
  }, 120_000);

  it("a patch that applies but fails the trusted task check is task failure measured on actual changes", async () => {
    const seam = makeSeamAgent(() => fakeAgentResult({ finalAnswerText: NOOP_PATCH }));
    const { execution, analysis } = await runReal({ runAgent: seam.runAgent });
    for (const mode of MODES) {
      const treatment = treatmentOf(execution, CASE_ID, mode);
      expect(treatment.patch.outcome).toBe("success");
      expect(treatment.postEditVerification.taskResults[0]).toMatchObject({ checkId: "task-add", status: "failed" });
      expect(treatment.change.changedFiles.map((file: Json) => file.relativePath)).toEqual(["src/other.cjs"]);
      expect(metricOf(analysis, CASE_ID, mode, "taskSuccess")).toMatchObject({ availability: "available", value: false });
      expect(metricOf(analysis, CASE_ID, mode, "requiredFactsSatisfied").value).toBe(false);
      // edit-quality metrics come from the actual change: other.cjs is allowed but not an expected edit
      expect(metricOf(analysis, CASE_ID, mode, "expectedEditCoverage").value).toBe(0);
      expect(metricOf(analysis, CASE_ID, mode, "editScopePrecision").value).toBe(1);
      expect(metricOf(analysis, CASE_ID, mode, "totalChurn").value).toBe(1);
    }
  }, 120_000);

  it("REA-042 reports a sandbox cleanup failure instead of hiding it", async () => {
    const seam = makeSeamAgent(() => fakeAgentResult({ finalAnswerText: GOOD_ANSWER }));
    const { execution } = await runReal({
      runAgent: seam.runAgent,
      extraInputs: {
        agentSuccessDependencies: {
          removeSandbox: async () => ({ removed: false, reason: "simulated removal failure" })
        }
      }
    });
    for (const mode of MODES) {
      const treatment = treatmentOf(execution, CASE_ID, mode);
      expect(treatment.cleanup).toMatchObject({ attempted: true, removed: false });
      expect(treatment.errors.map((error: Json) => error.code)).toContain("CLEANUP_FAILED");
      expect(treatment.status).toBe("partial");
    }
  }, 120_000);

  it("REA-042 reports a provider working-directory cleanup failure (Windows keeps a busy directory locked)", async () => {
    if (process.platform !== "win32") return;
    const { spawn } = await import("node:child_process");
    const holders: Array<ReturnType<typeof spawn>> = [];
    try {
      const seam = makeSeamAgent(async (request) => {
        const holder = spawn(process.execPath, ["-e", "process.stdout.write('ready'); setTimeout(() => {}, 20000)"], { cwd: request.cwd, stdio: ["ignore", "pipe", "ignore"] });
        holders.push(holder);
        // Wait until the holder is running inside the directory, so the lock is in place before cleanup runs.
        await new Promise<void>((resolve, reject) => {
          holder.once("error", reject);
          holder.stdout!.once("data", () => resolve());
        });
        return fakeAgentResult({ finalAnswerText: GOOD_ANSWER });
      });
      const { execution } = await runReal({ runAgent: seam.runAgent });
      const treatment = treatmentOf(execution, CASE_ID, "raw-full-file");
      expect(treatment.realAgent.cwdCleanup).toMatchObject({ attempted: true, removed: false });
      expect(treatment.errors.map((error: Json) => error.code)).toContain("AGENT_CWD_CLEANUP_FAILED");
      expect(treatment.status).toBe("partial");
    } finally {
      for (const holder of holders) holder.kill();
    }
  }, 120_000);

  it("REA-043 measures the agent duration reported by the runner and keeps it apart from evaluation time", async () => {
    const seam = makeSeamAgent(() => fakeAgentResult({ finalAnswerText: GOOD_ANSWER, durationMs: 4321 }));
    const { execution, analysis } = await runReal({ runAgent: seam.runAgent });
    for (const mode of MODES) {
      expect(treatmentOf(execution, CASE_ID, mode).timing.agentDurationMs).toBe(4321);
      expect(metricOf(analysis, CASE_ID, mode, "agentDurationMs")).toMatchObject({ availability: "available", value: 4321 });
      expect(metricOf(analysis, CASE_ID, mode, "evaluationDurationMs").value).not.toBe(4321);
    }
  }, 120_000);
});

describe("REA invalid baseline, context failures and isolation guards", () => {
  it("never invokes the provider or scores a failure when the baseline is not evaluable", async () => {
    const solved = { ...FIXTURE_FILES, "src/math.cjs": "module.exports.add = (a, b) => a + b;\n" };
    const seam = makeSeamAgent(() => fakeAgentResult({ finalAnswerText: GOOD_ANSWER }));
    const { execution, analysis, run } = await runReal({ toolRoot: makeToolRoot({ fixture: solved }), runAgent: seam.runAgent });
    expect(seam.requests).toHaveLength(0);
    for (const mode of MODES) {
      const treatment = treatmentOf(execution, CASE_ID, mode);
      expect(treatment).toMatchObject({ status: "skipped", availability: "baseline-invalid" });
      expect(treatment.realAgent).toMatchObject({ providerInvoked: false, providerStatus: "not-invoked", providerStatusReason: "baseline-not-evaluable", agentArtifactDirectory: null });
      expect(treatment.realAgent.context.contextArtifactPath).toBeNull();
      expect(metricOf(analysis, CASE_ID, mode, "taskSuccess")).toMatchObject({ availability: "unavailable" });
    }
    expect(run.status).toBe("skipped");
  }, 120_000);

  it("REA-020 a context failure prevents provider invocation for that treatment only", async () => {
    const seam = makeSeamAgent(() => fakeAgentResult({ finalAnswerText: GOOD_ANSWER }));
    const { execution, analysis } = await runReal({ runAgent: seam.runAgent, kit: makeSourceBackedKit({ failSearch: true }) });
    expect(seam.requests).toHaveLength(1);
    expect(seam.requests[0]!.promptText).toContain("Context mode: raw-full-file");
    const pack = treatmentOf(execution, CASE_ID, "context-pack");
    expect(pack.realAgent).toMatchObject({ providerInvoked: false, providerStatus: "not-invoked" });
    expect(pack.realAgent.context).toMatchObject({ availability: "unavailable", reason: "retrieval-failed", contextArtifactPath: null });
    expect(pack.errors.map((error: Json) => error.code)).toEqual(["CONTEXT_UNAVAILABLE"]);
    expect(treatmentOf(execution, CASE_ID, "raw-full-file").realAgent.providerInvoked).toBe(true);
    // REA-054: the incomplete case is excluded from matched metrics and reported separately
    expect(analysis.analysis.comparison).toMatchObject({ matchedCaseIds: [], incompleteCases: [{ caseId: CASE_ID, unavailableTreatmentIds: ["context-pack"] }] });
    expect(analysis.analysis.contextEffectEvaluated).toBe(false);
    for (const aggregate of analysis.analysis.aggregates) {
      for (const [meanId, mean] of Object.entries(aggregate.means) as Array<[string, Json]>) {
        // evaluation duration is measured for both treatments regardless of the missing patch evidence
        if (meanId !== "meanEvaluationDurationMs") expect(mean.matchedCaseIds, meanId).toEqual([]);
      }
    }
  }, 120_000);

  it("REA-020 refuses to invoke the provider when the assembled prompt would carry hidden benchmark data", async () => {
    const leaky = { ...FIXTURE_FILES, "src/math.cjs": "module.exports.add = (a, b) => a - b; // add returns the sum\n" };
    const seam = makeSeamAgent(() => fakeAgentResult({ finalAnswerText: GOOD_ANSWER }));
    const { execution } = await runReal({ toolRoot: makeToolRoot({ fixture: leaky }), runAgent: seam.runAgent });
    expect(seam.requests).toHaveLength(0);
    for (const mode of MODES) {
      const treatment = treatmentOf(execution, CASE_ID, mode);
      expect(treatment.errors.map((error: Json) => error.code)).toEqual(["PROMPT_ISOLATION_VIOLATION"]);
      expect(treatment.errors[0].message).toContain("behaviorFact.text");
      expect(treatment.realAgent).toMatchObject({ providerInvoked: false, providerStatus: "not-invoked" });
      expect(treatment.realAgent.context.contextArtifactPath).toBeNull();
    }
  }, 120_000);

  it("never runs the provider from a cwd that overlaps a protected root", async () => {
    const seam = makeSeamAgent(() => fakeAgentResult({ finalAnswerText: GOOD_ANSWER }));
    const { execution } = await runReal({ runAgent: seam.runAgent });
    for (const request of seam.requests) {
      expect(isInside(path.join(request.outDir, ".."), request.cwd)).toBe(false);
      expect(path.basename(request.cwd)).toMatch(/^my-dev-kit-lab-asr-agent-/);
    }
    expect(treatmentOf(execution, CASE_ID, "raw-full-file").realAgent.providerInvoked).toBe(true);
  }, 120_000);

  it("refuses to overwrite an existing agent attempt directory", async () => {
    const outputRoot = path.join(makeTempDir("lab-asr-existing-"), "out");
    const attempt = path.join(outputRoot, "agents", "fixture", CASE_ID, "raw-full-file", "attempt-1");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(attempt, { recursive: true });
    writeFileSync(path.join(attempt, "keep.txt"), "precious");
    const seam = makeSeamAgent(() => fakeAgentResult({ finalAnswerText: GOOD_ANSWER }));
    const toolRoot = makeToolRoot();
    const result = await runAgentSuccess({
      toolRoot,
      tasks: [makeTask({}, DECOY_REFERENCE_PATCH)],
      outputRoot,
      config: { agentId: "codex", includeRealAgents: true, timeoutMs: 30000 },
      extraInputs: { agentSuccessContextDependencies: makeSourceBackedKit().dependencies, agentSuccessRunAgent: seam.runAgent }
    });
    expect(seam.requests).toHaveLength(1);
    expect(readFileSync(path.join(attempt, "keep.txt"), "utf8")).toBe("precious");
    const raw = result.run.caseExecutionEvidence[0]!.treatments[0]!;
    expect(raw.errors.map((error) => error.code)).toContain("AGENT_ARTIFACT_EXISTS");
    expect(raw.realAgent?.providerInvoked).toBe(false);
  }, 120_000);
});

describe("REA matched comparison and descriptive-only reporting", () => {
  it("REA-054/055 reports paired outcomes for matched cases without any winner, ranking or composite", async () => {
    const taskA = makeTask({ id: "case-a" }, DECOY_REFERENCE_PATCH);
    const taskB = makeTask({ id: "case-b" }, DECOY_REFERENCE_PATCH);
    const shim = makeProviderShim("codex");
    for (const mode of MODES) shim.respond("case-a", mode, GOOD_ANSWER);
    shim.respond("case-b", "raw-full-file", NOOP_PATCH);
    shim.respond("case-b", "context-pack", GOOD_ANSWER);
    const { analysis, execution, run } = await runReal({ shim, tasks: [taskA, taskB] });
    expect(execution.cases).toHaveLength(2);
    expect(analysis.analysis.comparison).toEqual({
      basis: "matched-evaluable-cases",
      matchedCaseIds: ["case-a", "case-b"],
      incompleteCases: [],
      pairedOutcomes: { bothSucceeded: 1, onlyRawFullFileSucceeded: 0, onlyContextPackSucceeded: 1, neitherSucceeded: 0 }
    });
    const [rawAggregate, packAggregate] = analysis.analysis.aggregates;
    expect(rawAggregate).toMatchObject({ treatmentId: "raw-full-file", evaluableCaseCount: 2, successfulCaseCount: 1 });
    expect(packAggregate).toMatchObject({ treatmentId: "context-pack", evaluableCaseCount: 2, successfulCaseCount: 2 });
    const forbiddenKeys = new Set(["winner", "ranking", "rank", "composite", "compositeScore", "score", "pValue", "significance", "weightedScore", "best"]);
    const found: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          if (forbiddenKeys.has(key)) found.push(key);
          visit(child);
        }
      }
    };
    visit(analysis);
    visit(execution);
    visit(run.metrics);
    expect(found).toEqual([]);
    expect(analysis.analysis.limitations.join(" ")).toContain("no causal, ranking, winner or statistical-significance claim");
  }, 180_000);

  it("REA-047 keeps real-agent and deterministic-fixture evidence distinguishable", async () => {
    const toolRoot = makeToolRoot();
    const deterministic = await runAgentSuccess({ toolRoot, tasks: [makeTask()] });
    const shim = makeProviderShim("codex");
    respondAll(shim);
    const real = await runReal({ shim, toolRoot });
    expect(deterministic.run.metadata).toMatchObject({ executionMode: "deterministic-fixture", contextEffectEvaluated: false });
    expect(real.run.metadata).toMatchObject({ executionMode: "real-agent", contextEffectEvaluated: true });
    const detAnalysis = readJson(deterministic.outDir, "agent-success-rate-analysis.json");
    expect(detAnalysis.analysis.comparison).toBeUndefined();
    expect(detAnalysis.analysis.contextEffectEvaluated).toBe(false);
    expect(detAnalysis.methodology.treatmentComparison).toBe("pipeline-diagnostic-only");
    expect(metricOf(detAnalysis, CASE_ID, "raw-full-file", "agentDurationMs").availability).toBe("unavailable");
  }, 180_000);

  it("REA-029 does not require or read a deterministic fixture in real-agent mode", async () => {
    const shim = makeProviderShim("codex");
    respondAll(shim);
    const withoutFixture = makeTask();
    delete (withoutFixture as { deterministicFixture?: unknown }).deterministicFixture;
    const { execution } = await runReal({ shim, tasks: [withoutFixture] });
    expect(execution.cases[0].fixtureId).toBe("");
    for (const mode of MODES) expect(treatmentOf(execution, CASE_ID, mode).patch.outcome).toBe("success");
  }, 120_000);
});
