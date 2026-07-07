import { describe, expect, it } from "vitest";
import { resolveAttackProfile, listAttackProfiles } from "../../../src/securityValidation/attackScenarios/attackProfile.js";
import { SECURITY_PROFILE_IDS } from "../../../src/securityValidation/validate/cliOptions.js";

describe("security profiles", () => {
  it("exist for node-cli-package, local-tool, and npm-package", () => {
    for (const id of SECURITY_PROFILE_IDS) {
      const profile = resolveAttackProfile(id);
      expect(profile.id).toBe(id);
      expect(profile.label.length).toBeGreaterThan(0);
      expect(profile.description.length).toBeGreaterThan(0);
      expect(Array.isArray(profile.defaultCheckIds)).toBe(true);
      expect(Array.isArray(profile.applicableCheckIds)).toBe(true);
    }
  });

  it("profile ids match Batch 1 --profile ids exactly", () => {
    const resolvedIds = listAttackProfiles().map((p) => p.id).sort();
    expect(resolvedIds).toEqual([...SECURITY_PROFILE_IDS].sort());
  });

  it("rejects unknown profile ids", () => {
    expect(() => resolveAttackProfile("web-app")).toThrow(/Unknown security profile/);
  });

  it("listAttackProfiles returns profiles in canonical SECURITY_PROFILE_IDS order", () => {
    const ids = listAttackProfiles().map((p) => p.id);
    expect(ids).toEqual([...SECURITY_PROFILE_IDS]);
  });
});
