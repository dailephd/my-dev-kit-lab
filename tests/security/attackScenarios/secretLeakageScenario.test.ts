import fs, { mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SECRET_LEAKAGE_SCENARIO } from "../../../src/securityValidation/attackScenarios/scenarios/secretLeakageScenario.js";
import { renderJsonReport, renderTextReport } from "../../../src/securityValidation/report/renderSecurityReport.js";
import type { SecurityReport } from "../../../src/securityValidation/report/securityReportTypes.js";
import { toSecurityCheckResult } from "../../../src/securityValidation/attackScenarios/attackResult.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";
import type { AttackScenarioContext } from "../../../src/securityValidation/attackScenarios/attackScenario.js";

function fakeTarget(targetRoot: string): SecurityValidationTarget {
  return {
    targetRoot,
    toolRoot: targetRoot,
    packageName: "fixture",
    packageVersion: "1.0.0",
    hasPackageJson: true,
    hasSecurityTestScript: false,
    hasLockfile: false,
    branch: "main",
    commit: "abc",
    hasGit: false,
    isSelf: true,
  };
}

function makeCtx(targetRoot: string): AttackScenarioContext {
  return {
    toolRoot: targetRoot,
    target: fakeTarget(targetRoot),
    profile: "node-cli-package",
    config: DEFAULT_SECURITY_CONFIG,
  };
}

const cleanupDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeFixtureDir(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  mkdirSync(path.join(root, "src"), { recursive: true });
  cleanupDirs.push(root);
  return root;
}

