import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 3 — read-only target state snapshot.
//
// Read-only (git status only — never git clean/reset/restore/checkout).
// Used to distinguish pre-existing target dirtiness from changes caused by
// the validation run itself, without ever mutating the target.
// ---------------------------------------------------------------------------

export type GitStatusEntry = {
  // Raw two-character porcelain status code, e.g. " M", "??", "A ".
  code: string;
  path: string;
};

export type TargetSnapshot = {
  targetRoot: string;
  takenAt: string;
  hasGit: boolean;
  // undefined when hasGit is false or git status could not be read.
  entries?: GitStatusEntry[];
  unreadableReason?: string;
};

// Reads `git status --porcelain=v1` for targetRoot without mutating anything.
// Returns hasGit:false (not a thrown error) when the target is not a git
// repository or git is unavailable — callers must treat that as "unknown",
// never as "crashed".
export function captureTargetSnapshot(targetRoot: string, hasGit: boolean): TargetSnapshot {
  const takenAt = new Date().toISOString();
  if (!hasGit) {
    return { targetRoot, takenAt, hasGit: false, unreadableReason: "Target is not a git repository." };
  }

  try {
    const raw = execSync("git status --porcelain=v1", {
      cwd: targetRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const entries = parsePorcelainStatus(raw);
    return { targetRoot, takenAt, hasGit: true, entries };
  } catch (err) {
    return {
      targetRoot,
      takenAt,
      hasGit: false,
      unreadableReason: `git status failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function parsePorcelainStatus(raw: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const code = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    // Renames report as "old -> new"; keep the new path for comparisons.
    const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ")[1] : rawPath;
    entries.push({ code, path: filePath });
  }
  // Stable, deterministic ordering independent of git's own output order.
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export type TargetSnapshotDiff = {
  comparable: boolean;
  reason?: string;
  // Entries present in `after` but not in `before` (new dirtiness caused
  // during the validation run, at least at the git-status granularity).
  newEntries: GitStatusEntry[];
  // Entries present in `before` (pre-existing dirtiness, not attributable to
  // this validation run).
  preExistingEntries: GitStatusEntry[];
};

const GENERATED_ARTIFACT_PATTERNS = [
  "reports/security/",
  "reports/audits/",
  ".my-dev-kit/",
  "lab-output/",
];

export function isGeneratedArtifactPath(p: string): boolean {
  const normalized = p.replace(/\\/g, "/");
  return (
    GENERATED_ARTIFACT_PATTERNS.some((pattern) => normalized.startsWith(pattern)) ||
    /-security-validation\.(txt|json)$/i.test(normalized)
  );
}

export function diffTargetSnapshots(before: TargetSnapshot, after: TargetSnapshot): TargetSnapshotDiff {
  if (!before.hasGit || !after.hasGit || !before.entries || !after.entries) {
    return {
      comparable: false,
      reason: before.unreadableReason ?? after.unreadableReason ?? "git status was not available for comparison.",
      newEntries: [],
      preExistingEntries: [],
    };
  }

  const beforeKeys = new Set(before.entries.map((e) => `${e.code}:${e.path}`));
  const newEntries = after.entries.filter((e) => !beforeKeys.has(`${e.code}:${e.path}`));
  return {
    comparable: true,
    newEntries,
    preExistingEntries: before.entries,
  };
}
