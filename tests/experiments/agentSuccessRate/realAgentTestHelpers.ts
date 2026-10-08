import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentRunRequest, AgentRunResult } from "../../../src/agents/types.js";
import type { MeasuredCommandResult, RunMeasuredCommandOptions } from "../../../src/core/runMeasuredCommand.js";
import type { MyDevKitIndexBuildResult } from "../../../src/evaluation/types.js";
import type { AgentSuccessContextDependencies } from "../../../src/experiments/plugins/agentSuccessRate/index.js";
import { symbolIndexOf } from "../contextPackGeneration/contextPackGenerationTestHelpers.js";
import { makeTempDir } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";

export const TEST_OUT_PREFIX = "lab-asr-real-out-";

// ---------------------------------------------------------------------------------------------------------------
// Deterministic provider shims. The shim is a real executable on PATH named codex/claude, so the production stdin
// transport and adapter flags are exercised. Behavior is controlled through files in a shim directory keyed by
// `<caseId>.<contextMode>`, never through the prompt.
// ---------------------------------------------------------------------------------------------------------------

const SHIM_SCRIPT = `
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("shim 1.0.0"); process.exit(0); }
let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  const dir = process.env.ASR_SHIM_DIR;
  const provider = process.env.ASR_SHIM_PROVIDER;
  const caseId = (/^Case ID: (.+)$/m.exec(data) || [])[1] || "unknown";
  const mode = (/^Context mode: (.+)$/m.exec(data) || [])[1] || "unknown";
  const key = caseId + "." + mode;
  fs.writeFileSync(path.join(dir, key + ".prompt.txt"), data);
  fs.writeFileSync(path.join(dir, key + ".meta.json"), JSON.stringify({ cwd: process.cwd(), args }));
  let behavior = {};
  try { behavior = JSON.parse(fs.readFileSync(path.join(dir, key + ".behavior.json"), "utf8")); } catch (e) {}
  const finish = () => {
    if (behavior.exitCode) { process.stderr.write(behavior.stderr || "forced provider failure"); process.exit(behavior.exitCode); }
    if (behavior.emptyOutput) { process.exit(0); }
    let response = "";
    try { response = fs.readFileSync(path.join(dir, key + ".response.txt"), "utf8"); } catch (e) { process.stderr.write("no scripted response"); process.exit(3); }
    if (provider === "codex") {
      console.log(JSON.stringify({ type: "thread.started" }));
      console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: response } }));
      if (behavior.noUsage !== true) console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 70, output_tokens: 30, total_tokens: 100 } }));
    } else {
      const payload = { result: response, session_id: "fixture" };
      if (behavior.noUsage !== true) payload.usage = { input_tokens: 60, output_tokens: 40 };
      console.log(JSON.stringify(payload));
    }
  };
  if (behavior.sleepMs) setTimeout(finish, behavior.sleepMs); else finish();
});
`;

export type ProviderShim = {
  env: NodeJS.ProcessEnv;
  dir: string;
  respond(caseId: string, mode: string, text: string): void;
  behave(caseId: string, mode: string, behavior: Record<string, unknown>): void;
  prompt(caseId: string, mode: string): string | null;
  meta(caseId: string, mode: string): { cwd: string; args: string[] } | null;
  invocationKeys(): string[];
};

export function makeProviderShim(provider: "codex" | "claude", options: { withExecutable?: boolean } = {}): ProviderShim {
  const root = makeTempDir("lab-asr-shim-");
  const binDir = path.join(root, "bin with spaces");
  const dir = path.join(root, "state");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(binDir, "shim.js");
  writeFileSync(scriptPath, SHIM_SCRIPT, "utf8");
  if (options.withExecutable !== false) {
    if (process.platform === "win32") {
      writeFileSync(path.join(binDir, `${provider}.cmd`), `@echo off\r\nnode "${scriptPath}" %*\r\n`, "utf8");
    } else {
      const exe = path.join(binDir, provider);
      writeFileSync(exe, `#!/usr/bin/env node\n${SHIM_SCRIPT}`, "utf8");
      chmodSync(exe, 0o755);
    }
  }
  const nodeBinDir = path.dirname(process.execPath);
  const searchPath = `${binDir}${path.delimiter}${nodeBinDir}`;
  const env: NodeJS.ProcessEnv = { Path: searchPath, PATH: searchPath, ASR_SHIM_DIR: dir, ASR_SHIM_PROVIDER: provider };
  const file = (caseId: string, mode: string, suffix: string) => path.join(dir, `${caseId}.${mode}.${suffix}`);
  return {
    env,
    dir,
    respond: (caseId, mode, text) => writeFileSync(file(caseId, mode, "response.txt"), text, "utf8"),
    behave: (caseId, mode, behavior) => writeFileSync(file(caseId, mode, "behavior.json"), JSON.stringify(behavior), "utf8"),
    prompt: (caseId, mode) => (existsSync(file(caseId, mode, "prompt.txt")) ? readFileSync(file(caseId, mode, "prompt.txt"), "utf8") : null),
    meta: (caseId, mode) => (existsSync(file(caseId, mode, "meta.json")) ? (JSON.parse(readFileSync(file(caseId, mode, "meta.json"), "utf8")) as { cwd: string; args: string[] }) : null),
    invocationKeys: () => readdirSync(dir).filter((name) => name.endsWith(".prompt.txt")).map((name) => name.replace(/\.prompt\.txt$/, "")).sort()
  };
}

