import type { AttackProfileDefinition } from "../attackProfile.js";

export const LOCAL_TOOL_PROFILE: AttackProfileDefinition = {
  id: "local-tool",
  label: "Local tool",
  description:
    "Profile for a tool that is only ever run locally and is not published to a registry — package-content and npm-publish-shaped checks are less relevant, boundary/subprocess checks still matter.",
  defaultCheckIds: ["deps", "static", "cli-adversarial", "fuzz"],
  applicableCheckIds: ["deps", "static", "cli-adversarial", "fuzz", "boundary", "subprocess", "secrets", "network"],
  scenarioGroups: ["boundary", "subprocess", "secrets", "network"],
  mandatoryEvidenceCategories: ["command", "filesystem"],
  skippedWording: "planned for a later v0.2.2 batch",
};
