import { describe, expect, it } from "vitest";
import {
  PAYLOAD_GROUPS,
  getPayloadsForGroup,
  getPayloadsForScenario,
  registerScenarioPayloadGroups,
  redactPayloadPreview,
} from "../../../src/securityValidation/attackScenarios/payloadCorpus.js";

describe("payload corpus", () => {
  it("returns deterministic payloads for every known group", () => {
    for (const group of PAYLOAD_GROUPS) {
      const first = getPayloadsForGroup(group);
      const second = getPayloadsForGroup(group);
      expect(first).toEqual(second);
      expect(first.length).toBeGreaterThan(0);
      for (const p of first) {
        expect(p.group).toBe(group);
        expect(typeof p.id).toBe("string");
        expect(typeof p.value).toBe("string");
      }
    }
  });

  it("returns a fresh copy each call (mutation-safe)", () => {
    const a = getPayloadsForGroup("path-traversal");
    a.push({ id: "injected", group: "path-traversal", value: "x", description: "x" });
    const b = getPayloadsForGroup("path-traversal");
    expect(b.length).toBeLessThan(a.length);
  });

  it("handles unknown groups safely (no throw, empty array)", () => {
    expect(() => getPayloadsForGroup("not-a-real-group")).not.toThrow();
    expect(getPayloadsForGroup("not-a-real-group")).toEqual([]);
  });

  it("bounds oversized-input payloads to a safe, deterministic length", () => {
    const payloads = getPayloadsForGroup("oversized-input");
    for (const p of payloads) {
      expect(p.value.length).toBeLessThanOrEqual(5000);
    }
  });

  it("getPayloadsForScenario returns [] for unregistered scenario ids", () => {
    expect(getPayloadsForScenario("no-such-scenario")).toEqual([]);
  });

  it("getPayloadsForScenario returns payloads once a scenario is registered", () => {
    registerScenarioPayloadGroups("test-scenario-batch2", ["path-traversal", "subprocess-injection"]);
    const payloads = getPayloadsForScenario("test-scenario-batch2");
    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads.every((p) => p.group === "path-traversal" || p.group === "subprocess-injection")).toBe(true);
  });

  it("redactPayloadPreview redacts secret-looking payload values", () => {
    const [secretPayload] = getPayloadsForGroup("secret-looking");
    const preview = redactPayloadPreview(secretPayload);
    expect(preview).not.toBe(secretPayload.value);
    expect(preview).toContain("REDACTED");
  });
});
