import path from "node:path";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 1 — security:validate command/config surface.
//
// This module parses and normalizes --checks, --profile, --format, --fail-on,
// and --out. It intentionally does not implement attack scenarios, profile
// behavior, or verdict-policy changes — those are later v0.2.2 batches. This
// batch only builds a stable, extensible config surface.
// ---------------------------------------------------------------------------

export const SECURITY_CHECK_IDS = [
  "deps",
  "package",
  "static",
  "cli-adversarial",
  "fuzz",
  "boundary",
  "subprocess",
  "secrets",
  "network",
] as const;
export type SecurityCheckId = (typeof SECURITY_CHECK_IDS)[number];

// Checks with real behavior wired in Batch 1.
export const IMPLEMENTED_SECURITY_CHECK_IDS: readonly SecurityCheckId[] = [
  "deps",
  "package",
  "static",
  "cli-adversarial",
  "fuzz",
];

// Checks accepted as valid --checks values but not yet implemented. Selecting
// one of these must never be reported as passed.
export const PLANNED_SECURITY_CHECK_IDS = [
  "boundary",
  "subprocess",
  "secrets",
  "network",
] as const satisfies readonly SecurityCheckId[];

export const DEFAULT_SECURITY_CHECKS: readonly SecurityCheckId[] = IMPLEMENTED_SECURITY_CHECK_IDS;

// v0.4.0 Batch 5 — "android" added additively. Unlike the other three
// profiles (which select --checks defaults for the classic
// check-group/attack-scenario pipeline), "android" routes to an entirely
// separate orchestrator (src/mobile/android/validate/validateAndroidTarget.ts)
// because the Android check/finding/status vocabulary established in
// Batches 1-4 does not fit SecurityCheckId/SecurityCheckResult — seeagents.txt
// Batch 5 section 6.1-6.2. The CLI still exposes it through the same
// --profile flag on the same security:validate command (no second CLI).
export const SECURITY_PROFILE_IDS = ["node-cli-package", "local-tool", "npm-package", "android"] as const;
export type SecurityProfileId = (typeof SECURITY_PROFILE_IDS)[number];
export const DEFAULT_SECURITY_PROFILE: SecurityProfileId = "node-cli-package";

export const SECURITY_OUTPUT_FORMATS = ["text", "json"] as const;
export type SecurityOutputFormat = (typeof SECURITY_OUTPUT_FORMATS)[number];
export const DEFAULT_SECURITY_OUTPUT_FORMATS: readonly SecurityOutputFormat[] = ["text", "json"];

// Distinct vocabulary from SecuritySeverity (blocker/major/minor/informational/skipped).
// Batch 1 only carries this value through config; verdict-policy integration is later.
export const SECURITY_FAIL_ON_THRESHOLDS = ["blocker", "high", "medium", "low"] as const;
export type SecurityFailOnThreshold = (typeof SECURITY_FAIL_ON_THRESHOLDS)[number];
export const DEFAULT_SECURITY_FAIL_ON_THRESHOLD: SecurityFailOnThreshold = "blocker";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export type RawSecurityValidateArgs = {
  target?: string;
  out?: string;
  reportPrefix?: string;
  checks?: string;
  profile?: string;
  format?: string;
  failOn?: string;
  androidGradleOperations?: string;
  androidExternalTools?: string;
  androidExternalNetwork?: string;
};

const FLAGS_WITH_VALUE: Record<string, keyof RawSecurityValidateArgs> = {
  "--target": "target",
  "-t": "target",
  "--out": "out",
  "--report-prefix": "reportPrefix",
  "--checks": "checks",
  "--profile": "profile",
  "--format": "format",
  "--fail-on": "failOn",
  "--android-gradle-operations": "androidGradleOperations",
  "--android-external-tools": "androidExternalTools",
  "--android-external-network": "androidExternalNetwork",
};

