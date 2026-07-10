import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { collectSourceFacts } from "../../../src/audits/core/collectSourceFacts.js";
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
  return TEST_ROT_DETECTOR.run(ctx);
}

async function buildContextWithSourceFacts(root: string): Promise<AuditDetectorContext> {
  const ctx = buildContext(root);
  const sourceFacts = await collectSourceFacts(root, ctx.inventory);
  return { ...ctx, sourceFacts };
}

describe("TEST_ROT_DETECTOR — missing source imports", () => {
  it("flags a test importing a missing source file", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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

  it("T8: flags a Python test importing a missing sibling name via bare 'from . import name'", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/test_foo.py", "from . import missing_sibling\n");
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await TEST_ROT_DETECTOR.run(ctx);
      expect(issues.some((i) => i.title.includes("missing_sibling") || i.title.includes('"."'))).toBe(true);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
      const issue = issues.find((i) => i.title.includes("may not exist"));
      expect(issue).toBeDefined();
      expect(issue?.title).toContain("com.example.MissingThing");
      expect(issue?.severity).toBe("low");
      expect(issue?.confidence).toBe("low");
      expect(issue?.evidence.some((e) => e.excerpt === "com.example.MissingThing")).toBe(true);
      // Conservative wording -- this is a candidate, not a proven-broken test.
      expect(issue?.description.toLowerCase()).not.toContain("broken test");
      expect(issue?.description.toLowerCase()).not.toContain("missing dependency");
      expect(issue?.description).toContain("no compiler/classpath analysis was performed");
      expect(issue?.description).toContain("no Gradle/Maven execution was performed");
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      writeFile(root, "src/main/kotlin/com/example/Foo.kt", "package com.example\n\nclass Foo\n");
      writeFile(root, "src/test/kotlin/com/example/FooSpec.kt", "package com.example\n\nimport com.example.Foo\n\nclass FooSpec\n");
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
        "package com.example\n\nimport com.example.MissingThing\n\nclass FooSpec\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await TEST_ROT_DETECTOR.run(ctx);
      const issue = issues.find((i) => i.title.includes("may not exist"));
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

  it("does not flag a Kotlin test importing an aliased existing local class", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/kotlin/com/example/Foo.kt", "package com.example\n\nclass Foo\n");
      writeFile(
        root,
        "src/test/kotlin/com/example/FooSpec.kt",
        "package com.example\n\nimport com.example.Foo as Bar\n\nclass FooSpec\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await TEST_ROT_DETECTOR.run(ctx);
      expect(issues.some((i) => i.title.includes("may not exist"))).toBe(false);
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
        "package com.example\n\nimport com.example.JavaHelper\n\nclass FooSpec\n"
      );
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
      const matches = issues.filter((i) => i.title.includes("com.example.MissingThing"));
      expect(matches).toHaveLength(1);
    } finally {
      cleanup(root);
    }
  });
});

describe("TEST_ROT_DETECTOR — real self-scan regression guard", () => {
  it("produces no .only findings against this repo's own current test suite", async () => {
    const issues = await run(process.cwd());
    expect(issues.some((i) => i.title.includes(".only("))).toBe(false);
  });

  // v0.3.2 Batch 2 -- the test above uses run() (no sourceFacts), which
  // never exercises findMissingPythonSourceImports() against this repo's
  // real Python benchmark fixtures. This is the real regression guard.
  it("does not crash and stays conservative for Python test-rot findings against this repo's own real source facts", async () => {
    const ctx = await buildContextWithSourceFacts(process.cwd());
    const issues = await TEST_ROT_DETECTOR.run(ctx);
    const pythonImportIssues = issues.filter((i) => i.id.includes("missing-python-source-import"));
    expect(pythonImportIssues.every((i) => i.severity === "low" || i.severity === "info")).toBe(true);
  });
});

describe("TEST_ROT_DETECTOR — source-facts-derived missing imports", () => {
  it("flags a dynamic import to a missing source file that the regex-based check cannot see", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
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
      const issues = await TEST_ROT_DETECTOR.run(ctx);
      expect(issues.some((i) => i.title.includes("missing source file"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not crash and falls back to the regex-only check when sourceFacts is absent", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/example.test.ts", 'import { thing } from "../src/doesNotExist.js";\nthing();\n');
      const issues = await run(root); // buildContext() with no sourceFacts field
      expect(issues.some((i) => i.title.includes("missing source file"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not double-report the same missing specifier when both the regex and source-facts checks match it", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/example.test.ts", 'import { thing } from "../src/doesNotExist.js";\nthing();\n');
      const ctx = await buildContextWithSourceFacts(root);
      const issues = await TEST_ROT_DETECTOR.run(ctx);
      const matches = issues.filter((i) => i.title.includes("missing source file") && i.title.includes("doesNotExist.js"));
      expect(matches).toHaveLength(1);
    } finally {
      cleanup(root);
    }
  });
});
