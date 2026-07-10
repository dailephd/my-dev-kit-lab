import type { SecurityFinding } from "../../../securityValidation/types.js";
import type { AndroidDetectionResult } from "../detection.js";
import type { AndroidIntentFilter, AndroidManifestComponent, AndroidManifestComponentKind, AndroidManifestModel } from "../manifest/types.js";
import type { AndroidManifestParseEntry } from "../manifest/parseAndroidManifest.js";
import type { AndroidCheckResult } from "../validation/checkResult.js";
import { makeAndroidFinding } from "./androidFinding.js";
import { buildAndroidManifestCheckResult } from "./checkResultBuilder.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 3 — initial intent-filter audit.
//
// Distinct lens from the exported-component audit (agents.txt Batch 3
// section 7.15): this audit does not repeat "is this exported and
// unprotected" — it looks at the intent-filter *contents* themselves:
// duplicate/malformed filter data, and custom (non-platform) actions on a
// component that is reachable (explicitly exported, or unspecified-exported
// with a filter). A standard MAIN/LAUNCHER filter is never flagged — that is
// the required negative control (ANDROID-B3-22).
// ---------------------------------------------------------------------------

const STANDARD_ACTION_PREFIX = "android.intent.action.";
const STANDARD_CATEGORY_PREFIX = "android.intent.category.";

function isReachable(component: AndroidManifestComponent): boolean {
  return component.exported === true || (component.exported === undefined && component.exportedRaw === undefined && component.intentFilters.length > 0);
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function auditFilter(
  entry: AndroidManifestParseEntry,
  kind: AndroidManifestComponentKind,
  component: AndroidManifestComponent,
  filter: AndroidIntentFilter,
  findings: SecurityFinding[]
): void {
  const identity = component.name || "(unnamed component)";
  const actions = filter.actions ?? [];
  const categories = filter.categories ?? [];
  const dataElements = filter.dataElements ?? filter.filterData;

  if (actions.length === 0 && dataElements.length === 0) {
    findings.push(
      makeAndroidFinding({
        ruleId: "android-intent-filter-empty-or-malformed",
        title: `Empty or malformed <intent-filter> on ${kind} "${identity}"`,
        severity: "informational",
        confidence: "medium",
        description: "This <intent-filter> declares no actions and no data elements, so it cannot match any implicit intent.",
        manifestPath: entry.manifestPath,
        identity,
        location: filter.location,
        evidenceDetails: [`kind=${kind}`],
      })
    );
    return;
  }

  if (hasDuplicates(actions) || hasDuplicates(categories)) {
    findings.push(
      makeAndroidFinding({
        ruleId: "android-intent-filter-duplicate-entries",
        title: `Duplicate action/category entries in an <intent-filter> on ${kind} "${identity}"`,
        severity: "informational",
        confidence: "high",
        description: "This <intent-filter> declares the same <action> or <category> more than once, which has no additional effect and may indicate a copy/paste mistake.",
        manifestPath: entry.manifestPath,
        identity,
        location: filter.location,
        evidenceDetails: [`actions=${actions.join(",")}`, `categories=${categories.join(",")}`],
      })
    );
  }

  const isStandardLauncherFilter =
    actions.length === 1 &&
    actions[0] === "android.intent.action.MAIN" &&
    categories.every((c) => c === "android.intent.category.LAUNCHER" || c === "android.intent.category.DEFAULT");
  if (isStandardLauncherFilter) {
    // Negative control: a standard launcher entry point is expected and
    // must not itself be reported as a finding (ANDROID-B3-22).
    return;
  }

  const customActions = actions.filter((action) => !action.startsWith(STANDARD_ACTION_PREFIX));
  if (customActions.length > 0 && isReachable(component)) {
    findings.push(
      makeAndroidFinding({
        ruleId: "android-intent-filter-custom-action-reachable",
        title: `Custom action on a potentially reachable ${kind} "${identity}"`,
        severity: "minor",
        confidence: component.exported === true ? "high" : "medium",
        description: `This <intent-filter> declares a custom (non-platform) action (${customActions.join(", ")}) on a component whose exported state is ${
          component.exported === true ? "explicitly true" : "unspecified with an intent filter present"
        }. Custom actions on reachable components broaden the app's externally triggerable surface and are worth reviewing, though the action name alone does not prove exploitability.`,
        manifestPath: entry.manifestPath,
        identity,
        location: filter.location,
        evidenceDetails: [`customActions=${customActions.join(",")}`, `exported=${component.exported ?? "unspecified"}`, `hasComponentPermission=${Boolean(component.permission)}`],
        recommendation: "Confirm this custom action needs to be externally reachable, and add permission protection if not.",
      })
    );
  }

  const unrecognizedCategories = categories.filter((c) => !c.startsWith(STANDARD_CATEGORY_PREFIX));
  if (unrecognizedCategories.length > 0) {
    findings.push(
      makeAndroidFinding({
        ruleId: "android-intent-filter-non-standard-category",
        title: `Non-standard intent-filter category on ${kind} "${identity}"`,
        severity: "informational",
        confidence: "medium",
        description: `This <intent-filter> declares a category outside the standard android.intent.category.* namespace (${unrecognizedCategories.join(", ")}).`,
        manifestPath: entry.manifestPath,
        identity,
        location: filter.location,
        evidenceDetails: [`categories=${unrecognizedCategories.join(",")}`],
      })
    );
  }
}

function componentGroups(manifest: AndroidManifestModel): { kind: AndroidManifestComponentKind; components: AndroidManifestComponent[] }[] {
  return [
    { kind: "activity" as const, components: manifest.activities },
    { kind: "activity-alias" as const, components: manifest.activityAliases ?? [] },
    { kind: "service" as const, components: manifest.services },
    { kind: "receiver" as const, components: manifest.receivers },
  ];
}

export function auditAndroidIntentFilters(detection: AndroidDetectionResult, manifests: AndroidManifestParseEntry[]): AndroidCheckResult {
  const findings: SecurityFinding[] = [];
  const evidence: string[] = [];
  const warnings: string[] = [];

  for (const entry of manifests) {
    let filterCount = 0;
    for (const group of componentGroups(entry.manifest)) {
      for (const component of group.components) {
        for (const filter of component.intentFilters) {
          filterCount += 1;
          auditFilter(entry, group.kind, component, filter, findings);
        }
      }
    }
    if (filterCount > 0) {
      evidence.push(`${entry.manifestPath}: ${filterCount} intent-filter(s) inspected`);
    }
  }

  return buildAndroidManifestCheckResult({
    id: "android-intent-filters-audit",
    category: "android-intent-filters",
    title: "Android intent-filter audit",
    detection,
    manifests,
    findings,
    evidence,
    warnings,
  });
}
