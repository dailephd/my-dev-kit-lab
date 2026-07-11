import type { AndroidManifestModel } from "../manifest/types.js";
import type { AndroidReleaseMetadataSummary } from "../gradle/releaseMetadataSummary.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 5 — bounded Play-readiness checklist placeholders (agents.txt
// Batch 5 section 14).
//
// Informational and planning-oriented only. Never claims Google Play
// approval, compliance, upload readiness, or publication readiness — no
// network access, no live policy lookup. Manual/policy placeholder items are
// always "manual-check-required" regardless of local evidence.
// ---------------------------------------------------------------------------

export const ANDROID_PLAY_READINESS_ITEM_STATUSES = [
  "confirmed",
  "missing",
  "unresolved",
  "manual-check-required",
  "not-applicable",
] as const;
export type AndroidPlayReadinessItemStatus = (typeof ANDROID_PLAY_READINESS_ITEM_STATUSES)[number];

export type AndroidPlayReadinessItem = {
  id: string;
  title: string;
  status: AndroidPlayReadinessItemStatus;
  detail: string;
};

export type AndroidPlayReadinessChecklist = {
  applicable: boolean;
  note: string;
  items: AndroidPlayReadinessItem[];
};

const MANUAL_POLICY_ITEMS: Omit<AndroidPlayReadinessItem, "status">[] = [
  { id: "privacy-policy-required", title: "Privacy policy", detail: "Privacy policy requirement must be assessed manually." },
  { id: "play-data-safety-declaration", title: "Data Safety declaration", detail: "Google Play Data Safety declaration must be completed manually." },
  {
    id: "sensitive-permission-justification",
    title: "Sensitive permission justification",
    detail: "Sensitive or restricted permission declarations may require additional forms or justification.",
  },
  { id: "store-listing-content", title: "Store listing content", detail: "Store listing content must be prepared manually." },
  { id: "release-notes", title: "Release notes", detail: "Release notes must be prepared." },
  { id: "app-access-instructions", title: "App access instructions", detail: "App access instructions may be required." },
  { id: "content-rating", title: "Content rating", detail: "Content rating must be completed." },
  {
    id: "target-audience-content-declarations",
    title: "Target audience and content",
    detail: "Target audience and content declarations must be completed.",
  },
  { id: "ads-declaration", title: "Ads declaration", detail: "Ads declaration may be required." },
  {
    id: "testing-track-account-requirements",
    title: "Testing track and account requirements",
    detail: "Testing-track and account requirements must be checked separately.",
  },
  {
    id: "current-play-policy-review",
    title: "Current Google Play policy review",
    detail: "Current Google Play policies must be reviewed at publication time. This tool performs no live policy lookup.",
  },
];

function itemsForLibrary(): AndroidPlayReadinessItem[] {
  const applicationItemIds = [
    "app-module-identified",
    "application-id-resolved",
    "namespace-resolved",
    "version-code-resolved",
    "version-name-resolved",
    "min-sdk-resolved",
    "target-sdk-resolved",
    "compile-sdk-resolved",
    "target-sdk-policy-check",
    "launcher-activity-identified",
    "application-label-present",
    "application-icon-present",
    "adaptive-round-icon-evidence",
    "permissions-summary-available",
  ];
  const items: AndroidPlayReadinessItem[] = applicationItemIds.map((id) => ({
    id,
    title: id,
    status: "not-applicable",
    detail: "Google Play application readiness does not apply directly to a library artifact.",
  }));
  for (const policyItem of MANUAL_POLICY_ITEMS) {
    items.push({ ...policyItem, status: "not-applicable" });
  }
  return items;
}

