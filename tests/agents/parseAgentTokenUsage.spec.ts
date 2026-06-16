import { describe, expect, it } from "vitest";
import { parseAgentTokenUsage } from "../../src/agents/index.js";

describe("parseAgentTokenUsage", () => {
  it("parses snake_case JSON usage fields", () => {
    const result = parseAgentTokenUsage(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }));
    expect(result.tokenUsage.inputTokens).toBe(10);
    expect(result.tokenUsage.outputTokens).toBe(5);
    expect(result.tokenUsage.totalTokens).toBe(15);
    expect(result.tokenUsageSource).toBe("cli-json");
    expect(result.tokenUsageReliability).toBe("high");
  });

  it("parses camelCase JSON usage fields", () => {
    const result = parseAgentTokenUsage(JSON.stringify({ inputTokens: 12, outputTokens: 8, totalTokens: 20 }));
    expect(result.tokenUsage.inputTokens).toBe(12);
    expect(result.tokenUsage.outputTokens).toBe(8);
    expect(result.tokenUsage.totalTokens).toBe(20);
  });

  it("parses JSONL usage events and ignores malformed lines", () => {
    const result = parseAgentTokenUsage(['{"event":"message"}', "{not json", '{"usage":{"input_tokens":21,"output_tokens":4}}'].join("\n"));
    expect(result.tokenUsage.inputTokens).toBe(21);
    expect(result.tokenUsage.outputTokens).toBe(4);
    expect(result.tokenUsage.totalTokens).toBe(25);
  });

  it("parses plain text token lines", () => {
    const result = parseAgentTokenUsage("input tokens: 30\noutput tokens: 7\ntotal tokens: 37");
    expect(result.tokenUsage.inputTokens).toBe(30);
    expect(result.tokenUsage.outputTokens).toBe(7);
    expect(result.tokenUsage.totalTokens).toBe(37);
    expect(result.tokenUsageSource).toBe("agent-reported");
    expect(result.tokenUsageReliability).toBe("medium");
  });

  it("handles missing token usage", () => {
    const result = parseAgentTokenUsage("No usage metadata here.");
    expect(result.tokenUsageSource).toBe("unavailable");
    expect(result.tokenUsageReliability).toBe("unavailable");
    expect(result.warnings[0]).toContain("not found");
  });

  it("handles partial token usage", () => {
    const result = parseAgentTokenUsage("total tokens: 100");
    expect(result.tokenUsage.totalTokens).toBe(100);
    expect(result.tokenUsageReliability).toBe("low");
    expect(result.warnings[0]).toContain("partial");
  });
});