/** A complete AgentRunResult for tests that drive the runAgent seam directly. */
export function fakeAgentResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    runId: "fake",
    agentId: "codex",
    displayName: "Codex",
    surface: "cli",
    promptVariantId: "fake",
    promptStrategy: "raw-full-file",
    promptComplexityLevel: "short",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:00.100Z",
    durationMs: 100,
    status: "completed",
    exitCode: 0,
    command: "codex",
    args: [],
    cwd: "",
    finalAnswerText: "",
    finalAnswerParseStatus: "parsed",
    tokenUsage: { source: "unavailable" },
    tokenUsageSource: "unavailable",
    tokenUsageReliability: "unavailable",
    warnings: [],
    errors: [],
    ...overrides
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Source-backed fake my-dev-kit. Search/lookup/slice/source answer from the real canonical project files, and the
// world deliberately includes trusted-test decoys so tests can prove they are filtered before retrieval.
// ---------------------------------------------------------------------------------------------------------------

export const TEST_DECOY_MARKER = "DECOY_TRUSTED_TEST_CONTENT_9d41";
export const TEST_DECOY_PATH = "tests/decoy-trusted.check.mjs";

export type RecordedKitCommand = { commandId: string; args: string[] };

export type SourceBackedKit = {
  dependencies: AgentSuccessContextDependencies;
  commands: RecordedKitCommand[];
  indexBuilds: Array<{ absoluteTargetRoot: string; sourceRoots: string[]; callGraph: boolean | undefined }>;
};

function commandResult(commandId: string, args: string[], ok: boolean, stdout: string): MeasuredCommandResult {
  return {
    commandId,
    commandString: "fake-kit",
    executable: "fake-kit",
    args,
    cwd: process.cwd(),
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:00.001Z",
    durationMs: 1,
    exitCode: ok ? 0 : 1,
    stdout,
    stderr: "",
    stdoutPath: "stdout.txt",
    stderrPath: "stderr.txt",
    telemetryPath: "telemetry.json",
    ok
  };
}

const argAfter = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

type SymbolFact = { file: string; name: string; line: number };

function listSourceFiles(projectRoot: string): string[] {
  const out: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(path.join(projectRoot, relative), { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.(c|m)?js$/.test(entry.name)) out.push(next);
    }
  };
  if (existsSync(path.join(projectRoot, "src"))) walk("src");
  return out.sort();
}

