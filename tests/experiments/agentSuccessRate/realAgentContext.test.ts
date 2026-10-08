import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { snapshotProjectTree } from "../../../src/evaluation/benchmarkSandbox/index.js";
import {
  AgentSuccessPackContextBuilder,
  buildContextTaskInput,
  buildRawFullFileContext,
  isEligibleSourcePath,
  sourcePathOfNodeId
} from "../../../src/experiments/plugins/agentSuccessRate/index.js";
import {
  GRAPH_DEPTH,
  MAX_SEED_NODES,
  MAX_SOURCE_SLICES,
  SEARCH_RESULT_LIMIT
} from "../../../src/experiments/plugins/contextPackGeneration/packSelectionPolicy.js";
import { FIXTURE_FILES, makeTempDir, writeProjectFiles } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { makeTask } from "./agentSuccessRateTestHelpers.js";
import { TEST_DECOY_MARKER, TEST_DECOY_PATH, makeSourceBackedKit } from "./realAgentTestHelpers.js";

const TRUSTED_MARKER = "TRUSTED_TEST_FILE_CONTENT_MARKER_b81f";

function makeProject(extra: Record<string, string | Buffer> = {}): string {
  const root = path.join(makeTempDir("lab-asr-ctx-project-"), "project");
  mkdirSync(root, { recursive: true });
  writeProjectFiles(root, {
    ...FIXTURE_FILES,
    "src/math.test.cjs": `// ${TRUSTED_MARKER} test-like file inside src\n`,
    "tests/task.check.cjs": `// ${TRUSTED_MARKER}\n${FIXTURE_FILES["tests/task.check.cjs"]}`,
    ...extra
  });
  return root;
}

const builders: AgentSuccessPackContextBuilder[] = [];
afterEach(async () => {
  await Promise.all(builders.splice(0).map((builder) => builder.dispose()));
});

function packBuilder(kit = makeSourceBackedKit()) {
  const builder = new AgentSuccessPackContextBuilder("fake-kit", kit.dependencies);
  builders.push(builder);
  return { builder, kit };
}

