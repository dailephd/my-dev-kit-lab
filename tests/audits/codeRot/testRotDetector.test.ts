import { runAudit } from "../../../src/audits/core/auditRunner.js";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { collectKitSourceFacts } from "../../../src/audits/core/kitSourceProvider.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { TEST_ROT_DETECTOR } from "../../../src/audits/codeRot/detectors/testRotDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "test-rot-test-"));
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
  const config = normalizeAuditConfig({ include: "docs,tests,package,architecture,cli" }, root);
  return { target, config, inventory, sourceOfTruth };
}

async function run(root: string) {
  const ctx = buildContext(root);
  return executeWithKit(ctx);
}

async function buildContextWithSourceFacts(root: string): Promise<AuditDetectorContext> {
  // Acquisition belongs to runAudit, which supplies both facts and reader.
  return buildContext(root);
}

describe("TEST_ROT_DETECTOR — missing source imports", () => {
  it("flags a test importing a missing source file", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/selectionWitness.ts", "export {};\n");
      writeFile(root, "tests/example.test.ts", 'import { thing } from "../src/doesNotExist.js";\nthing();\n');
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("missing source file"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a test importing an existing source file", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/thing.ts", "export const thing = () => {};\n");
      writeFile(root, "tests/example.test.ts", 'import { thing } from "../src/thing.js";\nthing();\n');
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("missing source file"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("TEST_ROT_DETECTOR — stale npm-run references", () => {
  it("flags a test referencing a non-existent npm script", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { build: "tsc" } }));
      writeFile(root, "tests/example.test.ts", 'it("runs npm run totally-fake", () => { expect(true).toBe(true); });\n');
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("totally-fake"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a test referencing a current npm script", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { build: "tsc" } }));
      writeFile(root, "tests/example.test.ts", 'it("runs npm run build", () => { expect(true).toBe(true); });\n');
      const issues = await run(root);
      expect(issues.some((i) => i.category === "test-rot" && i.title.includes("stale-npm-run"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("TEST_ROT_DETECTOR — .skip and .only", () => {
  it("flags describe.skip usage", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/example.test.ts", 'describe.skip("thing", () => {\n  it("works", () => {});\n});\n');
      const issues = await run(root);
      const issue = issues.find((i) => i.title.includes("describe.skip("));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("medium");
    } finally {
      cleanup(root);
    }
  });

  it("flags it.only usage with high severity", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/example.test.ts", 'it.only("works", () => { expect(true).toBe(true); });\n');
      const issues = await run(root);
      const issue = issues.find((i) => i.title.includes("it.only("));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("high");
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a clean test file with no .skip/.only", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/example.test.ts", 'it("works", () => { expect(true).toBe(true); });\n');
      const issues = await run(root);
      expect(issues.some((i) => i.category === "test-rot" && (i.title.includes(".skip(") || i.title.includes(".only(")))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("TEST_ROT_DETECTOR — stale version mentions in test titles", () => {
  it("flags a test title mentioning an old version", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "2.0.0", scripts: {} }));
      writeFile(root, "tests/example.test.ts", 'it("works for v1.0.0", () => { expect(true).toBe(true); });\n');
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("mentions version v1.0.0"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a version mention hedged with 'regression'", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "2.0.0", scripts: {} }));
      writeFile(root, "tests/example.test.ts", 'it("regression test for v1.0.0 bug", () => { expect(true).toBe(true); });\n');
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("mentions version v1.0.0"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("TEST_ROT_DETECTOR — package scripts referencing missing test paths", () => {
  it("flags a vitest run script referencing a missing path", async () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { "test:missing": "vitest run tests/does-not-exist" } })
      );
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("does not exist"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a vitest run script referencing an existing path", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { "test:real": "vitest run tests/real" } }));
      writeFile(root, "tests/real/example.test.ts", 'it("works", () => { expect(true).toBe(true); });\n');
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("does not exist"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("TEST_ROT_DETECTOR — Python test/source mapping (Batch 2)", () => {
  it("T7: does not flag a valid pytest-style test importing an existing source module (tests/test_foo.py -> src/pkg/foo.py)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/pkg/foo.py", "def do_thing():\n    return 1\n");
      writeFile(root, "tests/test_foo.py", "from ..src.pkg.foo import do_thing\n");
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      expect(issues.some((i) => i.title.includes("may not exist"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T7: does not flag a same-directory pytest-style pair (test_foo.py -> foo.py)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/foo.py", "def do_thing():\n    return 1\n");
      writeFile(root, "tests/test_foo.py", "from .foo import do_thing\n");
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      expect(issues.some((i) => i.title.includes("may not exist"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T8: flags a Python test importing a missing local module as a candidate, with path/import evidence and conservative wording", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/test_foo.py", "from .missing_module import Thing\n");
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      const issue = issues.find((i) => i.title.includes("may not exist"));
      expect(issue).toBeDefined();
      expect(issue?.title).toContain(".missing_module");
      expect(issue?.severity).toBe("low");
      expect(issue?.confidence).toBe("low");
      expect(issue?.evidence.some((e) => e.filePath === "tests/test_foo.py" && e.excerpt === ".missing_module")).toBe(true);
      // Conservative wording -- this is a candidate, not a proven-broken test.
      expect(issue?.description.toLowerCase()).not.toContain("broken test");
      expect(issue?.description.toLowerCase()).not.toContain("missing dependency");
    } finally {
      cleanup(root);
    }
  });

  it("T8: rejects an unqualified Python sibling import proof without guessing a target", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/test_foo.py", "from . import missing_sibling\n");
      const ctx = await buildContextWithSourceFacts(root);
      await expect(executeWithKit(ctx)).rejects.toThrow(/PYTHON_CANDIDATES_NOT_ENUMERABLE/);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a Python test importing a non-relative (absolute/third-party) module", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/test_foo.py", "import os\nfrom pkg.module import Name\n");
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      expect(issues.some((i) => i.title.includes("may not exist"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not double-report a Python test-rot finding across repeated deduplication", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/test_foo.py", "from .missing_module import Thing\n");
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      const matches = issues.filter((i) => i.title.includes(".missing_module"));
      expect(matches).toHaveLength(1);
    } finally {
      cleanup(root);
    }
  });

  it("T9: adds pytest-configuration presence as weak supporting evidence when present, without changing severity/confidence", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "pytest.ini", "[pytest]\n");
      writeFile(root, "tests/test_foo.py", "from .missing_module import Thing\n");
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      const issue = issues.find((i) => i.title.includes("may not exist"));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("low");
      expect(issue?.confidence).toBe("low");
      expect(issue?.evidence.some((e) => e.message.includes("pytest configuration"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("T9: remains deterministic and does not overclaim when no pytest configuration is present", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/test_foo.py", "from .missing_module import Thing\n");
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      const issue = issues.find((i) => i.title.includes("may not exist"));
      expect(issue).toBeDefined();
      expect(issue?.evidence.some((e) => e.message.includes("pytest configuration"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("TEST_ROT_DETECTOR — Java test/source mapping (v0.3.3 Batch 2)", () => {
  it("T10: does not flag a valid Java test importing an existing source class (src/test/java -> src/main/java)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/java/com/example/Foo.java", "package com.example;\n\npublic class Foo {\n}\n");
      writeFile(
        root,
        "src/test/java/com/example/FooTest.java",
        "package com.example;\n\nimport com.example.Foo;\n\nclass FooTest {\n}\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      expect(issues.some((i) => i.title.includes("may not exist"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T11: flags a Java test importing a missing local class as a candidate, with path/import evidence and conservative wording", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "src/test/java/com/example/FooTest.java",
        "package com.example;\n\nimport com.example.MissingThing;\n\nclass FooTest {\n}\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      const issue = issues.find((i) => i.title.includes("has no selected Java declaration"));
      expect(issue).toBeDefined();
      expect(issue?.title).toContain("com.example.MissingThing");
      expect(issue?.severity).toBe("low");
      expect(issue?.confidence).toBe("low");
      expect(issue?.evidence.some((e) => e.excerpt === "com.example.MissingThing")).toBe(true);
      // Conservative wording -- this is a candidate, not a proven-broken test.
      expect(issue?.description.toLowerCase()).not.toContain("broken test");
      expect(issue?.description.toLowerCase()).not.toContain("missing dependency");
      expect(issue?.description).toContain("complete witnessed selected ordinary JVM source domain");
      expect(issue?.description).toContain("does not establish static-member binding or global compiler/classpath absence");
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a Java static import resolving to an existing local class", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/java/com/example/Foo.java", "package com.example;\n\npublic class Foo {\n    public static int bar() { return 1; }\n}\n");
      writeFile(
        root,
        "src/test/java/com/example/FooTest.java",
        "package com.example;\n\nimport static com.example.Foo.bar;\n\nclass FooTest {\n}\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      expect(issues.some((i) => i.title.includes("may not exist"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("TEST_ROT_DETECTOR — Kotlin test/source mapping (v0.3.3 Batch 2)", () => {
  it("T12: does not flag a valid Kotlin test importing an existing source class (src/test/kotlin -> src/main/kotlin)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/kotlin/com/example/Foo.kt", "package com.example\n\nclass Foo {}\n");
      writeFile(root, "src/test/kotlin/com/example/FooSpec.kt", "package com.example\n\nimport com.example.Foo\n\nclass FooSpec {}\n");
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      expect(issues.some((i) => i.title.includes("may not exist"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T13: flags a Kotlin test importing a missing local class/function as a candidate, with path/import evidence and conservative wording", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "src/test/kotlin/com/example/FooSpec.kt",
        "package com.example\n\nimport com.example.MissingThing\n\nclass FooSpec {}\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      const issue = issues.find((i) => i.title.includes("has no selected Kotlin declaration"));
      expect(issue).toBeDefined();
      expect(issue?.title).toContain("com.example.MissingThing");
      expect(issue?.severity).toBe("low");
      expect(issue?.confidence).toBe("low");
      expect(issue?.description.toLowerCase()).not.toContain("broken test");
      expect(issue?.description.toLowerCase()).not.toContain("missing dependency");
    } finally {
      cleanup(root);
    }
  });

  it("fails closed for an aliased Kotlin import whose declaration domain is unqualified", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/kotlin/com/example/Foo.kt", "package com.example\n\nclass Foo {}\n");
      writeFile(
        root,
        "src/test/kotlin/com/example/FooSpec.kt",
        "package com.example\n\nimport com.example.Foo as Bar\n\nclass FooSpec {}\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      await expect(executeWithKit(ctx)).rejects.toThrow(/JVM_DECLARATION_DOMAIN_INCOMPLETE/);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a Kotlin test importing an existing Java class in a mixed JVM project", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/java/com/example/JavaHelper.java", "package com.example;\n\npublic class JavaHelper {\n}\n");
      writeFile(
        root,
        "src/test/kotlin/com/example/FooSpec.kt",
        "package com.example\n\nimport com.example.JavaHelper\n\nclass FooSpec {}\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      expect(issues.some((i) => i.title.includes("may not exist"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("TEST_ROT_DETECTOR — JVM standard-library/third-party import suppression (T14)", () => {
  it("does not flag Java standard-library and common test-framework imports", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "src/test/java/com/example/FooTest.java",
        [
          "package com.example;",
          "",
          "import java.util.List;",
          "import javax.annotation.Nullable;",
          "import jakarta.inject.Inject;",
          "import org.junit.Test;",
          "import org.assertj.core.api.Assertions;",
          "import org.mockito.Mockito;",
          "import org.hamcrest.Matchers;",
          "",
          "class FooTest {",
          "}",
        ].join("\n") + "\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      expect(issues.some((i) => i.title.includes("may not exist"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag Kotlin standard-library and common test-framework imports", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "src/test/kotlin/com/example/FooSpec.kt",
        [
          "package com.example",
          "",
          "import kotlin.collections.List",
          "import kotlinx.coroutines.runBlocking",
          "import java.util.UUID",
          "import io.kotest.matchers.shouldBe",
          "",
          "class FooSpec",
        ].join("\n") + "\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      expect(issues.some((i) => i.title.includes("may not exist"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a wildcard JVM import", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "src/test/java/com/example/FooTest.java",
        "package com.example;\n\nimport com.example.other.*;\n\nclass FooTest {\n}\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      expect(issues.some((i) => i.title.includes("may not exist"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not double-report a JVM test-rot finding across repeated deduplication", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "src/test/java/com/example/FooTest.java",
        "package com.example;\n\nimport com.example.MissingThing;\n\nclass FooTest {\n}\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      const matches = issues.filter((i) => i.title.includes("com.example.MissingThing"));
      expect(matches).toHaveLength(1);
    } finally {
      cleanup(root);
    }
  });
});

describe("TEST_ROT_DETECTOR — real self-scan regression guard", () => {
  it.each(["tmp", ".my-dev-kit-workflow"])("excludes generated %s inputs while retaining current tests and source facts", async (generated) => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/current.py", "value = 1\n");
      writeFile(root, "tests/test_current.py", "def test_current():\n    assert True\n");
      writeFile(root, "tests/current.test.ts", 'it.only("current", () => {});\n');
      writeFile(root, `${generated}/history/tests/copied.test.ts`, 'it.only("historical", () => {});\n');
      writeFile(root, `${generated}/history/src/copied.py`, "historical = True\n");
      writeFile(root, `${generated}-notes/tests/current.test.ts`, 'it.only("retained", () => {});\n');
      const ctx = await buildContextWithSourceFacts(root);
      // This test inspects the snapshot itself as well as runner findings.
      ctx.sourceFacts = await collectKitSourceFacts({ targetRoot: root, inventory: ctx.inventory, requiredCapabilities: [], includeScriptsRoot: true }, {

      });
      expect(ctx.inventory.files.some((file) => file.relativePath.startsWith(`${generated}/`))).toBe(false);
      expect(ctx.sourceFacts!.files.some((file) => file.relativePath.startsWith(`${generated}/`))).toBe(false);
      expect(ctx.sourceFacts!.files.map((file) => file.relativePath)).toEqual(expect.arrayContaining(["src/current.py", "tests/test_current.py"]));
      expect(ctx.inventory.excludedDirectorySummary).toContainEqual({ name: generated, occurrences: 1 });
      const issues = await executeWithKit(ctx);
      const focused = issues.filter((issue) => issue.title.includes(".only("));
      expect(focused.map((issue) => issue.affectedFiles[0]).sort()).toEqual([`${generated}-notes/tests/current.test.ts`, "tests/current.test.ts"].sort());
      expect(focused.every((issue) => issue.severity === "high")).toBe(true);
      // Exclusion applies to descendants, never an explicitly selected target.
      const explicit = await run(path.join(root, generated, "history"));
      expect(explicit.some((issue) => issue.title.includes(".only(") && issue.severity === "high")).toBe(true);
    } finally {
      cleanup(root);
    }
  }, 90000);

  it("fails closed when a whole-repository test import lacks a qualified proof", async () => {
    await expect(run(process.cwd())).rejects.toMatchObject({ category: "capability-insufficient" });
  }, 1800000);

  // Qualified bounded cases retain the finding-policy assertions independently
  // of the real repository acquisition failure above.
  it("preserves no-only and conservative Python severity policies over qualified source evidence", async () => {
    const root = makeTempDir();
    try {
    writeFile(root, "package.json", JSON.stringify({ name: "qualified-test-guard", version: "1.0.0" }));
    writeFile(root, "tests/test_foo.py", "from .missing_module import Thing\n");
    const ctx = await buildContextWithSourceFacts(root);
    const issues = await executeWithKit(ctx);
    expect(issues.some((i) => i.title.includes(".only("))).toBe(false);
    const pythonImportIssues = issues.filter((i) => i.id.includes("missing-python-source-import"));
    expect(pythonImportIssues.length).toBeGreaterThan(0);
    expect(pythonImportIssues.every((i) => i.severity === "low" || i.severity === "info")).toBe(true);
    } finally { cleanup(root); }
  }, 1800000);
});

describe("TEST_ROT_DETECTOR — source-facts-derived missing imports", () => {
  it("flags a dynamic import to a missing source file that the regex-based check cannot see", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/selectionWitness.ts", "export {};\n");
      // A dynamic import has no "from"/"require(" token, so
      // RELATIVE_IMPORT_PATTERN never matches it -- only the
      // TypeScript/JavaScript analyzer's structured ImportFact (kind
      // "dynamic") can see this specifier.
      writeFile(
        root,
        "tests/example.test.ts",
        'it("loads", async () => { const mod = await import("../src/missingDynamic.js"); expect(mod).toBeDefined(); });\n'
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      expect(issues.some((i) => i.title.includes("missing source file") && i.title.includes("missingDynamic.js"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a dynamic import that resolves to an existing source file", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/thing.ts", "export const thing = () => {};\n");
      writeFile(
        root,
        "tests/example.test.ts",
        'it("loads", async () => { const mod = await import("../src/thing.js"); expect(mod).toBeDefined(); });\n'
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      expect(issues.some((i) => i.title.includes("missing source file"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("acquires qualified Kit import proofs by default", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/selectionWitness.ts", "export {};\n");
      writeFile(root, "tests/example.test.ts", 'import { thing } from "../src/doesNotExist.js";\nthing();\n');
      const issues = await run(root); // buildContext() with no sourceFacts field
      expect(issues.some((i) => i.title.includes("missing source file"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not double-report the same qualified missing specifier", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/selectionWitness.ts", "export {};\n");
      writeFile(root, "tests/example.test.ts", 'import { thing } from "../src/doesNotExist.js";\nthing();\n');
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await executeWithKit(ctx);
      const matches = issues.filter((i) => i.title.includes("missing source file") && i.title.includes("doesNotExist.js"));
      expect(matches).toHaveLength(1);
    } finally {
      cleanup(root);
    }
  });
});

// Real whole-repository acquisition performs paged CLI queries for every selected file.
// Its integration timeout includes those queries; finding assertions remain unchanged.
// Test setup delegates source acquisition to the real qualified provider.
let selfRun: Promise<Awaited<ReturnType<typeof TEST_ROT_DETECTOR.run>>> | undefined;
async function executeWithKit(ctx: AuditDetectorContext) {
  const perform = async () => {
  const result = await runAudit({ config: ctx.config, toolRoot: ctx.target.rootPath, target: ctx.target, registry: [TEST_ROT_DETECTOR],
    kitSourceProviderDependencies: {} });
  if (result.detectorErrors.length) throw new Error(JSON.stringify(result.detectorErrors));
  return result.issues;

  };
  if (path.resolve(ctx.target.rootPath) === path.resolve(process.cwd())) return selfRun ??= perform();
  return perform();
}
