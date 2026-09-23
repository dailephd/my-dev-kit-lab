import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EvaluationCase } from "../../../src/evaluation/types.js";
import { createDefaultExperimentPluginRegistry, runExperiment } from "../../../src/experiments/index.js";
import {
  evaluateWarmIndexRealAgentCampaign,
  executeWarmIndexReuse,
  getWarmIndexCampaignPreset,
  buildWarmIndexRealAgentPrompt,
  type WarmIndexReuseRun,
} from "../../../src/experiments/plugins/warmIndexReuse/index.js";
import {
  fakeKitCommand,
  loadBundledProjectProfiles,
  loadProductionWarmIndexCases,
  makeCase,
  makeCases,
  writeFakeKitVariant,
} from "./warmIndexTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// --------------------------------------------------------------------------
// Deterministic host-platform fake Codex/Claude executables. "--" stops
// node's own flag parsing so dashed frozen-transport args (e.g. --restricted)
// reach the script as plain argv instead of being rejected as unknown node
// options (see the v0.5.2 Batch 2 shim fix for the same issue).
// --------------------------------------------------------------------------

function writeFakeCodexCampaignExecutable(filePath: string, options: { failWhenStdinContains?: string } = {}): void {
  const failToken = options.failWhenStdinContains ? JSON.stringify(options.failWhenStdinContains) : "null";
  const script =
    "const args = process.argv.slice(1); if (args.includes('--version')) { console.log('codex 1.0.0-fake'); process.exit(0); } " +
    "let data = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { data += c; }); " +
    "process.stdin.on('end', () => { " +
    `const failToken = ${failToken}; ` +
    "if (failToken && data.includes(failToken)) { process.stderr.write('forced provider failure'); process.exit(1); } " +
    "console.log(JSON.stringify({ type: 'thread.started' })); " +
    "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'noop' } })); " +
    "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'answer: ok\\nrelevantFiles: src/example.ts\\nrelevantSymbols: exampleSymbol\\nexpectedFactsFound: \\nconfidence: high' } })); " +
    "console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 } })); " +
    "});";
  writeShim(filePath, script, process.platform === "win32" ? "codex.cmd" : "codex");
}

function writeFakeCodexCampaignExecutableNoTokens(filePath: string): void {
  const script =
    "const args = process.argv.slice(1); if (args.includes('--version')) { console.log('codex 1.0.0-fake'); process.exit(0); } " +
    "let data = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { data += c; }); " +
    "process.stdin.on('end', () => { " +
    "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'answer: ok' } })); " +
    "});";
  writeShim(filePath, script, process.platform === "win32" ? "codex.cmd" : "codex");
}

function writeFakeClaudeCampaignExecutable(filePath: string, options: { includeUsage?: boolean } = { includeUsage: true }): void {
  const usagePart = options.includeUsage === false ? "" : ", usage: { input_tokens: 6, output_tokens: 4 }";
  const script =
    "const args = process.argv.slice(1); if (args.includes('--version')) { console.log('claude 1.0.0-fake'); process.exit(0); } " +
    "let data = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { data += c; }); " +
    "process.stdin.on('end', () => { " +
    `console.log(JSON.stringify({ result: 'answer: ok\\nrelevantFiles: src/example.ts\\nrelevantSymbols: exampleSymbol\\nconfidence: high', session_id: 'fixture'${usagePart} })); ` +
    "});";
  writeShim(filePath, script, process.platform === "win32" ? "claude.cmd" : "claude");
}

function writeShim(filePath: string, script: string, _shimName: string): void {
  if (process.platform === "win32") {
    writeFileSync(filePath, `@echo off\r\nnode -e "${script.replace(/"/g, '\\"')}" -- %*\r\n`, "utf8");
    return;
  }
  const unixScript = script.replace(/process\.argv\.slice\(1\)/g, "process.argv.slice(2)");
  writeFileSync(filePath, `#!/usr/bin/env node\n${unixScript}\n`, "utf8");
  chmodSync(filePath, 0o755);
}