describe("REA raw-full-file context", () => {
  it("REA-013/REA-014 includes only eligible source files and never trusted test files", async () => {
    const root = makeProject();
    const task = makeTask();
    const result = await buildRawFullFileContext(buildContextTaskInput(task), root);
    expect(result.availability).toBe("available");
    expect(result.includedSourceFiles).toEqual(["src/math.cjs", "src/other.cjs"]);
    expect(result.text).toContain("=== FILE: src/math.cjs ===");
    expect(result.text).not.toContain(TRUSTED_MARKER);
    expect(result.text).not.toContain("tests/");
    expect(result.text).not.toContain("package.json");
    expect(result.selectionPolicyId).toBe("raw-source-glob-v1");
    expect(result.contextChars).toBe(result.text!.length);
    expect(result.estimatedContextTokens).toBeGreaterThan(0);
  });

  it("REA-015 orders files deterministically by code unit and normalizes line endings", async () => {
    const root = makeProject({ "src/beta.cjs": "b1\r\nb2\r\n", "src/alpha.cjs": "a1\n", "src/Zeta.cjs": "Z1\n" });
    const input = buildContextTaskInput(makeTask());
    const first = await buildRawFullFileContext(input, root);
    const second = await buildRawFullFileContext(input, root);
    expect(first.includedSourceFiles).toEqual(["src/Zeta.cjs", "src/alpha.cjs", "src/beta.cjs", "src/math.cjs", "src/other.cjs"]);
    expect(first.text).toBe(second.text);
    expect(first.text).not.toContain("\r");
    expect(first.text).toContain("=== FILE: src/beta.cjs ===\nb1\nb2\n");
  });

  it("marks the context unavailable instead of fabricating it when eligible files cannot be read safely", async () => {
    const input = buildContextTaskInput(makeTask());
    const binary = await buildRawFullFileContext(input, makeProject({ "src/blob.cjs": Buffer.from([1, 2, 0, 3]) }));
    expect(binary).toMatchObject({ availability: "unavailable", reason: "source-file-not-text", text: null });
    const huge = await buildRawFullFileContext(input, makeProject({ "src/huge.cjs": "x".repeat(300_000) }));
    expect(huge).toMatchObject({ availability: "unavailable", reason: "source-file-too-large", text: null });
    const none = await buildRawFullFileContext(buildContextTaskInput(makeTask({ rawIncludeGlobs: ["docs/**/*"] })), makeProject());
    expect(none).toMatchObject({ availability: "unavailable", reason: "no-eligible-source-files" });
    const missing = await buildRawFullFileContext(buildContextTaskInput(makeTask({ rawIncludeGlobs: ["nope/**/*"] })), makeProject());
    expect(missing).toMatchObject({ availability: "unavailable", reason: "no-eligible-source-files" });
    for (const glob of ["../outside/**/*", "/abs/**/*"]) {
      const escaping = await buildRawFullFileContext({ ...buildContextTaskInput(makeTask()), rawIncludeGlobs: [glob] }, makeProject());
      expect(escaping, glob).toMatchObject({ availability: "unavailable", reason: "raw-glob-resolution-failed" });
    }
  });

  it("matches `src/**/*.js` against files directly in src as well as nested ones (standard ** semantics)", async () => {
    const root = makeProject({ "src/top.js": "top\n", "src/deep/nested.js": "nested\n", "src/deep/skip.txt": "skip\n", "src/tests/hidden.js": "hidden\n" });
    const input = buildContextTaskInput(makeTask({ rawIncludeGlobs: ["src/**/*.js"] }));
    const result = await buildRawFullFileContext(input, root);
    expect(result.includedSourceFiles).toEqual(["src/deep/nested.js", "src/top.js"]);
  });

  it("refuses a linked source file", async () => {
    const root = makeProject();
    const outside = path.join(makeTempDir("lab-asr-outside-"), "secret.cjs");
    writeFileSync(outside, "SECRET\n");
    try {
      symlinkSync(outside, path.join(root, "src", "linked.cjs"));
    } catch {
      return; // symlink creation is not permitted on this host
    }
    const result = await buildRawFullFileContext(buildContextTaskInput(makeTask()), root);
    expect(result.availability).toBe("unavailable");
    expect(result.text).toBeNull();
  });

  it("applies the eligibility policy to paths and node identities", () => {
    const input = { sourceRoots: ["src"], excludedPaths: ["src/trusted.js"] };
    expect(isEligibleSourcePath("src/a.js", input)).toBe(true);
    for (const bad of ["tests/a.js", "src/a.test.js", "src/a.spec.ts", "src/__tests__/a.js", "src/node_modules/a.js", "../src/a.js", "/abs/src/a.js", "src\\a.js", "src/trusted.js", "srcx/a.js", "", 5]) {
      expect(isEligibleSourcePath(bad, input), String(bad)).toBe(false);
    }
    expect(sourcePathOfNodeId("symbol:src/a.js#fn")).toBe("src/a.js");
    expect(sourcePathOfNodeId("file:src/a.js")).toBe("src/a.js");
    expect(sourcePathOfNodeId("module:whatever")).toBeNull();
  });
});

