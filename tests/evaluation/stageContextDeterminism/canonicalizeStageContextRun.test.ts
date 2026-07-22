import { describe, expect, it } from "vitest";
import { canonicalizeStageContextRun } from "../../../src/evaluation/stageContextDeterminism/canonicalizeStageContextRun.js";

describe("canonicalizeStageContextRun", () => {
  it("DET-001 primitive values serialize deterministically", () => {
    expect(canonicalizeStageContextRun("hello")).toBe('"hello"');
    expect(canonicalizeStageContextRun(42)).toBe("42");
    expect(canonicalizeStageContextRun(true)).toBe("true");
    expect(canonicalizeStageContextRun(false)).toBe("false");
  });

  it("DET-002 object keys are recursively sorted", () => {
    const result = canonicalizeStageContextRun({ b: 1, a: 2 });
    expect(result).toBe('{"a":2,"b":1}');
  });

  it("DET-003 array order is preserved", () => {
    const result = canonicalizeStageContextRun([3, 1, 2]);
    expect(result).toBe("[3,1,2]");
  });

  it("DET-004 nested object keys are sorted", () => {
    const result = canonicalizeStageContextRun({ z: { d: 1, c: 2 }, a: 1 });
    expect(result).toBe('{"a":1,"z":{"c":2,"d":1}}');
  });

  it("DET-005 string values remain exact", () => {
    expect(canonicalizeStageContextRun("Exact Value")).toBe('"Exact Value"');
  });

  it("DET-006 path separators remain exact", () => {
    expect(canonicalizeStageContextRun("src\\windows\\path.ts")).toBe(JSON.stringify("src\\windows\\path.ts"));
  });

  it("DET-007 case remains exact", () => {
    expect(canonicalizeStageContextRun("MixedCase")).toBe('"MixedCase"');
  });

  it("DET-008 whitespace remains exact", () => {
    expect(canonicalizeStageContextRun("  spaced  ")).toBe('"  spaced  "');
  });

  it("DET-009 null remains null", () => {
    expect(canonicalizeStageContextRun(null)).toBe("null");
    expect(canonicalizeStageContextRun({ a: null })).toBe('{"a":null}');
  });

  it("DET-010 undefined object properties are omitted", () => {
    const result = canonicalizeStageContextRun({ a: 1, b: undefined });
    expect(result).toBe('{"a":1}');
  });

  it("DET-011 undefined array entries become null", () => {
    const result = canonicalizeStageContextRun([1, undefined, 3]);
    expect(result).toBe("[1,null,3]");
  });

  it("DET-012 BigInt fails", () => {
    expect(() => canonicalizeStageContextRun(10n)).toThrow();
  });

  it("DET-013 function values fail", () => {
    expect(() => canonicalizeStageContextRun(() => {})).toThrow();
    expect(() => canonicalizeStageContextRun({ fn: () => {} })).toThrow();
  });

  it("DET-014 symbol values fail", () => {
    expect(() => canonicalizeStageContextRun(Symbol("x"))).toThrow();
  });

  it("DET-015 circular structures fail", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => canonicalizeStageContextRun(obj)).toThrow();
  });

  it("DET-016 NaN fails", () => {
    expect(() => canonicalizeStageContextRun(NaN)).toThrow();
  });

  it("DET-017 Infinity fails", () => {
    expect(() => canonicalizeStageContextRun(Infinity)).toThrow();
  });

  it("DET-018 negative Infinity fails", () => {
    expect(() => canonicalizeStageContextRun(-Infinity)).toThrow();
  });

  it("DET-019 no final newline is added", () => {
    const result = canonicalizeStageContextRun({ a: 1 });
    expect(result.endsWith("\n")).toBe(false);
  });

  it("DET-020 no indentation is added", () => {
    const result = canonicalizeStageContextRun({ a: 1, b: [1, 2] });
    expect(result).toBe('{"a":1,"b":[1,2]}');
    expect(result).not.toContain("\n");
    expect(result).not.toContain("  ");
  });

  it("DET-021 input values are not mutated", () => {
    const input = { b: 1, a: { d: 2, c: 3 } };
    const before = JSON.stringify(input);
    canonicalizeStageContextRun(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
