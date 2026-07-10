import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { collectSourceFacts } from "../../../src/audits/core/collectSourceFacts.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { DOCS_CODE_MISMATCH_DETECTOR } from "../../../src/audits/codeRot/detectors/docsCodeMismatchDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "docs-mismatch-test-"));
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

function writeFile(root: string, relativePath: string, content = ""): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function buildContext(root: string): AuditDetectorContext {
  const inventory = scanProjectInventory(root);
  const sourceOfTruth = collectSourceOfTruth(root, inventory);
  const target = resolveAuditTarget(undefined, root);
  const config = normalizeAuditConfig({}, root);
  return { target, config, inventory, sourceOfTruth };
}

async function run(root: string) {
  const ctx = buildContext(root);
  return DOCS_CODE_MISMATCH_DETECTOR.run(ctx);
}

async function runWithSourceFacts(root: string) {
  const ctx = buildContext(root);
  const sourceFacts = await collectSourceFacts(root, ctx.inventory);
  return DOCS_CODE_MISMATCH_DETECTOR.run({ ...ctx, sourceFacts });
}

function writeFixturePackage(root: string, overrides: Record<string, unknown> = {}): void {
  writeFile(
    root,
    "package.json",
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      scripts: {},
      ...overrides,
    })
  );
}