function makeCampaignBin(prefix: string): { binDir: string; env: NodeJS.ProcessEnv } {
  const binRoot = tempDir(prefix);
  const binDir = path.join(binRoot, "bin with spaces");
  mkdirSync(binDir, { recursive: true });
  const nodeBinDir = path.dirname(process.execPath);
  return {
    binDir,
    env: { Path: `${binDir}${path.delimiter}${nodeBinDir}`, PATH: `${binDir}${path.delimiter}${nodeBinDir}` },
  };
}

function countTelemetryFiles(root: string, commandId: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === `${commandId}.telemetry.json`) found.push(full);
    }
  };
  walk(root);
  return found;
}

// Campaign presets own the real production corpus, so selectWarmIndexCampaignCases requires the
// full 12-case corpus to be loaded; --case narrows it, exactly like the real CLI/plugin path.
async function runCampaign(
  caseIds: string[],
  presetId: "codex-full" | "claude-full",
  env: NodeJS.ProcessEnv,
  timeoutMs = 5000
) {
  const outputRoot = tempDir("warm-real-agent-");
  const preset = getWarmIndexCampaignPreset(presetId);
  const cases = await loadProductionWarmIndexCases();
  const run = (await runExperiment({
    pluginId: "warm-index-reuse",
    registry: createDefaultExperimentPluginRegistry(),
    outputRoot,
    config: { kitCommand: fakeKitCommand, campaignPreset: presetId, includeRealAgents: true, timeoutMs, caseIds },
    inputs: { cases, projectProfiles: await loadBundledProjectProfiles(), env },
    toolRoot: process.cwd(),
    runId: "warm-real-agent-run",
  })) as WarmIndexReuseRun;
  return { run, outputRoot, preset };
}

describe("v0.5.2 Batch 3 -- buildWarmIndexRealAgentPrompt isolation", () => {
  const RAW_CONTEXT_SECRET = "RAW_CONTEXT_SECRET_7f3a";
  const HIDDEN_ANSWER_KEY_SECRET = "HIDDEN_ANSWER_KEY_SECRET_91bc";
  const HIDDEN_EXPECTED_FILE = "HIDDEN_EXPECTED_FILE_secret.ts";
  const HIDDEN_EXPECTED_SYMBOL = "hiddenExpectedSymbolSecret";

  const evaluationCase = makeCase({
    id: "prompt-isolation-case",
    title: "Prompt Isolation Task",
    query: "Where is task completion implemented?",
    expectedFiles: [HIDDEN_EXPECTED_FILE],
    expectedSymbols: [HIDDEN_EXPECTED_SYMBOL],
    expectedFacts: [{ id: "hidden-fact", text: HIDDEN_ANSWER_KEY_SECRET, weight: 1, required: true }],
    answerKey: {
      expectedFiles: [HIDDEN_EXPECTED_FILE],
      expectedSymbols: [HIDDEN_EXPECTED_SYMBOL],
      expectedFacts: [{ id: "hidden-fact", text: HIDDEN_ANSWER_KEY_SECRET, weight: 1, required: true }],
      minimumCorrectFacts: 1,
    },
  });

  it("embeds the supplied context exactly once, includes public fields, and excludes hidden scoring secrets", () => {
    const prompt = buildWarmIndexRealAgentPrompt({
      evaluationCase,
      variantId: "raw-full-file",
      contextText: `some code\n${RAW_CONTEXT_SECRET}\nmore code`,
    });

    expect(prompt.split(RAW_CONTEXT_SECRET)).toHaveLength(2); // exactly one occurrence
    expect(prompt).toContain(evaluationCase.benchmarkProject);
    expect(prompt).toContain(evaluationCase.id);
    expect(prompt).toContain(evaluationCase.title);
    expect(prompt).toContain(evaluationCase.query);
    expect(prompt).not.toContain(HIDDEN_ANSWER_KEY_SECRET);
    expect(prompt).not.toContain(HIDDEN_EXPECTED_FILE);
    expect(prompt).not.toContain(HIDDEN_EXPECTED_SYMBOL);
    expect(prompt).not.toMatch(/run my-dev-kit\b(?!\.)/i); // only appears inside "Do not run my-dev-kit."
    expect(prompt).toContain("Do not run my-dev-kit.");
    expect(prompt).toContain("Do not inspect the filesystem.");
    expect(prompt).toContain("Do not search the repository.");
  });

  it("labels the context mode for raw and warm variants", () => {
    const rawPrompt = buildWarmIndexRealAgentPrompt({ evaluationCase, variantId: "raw-full-file", contextText: "x" });
    const warmPrompt = buildWarmIndexRealAgentPrompt({ evaluationCase, variantId: "warm-index-reuse", contextText: "x" });
    expect(rawPrompt).toContain("Context mode: raw-full-file");
    expect(warmPrompt).toContain("Context mode: warm-index-reuse");
  });
});

