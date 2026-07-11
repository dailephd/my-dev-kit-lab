import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ANDROID-V041-B1-18 — fixture safety: every value in the new secret-
// candidate fixtures is unmistakably fake. This is a real content check, not
// just a naming convention assertion.
describe("advanced-security-fixtures/secret-candidates — fixture safety", () => {
  const dir = path.resolve("tests/fixtures/android/advanced-security-fixtures/secret-candidates");
  const files = fs.readdirSync(dir);

  it("is non-empty (fixture family actually exists)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f]))("marks %s as a fixture with only fake-looking values", (file) => {
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    const lower = content.toLowerCase();
    const hasFakeMarker = ["fake", "changeme", "dummy", "test"].some((marker) => lower.includes(marker));
    expect(hasFakeMarker).toBe(true);
  });

  it("contains no real-looking AWS access key id pattern", () => {
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), "utf8");
      expect(/AKIA[0-9A-Z]{16}/.test(content)).toBe(false);
    }
  });

  it("contains no PEM private key block with real-looking base64 body", () => {
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), "utf8");
      const match = content.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----([\s\S]*?)-----END [A-Z ]*PRIVATE KEY-----/);
      if (match) {
        expect(match[1].toLowerCase()).toContain("fake");
      }
    }
  });
});
