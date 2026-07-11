import type { SecurityFinding } from "../../../../securityValidation/types.js";
import { makeAndroidFinding } from "../../audit/androidFinding.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../candidateEvidence.js";
import { buildAndroidSourceLocation } from "../sourceLocation.js";
import { classifyDirectExpression } from "../sensitiveData/classifyDirectExpression.js";
import { classifySensitiveIdentifier, splitIdentifierWords } from "../sensitiveData/classifySensitiveIdentifier.js";
import { executableMask } from "../sensitiveData/localSourceContext.js";
import { splitTopLevelArguments } from "../sensitiveData/splitArguments.js";
import type { SecretScanFile } from "../secretCandidates/types.js";
import { collectClipboardEvidence } from "./collectClipboardEvidence.js";
import type { ClipboardMatch } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — clipboard analysis: turns raw ClipboardMatch evidence into
// CandidateEvidence / SecurityFinding using the two Batch 1 clipboard rule
// ids (android-sensitive-clipboard-write for writes, android-sensitive-
// clipboard-read-review for reads). Correlation is same-method-scope only
// (via methodScopes from sensitiveData/localSourceContext.ts) — never
// cross-method, never claims actual clipboard access at runtime.
// ---------------------------------------------------------------------------

export type AnalyzeClipboardResult = { candidates: CandidateEvidence[]; findings: SecurityFinding[] };

const USER_TRIGGER_METHOD_NAMES = /^(onClick|onLongClick|onMenuItemClick|copy|copyToClipboard|handleCopy|share)$/i;
const BACKGROUND_LIKE_CLASS_SUFFIX = /(Service|Receiver|Worker)$/;

function literalOf(expression: string | undefined): string | undefined {
  if (expression === undefined) return undefined;
  const classification = classifyDirectExpression(expression);
  return classification.kind === "string-literal" ? classification.literalValue : undefined;
}

function labelSensitive(labelExpression: string | undefined): ReturnType<typeof classifySensitiveIdentifier> {
  if (labelExpression === undefined) return undefined;
  const literal = literalOf(labelExpression);
  if (literal !== undefined) {
    const words = splitIdentifierWords(literal);
    for (const word of words) {
      const result = classifySensitiveIdentifier(word);
      if (result) return result;
    }
    return undefined;
  }
  const identifier = classifyDirectExpression(labelExpression).kind === "identifier" ? labelExpression : undefined;
  return identifier ? classifySensitiveIdentifier(identifier) : undefined;
}

function valueSensitive(valueExpression: string | undefined): ReturnType<typeof classifySensitiveIdentifier> {
  if (valueExpression === undefined) return undefined;
  const classification = classifyDirectExpression(valueExpression);
  if (classification.kind !== "identifier" && classification.kind !== "member-access") return undefined;
  const name = valueExpression.replace(/^.*\./, "");
  return classifySensitiveIdentifier(name);
}

function nearestBefore(mask: string, offset: number, pattern: RegExp): string | undefined {
  const window = mask.slice(Math.max(0, offset - 4000), offset);
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  const re = new RegExp(pattern.source, "g");
  while ((match = re.exec(window)) !== null) last = match;
  return last?.[1];
}

