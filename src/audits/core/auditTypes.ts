// ---------------------------------------------------------------------------
// v0.3.0 Batch 1 — generic audit framework core vocabulary.
//
// Deliberately kept separate from src/securityValidation/types.ts. Audit and
// security-validation are two distinct frameworks (see docs/ROADMAP.md); a
// later v0.3.2 batch may integrate their results into a unified report, but
// this batch keeps the audit issue schema independent even where a
// vocabulary word (e.g. "blocker") happens to be shared.
// ---------------------------------------------------------------------------

// Recognized --types values. Only "code-rot" has real detector coverage in
// Batch 1 — the rest are known, named future audit types that must fail
// cleanly with a "planned but not implemented" message rather than being
// silently accepted or treated as an unknown/garbage value.
export const AUDIT_TYPES = ["code-rot", "quality", "security", "project", "all"] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const IMPLEMENTED_AUDIT_TYPES: readonly AuditType[] = ["code-rot"];
export const PLANNED_AUDIT_TYPES: readonly AuditType[] = ["quality", "security", "project", "all"];
export const DEFAULT_AUDIT_TYPES: readonly AuditType[] = IMPLEMENTED_AUDIT_TYPES;

export const AUDIT_INCLUDE_AREAS = ["docs", "tests", "package", "architecture", "cli"] as const;
export type AuditIncludeArea = (typeof AUDIT_INCLUDE_AREAS)[number];
export const DEFAULT_AUDIT_INCLUDE_AREAS: readonly AuditIncludeArea[] = AUDIT_INCLUDE_AREAS;

export const AUDIT_OUTPUT_FORMATS = ["text", "json"] as const;
export type AuditOutputFormat = (typeof AUDIT_OUTPUT_FORMATS)[number];
export const DEFAULT_AUDIT_OUTPUT_FORMATS: readonly AuditOutputFormat[] = ["text", "json"];

// "none" is a valid, explicit opt-out — findings never block the command.
export const AUDIT_FAIL_ON_THRESHOLDS = ["blocker", "high", "medium", "low", "none"] as const;
export type AuditFailOnThreshold = (typeof AUDIT_FAIL_ON_THRESHOLDS)[number];
export const DEFAULT_AUDIT_FAIL_ON_THRESHOLD: AuditFailOnThreshold = "blocker";

// Issue severity. Distinct from AuditFailOnThreshold: "info" is a valid
// issue severity but not a selectable --fail-on threshold (an info-severity
// issue can never breach any threshold, including "low").
export const AUDIT_SEVERITIES = ["blocker", "high", "medium", "low", "info"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export const AUDIT_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type AuditConfidence = (typeof AUDIT_CONFIDENCE_LEVELS)[number];

export const AUDIT_FALSE_POSITIVE_RISK_LEVELS = ["high", "medium", "low"] as const;
export type AuditFalsePositiveRisk = (typeof AUDIT_FALSE_POSITIVE_RISK_LEVELS)[number];
