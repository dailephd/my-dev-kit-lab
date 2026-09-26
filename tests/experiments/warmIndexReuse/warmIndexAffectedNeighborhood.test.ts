import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeWarmIndexReuse, type WarmIndexProjectExecutionV1 } from "../../../src/experiments/plugins/warmIndexReuse/execution.js";
import {
  buildWarmIndexExecutionArtifact,
  summarizeProjectExecution,
  WARM_INDEX_EXECUTION_SCHEMA_VERSION,
} from "../../../src/experiments/plugins/warmIndexReuse/executionArtifact.js";
import { makeCase, writeFakeKitVariant, writeGraphFakeKit, writeSnapshotFakeKit } from "./warmIndexTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const SYMBOLS = { "src/a.ts": ["alpha"], "src/b.ts": ["beta"] };
const EDGES: Array<[string, string, string]> = [["file:src/a.ts", "file:src/b.ts", "imports"]];

function makeTarget(): { targetRoot: string; changed: string } {
  const targetRoot = path.join(tempDir("warm-an-target-"), "target");
  mkdirSync(path.join(targetRoot, "src"), { recursive: true });
  writeFileSync(path.join(targetRoot, "src", "a.ts"), "export const alpha = 1;\n");
  writeFileSync(path.join(targetRoot, "src", "b.ts"), "export const beta = 2;\n");
  return { targetRoot, changed: path.join(targetRoot, "src", "a.ts") };
}

/** Cases over the disposable target; `expected` sets each task's expected files/symbols. */
function casesFor(targetRoot: string, expected: Array<{ files: string[]; symbols: string[] }>) {
  return expected.map((entry, index) =>
    makeCase({
      id: `an-${index + 1}`,
      benchmarkProject: "todo-ts",
      targetRoot,
      absoluteTargetRoot: targetRoot,
      sourceRoots: ["src"],
      rawIncludeGlobs: ["src/**/*"],
      expectedFiles: entry.files,
      expectedSymbols: entry.symbols,
    })
  );
}

const TASK_A = { files: ["src/a.ts"], symbols: ["alpha"] };
const statuses = (projects: WarmIndexProjectExecutionV1[]) =>
  projects.flatMap((project) => [project.status, ...project.tasks.flatMap((task) => [task.status, task.rawStatus, task.warmStatus])]);