// v0.4.0 Batch 5 — the exact allowlisted optional Gradle operation ids
// (agents.txt Batch 5 section 7.3). Deliberately re-declared here rather than
// imported from src/mobile/android/gradle/validate/operations.ts: this keeps
// the foundational CLI-parsing module free of a new securityValidation ->
// mobile dependency direction for five short string literals. Both lists
// must stay in sync; a regression test in tests/security/ asserts they do.
export const ANDROID_GRADLE_OPERATION_IDS = ["wrapper-version", "tasks", "assemble-debug", "unit-test-debug", "lint-debug"] as const;
export type AndroidGradleOperationCliId = (typeof ANDROID_GRADLE_OPERATION_IDS)[number];

// v0.4.1 Batch 8 — the exact allowlisted external-tool ids (agents.txt Batch
// 8 section 10.1). Deliberately re-declared here for the same reason
// ANDROID_GRADLE_OPERATION_IDS is re-declared above: this module stays free
// of a securityValidation -> mobile import for four short string literals.
// Both lists must stay in sync; a regression test asserts they do.
export const ANDROID_EXTERNAL_TOOL_CLI_IDS = ["semgrep", "osv", "android-lint", "dependency-check"] as const;
export type AndroidExternalToolCliId = (typeof ANDROID_EXTERNAL_TOOL_CLI_IDS)[number];

export const ANDROID_EXTERNAL_NETWORK_POLICIES = ["deny", "allow-requested"] as const;
export type AndroidExternalNetworkCliPolicy = (typeof ANDROID_EXTERNAL_NETWORK_POLICIES)[number];
export const DEFAULT_ANDROID_EXTERNAL_NETWORK_POLICY: AndroidExternalNetworkCliPolicy = "deny";

export function parseSecurityValidateArgs(argv: string[]): RawSecurityValidateArgs {
  const result: RawSecurityValidateArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const key = FLAGS_WITH_VALUE[arg];
    if (!key) {
      // Keep the conventional argument separator harmless while rejecting
      // misspelled or unsupported top-level options before any validation
      // configuration, target resolution, or report work begins.
      if (arg === "--") continue;
      if (arg.startsWith("-")) {
        throw new Error(`Unknown option: ${arg}.`);
      }
      continue;
    }
    if (i + 1 >= argv.length) {
      throw new Error(`Missing value for ${arg}. Expected a value after ${arg}.`);
    }
    result[key] = argv[++i];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Normalized config
// ---------------------------------------------------------------------------

export type NormalizedSecurityValidateConfig = {
  target?: string;
  out: string;
  outWasDefault: boolean;
  reportPrefix?: string;
  checks: SecurityCheckId[];
  checksWereDefault: boolean;
  implementedChecks: SecurityCheckId[];
  plannedChecksRequested: SecurityCheckId[];
  profile: SecurityProfileId;
  profileWasDefault: boolean;
  formats: SecurityOutputFormat[];
  formatsWereDefault: boolean;
  failOnThreshold: SecurityFailOnThreshold;
  failOnWasDefault: boolean;
  androidGradleOperationIds: AndroidGradleOperationCliId[];
  androidExternalToolIds: AndroidExternalToolCliId[];
  androidExternalNetworkPolicy: AndroidExternalNetworkCliPolicy;
};

export function normalizeSecurityValidateConfig(
  raw: RawSecurityValidateArgs,
  toolRoot: string
): NormalizedSecurityValidateConfig {
  const checks = parseChecksOption(raw.checks);
  const profile = parseProfileOption(raw.profile);
  const formats = parseFormatOption(raw.format);
  const failOn = parseFailOnOption(raw.failOn);
  const out = raw.out !== undefined ? resolveOutDir(raw.out) : path.join(toolRoot, "reports", "security");
  const androidGradleOperationIds = parseAndroidGradleOperationsOption(raw.androidGradleOperations, profile.value);
  const androidExternalToolIds = parseAndroidExternalToolsOption(raw.androidExternalTools, profile.value);
  const androidExternalNetworkPolicy = parseAndroidExternalNetworkOption(raw.androidExternalNetwork, profile.value);

  return {
    target: raw.target,
    out,
    outWasDefault: raw.out === undefined,
    reportPrefix: raw.reportPrefix,
    checks: checks.value,
    checksWereDefault: checks.wasDefault,
    implementedChecks: checks.value.filter((c) => IMPLEMENTED_SECURITY_CHECK_IDS.includes(c)),
    plannedChecksRequested: checks.value.filter((c) =>
      (PLANNED_SECURITY_CHECK_IDS as readonly SecurityCheckId[]).includes(c)
    ),
    profile: profile.value,
    profileWasDefault: profile.wasDefault,
    formats: formats.value,
    formatsWereDefault: formats.wasDefault,
    failOnThreshold: failOn.value,
    failOnWasDefault: failOn.wasDefault,
    androidGradleOperationIds,
    androidExternalToolIds,
    androidExternalNetworkPolicy,
  };
}

// Parses --android-gradle-operations. Absent by default (empty array — zero
// Gradle execution). Rejects unknown operation ids and non-"android"-profile
// usage before any validation work begins (agents.txt Batch 5 section 7.3).
function parseAndroidGradleOperationsOption(raw: string | undefined, profile: SecurityProfileId): AndroidGradleOperationCliId[] {
  if (raw === undefined) return [];

  if (profile !== "android") {
    throw new Error(`--android-gradle-operations requires --profile android (got --profile ${profile}).`);
  }

  const parts = splitAndNormalizeList(raw, "--android-gradle-operations");
  const invalid = parts.filter((p) => !(ANDROID_GRADLE_OPERATION_IDS as readonly string[]).includes(p));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid --android-gradle-operations value(s): ${invalid.join(", ")}. Valid values are: ${ANDROID_GRADLE_OPERATION_IDS.join(", ")}.`
    );
  }
  const unique = new Set(parts as AndroidGradleOperationCliId[]);
  return ANDROID_GRADLE_OPERATION_IDS.filter((id) => unique.has(id));
}

// Parses --android-external-tools. Absent by default (empty array — zero
// external-tool execution). Rejects unknown tool ids and non-"android"-
// profile usage before any validation work begins (agents.txt Batch 8
// section 10.1) — same shape as parseAndroidGradleOperationsOption.
function parseAndroidExternalToolsOption(raw: string | undefined, profile: SecurityProfileId): AndroidExternalToolCliId[] {
  if (raw === undefined) return [];

  if (profile !== "android") {
    throw new Error(`--android-external-tools requires --profile android (got --profile ${profile}).`);
  }

  const parts = splitAndNormalizeList(raw, "--android-external-tools");
  const invalid = parts.filter((p) => !(ANDROID_EXTERNAL_TOOL_CLI_IDS as readonly string[]).includes(p));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid --android-external-tools value(s): ${invalid.join(", ")}. Valid values are: ${ANDROID_EXTERNAL_TOOL_CLI_IDS.join(", ")}.`
    );
  }
  const unique = new Set(parts as AndroidExternalToolCliId[]);
  return ANDROID_EXTERNAL_TOOL_CLI_IDS.filter((id) => unique.has(id));
}

