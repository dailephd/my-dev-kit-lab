import type { AuditConfig } from "./auditConfig.js";
import { calculateAuditExitCode } from "./auditExitCode.js";
import type { AuditIssue } from "./auditIssue.js";
import { DEFAULT_AUDIT_REGISTRY, selectDetectors, type AuditDetector } from "./auditRegistry.js";
import { resolveAuditTarget, type AuditTarget } from "./auditTarget.js";
import type { AuditSeverity } from "./auditTypes.js";
import { scanProjectInventory, type ProjectInventorySnapshot } from "./projectInventory.js";
import { collectSourceOfTruth, type SourceOfTruthSnapshot } from "./sourceOfTruth.js";
import { collectSourceFacts } from "./collectSourceFacts.js";
import type { SourceFactsSnapshot } from "./sourceFacts.js";
import { collectPythonProjectMetadata, type PythonProjectMetadataSnapshot } from "./pythonProjectMetadata.js";
import { runSecurityAuditAdapter } from "../security/securityAuditAdapter.js";
import {
  ANDROID_AUDIT_NOT_REQUESTED_SUMMARY,
  SECURITY_AUDIT_NOT_RUN_SUMMARY,
  type AndroidAuditSummary,
  type SecurityAuditReportSummary,
} from "../security/securityAuditTypes.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 1/2 — audit runner.
//
// Selects detectors from a registry, runs them, and normalizes results into
// an AuditResult. A detector throwing is recorded as a structured
// detectorError and does not crash the run or the process -- only a
// config/target resolution failure (thrown before runAudit is called, or
// while it resolves the target internally) is a fatal error, which is the
// caller's responsibility to map to exit code 2.
//
// Batch 2 (v0.3.0): collects a ProjectInventorySnapshot and
// SourceOfTruthSnapshot before running detectors. v0.3.1 Batch 2 adds a third
// collection step, collectSourceFacts(), which never throws itself (analyzer
// failures are caught per-file and recorded as parse-error diagnostics) --
// but it is still not individually try/catch-wrapped here, for the same
// reason as the calls below. These calls are intentionally left unguarded
// here (not wrapped in their own try/catch) -- by the time runAudit() is
// called, the target has already been resolved and validated, so any
// exception here is a genuine runtime failure. It propagates as a rejected
// promise up to the entrypoint script's existing try/catch around
// `await runAudit(...)`, which already maps any such failure to exit code 2
// ("audit runtime failure") -- no new error-handling path needed. Optional,
// per-file collection problems (a single unreadable doc file, a workflow
// file that fails to parse, etc.) are handled inside the collectors
// themselves via their own `warnings` arrays, not by throwing.
// ---------------------------------------------------------------------------

export type AuditTargetSummary = {
  rootPath: string;
  displayName: string;
  isSelf: boolean;
};

export type AuditConfigSummary = {
  types: string[];
  include: string[];
  formats: string[];
  failOn: string;
  out: string;
  isDefaultRun: boolean;
  // v0.4.2 Batch 3 -- mirrors AuditConfig.android.
  android: boolean;
};

export type AuditDetectorError = {
  id: string;
  message: string;
};

export type AuditSkippedDetector = {
  id: string;
  reason: string;
};

export type AuditResult = {
  configSummary: AuditConfigSummary;
  targetSummary: AuditTargetSummary;
  issues: AuditIssue[];
  skippedDetectors: AuditSkippedDetector[];
  detectorErrors: AuditDetectorError[];
  issueCounts: Record<AuditSeverity, number>;
  exitCode: number;
  exitReason: string;
  // v0.3.0 Batch 2 — data collected before detectors run. With
  // DEFAULT_AUDIT_REGISTRY still empty, these are the only substantive
  // output of a run; issues/detector fields above stay at their Batch 1
  // zero-value shape until a later batch registers real detectors.
  inventory: ProjectInventorySnapshot;
  sourceOfTruth: SourceOfTruthSnapshot;
  // v0.3.1 Batch 2 -- source facts substrate (analyzer registry not yet
  // populated; see collectSourceFacts.ts for the fallback policy).
  sourceFacts: SourceFactsSnapshot;
  // v0.3.2 Batch 3 -- presence-only/simple-text-extraction Python project
  // metadata (see pythonProjectMetadata.ts). Collected unconditionally, same
  // as sourceFacts above -- cheap, safe, and never executes Python tooling.
  pythonProjectMetadata: PythonProjectMetadataSnapshot;
  // v0.3.2 Batch 4 -- security-validation audit adapter summary. Unlike
  // sourceFacts/pythonProjectMetadata above, this is NOT collected
  // unconditionally: it only runs when config.types includes "security" (see
  // runAudit() below), since it shells out to npm audit/CodeQL/Semgrep/fuzz
  // and is far more expensive than the always-on collectors. Always present
  // (never undefined) -- `ran: false` is how a run that didn't select
  // "security" is distinguished from one that ran and found nothing.
  securitySummary: SecurityAuditReportSummary;
  // v0.4.2 Batch 3 -- Batch 2's Android integration summary, surfaced the
  // same way securitySummary is: always present (never undefined), with
  // `requested`/`status` distinguishing "not requested" from "requested and
  // ran". Only ever populated when config.types includes "security" AND
  // config.android is true (see below) -- --android alone can never trigger
  // Android validation, matching Batch 2's explicit opt-in contract.
  androidSummary: AndroidAuditSummary;
  // True only when the selected registry has zero detectors for the
  // selected types/include areas -- lets callers (the report renderer)
  // state plainly that no code-rot detector coverage occurred, rather than
  // implying a clean 0-issue scan.
  noDetectorsRegistered: boolean;
};

