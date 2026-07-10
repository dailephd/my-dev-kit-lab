import { extractBuildFileEvidence } from "../detect/buildFileEvidence.js";
import type { AndroidGradleModuleInfo } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — bounded literal metadata extraction from a single module
// build.gradle(.kts) file's text.
//
// Reuses Batch 2's extractBuildFileEvidence for plugin/Compose boolean
// evidence (already covers namespace/applicationId at a basic level) and
// adds the additional literal fields Batch 4 needs (version/SDK fields,
// build-type names) plus raw/unresolved-expression preservation for every
// field, using the same generic "try a literal, else capture a bounded raw
// excerpt" strategy for each key. Comments are stripped first so a
// commented-out assignment never becomes active metadata (ANDROID-B4-05).
// ---------------------------------------------------------------------------

function stripComments(text: string): string {
  // Replaces comment characters with spaces (not empty string) so any
  // surviving line/column-independent offsets are not shifted — this batch
  // does not track per-field locations, but keeping length stable is cheap
  // and avoids accidentally joining tokens across a removed comment.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (match) => " ".repeat(match.length));
}

const STRING_OR_INT = `(?:'([^']*)'|"([^"]*)"|(-?\\d+))`;

function extractLiteral(text: string, keyAlternatives: string[]): { value?: string; raw?: string } {
  const keyPattern = keyAlternatives.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // Anchored to the start of a line (allowing leading indentation) so a key
  // name that merely appears as a word inside an unrelated string literal —
  // e.g. `val note = "the applicationId field below is the real one"` — is
  // never mistaken for a real assignment (ANDROID-B4-05). Genuine Gradle
  // property assignments always begin a statement/line.
  const literalPattern = new RegExp(`^[ \\t]*(?:${keyPattern})\\b\\s*[=]?\\s*${STRING_OR_INT}`, "m");
  const literalMatch = text.match(literalPattern);
  if (literalMatch) {
    const value = literalMatch[1] ?? literalMatch[2] ?? literalMatch[3];
    return { value };
  }
  const rawPattern = new RegExp(`^[ \\t]*(?:${keyPattern})\\b\\s*[=]?\\s*([^\\n]{1,120})`, "m");
  const rawMatch = text.match(rawPattern);
  if (rawMatch) {
    const raw = rawMatch[1].trim();
    // A raw excerpt that is itself just a bare literal (already handled
    // above) or empty is not meaningfully "dynamic" — only report genuinely
    // unresolved expressions.
    if (raw.length > 0) return { raw };
  }
  return {};
}

// Finds the top-level named entries inside a `<blockKeyword> { ... }` block
// (e.g. `buildTypes { debug { ... } release { ... } }` or
// `sourceSets { main { ... } androidTest { ... } }`), supporting both the
// bare-identifier Groovy/Kotlin-DSL form and the Kotlin DSL
// getByName/create/named(...) form. Bounded by brace-depth matching, not a
// full parser — nested unrelated blocks inside are not descended into for
// name extraction beyond the immediate children.
function findNamedBlockEntries(text: string, blockKeyword: string): string[] {
  const blockStart = text.search(new RegExp(`\\b${blockKeyword}\\s*\\{`));
  if (blockStart === -1) return [];
  const openBraceIndex = text.indexOf("{", blockStart);
  let depth = 0;
  let endIndex = text.length;
  for (let i = openBraceIndex; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }
  }
  const block = text.slice(openBraceIndex + 1, endIndex);

  const names = new Set<string>();
  for (const match of block.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\{/g)) {
    names.add(match[1]);
  }
  for (const match of block.matchAll(/\b(?:getByName|create|named)\(\s*["']([\w-]+)["']/g)) {
    names.add(match[1]);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export type ModuleMetadataExtractionResult = {
  info: Omit<AndroidGradleModuleInfo, "path">;
};

// Extracts bounded static metadata for one module's build file text. `path`
// is intentionally omitted from the returned info — the caller (the
// aggregator, which already knows the module path from detection) attaches
// it, keeping this function pure with respect to filesystem/module identity.
export function extractModuleGradleMetadata(rawText: string): ModuleMetadataExtractionResult {
  const text = stripComments(rawText);
  const evidence = extractBuildFileEvidence(text);
  const unsupportedExpressions: string[] = [];

  const namespace = extractLiteral(text, ["namespace"]);
  const applicationId = extractLiteral(text, ["applicationId"]);
  const versionCode = extractLiteral(text, ["versionCode"]);
  const versionName = extractLiteral(text, ["versionName"]);
  const minSdk = extractLiteral(text, ["minSdk", "minSdkVersion"]);
  const targetSdk = extractLiteral(text, ["targetSdk", "targetSdkVersion"]);
  const compileSdk = extractLiteral(text, ["compileSdk", "compileSdkVersion"]);

  for (const [field, result] of [
    ["namespace", namespace],
    ["applicationId", applicationId],
    ["versionCode", versionCode],
    ["versionName", versionName],
    ["minSdk", minSdk],
    ["targetSdk", targetSdk],
    ["compileSdk", compileSdk],
  ] as const) {
    if (result.raw) {
      unsupportedExpressions.push(`${field}: ${result.raw}`);
    }
  }

  return {
    info: {
      isApplication: evidence.androidApplicationPlugin || undefined,
      isLibrary: evidence.androidLibraryPlugin || undefined,
      namespace: namespace.value ?? evidence.namespace,
      namespaceRaw: namespace.raw,
      applicationId: applicationId.value ?? evidence.applicationId,
      applicationIdRaw: applicationId.raw,
      versionCode: versionCode.value,
      versionCodeRaw: versionCode.raw,
      versionName: versionName.value,
      versionNameRaw: versionName.raw,
      minSdk: minSdk.value,
      minSdkRaw: minSdk.raw,
      targetSdk: targetSdk.value,
      targetSdkRaw: targetSdk.raw,
      compileSdk: compileSdk.value,
      compileSdkRaw: compileSdk.raw,
      buildTypes: findNamedBlockEntries(text, "buildTypes"),
      composeEnabled: evidence.composeBuildFeatureEvidence || evidence.composeDependencyEvidence || undefined,
      sourceSetEvidence: findNamedBlockEntries(text, "sourceSets").map((name) => `declared sourceSet: ${name}`),
      testSourceSetEvidence: [],
      unsupportedExpressions,
    },
  };
}
