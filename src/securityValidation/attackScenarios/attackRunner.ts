import type { AttackScenario, AttackScenarioContext } from "./attackScenario.js";
import { CHECK_ID_CATEGORY } from "./attackScenario.js";
import type { AttackResult } from "./attackResult.js";
import type { SecurityCheckId, SecurityProfileId } from "../validate/cliOptions.js";
import type { SecurityValidationTarget } from "../validate/resolveTarget.js";
import type { SecurityValidationConfig } from "../config.js";
import type { TargetSnapshot } from "./targetSnapshot.js";
import { TARGET_SANDBOX_SCENARIO } from "./scenarios/targetSandboxScenario.js";
import { PACKAGE_BOUNDARY_SCENARIO } from "./scenarios/packageBoundaryScenario.js";
import { OUTPUT_BOUNDARY_SCENARIO } from "./scenarios/outputBoundaryScenario.js";
import { PATH_TRAVERSAL_SCENARIO } from "./scenarios/pathTraversalScenario.js";
import { CONFIG_INJECTION_SCENARIO } from "./scenarios/configInjectionScenario.js";
import { SUBPROCESS_INJECTION_SCENARIO } from "./scenarios/subprocessInjectionScenario.js";
import { SECRET_LEAKAGE_SCENARIO } from "./scenarios/secretLeakageScenario.js";
import { REPORT_POISONING_SCENARIO } from "./scenarios/reportPoisoningScenario.js";
import { NETWORK_ASSUMPTION_SCENARIO } from "./scenarios/networkAssumptionScenario.js";
import { registerScenarioPayloadGroups } from "./payloadCorpus.js";

registerScenarioPayloadGroups(OUTPUT_BOUNDARY_SCENARIO.id, ["output-boundary"]);
registerScenarioPayloadGroups(PATH_TRAVERSAL_SCENARIO.id, ["path-traversal"]);
registerScenarioPayloadGroups(CONFIG_INJECTION_SCENARIO.id, ["malformed-config", "report-poisoning"]);
registerScenarioPayloadGroups(SUBPROCESS_INJECTION_SCENARIO.id, ["subprocess-injection"]);
registerScenarioPayloadGroups(REPORT_POISONING_SCENARIO.id, ["report-poisoning"]);

// ---------------------------------------------------------------------------
// v0.2.2 Batch 2/3/4 — attack scenario runner.
//
// SCENARIO_REGISTRY was empty in Batch 2. Batch 3 registered the first
// concrete scenarios (boundary: target sandbox, package boundary, output
// boundary, path traversal, config injection; subprocess: subprocess
// injection). Batch 4 adds secret leakage (secrets), report poisoning
// (boundary — report-rendering safety is a boundary-of-trust concern), and
// network/local-first assumption (network). All 9 --checks ids now have at
// least one registered scenario.
// ---------------------------------------------------------------------------

export const SCENARIO_REGISTRY: AttackScenario[] = [
  TARGET_SANDBOX_SCENARIO,
  PACKAGE_BOUNDARY_SCENARIO,
  OUTPUT_BOUNDARY_SCENARIO,
  PATH_TRAVERSAL_SCENARIO,
  CONFIG_INJECTION_SCENARIO,
  REPORT_POISONING_SCENARIO,
  SUBPROCESS_INJECTION_SCENARIO,
  SECRET_LEAKAGE_SCENARIO,
  NETWORK_ASSUMPTION_SCENARIO,
];

const DEFAULT_SCENARIO_TIMEOUT_MS = 30_000;

