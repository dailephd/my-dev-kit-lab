import { describe, expect, it } from "vitest";
import { parseClaudeFinalAnswer } from "../../src/agents/adapters/claudeAdapter.js";
import { parseCodexFinalAnswer } from "../../src/agents/adapters/codexAdapter.js";
import { validateAgentSuccessFinalAnswer } from "../../src/experiments/plugins/agentSuccessRate/strictDiffResponse.js";

const DIFF = "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-x\n+y\n";
const STRICT = JSON.stringify({ schemaVersion: "1.0.0", patch: DIFF });
const settings = { templateId: "strict-diff-v1", explanationMode: "legacy" } as const;
const codexLine = (text: string): string => JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } });
const validate = (text: string) => validateAgentSuccessFinalAnswer(settings, text);

describe("strict output validation is applied after provider transport extraction", () => {
  it("Codex JSONL with a valid final answer validates", () => {
    const stdout = [JSON.stringify({ type: "thread.started" }), codexLine(STRICT), JSON.stringify({ type: "turn.completed", usage: { total_tokens: 1 } })].join("\n");
    const parsed = parseCodexFinalAnswer(stdout);
    expect(parsed.finalAnswerParseStatus).toBe("parsed");
    expect(validate(parsed.finalAnswerText)).toEqual({ ok: true, patchText: DIFF });
  });

  it("Codex uses the last agent message; an earlier valid message cannot rescue an invalid final one", () => {
    const stdout = [codexLine(STRICT), codexLine("All done, hope that helps!")].join("\n");
    const parsed = parseCodexFinalAnswer(stdout);
    expect(parsed.finalAnswerText).toBe("All done, hope that helps!");
    expect(validate(parsed.finalAnswerText).ok).toBe(false);
    const reversed = parseCodexFinalAnswer([codexLine("thinking out loud"), codexLine(STRICT)].join("\n"));
    expect(validate(reversed.finalAnswerText)).toEqual({ ok: true, patchText: DIFF });
  });

  it("Codex malformed event lines are ignored and never become the answer", () => {
    const stdout = ["{not json", codexLine(STRICT), "}{"].join("\n");
    expect(validate(parseCodexFinalAnswer(stdout).finalAnswerText)).toEqual({ ok: true, patchText: DIFF });
  });

  it("a Codex transcript without a completed answer cannot be accepted as a strict response", () => {
    const stdout = [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "turn.completed" })].join("\n");
    const parsed = parseCodexFinalAnswer(stdout);
    expect(validate(parsed.finalAnswerText).ok).toBe(false);
  });

  it("Claude result envelope validates the inner result only", () => {
    const parsed = parseClaudeFinalAnswer(JSON.stringify({ result: STRICT, session_id: "s" }));
    expect(parsed.finalAnswerParseStatus).toBe("parsed");
    expect(validate(parsed.finalAnswerText)).toEqual({ ok: true, patchText: DIFF });
  });

  it("malformed or result-less Claude envelopes yield an empty answer that strict validation rejects", () => {
    for (const stdout of ['{"result": ', JSON.stringify({ session_id: "s" }), JSON.stringify({ result: 5 }), "[]"]) {
      const parsed = parseClaudeFinalAnswer(stdout);
      expect(parsed.finalAnswerText).toBe("");
      expect(validate(parsed.finalAnswerText)).toEqual({ ok: false, code: "STRICT_EMPTY_RESPONSE" });
    }
  });

  it("legacy plain-text output still parses at transport level but fails the strict schema", () => {
    const parsed = parseClaudeFinalAnswer(DIFF);
    expect(parsed.finalAnswerText.length).toBeGreaterThan(0);
    expect(validate(parsed.finalAnswerText).ok).toBe(false);
  });

  it("an entire provider envelope presented as the response is not a StrictDiffResponseV1", () => {
    const envelope = JSON.stringify({ result: STRICT, session_id: "s" });
    expect(validate(envelope)).toEqual({ ok: false, code: "STRICT_UNKNOWN_FIELD" });
    expect(validate([codexLine(STRICT), codexLine(STRICT)].join("\n"))).toEqual({ ok: false, code: "STRICT_MULTIPLE_DOCUMENTS" });
  });
});
