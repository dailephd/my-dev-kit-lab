// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — Firebase/Google services semantic contracts. Local to
// this feature; does not duplicate Batch 1's CandidateEvidence/
// SecurityFinding/AndroidCheckResult.
// ---------------------------------------------------------------------------

export type FirebaseArtifactFile = {
  relativePath: string;
  absolutePath: string;
  modulePath?: string;
  content: string;
};

export type FirebaseArtifactSkip = { relativePath: string; reason: "oversized" | "unreadable" | "binary-like"; detail?: string };

export type GoogleServicesClient = {
  packageName?: string;
  mobileSdkAppId?: string;
  apiKeyCount: number;
  oauthClientCount: number;
};

export type GoogleServicesConfig = {
  file: FirebaseArtifactFile;
  malformed: boolean;
  projectId?: string;
  projectNumber?: string;
  storageBucket?: string;
  firebaseUrl?: string;
  clients: GoogleServicesClient[];
};

export type FirebaseJsonConfig = {
  file: FirebaseArtifactFile;
  malformed: boolean;
  databaseRulesPaths: string[];
  firestoreRulesPaths: string[];
  storageRulesPaths: string[];
};

export type FirebaseRcConfig = {
  file: FirebaseArtifactFile;
  malformed: boolean;
  defaultProject?: string;
  aliases: Record<string, string>;
};

export type DatabaseRuleEntry = {
  jsonPath: string;
  operation: ".read" | ".write" | ".validate" | ".indexOn";
  literalBoolean?: boolean;
  conditionSummary: string;
  depth: number;
};

export type DatabaseRulesResult = {
  file: FirebaseArtifactFile;
  malformed: boolean;
  entries: DatabaseRuleEntry[];
  boundsExceeded: boolean;
};

export type RulesLanguageMatch = {
  service: "firestore" | "storage";
  matchPath: string;
  operations: string[];
  conditionSummary: string;
  isLiteralTrue: boolean;
  isLiteralFalse: boolean;
  hasAuthCondition: boolean;
  isTestModeTimeCondition: boolean;
  line: number;
};

export type RulesLanguageResult = {
  file: FirebaseArtifactFile;
  malformed: boolean;
  matches: RulesLanguageMatch[];
  boundsExceeded: boolean;
};

export type FirebaseServiceUseEvidence = {
  service: "database" | "firestore" | "storage" | "auth" | "analytics" | "crashlytics" | "messaging" | "performance";
  source: "gradle-plugin" | "gradle-dependency" | "source-import" | "source-usage";
  detail: string;
  relativePath: string;
  modulePath?: string;
  line?: number;
};

export type CollectionSetterEvidence = {
  service: "analytics" | "crashlytics" | "messaging";
  state: "true" | "false" | "dynamic";
  relativePath: string;
  modulePath?: string;
  line: number;
};

export type ManifestCollectionMetadata = {
  name: string;
  rawValue: string;
  state: "true" | "false" | "dynamic";
  relativePath: string;
  line?: number;
};

export type AnalyticsEventEvidence = {
  eventNameExpression?: string;
  sensitiveParameterKey?: string;
  sensitiveParameterValueExpression?: string;
  isDirectLiteralValue: boolean;
  relativePath: string;
  modulePath?: string;
  line: number;
};
