import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { assertReadAgentSuccessCorpus } from "../../../src/evaluation/agentSuccess/index.js";
import { buildMyDevKitIndex, probeMyDevKitVersion } from "../../../src/evaluation/runMyDevKitRetrieval.js";
import { runMeasuredCommand, type RunMeasuredCommandOptions } from "../../../src/core/runMeasuredCommand.js";
import { snapshotProjectTree } from "../../../src/evaluation/benchmarkSandbox/index.js";
import {
  AgentSuccessPackContextBuilder,
  buildContextTaskInput,
  buildRawFullFileContext,
  collectForbiddenAgentValues,
  findPromptLeaks,
  isEligibleSourcePath,
  type AgentSuccessContextDependencies
} from "../../../src/experiments/plugins/agentSuccessRate/index.js";

/**
 * Opt-in integration with the real published my-dev-kit CLI for ALL six canonical tasks of BOTH benchmark projects
 * (task-board and inventory). It never starts a coding agent. It needs the package to be installed or fetchable, so it
 * is not part of the offline default suite. Run with: LAB_REAL_MY_DEV_KIT=1 npx vitest run <this file>
 * Override the command with LAB_REAL_MY_DEV_KIT_COMMAND (default: npx @dailephd/my-dev-kit@latest).
 */
const enabled = Boolean(process.env.LAB_REAL_MY_DEV_KIT);
const kitCommand = process.env.LAB_REAL_MY_DEV_KIT_COMMAND || "npx @dailephd/my-dev-kit@latest";
vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

const repoRoot = process.cwd();
const recordedFamilies = new Set<string>();
const recordedArgs: string[][] = [];

const dependencies: AgentSuccessContextDependencies = {
  buildIndex: buildMyDevKitIndex,
  runCommand: (options: RunMeasuredCommandOptions) => {
    const extra = [...(options.extraArgs ?? [])];
    recordedFamilies.add(extra[0] ?? "");
    recordedArgs.push(extra);
    return runMeasuredCommand(options);
  },
  readSymbolIndex: async (indexDir) => JSON.parse(readFileSync(path.join(indexDir, "symbol-index.json"), "utf8")) as unknown,
  probeVersion: probeMyDevKitVersion
};

const builder = new AgentSuccessPackContextBuilder(kitCommand, dependencies);
afterAll(async () => {
  await builder.dispose();
});

