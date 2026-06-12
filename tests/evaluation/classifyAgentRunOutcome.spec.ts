import { describe, expect, it } from "vitest";
import { classifyAgentRunOutcome } from "../../src/evaluation/index.js";
import { makeAgentRunResult, makeParsedAnswer } from "./experimentTestHelpers.js";

describe("classifyAgentRunOutcome", () => {
  it("classifies completed, unavailable, limits, timeout, failure, and invalid output", () => {
    expect(classifyAgentRunOutcome({ agentRunResult: makeAgentRunResult(), parsedAnswer: makeParsedAnswer() }).status).toBe("completed");
    expect(
      classifyAgentRunOutcome({
        agentRunResult: makeAgentRunResult({ status: "skipped", warnings: ["Codex CLI was not available."] }),
        parsedAnswer: makeParsedAnswer()
      }).status
    ).toBe("agent-unavailable");
    expect(
      classifyAgentRunOutcome({
        agentRunResult: makeAgentRunResult({ status: "failed", errors: ["Usage limit reached."] }),
        parsedAnswer: makeParsedAnswer()
      }).status
    ).toBe("agent-limit-reached");
    expect(
      classifyAgentRunOutcome({
        agentRunResult: makeAgentRunResult({ status: "failed", finalAnswerText: "session limit exhausted" }),
        parsedAnswer: makeParsedAnswer()
      }).status
    ).toBe("agent-limit-reached");
    expect(
      classifyAgentRunOutcome({
        agentRunResult: makeAgentRunResult({ status: "failed", errors: ["Command timed out after 10ms."] }),
        parsedAnswer: makeParsedAnswer()
      }).status
    ).toBe("timeout");
    expect(
      classifyAgentRunOutcome({
        agentRunResult: makeAgentRunResult({ status: "failed", errors: ["Syntax error."] }),
        parsedAnswer: makeParsedAnswer()
      }).status
    ).toBe("failed");
    expect(
      classifyAgentRunOutcome({
        agentRunResult: makeAgentRunResult(),
        parsedAnswer: makeParsedAnswer({ parseStatus: "failed", warnings: ["bad output"] })
      }).status
    ).toBe("invalid-output");
  });

  it("preserves warnings and errors", () => {
    const result = classifyAgentRunOutcome({
      agentRunResult: makeAgentRunResult({ warnings: ["agent warning"], errors: ["agent error"] }),
      parsedAnswer: makeParsedAnswer({ warnings: ["parse warning"] })
    });
    expect(result.warnings).toContain("agent warning");
    expect(result.warnings).toContain("parse warning");
    expect(result.errors).toContain("agent error");
  });
});
