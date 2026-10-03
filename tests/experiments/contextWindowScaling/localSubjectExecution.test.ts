import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRawFullFileBaseline } from "../../../src/evaluation/runRawFullFileBaseline.js";
import { captureTargetSnapshot, compareTargetSnapshots } from "../../../src/evaluation/targetImmutability/index.js";
import { CONTEXT_WINDOW_SCALING_TREATMENT_IDS } from "../../../src/experiments/plugins/contextWindowScaling/metadata.js";
import { LocalSubjectExecutionError } from "../../../src/experiments/plugins/contextWindowScaling/localSubjectErrors.js";
import { executeLocalRepositorySubjectContextWindowScaling } from "../../../src/experiments/plugins/contextWindowScaling/localSubjectExecution.js";
import { removeTempDir } from "../../evaluation/localRepositorySubject/fixtureRepository.js";
import {
  FIXTURE_MAX_FILE_BYTES,
  MARKERS,
  createLocalSubjectFixture,
  git,
  listTree,
  makeTempDir,
  minimalCase,
  readKitLog,
  writeRecordingFakeKit,
  writeRepositoryFile,
} from "./localSubjectFixture.js";
import type { LocalSubjectFixture } from "./localSubjectFixture.js";

// Each case runs real git, node and fake-agent subprocesses; allow for a loaded machine without changing global config.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const BUDGETS = [50, 100_000];

let fixture: LocalSubjectFixture;
let kitDirectory: string;
let kitCommand: string;
let logPath: string;

beforeEach(async () => {
  fixture = await createLocalSubjectFixture();
  kitDirectory = makeTempDir("lrs-b2-kit-");
  kitCommand = writeRecordingFakeKit(kitDirectory).command;
  logPath = path.join(kitDirectory, "log.jsonl");
  process.env.LRS_FAKE_KIT_LOG = logPath;
  delete process.env.LRS_FAKE_KIT_FILE;
});

afterEach(() => {
  delete process.env.LRS_FAKE_KIT_LOG;
  delete process.env.LRS_FAKE_KIT_FILE;
  for (const directory of [...fixture.directories, kitDirectory]) removeTempDir(directory);
});

function args(overrides: Record<string, unknown> = {}) {
  return {
    subject: fixture.subject,
    contextBudgets: BUDGETS,
    kitCommand,
    workRoot: fixture.workRoot,
    ...overrides,
  };
}

function snapshotConfig() {
  return { targetRootPath: fixture.root, relativeFilePaths: fixture.subject.eligibleFiles };
}
const SAFE = { externalLocalSafe: { maxHashedFileBytes: FIXTURE_MAX_FILE_BYTES } };

async function rejection(promise: Promise<unknown>): Promise<LocalSubjectExecutionError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LocalSubjectExecutionError);
    return error as LocalSubjectExecutionError;
  }
  throw new Error("expected LocalSubjectExecutionError");
}

function workRootEntries(): string[] {
  return existsSync(fixture.workRoot) ? readdirSync(fixture.workRoot) : [];
}

