import type { FirebaseArtifactFile, FirebaseJsonConfig, FirebaseRcConfig } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — bounded, safe firebase.json and .firebaserc parsing.
// Only the sections relevant to Android security review (rules file
// references, project aliases) are extracted; hosting/functions/emulators
// sections are intentionally ignored (they are unrelated to Android
// security findings per agents.txt Batch 6 section 13.7).
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function collectRulesPaths(section: unknown): string[] {
  const paths: string[] = [];
  const record = asRecord(section);
  if (record) {
    const rules = asString(record.rules);
    if (rules) paths.push(rules);
    return paths;
  }
  const array = asArray(section);
  if (array) {
    for (const entry of array) {
      const entryRecord = asRecord(entry);
      const rules = asString(entryRecord?.rules);
      if (rules) paths.push(rules);
    }
  }
  return paths;
}

export function parseFirebaseJson(file: FirebaseArtifactFile): FirebaseJsonConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return { file, malformed: true, databaseRulesPaths: [], firestoreRulesPaths: [], storageRulesPaths: [] };
  }
  const root = asRecord(parsed);
  if (!root) return { file, malformed: true, databaseRulesPaths: [], firestoreRulesPaths: [], storageRulesPaths: [] };

  return {
    file,
    malformed: false,
    databaseRulesPaths: collectRulesPaths(root.database),
    firestoreRulesPaths: collectRulesPaths(root.firestore),
    storageRulesPaths: collectRulesPaths(root.storage),
  };
}

export function parseFirebaseRc(file: FirebaseArtifactFile): FirebaseRcConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return { file, malformed: true, aliases: {} };
  }
  const root = asRecord(parsed);
  const projects = asRecord(root?.projects);
  if (!projects) return { file, malformed: false, aliases: {} };

  const aliases: Record<string, string> = {};
  for (const [alias, value] of Object.entries(projects)) {
    const projectId = asString(value);
    if (projectId) aliases[alias] = projectId;
  }
  return { file, malformed: false, defaultProject: aliases.default, aliases };
}
