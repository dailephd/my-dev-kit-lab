import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runExperimentRunCommandFromArgs } from "../../../src/commands/runExperimentRunCommand.js";
import { parseComparePromptsArgs, runComparePrompts, runComparePromptsCommand } from "../../../src/commands/runComparePromptsCommand.js";
import { runBuildGalleryCommand } from "../../../src/commands/buildGalleryCommand.js";
import { campaignHash, canonicalCampaignJson } from "../../../src/experiments/plugins/agentSuccessRate/campaignIdentity.js";
import { createPromptContract, renderPromptContractArtifact } from "../../../src/experiments/plugins/agentSuccessRate/promptContract.js";
import { loadPromptComparisonSide, type TrustedTasksResult } from "../../../src/report/experiments/promptTemplateComparisonEvidence.js";
import {
  buildPromptTemplateComparison,
  classifyResponseValidity,
  type PromptTemplateComparisonReportV1
} from "../../../src/report/experiments/promptTemplateComparisonModel.js";
import {
  renderPromptTemplateComparisonHtml,
  renderPromptTemplateComparisonJson,
  renderPromptTemplateComparisonText
} from "../../../src/report/experiments/renderPromptTemplateComparison.js";
import { assertReadAgentSuccessCorpus } from "../../../src/evaluation/agentSuccess/index.js";
import { captureCommand, cliFixture } from "../../experiments/agentSuccessRate/realProviderCampaignTestHelpers.js";
import { memorySide, type CaseSpec, type RunSpec } from "./promptComparisonFixtures.js";

const tempDirs: string[] = [];
function tempRoot(): string {
  const dir = path.join(os.tmpdir(), `prompt-cmp-${Math.random().toString(16).slice(2)}`);
  tempDirs.push(dir);
  return dir;
}
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
});

const cases = (...ids: string[]): CaseSpec[] => ids.map((caseId) => ({ caseId }));
const pair = (baseline: Partial<RunSpec> & Pick<RunSpec, "cases">, candidate: Partial<RunSpec> & Pick<RunSpec, "cases">) =>
  buildPromptTemplateComparison(
    memorySide("baseline", { runId: "run-base", templateId: "legacy-diff-v1", ...baseline }),
    memorySide("candidate", { runId: "run-cand", templateId: "strict-diff-v1", ...candidate })
  );

const OUTPUT_INVALID = { finalAnswer: true, errors: ["OUTPUT_CONTRACT_STRICT_NOT_JSON"], patchOutcome: "parse-failure" as const, patchCode: "NO_DIFF", failureCategory: "patch-malformed", taskSuccess: false };

// ---------------------------------------------------------------------------
// Pure model: comparability, matching, invalid-output eligibility
// ---------------------------------------------------------------------------

