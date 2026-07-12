import { executableMask, lineForOffset } from "../sensitiveData/localSourceContext.js";
import { splitTopLevelArguments } from "../sensitiveData/splitArguments.js";
import type { StorageApiKind, StorageMatch } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — bounded direct evidence collection for sensitive-storage
// APIs (SharedPreferences, DataStore, internal/external file writes,
// database/ContentValues writes, and encrypted-storage references).
//
// Purely lexical: call shapes are matched over comment/string-masked text
// (so nothing inside a comment or string literal is matched as executable
// code), but every captured group offset is then re-sliced out of the
// ORIGINAL, unmasked content (via regex match "indices", the `d` flag) —
// masked text has string-literal interiors blanked out, so reading argument
// text directly from a masked capture group would silently lose every
// string-literal key/value. Nothing in this file constructs CandidateEvidence
// or SecurityFinding, and nothing here is exported outside sensitiveStorage/.
// ---------------------------------------------------------------------------

const PUT_CALL =
  /([A-Za-z_][\w.]*)\.(?:edit\(\)\.)?(putString|putStringSet|putInt|putLong|putFloat|putBoolean|remove|clear|apply|commit)\s*\(([^;\n]*?)\)/gd;
const GET_PREFS = /(?:([A-Za-z_][\w.]*)\.)?(getSharedPreferences|PreferenceManager\.getDefaultSharedPreferences)\s*\(([^;\n]*?)\)/gd;
const DATASTORE_EDIT = /([A-Za-z_][\w.]*)\[\s*([A-Za-z_][\w.]*)\s*\]\s*=\s*([^;\n]+)/gd;
const INTERNAL_FILE_WRITE = /(?:([A-Za-z_][\w.]*)\.)?(openFileOutput|writeText|appendText)\s*\(([^;\n]*?)\)/gd;
const FILE_STREAM_CTOR = /new\s+(FileOutputStream|FileWriter|BufferedWriter)\s*\(([^;\n]*?)\)/gd;
const EXTERNAL_PATH_API =
  /(Environment\.getExternalStorageDirectory|Environment\.getExternalStoragePublicDirectory|[A-Za-z_][\w.]*\.getExternalFilesDir|[A-Za-z_][\w.]*\.externalFilesDir|[A-Za-z_][\w.]*\.getExternalCacheDir|[A-Za-z_][\w.]*\.externalCacheDir)\s*\(?([^;\n)]*)\)?/gd;
const CONTENT_VALUES_PUT = /([A-Za-z_][\w.]*)\.put\s*\(([^;\n]*?)\)/gd;
const EXEC_SQL = /([A-Za-z_][\w.]*)\.execSQL\s*\(([^;\n]*?)\)/gd;
const ENCRYPTED_STORAGE_REFERENCE = /\b(EncryptedSharedPreferences|EncryptedFile|MasterKey|AndroidKeyStore|SQLCipher)\b/gd;

type IndexedMatch = RegExpMatchArray & { indices?: Array<[number, number] | undefined> };

function realGroup(content: string, match: IndexedMatch, group: number): string | undefined {
  const span = match.indices?.[group];
  if (!span) return match[group];
  return content.slice(span[0], span[1]);
}

function pushMatch(list: StorageMatch[], content: string, kind: StorageApiKind, api: string, offset: number, extra: Partial<StorageMatch>): void {
  list.push({ kind, api, receiver: extra.receiver ?? "(unresolved)", offset, line: lineForOffset(content, offset), ...extra });
}

export function collectStorageEvidence(content: string): StorageMatch[] {
  const mask = executableMask(content);
  const matches: StorageMatch[] = [];

  for (const match of mask.matchAll(PUT_CALL) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 3) ?? "");
    pushMatch(matches, content, "shared-preferences-write", `SharedPreferences.Editor.${match[2]}`, offset, {
      receiver: match[1],
      keyExpression: args[0],
      valueExpression: args[1],
    });
  }

  for (const match of mask.matchAll(GET_PREFS) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 3) ?? "");
    pushMatch(matches, content, "shared-preferences-get", match[2], offset, {
      receiver: match[1] ?? match[2],
      pathHint: args[0],
      modeExpression: args[1],
    });
  }

  for (const match of mask.matchAll(DATASTORE_EDIT) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    pushMatch(matches, content, "datastore-write", "DataStore.edit[key]=", offset, {
      receiver: match[1],
      keyExpression: match[2],
      valueExpression: realGroup(content, match, 3),
    });
  }

  for (const match of mask.matchAll(INTERNAL_FILE_WRITE) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 3) ?? "");
    pushMatch(matches, content, "internal-file-write", match[2], offset, {
      receiver: match[1],
      pathHint: match[2] === "openFileOutput" ? args[0] : undefined,
      modeExpression: match[2] === "openFileOutput" ? args[1] : undefined,
      valueExpression: match[2] !== "openFileOutput" ? args[0] : undefined,
    });
  }

  for (const match of mask.matchAll(FILE_STREAM_CTOR) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 2) ?? "");
    pushMatch(matches, content, "internal-file-write", `new ${match[1]}`, offset, {
      pathHint: args[0],
    });
  }

  for (const match of mask.matchAll(EXTERNAL_PATH_API) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    pushMatch(matches, content, "external-file-write", match[1], offset, {
      pathHint: realGroup(content, match, 2),
    });
  }

  for (const match of mask.matchAll(CONTENT_VALUES_PUT) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 2) ?? "");
    pushMatch(matches, content, "database-write", "ContentValues.put", offset, {
      receiver: match[1],
      keyExpression: args[0],
      valueExpression: args[1],
    });
  }

  for (const match of mask.matchAll(EXEC_SQL) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 2) ?? "");
    pushMatch(matches, content, "database-write", "execSQL", offset, {
      receiver: match[1],
      valueExpression: args[0],
    });
  }

  for (const match of mask.matchAll(ENCRYPTED_STORAGE_REFERENCE) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    pushMatch(matches, content, "encrypted-storage-reference", match[1], offset, {});
  }

  return matches.sort((a, b) => a.offset - b.offset);
}
