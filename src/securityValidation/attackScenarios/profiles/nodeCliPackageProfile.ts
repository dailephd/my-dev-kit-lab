import type { AttackProfileDefinition } from "../attackProfile.js";

export const NODE_CLI_PACKAGE_PROFILE: AttackProfileDefinition = {
  id: "node-cli-package",
  label: "Node CLI package",
  description:
    "Default profile for a published Node.js CLI/package like my-dev-kit itself: local-first, deterministic, read-only with respect to user source.",
  defaultCheckIds: ["deps", "package", "static", "cli-adversarial", "fuzz"],
  applicableCheckIds: [
    "deps",
    "package",
    "static",
    "cli-adversarial",
    "fuzz",
    "boundary",
    "subprocess",
    "secrets",
    "network",
  ],
  scenarioGroups: ["boundary", "subprocess", "secrets", "network"],
  mandatoryEvidenceCategories: ["command", "filesystem", "output"],
  skippedWording: "planned for a later v0.2.2 batch",
};