describe("comparability and matching (pure model)", () => {
  it("compares verified prompt contracts with different templates and declares no winner", () => {
    const report = pair({ cases: cases("c1", "c2") }, { cases: cases("c1", "c2") });
    expect(report.comparison).toMatchObject({ status: "COMPARABLE", winner: null });
    expect(report.baseline).toMatchObject({ templateId: "legacy-diff-v1", promptBasis: "campaign-identity-v2-verified-contract" });
    expect(report.candidate.templateId).toBe("strict-diff-v1");
    expect(report.baseline.promptContractDigest).not.toBe(report.candidate.promptContractDigest);
    expect(report.criteria.find((c) => c.id === "prompt-template")?.status).toBe("not-required");
  });

  it("is INCOMPARABLE when a side's prompt identity is unverified, without computing rates or a winner", () => {
    const unverified = memorySide("baseline", { runId: "b", cases: cases("c1") });
    unverified.promptBasis = "unverified";
    unverified.promptContract = null;
    unverified.unverifiable.push("historical prompt identity cannot be proven");
    const report = buildPromptTemplateComparison(unverified, memorySide("candidate", { runId: "c", templateId: "strict-diff-v1", cases: cases("c1") }));
    expect(report.comparison.status).toBe("INCOMPARABLE");
    expect(report.comparison.incomparabilityReasons.join(" ")).toMatch(/baseline: historical prompt identity cannot be proven/);
    expect(report.comparison.winner).toBeNull();
    expect(report.invalidOutput.strata).toEqual([]);
    expect(report.invalidOutput.overall).toBeNull();
  });

  it.each([
    ["provider", { providerId: "claude" as const }, /provider/],
    ["repair allowance", { repairAttempts: 1 as const }, /repair-allowance/],
    ["timeout", { timeoutMs: 90000 }, /timeout/],
    ["prompt length mode", { contract: { lengthMode: "short" as const } }, /prompt-lengthMode/],
    ["prompt explanation mode", { contract: { explanationMode: "none" as const } }, /prompt-explanationMode/],
    ["tool-use mode", { contract: { toolUseMode: "bounded" as const } }, /prompt-toolUseMode/],
    ["non-prompt execution", { componentOverrides: { execution: "e".repeat(64) } }, /component-execution/],
    ["corpus", { componentOverrides: { corpus: "c".repeat(64) } }, /component-corpus/],
    ["checks", { componentOverrides: { checks: "d".repeat(64) } }, /component-checks/],
    ["provider build", { componentOverrides: { providerBuild: "b".repeat(64) } }, /component-providerBuild/]
  ])("is INCOMPARABLE on %s mismatch", (_label, change, pattern) => {
    const report = pair({ cases: cases("c1") }, { cases: cases("c1"), ...(change as Partial<RunSpec>) });
    expect(report.comparison.status).toBe("INCOMPARABLE");
    expect(report.comparison.incomparabilityReasons.join(" ")).toMatch(pattern);
    expect(report.comparison.winner).toBeNull();
  });

  it("treats one-sided missing provider-build evidence as unverifiable", () => {
    const report = pair({ cases: cases("c1") }, { cases: cases("c1"), componentOverrides: { providerBuild: null } });
    expect(report.comparison.status).toBe("INCOMPARABLE");
    expect(report.criteria.find((c) => c.id === "component-providerBuild")?.status).toBe("unverifiable");
  });

  it("matches shared cases and excludes unmatched or task-mismatched cases with deterministic reasons", () => {
    const report = pair(
      { cases: [{ caseId: "c1" }, { caseId: "c2" }, { caseId: "only-base" }, { caseId: "c3", taskDigest: "a".repeat(64) }] },
      { cases: [{ caseId: "c1" }, { caseId: "c2" }, { caseId: "only-cand" }, { caseId: "c3", taskDigest: "b".repeat(64) }] }
    );
    expect(report.comparison.status).toBe("COMPARABLE");
    expect(report.cohort.matchedUnitCount).toBe(4);
    expect(report.cohort.unmatchedCases).toEqual([
      { caseId: "c3", reason: "task-digest-mismatch" },
      { caseId: "only-base", reason: "case-missing-in-candidate" },
      { caseId: "only-cand", reason: "case-missing-in-baseline" }
    ]);
  });

  it("excludes units whose prompt contract could not be verified from either denominator", () => {
    const report = pair({ cases: cases("c1", "c2"), unverifiedUnits: { "c1/raw-full-file": "prompt-contract-unverified" } }, { cases: cases("c1", "c2") });
    const raw = report.invalidOutput.strata.find((s) => s.stratum === "raw-full-file")!;
    expect(raw.eligibleUnitCount).toBe(1);
    expect(report.cohort.exclusionReasonCounts).toEqual({ "baseline:prompt-contract-unverified": 1 });
  });
});

