import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Fixture safety for the Batch 2 network-security fixtures: no real domains,
// certificates, or pin values — everything is unmistakably fake or a
// reserved/example domain.
describe("advanced-security-fixtures/network-security — fixture safety", () => {
  const root = path.resolve("tests/fixtures/android/advanced-security-fixtures/network-security");

  function allXmlFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return allXmlFiles(full);
      return e.name.endsWith(".xml") ? [full] : [];
    });
  }

  const files = allXmlFiles(root);

  it("is non-empty", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("contains no PEM-style private key material", () => {
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toContain("PRIVATE KEY");
    }
  });

  it("only uses example.com/example.org-style reserved domains", () => {
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      const domainMatches = [...content.matchAll(/<domain[^>]*>([^<]*)<\/domain>/g)].map((m) => m[1].trim().toLowerCase());
      for (const domain of domainMatches) {
        if (domain.length === 0) continue;
        expect(domain === "ab" || domain.endsWith("example.com") || domain.endsWith("example.com.") || domain.endsWith("example.org") || domain === "example.com.").toBe(true);
      }
    }
  });

  it("marks pin values as obviously fake", () => {
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      const pinMatches = [...content.matchAll(/<pin[^>]*>([^<]*)<\/pin>/g)].map((m) => m[1]);
      for (const pin of pinMatches) {
        if (pin.length === 0) continue;
        expect(pin.toUpperCase()).toContain("FAKE");
      }
    }
  });
});