export function analyzeClipboardSecurityFile(targetRoot: string, file: SecretScanFile): AnalyzeClipboardResult {
  const candidates: CandidateEvidence[] = [];
  const findings: SecurityFinding[] = [];
  const mask = executableMask(file.content);
  const matches = collectClipboardEvidence(file.content);
  const creates = matches.filter((m) => m.kind === "clip-create");
  const markerOffsets = matches.filter((m) => m.kind === "sensitive-marker").map((m) => m.offset);
  const clearOffsetsByScope = new Map<number | undefined, number[]>();
  for (const m of matches.filter((m) => m.kind === "clip-clear")) {
    const list = clearOffsetsByScope.get(m.scopeId) ?? [];
    list.push(m.offset);
    clearOffsetsByScope.set(m.scopeId, list);
  }

  const limitations = [
    "Bounded lexical source analysis; does not prove clipboard content was actually set or read, that another application accessed the clipboard, or that a UI callback executed.",
  ];
  const location = (m: ClipboardMatch) => buildAndroidSourceLocation(targetRoot, file.absolutePath, { line: m.line });

  const finding = (m: ClipboardMatch, title: string, evidenceDetails: string[]) =>
    findings.push(
      makeAndroidFinding({
        ruleId: "android-sensitive-clipboard-write",
        title,
        severity: "major",
        confidence: "high",
        description: `${title} via ${m.api}. Static source evidence only; does not prove clipboard content was set at runtime or read by another application.`,
        manifestPath: file.relativePath,
        identity: `${m.api}:${m.line}`,
        location: { line: m.line },
        evidenceDetails,
        recommendation: "Avoid copying credentials or recovery codes to the system clipboard; mark unavoidable sensitive clips with ClipDescription.EXTRA_IS_SENSITIVE and clear them promptly.",
      })
    );

  const candidate = (
    ruleId: "android-sensitive-clipboard-write" | "android-sensitive-clipboard-read-review",
    m: ClipboardMatch,
    summary: string,
    rawValue: string | undefined,
    confidence: "low" | "medium" | "high" = "medium",
    resolutionState: "resolved" | "unresolved" | "not-applicable" = "resolved"
  ) =>
    candidates.push(
      makeCandidateEvidence({
        ruleId,
        category: "android-clipboard",
        confidence,
        modulePath: file.modulePath,
        location: location(m),
        summary,
        rawValue,
        resolutionState,
        staticAnalysisLimitations: limitations,
      })
    );

  function resolveClip(argumentExpression: string | undefined, scopeId: number | undefined): { label?: string; value?: string; markerNearby: boolean } | undefined {
    if (argumentExpression === undefined) return undefined;
    const inline = /^ClipData\.(?:newPlainText|newHtmlText|newUri)\(([\s\S]*)\)$/.exec(argumentExpression.trim());
    if (inline) {
      const args = splitTopLevelArguments(inline[1]);
      return { label: args[0], value: args[1], markerNearby: false };
    }
    const alias = classifyDirectExpression(argumentExpression).kind === "identifier" ? argumentExpression : undefined;
    if (alias !== undefined) {
      const source = creates.find((c) => c.assignedVariable === alias && c.scopeId === scopeId);
      if (source) return { label: source.labelExpression, value: source.valueExpression, markerNearby: false };
    }
    return undefined;
  }

  for (const m of matches) {
    if (m.kind === "clip-set") {
      const resolved = resolveClip(m.argumentExpression, m.scopeId);
      const nearMarker = markerOffsets.some((offset) => Math.abs(offset - m.offset) < 400);
      const clearedNearby = (clearOffsetsByScope.get(m.scopeId) ?? []).some((offset) => offset > m.offset);
      const methodName = nearestBefore(mask, m.offset, /(?:fun|void)\s+([A-Za-z_]\w*)\s*\(/);
      const userTriggered = methodName !== undefined && USER_TRIGGER_METHOD_NAMES.test(methodName);

      if (!resolved) {
        candidate("android-sensitive-clipboard-write", m, "Dynamic ClipData object set on the clipboard; contents not resolved", m.argumentExpression, "low", "unresolved");
        continue;
      }

      const sensitive = labelSensitive(resolved.label) ?? valueSensitive(resolved.value);
      if (!sensitive) continue;

      const valueClassification = resolved.value !== undefined ? classifyDirectExpression(resolved.value) : undefined;
      if (valueClassification?.kind === "string-literal" || valueClassification?.kind === "identifier" || valueClassification?.kind === "member-access") {
        const title = nearMarker
          ? `Sensitive clipboard write with an EXTRA_IS_SENSITIVE marker present nearby (${sensitive.sensitiveDataCategory})`
          : `Direct ${sensitive.sensitiveDataCategory} copied to the system clipboard`;
        if (nearMarker || userTriggered) {
          candidate("android-sensitive-clipboard-write", m, title, resolved.value, "medium");
        } else {
          finding(m, title, [`label=${resolved.label ?? "(none)"}`, `marker=${nearMarker}`, `cleared=${clearedNearby}`]);
        }
      } else {
        candidate("android-sensitive-clipboard-write", m, `Sensitive-looking clipboard label with a dynamic payload (${sensitive.sensitiveDataCategory})`, resolved.value, "medium", "unresolved");
      }
      continue;
    }

    if (m.kind === "legacy-set-text") {
      const sensitive = valueSensitive(m.valueExpression);
      if (!sensitive) continue;
      const classification = m.valueExpression !== undefined ? classifyDirectExpression(m.valueExpression) : undefined;
      if (classification?.kind === "string-literal" || classification?.kind === "identifier") {
        finding(m, `Direct ${sensitive.sensitiveDataCategory} copied via legacy ClipboardManager.setText`, [`value=${m.valueExpression}`]);
      } else {
        candidate("android-sensitive-clipboard-write", m, "Sensitive-looking legacy clipboard write with a dynamic value", m.valueExpression, "medium", "unresolved");
      }
      continue;
    }

    if (m.kind === "clip-get") {
      const className = nearestBefore(mask, m.offset, /class\s+([A-Za-z_]\w*)/);
      const methodName = nearestBefore(mask, m.offset, /(?:fun|void)\s+([A-Za-z_]\w*)\s*\(/);
      const backgroundLike = className !== undefined && BACKGROUND_LIKE_CLASS_SUFFIX.test(className);
      const userTriggered = methodName !== undefined && USER_TRIGGER_METHOD_NAMES.test(methodName);
      if (backgroundLike) {
        candidate("android-sensitive-clipboard-read-review", m, `Clipboard read from a background-like class (${className})`, undefined, "medium", "unresolved");
      } else if (!userTriggered) {
        candidate("android-sensitive-clipboard-read-review", m, "Clipboard read outside a recognized user-triggered paste flow", undefined, "low", "unresolved");
      }
      continue;
    }
  }

  return { candidates, findings };
}
