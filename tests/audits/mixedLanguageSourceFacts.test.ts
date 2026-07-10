import { describe, expect, it } from "vitest";
import path from "node:path";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import { collectSourceFacts } from "../../src/audits/core/collectSourceFacts.js";
import {
  DEFAULT_LANGUAGE_ANALYZER_REGISTRY,
  selectLanguageAnalyzer,
} from "../../src/audits/core/languageAnalyzerRegistry.js";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { renderAuditJsonReport } from "../../src/audits/report/renderAuditJsonReport.js";

// ---------------------------------------------------------------------------
// v0.3.4 Batch 1 -- mixed-language source-facts invariant tests (T1-T8).
//
// Uses the static, committed fixture corpus under
// tests/fixtures/audits/mixed-language/ directly as the scan target (no temp
// dir copy needed: scanProjectInventory/collectSourceFacts/runAudit never
// write to their target). This proves the v0.3.3 language-aware audit
// substrate (TypeScript/JavaScript, Python, Java, Kotlin analyzers) remains
// stable when multiple language analyzers run together against a single
// project, without adding any new detector or audit-type behavior.
// ---------------------------------------------------------------------------

const FIXTURE_ROOT = path.resolve(process.cwd(), "tests/fixtures/audits/mixed-language");

function fixturePath(name: string): string {
  return path.join(FIXTURE_ROOT, name);
}

function fakeTargetFor(root: string): AuditTarget {
  return {
    rootPath: root,
    displayName: "fixture",
    exists: true,
    isDirectory: true,
    packageJsonPath: path.join(root, "package.json"),
    gitRoot: null,
    isSelf: false,
    safeReportOutputRoot: path.join(root, "reports", "audits"),
  };
}

describe("mixed-language source facts — T1 mixed-language collection completes", () => {
  it("collects source facts from a project containing TS, JS, Python, Java, and Kotlin files without crashing", async () => {
    const root = fixturePath("mixed-ts-python-jvm");
    const inventory = scanProjectInventory(root);
    const snapshot = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);

    expect(snapshot.filesByLanguage.typescript).toBeGreaterThan(0);
    expect(snapshot.filesByLanguage.javascript).toBeGreaterThan(0);
    expect(snapshot.filesByLanguage.python).toBeGreaterThan(0);
    expect(snapshot.filesByLanguage.java).toBeGreaterThan(0);
    expect(snapshot.filesByLanguage.kotlin).toBeGreaterThan(0);

    // build.gradle.kts is config, not a source/test file -- it must not
    // produce a parser crash or appear as a parsed Kotlin source-fact entry.
    const gradleEntry = snapshot.files.find((f) => f.relativePath === "build.gradle.kts");
    expect(gradleEntry).toBeUndefined();
  });
});

describe("mixed-language source facts — T2 stable language identity", () => {
  it("maps each extension to the expected analyzer across a mixed-language project", async () => {
    const root = fixturePath("mixed-ts-python-jvm");
    const inventory = scanProjectInventory(root);
    const snapshot = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);

    const byPath = (p: string) => snapshot.files.find((f) => f.relativePath === p);

    expect(byPath("src/index.ts")?.analyzerId).toBe("typescript-javascript-analyzer");
    expect(byPath("src/helper.js")?.analyzerId).toBe("typescript-javascript-analyzer");
    expect(byPath("src/app.py")?.analyzerId).toBe("python-analyzer");
    expect(byPath("src/main/java/com/example/Multiplier.java")?.analyzerId).toBe("java-analyzer");
    expect(byPath("src/main/kotlin/com/example/Divider.kt")?.analyzerId).toBe("kotlin-analyzer");
  });

  it("routes a Gradle Kotlin DSL build script to config, never to the Kotlin analyzer", () => {
    const root = fixturePath("mixed-java-kotlin");
    const inventory = scanProjectInventory(root);
    const buildFile = inventory.files.find((f) => f.relativePath === "build.gradle.kts");
    const settingsFile = inventory.files.find((f) => f.relativePath === "settings.gradle.kts");

    expect(buildFile?.role).toBe("config");
    expect(settingsFile?.role).toBe("config");
    // Config-role files are ineligible for source-fact collection entirely
    // (collectSourceFacts.ts's ANALYZABLE_ROLES is {source, test} only), so
    // selecting an analyzer for them would never even be attempted in
    // practice -- but confirm directly that if it were, .kts still resolves
    // to the Kotlin analyzer only for genuine Kotlin *source* extensions,
    // never based on role.
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "kotlin", ".kts")?.id).toBe("kotlin-analyzer");
  });
});

