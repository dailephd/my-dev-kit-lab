import fs from "node:fs";
import { collectFilesForGlobs } from "../../../../core/fileGlobs.js";
import { discoverSecretSourceFiles, MAX_SECRET_SCAN_FILE_BYTES } from "../secretCandidates/discoverSecretSourceFiles.js";
import type { FirebaseArtifactFile, FirebaseArtifactSkip } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — bounded, target-contained discovery of Firebase/Google
// configuration and rules artifacts.
//
// google-services.json and firebase.json are already covered by Batch 4's
// discoverSecretSourceFiles (its glob list includes **/*.json), so those are
// reused directly rather than re-discovered. .firebaserc and *.rules files
// are not covered by that glob list (dotfiles and a non-listed extension),
// so a small supplemental scan reuses collectFilesForGlobs (the same
// target-containment primitive discoverSecretSourceFiles itself wraps)
// rather than introducing a second traversal engine.
// ---------------------------------------------------------------------------

const NUL_CHAR = String.fromCharCode(0);

export type DiscoverFirebaseArtifactsResult = {
  googleServicesFiles: FirebaseArtifactFile[];
  firebaseJsonFiles: FirebaseArtifactFile[];
  firebaseRcFiles: FirebaseArtifactFile[];
  databaseRulesJsonFiles: FirebaseArtifactFile[];
  rulesFiles: FirebaseArtifactFile[];
  gradleFiles: FirebaseArtifactFile[];
  sourceFiles: FirebaseArtifactFile[];
  manifestFiles: FirebaseArtifactFile[];
  skipped: FirebaseArtifactSkip[];
};

function readSupplemental(targetRoot: string, globs: string[], knownModulePaths: readonly string[]): { files: FirebaseArtifactFile[]; skipped: FirebaseArtifactSkip[] } {
  const files: FirebaseArtifactFile[] = [];
  const skipped: FirebaseArtifactSkip[] = [];
  const matches: { absolutePath: string; relativePath: string }[] = [];
  const seen = new Set<string>();
  for (const glob of globs) {
    let globMatches: { absolutePath: string; relativePath: string }[];
    try {
      globMatches = collectFilesForGlobs(targetRoot, [glob]);
    } catch {
      continue;
    }
    for (const match of globMatches) {
      if (seen.has(match.relativePath)) continue;
      seen.add(match.relativePath);
      matches.push(match);
    }
  }
  for (const match of matches) {
    const relativePath = match.relativePath.replace(/\\/g, "/");
    if (relativePath.includes("node_modules/") || relativePath.includes(".gradle/") || relativePath.includes("build/")) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(match.absolutePath);
    } catch (error) {
      skipped.push({ relativePath, reason: "unreadable", detail: error instanceof Error ? error.message : undefined });
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > MAX_SECRET_SCAN_FILE_BYTES) {
      skipped.push({ relativePath, reason: "oversized", detail: `${stat.size} bytes exceeds ${MAX_SECRET_SCAN_FILE_BYTES}` });
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(match.absolutePath, "utf8");
    } catch (error) {
      skipped.push({ relativePath, reason: "unreadable", detail: error instanceof Error ? error.message : undefined });
      continue;
    }
    if (content.indexOf(NUL_CHAR) !== -1) {
      skipped.push({ relativePath, reason: "binary-like" });
      continue;
    }
    const modulePath = knownModulePaths.find((m) => relativePath.startsWith(`${m}/`));
    files.push({ relativePath, absolutePath: match.absolutePath, modulePath, content });
  }
  return { files, skipped };
}

export function discoverFirebaseArtifacts(targetRoot: string, knownModulePaths: readonly string[] = []): DiscoverFirebaseArtifactsResult {
  const { files, skipped } = discoverSecretSourceFiles(targetRoot, knownModulePaths);

  const googleServicesFiles: FirebaseArtifactFile[] = [];
  const firebaseJsonFiles: FirebaseArtifactFile[] = [];
  const databaseRulesJsonFiles: FirebaseArtifactFile[] = [];
  const gradleFiles: FirebaseArtifactFile[] = [];
  const sourceFiles: FirebaseArtifactFile[] = [];
  const manifestFiles: FirebaseArtifactFile[] = [];

  const foundRelativePaths = new Set<string>();
  for (const file of files) {
    const lower = file.relativePath.toLowerCase();
    foundRelativePaths.add(file.relativePath);
    if (lower.endsWith("google-services.json")) googleServicesFiles.push(file);
    else if (lower.endsWith("/firebase.json") || lower === "firebase.json") firebaseJsonFiles.push(file);
    else if (lower.endsWith("database.rules.json")) databaseRulesJsonFiles.push(file);
    else if (/\.(gradle|gradle\.kts)$/.test(lower)) gradleFiles.push(file);
    else if (/\.(java|kt)$/.test(lower)) sourceFiles.push(file);
    else if (lower.endsWith("androidmanifest.xml")) manifestFiles.push(file);
  }

  // Root-level filenames (e.g. a repo-root database.rules.json) are not
  // matched by "**/*.json"-style globs, which require at least one path
  // separator (the same limitation Batch 4's discovery module documents) —
  // explicit root-level literals fill that gap for Firebase's well-known
  // conventional filenames, deduplicated against what discoverSecretSourceFiles
  // already found.
  const rc = readSupplemental(targetRoot, ["**/.firebaserc", ".firebaserc"], knownModulePaths);
  const rules = readSupplemental(targetRoot, ["**/*.rules", "firestore.rules", "storage.rules", "database.rules"], knownModulePaths);
  const rootJson = readSupplemental(
    targetRoot,
    ["google-services.json", "firebase.json", "database.rules.json"],
    knownModulePaths
  );

  for (const file of rootJson.files) {
    if (foundRelativePaths.has(file.relativePath)) continue;
    const lower = file.relativePath.toLowerCase();
    if (lower.endsWith("google-services.json")) googleServicesFiles.push(file);
    else if (lower.endsWith("firebase.json")) firebaseJsonFiles.push(file);
    else if (lower.endsWith("database.rules.json")) databaseRulesJsonFiles.push(file);
  }

  return {
    googleServicesFiles,
    firebaseJsonFiles,
    firebaseRcFiles: rc.files,
    databaseRulesJsonFiles,
    rulesFiles: rules.files,
    gradleFiles,
    sourceFiles,
    manifestFiles,
    skipped: [...skipped, ...rc.skipped, ...rules.skipped, ...rootJson.skipped],
  };
}