describe("RSP-017 and RSP-011 end-to-end local execution on a clean target", () => {
  it("returns existing per-case evidence, reuses one repository, leaves the target and work root clean", async () => {
    const treeBefore = listTree(fixture.root);
    const statusBefore = git(fixture.root, "status", "--porcelain=v1");
    const result = await executeLocalRepositorySubjectContextWindowScaling(args());

    expect(result.caseEvidence).toHaveLength(1);
    const [evidence] = result.caseEvidence;
    expect(evidence.caseId).toBe("case-one");
    expect(evidence.targetRoot).toBe("local-repository:fixture-subject");
    expect(evidence.treatments.map((treatment) => treatment.variantId)).toEqual([...CONTEXT_WINDOW_SCALING_TREATMENT_IDS]);
    for (const treatment of evidence.treatments) {
      expect(treatment.errors).toEqual([]);
      expect(treatment.budgetCells).toHaveLength(BUDGETS.length);
      expect(treatment.context.status).toBe("available");
    }
    const raw = evidence.treatments.find((treatment) => treatment.variantId === "raw-full-file");
    expect(raw?.context.observedFiles).toEqual(["src/main.ts", "src/util/helper.ts"]);
    expect(result.immutability).toEqual({ status: "unchanged", preExistingGitStatusEntryCount: statusBefore.split("\n").filter(Boolean).length, newMutationCount: 0 });

    expect(listTree(fixture.root)).toEqual(treeBefore);
    expect(git(fixture.root, "status", "--porcelain=v1")).toBe(statusBefore);
    expect(workRootEntries()).toEqual([]);
    for (const forbidden of [".my-dev-kit", ".my-dev-kit-lab", "lab-output"]) {
      expect(existsSync(path.join(fixture.root, forbidden))).toBe(false);
    }
    const serialized = JSON.stringify(result);
    for (const privatePath of [fixture.root, fixture.root.replace(/\\/g, "/"), fixture.workRoot, fixture.workRoot.replace(/\\/g, "/")]) {
      expect(serialized).not.toContain(privatePath);
    }
  });

  it("reuses the same repository for every case, treatment and budget without copying it", async () => {
    const twoCases = await createLocalSubjectFixture({
      cases: [
        minimalCase({ rawIncludeGlobs: ["src/**/*"] }),
        minimalCase({ id: "case-two", title: "Find helper", query: "Where is the helper?", expectedFiles: ["src/util/helper.ts"], rawIncludeGlobs: ["src/**/*"] }),
      ],
    });
    fixture.directories.push(...twoCases.directories);
    const result = await executeLocalRepositorySubjectContextWindowScaling({ ...args(), subject: twoCases.subject, workRoot: twoCases.workRoot });
    expect(result.caseEvidence.map((entry) => entry.caseId)).toEqual(["case-one", "case-two"]);
    const indexCommands = readKitLog(logPath).filter((entry) => entry.argv[0] === "index");
    expect(indexCommands).toHaveLength(2);
    for (const command of indexCommands) {
      expect(command.argv[command.argv.indexOf("--root") + 1]).toBe(twoCases.subject.repositoryRoot);
    }
    expect(existsSync(twoCases.workRoot) ? readdirSync(twoCases.workRoot) : []).toEqual([]);
  });
});

describe("RSP-004 and RSP-006 guided retrieval safety", () => {
  it("indexes the original root with the case source roots and exact exclusions and writes only under the work root", async () => {
    await executeLocalRepositorySubjectContextWindowScaling(args());
    const index = readKitLog(logPath).find((entry) => entry.argv[0] === "index");
    expect(index).toBeDefined();
    const argv = index?.argv ?? [];
    expect(argv[argv.indexOf("--root") + 1]).toBe(fixture.subject.repositoryRoot);
    const sources = argv.flatMap((value, position) => (value === "--src" ? [argv[position + 1]] : []));
    expect(sources).toEqual(["src"]);
    const excludes = argv.flatMap((value, position) => (value === "--exclude" ? [argv[position + 1]] : []));
    // src/gen holds only an ignored file, so it collapses to the directory; ignored and oversized files are exact paths.
    expect(excludes).toEqual(["src/gen", "src/huge.ts", "src/ignored.ts"]);
    expect(excludes.every((entry) => entry.includes("/"))).toBe(true);
    const out = argv[argv.indexOf("--out") + 1];
    expect(path.relative(realpathSync(fixture.root), path.resolve(out)).startsWith("..")).toBe(true);
    expect(path.resolve(out).startsWith(realpathSync(path.dirname(fixture.workRoot)))).toBe(true);
  });

  it("fails the treatment and the call when retrieval returns an excluded file", async () => {
    process.env.LRS_FAKE_KIT_FILE = "src/ignored.ts";
    const error = await rejection(executeLocalRepositorySubjectContextWindowScaling(args()));
    expect(error.code).toBe("EXECUTION_FAILED");
    expect(error.message).toContain("outside the eligible subject universe");
    expect(error.message).toContain("src/ignored.ts");
    expect(workRootEntries()).toEqual([]);
  });
});

