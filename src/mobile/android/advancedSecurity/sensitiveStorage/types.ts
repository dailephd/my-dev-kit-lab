// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — sensitive-storage evidence contracts.
// ---------------------------------------------------------------------------

export type StorageApiKind =
  | "shared-preferences-write"
  | "shared-preferences-get"
  | "datastore-write"
  | "internal-file-write"
  | "external-file-write"
  | "cache-file-write"
  | "database-write"
  | "encrypted-storage-reference";

export type StorageMatch = {
  kind: StorageApiKind;
  api: string;
  receiver: string;
  keyExpression?: string;
  valueExpression?: string;
  modeExpression?: string;
  pathHint?: string;
  offset: number;
  line: number;
};
