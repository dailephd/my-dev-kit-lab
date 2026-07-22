import { describe, expect, it } from "vitest";
import { validateV043RunAssuranceConfig } from "../../../src/experiments/plugins/contextStrategyComparison/validateV043RunAssuranceConfig.js";

function validTargetConfig() {
  return { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] };
}

describe("validateV043RunAssuranceConfig", () => {
  it("RUN-001 undefined config resolves to repeatCount 1", () => {
    const result = validateV043RunAssuranceConfig(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.repeatCount).toBe(1);
      expect(result.config.targetImmutability).toBeUndefined();
    }
  });

  it("RUN-002 a repeatCount of 1 succeeds", () => {
    const result = validateV043RunAssuranceConfig({ repeatCount: 1 });
    expect(result.ok).toBe(true);
  });

  it("RUN-003 a repeatCount of 10 succeeds", () => {
    const result = validateV043RunAssuranceConfig({ repeatCount: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.repeatCount).toBe(10);
  });

  it("RUN-004 a repeatCount of 0 fails", () => {
    const result = validateV043RunAssuranceConfig({ repeatCount: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "INVALID_REPEAT_COUNT")).toBe(true);
  });

  it("RUN-005 a repeatCount of 11 fails", () => {
    const result = validateV043RunAssuranceConfig({ repeatCount: 11 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "INVALID_REPEAT_COUNT")).toBe(true);
  });

  it("RUN-006 a noninteger repeatCount fails", () => {
    const result = validateV043RunAssuranceConfig({ repeatCount: 1.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "INVALID_REPEAT_COUNT")).toBe(true);
  });

  it("RUN-007 a string repeatCount fails", () => {
    const result = validateV043RunAssuranceConfig({ repeatCount: "3" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "INVALID_REPEAT_COUNT")).toBe(true);
  });

  it("RUN-008 a valid target config succeeds", () => {
    const result = validateV043RunAssuranceConfig({ targetImmutability: validTargetConfig() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.targetImmutability).toEqual(validTargetConfig());
  });

  it("RUN-009 an invalid target config fails", () => {
    const result = validateV043RunAssuranceConfig({ targetImmutability: { targetRootPath: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "INVALID_TARGET_IMMUTABILITY_CONFIG")).toBe(true);
  });

  it("RUN-010 nested target issues remain under targetImmutability", () => {
    const result = validateV043RunAssuranceConfig({ targetImmutability: { targetRootPath: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.code === "INVALID_TARGET_IMMUTABILITY_CONFIG");
      expect(issue?.fieldPath).toBe("targetImmutability");
      expect(Array.isArray(issue?.details)).toBe(true);
    }
  });

  it("RUN-011 unknown root fields fail", () => {
    const result = validateV043RunAssuranceConfig({ extraField: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "UNKNOWN_CONFIG_FIELD")).toBe(true);
  });

  it("RUN-012 validation returns all issues", () => {
    const result = validateV043RunAssuranceConfig({ repeatCount: 0, targetImmutability: { targetRootPath: "" }, extra: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("UNKNOWN_CONFIG_FIELD");
      expect(codes).toContain("INVALID_REPEAT_COUNT");
      expect(codes).toContain("INVALID_TARGET_IMMUTABILITY_CONFIG");
    }
  });

  it("RUN-013 validation performs no filesystem access", () => {
    const result = validateV043RunAssuranceConfig({ targetImmutability: { targetRootPath: "does/not/exist", relativeFilePaths: ["a.ts"] } });
    expect(result.ok).toBe(true);
  });

  it("RUN-014 validation does not mutate the input", () => {
    const input = { repeatCount: 2, targetImmutability: validTargetConfig() };
    const before = JSON.stringify(input);
    validateV043RunAssuranceConfig(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