export function buildAndroidPlayReadinessChecklist(input: {
  isLibraryOnly: boolean;
  isNonAndroid?: boolean;
  releaseMetadata: AndroidReleaseMetadataSummary;
  manifests: AndroidManifestModel[];
}): AndroidPlayReadinessChecklist {
  if (input.isNonAndroid) {
    return {
      applicable: false,
      note: "This target was not detected as an Android project. Play-readiness checklist items are not applicable.",
      items: itemsForLibrary().map((item) => ({ ...item, detail: "Target was not detected as an Android project." })),
    };
  }

  if (input.isLibraryOnly) {
    return {
      applicable: false,
      note: "This target is a pure Android library. Play-readiness checklist items are not applicable to a library artifact.",
      items: itemsForLibrary(),
    };
  }

  const { releaseMetadata, manifests } = input;
  const hasLauncher = manifests.some((m) => Boolean(m.launcherActivityName));
  const hasLabel = manifests.some((m) => Boolean(m.application.label));
  const hasIcon = manifests.some((m) => Boolean(m.application.iconRef));
  const hasAdaptiveIconEvidence = manifests.some((m) => Boolean(m.application.adaptiveIconEvidence));
  const permissionsAvailable = manifests.length > 0;

  const resolvedOrManual = (value: unknown, unresolvedFieldName: string): AndroidPlayReadinessItemStatus => {
    if (value !== undefined && value !== null && value !== "") return "confirmed";
    const wasAttempted = releaseMetadata.unresolvedFields.some((f) => f.startsWith(`${unresolvedFieldName}:`));
    return wasAttempted ? "unresolved" : "missing";
  };

  const items: AndroidPlayReadinessItem[] = [
    {
      id: "app-module-identified",
      title: "Application module identified",
      status: releaseMetadata.applicationModulePath ? "confirmed" : "missing",
      detail: releaseMetadata.applicationModuleSelectionNote,
    },
    { id: "application-id-resolved", title: "applicationId resolved", status: resolvedOrManual(releaseMetadata.applicationId, "applicationId"), detail: releaseMetadata.applicationId ?? "Not statically resolved." },
    { id: "namespace-resolved", title: "namespace resolved", status: resolvedOrManual(releaseMetadata.namespace, "namespace"), detail: releaseMetadata.namespace ?? "Not statically resolved." },
    { id: "version-code-resolved", title: "versionCode resolved", status: resolvedOrManual(releaseMetadata.versionCode, "versionCode"), detail: String(releaseMetadata.versionCode ?? "Not statically resolved.") },
    { id: "version-name-resolved", title: "versionName resolved", status: resolvedOrManual(releaseMetadata.versionName, "versionName"), detail: releaseMetadata.versionName ?? "Not statically resolved." },
    { id: "min-sdk-resolved", title: "minSdk resolved", status: resolvedOrManual(releaseMetadata.minSdk, "minSdk"), detail: String(releaseMetadata.minSdk ?? "Not statically resolved.") },
    { id: "target-sdk-resolved", title: "targetSdk resolved", status: resolvedOrManual(releaseMetadata.targetSdk, "targetSdk"), detail: String(releaseMetadata.targetSdk ?? "Not statically resolved.") },
    { id: "compile-sdk-resolved", title: "compileSdk resolved", status: resolvedOrManual(releaseMetadata.compileSdk, "compileSdk"), detail: String(releaseMetadata.compileSdk ?? "Not statically resolved.") },
    {
      id: "target-sdk-policy-check",
      title: "Current Google Play target SDK policy",
      status: "manual-check-required",
      detail: "Current Google Play target SDK policy must be checked separately — not evaluated by this tool.",
    },
    { id: "launcher-activity-identified", title: "Launcher activity identified", status: hasLauncher ? "confirmed" : "missing", detail: hasLauncher ? "Launcher activity found in a parsed manifest." : "No launcher activity evidence found." },
    { id: "application-label-present", title: "Application label reference present", status: hasLabel ? "confirmed" : "missing", detail: hasLabel ? "android:label present." : "No android:label found on <application>." },
    { id: "application-icon-present", title: "Application icon reference present", status: hasIcon ? "confirmed" : "missing", detail: hasIcon ? "android:icon present." : "No android:icon found on <application>." },
    {
      id: "adaptive-round-icon-evidence",
      title: "Round/adaptive icon evidence",
      status: hasAdaptiveIconEvidence ? "confirmed" : "unresolved",
      detail: "Adaptive/round icon resources are not resolved by this tool; only direct manifest evidence, if any, is reflected here.",
    },
    {
      id: "permissions-summary-available",
      title: "Permissions summary available",
      status: permissionsAvailable ? "confirmed" : "missing",
      detail: "See the permissions audit section for the full declared-permission summary.",
    },
  ];

  for (const policyItem of MANUAL_POLICY_ITEMS) {
    items.push({ ...policyItem, status: "manual-check-required" });
  }

  return {
    applicable: true,
    note: "Bounded, local-evidence-only checklist. Confirms what static analysis found; every policy/manual item still requires human review before a Play Store submission. No live Google Play policy lookup was performed.",
    items,
  };
}
