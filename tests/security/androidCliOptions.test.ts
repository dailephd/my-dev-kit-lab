import { describe, expect, it } from "vitest";
import {
  normalizeSecurityValidateConfig,
  ANDROID_GRADLE_OPERATION_IDS,
} from "../../src/securityValidation/validate/cliOptions.js";
import { ALLOWLISTED_OPERATION_IDS } from "../../src/mobile/android/gradle/validate/operations.js";
import { SECURITY_PROFILE_IDS } from "../../src/securityValidation/validate/cliOptions.js";

const toolRoot = process.cwd();

// ANDROID-B5-01: Android profile parsing.
describe("normalizeSecurityValidateConfig — android profile — ANDROID-B5-01", () => {
  it("accepts --profile android and records it as the canonical profile", () => {
    const config = normalizeSecurityValidateConfig({ profile: "android" }, toolRoot);
    expect(config.profile).toBe("android");
    expect(config.profileWasDefault).toBe(false);
  });

  it("lists android as a supported profile", () => {
    expect(SECURITY_PROFILE_IDS).toContain("android");
  });
});

// ANDROID-B5-04: Optional operation parsing.
describe("normalizeSecurityValidateConfig — android gradle operations — ANDROID-B5-04", () => {
  it("normalizes a comma-separated set of operation ids deterministically", () => {
    const config = normalizeSecurityValidateConfig({ profile: "android", androidGradleOperations: "tasks,wrapper-version" }, toolRoot);
    // Canonical allowlist order, not input order.
    expect(config.androidGradleOperationIds).toEqual(["wrapper-version", "tasks"]);
  });

  it("is empty by default (absent flag means zero Gradle execution)", () => {
    const config = normalizeSecurityValidateConfig({ profile: "android" }, toolRoot);
    expect(config.androidGradleOperationIds).toEqual([]);
  });
});

// ANDROID-B5-05: Duplicate operation normalization.
describe("normalizeSecurityValidateConfig — duplicate operations — ANDROID-B5-05", () => {
  it("deduplicates repeated operation ids", () => {
    const config = normalizeSecurityValidateConfig({ profile: "android", androidGradleOperations: "tasks,tasks,tasks" }, toolRoot);
    expect(config.androidGradleOperationIds).toEqual(["tasks"]);
  });
});

// ANDROID-B5-06: Unknown operation rejection.
describe("normalizeSecurityValidateConfig — unknown operation rejection — ANDROID-B5-06", () => {
  it("throws a usage error for an unknown operation id before any validation runs", () => {
    expect(() => normalizeSecurityValidateConfig({ profile: "android", androidGradleOperations: "assembleRelease" }, toolRoot)).toThrow(
      /Invalid --android-gradle-operations/
    );
  });

  it("rejects an empty operations string rather than silently enabling nothing", () => {
    expect(() => normalizeSecurityValidateConfig({ profile: "android", androidGradleOperations: "" }, toolRoot)).toThrow();
  });
});

// ANDROID-B5-07: Arbitrary task rejection.
describe("normalizeSecurityValidateConfig — arbitrary task rejection — ANDROID-B5-07", () => {
  it("rejects a raw task name that is not in the allowlist", () => {
    expect(() => normalizeSecurityValidateConfig({ profile: "android", androidGradleOperations: "clean" }, toolRoot)).toThrow();
    expect(() => normalizeSecurityValidateConfig({ profile: "android", androidGradleOperations: "publish" }, toolRoot)).toThrow();
  });

  it("rejects a shell-fragment-shaped value", () => {
    expect(() =>
      normalizeSecurityValidateConfig({ profile: "android", androidGradleOperations: "tasks; rm -rf /" }, toolRoot)
    ).toThrow();
  });

  it("the CLI allowlist matches the Batch 4 execution-layer allowlist exactly", () => {
    expect([...ANDROID_GRADLE_OPERATION_IDS].sort()).toEqual([...ALLOWLISTED_OPERATION_IDS].sort());
  });
});

// ANDROID-B5-08: Android option rejected for other profiles.
describe("normalizeSecurityValidateConfig — android option rejected for other profiles — ANDROID-B5-08", () => {
  it("throws when --android-gradle-operations is used with a non-android profile", () => {
    expect(() =>
      normalizeSecurityValidateConfig({ profile: "node-cli-package", androidGradleOperations: "wrapper-version" }, toolRoot)
    ).toThrow(/requires --profile android/);
  });

  it("does not throw when the option is simply absent for a non-android profile", () => {
    expect(() => normalizeSecurityValidateConfig({ profile: "node-cli-package" }, toolRoot)).not.toThrow();
  });
});