describe("RSP-007, RSP-008 private scratch lifecycle", () => {
  it("keeps every source-bearing artifact under a scratch outside the target and removes it afterwards", async () => {
    let scratchPath = "";
    let contents: string[] = [];
    await executeLocalRepositorySubjectContextWindowScaling({
      ...args(),
      scratchIo: {
        removeDirectory: async (directory) => {
          scratchPath = directory;
          contents = listTree(directory);
          rmSync(directory, { recursive: true, force: true });
        },
      },
    });
    expect(path.basename(scratchPath)).toMatch(/^s-/);
    expect(path.relative(realpathSync(fixture.root), scratchPath).startsWith("..")).toBe(true);
    expect(path.dirname(scratchPath)).toBe(realpathSync(fixture.workRoot));
    expect(contents.some((entry) => entry.startsWith("guided/") && entry.includes("/indexes/"))).toBe(true);
    expect(contents.some((entry) => entry.startsWith("guided/") && entry.includes("/commands/"))).toBe(true);
    expect(contents.some((entry) => entry.startsWith("agents/"))).toBe(true);
    expect(existsSync(scratchPath)).toBe(false);
    expect(workRootEntries()).toEqual([]);
  });
});

describe("RSP-009 and RSP-010 failure and cleanup semantics", () => {
  it("removes the scratch, keeps the target unchanged and returns no result when a treatment fails", async () => {
    const before = await captureTargetSnapshot(snapshotConfig(), SAFE);
    const error = await rejection(
      executeLocalRepositorySubjectContextWindowScaling(
        args({ dependencies: { constructRawContext: async () => { throw new Error("injected construction failure"); } } })
      )
    );
    expect(error.code).toBe("EXECUTION_FAILED");
    expect(error.message).toContain("injected construction failure");
    expect(error.caseEvidence).not.toBeNull();
    expect(workRootEntries()).toEqual([]);
    const after = await captureTargetSnapshot(snapshotConfig(), SAFE);
    expect(before.ok && after.ok && compareTargetSnapshots(before.snapshot, after.snapshot).status).toBe("unchanged");
  });

  it("reports an execution that throws, redacting private paths, and still cleans the scratch", async () => {
    rmSync(path.join(fixture.root, "src", "util", "helper.ts")); // eligible file vanishes before the run starts
    const error = await rejection(executeLocalRepositorySubjectContextWindowScaling(args()));
    expect(error.code).toBe("EXECUTION_FAILED");
    expect(error.message).toContain("execution threw");
    for (const privatePath of [fixture.root, fixture.root.replace(/\\/g, "/"), fixture.workRoot]) {
      expect(error.message).not.toContain(privatePath);
    }
    expect(workRootEntries()).toEqual([]);
  });

  it("reports an explicit cleanup failure after an otherwise successful run", async () => {
    const error = await rejection(
      executeLocalRepositorySubjectContextWindowScaling({
        ...args(),
        scratchIo: { removeDirectory: async () => { throw new Error("simulated removal failure"); } },
      })
    );
    expect(error.code).toBe("SCRATCH_CLEANUP_FAILED");
    expect(error.issues.map((issue) => issue.code)).toEqual(["SCRATCH_CLEANUP_FAILED"]);
    expect(error.caseEvidence).not.toBeNull();
  });

  it("keeps the primary execution error when cleanup also fails", async () => {
    const error = await rejection(
      executeLocalRepositorySubjectContextWindowScaling({
        ...args({ dependencies: { constructRawContext: async () => { throw new Error("primary failure"); } } }),
        scratchIo: { removeDirectory: async () => { throw new Error("secondary failure"); } },
      })
    );
    expect(error.code).toBe("EXECUTION_FAILED");
    expect(error.issues.map((issue) => issue.code)).toEqual(["EXECUTION_FAILED", "SCRATCH_CLEANUP_FAILED"]);
    expect(error.message).toContain("primary failure");
    expect(error.message).toContain("secondary failure");
  });
});

