import { mkdtempSync } from "node:fs";
import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseComparePromptsArgs, runComparePromptsCommand } from "../../../src/commands/runComparePromptsCommand.js";
import { runBuildGalleryCommand } from "../../../src/commands/buildGalleryCommand.js";
import { runLabCli } from "../../../src/cli/runLabCli.js";
import { loadPromptComparisonSide } from "../../../src/report/experiments/promptTemplateComparisonEvidence.js";
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
import { writeComparisonRun, type CaseSpec, type RunSpec } from "./promptComparisonFixtures.js";

const tempDirs: string[] = [];
let stderr: string[] = [];

beforeEach(() => {
  stderr = [];
  vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
    stderr.push(String(message));
  });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "prompt-cmp-"));
  tempDirs.push(dir);
  return dir;
}

const cases = (...ids: string[]): CaseSpec[] => ids.map((caseId) => ({ caseId }));

async function pair(
  baseline: Partial<RunSpec> & Pick<RunSpec, "cases">,
  candidate: Partial<RunSpec> & Pick<RunSpec, "cases">
): Promise<{ report: PromptTemplateComparisonReportV1; root: string; base: string; cand: string }> {
  const root = tempRoot();
  const base = path.join(root, "baseline");
  const cand = path.join(root, "candidate");
  await writeComparisonRun(base, { runId: "run-base", templateId: "legacy-diff-v1", ...baseline });
  await writeComparisonRun(cand, { runId: "run-cand", templateId: "strict-diff-v1", ...candidate });
  const [b, c] = await Promise.all([loadPromptComparisonSide(base, "baseline"), loadPromptComparisonSide(cand, "candidate")]);
  return { report: buildPromptTemplateComparison(b, c), root, base, cand };
}

const OUTPUT_INVALID = { finalAnswer: true, errors: ["OUTPUT_CONTRACT_STRICT_NOT_JSON"], patchOutcome: "parse-failure" as const, patchCode: "NO_DIFF", failureCategory: "patch-malformed", taskSuccess: false };

