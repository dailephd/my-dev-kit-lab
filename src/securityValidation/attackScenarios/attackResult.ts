import type { SecurityCheckCategory, SecurityCheckResult, SecuritySeverity, VerdictImpact } from "../types.js";
import type { SecurityCheckId, SecurityProfileId } from "../validate/cliOptions.js";
import type { ExploitEvidence, EvidenceConfidence } from "./exploitEvidence.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 2 — attack result model.
// ---------------------------------------------------------------------------

export type AttackResultStatus = "passed" | "failed" | "skipped" | "blocked";

export type AttackResult = {
  scenarioId: string;
  scenarioTitle: string;
  checkId: SecurityCheckId;
  profileId: SecurityProfileId;
  status: AttackResultStatus;
  severity: SecuritySeverity;
  confidence: EvidenceConfidence;
  evidence: ExploitEvidence[];
  category: SecurityCheckCategory;
  recommendation?: string;
  skippedReason?: string;
  errorSummary?: string;
  // v0.2.2 Batch 6 — carried through from the originating AttackScenario's
  // static verdictImpact declaration (see attackScenario.ts). Undefined for
  // placeholder/error results and scenarios that don't declare one.
  verdictImpact?: VerdictImpact;
};

// Bridges an AttackResult into the existing SecurityCheckResult shape so it
// can flow through the existing verdict/report pipeline without redesigning
// either. "blocked" (scenario crashed) maps to a failed check with severity
// bumped to at least "major" so a scenario crash is never silently invisible.
export function toSecurityCheckResult(result: AttackResult): SecurityCheckResult {
  const now = new Date().toISOString();
  const status: SecurityCheckResult["status"] =
    result.status === "blocked" ? "failed" : result.status;
  const severity: SecuritySeverity =
    result.status === "blocked" && result.severity === "skipped" ? "major" : result.severity;

  return {
    id: result.scenarioId,
    name: result.scenarioTitle,
    category: result.category,
    status,
    severity,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    findings:
      result.status === "failed" || result.status === "blocked"
        ? [
            {
              id: `${result.scenarioId}-finding`,
              title: result.scenarioTitle,
              severity,
              category: result.category,
              description:
                result.status === "blocked"
                  ? `Scenario execution error: ${result.errorSummary ?? "unknown error"}`
                  : `Attack scenario detected unsafe behavior for check group '${result.checkId}'.`,
              evidence: result.evidence.map((e) => e.redactedPreview).filter(Boolean).join(" | ") || undefined,
              recommendation: result.recommendation,
              releaseImpact: severity === "blocker" ? "Must fix before release" : "Should fix before release",
            },
          ]
        : [],
    skippedReason: result.skippedReason,
    verdictImpact: result.verdictImpact,
  };
}
