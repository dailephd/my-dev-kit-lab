import { describe, expect, it } from "vitest";
import { validateTargetImmutabilityConfig } from "../../../src/evaluation/targetImmutability/validateTargetImmutabilityConfig.js";

function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    targetRootPath: "Z:/fixture/target",
    relativeFilePaths: ["src/example.ts"],
    ...overrides
  };
}

describe("validateTargetImmutabilityConfig", () => {
  it("IMM-001 a valid config succeeds", () => {
    const result = validateTargetImmutabilityConfig(validConfig());
    expect(result.ok).toBe(true);
  });

  it("IMM-002 success returns the exact original object", () => {
    const input = validConfig();
    const result = validateTargetImmutabilityConfig(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toBe(input);
  });

  it("IMM-003 a non-object config fails", () => {
    expect(validateTargetImmutabilityConfig("string").ok).toBe(false);
    expect(validateTargetImmutabilityConfig(42).ok).toBe(false);
    expect(validateTargetImmutabilityConfig(null).ok).toBe(false);
    expect(validateTargetImmutabilityConfig([]).ok).toBe(false);
  });

  it("IMM-004 unknown root fields fail", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ extraField: "x" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "UNKNOWN_CONFIG_FIELD")).toBe(true);
  });

  it("IMM-005 missing targetRootPath fails", () => {
    const config = validConfig();
    delete (config as Record<string, unknown>).targetRootPath;
    const result = validateTargetImmutabilityConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "MISSING_REQUIRED_FIELD" && i.fieldPath === "targetRootPath")).toBe(true);
  });

  it("IMM-006 missing relativeFilePaths fails", () => {
    const config = validConfig();
    delete (config as Record<string, unknown>).relativeFilePaths;
    const result = validateTargetImmutabilityConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "MISSING_REQUIRED_FIELD" && i.fieldPath === "relativeFilePaths")).toBe(true);
    }
  });

  it("IMM-007 empty targetRootPath fails", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ targetRootPath: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "EMPTY_TARGET_ROOT_PATH")).toBe(true);
  });

  it("IMM-008 whitespace-only targetRootPath fails", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ targetRootPath: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "EMPTY_TARGET_ROOT_PATH")).toBe(true);
  });

  it("IMM-009 empty relativeFilePaths fails", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "EMPTY_RELATIVE_FILE_SET")).toBe(true);
  });

  it("IMM-010 more than 100 paths fails", () => {
    const paths = Array.from({ length: 101 }, (_, i) => `src/file-${i}.ts`);
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: paths }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "TOO_MANY_RELATIVE_FILES")).toBe(true);
  });

  it("IMM-011 a non-string relative path fails", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: [42] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "INVALID_FIELD_TYPE")).toBe(true);
  });

  it("IMM-012 an empty relative path fails", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: [""] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "EMPTY_RELATIVE_FILE_PATH")).toBe(true);
  });

  it("IMM-013 a whitespace-only relative path fails", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: ["   "] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "EMPTY_RELATIVE_FILE_PATH")).toBe(true);
  });

  it("IMM-014 a Windows absolute path fails", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: ["C:\\src\\example.ts"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "ABSOLUTE_RELATIVE_FILE_PATH")).toBe(true);
  });

  it("IMM-015 a POSIX absolute path fails", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: ["/src/example.ts"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "ABSOLUTE_RELATIVE_FILE_PATH")).toBe(true);
  });

  it("IMM-016 a parent traversal using slash fails", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: ["../secret.ts"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "RELATIVE_FILE_PATH_TRAVERSAL")).toBe(true);
  });

  it("IMM-017 a parent traversal using backslash fails", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: ["..\\secret.ts"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "RELATIVE_FILE_PATH_TRAVERSAL")).toBe(true);
  });

  it("IMM-018 a filename containing two dots without a traversal segment succeeds", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: ["src/file..name.ts"] }));
    expect(result.ok).toBe(true);
  });

  it("IMM-019 exact duplicate relative paths fail", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: ["src/a.ts", "src/a.ts"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "DUPLICATE_RELATIVE_FILE_PATH")).toBe(true);
  });

  it("IMM-020 case-different relative paths remain distinct", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: ["src/a.ts", "SRC/A.TS"] }));
    expect(result.ok).toBe(true);
  });

  it("IMM-021 slash-different relative paths remain distinct", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ relativeFilePaths: ["src/a.ts", "src\\a.ts"] }));
    expect(result.ok).toBe(true);
  });

  it("IMM-022 paths are not normalized", () => {
    const input = validConfig({ relativeFilePaths: ["./src/./a.ts"] });
    const result = validateTargetImmutabilityConfig(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.relativeFilePaths[0]).toBe("./src/./a.ts");
  });

  it("IMM-023 validation returns all issues", () => {
    const result = validateTargetImmutabilityConfig({
      targetRootPath: "",
      relativeFilePaths: ["", "/abs.ts", "../trav.ts"],
      extraField: "x"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("UNKNOWN_CONFIG_FIELD");
      expect(codes).toContain("EMPTY_TARGET_ROOT_PATH");
      expect(codes).toContain("EMPTY_RELATIVE_FILE_PATH");
      expect(codes).toContain("ABSOLUTE_RELATIVE_FILE_PATH");
      expect(codes).toContain("RELATIVE_FILE_PATH_TRAVERSAL");
    }
  });

  it("IMM-024 validation performs no filesystem access", () => {
    const result = validateTargetImmutabilityConfig(validConfig({ targetRootPath: "does/not/exist" }));
    expect(result.ok).toBe(true);
  });

  it("IMM-025 validation does not mutate the config", () => {
    const input = validConfig();
    const before = JSON.stringify(input);
    validateTargetImmutabilityConfig(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
