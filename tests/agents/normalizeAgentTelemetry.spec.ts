import { describe, expect, it } from "vitest";
import {
  normalizeAgentDurationV091,
  normalizeAgentTokenUsageV091,
  parseAgentTokenUsage,
  type AgentProviderOutcomeV091,
  type AgentTelemetryEvidenceLevelV091,
  type AgentTokenUsage,
  type NormalizedAgentTelemetryV091,
  type TokenUsageReliability,
  type TokenUsageSource
} from "../../src/agents/index.js";

describe("normalizeAgentTokenUsageV091", () => {
  const mapping: Array<[TokenUsageSource, AgentTelemetryEvidenceLevelV091]> = [
    ["provider-reported", "provider-reported"],
    ["agent-reported", "parsed-from-output"],
    ["cli-json", "cli-reported"],
    ["otel", "unavailable"],
    ["estimated-from-text", "estimated"],
    ["unavailable", "unavailable"]
  ];

  it.each(mapping)("TEL-001 maps %s to %s and retains the original source", (source, evidenceLevel) => {
    expect(normalizeAgentTokenUsageV091({ source, totalTokens: 7 }, "medium")).toMatchObject({ source, evidenceLevel, totalTokens: 7 });
  });

  const reliabilities: TokenUsageReliability[] = ["high", "medium", "low", "unavailable"];
  it.each(reliabilities)("TEL-002 retains legacy reliability %s independently of classification", (reliability) => {
    for (const [source, evidenceLevel] of mapping) {
      expect(normalizeAgentTokenUsageV091({ source }, reliability)).toMatchObject({ source, reliability, evidenceLevel });
    }
  });

  it("TEL-003 missing counts remain null with reasons; observed zero remains available", () => {
    const missing = normalizeAgentTokenUsageV091({ source: "cli-json" }, "low");
    expect(missing).toMatchObject({
      totalTokens: null, inputTokens: null, outputTokens: null, cachedInputTokens: null, reasoningTokens: null,
      numericAvailability: "unavailable", condition: "token-unavailable", evidenceLevel: "cli-reported"
    });
    expect(Object.values(missing.numericReasons)).toEqual(Array(5).fill("missing-token-count"));
    const zero = normalizeAgentTokenUsageV091({ source: "provider-reported", totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 }, "high");
    expect(zero).toMatchObject({ totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, numericAvailability: "available", condition: "token-available" });
    expect(Object.values(zero.numericReasons)).toEqual(Array(5).fill(null));
  });

  const fields = ["totalTokens", "inputTokens", "outputTokens", "cachedInputTokens", "reasoningTokens"] as const;
  it.each([-1, 1.5, NaN, Infinity, -Infinity])("TEL-004 rejects invalid count %s in every field without mutation", (value) => {
    for (const field of fields) {
      const input = Object.freeze({ source: "cli-json" as const, [field]: value });
      const result = normalizeAgentTokenUsageV091(input, "high");
      expect(result[field]).toBeNull();
      expect(result.numericReasons[field]).toBe("invalid-token-count");
      expect(result.numericAvailability).toBe("unavailable");
      expect(input[field]).toBe(value);
    }
  });

  it.each(fields)("TEL-005 preserves a sole valid %s without requiring the other counts", (field) => {
    const result = normalizeAgentTokenUsageV091({ source: "cli-json", [field]: 11 }, "low");
    expect(result[field]).toBe(11);
    expect(result.numericAvailability).toBe("available");
    for (const other of fields.filter((key) => key !== field)) expect(result[other]).toBeNull();
  });

  it("TEL-004/005 invalid and missing counts do not erase valid siblings or reconcile supplied totals", () => {
    const input = Object.freeze({ source: "cli-json" as const, totalTokens: 99, inputTokens: 4, outputTokens: 3, cachedInputTokens: -1 });
    expect(normalizeAgentTokenUsageV091(input, "high")).toMatchObject({ totalTokens: 99, inputTokens: 4, outputTokens: 3, cachedInputTokens: null, reasoningTokens: null, numericAvailability: "available" });
    expect(input.cachedInputTokens).toBe(-1);
  });

  it("TEL-006 unattributed OTel preserves numeric evidence without claiming provider attribution", () => {
    const result = normalizeAgentTokenUsageV091({ source: "otel", totalTokens: 21 }, "high");
    expect(result).toMatchObject({ source: "otel", reliability: "high", evidenceLevel: "unavailable", classificationReason: "unattributed-source", numericAvailability: "available", condition: "token-available", totalTokens: 21 });
    expect(normalizeAgentTokenUsageV091({ source: "otel" }, "low")).toMatchObject({ classificationReason: "unattributed-source", numericAvailability: "unavailable" });
    expect(normalizeAgentTokenUsageV091({ source: "unavailable", inputTokens: 3 }, "unavailable")).toMatchObject({ classificationReason: "source-unavailable", inputTokens: 3, numericAvailability: "available" });
  });

  it("TEL-007 preserves estimates as estimates and does not manufacture totals", () => {
    expect(normalizeAgentTokenUsageV091({ source: "estimated-from-text", inputTokens: 8 }, "low")).toMatchObject({ evidenceLevel: "estimated", inputTokens: 8, totalTokens: null });
    expect(normalizeAgentTokenUsageV091({ source: "estimated-from-text", totalTokens: 8 }, "low")).toMatchObject({ evidenceLevel: "estimated", totalTokens: 8 });
  });

  it("TEL-008 excludes raw output and extra sensitive fields without mutating the input", () => {
    const input = Object.freeze({ source: "otel" as const, totalTokens: -1, rawText: "PRIVATE_OUTPUT_MARKER", promptText: "PRIVATE_PROMPT_MARKER", cwd: "PRIVATE_PATH_MARKER", credentials: "PRIVATE_CREDENTIAL_MARKER" });
    const before = { ...input };
    const result = normalizeAgentTokenUsageV091(input, "high");
    for (const marker of [input.rawText, input.promptText, input.cwd, input.credentials]) expect(JSON.stringify(result)).not.toContain(marker);
    for (const key of ["rawText", "promptText", "cwd", "credentials"]) expect(result).not.toHaveProperty(key);
    expect(input).toEqual(before);
  });

  it.each([
    ['{"usage":{"input_tokens":10,"output_tokens":5}}', "cli-reported", 15],
    ['{"event":"message"}\n{"usage":{"input_tokens":21,"output_tokens":4}}', "cli-reported", 25],
    ["input tokens: 10\noutput tokens: 5", "parsed-from-output", 15],
    ['{"usage":{"input_tokens":10}}', "cli-reported", 10]
  ] as const)("TEL-011 preserves parser-derived totals while classifying the channel: %s", (text, evidenceLevel, totalTokens) => {
    const parsed = parseAgentTokenUsage(text);
    const before = structuredClone(parsed);
    const result = normalizeAgentTokenUsageV091(parsed.tokenUsage, parsed.tokenUsageReliability);
    expect(parsed.tokenUsage.totalTokens).toBe(totalTokens);
    expect(result).toMatchObject({ source: parsed.tokenUsageSource, reliability: parsed.tokenUsageReliability, evidenceLevel, totalTokens });
    expect(parsed).toEqual(before);
    expect(result).not.toHaveProperty("rawText");
  });
});

