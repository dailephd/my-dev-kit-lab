// ---------------------------------------------------------------------------
// v0.4.0 Batch 1 — AndroidManifest model foundation.
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
};

export type AndroidIntentFilter = {
  filterData: AndroidIntentFilterData[];
  isDeepLinkCandidate: boolean;
  location?: AndroidManifestSourceLocation;
};

export type AndroidManifestComponentKind = "activity" | "service" | "receiver" | "provider";

export type AndroidManifestComponent = {
  kind: AndroidManifestComponentKind;
  name: string;
  exported?: boolean;
  intentFilters: AndroidIntentFilter[];
  isLauncherActivity?: boolean;
  location?: AndroidManifestSourceLocation;
};

export type AndroidPermissionDeclaration = {
  name: string;
  maxSdkVersion?: number;
  location?: AndroidManifestSourceLocation;
};

export type AndroidUsesFeatureDeclaration = {
  name: string;
  required?: boolean;
  location?: AndroidManifestSourceLocation;
};

export type AndroidManifestApplicationAttributes = {
  label?: string;
  iconRef?: string;
  adaptiveIconEvidence?: string;
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
  services: AndroidManifestComponent[];
  receivers: AndroidManifestComponent[];
  providers: AndroidManifestComponent[];
  deepLinks: AndroidIntentFilterData[];
  launcherActivityName?: string;
  parseWarnings: string[];
  unsupportedConstructs: string[];
};
