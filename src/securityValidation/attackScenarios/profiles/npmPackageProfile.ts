import type { AttackProfileDefinition } from "../attackProfile.js";

export const NPM_PACKAGE_PROFILE: AttackProfileDefinition = {
  id: "npm-package",
  label: "npm package",
  description:
    "Profile for a general published npm package (not necessarily a CLI) — emphasizes package-content, dependency, and secret-leakage checks over CLI-argument-shaped adversarial tests.",
  defaultCheckIds: ["deps", "package", "static"],
  applicableCheckIds: ["deps", "package", "static", "cli-adversarial", "fuzz", "boundary", "secrets", "network"],
  scenarioGroups: ["boundary", "secrets", "network"],
  mandatoryEvidenceCategories: ["package-content", "secret-leak"],
  skippedWording: "planned for a later v0.2.2 batch",
};