describe("normalizeAgentDurationV091", () => {
  it.each([0, 12.5, 100])("TEL-009 attributes valid duration %s to Lab wall-clock timing", (durationMs) => {
    expect(normalizeAgentDurationV091(durationMs)).toEqual({ durationMs, source: "lab-wall-clock", reason: null });
  });
  it.each([null, undefined])("TEL-009 absent duration %s is unavailable", (durationMs) => {
    expect(normalizeAgentDurationV091(durationMs)).toEqual({ durationMs: null, source: "unavailable", reason: "missing-duration" });
  });
  it.each([-1, NaN, Infinity, -Infinity])("TEL-009 invalid duration %s is unavailable", (durationMs) => {
    expect(normalizeAgentDurationV091(durationMs)).toEqual({ durationMs: null, source: "unavailable", reason: "invalid-duration" });
  });
});

describe("normalized execution and telemetry separation", () => {
  const outcomes: AgentProviderOutcomeV091[] = ["completed", "failed", "timeout", "invalid-output", "agent-unavailable", "agent-limit-reached", "skipped", "not-invoked"];
  it.each(outcomes)("TEL-010 token absence can coexist with %s without rewriting task evidence", (providerStatus) => {
    const evaluation = Object.freeze({ taskSuccess: true, evidenceCompleteness: "complete" as const });
    const telemetry: NormalizedAgentTelemetryV091 = {
      providerStatus,
      tokenUsage: normalizeAgentTokenUsageV091({ source: "unavailable" }, "unavailable"),
      duration: normalizeAgentDurationV091(undefined)
    };
    expect(telemetry.providerStatus).toBe(providerStatus);
    expect(telemetry.tokenUsage.condition).toBe("token-unavailable");
    expect(evaluation).toEqual({ taskSuccess: true, evidenceCompleteness: "complete" });
  });
});
