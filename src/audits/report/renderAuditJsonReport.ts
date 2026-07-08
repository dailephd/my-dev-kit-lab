import type { AuditReportModel } from "./auditReportModel.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 5 — stable JSON report renderer.
//
// Pure: JSON.stringify with a fixed, explicit key order (not
// insertion-order-dependent on how auditReportModel.ts happens to construct
// the object) and 2-space indent. No sanitization needed here -- JSON.stringify
// already escapes control characters into safe \u00XX sequences by spec, so
// hostile evidence content cannot corrupt the JSON structure. See
// sanitizeAuditText.ts's header comment for the same reasoning from the text
// renderer's side.
// ---------------------------------------------------------------------------

export function renderAuditJsonReport(model: AuditReportModel): string {
  const ordered = {
    schemaVersion: model.schemaVersion,
    metadata: model.metadata,
    target: model.target,
    config: model.config,
    summary: model.summary,
    inventory: model.inventory,
    sourceOfTruth: model.sourceOfTruth,
    detectors: model.detectors,
    issues: model.issues,
    skippedDetectors: model.skippedDetectors,
    detectorErrors: model.detectorErrors,
    recommendations: model.recommendations,
    exit: model.exit,
  };
  return JSON.stringify(ordered, null, 2);
}