describe.skipIf(!enabled)("RPR-049/050 real my-dev-kit context generation for every canonical task (no coding agent)", () => {
  const corpus = enabled ? assertReadAgentSuccessCorpus(repoRoot) : { tasks: [], profiles: [] };

  it("covers both canonical projects and all three task localities", () => {
    expect(corpus.tasks).toHaveLength(6);
    expect([...new Set(corpus.tasks.map((task) => task.benchmarkProject))].sort()).toEqual(["agent-success-inventory-node", "agent-success-task-board-node"]);
    expect([...new Set(corpus.tasks.map((task) => task.taskLocality))].sort()).toEqual(["broad-change", "cross-module", "localized"]);
  });

  it("builds both treatments from the real kit, filters hidden tests before source retrieval, and leaks nothing", async () => {
    const projectsRoot = path.join(repoRoot, "benchmarks", "projects");
    const before = new Map<string, Awaited<ReturnType<typeof snapshotProjectTree>>>();
    for (const project of new Set(corpus.tasks.map((task) => task.benchmarkProject))) {
      before.set(project, await snapshotProjectTree(path.join(projectsRoot, project), { excludedNames: [".git"] }));
    }
    const summary: Array<Record<string, unknown>> = [];
    for (const task of corpus.tasks) {
      const projectRoot = path.join(projectsRoot, task.benchmarkProject);
      const input = buildContextTaskInput(task);
      const forbidden = collectForbiddenAgentValues(task);
      // all canonical (non-test) source of the project: a patch line already present there is not a leak
      const canonicalSource = readdirSync(projectRoot, { recursive: true, encoding: "utf8" })
        .map((entry) => entry.replace(/\\/g, "/"))
        .filter((entry) => /\.(c|m)?js$/.test(entry) && !entry.startsWith("tests/") && !entry.includes("node_modules"))
        .map((entry) => readFileSync(path.join(projectRoot, ...entry.split("/")), "utf8"))
        .join("\n");
      const pack = await builder.build(input, projectRoot);
      const raw = await buildRawFullFileContext(input, projectRoot);

      // expected treatment identities and availability
      expect(pack.treatmentId, task.id).toBe("context-pack");
      expect(raw.treatmentId, task.id).toBe("raw-full-file");
      expect(pack.availability, `${task.id} context-pack: ${pack.reason ?? ""}`).not.toBe("unavailable");
      expect(raw.availability, `${task.id} raw-full-file: ${raw.reason ?? ""}`).not.toBe("unavailable");
      expect(pack.text, task.id).not.toBeNull();
      expect(raw.text, task.id).not.toBeNull();
      expect(pack.myDevKitVersion, task.id).not.toBeNull();
      expect(pack.includedSourceFiles.length, task.id).toBeGreaterThan(0);

      // source-path filtering: every included file is eligible source; no trusted check or test file is ever included
      const trustedPaths = [...task.taskChecks, ...task.regressionChecks].flatMap((check) => check.args.filter((arg) => /[./]/.test(arg) && !arg.startsWith("-")));
      for (const treatment of [pack, raw]) {
        for (const file of treatment.includedSourceFiles) {
          expect(isEligibleSourcePath(file, input), `${task.id}: ${file}`).toBe(true);
          expect(trustedPaths, `${task.id}: ${file}`).not.toContain(file);
          expect(file.startsWith("tests/"), `${task.id}: ${file}`).toBe(false);
        }
        // no trusted-test or golden-patch leakage in the supplied text
        expect(findPromptLeaks(treatment.text!, forbidden), `${task.id} ${treatment.treatmentId}`).toEqual([]);
        for (const trusted of trustedPaths) {
          const body = readFileSync(path.join(projectRoot, ...trusted.split("/")), "utf8").trim();
          expect(treatment.text!, `${task.id}: content of ${trusted}`).not.toContain(body);
        }
        // A reference-patch line is a leak only if it is not already canonical source (patches may reorder existing lines).
        const fixture = task.deterministicFixture?.patch ?? "";
        for (const added of fixture.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++") && line.trim().length > 24)) {
          const line = added.slice(1);
          if (canonicalSource.includes(line.trim())) continue;
          expect(treatment.text!, `${task.id}: reference-patch line`).not.toContain(line);
        }
      }
      // bounded composition
      expect(pack.contextChars, task.id).toBe(pack.text!.length);
      summary.push({ task: task.id, project: task.benchmarkProject, locality: task.taskLocality, packFiles: pack.includedSourceFiles.length, packChars: pack.contextChars, rawFiles: raw.includedSourceFiles.length, rawChars: raw.contextChars, version: pack.myDevKitVersion, availability: pack.availability });
    }

    // every real-kit command family was exercised, and none addressed a trusted test path
    expect([...recordedFamilies].sort()).toEqual(expect.arrayContaining(["lookup", "search", "slice", "source"]));
    for (const args of recordedArgs) {
      if (args[0] !== "source") continue;
      const file = args[args.indexOf("--file") + 1];
      if (file !== undefined) expect(file.startsWith("tests/"), file).toBe(false);
    }
    // canonical projects are unchanged
    for (const [project, snapshot] of before) {
      expect(await snapshotProjectTree(path.join(projectsRoot, project), { excludedNames: [".git"] })).toEqual(snapshot);
    }
    // Optional evidence file for the validation report; nothing is written unless the caller names a path.
    if (process.env.LAB_REAL_MY_DEV_KIT_SUMMARY) writeFileSync(process.env.LAB_REAL_MY_DEV_KIT_SUMMARY, `${JSON.stringify({ kitCommand, families: [...recordedFamilies].sort(), summary }, null, 2)}
`, "utf8");
  });
});
