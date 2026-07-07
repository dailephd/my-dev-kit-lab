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

export const SECURITY_PROFILE_IDS = ["node-cli-package", "local-tool", "npm-package"] as const;
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
};

export function parseSecurityValidateArgs(argv: string[]): RawSecurityValidateArgs {
  const result: RawSecurityValidateArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const key = FLAGS_WITH_VALUE[arg];
    if (!key) continue;
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
  };
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
