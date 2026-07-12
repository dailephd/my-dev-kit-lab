import { safeJsonParse, DEFAULT_MAX_MESSAGE_LENGTH } from "../boundedOutput.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — bounded Android Lint SARIF report parsing (supplemental
// to XML; used for standard metadata like rule/tool version when present).
// ---------------------------------------------------------------------------

export type LintSarifResult = {
  ruleId: string;
  level: string;
  message: string;
  artifactUri?: string;
  line?: number;
  column?: number;
};

export type ParseLintSarifResult = { malformed: boolean; toolVersion?: string; results: LintSarifResult[] };

const MAX_RESULTS = 5_000;

function boundedMessage(text: unknown): string {
  const value = typeof text === "string" ? text : "";
  return value.length > DEFAULT_MAX_MESSAGE_LENGTH ? `${value.slice(0, DEFAULT_MAX_MESSAGE_LENGTH)}...` : value;
}

export function parseLintSarif(sarifText: string): ParseLintSarifResult {
  const parsed = safeJsonParse<Record<string, unknown>>(sarifText);
  if (!parsed.ok) return { malformed: true, results: [] };

  const runs = Array.isArray(parsed.value.runs) ? parsed.value.runs : [];
  const firstRun = runs[0] as Record<string, unknown> | undefined;
  if (!firstRun) return { malformed: false, results: [] };

  const driver = (firstRun.tool as Record<string, unknown> | undefined)?.driver as Record<string, unknown> | undefined;
  const toolVersion = typeof driver?.version === "string" ? driver.version : undefined;
  const rawResults = Array.isArray(firstRun.results) ? firstRun.results : [];

  const results: LintSarifResult[] = [];
  for (const rawResult of rawResults.slice(0, MAX_RESULTS)) {
    const result = rawResult as Record<string, unknown>;
    const message = (result.message as Record<string, unknown> | undefined)?.text;
    const locations = Array.isArray(result.locations) ? result.locations : [];
    const firstLocation = locations[0] as Record<string, unknown> | undefined;
    const physicalLocation = firstLocation?.physicalLocation as Record<string, unknown> | undefined;
    const artifactLocation = physicalLocation?.artifactLocation as Record<string, unknown> | undefined;
    const region = physicalLocation?.region as Record<string, unknown> | undefined;

    results.push({
      ruleId: typeof result.ruleId === "string" ? result.ruleId : "(unknown-rule)",
      level: typeof result.level === "string" ? result.level : "(unknown)",
      message: boundedMessage(message),
      artifactUri: typeof artifactLocation?.uri === "string" ? artifactLocation.uri : undefined,
      line: typeof region?.startLine === "number" ? region.startLine : undefined,
      column: typeof region?.startColumn === "number" ? region.startColumn : undefined,
    });
  }

  return { malformed: false, toolVersion, results };
}
