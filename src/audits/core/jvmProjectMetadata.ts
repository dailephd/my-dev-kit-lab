import fs from "node:fs";
import path from "node:path";
import type { ProjectInventorySnapshot } from "./projectInventory.js";

// ---------------------------------------------------------------------------
// v0.3.3 Batch 1 -- lightweight JVM (Java/Kotlin, Gradle/Maven) project
// metadata detection.
//
// Same spirit and division of responsibility as pythonProjectMetadata.ts:
// pure data collection about the TARGET project under audit, no AuditIssue,
// no target mutation, no subprocess execution, no dependency resolution.
// Never runs gradle/./gradlew/mvn, never invokes the Java or Kotlin
// compiler, never runs tests. Presence-only plus conservative single-line/
// simple text extraction -- no XML or Gradle-syntax parser dependency is
// added (none exists in this repo).
//
// `projectName` is populated only when a simple, unambiguous name can be
// read from settings.gradle(.kts) (`rootProject.name = "..."`) or pom.xml
// (a top-level, non-nested `<artifactId>...</artifactId>`); anything more
// structurally complex is left as null rather than guessed at.
// ---------------------------------------------------------------------------

export type JvmProjectMetadataSnapshot = {
  hasGradleBuild: boolean;
  hasGradleSettings: boolean;
  hasMavenPom: boolean;
  hasGradleWrapper: boolean;
  hasJavaSource: boolean;
  hasKotlinSource: boolean;
  hasJavaTests: boolean;
  hasKotlinTests: boolean;
  // Recognized build/wrapper files present in the inventory (relative
  // paths), sorted deterministically.
  recognizedBuildFiles: string[];
  // Recognized source-set directories actually present among scanned files
  // (deduplicated, sorted), e.g. "src/main/java", "src/main/kotlin".
  recognizedSourceDirectories: string[];
  // Recognized test-set directories actually present among scanned files
  // (deduplicated, sorted), e.g. "src/test/java", "src/test/kotlin".
  recognizedTestDirectories: string[];
  projectName: string | null;
  warnings: string[];
};

const GRADLE_BUILD_FILE_NAMES = new Set(["build.gradle", "build.gradle.kts"]);
const GRADLE_SETTINGS_FILE_NAMES = new Set(["settings.gradle", "settings.gradle.kts"]);
const GRADLE_WRAPPER_FILE_NAMES = new Set(["gradlew", "gradlew.bat"]);

// Conservative, single-line extraction: `rootProject.name = "foo"` (Groovy
// or Kotlin DSL both use this exact call-and-assign shape). Does not handle
// multi-line expressions, string concatenation, or computed values.
const GRADLE_SETTINGS_PROJECT_NAME_PATTERN = /rootProject\.name\s*=\s*["']([^"']+)["']/;

// Conservative, single-line/non-nested extraction: the first top-level
// `<artifactId>...</artifactId>` in the file. Real pom.xml can nest an
// `<artifactId>` inside `<parent>` or `<dependencies>`, which this naive
// first-match scan cannot distinguish -- so this is intentionally treated as
// best-effort only, matching this module's "leave null rather than guess"
// policy for anything structurally ambiguous. A `<parent>` block, if present
// before the project's own `<artifactId>`, is skipped over so the far more
// common case (parent declared first, then the project's own coordinates)
// resolves to the right value instead of the parent's.
const POM_ARTIFACT_ID_PATTERN = /<artifactId>\s*([^<\s][^<]*?)\s*<\/artifactId>/;

function findSourceSetDirectories(
  inventory: ProjectInventorySnapshot,
  segment: "main" | "test",
  language: "java" | "kotlin"
): string[] {
  const dirName = `src/${segment}/${language}`;
  const prefix = `${dirName}/`;
  const found = inventory.files.some((f) => f.relativePath === dirName || f.relativePath.startsWith(prefix));
  return found ? [dirName] : [];
}

