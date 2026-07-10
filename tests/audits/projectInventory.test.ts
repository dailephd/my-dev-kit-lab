import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "inventory-test-"));
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

// Builds a small, deterministic fixture project covering every category and
// exclusion rule under test.
function buildFixtureProject(): string {
  const root = makeTempDir();

  writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
  writeFile(root, "package-lock.json", JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }));
  writeFile(root, "README.md", "# Fixture Project\n\nSome docs.\n");
  writeFile(root, "docs/GUIDE.md", "# Guide\n");
  writeFile(root, "src/index.ts", "export const x = 1;\nexport const y = 2;\n");
  writeFile(root, "src/util.ts", "export function util() {}\n");
  writeFile(root, "tests/index.test.ts", "import {} from 'vitest';\n");
  writeFile(root, "scripts/build.ts", "console.log('build');\n");
  writeFile(root, "tsconfig.json", "{}");
  writeFile(root, ".github/workflows/ci.yml", "name: CI\n");
  writeFile(root, "unknown-data.bin", "\x00\x01\x02binarydata");

  // Excluded directories -- must never appear in the scanned output.
  writeFile(root, "node_modules/some-package/index.js", "module.exports = {};\n");
  writeFile(root, ".git/HEAD", "ref: refs/heads/main\n");
  writeFile(root, "dist/index.js", "module.exports = {};\n");
  writeFile(root, "build/output.js", "// built\n");
  writeFile(root, "coverage/lcov.info", "TN:\n");
  writeFile(root, "reports/security/report.json", "{}");
  writeFile(root, "lab-output/artifact.json", "{}");
  writeFile(root, ".my-dev-kit/index.json", "{}");

  return root;
}