// Parses --android-external-network. Defaults to "deny" (agents.txt Batch 8
// section 10.2) — network is never authorized unless explicitly requested.
function parseAndroidExternalNetworkOption(raw: string | undefined, profile: SecurityProfileId): AndroidExternalNetworkCliPolicy {
  if (raw === undefined) return DEFAULT_ANDROID_EXTERNAL_NETWORK_POLICY;

  if (profile !== "android") {
    throw new Error(`--android-external-network requires --profile android (got --profile ${profile}).`);
  }

  const value = raw.trim();
  if (!(ANDROID_EXTERNAL_NETWORK_POLICIES as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid --android-external-network value: "${raw}". Valid values are: ${ANDROID_EXTERNAL_NETWORK_POLICIES.join(", ")}.`
    );
  }
  return value as AndroidExternalNetworkCliPolicy;
}

// ---------------------------------------------------------------------------
// v0.2.2 Batch 5 — profile-aware default checks
// ---------------------------------------------------------------------------

// Applies a profile's declared default check ids when the user provided
// --profile but omitted --checks. Deliberately takes the profile's
// defaultCheckIds as a plain parameter rather than importing
// attackScenarios/attackProfile.ts here — that module already imports this
// one (SecurityProfileId/SECURITY_PROFILE_IDS), so importing it back would
// create a circular import. Callers (scripts/security/validate.ts) resolve
// the profile definition via resolveAttackProfile() and pass its
// defaultCheckIds in.
//
// No-op (returns config unchanged) unless BOTH:
//   - the user did not pass --checks (checksWereDefault), AND
//   - the user did pass --profile (profileWasDefault === false)
// This guarantees the true no-flag case (no --profile, no --checks) and any
// explicit --checks case are always unaffected.
export function applyProfileDefaultChecksIfApplicable(
  config: NormalizedSecurityValidateConfig,
  profileDefaultCheckIds: readonly SecurityCheckId[]
): NormalizedSecurityValidateConfig {
  if (!config.checksWereDefault || config.profileWasDefault) {
    return config;
  }
  const uniqueRequested = new Set(profileDefaultCheckIds);
  const ordered = SECURITY_CHECK_IDS.filter((id) => uniqueRequested.has(id));
  return {
    ...config,
    checks: ordered,
    implementedChecks: ordered.filter((c) => IMPLEMENTED_SECURITY_CHECK_IDS.includes(c)),
    plannedChecksRequested: ordered.filter((c) =>
      (PLANNED_SECURITY_CHECK_IDS as readonly SecurityCheckId[]).includes(c)
    ),
  };
}

function splitAndNormalizeList(raw: string, flagName: string): string[] {
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.some((p) => p.length === 0)) {
    throw new Error(`Invalid ${flagName} value: empty entries are not allowed. Got "${raw}".`);
  }
  return parts;
}

function parseChecksOption(raw?: string): { value: SecurityCheckId[]; wasDefault: boolean } {
  if (raw === undefined) {
    return { value: [...DEFAULT_SECURITY_CHECKS], wasDefault: true };
  }
  const parts = splitAndNormalizeList(raw, "--checks");
  const invalid = parts.filter((p) => !(SECURITY_CHECK_IDS as readonly string[]).includes(p));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid --checks value(s): ${invalid.join(", ")}. Valid values are: ${SECURITY_CHECK_IDS.join(", ")}.`
    );
  }
  const unique = new Set(parts as SecurityCheckId[]);
  const ordered = SECURITY_CHECK_IDS.filter((id) => unique.has(id));
  return { value: ordered, wasDefault: false };
}

