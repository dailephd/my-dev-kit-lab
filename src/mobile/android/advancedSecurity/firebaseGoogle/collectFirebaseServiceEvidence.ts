import { executableMask, lineForOffset, methodScopes, scopeAt } from "../sensitiveData/localSourceContext.js";
import { splitTopLevelArguments } from "../sensitiveData/splitArguments.js";
import { classifyDirectExpression } from "../sensitiveData/classifyDirectExpression.js";
import { classifySensitiveIdentifier } from "../sensitiveData/classifySensitiveIdentifier.js";
import type {
  AnalyticsEventEvidence,
  CollectionSetterEvidence,
  FirebaseArtifactFile,
  FirebaseServiceUseEvidence,
  ManifestCollectionMetadata,
} from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — bounded Firebase/Google service-use, collection-metadata,
// and analytics-event evidence collection. Purely lexical: Gradle files are
// never evaluated, no dependency graph is resolved, and no Bundle/object
// contents are inferred beyond direct same-method arguments.
// ---------------------------------------------------------------------------

const GRADLE_PLUGIN = /\bid\s*\(?["']([\w.-]*google-services|com\.google\.firebase\.crashlytics)["']\)?/g;
const GRADLE_DEPENDENCY = /["'](?:com\.google\.firebase:)?(firebase-(?:database|firestore|storage|auth|analytics|crashlytics|messaging|perf))[:"']/g;

// Gradle dependency/plugin coordinates are always string literals, unlike
// Java/Kotlin executable calls — masking string *contents* (executableMask)
// would blank out exactly the text this scanner needs to match. Only
// comments are masked here; string literals are left intact.
const COMMENT_ONLY = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
function maskCommentsOnly(source: string): string {
  return source.replace(COMMENT_ONLY, (match) => match.replace(/[^\n]/g, " "));
}

const SERVICE_BY_ARTIFACT: Record<string, FirebaseServiceUseEvidence["service"]> = {
  "firebase-database": "database",
  "firebase-firestore": "firestore",
  "firebase-storage": "storage",
  "firebase-auth": "auth",
  "firebase-analytics": "analytics",
  "firebase-crashlytics": "crashlytics",
  "firebase-messaging": "messaging",
  "firebase-perf": "performance",
};

const SOURCE_USAGE: Array<[RegExp, FirebaseServiceUseEvidence["service"]]> = [
  [/\bFirebaseDatabase\b/, "database"],
  [/\bFirebaseFirestore\b/, "firestore"],
  [/\bFirebaseStorage\b/, "storage"],
  [/\bFirebaseAuth\b/, "auth"],
  [/\bFirebaseAnalytics\b/, "analytics"],
  [/\bFirebaseCrashlytics\b/, "crashlytics"],
  [/\bFirebaseMessaging(?:Service)?\b/, "messaging"],
  [/\bFirebasePerformance\b/, "performance"],
];

export function collectGradleServiceEvidence(file: FirebaseArtifactFile): FirebaseServiceUseEvidence[] {
  const evidence: FirebaseServiceUseEvidence[] = [];
  const mask = maskCommentsOnly(file.content);

  for (const match of mask.matchAll(GRADLE_PLUGIN)) {
    const offset = match.index ?? 0;
    evidence.push({
      service: match[1].includes("crashlytics") ? "crashlytics" : "database",
      source: "gradle-plugin",
      detail: match[1],
      relativePath: file.relativePath,
      modulePath: file.modulePath,
      line: lineForOffset(file.content, offset),
    });
  }

  for (const match of mask.matchAll(GRADLE_DEPENDENCY)) {
    const offset = match.index ?? 0;
    const service = SERVICE_BY_ARTIFACT[match[1]];
    if (!service) continue;
    evidence.push({
      service,
      source: "gradle-dependency",
      detail: match[1],
      relativePath: file.relativePath,
      modulePath: file.modulePath,
      line: lineForOffset(file.content, offset),
    });
  }

  return evidence;
}

export function collectSourceServiceEvidence(file: FirebaseArtifactFile): FirebaseServiceUseEvidence[] {
  const evidence: FirebaseServiceUseEvidence[] = [];
  const mask = executableMask(file.content);
  for (const [pattern, service] of SOURCE_USAGE) {
    const re = new RegExp(pattern.source, "g");
    for (const match of mask.matchAll(re)) {
      const offset = match.index ?? 0;
      evidence.push({
        service,
        source: /^import\b/.test(mask.slice(Math.max(0, offset - 8), offset)) ? "source-import" : "source-usage",
        detail: match[0],
        relativePath: file.relativePath,
        modulePath: file.modulePath,
        line: lineForOffset(file.content, offset),
      });
    }
  }
  return evidence;
}

const COLLECTION_SETTER = /\b(setAnalyticsCollectionEnabled|setCrashlyticsCollectionEnabled|setAutoInitEnabled)\s*\(([^;\n]*?)\)/gd;
type IndexedMatch = RegExpMatchArray & { indices?: Array<[number, number] | undefined> };
function realGroup(content: string, match: IndexedMatch, group: number): string | undefined {
  const span = match.indices?.[group];
  return span ? content.slice(span[0], span[1]) : match[group];
}

const SETTER_SERVICE: Record<string, CollectionSetterEvidence["service"]> = {
  setAnalyticsCollectionEnabled: "analytics",
  setCrashlyticsCollectionEnabled: "crashlytics",
  setAutoInitEnabled: "messaging",
};

function stateOf(argument: string | undefined): "true" | "false" | "dynamic" {
  if (argument === undefined) return "dynamic";
  const classification = classifyDirectExpression(argument);
  if (classification.kind === "boolean-literal") return argument.trim() === "true" ? "true" : "false";
  return "dynamic";
}

export function collectCollectionSetterEvidence(file: FirebaseArtifactFile): CollectionSetterEvidence[] {
  const mask = executableMask(file.content);
  const evidence: CollectionSetterEvidence[] = [];
  for (const match of mask.matchAll(COLLECTION_SETTER) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(file.content, match, 2) ?? "");
    evidence.push({
      service: SETTER_SERVICE[match[1]],
      state: stateOf(args[0]),
      relativePath: file.relativePath,
      modulePath: file.modulePath,
      line: lineForOffset(file.content, offset),
    });
  }
  return evidence;
}

const META_DATA_TAG = /<meta-data\b[^>]*\/?>(?:\s*<\/meta-data>)?/g;
const NAME_ATTR = /android:name\s*=\s*"([^"]*)"/;
const VALUE_ATTR = /android:value\s*=\s*"([^"]*)"/;
const COLLECTION_META_NAMES = new Set([
  "firebase_analytics_collection_enabled",
  "firebase_crashlytics_collection_enabled",
  "firebase_messaging_auto_init_enabled",
  "firebase_performance_collection_enabled",
]);