describe("invalid-output eligibility and rates (pure model)", () => {
  const unit = (spec: { status?: string; category?: string; errors?: string[]; patchOutcome?: string | null; patchCode?: string | null; finalAnswer?: boolean; attempted?: boolean; invoked?: boolean }) => {
    const status = spec.status ?? "completed";
    const finalAnswer = spec.finalAnswer ?? true;
    return {
      attempt: { providerStatus: status, failureCategory: spec.category ?? "none" },
      evidence: {
        errors: (spec.errors ?? []).map((code) => ({ code, message: "" })),
        patch: { attempted: spec.attempted ?? finalAnswer, outcome: spec.patchOutcome === undefined ? "success" : spec.patchOutcome, code: spec.patchCode ?? null },
        realAgent: { providerStatus: status, providerInvoked: spec.invoked ?? true, finalAnswerAvailable: finalAnswer }
      },
      attemptNumber: 1,
      taskSuccess: null
    } as never;
  };

  it("never counts the bare provider invalid-output status as a response violation", () => {
    expect(classifyResponseValidity(unit({ status: "invalid-output" }))).toEqual({ eligible: false, invalid: false, reason: "unverified-provider-invalid-output-status" });
    expect(classifyResponseValidity(unit({ status: "invalid-output", errors: ["OUTPUT_CONTRACT_STRICT_NOT_JSON"], patchOutcome: "parse-failure" }))).toMatchObject({ eligible: false, invalid: false });
  });

  it("counts verified contract violations, verified malformed diffs and proven empty completed responses", () => {
    expect(classifyResponseValidity(unit({ errors: ["OUTPUT_CONTRACT_STRICT_MARKDOWN_FENCE"], patchOutcome: "parse-failure" }))).toEqual({ eligible: true, invalid: true, reason: "OUTPUT_CONTRACT_STRICT_MARKDOWN_FENCE" });
    expect(classifyResponseValidity(unit({ patchOutcome: "parse-failure", patchCode: "NO_DIFF" }))).toEqual({ eligible: true, invalid: true, reason: "malformed-diff:NO_DIFF" });
    expect(classifyResponseValidity(unit({ finalAnswer: false, errors: ["PROVIDER_EMPTY_ANSWER"], patchOutcome: null, category: "provider-empty-answer" }))).toEqual({ eligible: true, invalid: true, reason: "provider-empty-answer" });
  });

  it("excludes attempts whose evidence cannot establish eligibility", () => {
    // No named empty answer and no final answer: missing response evidence, neither valid nor invalid.
    expect(classifyResponseValidity(unit({ finalAnswer: false, patchOutcome: null }))).toEqual({ eligible: false, invalid: false, reason: "missing-response-evidence" });
    expect(classifyResponseValidity(unit({ finalAnswer: false, patchOutcome: null, category: "provider-empty-answer" }))).toMatchObject({ eligible: false });
    expect(classifyResponseValidity(unit({ invoked: false }))).toMatchObject({ eligible: false, reason: "missing-response-evidence" });
    expect(classifyResponseValidity(unit({ patchOutcome: null, attempted: false }))).toEqual({ eligible: false, invalid: false, reason: "unverified-patch-pipeline-outcome" });
    for (const [status, reason] of [["timeout", "provider-timeout"], ["agent-unavailable", "provider-unavailable"], ["agent-limit-reached", "provider-limit-reached"], ["failed", "provider-failure"], ["not-invoked", "provider-not-invoked"]] as const) {
      expect(classifyResponseValidity(unit({ status }))).toMatchObject({ eligible: false, invalid: false, reason });
    }
    expect(classifyResponseValidity(unit({ category: "infrastructure-failure" }))).toMatchObject({ eligible: false });
  });

  it("treats policy rejection, apply failure and failed task checks as valid eligible responses", () => {
    expect(classifyResponseValidity(unit({ patchOutcome: "policy-rejection", category: "patch-policy-rejected" }))).toEqual({ eligible: true, invalid: false, reason: "valid" });
    expect(classifyResponseValidity(unit({ patchOutcome: "git-apply-failure" }))).toMatchObject({ eligible: true, invalid: false });
    expect(classifyResponseValidity(unit({ category: "task-check-failed" }))).toMatchObject({ eligible: true, invalid: false });
  });

  it("computes counts, rates and the percentage-point difference over the matched eligible cohort", () => {
    const report = pair(
      { cases: [{ caseId: "c1", raw: OUTPUT_INVALID, pack: OUTPUT_INVALID }, { caseId: "c2", raw: OUTPUT_INVALID }, { caseId: "c3" }, { caseId: "c4" }] },
      { cases: [{ caseId: "c1", raw: OUTPUT_INVALID }, { caseId: "c2" }, { caseId: "c3" }, { caseId: "c4" }] }
    );
    const raw = report.invalidOutput.strata.find((s) => s.stratum === "raw-full-file")!;
    expect(raw.baseline).toMatchObject({ numerator: 2, denominator: 4, ratePercent: 50 });
    expect(raw.candidate).toMatchObject({ numerator: 1, denominator: 4, ratePercent: 25 });
    expect(raw.percentagePointDifference).toBe(25);
    expect(report.invalidOutput.overall).toMatchObject({ eligibleUnitCount: 8, percentagePointDifference: 25 });
  });

  it("excludes provider outcomes from both denominators and reports a zero denominator as unavailable", () => {
    const report = pair(
      { cases: [{ caseId: "c1", raw: { status: "timeout", finalAnswer: false, patchOutcome: null, failureCategory: "provider-timeout", taskSuccess: null } }, { caseId: "c2" }] },
      { cases: [{ caseId: "c1" }, { caseId: "c2", raw: { status: "agent-unavailable", finalAnswer: false, patchOutcome: null, failureCategory: "provider-unavailable", taskSuccess: null } }] }
    );
    const raw = report.invalidOutput.strata.find((s) => s.stratum === "raw-full-file")!;
    expect(raw).toMatchObject({ eligibleUnitCount: 0, percentagePointDifference: null, availability: "unavailable" });
    expect(raw.baseline).toMatchObject({ denominator: 0, ratePercent: null, availability: "unavailable" });
    expect(report.cohort.exclusionReasonCounts).toEqual({ "baseline:provider-timeout": 1, "candidate:provider-unavailable": 1 });
  });

  it("separates first-attempt validity from repair attempts and final task outcomes", () => {
    const report = pair(
      { repairAttempts: 1, cases: [{ caseId: "c1", raw: { ...OUTPUT_INVALID, repair: { status: "completed", finalAnswer: true, patchOutcome: "success", failureCategory: "none", taskSuccess: true } } }] },
      { repairAttempts: 1, cases: [{ caseId: "c1" }] }
    );
    expect(report.invalidOutput.strata.find((s) => s.stratum === "raw-full-file")!.baseline).toMatchObject({ numerator: 1, denominator: 1 });
    expect(report.invalidOutput.repairAttemptSummary).toEqual([expect.objectContaining({ attemptNumber: 2, baselineEligible: 1, baselineInvalid: 0, repairAllowance: 1 })]);
    const task = report.taskSuccess.strata.find((s) => s.stratum === "raw-full-file")!;
    expect(task.initial.baselineSuccessCount).toBe(0);
    expect(task.final.baselineSuccessCount).toBe(1);
  });

  it("reports task success separately and never treats an invalid response as a success", () => {
    const report = pair({ cases: [{ caseId: "c1", raw: OUTPUT_INVALID }] }, { cases: [{ caseId: "c1", raw: { taskSuccess: null, failureCategory: "evidence-incomplete" } }] });
    expect(report.taskSuccess.separateFromInvalidOutput).toBe(true);
    expect(report.taskSuccess.strata.find((s) => s.stratum === "raw-full-file")!.unavailableUnitCount).toBe(1);
    expect(report.taskSuccess.strata.find((s) => s.stratum === "context-pack")!.final).toMatchObject({ bothSucceeded: 1, denominator: 1 });
  });
});