describe("v0.5.2 Batch 3 -- deterministic Codex campaign", () => {
  it("executes exactly two provider sides for codex-full with stdin transport and no prompt in args", async () => {
    const { binDir, env } = makeCampaignBin("codex-campaign-bin-");
    writeFakeCodexCampaignExecutable(path.join(binDir, process.platform === "win32" ? "codex.cmd" : "codex"));

    const { run, outputRoot } = await runCampaign(["warm-medium-import-dedupe"], "codex-full", env);

    expect(run.status).toBe("completed");
    expect(run.projectExecutions).toHaveLength(1);
    expect(run.projectExecutions[0].tasks).toHaveLength(1);
    const [task] = run.agentEvidence[0].tasks;
    expect(task.raw).not.toBeNull();
    expect(task.warm).not.toBeNull();
    expect(task.raw!.agentId).toBe("codex");
    expect(task.warm!.agentId).toBe("codex");
    expect(task.raw!.status).toBe("completed");
    expect(task.warm!.status).toBe("completed");
    expect(task.raw!.tokenUsage.totalTokens).toBe(10);
    expect(task.raw!.tokenUsage.source).toBe("cli-json");

    // Prompt text (which embeds the full context) never appears in the recorded command args.
    const rawResult = JSON.parse(readFileSync(task.raw!.artifactPaths.agentRunResultPath!, "utf8")) as { args: string[] };
    expect(rawResult.args.join(" ")).not.toMatch(/BEGIN_SUPPLIED_CONTEXT|task-1/);

    expect(existsSync(path.join(outputRoot, "warm-index-execution.json"))).toBe(true);
  });
});

describe("v0.5.2 Batch 3 -- deterministic Claude campaign", () => {
  it("executes claude-full with parsed result text and available token usage", async () => {
    const { binDir, env } = makeCampaignBin("claude-campaign-bin-");
    writeFakeClaudeCampaignExecutable(path.join(binDir, process.platform === "win32" ? "claude.cmd" : "claude"));

    const { run } = await runCampaign(["warm-medium-import-dedupe"], "claude-full", env);

    const [task] = run.agentEvidence[0].tasks;
    expect(task.raw!.agentId).toBe("claude");
    expect(task.raw!.status).toBe("completed");
    expect(task.raw!.tokenUsage.totalTokens).toBe(10);
    expect(task.raw!.tokenUsage.source).toBe("cli-json");
    expect(task.warm!.status).toBe("completed");
  });

  it("reports token usage as unavailable, never zero, when the provider emits no usage", async () => {
    const { binDir, env } = makeCampaignBin("claude-campaign-no-usage-bin-");
    writeFakeClaudeCampaignExecutable(path.join(binDir, process.platform === "win32" ? "claude.cmd" : "claude"), { includeUsage: false });

    const { run } = await runCampaign(["warm-medium-import-dedupe"], "claude-full", env);
    const [task] = run.agentEvidence[0].tasks;
    expect(task.raw!.tokenUsage.totalTokens).toBeNull();
    expect(task.raw!.tokenUsage.source).toBe("unavailable");
    expect(task.raw!.tokenUsage.reliability).toBe("unavailable");
  });
});

