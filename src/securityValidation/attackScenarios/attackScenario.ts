import type { SecurityCheckCategory, SecuritySeverity, VerdictImpact } from "../types.js";
import type { SecurityValidationConfig } from "../config.js";
import type { SecurityValidationTarget } from "../validate/resolveTarget.js";
import type { SecurityCheckId, SecurityProfileId } from "../validate/cliOptions.js";
import type { ExploitEvidence, EvidenceConfidence } from "./exploitEvidence.js";
import type { TargetSnapshot } from "./targetSnapshot.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 2 — attack scenario contract.
//
// This is the shared interface later v0.2.2 batches implement concrete
// scenarios against. Batch 2 intentionally ships with an empty scenario
// registry (see attackRunner.ts) — this file only defines the shape.
// ---------------------------------------------------------------------------

// Maps a planned/attack-scenario check id to its default report category.
// Used both when no scenarios are registered yet (placeholder result) and by
// scenario authors as a sensible default category.
export const CHECK_ID_CATEGORY: Record<SecurityCheckId, SecurityCheckCategory> = {
  deps: "dependency-audit",
  package: "package-content",
  static: "static-scan",
  "cli-adversarial": "cli-adversarial",
  fuzz: "fuzz-smoke",
  boundary: "artifact-safety",
  subprocess: "cli-adversarial",
  secrets: "secret-leakage",
  network: "network-boundary",
};

export type AttackScenarioContext = {
  toolRoot: string;
  target: SecurityValidationTarget;
  profile: SecurityProfileId;
  config: SecurityValidationConfig;
  // v0.2.2 Batch 3 — read-only git-status snapshot of the target taken
  // before any checks ran, so scenarios can distinguish pre-existing target
  // dirtiness from changes caused during this validation run. Undefined when
  // the caller did not provide one (e.g. older test fixtures).
  targetSnapshotBefore?: TargetSnapshot;
};

export type AttackScenarioRunOutcome = {
  status: "passed" | "failed" | "blocked";
  confidence: EvidenceConfidence;
  evidence: ExploitEvidence[];
  category?: SecurityCheckCategory;
  recommendation?: string;
  // v0.2.2 Batch 4 — optional per-run severity override. AttackResult.severity
  // is otherwise fixed to scenario.severityBaseline; scenarios whose findings
  // can genuinely vary in severity between runs (e.g. secret leakage: a
  // private key vs. a low-confidence generic assignment) set this to the
  // worst severity actually observed. Omit to keep the prior fixed-baseline
  // behavior (all Batch 3 scenarios do this unchanged).
  severity?: SecuritySeverity;
};

export type AttackScenario = {
  id: string;
  title: string;
  description: string;
  checkId: SecurityCheckId;
  // Empty array means "applicable to all profiles".
  applicableProfiles: SecurityProfileId[];
  severityBaseline: SecuritySeverity;
  // v0.2.2 Batch 6 — static declaration of what kind of blocker this
  // scenario represents if it fails/blocks. Carried through to
  // SecurityCheckResult.verdictImpact by the runner; verdict.ts reads it
  // directly instead of maintaining a separate scenario-id map. Optional —
  // a scenario without this falls back to the generic
  // "adversarial-scenario-failure" category (safe, just less precise).
  verdictImpact?: VerdictImpact;
  expectedSafeBehavior: string;
  evidenceRequirements: string[];
  // Returns a skip reason string to skip the scenario without running it, or
  // undefined to proceed with run().
  skipCondition?: (ctx: AttackScenarioContext) => string | undefined;
  // Bounded execution budget; the runner enforces this via Promise.race.
  timeoutMs?: number;
  run: (ctx: AttackScenarioContext) => Promise<AttackScenarioRunOutcome>;
};