describe("DOCS_CODE_MISMATCH_DETECTOR — feature claims", () => {
  it("flags docs saying a feature is implemented/current when source-of-truth shows it is missing", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Security validation is implemented in this project.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.category === "docs-feature-mismatch" && i.title.includes("security validation"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("flags docs saying a feature is planned/future when it is already implemented", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root, { scripts: { "security:validate": "tsx scripts/security/validate.ts" } });
      writeFile(root, "src/securityValidation/index.ts", "export {};\n");
      writeFile(root, "README.md", "Security validation is planned for a future release.\n");
      const issues = await run(root);
      expect(
        issues.some((i) => i.title.includes("planned/future") && i.title.includes("security validation"))
      ).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a correct claim (feature is implemented and actually is)", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root, { scripts: { "security:validate": "tsx scripts/security/validate.ts" } });
      writeFile(root, "src/securityValidation/index.ts", "export {};\n");
      writeFile(root, "README.md", "Security validation is implemented in this project.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.category === "docs-feature-mismatch" && i.title.includes("security validation"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DOCS_CODE_MISMATCH_DETECTOR — full-release-gate scoped claim", () => {
  it("flags a scoped run described as a full release gate", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "A scoped run should be treated as a full release gate.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("full release gate"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a correctly-hedged denial of the full-release-gate claim", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "A scoped run is not the same as a full release gate.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("full release gate"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DOCS_CODE_MISMATCH_DETECTOR — ambiguous prose", () => {
  it("reports a genuinely ambiguous same-line claim as low-confidence info, not skipped silently", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Security validation is implemented, but security validation is planned.\n");
      const issues = await run(root);
      const ambiguous = issues.find((i) => i.category === "docs-feature-mismatch-ambiguous");
      expect(ambiguous).toBeDefined();
      expect(ambiguous?.severity).toBe("info");
      expect(ambiguous?.confidence).toBe("low");
    } finally {
      cleanup(root);
    }
  });

  it("does not treat the standard 'planned but not implemented' hedge phrase as ambiguous noise", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(
        root,
        "ROADMAP.md",
        "This roadmap separates the implemented baseline from planned work.\n"
      );
      const issues = await run(root);
      expect(issues.some((i) => i.category === "docs-feature-mismatch-ambiguous")).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DOCS_CODE_MISMATCH_DETECTOR — evidence and de-duplication", () => {
  it("issues include confidence and falsePositiveRisk", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Security validation is implemented in this project.\n");
      const issues = await run(root);
      for (const issue of issues) {
        expect(issue.confidence).toBeDefined();
        expect(issue.falsePositiveRisk).toBeDefined();
      }
    } finally {
      cleanup(root);
    }
  });

  it("de-duplicates the same claim repeated in one file", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(
        root,
        "README.md",
        "Security validation is implemented here.\nSecurity validation is implemented here too.\n"
      );
      const issues = await run(root);
      const matches = issues.filter((i) => i.category === "docs-feature-mismatch" && i.title.includes("security validation"));
      expect(matches).toHaveLength(1);
    } finally {
      cleanup(root);
    }
  });
});

describe("DOCS_CODE_MISMATCH_DETECTOR — Java/Kotlin symbol claims (v0.3.3 Batch 3)", () => {
  it("T1: does not flag a Java symbol claim matched by static source facts", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "src/main/java/com/example/Foo.java", "package com.example;\n\npublic class Foo {\n}\n");
      writeFile(root, "README.md", "Java support includes the `com.example.Foo` class.\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes("com.example.Foo"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T2: flags a Java symbol claim absent from static source facts as a conservative candidate", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "src/main/java/com/example/Foo.java", "package com.example;\n\npublic class Foo {\n}\n");
      writeFile(root, "README.md", "The current Java API includes `com.example.MissingFoo`.\n");
      const issues = await runWithSourceFacts(root);
      const issue = issues.find((i) => i.title.includes("com.example.MissingFoo"));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("info");
      expect(issue?.confidence).toBe("low");
      expect(issue?.category).toBe("docs-feature-mismatch");
      // Conservative wording -- never claim compilation/build/test outcomes.
      expect(issue?.description.toLowerCase()).not.toContain("broken");
      expect(issue?.description.toLowerCase()).not.toContain("compile error");
      expect(issue?.description.toLowerCase()).not.toContain("test failure");
      expect(issue?.description.toLowerCase()).not.toContain("missing dependency");
      expect(issue?.description).toContain("weak signal");
    } finally {
      cleanup(root);
    }
  });

  it("T3: does not flag a Kotlin symbol claim matched by static source facts", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "src/main/kotlin/com/example/FooService.kt", "package com.example\n\nclass FooService\n");
      writeFile(root, "README.md", "Kotlin support includes `com.example.FooService`.\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes("com.example.FooService"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T4: flags a Kotlin symbol claim absent from static source facts as a conservative candidate", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "src/main/kotlin/com/example/FooService.kt", "package com.example\n\nclass FooService\n");
      writeFile(root, "README.md", "The current Kotlin API includes `com.example.MissingService`.\n");
      const issues = await runWithSourceFacts(root);
      const issue = issues.find((i) => i.title.includes("com.example.MissingService"));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("info");
      expect(issue?.confidence).toBe("low");
    } finally {
      cleanup(root);
    }
  });

  it("does not flag any symbol claim when the project has no real Java/Kotlin source at all", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "The current API includes `com.example.Anything`.\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes("com.example.Anything"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a bare capitalized word without a dotted package prefix (too noisy to scan)", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "src/main/java/com/example/Foo.java", "package com.example;\n\npublic class Foo {\n}\n");
      writeFile(root, "README.md", "The `Widget` handles most of the work.\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes("Widget"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T5: does not flag a Java/Kotlin symbol claim explicitly hedged as planned/future/deferred/out of scope", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "src/main/java/com/example/Foo.java", "package com.example;\n\npublic class Foo {\n}\n");
      writeFile(
        root,
        "README.md",
        [
          "Support for `com.example.PlannedThing` is planned.",
          "Support for `com.example.FutureThing` is a future addition.",
          "Support for `com.example.DeferredThing` is deferred.",
          "`com.example.OutOfScopeThing` is out of scope.",
          "This project does not support `com.example.UnsupportedThing`.",
        ].join("\n") + "\n"
      );
      const issues = await runWithSourceFacts(root);
      for (const name of ["PlannedThing", "FutureThing", "DeferredThing", "OutOfScopeThing", "UnsupportedThing"]) {
        expect(issues.some((i) => i.title.includes(name))).toBe(false);
      }
    } finally {
      cleanup(root);
    }
  });
});