describe("warm-index per-task affected-neighborhood integration", () => {
  // TST-B3-001, TST-B3-002, TST-B3-038
  it("assesses each task from its own freshness before its retrieval, over one shared session graph", async () => {
    const { targetRoot, changed } = makeTarget();
    const kit = writeGraphFakeKit(tempDir("warm-an-kit-"), { mutateOnFirstSearch: changed, symbols: SYMBOLS, edges: EDGES });

    const [project] = await executeWarmIndexReuse({ cases: casesFor(targetRoot, [TASK_A, TASK_A]), kitCommand: kit.command, outputRoot: tempDir("warm-an-out-") });
    const [first, second] = project.tasks;

    // The kit mutates the file during task 1's search: task 1's freshness (and therefore its
    // assessment) was taken before that retrieval, task 2's after it. Both used their own freshness.
    expect(first.indexFreshness?.status).toBe("fresh");
    expect(first.affectedNeighborhood?.freshnessStatus).toBe("fresh");
    expect(first.affectedNeighborhood?.seedNodeCount).toBe(0);
    expect(first.affectedNeighborhood).toMatchObject({ status: "complete", relationship: "unrelated", reindexRecommendation: "not-indicated" });

    expect(second.indexFreshness?.status).toBe("stale");
    expect(second.affectedNeighborhood?.freshnessStatus).toBe("stale");
    expect(second.affectedNeighborhood).toMatchObject({
      status: "complete",
      changedFileCount: 1,
      changedSymbolCount: 1,
      seedNodeCount: 2,
      relationship: "related",
      reindexRecommendation: "recommended",
    });
    // The seed a.ts and its symbol plus one-hop neighbor b.ts (imports edge, either direction).
    expect(second.affectedNeighborhood?.affectedNodeIds).toEqual(["file:src/a.ts", "file:src/b.ts", "symbol:src/a.ts#alpha"]);
    expect(second.affectedNeighborhood?.taskOverlapCount).toBe(2);

    // One session and one graph instance for the whole project; no extra kit command per task.
    expect(project.session?.affectedNeighborhoodGraph.status).toBe("complete");
    const log = readFileSync(kit.logPath, "utf8").trim().split("\n");
    expect(log.filter((line) => line === "index")).toHaveLength(1);
    expect(log.filter((line) => line === "search")).toHaveLength(2);
    expect(log.filter((line) => !["index", "--version", "search", "lookup", "slice", "source"].includes(line))).toEqual([]);
  });

  it("does not reread the graph artifact for later tasks", async () => {
    const { targetRoot } = makeTarget();
    const outputRoot = tempDir("warm-an-out-");
    // Corrupt the graph artifact during task 1's search; a per-task reread would degrade task 2.
    const graphPath = path.join(outputRoot, "indexes", "todo-ts", "code-graph.json");
    const kit = writeGraphFakeKit(tempDir("warm-an-kit-"), { mutateOnFirstSearch: graphPath, symbols: SYMBOLS, edges: EDGES });

    const [project] = await executeWarmIndexReuse({ cases: casesFor(targetRoot, [TASK_A, TASK_A]), kitCommand: kit.command, outputRoot });

    expect(readFileSync(graphPath, "utf8")).toContain("mutated between tasks");
    expect(project.tasks.map((task) => task.affectedNeighborhood?.graphEvidenceStatus)).toEqual(["complete", "complete"]);
    expect(project.tasks.map((task) => task.affectedNeighborhood?.status)).toEqual(["complete", "complete"]);
  });

  // TST-B3-003, TST-B3-004
  it("never gates retrieval or changes any status, even when the assessment is unavailable", async () => {
    const withGraph = makeTarget();
    const withoutGraph = makeTarget();
    const graphKit = writeGraphFakeKit(tempDir("warm-an-kit-"), { mutateOnFirstSearch: withGraph.changed, symbols: SYMBOLS, edges: EDGES });
    // No code graph: graph evidence is partial and the assessment is unavailable.
    const bareKit = writeSnapshotFakeKit(tempDir("warm-an-bare-"), { mutateOnFirstSearch: withoutGraph.changed });

    const [related] = await executeWarmIndexReuse({ cases: casesFor(withGraph.targetRoot, [TASK_A, TASK_A]), kitCommand: graphKit.command, outputRoot: tempDir("warm-an-out-") });
    const [bare] = await executeWarmIndexReuse({ cases: casesFor(withoutGraph.targetRoot, [TASK_A, TASK_A]), kitCommand: bareKit.command, outputRoot: tempDir("warm-an-out-") });

    expect(bare.tasks.map((task) => task.affectedNeighborhood?.status)).toEqual(["unavailable", "unavailable"]);
    expect(bare.tasks.every((task) => task.warmRetrieval !== undefined && task.warmRetrieval.skipped === false)).toBe(true);
    expect(bare.tasks.map((task) => task.warmRetrieval?.commands.map((command) => command.commandId))).toEqual([
      ["search", "lookup", "slice", "source"],
      ["search", "lookup", "slice", "source"],
    ]);
    expect(statuses([bare])).toEqual(statuses([related]));
    expect(statuses([bare]).every((status) => status === "completed")).toBe(true);
    expect(bare.tasks.map((task) => task.warmStatus)).toEqual(["completed", "completed"]);
  });

  // TST-B3-005
  it("records no assessment (null) when no session was prepared and leaves the failed warm status as before", async () => {
    const { targetRoot } = makeTarget();
    const failing = writeFakeKitVariant(tempDir("warm-an-fail-"), { failOn: "index" });

    const [project] = await executeWarmIndexReuse({ cases: casesFor(targetRoot, [TASK_A]), kitCommand: failing, outputRoot: tempDir("warm-an-out-") });
    const [task] = project.tasks;

    expect(project.session).toBeUndefined();
    expect(task.affectedNeighborhood).toBeNull();
    expect(task.warmStatus).toBe("failed");
    expect(task.rawStatus).toBe("completed");
    expect(task.indexFreshness?.status).toBe("unknown");
    expect(task.errors.map((error) => error.code)).toContain("warm-index-setup-failed");
  });

  // TST-B3-006 (structurally inconsistent group: no session, no assessment)
  it("records no assessment when the group is structurally inconsistent, as before", async () => {
    const first = makeTarget();
    const second = makeTarget();
    const kit = writeGraphFakeKit(tempDir("warm-an-kit-"), { symbols: SYMBOLS, edges: EDGES });
    const cases = [...casesFor(first.targetRoot, [TASK_A]), ...casesFor(second.targetRoot, [TASK_A]).map((benchmarkCase) => ({ ...benchmarkCase, id: "an-other" }))];

    const [project] = await executeWarmIndexReuse({ cases, kitCommand: kit.command, outputRoot: tempDir("warm-an-out-") });

    expect(project.session).toBeUndefined();
    expect(project.tasks.map((task) => task.affectedNeighborhood)).toEqual([null, null]);
    expect(project.tasks[0].errors.map((error) => error.code)).toContain("warm-index-group-inconsistent");
  });
});

