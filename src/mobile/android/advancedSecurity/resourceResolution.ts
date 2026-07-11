import fs from "node:fs";
import path from "node:path";
import { relativeWithinRoot, resolveWithinRoot } from "../../../core/pathSafety.js";
import { parseAndroidResourceReference, type ParsedAndroidResourceReference } from "./resourceReference.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 1 — target-contained resolution of statically identifiable
// Android XML resource references (e.g. @xml/network_security_config)
// against a single module's known source sets.
//
// Scope, deliberately narrow (agents.txt Batch 1 section 7.7):
//   - Only @xml/... references (package-qualified/other-type refs report
//     "unsupported-reference" and are never resolved).
//   - Only statically known source-set directories under
//     <modulePath>/src/<sourceSet>/res/xml/<name>.xml — no resource overlay
//     merging, no Gradle variant evaluation, no Android SDK/Gradle
//     invocation.
//   - All matching candidates across source sets are returned; ambiguity is
//     reported structurally rather than silently picking one.
//   - Symlinks are never followed outside the target root: a symlinked
//     source-set directory or resource file whose real path escapes root is
//     treated as not resolvable, not silently included.
// ---------------------------------------------------------------------------

export type AndroidResourceCandidate = {
  sourceSet: string;
  relativePath: string;
};

export type AndroidResourceResolutionResult =
  | { state: "resolved"; reference: string; modulePath: string; candidates: [AndroidResourceCandidate] }
  | { state: "ambiguous"; reference: string; modulePath: string; candidates: AndroidResourceCandidate[] }
  | { state: "missing"; reference: string; modulePath: string; searchedSourceSets: string[] }
  | { state: "malformed-reference"; reference: string; modulePath: string; reason: string }
  | { state: "unsupported-reference"; reference: string; modulePath: string; parsed: ParsedAndroidResourceReference };

const DEFAULT_SOURCE_SETS = ["main", "debug", "release"] as const;

// Returns true only when `candidatePath` both lexically resolves within root
// (resolveWithinRoot) AND, if it is or passes through a symlink, its real
// path also resolves within root. Never throws — a filesystem error (e.g.
// broken symlink) is treated as "does not safely resolve".
function isSafelyContainedExistingFile(root: string, candidatePath: string): boolean {
  try {
    resolveWithinRoot(root, candidatePath);
  } catch {
    return false;
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(candidatePath);
  } catch {
    return false;
  }

  if (!stat.isFile() && !stat.isSymbolicLink()) {
    return false;
  }

  if (stat.isSymbolicLink()) {
    let realPath: string;
    try {
      realPath = fs.realpathSync(candidatePath);
    } catch {
      return false;
    }
    try {
      resolveWithinRoot(root, realPath);
    } catch {
      return false;
    }
    try {
      if (!fs.statSync(realPath).isFile()) return false;
    } catch {
      return false;
    }
  }

  return true;
}

function listCandidateSourceSets(root: string, modulePath: string): string[] {
  const srcDir = path.join(modulePath, "src");
  let entries: string[];
  try {
    entries = fs.readdirSync(srcDir);
  } catch {
    return [...DEFAULT_SOURCE_SETS];
  }

  const discovered = new Set<string>(DEFAULT_SOURCE_SETS);
  for (const entry of entries) {
    const entryPath = path.join(srcDir, entry);
    try {
      resolveWithinRoot(root, entryPath);
    } catch {
      continue;
    }
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(entryPath);
    } catch {
      continue;
    }
    if (stat.isDirectory() || stat.isSymbolicLink()) {
      discovered.add(entry);
    }
  }

  // Deterministic order: independent of readdirSync's filesystem-dependent
  // enumeration order.
  return [...discovered].sort((a, b) => a.localeCompare(b));
}

export function resolveAndroidXmlResourceReference(
  root: string,
  modulePath: string,
  rawReference: string
): AndroidResourceResolutionResult {
  const parsed = parseAndroidResourceReference(rawReference);

  if (parsed.state === "malformed" || parsed.state === "empty" || parsed.state === "placeholder") {
    return {
      state: "malformed-reference",
      reference: rawReference,
      modulePath: relativeWithinRoot(root, modulePath),
      reason: parsed.state === "malformed" ? parsed.reason : `Reference is ${parsed.state}, not a concrete resource value`,
    };
  }

  if (parsed.state === "unsupported-type" || parsed.state === "package-qualified") {
    return {
      state: "unsupported-reference",
      reference: rawReference,
      modulePath: relativeWithinRoot(root, modulePath),
      parsed,
    };
  }

  const sourceSets = listCandidateSourceSets(root, modulePath);
  const candidates: AndroidResourceCandidate[] = [];

  for (const sourceSet of sourceSets) {
    const candidatePath = path.join(modulePath, "src", sourceSet, "res", parsed.type, `${parsed.name}.xml`);
    if (isSafelyContainedExistingFile(root, candidatePath)) {
      candidates.push({ sourceSet, relativePath: relativeWithinRoot(root, candidatePath) });
    }
  }

  const relativeModulePath = relativeWithinRoot(root, modulePath);

  if (candidates.length === 0) {
    return { state: "missing", reference: rawReference, modulePath: relativeModulePath, searchedSourceSets: sourceSets };
  }
  if (candidates.length === 1) {
    return { state: "resolved", reference: rawReference, modulePath: relativeModulePath, candidates: [candidates[0]] };
  }
  return { state: "ambiguous", reference: rawReference, modulePath: relativeModulePath, candidates };
}