describe("reports", () => {
  it("renders deterministic JSON, text and HTML with required fields", () => {
    const report = pair({ cases: [{ caseId: "c1", raw: OUTPUT_INVALID }] }, { cases: cases("c1") });
    const json = renderPromptTemplateComparisonJson(report);
    expect(renderPromptTemplateComparisonJson(report)).toBe(json);
    const parsed = JSON.parse(json) as PromptTemplateComparisonReportV1;
    expect(parsed).toMatchObject({ schemaVersion: "prompt-template-comparison/1.0.0", behavioralImprovement: { status: "NOT_VERIFIED" }, provenance: { providerInvoked: false } });
    const text = renderPromptTemplateComparisonText(report);
    expect(text).toMatch(/Comparison status: COMPARABLE/);
    expect(text).toMatch(/Behavioral improvement: NOT_VERIFIED/);
    const html = renderPromptTemplateComparisonHtml(report);
    expect(html).not.toMatch(/<script|https?:\/\/|<link\b|<img\b|(?:src|href)=/i);
    for (const output of [json, text, html]) expect(output).not.toMatch(/[A-Za-z]:\\\\Users|\/home\//);
  });

  it("escapes hostile text in HTML and renders incomparable reports without a winner", () => {
    const report = pair({ cases: cases("c1"), providerId: "claude" }, { cases: cases("c1") });
    const html = renderPromptTemplateComparisonHtml({ ...report, warnings: ['<script>alert(1)</script>"><img src=x onerror=alert(2)>'] });
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(renderPromptTemplateComparisonText(report)).toMatch(/Winner: none declared/);
  });
});

describe("compare-prompts arguments", () => {
  it("requires --baseline, --candidate and --out exactly once and rejects unknown input", () => {
    expect(() => parseComparePromptsArgs(["--baseline", "a", "--candidate", "b"])).toThrow(/Missing required option: --out/);
    expect(() => parseComparePromptsArgs(["--baseline", "a", "--baseline", "c", "--candidate", "b", "--out", "o"])).toThrow(/Duplicate option: --baseline/);
    expect(() => parseComparePromptsArgs(["--baseline", "a", "--candidate", "b", "--out", "o", "--force"])).toThrow(/Unknown option/);
    expect(() => parseComparePromptsArgs(["--baseline", "", "--candidate", "b", "--out", "o"])).toThrow(/non-empty/);
    expect(() => parseComparePromptsArgs(["stray"])).toThrow(/Unexpected argument/);
    expect(parseComparePromptsArgs(["--out", "o", "--candidate", "b", "--baseline", "a"])).toEqual({ baseline: "a", candidate: "b", out: "o" });
  });
});

// ---------------------------------------------------------------------------
// Real campaign outputs: complete checkpoint validation, prompt identity, immutability
// ---------------------------------------------------------------------------

type Campaign = { root: string; outputRoot: string; toolRoot: string; invocations: () => string[] };

async function runCampaigns(): Promise<{ legacy: Campaign; strict: Campaign; root: string }> {
  // One fixture (one provider shim and retrieval kit) runs both campaigns so the provider-build identity matches.
  const f = await cliFixture("codex");
  const run = async (flags: string[], response: string, outputRoot: string): Promise<Campaign> => {
    for (const mode of ["raw-full-file", "context-pack"]) f.shim.respond(f.task.id, mode, response);
    const base = [...f.base];
    base[base.indexOf("--out") + 1] = outputRoot;
    const vector = [...base, "--agent", "codex", "--include-real-agents", ...flags, "--agent-campaign", "new"];
    const result = await captureCommand(() => runExperimentRunCommandFromArgs(vector, { context: f.context, campaignRuntime: f.runtime }));
    if (result.code !== 0) throw new Error(`fixture campaign failed (exit ${result.code}): ${result.stderr} ${result.stdout}`);
    return { root: f.root, outputRoot, toolRoot: f.toolRoot, invocations: () => f.shim.invocationKeys() };
  };
  const legacy = await run([], f.response, path.join(f.root, "out-legacy"));
  const strict = await run(["--prompt-template", "strict-diff-v1"], JSON.stringify({ schemaVersion: "1.0.0", patch: f.response }), path.join(f.root, "out-strict"));
  return { legacy, strict, root: f.root };
}

async function digestTree(root: string): Promise<string> {
  const entries = (await readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)).sort();
  const hash = createHash("sha256");
  for (const file of entries) hash.update(path.relative(root, file)).update(await readFile(file));
  return hash.digest("hex");
}