describe("warm-index execution artifact affected-neighborhood persistence", () => {
  async function relatedProject() {
    const { targetRoot, changed } = makeTarget();
    const kit = writeGraphFakeKit(tempDir("warm-an-kit-"), { mutateOnFirstSearch: changed, symbols: SYMBOLS, edges: EDGES });
    const [project] = await executeWarmIndexReuse({ cases: casesFor(targetRoot, [TASK_A, TASK_A]), kitCommand: kit.command, outputRoot: tempDir("warm-an-out-") });
    return project;
  }

  // TST-B3-007, TST-B3-010, TST-B3-011, TST-B3-012
  it("persists the bounded assessment additively under the unchanged v1 schema, without the graph", async () => {
    const project = await relatedProject();
    const artifact = buildWarmIndexExecutionArtifact({ runId: "r", pluginId: "warm-index-reuse", projects: [project] });
    const text = JSON.stringify(artifact);
    const parsed = JSON.parse(text) as typeof artifact;

    expect(parsed.schemaVersion).toBe(WARM_INDEX_EXECUTION_SCHEMA_VERSION);
    expect(parsed.schemaVersion).toBe("my-dev-kit-lab-warm-index-execution-v1");
    const persisted = parsed.projects[0].tasks[1].affectedNeighborhood;
    expect(persisted).toEqual(project.tasks[1].affectedNeighborhood);
    expect(persisted).toMatchObject({ relationship: "related", reindexRecommendation: "recommended" });
    expect(persisted?.schemaVersion).toBe("my-dev-kit-lab-affected-neighborhood-assessment-v1");

    // No graph nodes/edges, symbol index, or session graph object leaks into task persistence.
    expect(text).not.toContain("affectedNeighborhoodGraph");
    expect(text).not.toContain("codeGraph");
    expect(text).not.toContain("symbolFiles");
    expect(text).not.toContain('"nodes"');
    expect(text).not.toContain('"edges"');
    // Only the analytical identity arrays are persisted, not node or edge records.
    expect(persisted?.participatingEdgeIds).toEqual(["file:src/a.ts--defines-->symbol:src/a.ts#alpha", "file:src/a.ts--imports-->file:src/b.ts"]);
    expect(text).not.toContain('"kind":"defines"');
    expect(text).not.toContain('"kind":"imports"');
    expect(text).not.toContain('"source":"file:');

    // Deterministic: a second serialization of the same execution is byte-equivalent for the assessment.
    const again = JSON.stringify(buildWarmIndexExecutionArtifact({ runId: "r", pluginId: "warm-index-reuse", projects: [project] }).projects[0].tasks[1].affectedNeighborhood);
    expect(again).toBe(JSON.stringify(persisted));
    // The persisted copy is independent of the in-memory task evidence.
    expect(persisted).not.toBe(project.tasks[1].affectedNeighborhood);
  });

  // TST-B3-008
  it("persists null for a task whose assessment was not performed", async () => {
    const { targetRoot } = makeTarget();
    const failing = writeFakeKitVariant(tempDir("warm-an-fail-"), { failOn: "index" });
    const [project] = await executeWarmIndexReuse({ cases: casesFor(targetRoot, [TASK_A]), kitCommand: failing, outputRoot: tempDir("warm-an-out-") });

    const artifact = buildWarmIndexExecutionArtifact({ runId: "r", pluginId: "p", projects: [project] });

    expect(artifact.projects[0].tasks[0]).toHaveProperty("affectedNeighborhood", null);
    expect(JSON.parse(JSON.stringify(artifact)).projects[0].tasks[0].affectedNeighborhood).toBeNull();
  });

  // TST-B3-009
  it("keeps a legacy task summary without the key readable and distinguishable from null", async () => {
    const project = await relatedProject();
    const summary = summarizeProjectExecution(project);
    const legacyTask = { ...JSON.parse(JSON.stringify(summary.tasks[0])) } as Record<string, unknown>;
    delete legacyTask.affectedNeighborhood;

    expect("affectedNeighborhood" in legacyTask).toBe(false);
    expect(legacyTask.affectedNeighborhood).toBeUndefined();
    expect(legacyTask.caseId).toBe("an-1");
    expect(legacyTask.warmStatus).toBe("completed");
    expect(summary.tasks[0].affectedNeighborhood).not.toBeUndefined();
    expect(summary.tasks[0].affectedNeighborhood).not.toBeNull();
  });

  // TST-B3-040
  it("keeps the existing task evidence unchanged apart from the additive field", async () => {
    const project = await relatedProject();
    const summary = summarizeProjectExecution(project);

    const keys = Object.keys(summary.tasks[0]).sort();
    expect(keys).toEqual(["affectedNeighborhood", "caseId", "errors", "indexFreshness", "rawBaseline", "rawStatus", "status", "warmRetrieval", "warmStatus", "warnings"]);
    expect(summary.tasks[0].indexFreshness?.status).toBe("fresh");
    expect(summary.tasks[0].warmRetrieval?.commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source"]);
  });
});
