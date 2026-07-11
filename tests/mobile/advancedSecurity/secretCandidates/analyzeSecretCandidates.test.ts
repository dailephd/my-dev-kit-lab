import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSecretCandidateFile } from "../../../../src/mobile/android/advancedSecurity/secretCandidates/analyzeSecretCandidates.js";
import type { SecretScanFile } from "../../../../src/mobile/android/advancedSecurity/secretCandidates/types.js";
import { ANDROID_SECRETS_SIGNING_RULE_IDS } from "../../../../src/mobile/android/advancedSecurity/ruleIds.js";

const FIXTURES_ROOT = path.resolve("tests/fixtures/android/advanced-security-fixtures/secret-candidates");

function file(name: string, content: string, modulePath?: string): SecretScanFile {
  return { relativePath: name, absolutePath: path.join(FIXTURES_ROOT, name), modulePath, content };
}

// ANDROID-V041-B4-01 — inherited rule identities.
describe("analyzeSecretCandidateFile — inherited rule identities", () => {
  it("every produced finding/candidate rule id is one of the Batch 1 secret/signing rule ids", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("SampleActivity.kt", 'val password = "hunter2-fake-not-real"'));
    for (const finding of result.findings) expect(ANDROID_SECRETS_SIGNING_RULE_IDS).toContain(finding.id.split("--")[0]);
    for (const candidate of result.candidates) expect(ANDROID_SECRETS_SIGNING_RULE_IDS).toContain(candidate.ruleId);
  });
});

// ANDROID-V041-B4-13/14 — Kotlin/Java literal detection.
describe("analyzeSecretCandidateFile — literal credential detection", () => {
  it("detects a Kotlin password literal", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("Sample.kt", 'val password = "hunter2-fake-not-real"'));
    expect(result.findings.some((f) => f.title.includes("password"))).toBe(true);
    expect(result.findings[0].severity).toBe("major");
  });

  it("detects a Java-style SECRET_TOKEN constant", () => {
    const result = analyzeSecretCandidateFile(
      FIXTURES_ROOT,
      file("Sample.java", 'private static final String SECRET_TOKEN = "FAKE-DUMMY-TOKEN-0000000000000000";')
    );
    expect(result.findings.some((f) => f.description.includes("SECRET_TOKEN"))).toBe(true);
  });

  it("detects a DB_PASSWORD constant", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("Sample.java", 'private static final String DB_PASSWORD = "test-fake-db-password";'));
    expect(result.findings.some((f) => f.description.includes("DB_PASSWORD"))).toBe(true);
  });
});

// ANDROID-V041-B4-15/16/17 — XML/properties/JSON literal detection.
describe("analyzeSecretCandidateFile — config file forms", () => {
  it("detects a properties-file secret literal (unquoted)", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("gradle.properties", "storePassword=FAKE-KEYSTORE-PASSWORD-0000"));
    expect(result.findings.some((f) => f.id.startsWith("android-signing-password-literal"))).toBe(true);
  });

  it("detects an XML attribute secret literal", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("config.xml", '<config apiSecret="FAKE-XML-SECRET-0000000000" />'));
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("detects a JSON secret literal", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("config.json", '{ "clientSecret": "FAKE-JSON-CLIENT-SECRET-0000" }'));
    expect(result.findings.some((f) => f.description.includes("clientSecret"))).toBe(true);
  });
});

// ANDROID-V041-B4-18/19 — empty/placeholder suppression.
describe("analyzeSecretCandidateFile — suppression", () => {
  it("produces no finding for an empty value", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("Sample.kt", 'val password = ""'));
    expect(result.findings).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
  });

  it("produces no finding for an obvious placeholder value", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("Sample.kt", 'val password = "changeme"'));
    expect(result.findings).toHaveLength(0);
  });

  it("produces no finding for a masked/repeated-character value", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("Sample.kt", 'val password = "********"'));
    expect(result.findings).toHaveLength(0);
  });
});

// ANDROID-V041-B4-20/21/22 — reference/placeholder-syntax boundary.
describe("analyzeSecretCandidateFile — reference boundary", () => {
  it("does not treat a variable reference as a literal secret", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("Sample.kt", "val password = getPassword()"));
    expect(result.findings).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
  });

  it("treats an environment-variable-shaped literal as non-literal candidate evidence, not a finding", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("Sample.kt", 'val password = "${DB_PASSWORD}"'));
    expect(result.findings).toHaveLength(0);
    expect(result.candidates.some((c) => c.resolutionState === "not-applicable")).toBe(true);
  });

  it("treats a Gradle-property-shaped literal as non-literal candidate evidence", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("gradle.properties", "storePassword=${signing.storePassword}"));
    expect(result.findings).toHaveLength(0);
  });
});

