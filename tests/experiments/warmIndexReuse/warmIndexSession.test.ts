import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMyDevKitRetrievalFromIndex } from "../../../src/evaluation/runMyDevKitRetrieval.js";
import type { EvaluationCase } from "../../../src/evaluation/types.js";
import {
  assertWarmIndexSessionMatchesTarget,
  prepareWarmIndexSession
} from "../../../src/experiments/plugins/warmIndexReuse/warmIndexSession.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const fakeKitCommand = `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`;

const baseCase: EvaluationCase = {
  id: "todo-ts-create-task",
  title: "Case",
  benchmarkProject: "todo-ts",
  targetRoot: "benchmarks/projects/todo-ts",
  absoluteTargetRoot: path.resolve(process.cwd(), "benchmarks/projects/todo-ts"),
  sourceRoots: ["src", "tests"],
  query: "create task deterministic id task-1",
  expectedFiles: ["src/taskService.ts"],
  expectedSymbols: ["createTask"],
  rawIncludeGlobs: ["src/**/*", "tests/**/*"]
};

function tempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "warm-index-"));
  tempDirs.push(dir);
  return dir;
}

describe("prepareWarmIndexSession", () => {
  it("retains one index path, target identity, source roots, and one-time build evidence without task state", async () => {
    const root = tempRoot();
    const indexDir = path.join(root, "indexes", "todo-ts");
    const sourceRoots = ["src", "tests"];
    const prepared = await prepareWarmIndexSession({
      target: { absoluteTargetRoot: baseCase.absoluteTargetRoot, sourceRoots },
      kitCommand: fakeKitCommand,
      indexDir,
      commandsDir: path.join(root, "commands", "index"),
      requireKit: true
    });
    if (!prepared.ok) {
      throw new Error("expected a prepared session");
    }
    const { session } = prepared;

    expect(Object.keys(session).sort()).toEqual(["buildCommand", "buildDurationMs", "indexDir", "sourceRoots", "targetRoot"]);
    expect(session.indexDir).toBe(indexDir);
    expect(session.targetRoot).toBe(baseCase.absoluteTargetRoot);
    expect(session.sourceRoots).toEqual(["src", "tests"]);
    expect(session.buildCommand.commandId).toBe("index");
    expect(session.buildDurationMs).toBe(session.buildCommand.durationMs);
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.sourceRoots)).toBe(true);

    sourceRoots.push("mutated");
    expect(session.sourceRoots).toEqual(["src", "tests"]);
  });

  it("is passed explicitly to several tasks that retrieve against the same index without re-indexing", async () => {
    const root = tempRoot();
    const prepared = await prepareWarmIndexSession({
      target: baseCase,
      kitCommand: fakeKitCommand,
      indexDir: path.join(root, "indexes", "todo-ts"),
      commandsDir: path.join(root, "commands", "index"),
      requireKit: true
    });
    if (!prepared.ok) {
      throw new Error("expected a prepared session");
    }
    const { session } = prepared;

    for (const id of ["task-a", "task-b"]) {
      const evaluationCase = { ...baseCase, id };
      assertWarmIndexSessionMatchesTarget(session, evaluationCase);
      const result = await runMyDevKitRetrievalFromIndex({
        evaluationCase,
        kitCommand: fakeKitCommand,
        indexDir: session.indexDir,
        commandsDir: path.join(root, "commands", id),
        requireKit: true
      });
      expect(result.commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source"]);
    }
  });

  it("does not produce a session when the index command fails", async () => {
    const root = tempRoot();
    const options = {
      target: baseCase,
      kitCommand: "definitely-not-a-real-command",
      indexDir: path.join(root, "index"),
      commandsDir: path.join(root, "commands"),
      requireKit: false
    };
    const prepared = await prepareWarmIndexSession(options);
    expect(prepared.ok).toBe(false);
    expect(prepared).not.toHaveProperty("session");
    expect(prepared.ok ? [] : prepared.warnings).toEqual(["my-dev-kit index command was unavailable or failed."]);

    await expect(prepareWarmIndexSession({ ...options, requireKit: true })).rejects.toThrow();
  });

  it("does not produce a session when the index command succeeds without creating the index directory", async () => {
    const root = tempRoot();
    const options = {
      target: baseCase,
      kitCommand: `node -e "process.exit(0)"`,
      indexDir: path.join(root, "index"),
      commandsDir: path.join(root, "commands"),
      requireKit: false
    };
    const prepared = await prepareWarmIndexSession(options);
    expect(prepared.ok).toBe(false);
    expect(prepared.ok ? [] : prepared.warnings).toEqual([
      `my-dev-kit index reported success but index directory is missing: ${options.indexDir}`
    ]);

    await expect(prepareWarmIndexSession({ ...options, requireKit: true })).rejects.toThrow("index directory is missing");
  });
});

describe("assertWarmIndexSessionMatchesTarget", () => {
  async function prepareSession() {
    const root = tempRoot();
    const prepared = await prepareWarmIndexSession({
      target: baseCase,
      kitCommand: fakeKitCommand,
      indexDir: path.join(root, "indexes", "todo-ts"),
      commandsDir: path.join(root, "commands"),
      requireKit: true
    });
    if (!prepared.ok) {
      throw new Error("expected a prepared session");
    }
    return prepared.session;
  }

  it("rejects reuse against a different target root", async () => {
    const session = await prepareSession();
    expect(() =>
      assertWarmIndexSessionMatchesTarget(session, {
        absoluteTargetRoot: path.resolve(process.cwd(), "benchmarks/projects/todo-js"),
        sourceRoots: ["src", "tests"]
      })
    ).toThrow("target root");
  });

  it("rejects reuse against a different source-root configuration", async () => {
    const session = await prepareSession();
    expect(() => assertWarmIndexSessionMatchesTarget(session, { ...baseCase, sourceRoots: ["src"] })).toThrow("source roots");
    expect(() => assertWarmIndexSessionMatchesTarget(session, { ...baseCase, sourceRoots: ["tests", "src"] })).toThrow("source roots");
  });
});
