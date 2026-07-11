import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "fixtures", "android");

type FixtureExpectation = {
  dir: string;
  description: string;
  expectedFiles: string[];
  isAndroidGradleProject: boolean;
};

// ANDROID-B1-10: Fixture classification metadata can describe Compose,
// XML/View, Java, library, multi-module, partial, and non-Android projects
// without running detection logic. This test only asserts the fixtures
// exist with the expected minimal structure — it does not run any detector.
const FIXTURES: FixtureExpectation[] = [
  {
    dir: "compose-app",
    description: "Kotlin Android Compose application",
    expectedFiles: ["settings.gradle.kts", "app/build.gradle.kts", "app/src/main/AndroidManifest.xml"],
    isAndroidGradleProject: true,
  },
  {
    dir: "xml-view-app",
    description: "Kotlin Android XML/View application",
    expectedFiles: ["settings.gradle.kts", "app/build.gradle.kts", "app/src/main/AndroidManifest.xml"],
    isAndroidGradleProject: true,
  },
  {
    dir: "java-app",
    description: "Java Android application",
    expectedFiles: ["settings.gradle", "app/build.gradle", "app/src/main/AndroidManifest.xml"],
    isAndroidGradleProject: true,
  },
  {
    dir: "library",
    description: "Android library",
    expectedFiles: ["settings.gradle.kts", "mylibrary/build.gradle.kts", "mylibrary/src/main/AndroidManifest.xml"],
    isAndroidGradleProject: true,
  },
  {
    dir: "multi-module",
    description: "Multi-module Android project",
    expectedFiles: [
      "settings.gradle.kts",
      "app/build.gradle.kts",
      "core/build.gradle.kts",
      "feature-login/build.gradle.kts",
    ],
    isAndroidGradleProject: true,
  },
  {
    dir: "partial",
    description: "Partial or incomplete Android project",
    expectedFiles: ["settings.gradle.kts", "app/build.gradle.kts"],
    isAndroidGradleProject: true,
  },
  {
    dir: "non-android-gradle",
    description: "Non-Android Gradle project",
    expectedFiles: ["settings.gradle.kts", "build.gradle.kts", "core/build.gradle.kts"],
    isAndroidGradleProject: false,
  },
];

describe("android fixture foundation — ANDROID-B1-10", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.dir} (${fixture.description}) has the expected minimal structure`, () => {
      const fixtureRoot = path.join(FIXTURES_ROOT, fixture.dir);
      expect(fs.existsSync(fixtureRoot)).toBe(true);
      for (const relativeFile of fixture.expectedFiles) {
        const filePath = path.join(fixtureRoot, relativeFile);
        expect(fs.existsSync(filePath), `expected ${fixture.dir}/${relativeFile} to exist`).toBe(true);
      }
    });
  }

  it("the partial fixture is deliberately missing a manifest and gradle wrapper", () => {
    const fixtureRoot = path.join(FIXTURES_ROOT, "partial");
    expect(fs.existsSync(path.join(fixtureRoot, "app", "src", "main", "AndroidManifest.xml"))).toBe(false);
    expect(fs.existsSync(path.join(fixtureRoot, "gradle", "wrapper", "gradle-wrapper.properties"))).toBe(false);
  });

  it("the non-android-gradle fixture has no Android plugin or manifest evidence", () => {
    const buildFile = fs.readFileSync(path.join(FIXTURES_ROOT, "non-android-gradle", "build.gradle.kts"), "utf8");
    expect(buildFile).not.toContain("com.android");
    const hasAnyManifest = fs.existsSync(path.join(FIXTURES_ROOT, "non-android-gradle", "core", "src", "main", "AndroidManifest.xml"));
    expect(hasAnyManifest).toBe(false);
  });

  it("fixtures avoid checked-in binaries and Gradle caches", () => {
    for (const fixture of FIXTURES) {
      const fixtureRoot = path.join(FIXTURES_ROOT, fixture.dir);
      const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            expect(entry.name).not.toBe(".gradle");
            return walk(full);
          }
          return [full];
        });
      const files = walk(fixtureRoot);
      for (const file of files) {
        expect(file.endsWith(".apk")).toBe(false);
        expect(file.endsWith(".aab")).toBe(false);
        expect(file.endsWith(".jar")).toBe(false);
      }
    }
  });
});