describe("DOCS_CODE_MISMATCH_DETECTOR — Gradle/Maven feature and command claims (v0.3.3 Batch 3)", () => {
  it("does not flag a Gradle feature claim when Gradle metadata is present", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "build.gradle", "plugins { id 'java' }\n");
      writeFile(root, "settings.gradle", "rootProject.name = 'fixture'\n");
      writeFile(root, "README.md", "Gradle is implemented in this project.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"Gradle"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("flags a Gradle feature claim when no Gradle metadata is present", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Gradle is implemented in this project.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"Gradle"'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a Maven feature claim when a pom.xml is present", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "pom.xml", "<project></project>\n");
      writeFile(root, "README.md", "Maven is implemented in this project.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"Maven"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("flags a Maven feature claim when no Maven metadata is present", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Maven is implemented in this project.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"Maven"'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("T6: does not flag a Gradle command example when Gradle build/settings metadata is present", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "build.gradle", "plugins { id 'java' }\n");
      writeFile(root, "settings.gradle", "rootProject.name = 'fixture'\n");
      writeFile(root, "README.md", "Run `./gradlew test` to run the test suite.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("Gradle command example"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T7: flags a Gradle command example as a conservative candidate when no Gradle metadata is present", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Run `./gradlew test` to run the test suite.\n");
      const issues = await run(root);
      const issue = issues.find((i) => i.title.includes("Gradle command example"));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("info");
      expect(issue?.confidence).toBe("low");
      expect(issue?.description).toContain("no Gradle execution was performed");
      expect(issue?.description.toLowerCase()).not.toContain("broken");
      expect(issue?.description.toLowerCase()).not.toContain("compile error");
    } finally {
      cleanup(root);
    }
  });

  it("T8: does not flag a Maven command example when pom.xml is present", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "pom.xml", "<project></project>\n");
      writeFile(root, "README.md", "Run `mvn test` to run the test suite.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("Maven command example"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T9: flags a Maven command example as a conservative candidate when no Maven metadata is present", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Run `mvn test` to run the test suite.\n");
      const issues = await run(root);
      const issue = issues.find((i) => i.title.includes("Maven command example"));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("info");
      expect(issue?.confidence).toBe("low");
      expect(issue?.description).toContain("no Maven execution was performed");
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a Gradle/Maven command example that is hedged as planned/future/out of scope", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(
        root,
        "README.md",
        ["Gradle support is planned; a future workflow will run `./gradlew test`.", "Maven support is out of scope; `mvn test` is not yet available."].join(
          "\n"
        ) + "\n"
      );
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("command example"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a plain mention of the word 'gradle'/'maven' outside a code span", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "This project does not use Gradle or Maven for its own build.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("command example"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DOCS_CODE_MISMATCH_DETECTOR — Android boundary (v0.3.3 Batch 3, T10)", () => {
  it("does not flag Android support described as planned", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Android validation is planned for a future version.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.toLowerCase().includes("android"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not treat Android-scoped planned security validation as a planned claim about the already-implemented general security-validation framework", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root, { scripts: { "security:validate": "tsx scripts/security/validate.ts" } });
      writeFile(root, "src/securityValidation/index.ts", "export {};\n");
      writeFile(root, "README.md", "Android automated security validation is planned for a future version.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"security validation" is planned/future'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag Android support described as out of scope", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Android validation is out of scope for this version.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.toLowerCase().includes("android"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("flags Android support described as current/implemented as a conservative docs-feature-mismatch, not Android validation behavior", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Android validation is implemented in this project.\n");
      const issues = await run(root);
      const issue = issues.find((i) => i.title.toLowerCase().includes("android"));
      expect(issue).toBeDefined();
      expect(issue?.category).toBe("docs-feature-mismatch");
      expect(issue?.severity).toBe("high");
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a '(non-Android)' negated qualifier as an Android current-implementation claim, even when 'is implemented' appears later in the same sentence about a different subject", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(
        root,
        "README.md",
        "The general (non-Android) security audit adapter is implemented in the published baseline.\n"
      );
      const issues = await run(root);
      expect(issues.some((i) => i.title.toLowerCase().includes("android"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});
