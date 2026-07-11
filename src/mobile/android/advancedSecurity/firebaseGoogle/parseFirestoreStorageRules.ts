import { executableMask, lineForOffset } from "../sensitiveData/localSourceContext.js";
import type { FirebaseArtifactFile, RulesLanguageMatch, RulesLanguageResult } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — bounded local Firestore/Storage security-rules parser.
//
// A brace-aware, comment/string-masked local scanner over `match { ... }` /
// `allow ...: if ...;` syntax — not a full Firebase rules-language compiler.
// Functions, imports, and complex boolean expressions are preserved only as
// a bounded condition summary; this module never evaluates a condition and
// never claims a rule is (or is not) the deployed configuration.
// ---------------------------------------------------------------------------

const MAX_MATCH_BLOCKS = 500;
const MAX_ALLOW_STATEMENTS = 1000;
const MAX_CONDITION_LENGTH = 300;
const MATCH_HEADER = /\bmatch\s+([^\n{]+?)\s*\{/g;
const ALLOW_STATEMENT = /\ballow\s+([A-Za-z,\s]+?)\s*(?::\s*if\s+([^;]+?))?\s*;/g;
const TEST_MODE_TIME = /request\.time\s*[<>]=?\s*timestamp\.(date|value)\s*\(/;

function braceEnd(mask: string, openBraceIndex: number): number {
  let depth = 0;
  for (let i = openBraceIndex; i < mask.length; i += 1) {
    if (mask[i] === "{") depth += 1;
    else if (mask[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return mask.length - 1;
}

function boundedCondition(condition: string | undefined): string {
  if (condition === undefined) return "(no condition — always allowed)";
  const trimmed = condition.trim();
  return trimmed.length > MAX_CONDITION_LENGTH ? `${trimmed.slice(0, MAX_CONDITION_LENGTH)}...` : trimmed;
}

export function parseFirestoreOrStorageRules(file: FirebaseArtifactFile, service: "firestore" | "storage"): RulesLanguageResult {
  const mask = executableMask(file.content);
  let boundsExceeded = false;

  const blocks: { pattern: string; from: number; to: number }[] = [];
  for (const match of mask.matchAll(MATCH_HEADER)) {
    if (blocks.length >= MAX_MATCH_BLOCKS) {
      boundsExceeded = true;
      break;
    }
    const from = match.index ?? 0;
    const openBrace = from + match[0].length - 1;
    blocks.push({ pattern: match[1].trim(), from, to: braceEnd(mask, openBrace) });
  }

  function enclosingPattern(offset: number): string {
    let best: { pattern: string; from: number; to: number } | undefined;
    for (const block of blocks) {
      if (offset >= block.from && offset <= block.to) {
        if (best === undefined || block.to - block.from < best.to - best.from) best = block;
      }
    }
    return best?.pattern ?? "(unresolved match scope)";
  }

  const matches: RulesLanguageMatch[] = [];
  let allowCount = 0;
  for (const match of mask.matchAll(ALLOW_STATEMENT)) {
    if (allowCount >= MAX_ALLOW_STATEMENTS) {
      boundsExceeded = true;
      break;
    }
    allowCount += 1;
    const offset = match.index ?? 0;
    const operations = match[1]
      .split(",")
      .map((op) => op.trim())
      .filter(Boolean);
    const conditionRaw = match[2]?.trim();
    const isLiteralTrue = conditionRaw === undefined || conditionRaw === "true";
    const isLiteralFalse = conditionRaw === "false";
    matches.push({
      service,
      matchPath: enclosingPattern(offset),
      operations,
      conditionSummary: boundedCondition(conditionRaw),
      isLiteralTrue,
      isLiteralFalse,
      hasAuthCondition: conditionRaw !== undefined && /request\.auth/.test(conditionRaw),
      isTestModeTimeCondition: conditionRaw !== undefined && TEST_MODE_TIME.test(conditionRaw),
      line: lineForOffset(file.content, offset),
    });
  }

  return { file, malformed: false, matches, boundsExceeded };
}
