import type { SecurityFinding } from "../../../securityValidation/types.js";
import type { AndroidDetectionResult } from "../detection.js";
import type { AndroidManifestComponent, AndroidManifestComponentKind, AndroidManifestModel } from "../manifest/types.js";
import type { AndroidManifestParseEntry } from "../manifest/parseAndroidManifest.js";
import type { AndroidCheckResult } from "../validation/checkResult.js";
import { makeAndroidFinding } from "./androidFinding.js";
import { buildAndroidManifestCheckResult } from "./checkResultBuilder.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 3 — initial exported-component audit.
//
// Covers activities, activity-aliases, services, receivers, and providers
// (agents.txt Batch 3 section 7.14). Exported does not automatically mean
// vulnerable: an explicitly exported, permission-protected component gets a
// low-severity informational finding (protection evidence retained), while
// an equivalent unprotected component gets a higher, still-conservative
// severity. Unspecified/malformed exported values are never normalized to
// "not exported" or "exported" — see the exportedRaw handling below.
// ---------------------------------------------------------------------------

type ComponentGroup = { kind: AndroidManifestComponentKind; components: AndroidManifestComponent[] };

function componentGroups(manifest: AndroidManifestModel): ComponentGroup[] {
  return [
    { kind: "activity" as const, components: manifest.activities },
    { kind: "activity-alias" as const, components: manifest.activityAliases ?? [] },
    { kind: "service" as const, components: manifest.services },
    { kind: "receiver" as const, components: manifest.receivers },
    { kind: "provider" as const, components: manifest.providers },
  ];
}

function isProtectedNonProvider(component: AndroidManifestComponent, applicationPermission: string | undefined): boolean {
  return Boolean(component.permission) || Boolean(applicationPermission);
}

function providerProtection(component: AndroidManifestComponent): "protected" | "partial" | "unprotected" {
  if (component.permission) return "protected";
  if (component.readPermission && component.writePermission) return "protected";
  if (component.readPermission || component.writePermission) return "partial";
  return "unprotected";
}

