import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { createLabExecutionContext } from "../../src/runtime/index.js";
import { makeTempDir, minimalCase, minimalConfig, removeTempDir } from "../evaluation/localRepositorySubject/fixtureRepository.js";
import { MARKERS, createLocalSubjectFixture, git, listTree } from "../experiments/contextWindowScaling/localSubjectFixture.js";
import type { LocalSubjectFixture } from "../experiments/contextWindowScaling/localSubjectFixture.js";

/**
 * Opt-in smoke of the PUBLIC command with the real published my-dev-kit CLI (needs the package installed or
 * fetchable, so it is not part of the offline default suite). It checks composition only: command compatibility,
 * indexing, execution success, target immutability, scratch cleanup and privacy-safe output. It computes and asserts
 * no retrieval-quality measure.
 *   LAB_REAL_MY_DEV_KIT=1 npx vitest run tests/commands/contextWindowScalingLocalSubjectRealKit.spec.ts
 */
const enabled = Boolean(process.env.LAB_REAL_MY_DEV_KIT);
const kitCommand = process.env.LAB_REAL_MY_DEV_KIT_COMMAND || "npx @dailephd/my-dev-kit@latest";
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

let fixture: LocalSubjectFixture;
let extra: string[];
beforeEach(async () => {
  if (!enabled) return;
  extra = [];
  fixture = await createLocalSubjectFixture({ hugeFileBytes: 1_048_576 + 100 });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (!enabled) return;
  for (const directory of [...fixture.directories, ...extra]) removeTempDir(directory);
});

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]
  );
}

describe.skipIf(!enabled)("public external-local run with the real my-dev-kit", () => {
  it("composes: indexes, runs, leaves the target unchanged, cleans scratch, and writes privacy-safe output", async () => {
    const parent = makeTempDir("lrs-b3-real-");
    extra.push(parent);
    const configPath = path.join(parent, "local-subject.json");
    writeFileSync(configPath, JSON.stringify(minimalConfig({ cases: [minimalCase({ rawIncludeGlobs: ["src/**/*"], expectedFiles: ["src/main.ts"] })] })));
    const outDir = path.join(parent, "run");
    const treeBefore = listTree(fixture.root);
    const statusBefore = git(fixture.root, "status", "--porcelain=v1");
    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a.join(" ")));

    const code = await runExperimentRunCommandFromArgs(
      ["--experiment", "context-window-scaling", "--target", fixture.root, "--local-subject-config", configPath, "--context-budgets", "8k,16k", "--kit-command", kitCommand, "--out", outDir],
      { context: createLabExecutionContext({ invocationCwd: process.cwd() }) }
    );
    expect(code, errors.join("\n")).toBe(0);
    expect(logs.join("\n")).toContain("Status: completed");

    expect(listTree(fixture.root)).toEqual(treeBefore);
    expect(git(fixture.root, "status", "--porcelain=v1")).toBe(statusBefore);
    expect(readdirSync(outDir).some((entry) => /^s-/.test(entry))).toBe(false);
    expect(existsSync(path.join(fixture.root, ".my-dev-kit"))).toBe(false);

    const variants = (value: string) => {
      const base = [value, value.replace(/\\/g, "/"), value.replace(/\//g, "\\")];
      return [...new Set([...base, ...base.map((entry) => JSON.stringify(entry).slice(1, -1))])];
    };
    const forbidden = [...variants(fixture.root), ...variants(parent), os.homedir(), ...Object.values(MARKERS), "ignored.ts", "huge.ts", "linked.ts", "src/main.ts", "helper.ts"];
    const files = walk(outDir).map((file) => path.relative(outDir, file).replace(/\\/g, "/")).sort();
    expect(files).toEqual(["context-window-scaling-execution.json", "local-repository-subject-manifest.json", "report.html", "report.json", "report.txt"]);
    for (const file of walk(outDir)) {
      const text = readFileSync(file, "utf8");
      for (const value of forbidden) expect(text.includes(value), `${path.basename(file)} contains ${value}`).toBe(false);
    }
  });
});
