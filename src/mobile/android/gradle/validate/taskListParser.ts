// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — bounded `gradlew tasks --all` output parsing
// (agents.txt Batch 4 section 7.20).
//
// Extracts task names conservatively: only lines shaped like
// `taskName - description text` are treated as task declarations. Task
// descriptions are never treated as identifiers, and this parser never
// treats its output as authoritative security evidence — it is only used to
// decide whether a later allowlisted operation should be attempted or
// skipped.
// ---------------------------------------------------------------------------

const TASK_LINE_PATTERN = /^([A-Za-z][\w:]*)\s+-\s+.+$/;

export function parseGradleTaskNames(tasksOutput: string): Set<string> {
  const names = new Set<string>();
  for (const line of tasksOutput.split(/\r?\n/)) {
    const match = line.match(TASK_LINE_PATTERN);
    if (match) names.add(match[1]);
  }
  return names;
}

export function isGradleTaskAvailable(taskNames: Set<string>, taskName: string): boolean {
  return taskNames.has(taskName);
}