function parseProfileOption(raw?: string): { value: SecurityProfileId; wasDefault: boolean } {
  if (raw === undefined) {
    return { value: DEFAULT_SECURITY_PROFILE, wasDefault: true };
  }
  const value = raw.trim();
  if (!(SECURITY_PROFILE_IDS as readonly string[]).includes(value)) {
    throw new Error(`Invalid --profile value: "${raw}". Valid values are: ${SECURITY_PROFILE_IDS.join(", ")}.`);
  }
  return { value: value as SecurityProfileId, wasDefault: false };
}

function parseFormatOption(raw?: string): { value: SecurityOutputFormat[]; wasDefault: boolean } {
  if (raw === undefined) {
    return { value: [...DEFAULT_SECURITY_OUTPUT_FORMATS], wasDefault: true };
  }
  const parts = splitAndNormalizeList(raw, "--format");
  const invalid = parts.filter((p) => !(SECURITY_OUTPUT_FORMATS as readonly string[]).includes(p));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid --format value(s): ${invalid.join(", ")}. Valid values are: ${SECURITY_OUTPUT_FORMATS.join(", ")}.`
    );
  }
  const unique = new Set(parts as SecurityOutputFormat[]);
  const ordered = SECURITY_OUTPUT_FORMATS.filter((id) => unique.has(id));
  return { value: ordered, wasDefault: false };
}

function parseFailOnOption(raw?: string): { value: SecurityFailOnThreshold; wasDefault: boolean } {
  if (raw === undefined) {
    return { value: DEFAULT_SECURITY_FAIL_ON_THRESHOLD, wasDefault: true };
  }
  const value = raw.trim();
  if (!(SECURITY_FAIL_ON_THRESHOLDS as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid --fail-on value: "${raw}". Valid values are: ${SECURITY_FAIL_ON_THRESHOLDS.join(", ")}.`
    );
  }
  return { value: value as SecurityFailOnThreshold, wasDefault: false };
}

function resolveOutDir(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Invalid --out value: path must not be empty.");
  }
  return path.resolve(trimmed);
}