describe("identity and comparability", () => {
  it("compares verified V2 prompt contracts with different templates", async () => {
    const { report } = await pair({ cases: cases("c1", "c2") }, { cases: cases("c1", "c2") });
    expect(report.comparison.status).toBe("COMPARABLE");
    expect(report.baseline).toMatchObject({ templateId: "legacy-diff-v1", promptBasis: "campaign-identity-v2-verified-contract" });
    expect(report.candidate).toMatchObject({ templateId: "strict-diff-v1" });
    expect(report.baseline.promptContractDigest).not.toBe(report.candidate.promptContractDigest);
    expect(report.comparison.winner).toBeNull();
    expect(report.criteria.find((c) => c.id === "prompt-template")?.status).toBe("not-required");
  });

  it("accepts a legacy V1 real-provider identity as the legacy default and never fabricates a template for fixtures", async () => {
    const { report } = await pair({ cases: cases("c1"), identity: "v1", omitContractArtifacts: true }, { cases: cases("c1") });
    expect(report.comparison.status).toBe("COMPARABLE");
    expect(report.baseline).toMatchObject({ promptBasis: "legacy-v1-default-identity", templateId: "legacy-diff-v1", identitySchema: expect.stringContaining("identity-v1") });
    expect(report.limitations.join(" ")).toMatch(/legacy V1/);
  });

  it("marks evidence with an unverifiable prompt identity INCOMPARABLE", async () => {
    const { report } = await pair({ cases: cases("c1"), omitContractArtifacts: true }, { cases: cases("c1") });
    expect(report.comparison.status).toBe("INCOMPARABLE");
    expect(report.comparison.incomparabilityReasons.join(" ")).toMatch(/baseline: .*prompt-contract/);
    expect(report.comparison.winner).toBeNull();
    expect(report.invalidOutput.strata).toEqual([]);
  });

  it("rejects tampered prompt-contract artifacts and checkpoints as incomparable", async () => {
    const tamperedContract = await pair({ cases: cases("c1"), tamperContractArtifact: true }, { cases: cases("c1") });
    expect(tamperedContract.report.comparison.status).toBe("INCOMPARABLE");
    expect(tamperedContract.report.comparison.incomparabilityReasons.join(" ")).toMatch(/does not match the campaign identity/);
    const tamperedCheckpoint = await pair({ cases: cases("c1") }, { cases: cases("c1"), tamperCheckpoint: true });
    expect(tamperedCheckpoint.report.comparison.status).toBe("INCOMPARABLE");
    expect(tamperedCheckpoint.report.comparison.incomparabilityReasons.join(" ")).toMatch(/integrity digest does not verify/);
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
  ])("is INCOMPARABLE on %s mismatch", async (_label, change, pattern) => {
    const { report } = await pair({ cases: cases("c1") }, { cases: cases("c1"), ...(change as Partial<RunSpec>) });
    expect(report.comparison.status).toBe("INCOMPARABLE");
    expect(report.comparison.incomparabilityReasons.join(" ")).toMatch(pattern);
    expect(report.comparison.winner).toBeNull();
  });

  it("treats one-sided missing provider-build evidence as unverifiable", async () => {
    const { report } = await pair({ cases: cases("c1") }, { cases: cases("c1"), componentOverrides: { providerBuild: null } });
    expect(report.comparison.status).toBe("INCOMPARABLE");
    expect(report.criteria.find((c) => c.id === "component-providerBuild")?.status).toBe("unverifiable");
  });

  it("matches shared cases and excludes unmatched or task-mismatched cases with reasons", async () => {
    const { report } = await pair(
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
    expect(report.criteria.find((c) => c.id === "component-tasks")?.status).toBe("not-required");
  });
});

describe("invalid-output measurement", () => {
  it("classifies responses by persisted contract evidence", () => {
    const unit = (spec: Record<string, unknown>, status = "completed") =>
      ({
        attempt: { providerStatus: status, failureCategory: spec.failureCategory ?? "none" },
        evidence: {
          errors: ((spec.errors as string[]) ?? []).map((code) => ({ code, message: "" })),
          patch: { outcome: spec.patchOutcome ?? "success", code: spec.patchCode ?? null },
          realAgent: { providerStatus: status, finalAnswerAvailable: spec.finalAnswer ?? true }
        },
        attemptNumber: 1,
        taskSuccess: null
      }) as never;
    expect(classifyResponseValidity(unit({}))).toMatchObject({ eligible: true, invalid: false });
    expect(classifyResponseValidity(unit({ errors: ["OUTPUT_CONTRACT_STRICT_MARKDOWN_FENCE"] }))).toMatchObject({ eligible: true, invalid: true, reason: "OUTPUT_CONTRACT_STRICT_MARKDOWN_FENCE" });
    expect(classifyResponseValidity(unit({ patchOutcome: "parse-failure", patchCode: "NO_DIFF" }))).toMatchObject({ invalid: true, reason: "malformed-diff:NO_DIFF" });
    for (const [status, reason] of [["timeout", "provider-timeout"], ["agent-unavailable", "provider-unavailable"], ["agent-limit-reached", "provider-limit-reached"], ["failed", "provider-failure"], ["not-invoked", "provider-not-invoked"]] as const) {
      expect(classifyResponseValidity(unit({}, status))).toMatchObject({ eligible: false, invalid: false, reason });
    }
    expect(classifyResponseValidity(unit({ finalAnswer: false, failureCategory: "provider-empty-answer" }))).toMatchObject({ eligible: true, invalid: true, reason: "provider-empty-answer" });
    expect(classifyResponseValidity(unit({ patchOutcome: "policy-rejection" }))).toMatchObject({ eligible: true, invalid: false });
    expect(classifyResponseValidity(unit({ patchOutcome: "git-apply-failure" }))).toMatchObject({ eligible: true, invalid: false });
    expect(classifyResponseValidity(unit({ failureCategory: "task-check-failed" }))).toMatchObject({ eligible: true, invalid: false });
    expect(classifyResponseValidity(unit({ failureCategory: "infrastructure-failure" }))).toMatchObject({ eligible: false });
  });

  it("computes counts, rates and the percentage-point difference over the matched eligible cohort", async () => {
    const { report } = await pair(
      {
        cases: [
          { caseId: "c1", raw: OUTPUT_INVALID, pack: OUTPUT_INVALID },
          { caseId: "c2", raw: OUTPUT_INVALID },
          { caseId: "c3" },
          { caseId: "c4" }
        ]
      },
      { cases: [{ caseId: "c1", raw: OUTPUT_INVALID }, { caseId: "c2" }, { caseId: "c3" }, { caseId: "c4" }] }
    );
    const raw = report.invalidOutput.strata.find((s) => s.stratum === "raw-full-file")!;
    expect(raw.eligibleUnitCount).toBe(4);
    expect(raw.baseline).toMatchObject({ numerator: 2, denominator: 4, ratePercent: 50 });
    expect(raw.candidate).toMatchObject({ numerator: 1, denominator: 4, ratePercent: 25 });
    expect(raw.percentagePointDifference).toBe(25);
    const pack = report.invalidOutput.strata.find((s) => s.stratum === "context-pack")!;
    expect(pack.baseline).toMatchObject({ numerator: 1, denominator: 4, ratePercent: 25 });
    expect(pack.candidate).toMatchObject({ numerator: 0, ratePercent: 0 });
    expect(report.invalidOutput.overall).toMatchObject({ eligibleUnitCount: 8, percentagePointDifference: 25 });
    expect(report.invalidOutput.overall!.baseline.invalidByReason).toEqual({ OUTPUT_CONTRACT_STRICT_NOT_JSON: 3 });
  });

  it("excludes provider and infrastructure outcomes from the denominator for both sides", async () => {
    const { report } = await pair(
      { cases: [{ caseId: "c1", raw: { status: "timeout", finalAnswer: false, patchOutcome: null, failureCategory: "provider-timeout", taskSuccess: null } }, { caseId: "c2" }] },
      { cases: [{ caseId: "c1" }, { caseId: "c2", raw: { status: "agent-unavailable", finalAnswer: false, patchOutcome: null, failureCategory: "provider-unavailable", taskSuccess: null } }] }
    );
    const raw = report.invalidOutput.strata.find((s) => s.stratum === "raw-full-file")!;
    expect(raw.eligibleUnitCount).toBe(0);
    expect(raw.baseline).toMatchObject({ denominator: 0, availability: "unavailable", ratePercent: null });
    expect(raw.percentagePointDifference).toBeNull();
    expect(raw.reason).toMatch(/unavailable, not zero percent/);
    expect(report.cohort.exclusionReasonCounts).toEqual({ "baseline:provider-timeout": 1, "candidate:provider-unavailable": 1 });
    expect(report.cohort.excludedUnitCount).toBe(2);
  });

  it("keeps task-verification and policy failures out of the invalid-output numerator", async () => {
    const { report } = await pair(
      { cases: [{ caseId: "c1", raw: { patchOutcome: "policy-rejection", failureCategory: "patch-policy-rejected", taskSuccess: false }, pack: { failureCategory: "task-check-failed", taskSuccess: false } }] },
      { cases: [{ caseId: "c1" }] }
    );
    expect(report.invalidOutput.overall!.baseline).toMatchObject({ numerator: 0, denominator: 2, ratePercent: 0 });
    expect(report.taskSuccess.overall!.final).toMatchObject({ baselineSuccessCount: 0, candidateSuccessCount: 2, denominator: 2 });
  });

  it("separates first-attempt validity from repair attempts and final outcomes", async () => {
    const { report } = await pair(
      {
        repairAttempts: 1,
        cases: [{ caseId: "c1", raw: { ...OUTPUT_INVALID, repair: { status: "completed", finalAnswer: true, patchOutcome: "success", failureCategory: "none", taskSuccess: true } } }]
      },
      { repairAttempts: 1, cases: [{ caseId: "c1" }] }
    );
    const raw = report.invalidOutput.strata.find((s) => s.stratum === "raw-full-file")!;
    expect(raw.baseline).toMatchObject({ numerator: 1, denominator: 1, ratePercent: 100 });
    expect(report.invalidOutput.repairAttemptSummary).toEqual([
      expect.objectContaining({ attemptNumber: 2, baselineEligible: 1, baselineInvalid: 0, repairAllowance: 1 })
    ]);
    const finalBasis = report.taskSuccess.strata.find((s) => s.stratum === "raw-full-file")!;
    expect(finalBasis.initial.baselineSuccessCount).toBe(0);
    expect(finalBasis.final.baselineSuccessCount).toBe(1);
  });

  it("reports task success separately and never counts an invalid response as a success", async () => {
    const { report } = await pair(
      { cases: [{ caseId: "c1", raw: OUTPUT_INVALID }] },
      { cases: [{ caseId: "c1", raw: { taskSuccess: null, failureCategory: "evidence-incomplete" } }] }
    );
    expect(report.taskSuccess.separateFromInvalidOutput).toBe(true);
    const raw = report.taskSuccess.strata.find((s) => s.stratum === "raw-full-file")!;
    expect(raw.unavailableUnitCount).toBe(1);
    const pack = report.taskSuccess.strata.find((s) => s.stratum === "context-pack")!;
    expect(pack.final).toMatchObject({ bothSucceeded: 1, denominator: 1 });
    expect(report.invalidOutput.strata.find((s) => s.stratum === "raw-full-file")!.eligibleUnitCount).toBe(0);
  });
});

describe("reports", () => {
  it("renders deterministic JSON, text and HTML with required fields and no private paths", async () => {
    const { report, root } = await pair({ cases: [{ caseId: "c1", raw: OUTPUT_INVALID }] }, { cases: cases("c1") });
    const json = renderPromptTemplateComparisonJson(report);
    expect(renderPromptTemplateComparisonJson(report)).toBe(json);
    const parsed = JSON.parse(json) as PromptTemplateComparisonReportV1;
    expect(parsed.schemaVersion).toBe("prompt-template-comparison/1.0.0");
    expect(parsed.behavioralImprovement.status).toBe("NOT_VERIFIED");
    expect(parsed.provenance.providerInvoked).toBe(false);
    for (const output of [json, renderPromptTemplateComparisonText(report), renderPromptTemplateComparisonHtml(report)]) {
      expect(output).not.toContain(root);
      expect(output).not.toMatch(/[A-Za-z]:\\\\Users|\/home\//);
    }
    const text = renderPromptTemplateComparisonText(report);
    expect(text).toMatch(/Comparison status: COMPARABLE/);
    expect(text).toMatch(/Behavioral improvement: NOT_VERIFIED/);
    expect(text).toMatch(/difference \(baseline minus candidate\): \+/);
    const html = renderPromptTemplateComparisonHtml(report);
    expect(html).not.toMatch(/<script|https?:\/\/|<link\b|<img\b|(?:src|href)=/i);
    expect(html).toContain('<th scope="col">');
  });

  it("escapes hostile text in HTML and renders incomparable reports without a winner", async () => {
    const { report } = await pair({ cases: cases("c1"), providerId: "claude" }, { cases: cases("c1") });
    expect(report.comparison.status).toBe("INCOMPARABLE");
    const hostile = { ...report, warnings: ['<script>alert(1)</script>"><img src=x onerror=alert(2)>'] };
    const html = renderPromptTemplateComparisonHtml(hostile);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(renderPromptTemplateComparisonText(report)).toMatch(/Incomparability reasons/);
    expect(renderPromptTemplateComparisonText(report)).toMatch(/Winner: none declared/);
    expect(report.invalidOutput.overall).toBeNull();
  });
});

describe("compare-prompts command", () => {
  it("requires --baseline, --candidate and --out exactly once and rejects unknown input", () => {
    expect(() => parseComparePromptsArgs(["--baseline", "a", "--candidate", "b"])).toThrow(/Missing required option: --out/);
    expect(() => parseComparePromptsArgs(["--baseline", "a", "--baseline", "c", "--candidate", "b", "--out", "o"])).toThrow(/Duplicate option: --baseline/);
    expect(() => parseComparePromptsArgs(["--baseline", "a", "--candidate", "b", "--out", "o", "--force"])).toThrow(/Unknown option/);
    expect(() => parseComparePromptsArgs(["--baseline", "", "--candidate", "b", "--out", "o"])).toThrow(/non-empty/);
    expect(() => parseComparePromptsArgs(["--baseline", "--candidate", "b", "--out", "o"])).toThrow(/non-empty/);
    expect(() => parseComparePromptsArgs(["stray"])).toThrow(/Unexpected argument/);
    expect(parseComparePromptsArgs(["--out", "o", "--candidate", "b", "--baseline", "a"])).toEqual({ baseline: "a", candidate: "b", out: "o" });
  });

  it("writes exactly the three report files, does not mutate sources, and is routed by the report family", async () => {
    const { root, base, cand } = await pair({ cases: cases("c1") }, { cases: cases("c1") });
    const before = JSON.stringify([await readdir(base, { recursive: true }), await readdir(cand, { recursive: true })]);
    const beforeExec = await readFile(path.join(base, "agent-success-rate-execution.json"), "utf8");
    const out = path.join(root, "out");
    const stdout: string[] = [];
    const code = await runLabCli(["report", "compare-prompts", "--baseline", base, "--candidate", cand, "--out", out], { stdout: (m: string) => stdout.push(m), stderr: (m: string) => stderr.push(m) } as never);
    expect(code).toBe(0);
    expect((await readdir(out)).sort()).toEqual(["prompt-template-comparison.html", "prompt-template-comparison.json", "prompt-template-comparison.txt"]);
    expect(JSON.stringify([await readdir(base, { recursive: true }), await readdir(cand, { recursive: true })])).toBe(before);
    expect(await readFile(path.join(base, "agent-success-rate-execution.json"), "utf8")).toBe(beforeExec);
  });

  it("rejects identical roots, overlapping output roots and unreadable evidence", async () => {
    const { root, base, cand } = await pair({ cases: cases("c1") }, { cases: cases("c1") });
    expect(await runComparePromptsCommand(["--baseline", base, "--candidate", base, "--out", path.join(root, "o1")])).toBe(1);
    expect(stderr.join("\n")).toMatch(/identical/);
    expect(await runComparePromptsCommand(["--baseline", base, "--candidate", cand, "--out", path.join(base, "nested")])).toBe(1);
    expect(stderr.join("\n")).toMatch(/must not overlap/);
    expect(await runComparePromptsCommand(["--baseline", base, "--candidate", cand, "--out", root])).toBe(1);
    expect(await runComparePromptsCommand(["--baseline", path.join(root, "missing"), "--candidate", cand, "--out", path.join(root, "o2")])).toBe(1);
    expect(stderr.join("\n")).toMatch(/unreadable or invalid/);
    const bad = path.join(root, "bad");
    await mkdir(bad);
    await writeFile(path.join(bad, "agent-success-rate-execution.json"), JSON.stringify({ schemaVersion: "nope" }));
    expect(await runComparePromptsCommand(["--baseline", bad, "--candidate", cand, "--out", path.join(root, "o3")])).toBe(1);
    expect(stderr.join("\n")).toMatch(/schema is not supported/);
  });

  it("rejects an execution artifact that escapes the run root through a link", async () => {
    const { root, cand } = await pair({ cases: cases("c1") }, { cases: cases("c1") });
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "agent-success-rate-execution.json"), await readFile(path.join(cand, "agent-success-rate-execution.json")));
    const linked = path.join(root, "linked");
    await mkdir(linked);
    await symlink(path.join(outside, "agent-success-rate-execution.json"), path.join(linked, "agent-success-rate-execution.json"), "file").catch(() => undefined);
    const side = await loadPromptComparisonSide(linked, "baseline");
    expect(side.execution).toBeNull();
    expect(side.unverifiable.join(" ")).toMatch(/execution evidence/);
  });
});