describe("REA context-pack context", () => {
  it("REA-016 reuses the bounded-multiseed-v1 policy limits without tuning them", async () => {
    const root = makeProject();
    const { builder, kit } = packBuilder();
    const result = await builder.build(buildContextTaskInput(makeTask()), root);
    expect(result.availability === "available" || result.availability === "partial").toBe(true);
    expect(result.selectionPolicyId).toBe("bounded-multiseed-v1");
    expect(result.myDevKitVersion).toBe("1.12.5-fake");
    expect(kit.indexBuilds).toEqual([{ absoluteTargetRoot: root, sourceRoots: ["src"], callGraph: true }]);
    const search = kit.commands.find((command) => command.args[0] === "search")!;
    expect(search.args[search.args.indexOf("--limit") + 1]).toBe(String(SEARCH_RESULT_LIMIT));
    const lookups = kit.commands.filter((command) => command.args[0] === "lookup");
    expect(lookups.length).toBeLessThanOrEqual(MAX_SEED_NODES);
    for (const lookup of lookups) expect(lookup.args[lookup.args.indexOf("--depth") + 1]).toBe(String(GRAPH_DEPTH));
    expect(kit.commands.filter((command) => command.args[0] === "source").length).toBeLessThanOrEqual(MAX_SOURCE_SLICES);
    expect(result.text).toContain("## Source slices");
    expect(result.includedSourceFiles.every((file) => file.startsWith("src/"))).toBe(true);
  });

  it("REA-017 filters excluded candidates before any source is retrieved", async () => {
    const root = makeProject();
    const { builder, kit } = packBuilder();
    const result = await builder.build(buildContextTaskInput(makeTask()), root);
    const touchesDecoy = kit.commands.filter((command) => command.args[0] !== "search" && command.args.join(" ").includes("decoy"));
    expect(touchesDecoy).toEqual([]);
    expect(kit.commands.filter((command) => command.args[0] === "source").every((command) => !command.args.join(" ").includes("tests/"))).toBe(true);
    expect(result.text).not.toContain(TEST_DECOY_MARKER);
    expect(result.text).not.toContain(TEST_DECOY_PATH);
    expect(result.text).not.toContain(TRUSTED_MARKER);
    expect(result.includedSourceFiles).not.toContain(TEST_DECOY_PATH);
  });

  it("REA-018 exposes no hidden test section content or call-relationship endpoints", async () => {
    const root = makeProject();
    const { builder } = packBuilder();
    const result = await builder.build(buildContextTaskInput(makeTask()), root);
    const text = result.text!;
    const testsSection = text.slice(text.indexOf("## Tests"), text.indexOf("## Evidence notes"));
    expect(testsSection.trim()).toBe("## Tests\n(unavailable: not-supplied)");
    expect(text).not.toMatch(/decoy/i);
    expect(text).not.toMatch(/symbol:tests\//);
    expect(text).not.toMatch(/file:tests\//);
  });

  it("REA-019 fails conservatively on malformed or failing my-dev-kit output", async () => {
    const root = makeProject();
    const input = buildContextTaskInput(makeTask());
    const malformed = await packBuilder(makeSourceBackedKit({ malformedSearch: true })).builder.build(input, root);
    expect(malformed).toMatchObject({ availability: "unavailable", reason: "retrieval-failed", text: null });
    const failing = await packBuilder(makeSourceBackedKit({ failSearch: true })).builder.build(input, root);
    expect(failing).toMatchObject({ availability: "unavailable", reason: "retrieval-failed", text: null });
    const noIndex = await packBuilder(makeSourceBackedKit({ failIndex: true })).builder.build(input, root);
    expect(noIndex).toMatchObject({ availability: "unavailable", reason: "project-index-failed", text: null });
  });

  it("reports unavailable when only excluded candidates exist", async () => {
    const root = path.join(makeTempDir("lab-asr-ctx-empty-"), "project");
    mkdirSync(root, { recursive: true });
    writeProjectFiles(root, { "package.json": "{}\n", "tests/only.check.cjs": TRUSTED_MARKER });
    const { builder } = packBuilder();
    const result = await builder.build(buildContextTaskInput(makeTask()), root);
    expect(result.availability).toBe("unavailable");
    expect(result.text).toBeNull();
  });

  it("generates context from the clean canonical project without modifying it", async () => {
    const root = makeProject();
    const before = await snapshotProjectTree(root, { excludedNames: [".git"] });
    const { builder } = packBuilder();
    await builder.build(buildContextTaskInput(makeTask()), root);
    await buildRawFullFileContext(buildContextTaskInput(makeTask()), root);
    expect(await snapshotProjectTree(root, { excludedNames: [".git"] })).toEqual(before);
    expect(existsSync(path.join(root, ".my-dev-kit"))).toBe(false);
  });

  it("removes its private work directory on dispose", async () => {
    const { builder, kit } = packBuilder();
    await builder.build(buildContextTaskInput(makeTask()), makeProject());
    expect(kit.indexBuilds).toHaveLength(1);
    await expect(builder.dispose()).resolves.toBeNull();
  });
});
