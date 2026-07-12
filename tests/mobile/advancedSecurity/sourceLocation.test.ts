import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAndroidSourceLocation } from "../../../src/mobile/android/advancedSecurity/sourceLocation.js";

// ANDROID-V041-B1-04 — source-location normalization: Windows/POSIX/space
// handling, target containment, forward-slash stability.
describe("buildAndroidSourceLocation", () => {
  const root = path.resolve("tests/fixtures/android/advanced-security-fixtures/resource-resolution/module-a");

  it("normalizes to a forward-slash target-relative path", () => {
    const filePath = path.join(root, "src", "main", "res", "xml", "network_security_config.xml");
    const location = buildAndroidSourceLocation(root, filePath, { line: 3, column: 5 });
    expect(location.path).toBe("src/main/res/xml/network_security_config.xml");
    expect(location.path).not.toContain("\\");
  });

  it("carries optional line/column through unchanged", () => {
    const filePath = path.join(root, "src", "main", "res", "xml", "network_security_config.xml");
    const location = buildAndroidSourceLocation(root, filePath, { line: 10, column: 2 });
    expect(location.line).toBe(10);
    expect(location.column).toBe(2);
  });

  it("omits line/column when not supplied", () => {
    const filePath = path.join(root, "src", "main", "res", "xml", "network_security_config.xml");
    const location = buildAndroidSourceLocation(root, filePath);
    expect(location.line).toBeUndefined();
    expect(location.column).toBeUndefined();
  });

  it("handles a path containing spaces", () => {
    const spacedRoot = path.resolve("tests/fixtures/android/advanced-security-fixtures/secret-candidates");
    const filePath = path.join(spacedRoot, "SampleActivity.kt");
    const location = buildAndroidSourceLocation(spacedRoot, filePath);
    expect(location.path).toBe("SampleActivity.kt");
  });

  it("rejects a path that escapes root", () => {
    const outsidePath = path.resolve("package.json");
    expect(() => buildAndroidSourceLocation(root, outsidePath)).toThrow(/escapes target root/);
  });

  it("carries an optional start/end range", () => {
    const filePath = path.join(root, "src", "main", "res", "xml", "backup_rules.xml");
    const location = buildAndroidSourceLocation(root, filePath, { startLine: 2, endLine: 4 });
    expect(location.startLine).toBe(2);
    expect(location.endLine).toBe(4);
  });
});
