// v0.4.5 Batch 5: JSON rendering is a direct, stable serialization of the already-built
// bounded report model -- no recalculation, no field renaming.
import type { ContextIntegrityReportV1 } from "./contextIntegrityReportModel.js";

export function renderContextIntegrityJsonReport(report: ContextIntegrityReportV1): string {
  return JSON.stringify(report, null, 2);
}