describe("mixed-language source facts — T3 stable file-role classification", () => {
  it("classifies JVM source-set and test-set directories, config, and generated/vendor consistently", () => {
    const root = fixturePath("mixed-java-kotlin");
    const inventory = scanProjectInventory(root);
    const roleOf = (p: string) => inventory.files.find((f) => f.relativePath === p)?.role;

    expect(roleOf("src/main/java/com/example/FooService.java")).toBe("source");
    expect(roleOf("src/main/kotlin/com/example/BarService.kt")).toBe("source");
    expect(roleOf("src/test/java/com/example/FooServiceTest.java")).toBe("test");
    expect(roleOf("src/test/kotlin/com/example/BarServiceTest.kt")).toBe("test");
    expect(roleOf("build.gradle.kts")).toBe("config");
    expect(roleOf("settings.gradle.kts")).toBe("config");
  });

  it("classifies generated/vendor files without polluting source facts, and excludes dist/build entirely", () => {
    const root = fixturePath("mixed-generated-vendor");
    const inventory = scanProjectInventory(root);
    const roleOf = (p: string) => inventory.files.find((f) => f.relativePath === p)?.role;

    expect(roleOf("src/index.ts")).toBe("source");
    expect(roleOf("generated/schema.ts")).toBe("generated");
    expect(roleOf("vendor/lib.py")).toBe("vendor");
    // dist/ and build/ are hard-excluded directory names (never descended
    // into at all), so their contents never reach the inventory.
    expect(inventory.files.some((f) => f.relativePath.startsWith("dist/"))).toBe(false);
    expect(inventory.files.some((f) => f.relativePath.startsWith("build/"))).toBe(false);

    const snapshot = collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);
    return snapshot.then((s) => {
      const paths = s.files.map((f) => f.relativePath);
      expect(paths).toContain("src/index.ts");
      expect(paths).not.toContain("generated/schema.ts");
      expect(paths).not.toContain("vendor/lib.py");
      expect(paths).not.toContain("dist/index.js");
      expect(paths).not.toContain("build/Main.class");
    });
  });
});

describe("mixed-language source facts — T4 deterministic declarations", () => {
  it("returns the same normalized declaration list across repeated collections", async () => {
    const root = fixturePath("mixed-ts-python-jvm");
    const inventory = scanProjectInventory(root);
    const first = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);
    const second = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);

    const declOf = (snap: typeof first, p: string) =>
      snap.files.find((f) => f.relativePath === p)?.declarations.map((d) => `${d.kind}:${d.name}`);

    for (const p of [
      "src/main/java/com/example/Multiplier.java",
      "src/main/kotlin/com/example/Divider.kt",
      "src/app.py",
    ]) {
      expect(declOf(first, p)).toEqual(declOf(second, p));
    }
    expect(first.files.map((f) => f.relativePath)).toEqual(second.files.map((f) => f.relativePath));
  });
});

describe("mixed-language source facts — T5 deterministic diagnostics", () => {
  it("produces stable diagnostics with no compiler/runtime claims across repeated runs", async () => {
    const root = fixturePath("mixed-ts-python-jvm");
    const inventory = scanProjectInventory(root);
    const first = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);
    const second = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);

    expect(first.filesByParseStatus).toEqual(second.filesByParseStatus);
    expect(first.analyzerDiagnostics).toEqual(second.analyzerDiagnostics);

    for (const file of first.files) {
      for (const diagnostic of file.diagnostics) {
        expect(diagnostic.message).not.toMatch(/compil|javac|kotlinc|gradle build|maven build/i);
      }
    }
  });
});

describe("mixed-language source facts — T6 fallback behavior remains stable", () => {
  it("does not crash or misassign a language for an unsupported extension alongside a mixed-language project", async () => {
    const root = fixturePath("mixed-docs-claims");
    const inventory = scanProjectInventory(root);
    // README.md/build.gradle.kts are present (docs/config roles) alongside
    // real Java/Kotlin source -- neither is source-facts eligible, and their
    // presence must not disturb the Java/Kotlin entries.
    const snapshot = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);
    const paths = snapshot.files.map((f) => f.relativePath);
    expect(paths).not.toContain("README.md");
    expect(paths).not.toContain("build.gradle.kts");

    const java = snapshot.files.find((f) => f.relativePath === "src/main/java/com/example/Widget.java");
    const kt = snapshot.files.find((f) => f.relativePath === "src/main/kotlin/com/example/Gadget.kt");
    expect(java?.parseStatus).toBe("parsed");
    expect(kt?.parseStatus).toBe("parsed");
  });
});

describe("mixed-language source facts — T7 SourceFacts schema remains unchanged", () => {
  it("conforms to the existing SourceFileFacts shape with no Java/Kotlin-only required fields", async () => {
    const root = fixturePath("mixed-ts-python-jvm");
    const inventory = scanProjectInventory(root);
    const snapshot = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);

    const expectedKeys = [
      "relativePath",
      "language",
      "role",
      "parseStatus",
      "analyzerId",
      "imports",
      "exports",
      "declarations",
      "references",
      "diagnostics",
    ].sort();

    for (const file of snapshot.files) {
      const actualKeys = Object.keys(file)
        .filter((k) => k !== "lineCount")
        .sort();
      expect(actualKeys).toEqual(expectedKeys);
    }
  });
});

describe("mixed-language source facts — T8 report source-facts summary compatibility", () => {
  it("flows a mixed-language fixture through the full audit report model without schema drift", async () => {
    const root = fixturePath("mixed-ts-python-jvm");
    const config = normalizeAuditConfig({}, root);
    const target = fakeTargetFor(root);
    const result = await runAudit({ config, toolRoot: root, target });

    const model = buildAuditReportModel(result, { target });
    const json = renderAuditJsonReport(model);
    const parsed = JSON.parse(json);

    expect(parsed.sourceFacts).toBeDefined();
    expect(parsed.sourceFacts.filesByLanguage.typescript).toBeGreaterThan(0);
    expect(parsed.sourceFacts.filesByLanguage.python).toBeGreaterThan(0);
    expect(parsed.sourceFacts.filesByLanguage.java).toBeGreaterThan(0);
    expect(parsed.sourceFacts.filesByLanguage.kotlin).toBeGreaterThan(0);
    expect(parsed.securitySummary).toBeDefined();
    expect(parsed.securitySummary.ran).toBeDefined();
  });
});
