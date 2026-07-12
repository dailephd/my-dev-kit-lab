import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverKeystoreCandidates } from "../../../../src/mobile/android/advancedSecurity/signingConfiguration/discoverKeystoreCandidates.js";

const FIXTURES_ROOT = path.resolve("tests/fixtures/android/advanced-security-fixtures/signing-configuration");

// ANDROID-V041-B4-41 — committed keystore candidate discovery.
describe("discoverKeystoreCandidates", () => {
  it("discovers a committed .jks fixture by path only", () => {
    const result = discoverKeystoreCandidates(FIXTURES_ROOT, ["app"]);
    const found = result.find((k) => k.relativePath === "app/fake-release-keystore.jks");
    expect(found).toBeDefined();
    expect(found?.extension).toBe(".jks");
    expect(found?.modulePath).toBe("app");
  });

  // ANDROID-V041-B4-42 — generated-directory exclusion.
  it("excludes a keystore-like file inside a generated build/ directory", () => {
    const result = discoverKeystoreCandidates(FIXTURES_ROOT, ["app"]);
    expect(result.some((k) => k.relativePath.includes("generated-fake.keystore"))).toBe(false);
  });

  it("is deterministic across repeated invocations", () => {
    const first = discoverKeystoreCandidates(FIXTURES_ROOT, ["app"]);
    const second = discoverKeystoreCandidates(FIXTURES_ROOT, ["app"]);
    expect(first).toEqual(second);
  });

  it("never reads file contents (path/extension only)", async () => {
    const fs = await import("node:fs");
    const content = fs.readFileSync(path.resolve("src/mobile/android/advancedSecurity/signingConfiguration/discoverKeystoreCandidates.ts"), "utf8");
    expect(content).not.toMatch(/readFileSync|readFile\(/);
  });
});