export type RunAuditOptions = {
  config: AuditConfig;
  toolRoot: string;
  // Pre-resolved target, if the caller already resolved one (e.g. to fail
  // fast with a clean error before calling runAudit). Resolved internally
  // when omitted.
  target?: AuditTarget;
  registry?: readonly AuditDetector[];
  // v0.4.2 Batch 3 -- narrow test-injection passthrough to Batch 2's own
  // runSecurityAuditAdapter dependency seam (e.g. runAndroidValidation).
  // Never used by the real CLI entrypoint (scripts/audits/runAudit.ts never
  // passes it); exists only so runner-level tests can prove failure
  // isolation without a real Android validator run.
  securityDependencies?: Parameters<typeof runSecurityAuditAdapter>[1];
};

export async function runAudit(options: RunAuditOptions): Promise<AuditResult> {
  const { config, toolRoot } = options;
  const registry = options.registry ?? DEFAULT_AUDIT_REGISTRY;
  const target = options.target ?? resolveAuditTarget(config.targetPathArg, toolRoot);

  const inventory = scanProjectInventory(target.rootPath);
  const sourceOfTruth = collectSourceOfTruth(target.rootPath, inventory);
  const sourceFacts = await collectSourceFacts(target.rootPath, inventory);
  const pythonProjectMetadata = collectPythonProjectMetadata(target.rootPath, inventory);

  const selected = selectDetectors(registry, config.types, config.include);
  const ctx = { target, config, inventory, sourceOfTruth, sourceFacts };

  const issues: AuditIssue[] = [];
  const skippedDetectors: AuditSkippedDetector[] = [];
  const detectorErrors: AuditDetectorError[] = [];

  // Sequential, in registry order -- keeps issue ordering deterministic
  // without needing a secondary sort step.
  for (const detector of selected) {
    try {
      if (detector.shouldSkip) {
        const decision = detector.shouldSkip(ctx);
        if (decision.skip) {
          skippedDetectors.push({ id: detector.id, reason: decision.reason });
          continue;
        }
      }
      const detectorIssues = await detector.run(ctx);
      issues.push(...detectorIssues);
    } catch (err) {
      detectorErrors.push({
        id: detector.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // v0.3.2 Batch 4 -- security audit adapter. Conditional (see the
  // AuditResult.securitySummary field comment above): only runs when --types
  // explicitly includes "security", never as part of a default/code-rot-only
  // run. Appended after the code-rot detector loop above, so combined
  // `--types code-rot,security` runs keep a deterministic issue order:
  // code-rot detector issues (registry order) first, then security findings
  // (security-validation check-execution order).
  let securitySummary: SecurityAuditReportSummary = SECURITY_AUDIT_NOT_RUN_SUMMARY;
  let androidSummary: AndroidAuditSummary = ANDROID_AUDIT_NOT_REQUESTED_SUMMARY;
  if (config.types.includes("security")) {
    const securityAudit = await runSecurityAuditAdapter(
      { toolRoot, config, android: config.android ? { enabled: true } : undefined },
      options.securityDependencies
    );
    issues.push(...securityAudit.issues);
    securitySummary = securityAudit.summary;
    androidSummary = securityAudit.android;
  }

  const issueCounts = countIssuesBySeverity(issues);
  const { exitCode, reason } = calculateAuditExitCode(issues, config.failOn);

  return {
    configSummary: {
      types: config.types,
      include: config.include,
      formats: config.formats,
      failOn: config.failOn,
      out: config.out,
      isDefaultRun: config.isDefaultRun,
      android: config.android,
    },
    targetSummary: {
      rootPath: target.rootPath,
      displayName: target.displayName,
      isSelf: target.isSelf,
    },
    issues,
    skippedDetectors,
    detectorErrors,
    issueCounts,
    exitCode,
    exitReason: reason,
    inventory,
    sourceOfTruth,
    sourceFacts,
    pythonProjectMetadata,
    securitySummary,
    androidSummary,
    noDetectorsRegistered: selected.length === 0,
  };
}

function countIssuesBySeverity(issues: readonly AuditIssue[]): Record<AuditSeverity, number> {
  const counts: Record<AuditSeverity, number> = { blocker: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const issue of issues) {
    counts[issue.severity] += 1;
  }
  return counts;
}
