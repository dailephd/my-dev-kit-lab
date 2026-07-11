import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { detectAndroidProject } from "../../../src/mobile/android/detect/detectAndroidProject.js";
import { parseAllAndroidManifests, parseAndroidManifestFile } from "../../../src/mobile/android/manifest/parseAndroidManifest.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");
const TOOL_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

// ANDROID-B3-12: All detected manifests are parsed independently, associated
// with their module, and returned deterministically. No merged-manifest claim.
describe("parseAllAndroidManifests — multi-manifest parsing — ANDROID-B3-12", () => {
  it("parses every manifest in a multi-module project and associates each with its module", () => {
    const root = fixture("multi-module");
    const detection = detectAndroidProject(root);
    const entries = parseAllAndroidManifests(root, detection);

    expect(entries.map((e) => e.manifestPath)).toEqual(["app/src/main/AndroidManifest.xml", "core/src/main/AndroidManifest.xml", "feature-login/src/main/AndroidManifest.xml"]);
    expect(entries.find((e) => e.manifestPath.startsWith("app/"))?.modulePath).toBe("app");
    expect(entries.find((e) => e.manifestPath.startsWith("core/"))?.modulePath).toBe("core");
  });

  it("associates the correct source-set kind for main-manifest paths", () => {
    const root = fixture("compose-app");
    const detection = detectAndroidProject(root);
    const entries = parseAllAndroidManifests(root, detection);
    expect(entries[0].sourceSetKind).toBe("main");
  });

  it("does not claim a merged manifest anywhere in the returned shape", () => {
    const root = fixture("multi-module");
    const detection = detectAndroidProject(root);
    const entries = parseAllAndroidManifests(root, detection);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("merged");
      expect(entry).not.toHaveProperty("mergedManifest");
    }
  });

  it("returns an empty array for a non-Android target without crashing", () => {
    const root = fixture("non-android-gradle");
    const detection = detectAndroidProject(root);
    expect(() => parseAllAndroidManifests(root, detection)).not.toThrow();
    expect(parseAllAndroidManifests(root, detection)).toEqual([]);
  });
});

// ANDROID-B3-32: Target containment — manifest paths outside the target root
// are rejected safely, never read.
describe("parseAndroidManifestFile — target containment — ANDROID-B3-32", () => {
  it("rejects a manifest path that escapes the target root", () => {
    const root = fixture("compose-app");
    const manifest = parseAndroidManifestFile(root, "../../../../etc/passwd");
    expect(manifest.activities).toEqual([]);
    expect(manifest.parseWarnings.some((w) => w.includes("rejected") || w.includes("escapes"))).toBe(true);
  });

  it("rejects an absolute path pointing outside the target root", () => {
    const root = fixture("compose-app");
    const outsidePath = path.resolve(TOOL_ROOT, "package.json");
    const manifest = parseAndroidManifestFile(root, outsidePath);
    expect(manifest.activities).toEqual([]);
  });
});

// ANDROID-B3-33: Target immutability — parsing does not modify fixtures.
describe("parseAllAndroidManifests — target immutability — ANDROID-B3-33", () => {
  it("does not modify fixture files on disk", () => {
    const root = fixture("multi-module");
    const before = execSync("git status --short", { cwd: TOOL_ROOT, encoding: "utf8" });
    const detection = detectAndroidProject(root);
    parseAllAndroidManifests(root, detection);
    const after = execSync("git status --short", { cwd: TOOL_ROOT, encoding: "utf8" });
    expect(after).toBe(before);
  });

  it("creates no new files inside the target", () => {
    const root = fixture("compose-app");
    const before = fs.readdirSync(root, { recursive: true } as any).sort();
    const detection = detectAndroidProject(root);
    parseAllAndroidManifests(root, detection);
    const after = fs.readdirSync(root, { recursive: true } as any).sort();
    expect(after).toEqual(before);
  });
});

// ANDROID-B3-34: Manifest parsing consumes Batch 2 detector output without
// changing detection outcomes.
describe("parseAllAndroidManifests — Batch 2 detector compatibility — ANDROID-B3-34", () => {
  it("parsing manifests does not change the detection result it was derived from", () => {
    const root = fixture("xml-view-app");
    const before = detectAndroidProject(root);
    parseAllAndroidManifests(root, before);
    const after = detectAndroidProject(root);
    expect(after).toEqual(before);
  });
});
