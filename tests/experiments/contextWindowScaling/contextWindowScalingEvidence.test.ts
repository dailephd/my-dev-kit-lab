import { describe, expect, it } from "vitest";
import {
  buildBudgetCell,
  computeRelevantFileEvidence,
  deriveSuccessEvidence,
  normalizeRepositoryRelativePath,
  toCorrectnessEvidence,
} from "../../../src/experiments/plugins/contextWindowScaling/index.js";

const PASS = { availability: "available", score: 1, pass: true } as const;
const FAIL = { availability: "available", score: 0.4, pass: false } as const;
const UNAVAILABLE = { availability: "unavailable", score: null, pass: null } as const;

describe("success evidence truth table", () => {
  it.each([
    ["fits", PASS, { status: "available", success: true, reason: "correctness-pass" }],
    ["fits", FAIL, { status: "available", success: false, reason: "correctness-fail" }],
    ["fits", UNAVAILABLE, { status: "unavailable", success: null, reason: "evaluation-unavailable" }],
    ["context-too-large", UNAVAILABLE, { status: "available", success: false, reason: "context-too-large" }],
    ["context-too-large", PASS, { status: "available", success: false, reason: "context-too-large" }],
    ["unavailable", UNAVAILABLE, { status: "unavailable", success: null, reason: "context-unavailable" }],
  ] as const)("%s + correctness %j => %j", (contextFitStatus, correctness, expected) => {
    expect(deriveSuccessEvidence({ contextFitStatus, correctness })).toEqual(expected);
  });

  it("maps scorer output without inventing a threshold", () => {
    expect(toCorrectnessEvidence({ available: true, score: 0.69, passed: true })).toEqual({
      availability: "available",
      score: 0.69,
      pass: true,
    });
    expect(toCorrectnessEvidence({ available: true, score: 0.99, passed: false }).pass).toBe(false);
    expect(toCorrectnessEvidence({ available: false, score: null, passed: null })).toEqual(UNAVAILABLE);
    expect(toCorrectnessEvidence({ available: true, score: null, passed: true })).toEqual(UNAVAILABLE);
  });
});

describe("budget cells", () => {
  it("keeps unavailable correctness null (never 0/false) for context-too-large", () => {
    const cell = buildBudgetCell({ contextBudgetTokens: 8192, contextEstimatedTokens: 8193, shared: PASS });
    expect(cell).toMatchObject({
      contextFitStatus: "context-too-large",
      evaluationStatus: "not-evaluated-context-too-large",
      correctness: { availability: "unavailable", score: null, pass: null },
      successEvidence: { status: "available", success: false, reason: "context-too-large" },
    });
  });

  it.each([
    [4096, 50],
    [8192, 100],
    [12288, 150],
  ])("persists exact uncapped utilization for %i tokens against 8192", (tokens, percent) => {
    expect(buildBudgetCell({ contextBudgetTokens: 8192, contextEstimatedTokens: tokens, shared: PASS }).contextBudgetUtilizationPercent).toBe(percent);
  });

  it("shares one evaluation across fitting cells and treats an exact boundary as fitting", () => {
    const cells = [8192, 16384].map((contextBudgetTokens) =>
      buildBudgetCell({ contextBudgetTokens, contextEstimatedTokens: 8192, shared: PASS })
    );
    expect(cells.map((cell) => cell.contextFitStatus)).toEqual(["fits", "fits"]);
    expect(cells.every((cell) => cell.successEvidence.success === true)).toBe(true);
  });

  it("marks everything unavailable when the context was never measured", () => {
    expect(buildBudgetCell({ contextBudgetTokens: 8192, contextEstimatedTokens: null, shared: null })).toMatchObject({
      contextFitStatus: "unavailable",
      contextBudgetUtilizationPercent: null,
      evaluationStatus: "unavailable",
      successEvidence: { status: "unavailable", success: null, reason: "context-unavailable" },
    });
  });
});

describe("omitted relevant file evidence", () => {
  it("reports zero omitted when every expected file was observed", () => {
    expect(computeRelevantFileEvidence({ expectedFiles: ["src/a.ts", "src/b.ts"], observedFiles: ["src/b.ts", "src/a.ts", "src/c.ts"] })).toMatchObject({
      status: "available",
      expectedRelevantFileCount: 2,
      observedExpectedFileCount: 2,
      omittedRelevantFileCount: 0,
      omittedRelevantFiles: [],
    });
  });

  it("reports the exact omitted file and a stable multi-file list in expected order", () => {
    expect(computeRelevantFileEvidence({ expectedFiles: ["src/a.ts", "src/b.ts"], observedFiles: ["src/a.ts"] })).toMatchObject({
      omittedRelevantFileCount: 1,
      omittedRelevantFiles: ["src/b.ts"],
    });
    expect(computeRelevantFileEvidence({ expectedFiles: ["z.ts", "a.ts", "m.ts"], observedFiles: ["m.ts"] }).omittedRelevantFiles).toEqual(["z.ts", "a.ts"]);
  });

  it("is not-applicable without expected files", () => {
    expect(computeRelevantFileEvidence({ expectedFiles: [], observedFiles: ["src/a.ts"] })).toMatchObject({
      status: "not-applicable",
      omittedRelevantFileCount: null,
    });
  });

  it("is unavailable when observed provenance is unavailable or not repository-relative", () => {
    expect(computeRelevantFileEvidence({ expectedFiles: ["src/a.ts"], observedFiles: null })).toMatchObject({
      status: "unavailable",
      omittedRelevantFileCount: null,
      expectedRelevantFiles: ["src/a.ts"],
    });
    expect(computeRelevantFileEvidence({ expectedFiles: ["src/a.ts"], observedFiles: ["C:/repo/src/a.ts"] }).status).toBe("unavailable");
  });

  it("normalizes separators and leading ./ but preserves case", () => {
    expect(normalizeRepositoryRelativePath(".\\src\\Tasks\\A.ts")).toBe("src/Tasks/A.ts");
    expect(computeRelevantFileEvidence({ expectedFiles: ["src/Tasks/A.ts"], observedFiles: ["./src\\Tasks\\A.ts"] }).omittedRelevantFileCount).toBe(0);
    expect(computeRelevantFileEvidence({ expectedFiles: ["src/Tasks/A.ts"], observedFiles: ["src/tasks/a.ts"] }).omittedRelevantFiles).toEqual(["src/Tasks/A.ts"]);
  });

  it.each(["", "/abs/a.ts", "../a.ts", "src//a.ts", "C:\\a.ts"])("rejects %j as an identity", (value) => {
    expect(normalizeRepositoryRelativePath(value)).toBeNull();
  });
});