async function copyRoot(source: string): Promise<string> {
  const target = tempRoot();
  await cp(source, target, { recursive: true });
  return target;
}

async function latestGeneration(root: string): Promise<{ file: string; value: Record<string, unknown> }> {
  const stores = ["campaign-checkpoints-v2", "campaign-checkpoints"];
  for (const store of stores) {
    const base = path.join(root, store);
    if (!existsSync(base)) continue;
    const identity = (await readdir(base)).find((name) => /^[a-f0-9]{64}$/.test(name))!;
    const dir = path.join(base, identity);
    const last = (await readdir(dir)).filter((name) => /^generation-\d{10}\.json$/.test(name)).sort().at(-1)!;
    const file = path.join(dir, last);
    return { file, value: JSON.parse(await readFile(file, "utf8")) as Record<string, unknown> };
  }
  throw new Error("no checkpoint");
}

async function resealGeneration(file: string, mutate: (body: Record<string, unknown>) => void): Promise<void> {
  const value = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  const { integrity: _integrity, ...body } = value;
  mutate(body);
  await writeFile(file, `${canonicalCampaignJson({ ...body, integrity: campaignHash(canonicalCampaignJson(body)) })}\n`);
}

async function promptContractFiles(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name === "prompt-contract.json")
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("complete evidence verification against real campaign outputs", () => {
  let legacy: Campaign; // default prompt: V1 identity, per-attempt prompt-contract.json artifacts
  let strict: Campaign; // explicit contract: V2 identity
  let baselineDigest = "";
  let candidateDigest = "";

  beforeAll(async () => {
    const campaigns = await runCampaigns();
    legacy = campaigns.legacy;
    strict = campaigns.strict;
    baselineDigest = await digestTree(legacy.outputRoot);
    candidateDigest = await digestTree(strict.outputRoot);
  }, 900000);

  afterAll(async () => {
    if (legacy) await rm(legacy.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
  });

  const compare = async (baselineRoot: string, candidateRoot: string, extra: { loadTrustedTasks?: (identity: never) => Promise<TrustedTasksResult> } = {}) => {
    const options = { toolRoot: legacy.toolRoot, ...extra } as Parameters<typeof loadPromptComparisonSide>[2];
    const [b, c] = await Promise.all([loadPromptComparisonSide(baselineRoot, "baseline", options), loadPromptComparisonSide(candidateRoot, "candidate", options)]);
    return { b, c, report: buildPromptTemplateComparison(b, c) };
  };

  it("produces a fully verified COMPARABLE comparison from authentic V1 and V2 evidence without invoking a provider", async () => {
    const before = legacy.invocations();
    const { b, c, report } = await compare(legacy.outputRoot, strict.outputRoot);
    expect(b.unverifiable).toEqual([]);
    expect(c.unverifiable).toEqual([]);
    expect(report.comparison.incomparabilityReasons).toEqual([]);
    expect(report.comparison.status).toBe("COMPARABLE");
    expect(report.baseline).toMatchObject({ identitySchema: expect.stringContaining("identity-v1"), promptBasis: "legacy-v1-persisted-contract-artifacts", templateId: "legacy-diff-v1" });
    expect(report.candidate).toMatchObject({ identitySchema: expect.stringContaining("identity-v2"), promptBasis: "campaign-identity-v2-verified-contract", templateId: "strict-diff-v1" });
    expect(report.cohort.matchedUnitCount).toBe(2);
    expect(report.invalidOutput.overall).toMatchObject({ eligibleUnitCount: 2 });
    expect(report.behavioralImprovement.status).toBe("NOT_VERIFIED");
    expect(legacy.invocations()).toEqual(before);
  }, 300000);

  it("does not mutate either source root", async () => {
    await compare(legacy.outputRoot, strict.outputRoot);
    expect(await digestTree(legacy.outputRoot)).toBe(baselineDigest);
    expect(await digestTree(strict.outputRoot)).toBe(candidateDigest);
  }, 300000);

  it("rejects a V1 run whose historical prompt identity cannot be proven", async () => {
    const copy = await copyRoot(legacy.outputRoot);
    for (const file of await promptContractFiles(copy)) await rm(file);
    const { b, report } = await compare(copy, strict.outputRoot);
    expect(b.promptBasis).toBe("unverified");
    expect(b.unverifiable.join(" ")).toMatch(/historical prompt identity cannot be proven/);
    expect(report.comparison.status).toBe("INCOMPARABLE");
    expect(report.invalidOutput.overall).toBeNull();
  }, 300000);

  it("rejects conflicting prompt identities in V1 and V2 evidence", async () => {
    const v1 = await copyRoot(legacy.outputRoot);
    const strictContract = renderPromptContractArtifact(createPromptContract("codex", { templateId: "strict-diff-v1" }));
    await writeFile((await promptContractFiles(v1))[0]!, strictContract);
    expect((await compare(v1, strict.outputRoot)).b.unverifiable.join(" ")).toMatch(/conflicting prompt contracts|legacy default prompt/);
    const v2 = await copyRoot(strict.outputRoot);
    await writeFile((await promptContractFiles(v2))[0]!, renderPromptContractArtifact(createPromptContract("codex")));
    expect((await compare(legacy.outputRoot, v2)).c.unverifiable.join(" ")).toMatch(/PROMPT_CONTRACT_ARTIFACT|does not match the campaign identity/);
  }, 300000);

  it("rejects completed-unit artifact tampering", async () => {
    const copy = await copyRoot(strict.outputRoot);
    const { value } = await latestGeneration(copy);
    const unit = (value.units as Array<{ completion: { artifacts: Array<{ path: string; kind: string }> } | null; epochs?: Array<{ terminal: { artifacts: Array<{ path: string; kind: string }> } | null }> }>)[0]!;
    const artifacts = unit.completion?.artifacts ?? unit.epochs?.[0]?.terminal?.artifacts ?? [];
    const patch = artifacts.find((artifact) => artifact.kind === "patch") ?? artifacts[0]!;
    await writeFile(path.join(copy, ...patch.path.split("/")), "tampered bytes");
    const { c, report } = await compare(legacy.outputRoot, copy);
    expect(c.unverifiable.join(" ")).toMatch(/checkpoint validation failed \(ARTIFACT_INTEGRITY\)/);
    expect(report.comparison.status).toBe("INCOMPARABLE");
  }, 300000);

  it("rejects recomputed integrity over invalid completion data", async () => {
    const copy = await copyRoot(strict.outputRoot);
    const { file } = await latestGeneration(copy);
    await resealGeneration(file, (body) => {
      const units = body.units as Array<{ completion: { taskSuccess: boolean } | null }>;
      const unit = units.find((entry) => entry.completion !== null)!;
      unit.completion!.taskSuccess = !unit.completion!.taskSuccess;
    });
    const { c } = await compare(legacy.outputRoot, copy);
    expect(c.unverifiable.join(" ")).toMatch(/checkpoint validation failed/);
  }, 300000);

  it("rejects an inconsistent V2 checkpoint history", async () => {
    const copy = await copyRoot(strict.outputRoot);
    const dir = path.dirname((await latestGeneration(copy)).file);
    await resealGeneration(path.join(dir, "generation-0000000001.json"), (body) => {
      body.updatedAt = "2099-01-01T00:00:00.000Z";
    });
    expect((await compare(legacy.outputRoot, copy)).c.unverifiable.join(" ")).toMatch(/checkpoint validation failed/);
  }, 300000);

  it("rejects a forged continuation state, a run-id mismatch and conflicting generations", async () => {
    const forged = await copyRoot(strict.outputRoot);
    await resealGeneration((await latestGeneration(forged)).file, (body) => {
      (body.units as Array<{ state: string; completion: unknown }>)[0]!.state = "in-progress";
    });
    expect((await compare(legacy.outputRoot, forged)).c.unverifiable.join(" ")).toMatch(/checkpoint validation failed/);

    const runId = await copyRoot(strict.outputRoot);
    await resealGeneration((await latestGeneration(runId)).file, (body) => {
      body.runId = "some-other-run";
    });
    expect((await compare(legacy.outputRoot, runId)).c.unverifiable.join(" ")).toMatch(/run id does not match/);

    const gap = await copyRoot(strict.outputRoot);
    const latest = await latestGeneration(gap);
    await writeFile(path.join(path.dirname(latest.file), "generation-0000000099.json"), await readFile(latest.file));
    expect((await compare(legacy.outputRoot, gap)).c.unverifiable.join(" ")).toMatch(/checkpoint validation failed/);
  }, 300000);

  it("marks the comparison INCOMPARABLE when the trusted corpus is missing or does not match the identity", async () => {
    const missing = await compare(legacy.outputRoot, strict.outputRoot, { loadTrustedTasks: async () => ({ ok: false, reason: "historical corpus is not available" }) });
    expect(missing.report.comparison.status).toBe("INCOMPARABLE");
    expect(missing.b.unverifiable.join(" ")).toMatch(/needs the trusted task corpus: historical corpus is not available/);

    const corpus = assertReadAgentSuccessCorpus(legacy.toolRoot).tasks;
    const mismatch = await compare(legacy.outputRoot, strict.outputRoot, {
      loadTrustedTasks: (async (identity: { selected: Array<{ caseId: string }> }) => ({
        ok: true,
        tasks: identity.selected.map((row) => ({ ...corpus.find((task) => task.id === row.caseId)!, title: "a different historical title" }))
      })) as never
    });
    expect(mismatch.b.unverifiable.join(" ")).toMatch(/TASK_IDENTITY_MISMATCH/);
    expect(mismatch.report.comparison.status).toBe("INCOMPARABLE");
  }, 300000);

  it("rejects execution evidence that contradicts the validated checkpoint completion", async () => {
    const copy = await copyRoot(strict.outputRoot);
    const file = path.join(copy, "agent-success-rate-execution.json");
    const execution = JSON.parse(await readFile(file, "utf8")) as { cases: Array<{ treatments: Array<{ attempts: Array<{ taskSuccess: boolean | null }> }> }> };
    const attempts = execution.cases[0]!.treatments[0]!.attempts;
    attempts[attempts.length - 1]!.taskSuccess = false;
    await writeFile(file, JSON.stringify(execution));
    const { c } = await compare(legacy.outputRoot, copy);
    expect(c.unverifiable.join(" ")).toMatch(/ARTIFACT_INTEGRITY|contradicts the checkpoint completion evidence|inconsistent/);
  }, 300000);

  it("is routed through the installed CLI, writes only the three report files and leaves sources unchanged", async () => {
    const out = path.join(tempRoot(), "comparison");
    await mkdir(path.dirname(out), { recursive: true });
    const run = await runComparePrompts({ baseline: legacy.outputRoot, candidate: strict.outputRoot, out });
    expect(run.report.comparison.status).toBe("COMPARABLE");
    expect((await readdir(out)).sort()).toEqual(["prompt-template-comparison.html", "prompt-template-comparison.json", "prompt-template-comparison.txt"]);
    expect(await digestTree(legacy.outputRoot)).toBe(baselineDigest);
    expect(await digestTree(strict.outputRoot)).toBe(candidateDigest);
    // Command-level rejections never write.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runComparePromptsCommand(["--baseline", legacy.outputRoot, "--candidate", legacy.outputRoot, "--out", path.join(tempRoot(), "o")])).toBe(1);
    expect(await runComparePromptsCommand(["--baseline", legacy.outputRoot, "--candidate", strict.outputRoot, "--out", path.join(legacy.outputRoot, "nested")])).toBe(1);
    expect(existsSync(path.join(legacy.outputRoot, "nested"))).toBe(false);
  }, 300000);
});

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

describe("gallery integration", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  async function writeComparison(report: PromptTemplateComparisonReportV1): Promise<{ root: string; out: string }> {
    const root = tempRoot();
    const out = path.join(root, "comparison");
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "prompt-template-comparison.json"), renderPromptTemplateComparisonJson(report));
    await writeFile(path.join(out, "prompt-template-comparison.txt"), renderPromptTemplateComparisonText(report));
    await writeFile(path.join(out, "prompt-template-comparison.html"), renderPromptTemplateComparisonHtml(report));
    return { root, out };
  }

  it("recognizes a completed comparison by schema and links validated JSON/HTML/text", async () => {
    const { root, out } = await writeComparison(pair({ cases: cases("c1") }, { cases: cases("c1") }));
    const gallery = path.join(root, "gallery");
    expect(await runBuildGalleryCommand(["--source", out, "--out", gallery])).toBe(0);
    const manifest = JSON.parse(await readFile(path.join(gallery, "gallery-manifest.json"), "utf8")) as { items: Array<Record<string, unknown> & { metrics: Array<{ id: string; value: unknown }>; warnings: string[] }> };
    const item = manifest.items[0]!;
    expect(item).toMatchObject({ kind: "prompt-template-comparison", status: "pass", htmlPath: "../comparison/prompt-template-comparison.html" });
    expect(item.metrics.find((m) => m.id === "behavioral-improvement")?.value).toBe("NOT_VERIFIED");
    const html = await readFile(path.join(gallery, "gallery-index.html"), "utf8");
    expect(html).toContain('href="../comparison/prompt-template-comparison.html"');
    expect(html).not.toMatch(/(?<!NOT_)VERIFIED<\/strong>/);
  });

  it("shows an incomparable comparison as a warning, tolerates missing optional files and fails closed on malformed artifacts", async () => {
    const { root, out } = await writeComparison(pair({ cases: cases("c1"), providerId: "claude" }, { cases: cases("c1") }));
    await rm(path.join(out, "prompt-template-comparison.html"));
    const gallery = path.join(root, "gallery");
    expect(await runBuildGalleryCommand(["--source", path.join(out, "prompt-template-comparison.json"), "--out", gallery])).toBe(0);
    const manifest = JSON.parse(await readFile(path.join(gallery, "gallery-manifest.json"), "utf8")) as { items: Array<{ status: string; htmlPath: string; warnings: string[] }> };
    expect(manifest.items[0]).toMatchObject({ status: "warning", htmlPath: "" });
    expect(manifest.items[0]!.warnings.join(" ")).toMatch(/Incomparable/);

    const file = path.join(out, "prompt-template-comparison.json");
    const doc = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...doc, schemaVersion: "prompt-template-comparison/9.0.0" }));
    expect(await runBuildGalleryCommand(["--source", out, "--out", path.join(root, "g1")])).toBe(1);
    await writeFile(file, JSON.stringify({ ...doc, comparison: { status: "WINNER" } }));
    expect(await runBuildGalleryCommand(["--source", out, "--out", path.join(root, "g2")])).toBe(1);
  });
});
