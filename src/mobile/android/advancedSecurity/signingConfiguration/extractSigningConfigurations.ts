import { extractBooleanLiteral, extractLiteral, extractNamedSubBlocks, stripComments } from "../../gradle/moduleMetadataExtractor.js";
import { fingerprintCandidateValue, redactedPreviewForCandidate } from "../redaction.js";
import type {
  AndroidGradleSigningConfigInfo,
  SigningCredentialValue,
  SigningExpressionState,
  SigningPathValue,
} from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 4 — static Gradle signingConfigs extraction.
//
// Reuses Batch 3's exported bounded Groovy/Kotlin-DSL extraction helpers
// (extractNamedSubBlocks/extractLiteral/extractBooleanLiteral/stripComments)
// rather than a second Gradle parser. Never evaluates Gradle. This is the
// ONLY function that ever sees a raw storePassword/keyPassword literal — it
// redacts/fingerprints immediately (Batch 1 owners) before returning, per
// agents.txt Batch 4 section 12's "raw values must not cross the narrow
// matching layer" requirement.
// ---------------------------------------------------------------------------

type LiteralOrRaw = { value?: string; raw?: string };

function classifyExpressionState(result: LiteralOrRaw): SigningExpressionState {
  if (result.value !== undefined) return "literal";
  if (result.raw === undefined) return "missing";
  const raw = result.raw;
  if (/\bSystem\.getenv\b|\bproviders\.environmentVariable\b/.test(raw)) return "environment-reference";
  if (/\bproviders\.gradleProperty\b|\bproject\.findProperty\b|\bfindProperty\(|(?<![A-Za-z0-9_.])\bproperty\(/.test(raw)) return "gradle-property-reference";
  if (/\blocalProperties\b/i.test(raw)) return "local-property-reference";
  if (/[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(raw)) return "method-call";
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(raw)) return "variable-reference";
  return "dynamic";
}

// Bounded raw-expression preview for non-literal states. These are
// expressions (e.g. `System.getenv("STORE_PASSWORD")`), not secrets
// themselves, but still bounded/control-char-stripped for safety and
// consistency with the rest of the codebase's evidence conventions.
function boundedRawExpression(raw: string): string {
  return redactedPreviewForCandidate(raw, { maxLength: 120, edgeLength: 60 });
}

function extractPathValue(content: string, keys: string[]): SigningPathValue {
  const result = extractLiteral(content, keys);
  const state = classifyExpressionState(result);
  if (state === "literal") return { state, literalValue: result.value };
  if (result.raw !== undefined) return { state, rawExpression: boundedRawExpression(result.raw) };
  return { state: "missing" };
}

// storeFile is conventionally wrapped as `storeFile file("name.jks")` /
// `storeFile = file("name.jks")` in both DSLs — the plain extractLiteral
// literal-match never fires here (a call expression intervenes before the
// quoted string), so the literal path is unwrapped explicitly first.
function extractStoreFileValue(content: string): SigningPathValue {
  const fileWrapped = content.match(/\bstoreFile\s*=?\s*file\(\s*["']([^"']*)["']\s*\)/);
  if (fileWrapped) return { state: "literal", literalValue: fileWrapped[1] };
  return extractPathValue(content, ["storeFile"]);
}

function extractCredentialValue(content: string, keys: string[]): SigningCredentialValue {
  const result = extractLiteral(content, keys);
  const state = classifyExpressionState(result);
  if (state === "literal" && result.value !== undefined) {
    return { state, redactedPreview: redactedPreviewForCandidate(result.value), fingerprint: fingerprintCandidateValue(result.value) };
  }
  if (result.raw !== undefined) return { state, rawExpression: boundedRawExpression(result.raw) };
  return { state: "missing" };
}

function extractSigningConfigEntry(name: string, content: string): AndroidGradleSigningConfigInfo {
  const v1 = extractBooleanLiteral(content, ["enableV1Signing", "v1SigningEnabled"]);
  const v2 = extractBooleanLiteral(content, ["enableV2Signing", "v2SigningEnabled"]);
  const v3 = extractBooleanLiteral(content, ["enableV3Signing", "v3SigningEnabled"]);
  const v4 = extractBooleanLiteral(content, ["enableV4Signing", "v4SigningEnabled"]);

  return {
    name,
    storeFile: extractStoreFileValue(content),
    storePassword: extractCredentialValue(content, ["storePassword"]),
    keyAlias: extractPathValue(content, ["keyAlias"]),
    keyPassword: extractCredentialValue(content, ["keyPassword"]),
    enableV1Signing: v1.value,
    enableV2Signing: v2.value,
    enableV3Signing: v3.value,
    enableV4Signing: v4.value,
  };
}

// Extracts every named entry inside a module build file's `signingConfigs { }`
// block. Returns an empty array (never throws) when no such block exists.
export function extractSigningConfigurations(rawBuildFileText: string): AndroidGradleSigningConfigInfo[] {
  const text = stripComments(rawBuildFileText);
  return extractNamedSubBlocks(text, "signingConfigs")
    .map(({ name, content }) => extractSigningConfigEntry(name, content))
    .sort((a, b) => a.name.localeCompare(b.name));
}
