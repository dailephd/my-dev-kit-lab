// ---------------------------------------------------------------------------
// v0.4.1 Batch 4 — signing-configuration model.
//
// Deliberately a NEW, separate type — not an additive field on the shared,
// already-actively-rendered AndroidGradleModuleInfo/AndroidGradleMetadata
// (src/mobile/android/gradle/types.ts). That type flows into the real,
// currently-rendered v0.4.0 Android JSON/text report via the active
// android-gradle-metadata check; adding a raw or even redacted-preview
// credential field to it would put secret-shaped data on a path that already
// renders today, before this batch's own non-disclosure guarantees can be
// verified end-to-end by Batch 8. Keeping this type local to the standalone,
// unregistered signingConfiguration feature means it can only ever reach a
// report once Batch 8 deliberately wires it in.
//
// storeFile/keyAlias are not secrets (a path and an alias name), so their
// literal value is retained directly. storePassword/keyPassword literal
// values are NEVER retained here — only a redacted preview and fingerprint
// (Batch 1 owners), computed immediately at extraction time.
// ---------------------------------------------------------------------------

export type SigningExpressionState =
  | "literal"
  | "environment-reference"
  | "gradle-property-reference"
  | "local-property-reference"
  | "variable-reference"
  | "method-call"
  | "dynamic"
  | "missing";

export type SigningPathValue = {
  state: SigningExpressionState;
  literalValue?: string;
  rawExpression?: string;
};

export type SigningCredentialValue = {
  state: SigningExpressionState;
  redactedPreview?: string;
  fingerprint?: string;
  rawExpression?: string;
};

export type AndroidGradleSigningConfigInfo = {
  name: string;
  storeFile: SigningPathValue;
  storePassword: SigningCredentialValue;
  keyAlias: SigningPathValue;
  keyPassword: SigningCredentialValue;
  enableV1Signing?: boolean;
  enableV2Signing?: boolean;
  enableV3Signing?: boolean;
  enableV4Signing?: boolean;
};

export type KeystoreCandidateFile = {
  relativePath: string;
  modulePath?: string;
  extension: string;
};