// Selects scenarios whose checkId is in selectedChecks and whose
// applicableProfiles either is empty (applies to all profiles) or includes
// the given profile. Preserves registry order (deterministic).
export function filterScenarios(
  scenarios: readonly AttackScenario[],
  selectedChecks: readonly SecurityCheckId[],
  profile: SecurityProfileId
): AttackScenario[] {
  const checkSet = new Set(selectedChecks);
  return scenarios.filter(
    (s) => checkSet.has(s.checkId) && (s.applicableProfiles.length === 0 || s.applicableProfiles.includes(profile))
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, scenarioId: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Scenario '${scenarioId}' exceeded its ${timeoutMs}ms execution budget.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Runs a single scenario, converting a skip condition, thrown error, or
// timeout into a structured AttackResult rather than letting exceptions
// propagate to the caller.
export async function runScenario(scenario: AttackScenario, ctx: AttackScenarioContext): Promise<AttackResult> {
  const baseFields = {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    checkId: scenario.checkId,
    profileId: ctx.profile,
  };

  try {
    const skipReason = scenario.skipCondition?.(ctx);
    if (skipReason) {
      return {
        ...baseFields,
        status: "skipped",
        severity: "skipped",
        confidence: "low",
        evidence: [],
        category: CHECK_ID_CATEGORY[scenario.checkId],
        skippedReason: skipReason,
      };
    }

    const outcome = await withTimeout(
      scenario.run(ctx),
      scenario.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS,
      scenario.id
    );

    return {
      ...baseFields,
      status: outcome.status,
      severity: outcome.severity ?? scenario.severityBaseline,
      confidence: outcome.confidence,
      evidence: outcome.evidence,
      category: outcome.category ?? CHECK_ID_CATEGORY[scenario.checkId],
      recommendation: outcome.recommendation,
      verdictImpact: scenario.verdictImpact,
    };
  } catch (err) {
    return {
      ...baseFields,
      status: "blocked",
      severity: scenario.severityBaseline,
      confidence: "low",
      evidence: [],
      category: CHECK_ID_CATEGORY[scenario.checkId],
      errorSummary: err instanceof Error ? err.message : String(err),
    };
  }
}

function unavailableResult(checkId: SecurityCheckId, profile: SecurityProfileId): AttackResult {
  return {
    scenarioId: `${checkId}-no-scenarios-registered`,
    scenarioTitle: `No attack scenarios registered for '${checkId}'`,
    checkId,
    profileId: profile,
    status: "skipped",
    severity: "skipped",
    confidence: "low",
    evidence: [],
    category: CHECK_ID_CATEGORY[checkId],
    skippedReason:
      `No attack scenarios are registered yet for check group '${checkId}'. ` +
      `The attack-scenario framework is present (v0.2.2 Batch 2); concrete scenarios are planned for a later v0.2.2 batch. ` +
      `This must not be treated as evidence that '${checkId}' is safe.`,
  };
}

export type RunAttackScenariosOptions = {
  // Defaults to SCENARIO_REGISTRY; tests inject a custom list to exercise
  // filtering/ordering/error-handling without depending on the (empty)
  // production registry.
  scenarios?: readonly AttackScenario[];
  selectedChecks: readonly SecurityCheckId[];
  profile: SecurityProfileId;
  toolRoot: string;
  target: SecurityValidationTarget;
  config: SecurityValidationConfig;
  targetSnapshotBefore?: TargetSnapshot;
};

// Runs all scenarios matching selectedChecks/profile, then appends one
// explicit "unavailable" placeholder result for every selected check that
// matched zero scenarios. Safe when the scenario list is empty. Result order
// is deterministic: matched scenarios in registry order, then unavailable
// placeholders in selectedChecks order.
export async function runAttackScenarios(options: RunAttackScenariosOptions): Promise<AttackResult[]> {
  const scenarios = options.scenarios ?? SCENARIO_REGISTRY;
  const matched = filterScenarios(scenarios, options.selectedChecks, options.profile);

  const ctx: AttackScenarioContext = {
    toolRoot: options.toolRoot,
    target: options.target,
    profile: options.profile,
    config: options.config,
    targetSnapshotBefore: options.targetSnapshotBefore,
  };

  const results: AttackResult[] = [];
  for (const scenario of matched) {
    results.push(await runScenario(scenario, ctx));
  }

  const matchedCheckIds = new Set(matched.map((s) => s.checkId));
  for (const checkId of options.selectedChecks) {
    if (!matchedCheckIds.has(checkId)) {
      results.push(unavailableResult(checkId, options.profile));
    }
  }

  return results;
}
