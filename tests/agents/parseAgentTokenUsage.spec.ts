import { describe, expect, it } from "vitest";
import { parseAgentTokenUsage } from "../../src/agents/index.js";

describe("parseAgentTokenUsage", () => {
  it("P2-TEL-007 keeps alias maximum precedence within one record and warns", () => {
    const result = parseAgentTokenUsage('{"usage":{"input_tokens":10,"inputTokens":12,"output_tokens":3,"total_tokens":99}}');
    expect(result.tokenUsage).toMatchObject({ inputTokens: 12, outputTokens: 3, totalTokens: 99 });
    expect(result.warnings.join(" ")).toContain("Conflicting token aliases");
  });

  it.each([
    '{"usage":{"input_tokens":10}}\n{"usage":{"output_tokens":20}}',
    '[{"usage":{"input_tokens":10}},{"usage":{"output_tokens":20}}]'
  ])("P2-TEL-007 does not combine independent records: %s", (text) => {
    const result = parseAgentTokenUsage(text);
    expect(result.tokenUsage).toMatchObject({ inputTokens: 10, totalTokens: 10 });
    expect(result.tokenUsage.outputTokens).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("without combining attempts");
  });

  it.each([-1, 1.5, "10", null])("P2-TEL-006 rejects invalid JSON count %s without clamping", (count) => {
    const result = parseAgentTokenUsage(JSON.stringify({ usage: { total_tokens: count, input_tokens: 2 } }));
    expect(result.tokenUsage.totalTokens).toBe(2); // existing component-derived total
    expect(result.warnings.join(" ")).toContain("Invalid token count");
  });

  it.each(["input tokens: -1", "input tokens: 1.5", "input tokens: 1e3", "input tokens: Infinity"])("rejects invalid text counts: %s", (text) => {
    expect(parseAgentTokenUsage(text).tokenUsageSource).toBe("unavailable");
  });

  it("ignores unrelated payload fields and token-looking answer text", () => {
    const result = parseAgentTokenUsage(JSON.stringify({ result: "input tokens: 900", tool: { total_tokens: 900 }, usage: { input_tokens: 4, output_tokens: 2 } }));
    expect(result.tokenUsage.totalTokens).toBe(6);
    expect(parseAgentTokenUsage('{"result":"input tokens: 900"}').tokenUsageSource).toBe("unavailable");
  });

  it("bounds deep envelope traversal with a fixed warning", () => {
    let envelope: unknown = { usage: { total_tokens: 2 } };
    for (let i = 0; i < 30; i++) envelope = { response: envelope };
    const result = parseAgentTokenUsage(JSON.stringify(envelope));
    expect(result.tokenUsageSource).toBe("unavailable");
    expect(result.warnings.join(" ")).toContain("traversal limit");
  });
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

  describe("v0.5.2 Batch 2 -- realistic nested Codex JSONL regression fixtures", () => {
    it("recovers usage nested inside a realistic Codex event stream without modifying the parser", () => {
      const jsonl = [
        JSON.stringify({ type: "thread.started", thread_id: "t1" }),
        JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "ls" } }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "final answer" } }),
        JSON.stringify({
          type: "turn.completed",
          turn_id: "turn-1",
          usage: { input_tokens: 120, output_tokens: 45, total_tokens: 165, reasoning_tokens: 8 }
        })
      ].join("\n");
      const result = parseAgentTokenUsage(jsonl);
      expect(result.tokenUsage.inputTokens).toBe(120);
      expect(result.tokenUsage.outputTokens).toBe(45);
      expect(result.tokenUsage.totalTokens).toBe(165);
      expect(result.tokenUsage.reasoningTokens).toBe(8);
      expect(result.tokenUsageSource).toBe("cli-json");
      expect(result.tokenUsageReliability).toBe("high");
    });
  });

  describe("v0.5.2 Batch 2 -- Claude JSON usage regression fixtures", () => {
    it("parses nested usage fields from a realistic Claude JSON result envelope", () => {
      const result = parseAgentTokenUsage(
        JSON.stringify({
          result: "final benchmark answer",
          session_id: "fixture",
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2 }
        })
      );
      expect(result.tokenUsage.inputTokens).toBe(10);
      expect(result.tokenUsage.outputTokens).toBe(5);
      expect(result.tokenUsage.cachedInputTokens).toBe(2);
      expect(result.tokenUsageSource).toBe("cli-json");
    });

    it("reports unavailable (never a fabricated zero) for valid Claude JSON without usage", () => {
      const result = parseAgentTokenUsage(JSON.stringify({ result: "final benchmark answer", session_id: "fixture" }));
      expect(result.tokenUsageSource).toBe("unavailable");
      expect(result.tokenUsageReliability).toBe("unavailable");
      expect(result.tokenUsage.totalTokens).toBeUndefined();
      expect(result.tokenUsage.inputTokens).toBeUndefined();
    });
  });
});
