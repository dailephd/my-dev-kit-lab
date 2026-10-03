import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Records every file the profile code reads, while still delegating to the real implementation.
const readPaths: string[] = [];
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((...callArgs: Parameters<typeof original.readFileSync>) => {
    readPaths.push(String(callArgs[0]));
    return original.readFileSync(...callArgs);
  }) as typeof original.readFileSync;
  return { ...original, readFileSync, default: { ...original, readFileSync } };
});

import { calculateProjectComplexityScore, PROJECT_COMPLEXITY_FORMULA } from "../../src/evaluation/projectComplexity.js";
import { buildProjectFileTree } from "../../src/evaluation/projectFileTree.js";
import type { EvaluationCase } from "../../src/evaluation/types.js";
import { resolveScalingProjectProfiles } from "../../src/experiments/plugins/contextWindowScaling/projectProfile.js";

const FILES: Record<string, string> = {
  "src/a.ts": "import { b } from './b';\nexport function a() { return b(); }\n",
  "src/b.ts": "export function b() { return 1; }\n",
  "src/sub/c.ts": "export class C {}\n",
  "tests/a.test.ts": "import { a } from '../src/a';\n",
  "README.md": "# readme\n",
  "package.json": '{"name":"x","dependencies":{"left-pad":"1"}}\n',
  "dist/out.js": "built\n",
  "node_modules/m/index.js": "module\n",
};
const SECRET = "src/secret-ignored.ts";
const HUGE = "src/huge.ts";
const LINKED = "src/linked.ts";

let root: string;
beforeEach(() => {
  readPaths.length = 0;
  root = mkdtempSync(path.join(os.tmpdir(), "lrs-profile-"));
  for (const [file, content] of Object.entries({
    ...FILES,
    [SECRET]: "export const secret = 1; // PROFILE_SECRET_MARKER\n",
    [HUGE]: `// PROFILE_HUGE_MARKER\n${"x".repeat(5000)}\n`,
    [LINKED]: "export const linked = 1; // PROFILE_LINKED_MARKER\n",
  })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const ELIGIBLE = ["README.md", "package.json", "src/a.ts", "src/b.ts", "src/sub/c.ts", "tests/a.test.ts"];
const read = () => readPaths.map((entry) => entry.replace(/\\/g, "/"));

function makeCase(): EvaluationCase {
  return {
    id: "case-one",
    title: "t",
    benchmarkProject: "subject-x",
    targetRoot: "local-repository:subject-x",
    sourceRoots: ["src"],
    query: "q",
    expectedFiles: ["src/a.ts"],
    expectedSymbols: ["a"],
    rawIncludeGlobs: ["src/**/*"],
    absoluteTargetRoot: root,
  };
}

describe("RSP-016 allowlisted project file tree", () => {
  it("equals the legacy walk when the allowlist lists every non-excluded file", () => {
    const legacy = buildProjectFileTree(root);
    const everyFile = [...ELIGIBLE, SECRET, HUGE, LINKED, "dist/out.js", "node_modules/m/index.js"];
    expect(buildProjectFileTree(root, { allowedRelativeFiles: everyFile }).entries).toEqual(legacy.entries);
  });

  it("lists and opens only allowed files", () => {
    readPaths.length = 0;
    const tree = buildProjectFileTree(root, { allowedRelativeFiles: ELIGIBLE });
    const files = tree.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path);
    // Same locale-aware ordering as the legacy walk (the equivalence test above is the actual contract).
    expect(files).toEqual(["package.json", "README.md", "src/a.ts", "src/b.ts", "src/sub/c.ts", "tests/a.test.ts"]);
    for (const hidden of [SECRET, HUGE, LINKED, "dist/out.js", "node_modules/m/index.js"]) {
      expect(tree.entries.some((entry) => entry.path === hidden)).toBe(false);
      expect(read().some((entry) => entry.endsWith(hidden))).toBe(false);
    }
    expect(tree.entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path)).toEqual(["src", "src/sub", "tests"]);
  });

  it("is independent of the order of the allowlist and never walks the directory", () => {
    const forward = buildProjectFileTree(root, { allowedRelativeFiles: ELIGIBLE });
    const backward = buildProjectFileTree(root, { allowedRelativeFiles: [...ELIGIBLE].reverse() });
    expect(backward.entries).toEqual(forward.entries);
    const empty = buildProjectFileTree(root, { allowedRelativeFiles: [] });
    expect(empty.entries).toEqual([]);
  });
});

describe("RSP-016 local project profiles", () => {
  it("derives profiles from eligible files only and never opens excluded files", () => {
    readPaths.length = 0;
    const [profile] = resolveScalingProjectProfiles([makeCase()], [], { eligibleFiles: ELIGIBLE });
    expect(profile.projectId).toBe("subject-x");
    expect(profile.rootPath).toBe("local-repository:subject-x");
    expect(profile.complexityMetrics.fileCount).toBe(ELIGIBLE.length);
    expect(profile.fileTree.entries.filter((entry) => entry.kind === "file")).toHaveLength(ELIGIBLE.length);
    for (const hidden of [SECRET, HUGE, LINKED, "dist/out.js", "node_modules/m/index.js"]) {
      expect(read().some((entry) => entry.endsWith(hidden))).toBe(false);
    }
    expect(JSON.stringify(profile)).not.toContain("PROFILE_");
  });

  it("matches the legacy profile exactly when the allowlist equals what the legacy walk finds", () => {
    const legacyOnly = ["README.md", "package.json", "src/a.ts", "src/b.ts", "src/sub/c.ts", "src/secret-ignored.ts", "src/huge.ts", "src/linked.ts", "tests/a.test.ts"];
    const [legacy] = resolveScalingProjectProfiles([makeCase()], []);
    const [allowlisted] = resolveScalingProjectProfiles([makeCase()], [], { eligibleFiles: legacyOnly });
    expect(allowlisted).toEqual(legacy);
  });

  it("keeps the complexity formula and score calculation unchanged", () => {
    const [profile] = resolveScalingProjectProfiles([makeCase()], [], { eligibleFiles: ELIGIBLE });
    expect(profile.complexityFormula).toBe(PROJECT_COMPLEXITY_FORMULA);
    expect(profile.complexityScore).toBe(calculateProjectComplexityScore(profile.complexityMetrics));
  });

  it("still lets a supplied profile win and leaves bundled behavior (no options) walking the target", () => {
    const [supplied] = resolveScalingProjectProfiles([makeCase()], []);
    const [again] = resolveScalingProjectProfiles([makeCase()], [supplied], { eligibleFiles: ELIGIBLE });
    expect(again).toBe(supplied);
    readPaths.length = 0;
    resolveScalingProjectProfiles([makeCase()], []);
    // Legacy derivation opens every non-excluded file, including the ones a local subject must never open.
    expect(read().some((entry) => entry.endsWith(SECRET))).toBe(true);
  });
});
