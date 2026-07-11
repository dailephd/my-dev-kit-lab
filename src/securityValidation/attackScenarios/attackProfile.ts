import type { SecurityCheckId, SecurityProfileId } from "../validate/cliOptions.js";
import { SECURITY_PROFILE_IDS } from "../validate/cliOptions.js";
import { NODE_CLI_PACKAGE_PROFILE } from "./profiles/nodeCliPackageProfile.js";
import { LOCAL_TOOL_PROFILE } from "./profiles/localToolProfile.js";
import { NPM_PACKAGE_PROFILE } from "./profiles/npmPackageProfile.js";
import { ANDROID_PROFILE } from "./profiles/androidProfile.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 2 — reusable security profile definitions.
//
// Profile ids intentionally match Batch 1's --profile values exactly
// (SECURITY_PROFILE_IDS in cliOptions.ts). Batch 2 only defines scenario
// selection metadata here — no concrete profile-specific security behavior.
// The per-profile files import the AttackProfileDefinition *type* from this
// module (erased at compile time), so there is no runtime circular import.
// ---------------------------------------------------------------------------

export type AttackProfileDefinition = {
  id: SecurityProfileId;
  label: string;
  description: string;
  defaultCheckIds: SecurityCheckId[];
  applicableCheckIds: SecurityCheckId[];
  scenarioGroups: string[];
  mandatoryEvidenceCategories?: string[];
  skippedWording?: string;
};

const PROFILE_REGISTRY: Record<SecurityProfileId, AttackProfileDefinition> = {
  "node-cli-package": NODE_CLI_PACKAGE_PROFILE,
  "local-tool": LOCAL_TOOL_PROFILE,
  "npm-package": NPM_PACKAGE_PROFILE,
  android: ANDROID_PROFILE,
};

// Resolves a profile id to its definition. Throws a clean, descriptive Error
// for unknown ids (mirrors Batch 1's --profile validation error style).
export function resolveAttackProfile(id: string): AttackProfileDefinition {
  if (!(SECURITY_PROFILE_IDS as readonly string[]).includes(id)) {
    throw new Error(`Unknown security profile: "${id}". Valid values are: ${SECURITY_PROFILE_IDS.join(", ")}.`);
  }
  return PROFILE_REGISTRY[id as SecurityProfileId];
}

export function listAttackProfiles(): AttackProfileDefinition[] {
  return SECURITY_PROFILE_IDS.map((id) => PROFILE_REGISTRY[id]);
}