describe("SECRET_LEAKAGE_SCENARIO", () => {
  it.each(["build", "dist", "node_modules", "coverage"])("detects credentials in a regular source file named %s", async name => {
    const root = makeFixtureDir("secret-file-type-");
    writeFileSync(path.join(root, "src", name), 'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.evidence.some(e => e.filePath === `src/${name}`)).toBe(true);
  });

  it("detects regular secrets beside refused links without reading outside", async () => {
    const root = makeFixtureDir("secret-provenance-");
    const outside = makeFixtureDir("secret-owned-outside-");
    const target = path.join(outside, "outside.ts");
    const link = path.join(root, "src/linked.ts");
    writeFileSync(target, "export const harmless = true;\n");
    writeFileSync(path.join(root, "src/creds.ts"),
      'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
    try { symlinkSync(target, link, "file"); }
    catch (error) {
      if (!["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      writeFileSync(link, "");
      const inspect = fs.lstatSync;
      vi.spyOn(fs, "lstatSync").mockImplementation(((file: fs.PathLike, ...args: any[]) => {
        const stat = (inspect as any)(file, ...args);
        return file === link ? Object.assign(Object.create(stat), { isSymbolicLink: () => true }) : stat;
      }) as typeof fs.lstatSync);
      console.info("LINK_CONTROL: injected secret collector refusal; real link creation denied");
    }
    const read = fs.readFileSync;
    const reads = vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...args: any[]) => {
      if (file === target || file === link) throw new Error("outside source must not be read");
      return (read as any)(file, ...args);
    }) as typeof fs.readFileSync);
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("blocker");
    expect(outcome.evidence.some(e => e.kind === "secret-leak" && e.filePath === "src/creds.ts")).toBe(true);
    expect(reads.mock.calls.some(([file]) => file === target || file === link)).toBe(false);
  });

  it("a high-confidence private key fixture produces a finding (failed)", async () => {
    const root = makeFixtureDir("secret-privkey-");
    writeFileSync(
      path.join(root, "src", "creds.ts"),
      "export const key = `-----BEGIN PRIVATE KEY-----\nZmFrZWtleWRhdGE=\n-----END PRIVATE KEY-----`;\n",
      "utf8"
    );
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("blocker");
    expect(outcome.evidence.some((e) => e.kind === "secret-leak")).toBe(true);
  });

  it("a high-confidence token fixture (GitHub-style) produces a finding (failed)", async () => {
    const root = makeFixtureDir("secret-token-");
    writeFileSync(
      path.join(root, "src", "config.ts"),
      'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n',
      "utf8"
    );
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("blocker");
  });

  it("secret values are redacted in AttackResult evidence", async () => {
    const root = makeFixtureDir("secret-redact-evidence-");
    const rawSecret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    writeFileSync(path.join(root, "src", "config.ts"), `export const token = "${rawSecret}";\n`, "utf8");
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    const leakEvidence = outcome.evidence.find((e) => e.kind === "secret-leak");
    expect(leakEvidence).toBeDefined();
    expect(leakEvidence!.redactedPreview).not.toContain(rawSecret);
  });

  it("secret values are redacted in JSON report output", async () => {
    const root = makeFixtureDir("secret-redact-json-");
    const rawSecret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    writeFileSync(path.join(root, "src", "config.ts"), `export const token = "${rawSecret}";\n`, "utf8");
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    const now = new Date().toISOString();
    const report: SecurityReport = {
      metadata: {
        toolRoot: root,
        toolPackageName: "fixture",
        toolPackageVersion: "1.0.0",
        targetRoot: root,
        targetDescription: "self",
        packageName: "fixture",
        packageVersion: "1.0.0",
        branch: "main",
        commit: "abc",
        isSelf: true,
        generatedAt: now,
        totalDurationMs: 1,
      },
      sections: [],
      allChecks: [],
      allFindings: [],
      verdict: "not-ready-security-blocker-remains",
      recommendedNextStep: "fix",
      attackResults: [
        {
          scenarioId: SECRET_LEAKAGE_SCENARIO.id,
          scenarioTitle: SECRET_LEAKAGE_SCENARIO.title,
          checkId: "secrets",
          profileId: "node-cli-package",
          status: outcome.status,
          severity: outcome.severity ?? "blocker",
          confidence: outcome.confidence,
          evidence: outcome.evidence,
          category: "secret-leakage",
          recommendation: outcome.recommendation,
        },
      ],
    };
    const json = renderJsonReport(report);
    expect(json).not.toContain(rawSecret);
  });

  it("secret values are redacted in text report output", async () => {
    const root = makeFixtureDir("secret-redact-text-");
    const rawSecret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    writeFileSync(path.join(root, "src", "config.ts"), `export const token = "${rawSecret}";\n`, "utf8");
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    const check = toSecurityCheckResult({
      scenarioId: SECRET_LEAKAGE_SCENARIO.id,
      scenarioTitle: SECRET_LEAKAGE_SCENARIO.title,
      checkId: "secrets",
      profileId: "node-cli-package",
      status: outcome.status,
      severity: outcome.severity ?? "blocker",
      confidence: outcome.confidence,
      evidence: outcome.evidence,
      category: "secret-leakage",
      recommendation: outcome.recommendation,
    });
    expect(check.findings[0]?.evidence ?? "").not.toContain(rawSecret);
  });

  it("placeholder values do not produce high-confidence findings", async () => {
    const root = makeFixtureDir("secret-placeholder-");
    writeFileSync(
      path.join(root, "src", "config.example.ts"),
      'export const apiKey = "your-api-key-here-example-placeholder";\n' + 'export const token = "changeme_dummy_test_fake_value";\n',
      "utf8"
    );
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
  });

  it("environment variable names without literal values do not produce high-confidence findings", async () => {
    const root = makeFixtureDir("secret-envname-");
    writeFileSync(
      path.join(root, "src", "config.ts"),
      "export const apiKey = process.env.API_KEY;\nexport const token = process.env.SECRET_TOKEN;\n",
      "utf8"
    );
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
  });

  it("skips node_modules, dist, coverage, and .git nested under the scanned src/ tree", async () => {
    const root = makeFixtureDir("secret-excluded-dirs-");
    for (const dir of ["node_modules", "dist", "coverage", ".git"]) {
      const full = path.join(root, "src", dir);
      mkdirSync(full, { recursive: true });
      writeFileSync(path.join(full, "leak.ts"), 'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n', "utf8");
    }
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
  });

  it("skips top-level lab-output/ and reports/security/ (outside the bounded glob surface entirely)", async () => {
    const root = makeFixtureDir("secret-excluded-toplevel-");
    for (const dir of ["lab-output", path.join("reports", "security")]) {
      const full = path.join(root, dir);
      mkdirSync(full, { recursive: true });
      writeFileSync(path.join(full, "leak.ts"), 'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n', "utf8");
    }
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
  });

  it("a target with no scan-worthy files passes with clear bounded-scan wording", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "secret-empty-"));
    cleanupDirs.push(root);
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
    expect(outcome.evidence.some((e) => e.observedBehavior?.includes("nothing to scan"))).toBe(true);
  });
});