export function collectManifestCollectionMetadata(file: FirebaseArtifactFile): ManifestCollectionMetadata[] {
  const evidence: ManifestCollectionMetadata[] = [];
  for (const match of file.content.matchAll(META_DATA_TAG)) {
    const tag = match[0];
    const name = NAME_ATTR.exec(tag)?.[1];
    if (!name || !COLLECTION_META_NAMES.has(name)) continue;
    const rawValue = VALUE_ATTR.exec(tag)?.[1];
    const state: ManifestCollectionMetadata["state"] = rawValue === "true" ? "true" : rawValue === "false" ? "false" : "dynamic";
    evidence.push({
      name,
      rawValue: rawValue ?? "(missing)",
      state,
      relativePath: file.relativePath,
      line: lineForOffset(file.content, match.index ?? 0),
    });
  }
  return evidence;
}

const LOG_EVENT_CALL = /\b(?:FirebaseAnalytics|analytics)\.getInstance\([^)]*\)\.logEvent\s*\(([^;\n]*?)\)|\blogEvent\s*\(([^;\n]*?)\)/gd;
const BUNDLE_PUT = /([A-Za-z_][\w.]*)\.(putString|putLong|putDouble|putBoolean)\s*\(([^;\n]*?)\)/gd;

export function collectAnalyticsEventEvidence(file: FirebaseArtifactFile): AnalyticsEventEvidence[] {
  const mask = executableMask(file.content);
  const scopes = methodScopes(mask);
  const evidence: AnalyticsEventEvidence[] = [];

  const bundlePuts: { key?: string; value?: string; offset: number; scopeId?: number }[] = [];
  for (const match of mask.matchAll(BUNDLE_PUT) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(file.content, match, 3) ?? "");
    bundlePuts.push({ key: args[0], value: args[1], offset, scopeId: scopeAt(scopes, offset)?.id });
  }

  for (const match of mask.matchAll(LOG_EVENT_CALL) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const rawArgs = realGroup(file.content, match, 1) ?? realGroup(file.content, match, 2) ?? "";
    const args = splitTopLevelArguments(rawArgs);
    const scopeId = scopeAt(scopes, offset)?.id;

    let sensitiveKey: string | undefined;
    let sensitiveValue: string | undefined;
    let isDirectLiteral = false;
    for (const put of bundlePuts.filter((p) => p.scopeId === scopeId)) {
      const literal = put.key !== undefined && classifyDirectExpression(put.key).kind === "string-literal" ? classifyDirectExpression(put.key).literalValue : undefined;
      const classification = literal !== undefined ? classifySensitiveIdentifier(literal) : undefined;
      if (classification) {
        sensitiveKey = put.key;
        sensitiveValue = put.value;
        isDirectLiteral = put.value !== undefined && classifyDirectExpression(put.value).kind === "string-literal";
        break;
      }
    }

    evidence.push({
      eventNameExpression: args[0],
      sensitiveParameterKey: sensitiveKey,
      sensitiveParameterValueExpression: sensitiveValue,
      isDirectLiteralValue: isDirectLiteral,
      relativePath: file.relativePath,
      modulePath: file.modulePath,
      line: lineForOffset(file.content, offset),
    });
  }

  return evidence;
}