export function auditAndroidExportedComponents(detection: AndroidDetectionResult, manifests: AndroidManifestParseEntry[]): AndroidCheckResult {
  const findings: SecurityFinding[] = [];
  const evidence: string[] = [];
  const warnings: string[] = [];

  for (const entry of manifests) {
    const applicationPermission = entry.manifest.application.permission;
    let inspectedCount = 0;

    for (const group of componentGroups(entry.manifest)) {
      for (const component of group.components) {
        inspectedCount += 1;
        const hasFilters = component.intentFilters.length > 0;
        const identity = component.name || "(unnamed component)";

        // Malformed exported value: never normalized to true or false.
        if (component.exported === undefined && component.exportedRaw !== undefined) {
          findings.push(
            makeAndroidFinding({
              ruleId: "android-component-malformed-exported",
              title: `${group.kind} "${identity}" has a malformed android:exported value`,
              severity: "minor",
              confidence: "low",
              description: `android:exported="${component.exportedRaw}" could not be statically resolved to true or false. Effective exported state is unknown and must be reviewed manually.`,
              manifestPath: entry.manifestPath,
              identity,
              location: component.location,
              evidenceDetails: [`kind=${group.kind}`, `exportedRaw=${component.exportedRaw}`],
              recommendation: "Resolve the android:exported value to an explicit true/false literal.",
            })
          );
          continue;
        }

        if (component.exported === false) {
          continue;
        }

        if (component.exported === undefined) {
          if (hasFilters) {
            findings.push(
              makeAndroidFinding({
                ruleId: "android-component-unspecified-exported-with-filter",
                title: `${group.kind} "${identity}" has an intent filter but no explicit android:exported value`,
                severity: "minor",
                confidence: "medium",
                description:
                  "This component declares an intent filter but does not set android:exported explicitly. Effective exported state depends on the target/compile SDK and manifest context, and must be reviewed rather than assumed.",
                manifestPath: entry.manifestPath,
                identity,
                location: component.location,
                evidenceDetails: [`kind=${group.kind}`, `intentFilterCount=${component.intentFilters.length}`],
                recommendation: "Set android:exported explicitly to document the intended behavior.",
              })
            );
          }
          continue;
        }

        // component.exported === true from here on.
        if (group.kind === "provider") {
          const protection = providerProtection(component);
          if (protection === "unprotected") {
            findings.push(
              makeAndroidFinding({
                ruleId: "android-provider-exported-unprotected",
                title: `Exported provider "${identity}" has no permission protection`,
                severity: "major",
                confidence: "high",
                description:
                  "This <provider> is explicitly exported and declares no permission, readPermission, or writePermission. Any app on the device may query or modify its data unless finer-grained protection exists elsewhere (e.g. path-level permissions not visible here).",
                manifestPath: entry.manifestPath,
                identity,
                location: component.location,
                evidenceDetails: [
                  `authorities=${(component.authorities ?? []).join(",") || "(none parsed)"}`,
                  `grantUriPermissions=${component.grantUriPermissions ?? "unspecified"}`,
                ],
                recommendation: "Add android:permission, or both readPermission and writePermission, or set android:exported=\"false\" if external access is not required.",
              })
            );
          } else if (protection === "partial") {
            findings.push(
              makeAndroidFinding({
                ruleId: "android-provider-exported-partial-protection",
                title: `Exported provider "${identity}" only protects one of read/write access`,
                severity: "minor",
                confidence: "medium",
                description: "This <provider> defines only one of readPermission/writePermission, leaving the other operation unprotected.",
                manifestPath: entry.manifestPath,
                identity,
                location: component.location,
                evidenceDetails: [`readPermission=${component.readPermission ?? "(none)"}`, `writePermission=${component.writePermission ?? "(none)"}`],
                recommendation: "Protect both read and write access, or document why only one is intentionally protected.",
              })
            );
          } else {
            findings.push(
              makeAndroidFinding({
                ruleId: "android-provider-exported-protected",
                title: `Exported provider "${identity}" is permission-protected`,
                severity: "informational",
                confidence: "high",
                description: "This <provider> is explicitly exported but protection evidence (permission or read+write permissions) is present.",
                manifestPath: entry.manifestPath,
                identity,
                location: component.location,
                evidenceDetails: [`permission=${component.permission ?? "(none)"}`],
              })
            );
          }
          continue;
        }

        const protected_ = isProtectedNonProvider(component, applicationPermission);
        if (protected_) {
          findings.push(
            makeAndroidFinding({
              ruleId: "android-component-exported-protected",
              title: `Exported ${group.kind} "${identity}" is permission-protected`,
              severity: "informational",
              confidence: "high",
              description: `This ${group.kind} is explicitly exported and protected by ${component.permission ? `component-level permission "${component.permission}"` : `an application-level permission ("${applicationPermission}")`}.`,
              manifestPath: entry.manifestPath,
              identity,
              location: component.location,
              evidenceDetails: [`kind=${group.kind}`, `hasIntentFilters=${hasFilters}`, `permission=${component.permission ?? applicationPermission}`],
            })
          );
        } else if (component.isLauncherActivity) {
          // A standard launcher activity being exported and unprotected is
          // expected, required Android behavior (it must be exported to be
          // launchable from the home screen) — informational only, not a
          // review-required finding (agents.txt Batch 3 section 7.19,
          // "Standard launcher activity evidence" = informational/low tier).
          findings.push(
            makeAndroidFinding({
              ruleId: "android-component-launcher-activity-exported",
              title: `Launcher activity "${identity}" is exported (expected)`,
              severity: "informational",
              confidence: "high",
              description: "This is the app's launcher activity (MAIN/LAUNCHER intent filter). Being exported without permission protection is expected, standard behavior for a launcher entry point.",
              manifestPath: entry.manifestPath,
              identity,
              location: component.location,
              evidenceDetails: [`kind=${group.kind}`],
            })
          );
        } else {
          findings.push(
            makeAndroidFinding({
              ruleId: "android-component-exported-unprotected",
              title: `Exported ${group.kind} "${identity}" has no deterministic permission protection`,
              severity: "minor",
              confidence: hasFilters ? "high" : "medium",
              description: `This ${group.kind} is explicitly exported and no component-level or application-level permission was found in this manifest. Effective protection could still exist via a permission defined in another source set or module, which lowers confidence here.`,
              manifestPath: entry.manifestPath,
              identity,
              location: component.location,
              evidenceDetails: [`kind=${group.kind}`, `hasIntentFilters=${hasFilters}`],
              recommendation: "Add android:permission if this component should not be freely reachable by other apps, or confirm android:exported=\"true\" is intentional.",
            })
          );
        }
      }
    }

    if (inspectedCount > 0) {
      evidence.push(`${entry.manifestPath}: ${inspectedCount} component(s) inspected`);
    }
  }

  return buildAndroidManifestCheckResult({
    id: "android-exported-components-audit",
    category: "android-components",
    title: "Android exported-component audit",
    detection,
    manifests,
    findings,
    evidence,
    warnings,
  });
}
