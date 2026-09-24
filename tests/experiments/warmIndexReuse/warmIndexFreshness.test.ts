import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeWarmIndexReuse, type WarmIndexProjectExecutionV1 } from "../../../src/experiments/plugins/warmIndexReuse/execution.js";
import { buildWarmIndexExecutionArtifact } from "../../../src/experiments/plugins/warmIndexReuse/executionArtifact.js";
import { makeCase, writeFakeKitVariant, writeSnapshotFakeKit } from "./warmIndexTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** A disposable target so a test-owned kit may mutate it between tasks without touching fixtures. */
function makeTarget(): { targetRoot: string; changed: string } {
  const targetRoot = path.join(tempDir("warm-fresh-target-"), "target");
  mkdirSync(path.join(targetRoot, "src"), { recursive: true });
  writeFileSync(path.join(targetRoot, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(targetRoot, "src", "b.ts"), "export const b = 2;\n");
  return { targetRoot, changed: path.join(targetRoot, "src", "a.ts") };
}

function casesFor(targetRoot: string, count: number) {
  return Array.from({ length: count }, (_, index) =>
    makeCase({
      id: `fresh-${index + 1}`,
      benchmarkProject: "todo-ts",
      targetRoot,
      absoluteTargetRoot: targetRoot,
      sourceRoots: ["src"],
      rawIncludeGlobs: ["src/**/*"],
    })
  );
}

async function execute(kitCommand: string, cases: ReturnType<typeof casesFor>): Promise<WarmIndexProjectExecutionV1[]> {
  return executeWarmIndexReuse({ cases, kitCommand, outputRoot: tempDir("warm-fresh-out-") });
}

const statuses = (projects: WarmIndexProjectExecutionV1[]) =>
  projects.flatMap((project) => [project.status, ...project.tasks.flatMap((task) => [task.status, task.rawStatus, task.warmStatus])]);

describe("warm-index per-task freshness assessment", () => {
  // TST-B2-014, TST-B2-015, TST-B2-016, TST-B2-022, TST-B2-023
  it("assesses immediately before each warm retrieval, never gates it, and leaves every status unchanged", async () => {
    const { targetRoot, changed } = makeTarget();
    const kit = writeSnapshotFakeKit(tempDir("warm-fresh-kit-"), { mutateOnFirstSearch: changed });
    const control = writeSnapshotFakeKit(tempDir("warm-fresh-control-"));
    const controlTarget = makeTarget();

    const projects = await execute(kit.command, casesFor(targetRoot, 2));
    const controlProjects = await execute(control.command, casesFor(controlTarget.targetRoot, 2));

    const [first, second] = projects[0].tasks;
    expect(first.indexFreshness?.status).toBe("fresh");
    expect(second.indexFreshness?.status).toBe("stale");
    expect(second.indexFreshness?.changes.map((change) => [change.path, change.changeType])).toEqual([["src/a.ts", "modified"]]);
    expect(second.indexFreshness?.baselineSnapshotStatus).toBe("complete");

    // Stale evidence did not suppress or replace the warm retrieval attempt.
    expect(second.warmRetrieval).toBeDefined();
    expect(second.warmRetrieval?.skipped).toBe(false);
    expect(second.warmRetrieval?.commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source"]);

    // Identical execution/aggregate statuses with and without a mid-run source change.
    expect(controlProjects[0].tasks.map((task) => task.indexFreshness?.status)).toEqual(["fresh", "fresh"]);
    expect(statuses(projects)).toEqual(statuses(controlProjects));
    expect(statuses(projects).every((status) => status === "completed")).toBe(true);

    // One index build and one --version probe for the project; none per task.
    const log = readFileSync(kit.logPath, "utf8").trim().split("\n");
    expect(log.filter((line) => line === "index")).toHaveLength(1);
    expect(log.filter((line) => line === "--version")).toHaveLength(1);
    expect(log.filter((line) => line === "search")).toHaveLength(2);
  });

  it("records unknown freshness when no session was prepared, leaving the failed warm status as before", async () => {
    const { targetRoot } = makeTarget();
    const failing = writeFakeKitVariant(tempDir("warm-fresh-fail-"), { failOn: "index" });

    const [project] = await execute(failing, casesFor(targetRoot, 1));
    const [task] = project.tasks;

    expect(project.session).toBeUndefined();
    expect(task.warmStatus).toBe("failed");
    expect(task.rawStatus).toBe("completed");
    expect(task.indexFreshness?.status).toBe("unknown");
    expect(task.indexFreshness?.baselineSnapshotStatus).toBe("unavailable");
    expect(task.indexFreshness?.unresolved).toEqual([expect.objectContaining({ path: null, reasonCode: "snapshot-unavailable" })]);
  });

  // TST-B2-017, TST-B2-018, TST-B2-019
  it("persists bounded per-task freshness in the execution artifact without contents, and stays readable without it", async () => {
    const { targetRoot, changed } = makeTarget();
    writeFileSync(changed, "export const SECRET_SOURCE_MARKER = 'never-persist';\n");
    const kit = writeSnapshotFakeKit(tempDir("warm-fresh-kit-"), { mutateOnFirstSearch: changed });

    const projects = await execute(kit.command, casesFor(targetRoot, 2));
    const artifact = buildWarmIndexExecutionArtifact({ runId: "r", pluginId: "warm-index-reuse", projects });
    const text = JSON.stringify(artifact);
    const parsed = JSON.parse(text) as typeof artifact;

    expect(parsed.schemaVersion).toBe("my-dev-kit-lab-warm-index-execution-v1");
    expect(parsed.projects[0].tasks.map((task) => task.indexFreshness?.status)).toEqual(["fresh", "stale"]);
    expect(Object.keys(parsed.projects[0].tasks[1].indexFreshness!).sort()).toEqual([
      "assessedAt",
      "baselineSnapshotStatus",
      "changedFileCount",
      "changes",
      "changesTruncated",
      "comparableFileCount",
      "indexedFileCount",
      "missingFileCount",
      "schemaVersion",
      "status",
      "unchangedFileCount",
      "unresolved",
      "unresolvedFileCount",
      "unresolvedTruncated",
      "warnings",
    ]);
    expect(text).not.toContain("SECRET_SOURCE_MARKER");
    expect(text).not.toContain("contextText");
    expect(text).not.toContain("mutated between tasks");

    // A pre-Batch-2 task summary (no freshness field) is still a valid v1 task summary shape.
    const legacyTask = { ...parsed.projects[0].tasks[0] } as Record<string, unknown>;
    delete legacyTask.indexFreshness;
    expect(Object.keys(legacyTask)).not.toContain("indexFreshness");
    expect(legacyTask.caseId).toBe("fresh-1");
    expect(legacyTask.warmStatus).toBe("completed");
  });

  it("records a null freshness for a task whose warm retrieval was refused before any assessment", async () => {
    const { targetRoot } = makeTarget();
    const kit = writeSnapshotFakeKit(tempDir("warm-fresh-kit-"));
    const [project] = await execute(kit.command, casesFor(targetRoot, 1));
    const artifact = buildWarmIndexExecutionArtifact({ runId: "r", pluginId: "p", projects: [{ ...project, tasks: [{ ...project.tasks[0], indexFreshness: undefined }] }] });

    expect(artifact.projects[0].tasks[0].indexFreshness).toBeNull();
  });
});