describe("gallery integration", () => {
  async function comparisonOutput(candidateChange: Partial<RunSpec> = {}) {
    const { root, base, cand } = await pair({ cases: cases("c1") }, { cases: cases("c1"), ...candidateChange });
    const out = path.join(root, "comparison");
    expect(await runComparePromptsCommand(["--baseline", base, "--candidate", cand, "--out", out])).toBe(0);
    return { root, out };
  }

  it("recognizes a completed comparison by schema and links validated JSON/HTML/text", async () => {
    const { root, out } = await comparisonOutput();
    const gallery = path.join(root, "gallery");
    expect(await runBuildGalleryCommand(["--source", out, "--out", gallery])).toBe(0);
    const manifest = JSON.parse(await readFile(path.join(gallery, "gallery-manifest.json"), "utf8")) as { items: Array<Record<string, unknown>> };
    const item = manifest.items[0] as Record<string, unknown> & { metrics: Array<{ id: string; value: unknown }>; warnings: string[] };
    expect(item).toMatchObject({ kind: "prompt-template-comparison", sourceFamily: "prompt-template-comparison", status: "pass", htmlPath: "../comparison/prompt-template-comparison.html" });
    expect(item.metrics.find((m) => m.id === "behavioral-improvement")?.value).toBe("NOT_VERIFIED");
    expect(item.metrics.find((m) => m.id === "baseline-template")?.value).toBe("legacy-diff-v1");
    expect(item.warnings.join(" ")).toMatch(/NOT_VERIFIED/);
    const html = await readFile(path.join(gallery, "gallery-index.html"), "utf8");
    expect(html).toContain('href="../comparison/prompt-template-comparison.html"');
    expect(html).not.toMatch(/(?<!NOT_)VERIFIED<\/strong>/);
  });

  it("shows an incomparable comparison as a warning and tolerates missing optional files", async () => {
    const { root, out } = await comparisonOutput({ providerId: "claude" });
    await rm(path.join(out, "prompt-template-comparison.html"));
    const gallery = path.join(root, "gallery");
    expect(await runBuildGalleryCommand(["--source", path.join(out, "prompt-template-comparison.json"), "--out", gallery])).toBe(0);
    const manifest = JSON.parse(await readFile(path.join(gallery, "gallery-manifest.json"), "utf8")) as { items: Array<{ status: string; htmlPath: string; warnings: string[] }> };
    expect(manifest.items[0]).toMatchObject({ status: "warning", htmlPath: "" });
    expect(manifest.items[0]!.warnings.join(" ")).toMatch(/Incomparable/);
    expect(manifest.items[0]!.warnings.join(" ")).toMatch(/HTML comparison report unavailable/);
  });

  it("fails closed on malformed or unsupported comparison artifacts", async () => {
    const { root, out } = await comparisonOutput();
    const file = path.join(out, "prompt-template-comparison.json");
    const doc = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...doc, schemaVersion: "prompt-template-comparison/9.0.0" }));
    expect(await runBuildGalleryCommand(["--source", out, "--out", path.join(root, "g1")])).toBe(1);
    expect(stderr.join("\n")).toMatch(/unsupported prompt comparison schemaVersion/);
    await writeFile(file, JSON.stringify({ ...doc, comparison: { status: "WINNER" } }));
    expect(await runBuildGalleryCommand(["--source", out, "--out", path.join(root, "g2")])).toBe(1);
    expect(stderr.join("\n")).toMatch(/malformed prompt comparison/);
  });
});
