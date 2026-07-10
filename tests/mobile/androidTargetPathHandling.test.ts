import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveLocalProjectTarget } from "../../src/core/localProjectTarget.js";
import { relativeWithinRoot, resolveWithinRoot } from "../../src/core/pathSafety.js";

const TOOL_ROOT = path.resolve(__dirname, "..", "..");
const COMPOSE_APP_FIXTURE = path.resolve(__dirname, "..", "fixtures", "android", "compose-app");

// ANDROID-B1-09: Windows and POSIX-style target paths are preserved or
// normalized according to existing repository conventions without
// corrupting target identity.
describe("android target path handling — ANDROID-B1-09", () => {
  it("resolves an absolute Windows-style target path to a stable resolved root", () => {
    const local = resolveLocalProjectTarget(COMPOSE_APP_FIXTURE, TOOL_ROOT);
    expect(path.isAbsolute(local.targetRoot)).toBe(true);
    expect(local.targetRoot).toBe(path.resolve(COMPOSE_APP_FIXTURE));
  });

  it("resolves a relative target path the same way as its absolute equivalent", () => {
    const relativePath = path.relative(process.cwd(), COMPOSE_APP_FIXTURE);
    const local = resolveLocalProjectTarget(relativePath, TOOL_ROOT);
    expect(local.targetRoot).toBe(path.resolve(COMPOSE_APP_FIXTURE));
  });

  it("normalizes manifest-relative paths to forward slashes via existing pathSafety helpers", () => {
    const manifestAbsolute = path.join(COMPOSE_APP_FIXTURE, "app", "src", "main", "AndroidManifest.xml");
    const relative = relativeWithinRoot(COMPOSE_APP_FIXTURE, manifestAbsolute);
    expect(relative).toBe("app/src/main/AndroidManifest.xml");
    expect(relative).not.toContain("\\");
  });

  it("rejects a manifest path that escapes the resolved target root", () => {
    const escaping = path.join(COMPOSE_APP_FIXTURE, "..", "..", "outside.xml");
    expect(() => resolveWithinRoot(COMPOSE_APP_FIXTURE, escaping)).toThrow(/escapes target root/);
  });
});
