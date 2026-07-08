// ---------------------------------------------------------------------------
// v0.3.0 Batch 5 — audit report filename constants.
//
// Keeps the exact filenames already committed to in Batch 1/2/3/4
// (tests/audits/auditReportInventoryOutput.test.ts,
// tests/audits/auditCommandSmoke.test.ts,
// tests/audits/auditCommandCodeRotSmoke.test.ts all hardcode
// "code-rot-audit.json"/"code-rot-audit.txt") -- the Batch 5 spec's
// "suggested" names are only suggestions; the filename convention itself is
// unchanged, only the JSON content schema changes in this batch.
// ---------------------------------------------------------------------------

export const AUDIT_JSON_REPORT_FILENAME = "code-rot-audit.json";
export const AUDIT_TEXT_REPORT_FILENAME = "code-rot-audit.txt";