describe("RSP-012 a pre-existing dirty target stays identically dirty", () => {
  it("allows tracked, staged and untracked changes and leaves the same accepted snapshot", async () => {
    writeRepositoryFile(fixture.root, "src/util/helper.ts", "export const helper = 22; // unstaged edit\n");
    writeRepositoryFile(fixture.root, "src/main.ts", `export const value = 11; // ${MARKERS.eligible} staged edit\n`);
    git(fixture.root, "add", "src/main.ts");
    writeRepositoryFile(fixture.root, "src/extra.ts", "export const extra = 3;\n");
    const before = await captureTargetSnapshot(snapshotConfig(), SAFE);
    const statusBefore = git(fixture.root, "status", "--porcelain=v1");
    const diffBefore = git(fixture.root, "diff", "--binary");
    const cachedBefore = git(fixture.root, "diff", "--cached", "--binary");

    const result = await executeLocalRepositorySubjectContextWindowScaling(args());
    expect(result.immutability.status).toBe("unchanged");
    expect(result.immutability.preExistingGitStatusEntryCount).toBeGreaterThanOrEqual(3);

    const after = await captureTargetSnapshot(snapshotConfig(), SAFE);
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) expect(compareTargetSnapshots(before.snapshot, after.snapshot).status).toBe("unchanged");
    expect(git(fixture.root, "status", "--porcelain=v1")).toBe(statusBefore);
    expect(git(fixture.root, "diff", "--binary")).toBe(diffBefore);
    expect(git(fixture.root, "diff", "--cached", "--binary")).toBe(cachedBefore);
  });
});

describe("RSP-013 mutation detection without auto-revert", () => {
  const raw = (mutate: () => void) => ({
    constructRawContext: async (evaluationCase: Parameters<typeof runRawFullFileBaseline>[0]) => {
      mutate();
      return runRawFullFileBaseline(evaluationCase, { eligibleFiles: fixture.subject.eligibleFiles });
    },
  });

  const scenarios: { name: string; kind: string; prepare?: () => void; mutate: () => void; stillMutated: () => boolean }[] = [
    {
      name: "an edit to a tracked file",
      kind: "git-worktree-diff",
      mutate: () => writeRepositoryFile(fixture.root, "src/util/helper.ts", "export const helper = 'mutated';\n"),
      stillMutated: () => git(fixture.root, "status", "--porcelain=v1").includes("src/util/helper.ts"),
    },
    {
      name: "a new untracked file",
      kind: "git-untracked-file",
      mutate: () => writeRepositoryFile(fixture.root, "src/created-by-run.ts", "export const x = 1;\n"),
      stillMutated: () => existsSync(path.join(fixture.root, "src", "created-by-run.ts")),
    },
    {
      name: "a new file inside an ignored directory",
      kind: "git-ignored-paths",
      mutate: () => writeRepositoryFile(fixture.root, "src/gen/created-by-run.ts", "export const g = 1;\n"),
      stillMutated: () => existsSync(path.join(fixture.root, "src", "gen", "created-by-run.ts")),
    },
    {
      name: "a rewritten oversized untracked file",
      kind: "git-untracked-file",
      prepare: () => writeRepositoryFile(fixture.root, "src/untracked-huge.ts", "y".repeat(FIXTURE_MAX_FILE_BYTES + 50)),
      mutate: () => writeRepositoryFile(fixture.root, "src/untracked-huge.ts", "z".repeat(FIXTURE_MAX_FILE_BYTES + 90)),
      stillMutated: () => readFileSync(path.join(fixture.root, "src", "untracked-huge.ts"), "utf8").startsWith("z"),
    },
  ];

  for (const scenario of scenarios) {
    it(`fails on ${scenario.name}, cleans the scratch, and does not revert`, async () => {
      scenario.prepare?.();
      const error = await rejection(executeLocalRepositorySubjectContextWindowScaling(args({ dependencies: raw(scenario.mutate) })));
      expect(error.code).toBe("TARGET_MUTATED");
      expect(error.immutability?.status).toBe("mutated");
      expect(error.immutability?.mutations.map((mutation) => mutation.kind)).toContain(scenario.kind);
      expect(scenario.stillMutated()).toBe(true);
      expect(workRootEntries()).toEqual([]);
      expect(error.caseEvidence).not.toBeNull();
    });
  }

  it("treats a mutation as a failure even when every treatment passed, and lists it after an execution error", async () => {
    const error = await rejection(
      executeLocalRepositorySubjectContextWindowScaling(
        args({
          dependencies: {
            constructRawContext: async () => {
              writeRepositoryFile(fixture.root, "src/created-by-run.ts", "export const x = 1;\n");
              throw new Error("also failing");
            },
          },
        })
      )
    );
    expect(error.code).toBe("EXECUTION_FAILED");
    expect(error.issues.map((issue) => issue.code)).toEqual(["EXECUTION_FAILED", "TARGET_MUTATED"]);
  });
});

