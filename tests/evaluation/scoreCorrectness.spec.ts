import { describe, expect, it } from "vitest";
import { scoreCorrectness } from "../../src/evaluation/index.js";
import type { BenchmarkTaskAnswerKey } from "../../src/evaluation/types.js";
import { loadExperimentFixtures, makeParsedAnswer } from "./experimentTestHelpers.js";

describe("scoreCorrectness", () => {
  it("passes a full match and includes the formula string", async () => {
    const { cases } = await loadExperimentFixtures();
    const score = scoreCorrectness({ caseId: cases[0].id, answerKey: cases[0].answerKey!, parsedAnswer: makeParsedAnswer() });
    expect(score.passed).toBe(true);
    expect(score.correctnessScore).toBe(1);
    expect(score.formula).toContain("correctnessScore");
  });

  it("fails for missing required facts and too few minimumCorrectFacts", async () => {
    const { cases } = await loadExperimentFixtures();
    const score = scoreCorrectness({
      caseId: cases[0].id,
      answerKey: cases[0].answerKey!,
      parsedAnswer: makeParsedAnswer({ expectedFactsFound: ["create-deterministic-id"] })
    });
    expect(score.passed).toBe(false);
    expect(score.failureReasons.some((reason) => reason.includes("missing required fact"))).toBe(true);
    expect(score.failureReasons.some((reason) => reason.includes("too few facts"))).toBe(true);
  });

  it("lowers file and symbol scores when expected targets are missing", async () => {
    const { cases } = await loadExperimentFixtures();
    const score = scoreCorrectness({
      caseId: cases[0].id,
      answerKey: cases[0].answerKey!,
      parsedAnswer: makeParsedAnswer({ relevantFiles: ["src/taskService.ts"], relevantSymbols: ["createTask"] })
    });
    expect(score.fileMatchScore).toBe(0.5);
    expect(score.symbolMatchScore).toBe(0.5);
    expect(score.failureReasons).toContain("missing expected file");
    expect(score.failureReasons).toContain("missing expected symbol");
  });

  it("uses weighted fact scoring, handles invalid output and agent-limit statuses, and avoids divide by zero", () => {
    const answerKey: BenchmarkTaskAnswerKey = {
      expectedFiles: [],
      expectedSymbols: [],
      expectedFacts: [
        { id: "heavy", text: "Heavy fact", weight: 3, required: true },
        { id: "light", text: "Light fact", weight: 1, required: false }
      ],
      minimumCorrectFacts: 1
    };
    const score = scoreCorrectness({
      caseId: "case",
      answerKey,
      parsedAnswer: makeParsedAnswer({ relevantFiles: [], relevantSymbols: [], expectedFactsFound: ["heavy"] })
    });
    expect(score.fileMatchScore).toBe(1);
    expect(score.symbolMatchScore).toBe(1);
    expect(score.factMatchScore).toBe(0.75);

    const invalid = scoreCorrectness({
      caseId: "case",
      answerKey,
      parsedAnswer: makeParsedAnswer({ parseStatus: "failed", expectedFactsFound: [] }),
      status: "invalid-output"
    });
    expect(invalid.passed).toBe(false);
    expect(invalid.failureReasons).toContain("invalid output");

    const limited = scoreCorrectness({
      caseId: "case",
      answerKey,
      parsedAnswer: makeParsedAnswer(),
      status: "agent-limit-reached"
    });
    expect(limited.passed).toBe(false);
    expect(limited.failureReasons).toContain("agent limit reached");
  });
});
