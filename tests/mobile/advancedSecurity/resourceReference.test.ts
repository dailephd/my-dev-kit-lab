import { describe, expect, it } from "vitest";
import { parseAndroidResourceReference } from "../../../src/mobile/android/advancedSecurity/resourceReference.js";

// ANDROID-V041-B1-09 — XML resource reference parsing boundaries.
describe("parseAndroidResourceReference", () => {
  it("parses a standard @xml reference", () => {
    const result = parseAndroidResourceReference("@xml/network_security_config");
    expect(result).toEqual({ state: "parsed", raw: "@xml/network_security_config", type: "xml", name: "network_security_config" });
  });

  it("parses a reference with surrounding whitespace", () => {
    const result = parseAndroidResourceReference("  @xml/backup_rules  ");
    expect(result.state).toBe("parsed");
    if (result.state === "parsed") {
      expect(result.name).toBe("backup_rules");
    }
  });

  it("reports an empty reference distinctly", () => {
    expect(parseAndroidResourceReference("")).toEqual({ state: "empty", raw: "" });
  });

  it("reports a whitespace-only reference as malformed", () => {
    const result = parseAndroidResourceReference("   ");
    expect(result.state).toBe("malformed");
  });

  it("reports a reference missing the leading @ as malformed", () => {
    const result = parseAndroidResourceReference("xml/network_security_config");
    expect(result.state).toBe("malformed");
  });

  it("reports a reference missing a name as malformed", () => {
    const result = parseAndroidResourceReference("@xml/");
    expect(result.state).toBe("malformed");
  });

  it("reports a reference missing a type separator as malformed", () => {
    const result = parseAndroidResourceReference("@xmlnetworksecurityconfig");
    expect(result.state).toBe("malformed");
  });

  it("reports an unsupported resource type", () => {
    const result = parseAndroidResourceReference("@string/app_name");
    expect(result.state).toBe("unsupported-type");
    if (result.state === "unsupported-type") {
      expect(result.type).toBe("string");
    }
  });

  it("reports a package-qualified external reference distinctly", () => {
    const result = parseAndroidResourceReference("@com.example.lib:xml/network_security_config");
    expect(result.state).toBe("package-qualified");
    if (result.state === "package-qualified") {
      expect(result.packageQualifier).toBe("com.example.lib");
      expect(result.name).toBe("network_security_config");
    }
  });

  it("reports an unresolved build-variable placeholder distinctly", () => {
    const result = parseAndroidResourceReference("${networkSecurityConfig}");
    expect(result.state).toBe("placeholder");
  });

  it("never throws for adversarial input", () => {
    const adversarial = ["@", "@:", "@:/", "@xml/../../etc/passwd", "@xml/UPPER_CASE", "@@xml/name", "\0", "@xml/na me"];
    for (const input of adversarial) {
      expect(() => parseAndroidResourceReference(input)).not.toThrow();
    }
  });

  it("rejects a resource name containing path-traversal-shaped characters as malformed", () => {
    const result = parseAndroidResourceReference("@xml/../../etc/passwd");
    expect(result.state).toBe("malformed");
  });
});