// A synthetic literal deliberately free of any existing placeholder marker
// (example/changeme/dummy/test/fake/sample/placeholder/redacted/xxxx/your-*)
// so it is never suppressed as a placeholder value.
const SYNTHETIC_LITERAL = "Q7vN4mL9pR2xK8sW";

async function runScenarioOnFile(content: string, relativePath = "src/config.ts") {
  const root = makeFixtureDir("secret-generic-");
  const fullPath = path.join(root, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf8");
  return SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
}

function secretLeakEvidenceFor(outcome: Awaited<ReturnType<typeof SECRET_LEAKAGE_SCENARIO.run>>) {
  return outcome.evidence.filter((e) => e.kind === "secret-leak");
}

describe("SECRET_LEAKAGE_SCENARIO — generic secret false-positive boundary", () => {
  it("SECFIX-001 password = getPassword() passes with no secret finding", async () => {
    const outcome = await runScenarioOnFile('export const password = getPassword();\n');
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("SECFIX-002 password = parsedPassword passes", async () => {
    const outcome = await runScenarioOnFile("export const password = parsedPassword;\n");
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("SECFIX-003 password = process.env.PASSWORD passes", async () => {
    const outcome = await runScenarioOnFile("export const password = process.env.PASSWORD;\n");
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it('SECFIX-004 password = System.getenv("PASSWORD") passes', async () => {
    const outcome = await runScenarioOnFile('val password = System.getenv("PASSWORD")\n', "src/config.kt");
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it('SECFIX-005 password = providers.gradleProperty("PASSWORD").get() passes', async () => {
    const outcome = await runScenarioOnFile(
      'password = providers.gradleProperty("PASSWORD").get()\n',
      "src/build.gradle.kts"
    );
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it('SECFIX-006 password = resolveSecret("PASSWORD") passes', async () => {
    const outcome = await runScenarioOnFile('password = resolveSecret("PASSWORD");\n');
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it('SECFIX-007 storePassword: extractCredentialValue(content, ["storePassword"]) passes', async () => {
    const outcome = await runScenarioOnFile('storePassword: extractCredentialValue(content, ["storePassword"]),\n');
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it('SECFIX-008 keyPassword: extractCredentialValue(content, ["keyPassword"]) passes', async () => {
    const outcome = await runScenarioOnFile('keyPassword: extractCredentialValue(content, ["keyPassword"]),\n');
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("SECFIX-009 storePassword: SigningCredentialValue passes", async () => {
    const outcome = await runScenarioOnFile("storePassword: SigningCredentialValue;\n");
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("SECFIX-010 keyPassword: SigningCredentialValue passes", async () => {
    const outcome = await runScenarioOnFile("keyPassword: SigningCredentialValue;\n");
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("SECFIX-011 storePassword?: string passes", async () => {
    const outcome = await runScenarioOnFile("storePassword?: string;\n");
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("SECFIX-012 keyPassword?: string passes", async () => {
    const outcome = await runScenarioOnFile("keyPassword?: string;\n");
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("SECFIX-013 function parameter password: string passes", async () => {
    const outcome = await runScenarioOnFile("function readSecret(password: string) {}\n");
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("SECFIX-014 arrow-function parameter password: string passes", async () => {
    const outcome = await runScenarioOnFile("const read = (password: string) => password;\n");
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("SECFIX-015 a line-comment example passes", async () => {
    const outcome = await runScenarioOnFile(`// const password = "${SYNTHETIC_LITERAL}"\n`);
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("SECFIX-016 a single-line block-comment example passes", async () => {
    const outcome = await runScenarioOnFile(`/* const password = "${SYNTHETIC_LITERAL}" */\n`);
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("SECFIX-017 a multiline block-comment example passes", async () => {
    const outcome = await runScenarioOnFile(`/*\nconst password = "${SYNTHETIC_LITERAL}"\n*/\n`);
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("SECFIX-018 a quoted environment-variable name on the right side is not treated as the value", async () => {
    const outcome = await runScenarioOnFile('storePassword: extractCredentialValue(content, ["storePassword"])\n');
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("code before an inline line comment remains matchable", async () => {
    const outcome = await runScenarioOnFile(`const password = "${SYNTHETIC_LITERAL}"; // explanation\n`);
    expect(outcome.status).toBe("failed");
    expect(secretLeakEvidenceFor(outcome).length).toBeGreaterThan(0);
  });

  it("a comment marker inside a quoted literal does not truncate the value", async () => {
    const outcome = await runScenarioOnFile(`const password = "https://creds.internal/${SYNTHETIC_LITERAL}";\n`);
    expect(outcome.status).toBe("failed");
    expect(secretLeakEvidenceFor(outcome).length).toBeGreaterThan(0);
  });

  it("the matcher input string is not mutated by scanning", async () => {
    const root = makeFixtureDir("secret-immutable-");
    const filePath = path.join(root, "src", "config.ts");
    const content = 'export const password = getPassword();\n';
    writeFileSync(filePath, content, "utf8");
    await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(readFileSync(filePath, "utf8")).toBe(content);
  });

  it("finding order follows source line order", async () => {
    const outcome = await runScenarioOnFile(
      `const secondPassword = "${SYNTHETIC_LITERAL}";\nconst firstPassword = "${SYNTHETIC_LITERAL}2";\n`
    );
    const lines = secretLeakEvidenceFor(outcome).map((e) => e.line);
    expect(lines).toEqual([...lines].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
});

describe("SECRET_LEAKAGE_SCENARIO — generic secret true-positive preservation", () => {
  it("SECFIX-019 quoted TypeScript password assignment fails with severity major", async () => {
    const outcome = await runScenarioOnFile(`const password = "${SYNTHETIC_LITERAL}";\n`);
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
    expect(secretLeakEvidenceFor(outcome).length).toBeGreaterThan(0);
  });

  it("SECFIX-020 quoted TypeScript storePassword assignment fails with severity major", async () => {
    const outcome = await runScenarioOnFile(`const storePassword = "${SYNTHETIC_LITERAL}";\n`);
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
  });

  it("SECFIX-021 quoted TypeScript keyPassword assignment fails with severity major", async () => {
    const outcome = await runScenarioOnFile(`const keyPassword = '${SYNTHETIC_LITERAL}';\n`);
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
  });

  it("SECFIX-022 quoted object-property clientSecret fails with severity major", async () => {
    const outcome = await runScenarioOnFile(`clientSecret: "${SYNTHETIC_LITERAL}",\n`);
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
  });

  it("SECFIX-023 quoted JSON apiKey fails with severity major (existing apiKey policy detects it)", async () => {
    const outcome = await runScenarioOnFile(`"apiKey": "${SYNTHETIC_LITERAL}"\n`, "src/config.json");
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
  });

  it("SECFIX-024 unquoted .env PASSWORD fails with severity major", async () => {
    const outcome = await runScenarioOnFile(`PASSWORD=${SYNTHETIC_LITERAL}\n`, ".env");
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
  });

  it("SECFIX-025 unquoted .env DB_PASSWORD fails with severity major", async () => {
    const outcome = await runScenarioOnFile(`DB_PASSWORD=${SYNTHETIC_LITERAL}\n`, ".env");
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
  });

  it("SECFIX-026 unquoted .properties storePassword remains detected", async () => {
    const outcome = await runScenarioOnFile(`storePassword=${SYNTHETIC_LITERAL}\n`, "src/gradle.properties");
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
  });

  it("every real-positive case above keeps the raw synthetic literal out of serialized evidence", async () => {
    const outcome = await runScenarioOnFile(`const storePassword = "${SYNTHETIC_LITERAL}";\n`);
    const json = JSON.stringify(outcome.evidence);
    expect(json).not.toContain(SYNTHETIC_LITERAL);
  });
});

describe("SECRET_LEAKAGE_SCENARIO — existing pattern preservation", () => {
  it("SECFIX-027 private-key detection remains blocker", async () => {
    const outcome = await runScenarioOnFile(
      "export const key = `-----BEGIN PRIVATE KEY-----\nZmFrZWtleWRhdGE=\n-----END PRIVATE KEY-----`;\n"
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("blocker");
  });

  it("SECFIX-028 GitHub-token detection remains blocker", async () => {
    const outcome = await runScenarioOnFile('export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("blocker");
  });

  it("SECFIX-029 existing placeholder values remain suppressed", async () => {
    const outcome = await runScenarioOnFile(
      'export const apiKey = "your-api-key-here-example-placeholder";\n' +
        'export const token = "changeme_dummy_test_fake_value";\n',
      "src/config.example.ts"
    );
    expect(outcome.status).toBe("passed");
  });

  it("SECFIX-030 existing environment-reference behavior remains passed", async () => {
    const outcome = await runScenarioOnFile(
      "export const apiKey = process.env.API_KEY;\nexport const token = process.env.SECRET_TOKEN;\n"
    );
    expect(outcome.status).toBe("passed");
  });

  it("SECFIX-031 JSON report redaction remains intact", async () => {
    const rawSecret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const outcome = await runScenarioOnFile(`export const token = "${rawSecret}";\n`);
    const now = new Date().toISOString();
    const report: SecurityReport = {
      metadata: {
        toolRoot: "root",
        toolPackageName: "fixture",
        toolPackageVersion: "1.0.0",
        targetRoot: "root",
        targetDescription: "self",
        packageName: "fixture",
        packageVersion: "1.0.0",
        branch: "main",
        commit: "abc",
        isSelf: true,
        generatedAt: now,
        totalDurationMs: 1,
      },
      sections: [],
      allChecks: [],
      allFindings: [],
      verdict: "not-ready-security-blocker-remains",
      recommendedNextStep: "fix",
      attackResults: [
        {
          scenarioId: SECRET_LEAKAGE_SCENARIO.id,
          scenarioTitle: SECRET_LEAKAGE_SCENARIO.title,
          checkId: "secrets",
          profileId: "node-cli-package",
          status: outcome.status,
          severity: outcome.severity ?? "blocker",
          confidence: outcome.confidence,
          evidence: outcome.evidence,
          category: "secret-leakage",
          recommendation: outcome.recommendation,
        },
      ],
    };
    expect(renderJsonReport(report)).not.toContain(rawSecret);
  });

  it("SECFIX-032 text/check-result redaction remains intact", async () => {
    const rawSecret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const outcome = await runScenarioOnFile(`export const token = "${rawSecret}";\n`);
    const check = toSecurityCheckResult({
      scenarioId: SECRET_LEAKAGE_SCENARIO.id,
      scenarioTitle: SECRET_LEAKAGE_SCENARIO.title,
      checkId: "secrets",
      profileId: "node-cli-package",
      status: outcome.status,
      severity: outcome.severity ?? "blocker",
      confidence: outcome.confidence,
      evidence: outcome.evidence,
      category: "secret-leakage",
      recommendation: outcome.recommendation,
    });
    expect(check.findings[0]?.evidence ?? "").not.toContain(rawSecret);
  });
});

describe("SECRET_LEAKAGE_SCENARIO — scanner self-detection regression", () => {
  const selfDetectionFiles = [
    "src/mobile/android/advancedSecurity/secretCandidates/matchSecretCandidates.ts",
    "src/mobile/android/advancedSecurity/signingConfiguration/extractSigningConfigurations.ts",
    "src/mobile/android/advancedSecurity/signingConfiguration/types.ts",
  ];

  function copySelfDetectionFilesInto(root: string): void {
    for (const relativePath of selfDetectionFiles) {
      const content = readFileSync(path.resolve(relativePath), "utf8");
      const destination = path.join(root, relativePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, content, "utf8");
    }
  }

  it("matchSecretCandidates.ts produces no high-confidence finding from comments or syntax examples", async () => {
    const root = makeFixtureDir("secret-self-match-");
    copySelfDetectionFilesInto(root);
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    const findings = secretLeakEvidenceFor(outcome).filter((e) => e.filePath?.includes("matchSecretCandidates.ts"));
    expect(findings).toHaveLength(0);
  });

  it("extractSigningConfigurations.ts produces no high-confidence finding from function-call properties or quoted lookup names", async () => {
    const root = makeFixtureDir("secret-self-extract-");
    copySelfDetectionFilesInto(root);
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    const findings = secretLeakEvidenceFor(outcome).filter((e) =>
      e.filePath?.includes("extractSigningConfigurations.ts")
    );
    expect(findings).toHaveLength(0);
  });

  it("types.ts produces no high-confidence finding from type declarations", async () => {
    const root = makeFixtureDir("secret-self-types-");
    copySelfDetectionFilesInto(root);
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    const findings = secretLeakEvidenceFor(outcome).filter((e) =>
      e.filePath?.endsWith("signingConfiguration/types.ts")
    );
    expect(findings).toHaveLength(0);
  });

  it("the three scanner implementation files together produce no self-detection finding", async () => {
    const root = makeFixtureDir("secret-self-all-");
    copySelfDetectionFilesInto(root);
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
    expect(secretLeakEvidenceFor(outcome)).toHaveLength(0);
  });

  it("the regression is not path suppression: an injected real literal in the copied matchSecretCandidates.ts is still detected", async () => {
    const root = makeFixtureDir("secret-self-injected-");
    copySelfDetectionFilesInto(root);
    const targetPath = path.join(root, "src/mobile/android/advancedSecurity/secretCandidates/matchSecretCandidates.ts");
    const originalContent = readFileSync(targetPath, "utf8");
    const injectedContent = `${originalContent}\nconst password = "${SYNTHETIC_LITERAL}";\n`;
    writeFileSync(targetPath, injectedContent, "utf8");

    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
    const findings = secretLeakEvidenceFor(outcome).filter((e) => e.filePath?.includes("matchSecretCandidates.ts"));
    expect(findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(outcome.evidence)).not.toContain(SYNTHETIC_LITERAL);

    // Confirm this test never modified the real repository source file.
    expect(readFileSync(path.resolve(
      "src/mobile/android/advancedSecurity/secretCandidates/matchSecretCandidates.ts"
    ), "utf8")).toBe(originalContent);
  });

  it("the same isolated target scanned twice returns deterministic outcomes", async () => {
    const root = makeFixtureDir("secret-self-determinism-");
    copySelfDetectionFilesInto(root);
    const first = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    const second = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(second.status).toBe(first.status);
    expect(second.severity).toBe(first.severity);
    const firstOrder = first.evidence.map((e) => [e.kind, e.filePath, e.line]);
    const secondOrder = second.evidence.map((e) => [e.kind, e.filePath, e.line]);
    expect(secondOrder).toEqual(firstOrder);
  });
});

describe("SECRET_LEAKAGE_SCENARIO generic assignment syntax context", () => {
  // Fabricated, non-functional fixture values only.
  const REAL = "Zq9xKw7LmPv2Rt";

  async function scan(files: Record<string, string>) {
    const root = makeFixtureDir("secret-syntax-");
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), content, "utf8");
    }
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    const findings = outcome.evidence
      .filter((e) => e.kind === "secret-leak")
      .map((e) => ({ file: e.filePath, line: e.line, preview: e.redactedPreview }));
    return { outcome, findings };
  }

  it.each([
    ["diagnostic template string", 'console.log(`token: "${token}"`);\n'],
    ["escaped quotes inside a double-quoted diagnostic", 'throw new Error("password: \\"hunter2hunter2\\" rejected");\n'],
    ["interpolated token expression", "const msg = `Authorization: token ${apiToken} sent`;\n"],
    ["nested template literal", 'const m = `outer ${`inner token: "${token}"`} done`;\n'],
    ["line comment", `// password = "${REAL}"\nexport const x = 1;\n`],
    ["block comment", `/* secret: "${REAL}" */\nexport const x = 1;\n`],
    ["function parameter and type declaration", "export function login(password: string, token?: string): void {}\ntype T = { secret: string };\n"],
    ["function call and env reference", "const password = getPassword();\nconst token = process.env.API_TOKEN;\n"],
    ["string literal describing an assignment", `const help = "set password = '${REAL}' in config";\n`],
    ["whole-value interpolation reference in a plain string", 'const o = { token: "${token}" };\n'],
  ])("does not report: %s", async (_name, source) => {
    const { outcome, findings } = await scan({ "src/a.ts": source });
    expect(findings).toEqual([]);
    expect(outcome.status).toBe("passed");
  });

  it.each([
    ["static quoted password", `const password = "${REAL}";\n`],
    ["static token", `const token = '${REAL}';\n`],
    ["object-property value", `export const cfg = { clientSecret: "${REAL}" };\n`],
    ["quoted object key", `export const cfg = { "apiKey": "${REAL}" };\n`],
    ["escaped quote inside a real literal", `const password = "${REAL}\\"x";\n`],
    ["assignment inside a template interpolation", "const s = `${ { password: \"" + REAL + "\" }.password }`;\n"],
  ])("still reports: %s", async (_name, source) => {
    const { outcome, findings } = await scan({ "src/a.ts": source });
    expect(findings.length).toBe(1);
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
  });

  it("mixed file: interpolated diagnostic ignored, neighbouring hardcoded credential reported on its original line", async () => {
    const source = [
      "// header",
      "export function report(token: string) {",
      '  console.log(`token: "${token}"`);',
      `  const password = "${REAL}";`,
      "  return password;",
      "}",
      "",
    ].join("\n");
    const { findings } = await scan({ "src/mixed.ts": source });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: "src/mixed.ts", line: 4 });
  });

  it("keeps known-format token detection independent of syntax context", async () => {
    const { findings } = await scan({
      "src/a.ts": "const hint = `use ghp_abcdefghijklmnopqrstuvwxyz0123456789`;\n",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(1);
  });

  it("keeps configuration modes: quoted .json, unquoted .env/.properties/.yaml/.toml; dynamic and placeholder values skipped", async () => {
    const { findings } = await scan({
      ".env": `DB_PASSWORD=${REAL}\nAPI_TOKEN=\${FROM_ENV}\nSECRET_TOKEN=changeme-please\n`,
      "src/app.properties": `storePassword=${REAL}\n`,
      "src/c.yaml": `clientSecret: ${REAL}\n`,
      "src/c.toml": `accessToken = "${REAL}"\n`,
      "package.json": `{"name":"fixture","password":"${REAL}"}\n`,
    });
    expect(findings.map((f) => f.file).sort()).toEqual([
      ".env",
      "package.json",
      "src/app.properties",
      "src/c.toml",
      "src/c.yaml",
    ]);
  });

  it("orders findings by file then line deterministically", async () => {
    const source = `const a = 1;\nconst password = "${REAL}";\n\nconst token = "${REAL}x";\n`;
    const first = await scan({ "src/b.ts": source, "src/a.ts": source });
    const second = await scan({ "src/a.ts": source, "src/b.ts": source });
    expect(first.findings.map((f) => `${f.file}:${f.line}`)).toEqual([
      "src/a.ts:2",
      "src/a.ts:4",
      "src/b.ts:2",
      "src/b.ts:4",
    ]);
    expect(second.findings).toEqual(first.findings);
  });

  it("never exposes the raw credential value in scenario evidence", async () => {
    const { outcome } = await scan({ "src/a.ts": `const password = "${REAL}";\n` });
    expect(JSON.stringify(outcome)).not.toContain(REAL);
  });
});