describe("scanProjectInventory — fixture project classification", () => {
  it("classifies source files", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const sourcePaths = inventory.sourceFiles.map((f) => f.relativePath);
      expect(sourcePaths).toContain("src/index.ts");
      expect(sourcePaths).toContain("src/util.ts");
    } finally {
      cleanup(root);
    }
  });

  it("classifies test files", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.testFiles.map((f) => f.relativePath)).toContain("tests/index.test.ts");
    } finally {
      cleanup(root);
    }
  });

  it("classifies docs files", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const docsPaths = inventory.docsFiles.map((f) => f.relativePath);
      expect(docsPaths).toContain("README.md");
      expect(docsPaths).toContain("docs/GUIDE.md");
    } finally {
      cleanup(root);
    }
  });

  it("classifies package/config files", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const packagePaths = inventory.packageFiles.map((f) => f.relativePath);
      expect(packagePaths).toContain("package.json");
      expect(packagePaths).toContain("package-lock.json");
      const configEntry = inventory.files.find((f) => f.relativePath === "tsconfig.json");
      expect(configEntry?.category).toBe("config");
    } finally {
      cleanup(root);
    }
  });

  it("classifies script files", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.scriptFiles.map((f) => f.relativePath)).toContain("scripts/build.ts");
    } finally {
      cleanup(root);
    }
  });

  it("classifies CI workflow files", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.ciFiles.map((f) => f.relativePath)).toContain(".github/workflows/ci.yml");
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — exclusions", () => {
  it("excludes node_modules", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.files.some((f) => f.relativePath.startsWith("node_modules/"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("excludes .git", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.files.some((f) => f.relativePath.startsWith(".git/"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("excludes dist, build, and coverage", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.files.some((f) => f.relativePath.startsWith("dist/"))).toBe(false);
      expect(inventory.files.some((f) => f.relativePath.startsWith("build/"))).toBe(false);
      expect(inventory.files.some((f) => f.relativePath.startsWith("coverage/"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("excludes reports, lab-output, and .my-dev-kit", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.files.some((f) => f.relativePath.startsWith("reports/"))).toBe(false);
      expect(inventory.files.some((f) => f.relativePath.startsWith("lab-output/"))).toBe(false);
      expect(inventory.files.some((f) => f.relativePath.startsWith(".my-dev-kit/"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("records excluded directory occurrences in the summary", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const names = inventory.excludedDirectorySummary.map((e) => e.name);
      expect(names).toContain("node_modules");
      expect(names).toContain(".git");
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — Windows/paths-with-spaces support", () => {
  it("handles a directory and file path with spaces", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src dir/my file.ts", "export const x = 1;\n");
      const inventory = scanProjectInventory(root);
      expect(inventory.files.map((f) => f.relativePath)).toContain("src dir/my file.ts");
    } finally {
      cleanup(root);
    }
  });

  it("normalizes path separators to forward slashes regardless of platform", () => {
    const root = makeTempDir();
    try {
      writeFile(root, path.join("a", "b", "c.ts"), "export const x = 1;\n");
      const inventory = scanProjectInventory(root);
      const entry = inventory.files.find((f) => f.relativePath.endsWith("c.ts"));
      expect(entry?.relativePath).toBe("a/b/c.ts");
      expect(entry?.relativePath).not.toContain("\\");
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — normalized language classification", () => {
  it("classifies each known extension to its normalized language", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "a.ts", "");
      writeFile(root, "a.tsx", "");
      writeFile(root, "a.mts", "");
      writeFile(root, "a.cts", "");
      writeFile(root, "a.js", "");
      writeFile(root, "a.jsx", "");
      writeFile(root, "a.mjs", "");
      writeFile(root, "a.cjs", "");
      writeFile(root, "a.py", "");
      writeFile(root, "a.java", "");
      writeFile(root, "a.kt", "");
      writeFile(root, "a.kts", "");
      writeFile(root, "a.json", "{}");
      writeFile(root, "a.md", "");
      writeFile(root, "a.yaml", "");
      writeFile(root, "a.yml", "");
      writeFile(root, "a.xml", "");
      writeFile(root, "a.toml", "");
      writeFile(root, "a.weird", "");

      const inventory = scanProjectInventory(root);
      const languageOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.language;

      expect(languageOf("a.ts")).toBe("typescript");
      expect(languageOf("a.tsx")).toBe("typescript");
      expect(languageOf("a.mts")).toBe("typescript");
      expect(languageOf("a.cts")).toBe("typescript");
      expect(languageOf("a.js")).toBe("javascript");
      expect(languageOf("a.jsx")).toBe("javascript");
      expect(languageOf("a.mjs")).toBe("javascript");
      expect(languageOf("a.cjs")).toBe("javascript");
      expect(languageOf("a.py")).toBe("python");
      expect(languageOf("a.java")).toBe("java");
      expect(languageOf("a.kt")).toBe("kotlin");
      expect(languageOf("a.kts")).toBe("kotlin");
      expect(languageOf("a.json")).toBe("json");
      expect(languageOf("a.md")).toBe("markdown");
      expect(languageOf("a.yaml")).toBe("yaml");
      expect(languageOf("a.yml")).toBe("yaml");
      expect(languageOf("a.xml")).toBe("xml");
      expect(languageOf("a.toml")).toBe("toml");
      expect(languageOf("a.weird")).toBe("unknown");
    } finally {
      cleanup(root);
    }
  });

  it("summarizes filesByLanguage counts", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.filesByLanguage.typescript).toBeGreaterThan(0);
      expect(inventory.filesByLanguage.markdown).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — normalized file-role classification", () => {
  it("classifies source, test, docs, config, and package roles", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const roleOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.role;

      expect(roleOf("src/index.ts")).toBe("source");
      expect(roleOf("tests/index.test.ts")).toBe("test");
      expect(roleOf("README.md")).toBe("docs");
      expect(roleOf("docs/GUIDE.md")).toBe("docs");
      expect(roleOf("tsconfig.json")).toBe("config");
      expect(roleOf(".github/workflows/ci.yml")).toBe("config");
      expect(roleOf("package.json")).toBe("package");
      expect(roleOf("package-lock.json")).toBe("package");
    } finally {
      cleanup(root);
    }
  });

  it("classifies report-output paths for stray audit/security-validation report files", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "v1.0.0-security-validation.json", "{}");
      writeFile(root, "v1.0.0-audit.txt", "");
      const inventory = scanProjectInventory(root);
      const roleOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.role;
      expect(roleOf("v1.0.0-security-validation.json")).toBe("report-output");
      expect(roleOf("v1.0.0-audit.txt")).toBe("report-output");
    } finally {
      cleanup(root);
    }
  });

  it("classifies build-output, vendor, and generated paths not already excluded from traversal", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "packages/app/target/Main.class", "");
      writeFile(root, "packages/app/vendor/lib.js", "");
      writeFile(root, "packages/app/generated/schema.ts", "");
      writeFile(root, "packages/app/app.tsbuildinfo", "{}");
      const inventory = scanProjectInventory(root);
      const roleOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.role;

      expect(roleOf("packages/app/target/Main.class")).toBe("build-output");
      expect(roleOf("packages/app/vendor/lib.js")).toBe("vendor");
      expect(roleOf("packages/app/generated/schema.ts")).toBe("generated");
      expect(roleOf("packages/app/app.tsbuildinfo")).toBe("build-output");
    } finally {
      cleanup(root);
    }
  });

  it("summarizes filesByRole counts", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.filesByRole.source).toBeGreaterThan(0);
      expect(inventory.filesByRole.test).toBeGreaterThan(0);
      expect(inventory.filesByRole.docs).toBeGreaterThan(0);
      expect(inventory.filesByRole.package).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });

  it("sets isGenerated/isBuildOutput/isVendor/isReportOutput booleans consistent with role", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "packages/app/vendor/lib.js", "");
      const inventory = scanProjectInventory(root);
      const entry = inventory.files.find((f) => f.relativePath === "packages/app/vendor/lib.js");
      expect(entry?.role).toBe("vendor");
      expect(entry?.isVendor).toBe(true);
      expect(entry?.isGenerated).toBe(false);
      expect(entry?.isBuildOutput).toBe(false);
      expect(entry?.isReportOutput).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — Python file/role classification (Batch 1)", () => {
  it("classifies .py source files as language python and role source", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/lib.py", "x = 1\n");
      const inventory = scanProjectInventory(root);
      const entry = inventory.files.find((f) => f.relativePath === "src/lib.py");
      expect(entry?.language).toBe("python");
      expect(entry?.category).toBe("source");
      expect(entry?.role).toBe("source");
      expect(inventory.filesByLanguage.python).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });

  it("does not disturb existing TypeScript/JavaScript classification alongside Python files", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/lib.py", "x = 1\n");
      writeFile(root, "src/index.ts", "export const x = 1;\n");
      const inventory = scanProjectInventory(root);
      expect(inventory.files.find((f) => f.relativePath === "src/index.ts")?.language).toBe("typescript");
      expect(inventory.filesByLanguage.typescript).toBeGreaterThan(0);
      expect(inventory.filesByLanguage.python).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });

  it("classifies tests/**/*.py and test/**/*.py as role test", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "tests/test_widget.py", "def test_ok():\n    assert True\n");
      writeFile(root, "test/test_other.py", "def test_ok():\n    assert True\n");
      const inventory = scanProjectInventory(root);
      const roleOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.role;
      expect(roleOf("tests/test_widget.py")).toBe("test");
      expect(roleOf("test/test_other.py")).toBe("test");
    } finally {
      cleanup(root);
    }
  });

  it("classifies test_*.py and *_test.py naming conventions outside a tests/ directory as role test", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/test_widget.py", "def test_ok():\n    assert True\n");
      writeFile(root, "src/widget_test.py", "def test_ok():\n    assert True\n");
      writeFile(root, "src/widget.py", "def util():\n    return 1\n");
      const inventory = scanProjectInventory(root);
      const roleOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.role;
      expect(roleOf("src/test_widget.py")).toBe("test");
      expect(roleOf("src/widget_test.py")).toBe("test");
      // A normal source file that merely contains "test" mid-name (not the
      // test_*.py / *_test.py convention) must remain a plain source file.
      expect(roleOf("src/widget.py")).toBe("source");
    } finally {
      cleanup(root);
    }
  });

  it("does not misclassify a non-Python file merely for matching test_*/*_test naming", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/test_widget.ts", "export const x = 1;\n");
      const inventory = scanProjectInventory(root);
      // The Python-specific test_*.py/*_test.py conventions are gated to
      // .py -- a .ts file with the same naming shape is unaffected and
      // still governed only by the existing .test./.spec. TS/JS convention.
      expect(inventory.files.find((f) => f.relativePath === "src/test_widget.ts")?.role).toBe("source");
    } finally {
      cleanup(root);
    }
  });

  it("classifies recognized Python project/config metadata filenames as role config", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "pyproject.toml", "[project]\nname = \"fixture\"\n");
      writeFile(root, "requirements.txt", "requests==2.0.0\n");
      writeFile(root, "setup.py", "from setuptools import setup\nsetup(name='fixture')\n");
      writeFile(root, "setup.cfg", "[metadata]\nname = fixture\n");
      writeFile(root, "tox.ini", "[tox]\nenvlist = py311\n");
      writeFile(root, "pytest.ini", "[pytest]\n");
      const inventory = scanProjectInventory(root);
      const roleOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.role;
      const categoryOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.category;

      for (const name of ["pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "tox.ini", "pytest.ini"]) {
        expect(roleOf(name)).toBe("config");
        expect(categoryOf(name)).toBe("config");
      }
      // setup.py must not be classified as a plain Python source file.
      expect(categoryOf("setup.py")).not.toBe("source");
    } finally {
      cleanup(root);
    }
  });

  it("does not overclassify an arbitrary .toml/.ini/.txt file as Python project metadata", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "notes.txt", "just some notes\n");
      writeFile(root, "settings.ini", "[x]\n");
      writeFile(root, "other.toml", "[x]\n");
      const inventory = scanProjectInventory(root);
      const categoryOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.category;
      expect(categoryOf("notes.txt")).not.toBe("config");
      expect(categoryOf("settings.ini")).not.toBe("config");
      expect(categoryOf("other.toml")).not.toBe("config");
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — Java/Kotlin file/role classification (Batch 1)", () => {
  it("classifies .java and .kt source files under their normalized language and role source (T1)", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/main/java/com/example/Widget.java", "package com.example;\npublic class Widget {}\n");
      writeFile(root, "src/main/kotlin/com/example/Helper.kt", "package com.example\nclass Helper\n");
      const inventory = scanProjectInventory(root);
      const javaEntry = inventory.files.find((f) => f.relativePath === "src/main/java/com/example/Widget.java");
      const kotlinEntry = inventory.files.find((f) => f.relativePath === "src/main/kotlin/com/example/Helper.kt");

      expect(javaEntry?.language).toBe("java");
      expect(javaEntry?.category).toBe("source");
      expect(javaEntry?.role).toBe("source");

      expect(kotlinEntry?.language).toBe("kotlin");
      expect(kotlinEntry?.category).toBe("source");
      expect(kotlinEntry?.role).toBe("source");

      expect(inventory.filesByLanguage.java).toBeGreaterThan(0);
      expect(inventory.filesByLanguage.kotlin).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });

  it("does not disturb existing TypeScript/JavaScript/Python classification alongside Java/Kotlin files (T1)", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/Widget.java", "public class Widget {}\n");
      writeFile(root, "src/Helper.kt", "class Helper\n");
      writeFile(root, "src/index.ts", "export const x = 1;\n");
      writeFile(root, "src/lib.py", "x = 1\n");
      const inventory = scanProjectInventory(root);
      expect(inventory.filesByLanguage.typescript).toBeGreaterThan(0);
      expect(inventory.filesByLanguage.python).toBeGreaterThan(0);
      expect(inventory.filesByLanguage.java).toBeGreaterThan(0);
      expect(inventory.filesByLanguage.kotlin).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });

  it("classifies conventional Gradle/Maven test source-set files as role test (T2)", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/test/java/com/example/FooTest.java", "public class FooTest {}\n");
      writeFile(root, "src/test/kotlin/com/example/FooSpec.kt", "class FooSpec\n");
      const inventory = scanProjectInventory(root);
      const roleOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.role;
      expect(roleOf("src/test/java/com/example/FooTest.java")).toBe("test");
      expect(roleOf("src/test/kotlin/com/example/FooSpec.kt")).toBe("test");
    } finally {
      cleanup(root);
    }
  });

  it("classifies test/**/*.java, test/**/*.kt, and *Test(s)/*Spec naming conventions as role test (T2)", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "test/FooTest.java", "public class FooTest {}\n");
      writeFile(root, "tests/FooTests.kt", "class FooTests\n");
      writeFile(root, "src/BarTest.java", "public class BarTest {}\n");
      writeFile(root, "src/BarTests.kt", "class BarTests\n");
      writeFile(root, "src/BarSpec.kt", "class BarSpec\n");
      const inventory = scanProjectInventory(root);
      const roleOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.role;
      expect(roleOf("test/FooTest.java")).toBe("test");
      expect(roleOf("tests/FooTests.kt")).toBe("test");
      expect(roleOf("src/BarTest.java")).toBe("test");
      expect(roleOf("src/BarTests.kt")).toBe("test");
      expect(roleOf("src/BarSpec.kt")).toBe("test");
    } finally {
      cleanup(root);
    }
  });

  it("keeps a normal (non-test-named) source file as role source (T2)", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/main/java/com/example/Widget.java", "public class Widget {}\n");
      writeFile(root, "src/main/kotlin/com/example/Helper.kt", "class Helper\n");
      const inventory = scanProjectInventory(root);
      const roleOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.role;
      expect(roleOf("src/main/java/com/example/Widget.java")).toBe("source");
      expect(roleOf("src/main/kotlin/com/example/Helper.kt")).toBe("source");
    } finally {
      cleanup(root);
    }
  });

  it("classifies recognized JVM build/wrapper metadata filenames as role config, not source", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "build.gradle", "plugins { id 'java' }\n");
      writeFile(root, "build.gradle.kts", 'plugins {\n    kotlin("jvm")\n}\n');
      writeFile(root, "settings.gradle", "rootProject.name = 'fixture'\n");
      writeFile(root, "settings.gradle.kts", 'rootProject.name = "fixture"\n');
      writeFile(root, "pom.xml", "<project></project>\n");
      writeFile(root, "gradle.properties", "org.gradle.jvmargs=-Xmx1g\n");
      writeFile(root, "gradlew", "#!/bin/sh\n");
      writeFile(root, "gradlew.bat", "@echo off\n");
      const inventory = scanProjectInventory(root);
      const roleOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.role;
      const categoryOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.category;

      for (const name of [
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
        "pom.xml",
        "gradle.properties",
        "gradlew",
        "gradlew.bat",
      ]) {
        expect(roleOf(name)).toBe("config");
        expect(categoryOf(name)).toBe("config");
      }
      // In particular, the two .kts build scripts must never be classified
      // as plain Kotlin source and fed to the Kotlin analyzer.
      expect(categoryOf("build.gradle.kts")).not.toBe("source");
      expect(categoryOf("settings.gradle.kts")).not.toBe("source");
    } finally {
      cleanup(root);
    }
  });

  it("does not overclassify an arbitrary .xml/.properties file as JVM project metadata", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "config/data.xml", "<data></data>\n");
      writeFile(root, "app.properties", "key=value\n");
      const inventory = scanProjectInventory(root);
      const categoryOf = (name: string) => inventory.files.find((f) => f.relativePath === name)?.category;
      expect(categoryOf("config/data.xml")).not.toBe("config");
      expect(categoryOf("app.properties")).not.toBe("config");
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — determinism", () => {
  it("returns files in stable, sorted order across repeated scans", () => {
    const root = buildFixtureProject();
    try {
      const first = scanProjectInventory(root);
      const second = scanProjectInventory(root);
      expect(first.files.map((f) => f.relativePath)).toEqual(second.files.map((f) => f.relativePath));
      const sorted = [...first.files.map((f) => f.relativePath)].sort((a, b) => a.localeCompare(b));
      expect(first.files.map((f) => f.relativePath)).toEqual(sorted);
    } finally {
      cleanup(root);
    }
  });

  it("category counts are stable across repeated scans", () => {
    const root = buildFixtureProject();
    try {
      const first = scanProjectInventory(root);
      const second = scanProjectInventory(root);
      expect(first.filesByCategory).toEqual(second.filesByCategory);
    } finally {
      cleanup(root);
    }
  });

  it("language and role counts are stable across repeated scans", () => {
    const root = buildFixtureProject();
    try {
      const first = scanProjectInventory(root);
      const second = scanProjectInventory(root);
      expect(first.filesByLanguage).toEqual(second.filesByLanguage);
      expect(first.filesByRole).toEqual(second.filesByRole);
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — binary and large-file bounding", () => {
  it("does not compute a line count for a binary file", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const binaryEntry = inventory.files.find((f) => f.relativePath === "unknown-data.bin");
      expect(binaryEntry?.lineCount).toBeUndefined();
    } finally {
      cleanup(root);
    }
  });

  it("skips entirely a file at or above the hard skip size", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "huge.txt", "x".repeat(1000));
      const inventory = scanProjectInventory(root, { hardSkipFileBytes: 500 });
      expect(inventory.files.some((f) => f.relativePath === "huge.txt")).toBe(false);
      expect(inventory.skippedFileCount).toBe(1);
      expect(inventory.warnings.some((w) => w.includes("oversized"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not compute a line count for a file above the line-count size bound but still inventories it", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/big.ts", "x".repeat(1000));
      const inventory = scanProjectInventory(root, { maxFileBytesForLineCount: 500 });
      const entry = inventory.files.find((f) => f.relativePath === "src/big.ts");
      expect(entry).toBeDefined();
      expect(entry?.lineCount).toBeUndefined();
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — does not write target files", () => {
  it("target directory contents are unchanged after a scan", () => {
    const root = buildFixtureProject();
    try {
      const before = JSON.stringify(walkAll(root));
      scanProjectInventory(root);
      const after = JSON.stringify(walkAll(root));
      expect(after).toBe(before);
    } finally {
      cleanup(root);
    }
  });
});

// ---------------------------------------------------------------------------
// v0.3.4 Batch 1 -- mixed-language fixture corpus inventory checks.
//
// The describe blocks above build a single-purpose temp-dir fixture per
// test. This block instead scans the static, committed fixture corpus under
// tests/fixtures/audits/mixed-language/ directly (read-only, same as every
// other test here) to prove the corpus itself matches this file's existing
// classification policy across a mixed-language, JVM-conventional project
// layout -- not a new policy, just a regression proof against real fixture
// files instead of ad hoc inline ones.
// ---------------------------------------------------------------------------
describe("scanProjectInventory — mixed-language fixture corpus (Batch 1)", () => {
  const FIXTURE_ROOT = path.resolve(process.cwd(), "tests/fixtures/audits/mixed-language");

  it("recognizes Java/Kotlin main and test source-set directories in mixed-java-kotlin", () => {
    const inventory = scanProjectInventory(path.join(FIXTURE_ROOT, "mixed-java-kotlin"));
    const roleOf = (p: string) => inventory.files.find((f) => f.relativePath === p)?.role;

    expect(roleOf("src/main/java/com/example/FooService.java")).toBe("source");
    expect(roleOf("src/main/kotlin/com/example/BarService.kt")).toBe("source");
    expect(roleOf("src/test/java/com/example/FooServiceTest.java")).toBe("test");
    expect(roleOf("src/test/kotlin/com/example/BarServiceTest.kt")).toBe("test");
  });

  it("recognizes Gradle Kotlin DSL config files as role config in mixed-java-kotlin", () => {
    const inventory = scanProjectInventory(path.join(FIXTURE_ROOT, "mixed-java-kotlin"));
    const roleOf = (p: string) => inventory.files.find((f) => f.relativePath === p)?.role;
    const categoryOf = (p: string) => inventory.files.find((f) => f.relativePath === p)?.category;

    expect(roleOf("build.gradle.kts")).toBe("config");
    expect(roleOf("settings.gradle.kts")).toBe("config");
    expect(categoryOf("build.gradle.kts")).not.toBe("source");
    expect(categoryOf("settings.gradle.kts")).not.toBe("source");
  });

  it("includes every current language family in mixed-ts-python-jvm without cross-contamination", () => {
    const inventory = scanProjectInventory(path.join(FIXTURE_ROOT, "mixed-ts-python-jvm"));
    expect(inventory.filesByLanguage.typescript).toBeGreaterThan(0);
    expect(inventory.filesByLanguage.javascript).toBeGreaterThan(0);
    expect(inventory.filesByLanguage.python).toBeGreaterThan(0);
    expect(inventory.filesByLanguage.java).toBeGreaterThan(0);
    expect(inventory.filesByLanguage.kotlin).toBeGreaterThan(0);
    // Python test file recognized as role test via the test_*.py convention.
    expect(inventory.files.find((f) => f.relativePath === "pytests/test_app.py")?.role).toBe("test");
  });

  it("classifies generated/vendor roles and excludes dist/build from traversal in mixed-generated-vendor", () => {
    const inventory = scanProjectInventory(path.join(FIXTURE_ROOT, "mixed-generated-vendor"));
    const roleOf = (p: string) => inventory.files.find((f) => f.relativePath === p)?.role;

    expect(roleOf("src/index.ts")).toBe("source");
    expect(roleOf("generated/schema.ts")).toBe("generated");
    expect(roleOf("vendor/lib.py")).toBe("vendor");
    expect(inventory.files.some((f) => f.relativePath.startsWith("dist/"))).toBe(false);
    expect(inventory.files.some((f) => f.relativePath.startsWith("build/"))).toBe(false);
  });

  it("scans each mixed-language fixture without warnings or crashes", () => {
    for (const name of [
      "mixed-ts-js",
      "mixed-python-ts",
      "mixed-java-kotlin",
      "mixed-ts-python-jvm",
      "mixed-docs-claims",
      "mixed-generated-vendor",
    ]) {
      const inventory = scanProjectInventory(path.join(FIXTURE_ROOT, name));
      expect(inventory.warnings).toEqual([]);
      expect(inventory.files.length).toBeGreaterThan(0);
    }
  });
});

function walkAll(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkAll(full));
    } else {
      result.push(full);
    }
  }
  return result.sort();
}
