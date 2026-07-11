import { describe, expect, it } from "vitest";
import { analyzeModuleSigningConfiguration } from "../../../../src/mobile/android/advancedSecurity/signingConfiguration/analyzeSigningConfiguration.js";
import { ANDROID_SECRETS_SIGNING_RULE_IDS } from "../../../../src/mobile/android/advancedSecurity/ruleIds.js";
import type { AndroidGradleModuleInfo } from "../../../../src/mobile/android/gradle/types.js";
import type { KeystoreCandidateFile } from "../../../../src/mobile/android/advancedSecurity/signingConfiguration/types.js";

const TARGET_ROOT = "Z:/fake-target-root";

function baseModule(overrides: Partial<AndroidGradleModuleInfo> = {}): AndroidGradleModuleInfo {
  return {
    path: "app",
    buildFilePath: "app/build.gradle",
    isApplication: true,
    buildTypes: ["debug", "release"],
    sourceSetEvidence: [],
    testSourceSetEvidence: [],
    unsupportedExpressions: [],
    ...overrides,
  };
}

// ANDROID-V041-B4-01
describe("analyzeModuleSigningConfiguration — inherited rule identities", () => {
  it("every produced finding/candidate rule id is one of the Batch 1 signing rule ids", () => {
    const buildFile = `android { signingConfigs { release { storePassword "hunter2-fake" keyPassword "hunter2-fake" } } }`;
    const result = analyzeModuleSigningConfiguration(TARGET_ROOT, baseModule(), buildFile, []);
    for (const finding of result.findings) expect(ANDROID_SECRETS_SIGNING_RULE_IDS).toContain(finding.id.split("--")[0]);
    for (const candidate of result.candidates) {
      expect(ANDROID_SECRETS_SIGNING_RULE_IDS).toContain(candidate.ruleId);
      expect(candidate.category).toBe("android-signing-configuration");
    }
  });
});

// ANDROID-V041-B4-32/33 — literal storePassword/keyPassword.
describe("analyzeModuleSigningConfiguration — literal credentials", () => {
  it("produces a major finding for a literal storePassword", () => {
    const result = analyzeModuleSigningConfiguration(
      TARGET_ROOT,
      baseModule(),
      `android { signingConfigs { release { storePassword "hunter2-fake" } } }`,
      []
    );
    expect(result.findings.some((f) => f.id.startsWith("android-signing-password-literal") && f.description.includes("storePassword"))).toBe(true);
    expect(result.findings[0].severity).toBe("major");
  });

  it("produces a major finding for a literal keyPassword", () => {
    const result = analyzeModuleSigningConfiguration(TARGET_ROOT, baseModule(), `android { signingConfigs { release { keyPassword "hunter2-fake" } } }`, []);
    expect(result.findings.some((f) => f.description.includes("keyPassword"))).toBe(true);
  });

  it("never includes the raw literal value in findings/candidates", () => {
    const result = analyzeModuleSigningConfiguration(
      TARGET_ROOT,
      baseModule(),
      `android { signingConfigs { release { storePassword "UNIQUE-FAKE-MARKER-77777" } } }`,
      []
    );
    const serialized = JSON.stringify({ findings: result.findings, candidates: result.candidates });
    expect(serialized).not.toContain("UNIQUE-FAKE-MARKER-77777");
  });
});

// ANDROID-V041-B4-34 — keyAlias boundary.
describe("analyzeModuleSigningConfiguration — keyAlias boundary", () => {
  it("never produces a finding or candidate for keyAlias alone", () => {
    const result = analyzeModuleSigningConfiguration(TARGET_ROOT, baseModule(), `android { signingConfigs { release { keyAlias "fake-alias" } } }`, []);
    expect(result.findings).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
    expect(result.evidenceText.some((t) => t.includes("keyAlias=fake-alias"))).toBe(true);
  });
});

// ANDROID-V041-B4-35/36 — environment/property reference boundary.
describe("analyzeModuleSigningConfiguration — reference boundary", () => {
  it("treats System.getenv storePassword as informational metadata, not a finding", () => {
    const result = analyzeModuleSigningConfiguration(
      TARGET_ROOT,
      baseModule(),
      `android { signingConfigs { release { storePassword System.getenv("STORE_PASSWORD") } } }`,
      []
    );
    expect(result.findings).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
    expect(result.evidenceText.some((t) => t.includes("environment-reference"))).toBe(true);
  });

  it("treats a Gradle property lookup as informational metadata", () => {
    const result = analyzeModuleSigningConfiguration(
      TARGET_ROOT,
      baseModule(),
      `android { signingConfigs { release { storePassword project.findProperty("storePassword") } } }`,
      []
    );
    expect(result.findings).toHaveLength(0);
  });

  // ANDROID-V041-B4-37
  it("treats a bare variable reference as candidate evidence, not a finding", () => {
    const result = analyzeModuleSigningConfiguration(TARGET_ROOT, baseModule(), `android { signingConfigs { release { storePassword storePasswordVar } } }`, []);
    expect(result.findings).toHaveLength(0);
    expect(result.candidates.some((c) => c.resolutionState === "unresolved")).toBe(true);
  });
});