function extractSymbols(projectRoot: string, file: string): { symbols: SymbolFact[]; lineCount: number } {
  const lines = readFileSync(path.join(projectRoot, file), "utf8").split("\n");
  const symbols: SymbolFact[] = [];
  lines.forEach((text, index) => {
    const match = /^(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/.exec(text) ?? /^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=/.exec(text) ?? /^module\.exports\.([A-Za-z0-9_$]+)\s*=/.exec(text);
    if (match) symbols.push({ file, name: match[1]!, line: index + 1 });
  });
  const lineCount = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  return { symbols, lineCount };
}

export function makeSourceBackedKit(options: { failSearch?: boolean; malformedSearch?: boolean; failIndex?: boolean; noDecoys?: boolean } = {}): SourceBackedKit {
  const commands: RecordedKitCommand[] = [];
  const indexBuilds: SourceBackedKit["indexBuilds"] = [];
  const roots = new Map<string, string>(); // indexDir -> project root
  const dependencies: AgentSuccessContextDependencies = {
    buildIndex: async (build) => {
      indexBuilds.push({ absoluteTargetRoot: build.target.absoluteTargetRoot, sourceRoots: [...build.target.sourceRoots], callGraph: build.callGraph });
      roots.set(build.indexDir, build.target.absoluteTargetRoot);
      const ok = options.failIndex !== true;
      return { ok, indexDir: build.indexDir, durationMs: 1, warnings: [], mode: { kind: "full" }, incrementalRefresh: null, command: commandResult("index", [], ok, "") } as MyDevKitIndexBuildResult;
    },
    runCommand: async (run: RunMeasuredCommandOptions) => {
      const extra = [...(run.extraArgs ?? [])];
      commands.push({ commandId: run.commandId, args: extra });
      const family = extra[0];
      const indexDir = argAfter(extra, "--index") as string;
      const projectRoot = roots.get(indexDir) as string;
      const files = listSourceFiles(projectRoot);
      const facts = files.flatMap((file) => extractSymbols(projectRoot, file).symbols);
      const nodeOf = (fact: SymbolFact): string => `symbol:${fact.file}#${fact.name}`;
      const decoySymbol: SymbolFact = { file: TEST_DECOY_PATH, name: "decoyTrusted", line: 1 };
      if (family === "search") {
        if (options.failSearch) return commandResult(run.commandId, extra, false, "");
        if (options.malformedSearch) return commandResult(run.commandId, extra, true, "not json at all");
        const results = [
          ...(options.noDecoys ? [] : [{ id: nodeOf(decoySymbol), kind: "symbol", label: decoySymbol.name, nodeId: nodeOf(decoySymbol), path: decoySymbol.file }]),
          ...facts.slice(0, 5).map((fact) => ({ id: nodeOf(fact), kind: "symbol", label: fact.name, nodeId: nodeOf(fact), path: fact.file })),
          ...(options.noDecoys ? [] : [{ id: `file:${TEST_DECOY_PATH}`, kind: "file", label: "decoy", nodeId: `file:${TEST_DECOY_PATH}`, path: TEST_DECOY_PATH }])
        ];
        return commandResult(run.commandId, extra, true, JSON.stringify({ artifactKind: "my-dev-kit-v1-search-result", results }));
      }
      const nodeId = argAfter(extra, "--node");
      if (family === "lookup") {
        const fact = facts.find((candidate) => nodeOf(candidate) === nodeId);
        if (!fact) return commandResult(run.commandId, extra, false, "");
        return commandResult(run.commandId, extra, true, JSON.stringify({ status: "found", node: { id: nodeId, kind: "symbol", path: fact.file, symbolName: fact.name, line: fact.line } }));
      }
      if (family === "slice") {
        const nodes = [
          ...(options.noDecoys ? [] : [{ id: nodeOf(decoySymbol), kind: "symbol", path: decoySymbol.file, symbolName: decoySymbol.name, line: 1 }]),
          ...facts.slice(0, 3).map((fact) => ({ id: nodeOf(fact), kind: "symbol", path: fact.file, symbolName: fact.name, line: fact.line }))
        ];
        const edges = [
          ...(options.noDecoys ? [] : [{ source: nodeOf(decoySymbol), target: nodeOf(facts[0]!), kind: "calls" }]),
          ...(facts.length > 1 ? [{ source: nodeOf(facts[0]!), target: nodeOf(facts[1]!), kind: "calls" }] : [])
        ];
        return commandResult(run.commandId, extra, true, JSON.stringify({ focusNodeId: nodeId, nodes, edges }));
      }
      if (family === "source") {
        const file = argAfter(extra, "--file");
        if (file === TEST_DECOY_PATH) return commandResult(run.commandId, extra, true, JSON.stringify({ status: "ok", mode: "line-range", startLine: 1, endLine: 1, content: TEST_DECOY_MARKER, continuationCursor: { eof: true, symbolBoundaryKnown: true, reason: "window-capped" } }));
        if (file !== undefined && existsSync(path.join(projectRoot, file))) {
          const start = Number(argAfter(extra, "--start"));
          const end = Number(argAfter(extra, "--end"));
          const all = readFileSync(path.join(projectRoot, file), "utf8").split("\n");
          const content = all.slice(start - 1, end).join("\n");
          return commandResult(run.commandId, extra, true, JSON.stringify({ status: "ok", mode: "line-range", startLine: start, endLine: Math.min(end, all.length), content, continuationCursor: { eof: end >= all.length, symbolBoundaryKnown: true, reason: "window-capped" } }));
        }
      }
      return commandResult(run.commandId, extra, false, "");
    },
    readSymbolIndex: async (indexDir) => {
      const projectRoot = roots.get(indexDir) as string;
      return symbolIndexOf(
        listSourceFiles(projectRoot).map((file) => {
          const info = extractSymbols(projectRoot, file);
          return { path: file, lineCount: info.lineCount, symbols: info.symbols.map((symbol) => [symbol.name, symbol.line] as [string, number]) };
        })
      );
    },
    probeVersion: async () => ({ name: "my-dev-kit", version: "1.12.5-fake", availability: "available", reason: null }) as never
  };
  return { dependencies, commands, indexBuilds };
}

// ---------------------------------------------------------------------------------------------------------------
// Seam-driven provider: replaces the shared agent runner while still writing the attempt files the runner writes.
// ---------------------------------------------------------------------------------------------------------------

export type SeamAgent = {
  runAgent: (request: AgentRunRequest) => Promise<AgentRunResult>;
  requests: AgentRunRequest[];
};

export function makeSeamAgent(handler: (request: AgentRunRequest, call: number) => AgentRunResult | Promise<AgentRunResult> | "throw"): SeamAgent {
  const requests: AgentRunRequest[] = [];
  return {
    requests,
    runAgent: async (request) => {
      requests.push(request);
      const outcome = await handler(request, requests.length);
      if (outcome === "throw") throw new Error("provider runner exploded");
      mkdirSync(request.outDir, { recursive: true });
      writeFileSync(path.join(request.outDir, "prompt.txt"), request.promptText, "utf8");
      writeFileSync(path.join(request.outDir, "agent-run-result.json"), `${JSON.stringify(outcome, null, 2)}\n`, "utf8");
      return outcome;
    }
  };
}