describe("RSP-015 work root containment", () => {
  it("rejects a work root equal to or inside the target before writing anything", async () => {
    const statusBefore = git(fixture.root, "status", "--porcelain=v1");
    const inside = path.join(fixture.root, "lab-work");
    for (const workRoot of [fixture.root, inside, path.join(inside, "deeper")]) {
      const error = await rejection(executeLocalRepositorySubjectContextWindowScaling(args({ workRoot })));
      expect(error.code).toBe("WORK_ROOT_INSIDE_TARGET");
    }
    expect(existsSync(inside)).toBe(false);
    expect(git(fixture.root, "status", "--porcelain=v1")).toBe(statusBefore);
    expect(readKitLog(logPath)).toEqual([]);
  });

  it("accepts a work root outside the target", async () => {
    const result = await executeLocalRepositorySubjectContextWindowScaling(args());
    expect(result.immutability.status).toBe("unchanged");
  });
});

describe("RSP-021 no retrieval-quality metric is introduced", () => {
  const forbidden = /precision|recall|mrr|ranking|winner|irrelevant/i;
  const keys = (value: unknown, found: string[] = []): string[] => {
    if (Array.isArray(value)) value.forEach((entry) => keys(entry, found));
    else if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        found.push(key);
        keys(nested, found);
      }
    }
    return found;
  };

  it("uses no quality-metric names in results or error issues", async () => {
    const result = await executeLocalRepositorySubjectContextWindowScaling(args());
    expect(keys(result).filter((key) => forbidden.test(key))).toEqual([]);
    const error = await rejection(executeLocalRepositorySubjectContextWindowScaling(args({ workRoot: fixture.root })));
    expect(keys(error.issues).filter((key) => forbidden.test(key))).toEqual([]);
    expect(error.issues.every((issue) => !forbidden.test(issue.code))).toBe(true);
  });
});

describe("local execution never leaves private content in the target", () => {
  it("does not copy eligible or excluded content into the target or work root", async () => {
    await executeLocalRepositorySubjectContextWindowScaling(args());
    for (const relativePath of listTree(fixture.root)) {
      expect(["src/main.ts", "src/util/helper.ts", "src/huge.ts", "src/ignored.ts", "src/gen/out.ts", "src/linked.ts", ".gitignore"]).toContain(relativePath);
    }
    expect(workRootEntries()).toEqual([]);
  });
});