describe("v0.5.2 Batch 3 -- exact context delivery and no second retrieval", () => {
  it("delivers byte-for-byte the exact raw and warm contextText into the provider prompt", async () => {
    const outputRoot = tempDir("warm-real-agent-context-");
    const cases = makeCases(1);
    const projects = await executeWarmIndexReuse({ cases, kitCommand: fakeKitCommand, outputRoot });
    const expectedRawContext = projects[0].tasks[0].rawBaseline!.contextText;
    const expectedWarmContext = projects[0].tasks[0].warmRetrieval!.contextText;
    expect(expectedRawContext.length).toBeGreaterThan(0);
    expect(expectedWarmContext.length).toBeGreaterThan(0);

    const { binDir, env } = makeCampaignBin("codex-context-bin-");
    writeFakeCodexCampaignExecutable(path.join(binDir, process.platform === "win32" ? "codex.cmd" : "codex"));

    const indexTelemetryBefore = countTelemetryFiles(outputRoot, "index");
    const searchTelemetryBefore = countTelemetryFiles(outputRoot, "search");

    const agentEvidence = await evaluateWarmIndexRealAgentCampaign({
      projects,
      cases,
      projectProfiles: await loadBundledProjectProfiles(),
      outputRoot,
      agentId: "codex",
      timeoutMs: 5000,
      env,
    });

    const [task] = agentEvidence[0].tasks;
    const rawPrompt = readFileSync(task.raw!.artifactPaths.promptPath!, "utf8");
    const warmPrompt = readFileSync(task.warm!.artifactPaths.promptPath!, "utf8");
    expect(extractSuppliedContext(rawPrompt)).toBe(expectedRawContext);
    expect(extractSuppliedContext(warmPrompt)).toBe(expectedWarmContext);

    // Agent evaluation must not trigger any additional index/search my-dev-kit telemetry.
    expect(countTelemetryFiles(outputRoot, "index")).toEqual(indexTelemetryBefore);
    expect(countTelemetryFiles(outputRoot, "search")).toEqual(searchTelemetryBefore);
    expect(countTelemetryFiles(outputRoot, "index")).toHaveLength(1);
    expect(countTelemetryFiles(outputRoot, "search")).toHaveLength(1);
  });
});

function extractSuppliedContext(promptText: string): string {
  const begin = "<<<BEGIN_SUPPLIED_CONTEXT>>>\n";
  const end = "\n<<<END_SUPPLIED_CONTEXT>>>";
  const startIndex = promptText.indexOf(begin) + begin.length;
  const endIndex = promptText.indexOf(end, startIndex);
  return promptText.slice(startIndex, endIndex);
}

describe("v0.5.2 Batch 3 -- neutral working directory isolation", () => {
  it("runs the provider outside the repository and benchmark target, and cleans up afterward", async () => {
    const { binDir, env } = makeCampaignBin("codex-neutral-cwd-bin-");
    writeFakeCodexCampaignExecutable(path.join(binDir, process.platform === "win32" ? "codex.cmd" : "codex"));
    const selectedCaseId = "warm-medium-import-dedupe";
    const productionCases = await loadProductionWarmIndexCases();
    const selectedCase = productionCases.find((evaluationCase) => evaluationCase.id === selectedCaseId)!;

    const { run } = await runCampaign([selectedCaseId], "codex-full", env);
    const [task] = run.agentEvidence[0].tasks;
    const repoRoot = path.resolve(process.cwd());
    const targetRoot = path.resolve(selectedCase.absoluteTargetRoot);

    for (const side of [task.raw!, task.warm!]) {
      const recorded = JSON.parse(readFileSync(side.artifactPaths.agentRunResultPath!, "utf8")) as { cwd: string };
      const recordedCwd = path.resolve(recorded.cwd);
      expect(recordedCwd).not.toBe(repoRoot);
      expect(recordedCwd).not.toBe(targetRoot);
      expect(isPathInside(recordedCwd, repoRoot)).toBe(false);
      expect(isPathInside(recordedCwd, targetRoot)).toBe(false);
      expect(existsSync(recordedCwd)).toBe(false);
      // Provider stdout/stderr/telemetry remain preserved under the normal agent artifact dir.
      expect(existsSync(side.artifactPaths.stdoutPath!)).toBe(true);
      expect(existsSync(side.artifactPaths.telemetryPath!)).toBe(true);
    }
  });
});

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

