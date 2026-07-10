// ---------------------------------------------------------------------------
// v0.4.0 Batch 1 — AndroidManifest model foundation.
// v0.4.0 Batch 3 — narrow additive inherited-contract corrections needed by
// manifest parsing and the initial audits (see agents.txt Batch 3 section
// 6.7). Every change below only adds new optional fields/enum members or a
// new optional array — no existing required field, type, or enum value was
// removed or retyped, so all Batch 1/2 object literals remain valid:
//   - AndroidManifestComponentKind gained "activity-alias" (section 7.6).
//   - AndroidManifestComponent gained optional `exportedRaw` so a malformed
//     android:exported value can be distinguished from "unspecified"
//     (`exported` stays undefined in both cases; `exportedRaw` preserves the
//     literal attribute text when present) — section 7.7's invariant that
//     malformed values must never be normalized to false requires this.
//   - AndroidManifestModel gained optional `activityAliases` (section 7.6).
//   - AndroidIntentFilter gained optional `actions`/`categories`/
//     `dataElements` so multiple sibling <action>/<category>/<data> children
//     can be preserved independently (section 7.8) without discarding the
//     original `filterData` field, which Batch 1 tests and any external
//     consumer may already rely on; the parser keeps populating both.
//   - AndroidIntentFilterData gained optional `location` (section 7.11).
//   - AndroidPermissionDeclaration gained optional `sourceElement` so
//     uses-permission / uses-permission-sdk-23 / uses-permission-sdk-m are
//     not conflated (section 7.4, ANDROID-B3-03).
//
// Normalized data contracts consumed by the manifest parser and the
// permission/component/deep-link auditors added in later batches. This file
// defines shape only — no XML parsing and no finding generation happen here.
// ---------------------------------------------------------------------------

export type AndroidManifestSourceLocation = {
  line?: number;
  column?: number;
};

export type AndroidIntentFilterData = {
  action?: string;
  category?: string;
  dataScheme?: string;
  dataHost?: string;
  dataPath?: string;
  dataPathPrefix?: string;
  dataPathPattern?: string;
  autoVerify?: boolean;
  location?: AndroidManifestSourceLocation;
};

export type AndroidIntentFilter = {
  filterData: AndroidIntentFilterData[];
  actions?: string[];
  categories?: string[];
  dataElements?: AndroidIntentFilterData[];
  // android:autoVerify belongs to <intent-filter> itself, not to individual
  // <data> children — kept here as the authoritative value (also mirrored
  // onto each AndroidIntentFilterData.autoVerify for backward compatibility
  // with the Batch 1 shape, which modeled it per-data-element).
  autoVerify?: boolean;
  isDeepLinkCandidate: boolean;
  location?: AndroidManifestSourceLocation;
};

export type AndroidManifestComponentKind = "activity" | "activity-alias" | "service" | "receiver" | "provider";

export type AndroidManifestComponent = {
  kind: AndroidManifestComponentKind;
  name: string;
  exported?: boolean;
  exportedRaw?: string;
  enabled?: boolean;
  permission?: string;
  readPermission?: string;
  writePermission?: string;
  authorities?: string[];
  grantUriPermissions?: boolean;
  intentFilters: AndroidIntentFilter[];
  isLauncherActivity?: boolean;
  location?: AndroidManifestSourceLocation;
};

export type AndroidPermissionSourceElement = "uses-permission" | "uses-permission-sdk-23" | "uses-permission-sdk-m";

export type AndroidPermissionDeclaration = {
  name: string;
  maxSdkVersion?: number;
  sourceElement?: AndroidPermissionSourceElement;
  location?: AndroidManifestSourceLocation;
};

export type AndroidUsesFeatureDeclaration = {
  name: string;
  required?: boolean;
  location?: AndroidManifestSourceLocation;
};

export type AndroidManifestApplicationAttributes = {
  name?: string;
  label?: string;
  iconRef?: string;
  adaptiveIconEvidence?: string;
  enabled?: boolean;
  permission?: string;
  allowBackup?: boolean;
  debuggable?: boolean;
  usesCleartextTraffic?: boolean;
  networkSecurityConfigRef?: string;
};

export type AndroidManifestModel = {
  manifestPath: string;
  packageName?: string;
  application: AndroidManifestApplicationAttributes;
  permissions: AndroidPermissionDeclaration[];
  usesFeatures: AndroidUsesFeatureDeclaration[];
  activities: AndroidManifestComponent[];
  activityAliases?: AndroidManifestComponent[];
  services: AndroidManifestComponent[];
  receivers: AndroidManifestComponent[];
  providers: AndroidManifestComponent[];
  deepLinks: AndroidIntentFilterData[];
  launcherActivityName?: string;
  parseWarnings: string[];
  unsupportedConstructs: string[];
};