// ANDROID-V041-B4-39/40 — storeFile path analysis.
describe("analyzeModuleSigningConfiguration — storeFile analysis", () => {
  it("produces review evidence for an absolute storeFile path", () => {
    const absolutePath = process.platform === "win32" ? "C:\\\\Users\\\\dev\\\\fake-release.jks" : "/home/dev/fake-release.jks";
    const result = analyzeModuleSigningConfiguration(
      TARGET_ROOT,
      baseModule(),
      `android { signingConfigs { release { storeFile file("${absolutePath.replace(/\\/g, "\\\\")}") } } }`,
      []
    );
    expect(result.candidates.some((c) => c.ruleId === "android-signing-path-leakage")).toBe(true);
  });

  it("produces review evidence for a missing referenced keystore", () => {
    const result = analyzeModuleSigningConfiguration(
      TARGET_ROOT,
      baseModule(),
      `android { signingConfigs { release { storeFile file("does-not-exist.jks") } } }`,
      []
    );
    expect(result.candidates.some((c) => c.ruleId === "android-signing-keystore-candidate" && c.resolutionState === "missing")).toBe(true);
  });
});

// ANDROID-V041-B4-43/44/45 — release signingConfig correlation.
describe("analyzeModuleSigningConfiguration — release signingConfig correlation", () => {
  it("treats a named non-debug signing config reference as ordinary metadata", () => {
    const result = analyzeModuleSigningConfiguration(
      TARGET_ROOT,
      baseModule({ buildTypeDetails: [{ name: "release", debuggableState: "missing", minifyEnabledState: "missing", shrinkResourcesState: "missing", signingConfigRef: 'signingConfigs.getByName("release")' }] }),
      `android { signingConfigs { release { keyAlias "fake" } } }`,
      []
    );
    expect(result.findings).toHaveLength(0);
    expect(result.evidenceText.some((t) => t.includes('references named signing config "release"'))).toBe(true);
  });

  it("produces a major finding when release explicitly uses signingConfigs.debug", () => {
    const result = analyzeModuleSigningConfiguration(
      TARGET_ROOT,
      baseModule({ buildTypeDetails: [{ name: "release", debuggableState: "missing", minifyEnabledState: "missing", shrinkResourcesState: "missing", signingConfigRef: "signingConfigs.debug" }] }),
      `android { }`,
      []
    );
    expect(result.findings.some((f) => f.id.startsWith("android-signing-debug-in-release"))).toBe(true);
    expect(result.findings[0].severity).toBe("major");
  });

  it("produces candidate evidence, not a fabricated config, for a missing signing-config definition", () => {
    const result = analyzeModuleSigningConfiguration(
      TARGET_ROOT,
      baseModule({ buildTypeDetails: [{ name: "release", debuggableState: "missing", minifyEnabledState: "missing", shrinkResourcesState: "missing", signingConfigRef: 'signingConfigs.getByName("nonexistent")' }] }),
      `android { signingConfigs { release { keyAlias "fake" } } }`,
      []
    );
    expect(result.findings).toHaveLength(0);
    expect(result.candidates.some((c) => c.resolutionState === "missing" && c.summary.includes("nonexistent"))).toBe(true);
  });
});

// ANDROID-V041-B4-46 — committed keystore + literal credential + release correlation.
describe("analyzeModuleSigningConfiguration — committed keystore correlation", () => {
  it("increases confidence to a major finding when release, literal password, and committed keystore all align", () => {
    const keystoreCandidates: KeystoreCandidateFile[] = [{ relativePath: "app/fake-release-keystore.jks", modulePath: "app", extension: ".jks" }];
    const result = analyzeModuleSigningConfiguration(
      TARGET_ROOT,
      baseModule({ buildTypeDetails: [{ name: "release", debuggableState: "missing", minifyEnabledState: "missing", shrinkResourcesState: "missing", signingConfigRef: 'signingConfigs.getByName("release")' }] }),
      `android {\nsigningConfigs {\nrelease {\nstoreFile file("fake-release-keystore.jks")\nstorePassword "hunter2-fake"\n}\n}\n}`,
      keystoreCandidates
    );
    const correlationFinding = result.findings.find((f) => f.id.startsWith("android-signing-keystore-candidate"));
    expect(correlationFinding).toBeDefined();
    expect(correlationFinding?.severity).toBe("major");
  });
});

// ANDROID-V041-B4-48 — library module behavior.
describe("analyzeModuleSigningConfiguration — library module behavior", () => {
  it("downgrades a literal storePassword finding to a candidate for a library module", () => {
    const libraryModule = baseModule({ isApplication: undefined, isLibrary: true, path: "mylibrary", buildFilePath: "mylibrary/build.gradle" });
    const result = analyzeModuleSigningConfiguration(TARGET_ROOT, libraryModule, `android { signingConfigs { release { storePassword "hunter2-fake" } } }`, []);
    expect(result.findings).toHaveLength(0);
    expect(result.candidates.some((c) => c.resolutionState === "not-applicable")).toBe(true);
  });
});

// ANDROID-V041-B4-50 — determinism.
describe("analyzeModuleSigningConfiguration — determinism", () => {
  it("produces stable finding/candidate ids across repeated runs", () => {
    const buildFile = `android { signingConfigs { release { storePassword "hunter2-fake" } } }`;
    const first = analyzeModuleSigningConfiguration(TARGET_ROOT, baseModule(), buildFile, []);
    const second = analyzeModuleSigningConfiguration(TARGET_ROOT, baseModule(), buildFile, []);
    expect(first.findings.map((f) => f.id)).toEqual(second.findings.map((f) => f.id));
    expect(first.candidates.map((c) => c.id)).toEqual(second.candidates.map((c) => c.id));
  });
});
