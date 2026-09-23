// v0.5.2 Batch 1 -- frozen warm-index real-agent campaign preset contract.
//
// This module owns preset identity, provider assignment, bundled resource paths, the frozen case
// list per preset, and the default per-agent timeout. It contains no CLI parsing, no report
// rendering, and no provider execution logic; those remain owned elsewhere.

export const WARM_INDEX_CAMPAIGN_PRESET_IDS = ["codex-full", "claude-full", "codex-timeout-isolation"] as const;

export type WarmIndexCampaignPresetId = (typeof WARM_INDEX_CAMPAIGN_PRESET_IDS)[number];

export type WarmIndexCampaignAgentId = "codex" | "claude";

export type WarmIndexCampaignPreset = {
  readonly id: WarmIndexCampaignPresetId;
  readonly agentId: WarmIndexCampaignAgentId;
  readonly casesResourcePath: string;
  readonly projectProfilesResourcePath: string;
  readonly caseIds: readonly string[];
  readonly defaultTimeoutMs: number;
};

const CASES_RESOURCE_PATH = "benchmarks/contracts/warm-index-benchmark-cases.json";
const PROJECT_PROFILES_RESOURCE_PATH = "benchmarks/contracts/benchmark-project-profiles.json";
const DEFAULT_TIMEOUT_MS = 240_000;

// Exact v0.5.1 12-case corpus, in corpus order. Frozen; do not reorder or extend in Batch 1.
const FULL_CAMPAIGN_CASE_IDS: readonly string[] = Object.freeze([
  "warm-medium-import-dedupe",
  "warm-medium-create-project-task",
  "warm-medium-complete-idempotent",
  "warm-medium-composite-filter",
  "warm-medium-project-summary",
  "warm-medium-broad-workflow-map",
  "warm-large-health-label",
  "warm-large-ts-analytics-snapshot",
  "warm-large-ts-leaderboard",
  "warm-large-python-parser-metrics",
  "warm-large-python-pipeline",
  "warm-large-broad-analytics-comparison",
]);

// Exactly the three large/mixed cases covering cross-module, localized, and broad-change.
const TIMEOUT_ISOLATION_CASE_IDS: readonly string[] = Object.freeze([
  "warm-large-health-label",
  "warm-large-ts-leaderboard",
  "warm-large-broad-analytics-comparison",
]);

const WARM_INDEX_CAMPAIGN_PRESETS: Readonly<Record<WarmIndexCampaignPresetId, WarmIndexCampaignPreset>> =
  Object.freeze({
    "codex-full": Object.freeze({
      id: "codex-full",
      agentId: "codex",
      casesResourcePath: CASES_RESOURCE_PATH,
      projectProfilesResourcePath: PROJECT_PROFILES_RESOURCE_PATH,
      caseIds: FULL_CAMPAIGN_CASE_IDS,
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    }),
    "claude-full": Object.freeze({
      id: "claude-full",
      agentId: "claude",
      casesResourcePath: CASES_RESOURCE_PATH,
      projectProfilesResourcePath: PROJECT_PROFILES_RESOURCE_PATH,
      caseIds: FULL_CAMPAIGN_CASE_IDS,
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    }),
    "codex-timeout-isolation": Object.freeze({
      id: "codex-timeout-isolation",
      agentId: "codex",
      casesResourcePath: CASES_RESOURCE_PATH,
      projectProfilesResourcePath: PROJECT_PROFILES_RESOURCE_PATH,
      caseIds: TIMEOUT_ISOLATION_CASE_IDS,
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    }),
  });

/** Fails explicitly for any value outside the exact three frozen preset IDs. */
export function parseWarmIndexCampaignPresetId(value: string): WarmIndexCampaignPresetId {
  if ((WARM_INDEX_CAMPAIGN_PRESET_IDS as readonly string[]).includes(value)) {
    return value as WarmIndexCampaignPresetId;
  }
  throw new Error(
    `Unknown warm-index campaign preset: ${value}. Supported presets: ${WARM_INDEX_CAMPAIGN_PRESET_IDS.join(", ")}.`
  );
}

export function getWarmIndexCampaignPreset(id: WarmIndexCampaignPresetId): WarmIndexCampaignPreset {
  const preset = WARM_INDEX_CAMPAIGN_PRESETS[id];
  if (!preset) {
    throw new Error(
      `Unknown warm-index campaign preset: ${id}. Supported presets: ${WARM_INDEX_CAMPAIGN_PRESET_IDS.join(", ")}.`
    );
  }
  return preset;
}

/**
 * Resolves the effective per-agent timeout for a campaign: the preset default when no override was
 * requested, or an explicit finite positive integer override.
 */
export function resolveWarmIndexCampaignTimeoutMs(
  preset: WarmIndexCampaignPreset,
  requestedTimeoutMs?: number
): number {
  if (requestedTimeoutMs === undefined) {
    return preset.defaultTimeoutMs;
  }
  if (!Number.isFinite(requestedTimeoutMs) || !Number.isInteger(requestedTimeoutMs) || requestedTimeoutMs <= 0) {
    throw new Error(`Campaign timeoutMs must be a finite positive integer; received ${requestedTimeoutMs}.`);
  }
  return requestedTimeoutMs;
}
