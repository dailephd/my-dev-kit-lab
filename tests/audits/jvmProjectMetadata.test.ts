import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectJvmProjectMetadata } from "../../src/audits/core/jvmProjectMetadata.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jvm-project-metadata-test-"));
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

function collect(root: string) {
  const inventory = scanProjectInventory(root);
  return collectJvmProjectMetadata(root, inventory);
}

describe("collectJvmProjectMetadata — T3 build/wrapper presence detection", () => {
  it("detects a Gradle Groovy DSL project's build/settings/wrapper files", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "build.gradle", "plugins { id 'java' }\n");
      writeFile(root, "settings.gradle", "rootProject.name = 'fixture-gradle'\n");
      writeFile(root, "gradle.properties", "org.gradle.jvmargs=-Xmx1g\n");
      writeFile(root, "gradlew", "#!/bin/sh\n");
      writeFile(root, "gradlew.bat", "@echo off\n");
      const metadata = collect(root);
      expect(metadata.hasGradleBuild).toBe(true);
      expect(metadata.hasGradleSettings).toBe(true);
      expect(metadata.hasGradleWrapper).toBe(true);
      expect(metadata.hasMavenPom).toBe(false);
      expect(metadata.recognizedBuildFiles).toEqual(
        ["build.gradle", "gradle.properties", "gradlew", "gradlew.bat", "settings.gradle"].sort((a, b) =>
          a.localeCompare(b)
        )
      );
    } finally {
      cleanup(root);
    }
  });

  it("detects a Gradle Kotlin DSL project's build/settings files", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "build.gradle.kts", "plugins {\n    kotlin(\"jvm\")\n}\n");
      writeFile(root, "settings.gradle.kts", 'rootProject.name = "fixture-kts"\n');
      const metadata = collect(root);
      expect(metadata.hasGradleBuild).toBe(true);
      expect(metadata.hasGradleSettings).toBe(true);
      expect(metadata.projectName).toBe("fixture-kts");
    } finally {
      cleanup(root);
    }
  });

  it("detects a Maven project's pom.xml", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "pom.xml",
        [
          "<project>",
          "  <groupId>com.example</groupId>",
          "  <artifactId>fixture-maven</artifactId>",
          "  <version>1.0.0</version>",
          "</project>",
        ].join("\n") + "\n"
      );
      const metadata = collect(root);
      expect(metadata.hasMavenPom).toBe(true);
      expect(metadata.hasGradleBuild).toBe(false);
      expect(metadata.projectName).toBe("fixture-maven");
    } finally {
      cleanup(root);
    }
  });

  it("skips a <parent> block's artifactId and picks the project's own", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "pom.xml",
        [
          "<project>",
          "  <parent>",
          "    <artifactId>parent-artifact</artifactId>",
          "  </parent>",
          "  <artifactId>child-artifact</artifactId>",
          "</project>",
        ].join("\n") + "\n"
      );
      const metadata = collect(root);
      expect(metadata.projectName).toBe("child-artifact");
    } finally {
      cleanup(root);
    }
  });

  it("reports every file absent for a project with no JVM build metadata", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "README.md", "# Fixture\n");
      const metadata = collect(root);
      expect(metadata.hasGradleBuild).toBe(false);
      expect(metadata.hasGradleSettings).toBe(false);
      expect(metadata.hasMavenPom).toBe(false);
      expect(metadata.hasGradleWrapper).toBe(false);
      expect(metadata.recognizedBuildFiles).toEqual([]);
      expect(metadata.projectName).toBeNull();
    } finally {
      cleanup(root);
    }
  });

  it("does not run gradle/./gradlew/mvn and does not modify the target project", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "build.gradle", "plugins { id 'java' }\n");
      const before = fs.readFileSync(path.join(root, "build.gradle"), "utf8");
      collect(root);
      const after = fs.readFileSync(path.join(root, "build.gradle"), "utf8");
      expect(after).toBe(before);
    } finally {
      cleanup(root);
    }
  });
});

describe("collectJvmProjectMetadata — T3 source/test directory and language detection", () => {
  it("detects conventional Gradle/Maven source and test set directories for Java and Kotlin", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/main/java/com/example/Widget.java", "package com.example;\npublic class Widget {}\n");
      writeFile(root, "src/main/kotlin/com/example/Helper.kt", "package com.example\nclass Helper\n");
      writeFile(root, "src/test/java/com/example/WidgetTest.java", "public class WidgetTest {}\n");
      writeFile(root, "src/test/kotlin/com/example/HelperSpec.kt", "class HelperSpec\n");
      const metadata = collect(root);

      expect(metadata.hasJavaSource).toBe(true);
      expect(metadata.hasKotlinSource).toBe(true);
      expect(metadata.hasJavaTests).toBe(true);
      expect(metadata.hasKotlinTests).toBe(true);
      expect(metadata.recognizedSourceDirectories).toEqual(["src/main/java", "src/main/kotlin"]);
      expect(metadata.recognizedTestDirectories).toEqual(["src/test/java", "src/test/kotlin"]);
    } finally {
      cleanup(root);
    }
  });

  it("still reports hasJavaSource/hasKotlinSource true for a non-conventional layout via language counts", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "app/Main.java", "public class Main {}\n");
      writeFile(root, "scripts/tool.kt", "class Tool\n");
      const metadata = collect(root);
      expect(metadata.hasJavaSource).toBe(true);
      expect(metadata.hasKotlinSource).toBe(true);
      expect(metadata.recognizedSourceDirectories).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  it("reports hasJavaTests/hasKotlinTests false when no conventional test-set directory is present", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/main/java/com/example/Widget.java", "public class Widget {}\n");
      const metadata = collect(root);
      expect(metadata.hasJavaTests).toBe(false);
      expect(metadata.hasKotlinTests).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});