// ANDROID-V041-B4-23 — Firebase/API-key boundary (by construction: "apiKey" is not a trigger identifier at all).
describe("analyzeSecretCandidateFile — API-key boundary", () => {
  it("never flags an apiKey-named assignment", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("google-services.json", '{ "current_key": "FAKE-FIREBASE-WEB-API-KEY-0000000000", "apiKey": "AIzaFAKE0000000000000000000000000" }'));
    expect(result.findings.some((f) => f.description.toLowerCase().includes("apikey"))).toBe(false);
  });
});

// ANDROID-V041-B4-10/11/12 — private key detection.
describe("analyzeSecretCandidateFile — private key detection", () => {
  const FAKE_PEM = [
    "-----BEGIN PRIVATE KEY-----",
    "MIIFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE",
    "-----END PRIVATE KEY-----",
  ].join("\n");

  it("produces one high-confidence finding for a terminated PEM block", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("id_rsa", FAKE_PEM));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("major");
    expect(result.findings[0].id.startsWith("android-secret-private-key-candidate")).toBe(true);
  });

  it("does not classify a public key/certificate as a private key", () => {
    const publicPem = ["-----BEGIN PUBLIC KEY-----", "MIIFAKEPUBLIC", "-----END PUBLIC KEY-----"].join("\n");
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("id_rsa.pub", publicPem));
    expect(result.findings).toHaveLength(0);
  });

  it("does not classify a certificate block as a private key", () => {
    const cert = ["-----BEGIN CERTIFICATE-----", "MIIFAKECERT", "-----END CERTIFICATE-----"].join("\n");
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("cert.pem", cert));
    expect(result.findings).toHaveLength(0);
  });

  it("handles an unterminated private-key block conservatively without throwing", () => {
    const unterminated = "-----BEGIN RSA PRIVATE KEY-----\nMIIFAKEFAKEFAKEFAKE\n";
    expect(() => analyzeSecretCandidateFile(FIXTURES_ROOT, file("broken.pem", unterminated))).not.toThrow();
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("broken.pem", unterminated));
    expect(result.findings).toHaveLength(0);
    expect(result.candidates.some((c) => c.resolutionState === "malformed")).toBe(true);
  });
});

// ANDROID-V041-B4-26/27/50 — deduplication and determinism.
describe("analyzeSecretCandidateFile — deduplication and determinism", () => {
  it("produces stable finding ids for the same value and location", () => {
    const content = 'val password = "hunter2-fake-not-real"';
    const first = analyzeSecretCandidateFile(FIXTURES_ROOT, file("Sample.kt", content));
    const second = analyzeSecretCandidateFile(FIXTURES_ROOT, file("Sample.kt", content));
    expect(first.findings.map((f) => f.id)).toEqual(second.findings.map((f) => f.id));
  });

  it("produces distinct finding ids for the same value at different lines", () => {
    const content = 'val password = "hunter2-fake-not-real"\nval other = "unrelated"\nval password2 = "hunter2-fake-not-real"';
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("Sample.kt", content));
    const ids = result.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ANDROID-V041-B4-29/51 — bounded evidence, no raw secret leakage.
describe("analyzeSecretCandidateFile — bounded evidence", () => {
  it("never includes the raw secret value in findings or candidates", () => {
    const rawSecret = "hunter2-fake-not-real-UNIQUE-MARKER-98765";
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("Sample.kt", `val password = "${rawSecret}"`));
    const serialized = JSON.stringify({ findings: result.findings, candidates: result.candidates });
    expect(serialized).not.toContain(rawSecret);
  });

  it("never includes the raw PEM key body in findings", () => {
    const result = analyzeSecretCandidateFile(FIXTURES_ROOT, file("id_rsa", FAKE_PEM_FOR_BOUNDS));
    const serialized = JSON.stringify(result.findings);
    expect(serialized).not.toContain("MIIFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE");
  });
});

const FAKE_PEM_FOR_BOUNDS = ["-----BEGIN PRIVATE KEY-----", "MIIFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE", "-----END PRIVATE KEY-----"].join(
  "\n"
);