describe("v0.5.2 Batch 3 -- provider failure continuation", () => {
  it("keeps later cases executing when one provider call fails", async () => {
    const caseIds = ["warm-medium-import-dedupe", "warm-medium-create-project-task"];
    const { binDir, env } = makeCampaignBin("codex-failure-bin-");
    writeFakeCodexCampaignExecutable(path.join(binDir, process.platform === "win32" ? "codex.cmd" : "codex"), {
      failWhenStdinContains: `Case ID: ${caseIds[0]}`,
    });

    const { run } = await runCampaign(caseIds, "codex-full", env);

    expect(run.projectExecutions[0].tasks.map((task) => task.caseId)).toEqual(caseIds);
    const [failedTask, succeededTask] = run.agentEvidence[0].tasks;
    expect(failedTask.raw!.status).toBe("failed");
    expect(failedTask.warm!.status).toBe("failed");
    expect(succeededTask.raw!.status).toBe("completed");
    expect(succeededTask.warm!.status).toBe("completed");
    // Warm-index execution evidence for both cases stays intact regardless of provider outcome.
    expect(run.projectExecutions[0].tasks.every((task) => task.rawStatus === "completed" && task.warmStatus === "completed")).toBe(
      true
    );
  });
});

describe("v0.5.2 Batch 3 -- provider unavailable continuation", () => {
  it("classifies agent-unavailable, reports correctness/token unavailable, and continues", async () => {
    const { run } = await runCampaign(["warm-medium-import-dedupe"], "codex-full", { PATH: "", Path: "" });

    const [task] = run.agentEvidence[0].tasks;
    expect(task.raw!.status).toBe("agent-unavailable");
    expect(task.raw!.correctness.available).toBe(false);
    expect(task.raw!.tokenUsage.totalTokens).toBeNull();
    // Warm-index execution evidence is unaffected by provider unavailability.
    expect(run.projectExecutions[0].tasks[0].warmStatus).toBe("completed");
  });
});

describe("v0.5.2 Batch 3 -- no-context side", () => {
  it("leaves the warm side null and creates no warm provider directory when warm retrieval has no usable context", async () => {
    const outputRoot = tempDir("warm-real-agent-nocontext-");
    const cases = makeCases(1);
    const kitCommand = writeFakeKitVariant(tempDir("warm-real-agent-kit-"), { emptySearch: true });
    const projects = await executeWarmIndexReuse({ cases, kitCommand, outputRoot });
    expect(projects[0].tasks[0].warmRetrieval?.skipped).toBe(true);

    const { binDir, env } = makeCampaignBin("codex-nocontext-bin-");
    writeFakeCodexCampaignExecutable(path.join(binDir, process.platform === "win32" ? "codex.cmd" : "codex"));

    const agentEvidence = await evaluateWarmIndexRealAgentCampaign({
      projects,
      cases,
      projectProfiles: await loadBundledProjectProfiles(),
      outputRoot,
      agentId: "codex",
      timeoutMs: 5000,
      env,
    });

    const [task] = agentEvidence[0].tasks;
    expect(task.warm).toBeNull();
    expect(task.raw).not.toBeNull();
    expect(task.raw!.status).toBe("completed");
    expect(existsSync(path.join(outputRoot, "agents", "todo-ts", "task-1", "warm-index-reuse"))).toBe(false);
  });
});
