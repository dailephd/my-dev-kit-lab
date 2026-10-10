import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatchToSandbox, assertReadAgentSuccessCorpus } from "../../src/evaluation/agentSuccess/index.js";
import { createDefaultExperimentPluginRegistry } from "../../src/experiments/defaultRegistry.js";
import { makeSandbox, useSandboxTestCleanup } from "../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
// @ts-expect-error -- the acceptance module is plain ESM JavaScript that ships with the verifier, not a typed library.
import * as acceptance from "../../scripts/verifyPackedPackageAgentSuccess.mjs";

useSandboxTestCleanup();

const repoRoot = process.cwd();
const lf = (text: string): string => text.replace(/\r\n/g, "\n");
const verifierSource = lf(readFileSync(path.resolve("scripts/verify-packed-package.mjs"), "utf8"));
const moduleSource = lf(readFileSync(path.resolve("scripts/verifyPackedPackageAgentSuccess.mjs"), "utf8"));
const corpus = assertReadAgentSuccessCorpus(repoRoot);
const requiredPaths: string[] = acceptance.AGENT_SUCCESS_REQUIRED_TARBALL_PATHS;
/** Source without comment lines, so prose in a comment cannot satisfy or violate a code-level assertion. */
const codeOf = (text: string): string => text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");

const sourceOf = (compiled: string): string => path.resolve(compiled.replace(/^dist\//, "").replace(/\.js$/, ".ts"));
const tsFilesIn = (directory: string): string[] => readdirSync(path.resolve(directory)).filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"));

describe("PACK-003..008 required packed contents and plugin list", () => {
  it("PACK-003: every required compiled path has a TypeScript source, so a rename cannot silently weaken the gate", () => {
    const compiled = requiredPaths.filter((entry) => entry.startsWith("dist/"));
    expect(compiled.length).toBeGreaterThanOrEqual(50);
    for (const entry of compiled) expect(existsSync(sourceOf(entry)), entry).toBe(true);
  });

  it("PACK-003: every runtime owner of the plugin, corpus reader, sandbox, change-set and report directories is named", () => {
    const named = new Set(requiredPaths);
    const directories: Array<[string, string]> = [
      ["src/experiments/plugins/agentSuccessRate", "dist/src/experiments/plugins/agentSuccessRate"],
      ["src/evaluation/agentSuccess", "dist/src/evaluation/agentSuccess"],
      ["src/evaluation/benchmarkSandbox", "dist/src/evaluation/benchmarkSandbox"],
      ["src/evaluation/changeSet", "dist/src/evaluation/changeSet"]
    ];
    for (const [source, compiled] of directories) {
      for (const file of tsFilesIn(source)) expect(named.has(`${compiled}/${file.replace(/\.ts$/, ".js")}`), `${source}/${file}`).toBe(true);
    }
    for (const file of tsFilesIn("src/report/experiments").filter((name) => /agentSuccessRate/i.test(name))) {
      expect(named.has(`dist/src/report/experiments/${file.replace(/\.ts$/, ".js")}`), file).toBe(true);
    }
  });

  it("PACK-004: both canonical projects are listed completely (source, private package.json, README, check files, .gitattributes)", () => {
    for (const project of acceptance.AGENT_SUCCESS_PROJECTS as string[]) {
      const root = path.resolve("benchmarks", "projects", project);
      const onDisk = (readdirSync(root, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
        .sort();
      const listed = requiredPaths.filter((entry) => entry.startsWith(`benchmarks/projects/${project}/`)).map((entry) => entry.slice(`benchmarks/projects/${project}/`.length)).sort();
      expect(listed).toEqual(onDisk);
      expect(listed).toContain(".gitattributes");
      expect(listed).toContain("package.json");
      expect(listed).toContain("README.md");
      expect(listed.filter((entry) => /^tests\/.+\.check\.mjs$/.test(entry)).length).toBeGreaterThanOrEqual(7);
    }
  });

  it("PACK-005/006: the bundled six-task catalog and the profile catalog are required resources", () => {
    expect(requiredPaths).toContain("benchmarks/contracts/agent-success-rate-tasks.json");
    expect(requiredPaths).toContain("benchmarks/contracts/agent-success-rate-project-profiles.json");
    expect(corpus.tasks).toHaveLength(6);
    expect(corpus.tasks.map((task) => task.id)).toEqual([
      "asr-board-title-normalization",
      "asr-board-import-idempotency",
      "asr-board-project-summary",
      "asr-inventory-quantity-boundary",
      "asr-inventory-reservation-atomicity",
      "asr-inventory-fulfillment-report"
    ]);
  });

  it("PACK-007/008: the verifier requires the seven historical ids unchanged and agent-success-rate as the eighth, matching the registry", () => {
    const required = /const REQUIRED_EXPERIMENT_IDS = \[([^\]]*)\]/.exec(verifierSource)?.[1] ?? "";
    const ids = required.split(",").map((entry) => entry.trim().replace(/"/g, ""));
    expect(ids.slice(0, 7)).toEqual(acceptance.AGENT_SUCCESS_LEGACY_EXPERIMENT_IDS);
    expect(ids).toHaveLength(8);
    expect(ids[7]).toBe("agent-success-rate");
    expect(createDefaultExperimentPluginRegistry().list().map((metadata) => metadata.id)).toEqual(ids);
  });

  it("PACK-003: the verifier appends the module's required paths to its own required tarball paths without replacing any", () => {
    expect(verifierSource).toContain("...AGENT_SUCCESS_REQUIRED_TARBALL_PATHS");
    for (const historical of ["dist/src/experiments/plugins/contextPackGeneration/plugin.js", "benchmarks/contracts/benchmark-project-profiles.json", "examples/tutorial-browser/scenario.json"]) {
      expect(verifierSource, historical).toContain(`"${historical}"`);
    }
  });
});

describe("PACK-060 package hygiene classification", () => {
  const { findForbiddenTarballPaths } = acceptance;

  it("accepts the legitimate agent-success resources, including trusted check files, project .gitattributes and historical benchmark tests", () => {
    expect(
      findForbiddenTarballPaths([
        "package.json",
        "dist/src/index.js",
        "benchmarks/contracts/agent-success-rate-tasks.json",
        "benchmarks/projects/agent-success-task-board-node/.gitattributes",
        "benchmarks/projects/agent-success-task-board-node/tests/title-primary.check.mjs",
        "benchmarks/projects/context-window-scaling-fixed-ts/tests/tasks/shippingQuote.test.ts",
        "benchmarks/projects/task-analytics-large-mixed/py/tests/test_quality.py",
        "docs/METRICS.md",
        "CHANGELOG.md"
      ])
    ).toEqual([]);
  });

  it.each([
    [".my-dev-kit-context/indexes/x/symbol-index.json"],
    [".my-dev-kit-orchestrator/runs/r/run.json"],
    ["reports/final.txt"],
    ["lab-output/agent-success-rate/report.json"],
    ["sandboxes/asr-1-raw/src/a.js"],
    ["agents/p/c/raw-full-file/attempt-1/prompt.txt"],
    [".git/config"],
    ["dailephd-my-dev-kit-lab-0.8.2.tgz"],
    [".env"],
    [".env.local"],
    [".npmrc"],
    ["secrets/server.pem"],
    [".claude/settings.json"],
    ["AGENTS.md"],
    ["CLAUDE.md"],
    ["agents.txt"],
    ["claude.txt"],
    ["tests/scripts/verifyPackedPackage.spec.ts"],
    ["dist/tests/x.js"],
    ["scripts/verify-packed-package.mjs"],
    ["scripts/verifyPackedPackageAgentSuccess.mjs"],
    ["node_modules/x/index.js"],
    ["invocations.jsonl"]
  ])("rejects %s", (forbidden) => {
    expect(findForbiddenTarballPaths(["package.json", forbidden])).toEqual([forbidden]);
  });

  it("matches the real packed inventory contract: the current repository's npm allowlist ships none of the forbidden classes", () => {
    const manifest = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as { files: string[] };
    for (const entry of manifest.files) {
      expect(findForbiddenTarballPaths([entry.replace(/\/$/, "/placeholder.js")]), entry).toEqual([]);
    }
  });
});

describe("PACK-036..038 agent-facing privacy detection", () => {
  const { findPromptLeakLabels, collectHiddenTaskValues, distinctiveReferencePatchLines, HIDDEN_FIELD_NAMES } = acceptance;
  const task = corpus.tasks[0]!;
  const canonicalSource = readdirSync(path.resolve("benchmarks/projects", task.benchmarkProject), { recursive: true, encoding: "utf8" })
    .map((entry) => entry.replace(/\\/g, "/"))
    .filter((entry) => /\.(c|m)?js$/.test(entry) && !entry.startsWith("tests/"))
    .map((entry) => lf(readFileSync(path.resolve("benchmarks/projects", task.benchmarkProject, ...entry.split("/")), "utf8")))
    .join("\n");

  it("collects fixture, check, behavior-fact and protected-test values from the catalog", () => {
    const labels = new Set((collectHiddenTaskValues(task) as Array<{ label: string }>).map((entry) => entry.label));
    for (const label of ["deterministicFixture.id", "check.id", "check.path", "behaviorFact.text", "protectedFile.test"]) expect(labels.has(label), label).toBe(true);
  });

  it("flags each class of hidden material and nothing for a clean prompt", () => {
    const cleanPrompt = `# Implementation Benchmark\nCase ID: ${task.id}\nTask: ${task.title}\nQuery: ${task.query}\n\nRequired behavior:\n${task.instruction}\n<<<BEGIN_SUPPLIED_CONTEXT>>>\n${canonicalSource}\n<<<END_SUPPLIED_CONTEXT>>>\n`;
    expect(findPromptLeakLabels(cleanPrompt, task, canonicalSource)).toEqual([]);
    expect(findPromptLeakLabels(`${cleanPrompt}\n${task.taskChecks[0]!.args.find((arg) => arg.includes("/"))}`, task, canonicalSource)).toContain("check.path");
    expect(findPromptLeakLabels(`${cleanPrompt}\n${task.taskChecks[0]!.id}`, task, canonicalSource)).toContain("check.id");
    expect(findPromptLeakLabels(`${cleanPrompt}\n${task.behaviorFacts[0]!.text}`, task, canonicalSource)).toContain("behaviorFact.text");
    expect(findPromptLeakLabels(`${cleanPrompt}\n${task.deterministicFixture!.id}`, task, canonicalSource)).toContain("deterministicFixture.id");
    for (const field of HIDDEN_FIELD_NAMES as string[]) expect(findPromptLeakLabels(`${cleanPrompt}\n"${field}": []`, task, canonicalSource), field).toContain(`field:${field}`);
    const lines = distinctiveReferencePatchLines(task, canonicalSource) as string[];
    expect(lines.length).toBeGreaterThan(0);
    expect(findPromptLeakLabels(`${cleanPrompt}\n${lines[0]}`, task, canonicalSource)).toContain("referencePatch.line");
  });

  it("does not treat reference-patch lines that already exist in canonical source as a leak", () => {
    for (const entry of corpus.tasks) {
      const source = readdirSync(path.resolve("benchmarks/projects", entry.benchmarkProject), { recursive: true, encoding: "utf8" })
        .map((name) => name.replace(/\\/g, "/"))
        .filter((name) => /\.(c|m)?js$/.test(name) && !name.startsWith("tests/"))
        .map((name) => lf(readFileSync(path.resolve("benchmarks/projects", entry.benchmarkProject, ...name.split("/")), "utf8")))
        .join("\n");
      for (const line of distinctiveReferencePatchLines(entry, source) as string[]) expect(source.includes(line.trim())).toBe(false);
    }
  });
});

describe("PACK-039..043 scenario building blocks", () => {
  it("the no-op patch applies cleanly to every task's first expected file through the production patch pipeline", async () => {
    for (const task of corpus.tasks) {
      const file = task.expectedEditFiles[0]!;
      const text = readFileSync(path.resolve("benchmarks/projects", task.benchmarkProject, ...file.split("/")), "utf8");
      const patch = acceptance.buildNoopPatch(file, text) as string;
      expect(patch).toContain(`+++ b/${file}`);
      const sandbox = await makeSandbox(path.resolve("benchmarks/projects", task.benchmarkProject), `noop-${task.id}`);
      const result = await applyPatchToSandbox({ sandbox, rawProposal: acceptance.fenced(patch), protectedFiles: task.protectedFiles });
      expect(result.outcome, task.id).toBe("success");
    }
  }, 300_000);

  it("executableDirectories reports only the directories that hold the named executable, in PATH order", () => {
    const fixtureRoot = path.resolve("tests/scripts/fixtures");
    const found = acceptance.executableDirectories("packedAgentSuccessProvider.mjs", [path.resolve("scripts"), fixtureRoot, path.resolve("src")].join(path.delimiter), "linux");
    expect(found).toEqual([fixtureRoot]);
    expect(acceptance.executableDirectories("definitely-not-installed-xyz", fixtureRoot, "linux")).toEqual([]);
    expect(acceptance.executableDirectories("anything", undefined, "linux")).toEqual([]);
  });

  it("metricValue never turns an unavailable metric into a number", () => {
    expect(acceptance.metricValue({ availability: "available", value: 0 })).toBe(0);
    expect(acceptance.metricValue({ availability: "unavailable", value: null })).toBeNull();
    expect(acceptance.metricValue({ availability: "not-applicable", value: null })).toBeNull();
    expect(acceptance.metricValue(undefined)).toBeNull();
  });

  it("isInside is true for the root and its descendants only", () => {
    const root = path.resolve("a", "b");
    expect(acceptance.isInside(root, root)).toBe(true);
    expect(acceptance.isInside(root, path.join(root, "c", "d"))).toBe(true);
    expect(acceptance.isInside(root, path.resolve("a", "bb"))).toBe(false);
    expect(acceptance.isInside(root, path.resolve("a"))).toBe(false);
  });
});

describe("PACK-013/063 no live provider and gate declaration", () => {
  it("declares every acceptance gate label and prints them all in the final verdict", () => {
    expect(acceptance.AGENT_SUCCESS_GATE_LABELS).toHaveLength(15);
    for (const label of acceptance.AGENT_SUCCESS_GATE_LABELS as string[]) {
      expect(moduleSource, label).toContain(`"${label}"`);
      expect(moduleSource, label).toMatch(new RegExp(`(pass\\("${label}"|const gate = "${label}"|gate = "${label}")`));
    }
    expect(verifierSource).toContain("...AGENT_SUCCESS_GATE_LABELS.map((label) => `${label}: PASS`)");
    expect(verifierSource).toContain("await runAgentSuccessPackedAcceptance({");
  });

  it("refuses to run unless only the fake codex/claude executables are discoverable, and gives a deterministic run a PATH holding no provider", () => {
    expect(moduleSource).toContain("could be discovered on the acceptance PATH");
    expect(moduleSource).toContain("const providerPathDirs = [ctx.consumerBinDir, agentBin, gitDirectories[0]]");
  });

  it("the fixtures are offline and spawn nothing: no network, no child process, no real provider name resolution", () => {
    for (const fixture of ["tests/scripts/fixtures/packedAgentSuccessProvider.mjs", "tests/scripts/fixtures/fakeAgentSuccessKit.mjs"]) {
      const source = readFileSync(path.resolve(fixture), "utf8");
      expect(codeOf(source), fixture).not.toMatch(/child_process|node:http|node:https|node:net|\bfetch\(|\bspawn(Sync)?\(|\bexecFile(Sync)?\(|\bexecSync\(/);
    }
  });

  it("uses the exact installed tarball only: no pack, install or registry access of its own", () => {
    expect(codeOf(moduleSource)).not.toMatch(/npm pack|["']pack["']|["']install["']|registry|npx |npm link|spawnSync\(/);
  });

  it("derives the gate from installed paths: no source-checkout dist or tsx execution", () => {
    expect(codeOf(moduleSource)).not.toMatch(/REPO_ROOT|dist\/scripts\/cli\.js|\btsx\b|ts-node/);
    expect(moduleSource).toContain("runInstalledCli(cliCommand");
  });
});
