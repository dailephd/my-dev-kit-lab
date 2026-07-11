import type { DatabaseRuleEntry, DatabaseRulesResult, FirebaseArtifactFile } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — bounded local Realtime Database rules parser.
//
// Recursively walks the parsed JSON tree collecting .read/.write/.validate/
// .indexOn entries with their JSON path. This is not the Firebase rules
// evaluator: no runtime auth is evaluated, and a local rules file is never
// treated as proof of the deployed configuration.
// ---------------------------------------------------------------------------

const MAX_DEPTH = 40;
const MAX_NODES = 20_000;
const MAX_CONDITION_LENGTH = 200;

const RULE_KEYS = new Set([".read", ".write", ".validate", ".indexOn"]);

function summarize(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_CONDITION_LENGTH ? `${text.slice(0, MAX_CONDITION_LENGTH)}...` : text;
}

export function parseDatabaseRules(file: FirebaseArtifactFile): DatabaseRulesResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return { file, malformed: true, entries: [], boundsExceeded: false };
  }

  const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).rules ?? parsed : parsed;
  const entries: DatabaseRuleEntry[] = [];
  let nodeCount = 0;
  let boundsExceeded = false;

  function walk(node: unknown, jsonPath: string, depth: number): void {
    if (boundsExceeded) return;
    nodeCount += 1;
    if (nodeCount > MAX_NODES || depth > MAX_DEPTH) {
      boundsExceeded = true;
      return;
    }
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (RULE_KEYS.has(key)) {
        entries.push({
          jsonPath,
          operation: key as DatabaseRuleEntry["operation"],
          literalBoolean: typeof value === "boolean" ? value : undefined,
          conditionSummary: summarize(value),
          depth,
        });
        continue;
      }
      walk(value, jsonPath === "/" ? `/${key}` : `${jsonPath}/${key}`, depth + 1);
    }
  }

  walk(root, "/", 0);

  return { file, malformed: false, entries, boundsExceeded };
}