export function collectJvmProjectMetadata(
  targetRoot: string,
  inventory: ProjectInventorySnapshot
): JvmProjectMetadataSnapshot {
  const warnings: string[] = [];
  const knownPaths = new Set(inventory.files.map((f) => f.relativePath));

  const recognizedBuildFiles = inventory.files
    .map((f) => f.relativePath)
    .filter((relativePath) => {
      const basename = path.posix.basename(relativePath);
      return (
        GRADLE_BUILD_FILE_NAMES.has(basename) ||
        GRADLE_SETTINGS_FILE_NAMES.has(basename) ||
        GRADLE_WRAPPER_FILE_NAMES.has(basename) ||
        basename === "pom.xml" ||
        basename === "gradle.properties"
      );
    })
    .sort((a, b) => a.localeCompare(b));

  const hasGradleBuild = recognizedBuildFiles.some((p) => GRADLE_BUILD_FILE_NAMES.has(path.posix.basename(p)));
  const hasGradleSettings = recognizedBuildFiles.some((p) => GRADLE_SETTINGS_FILE_NAMES.has(path.posix.basename(p)));
  const hasMavenPom = knownPaths.has("pom.xml");
  const hasGradleWrapper = recognizedBuildFiles.some((p) => GRADLE_WRAPPER_FILE_NAMES.has(path.posix.basename(p)));

  const javaSourceDirs = findSourceSetDirectories(inventory, "main", "java");
  const kotlinSourceDirs = findSourceSetDirectories(inventory, "main", "kotlin");
  const javaTestDirs = findSourceSetDirectories(inventory, "test", "java");
  const kotlinTestDirs = findSourceSetDirectories(inventory, "test", "kotlin");

  // Source-set directory presence is a conservative signal only -- a
  // project can validly keep Java/Kotlin files outside the conventional
  // src/main|test/{java,kotlin} layout, so this does not attempt to prove
  // "has no Java/Kotlin source"; it only reports the conventional-layout
  // signal explicitly. hasJavaSource/hasKotlinSource below fall back to any
  // scanned file of that language so they stay meaningful even for
  // non-conventional layouts.
  const hasJavaSource = javaSourceDirs.length > 0 || inventory.filesByLanguage.java > 0;
  const hasKotlinSource = kotlinSourceDirs.length > 0 || inventory.filesByLanguage.kotlin > 0;
  const hasJavaTests = javaTestDirs.length > 0;
  const hasKotlinTests = kotlinTestDirs.length > 0;

  const recognizedSourceDirectories = [...new Set([...javaSourceDirs, ...kotlinSourceDirs])].sort((a, b) =>
    a.localeCompare(b)
  );
  const recognizedTestDirectories = [...new Set([...javaTestDirs, ...kotlinTestDirs])].sort((a, b) =>
    a.localeCompare(b)
  );

  let projectName: string | null = null;

  if (hasGradleSettings) {
    const settingsPath = recognizedBuildFiles.find((p) => GRADLE_SETTINGS_FILE_NAMES.has(path.posix.basename(p)));
    if (settingsPath) {
      const content = readSafely(targetRoot, settingsPath, warnings);
      if (content !== null) {
        const match = content.match(GRADLE_SETTINGS_PROJECT_NAME_PATTERN);
        if (match) projectName = match[1];
      }
    }
  }

  if (projectName === null && hasMavenPom) {
    const content = readSafely(targetRoot, "pom.xml", warnings);
    if (content !== null) {
      const withoutParentBlock = content.replace(/<parent>[\s\S]*?<\/parent>/, "");
      const match = withoutParentBlock.match(POM_ARTIFACT_ID_PATTERN);
      if (match) projectName = match[1];
    }
  }

  return {
    hasGradleBuild,
    hasGradleSettings,
    hasMavenPom,
    hasGradleWrapper,
    hasJavaSource,
    hasKotlinSource,
    hasJavaTests,
    hasKotlinTests,
    recognizedBuildFiles,
    recognizedSourceDirectories,
    recognizedTestDirectories,
    projectName,
    warnings,
  };
}

function readSafely(targetRoot: string, relativePath: string, warnings: string[]): string | null {
  try {
    return fs.readFileSync(path.join(targetRoot, relativePath), "utf8");
  } catch (err) {
    warnings.push(`Could not read ${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
