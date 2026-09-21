import path from "node:path";
import { countEstimatedTokens, countTextChars, tokenCountMethod } from "../core/countTokens.js";
import { runMeasuredCommand, type MeasuredCommandResult } from "../core/runMeasuredCommand.js";
import type { EvaluationCase, MyDevKitIndexBuildResult, MyDevKitIndexTarget, MyDevKitRetrievalResult } from "./types.js";

function parseJsonIfPossible(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readSearchResults(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  for (const key of ["results", "matches", "items", "data"]) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
    }
  }
  return [];
}

function pickCandidateFields(candidate: Record<string, unknown>): { nodeId?: string; file?: string; symbol?: string } {
  const readString = (...keys: string[]) => {
    for (const key of keys) {
      if (typeof candidate[key] === "string" && candidate[key]) {
        return candidate[key] as string;
      }
    }
    return undefined;
  };
  return {
    nodeId: readString("nodeId", "id", "node", "symbolId"),
    file: readString("file", "path", "filePath"),
    symbol: readString("symbol", "name", "label")
  };
}

function skippedRetrieval(
  caseId: string,
  warnings: string[],
  commands: MeasuredCommandResult[],
  durationMs: number
): MyDevKitRetrievalResult {
  return {
    caseId,
    skipped: true,
    warnings,
    totalChars: 0,
    totalEstimatedTokens: 0,
    tokenCountMethod,
    contextText: "",
    filesRead: [],
    commands,
    durationMs
  };
}

/**
 * Runs exactly one my-dev-kit `index` command for the target and writes the index only to
 * `indexDir`. Performs no search/lookup/slice/source work. With `requireKit` a failed index
 * throws; otherwise the failure is returned as `ok: false` with a warning.
 */
export async function buildMyDevKitIndex(options: {
  target: MyDevKitIndexTarget;
  kitCommand: string;
  indexDir: string;
  commandsDir: string;
  requireKit: boolean;
}): Promise<MyDevKitIndexBuildResult> {
  const warnings: string[] = [];
  const command = await runMeasuredCommand({
    commandId: "index",
    commandString: options.kitCommand,
    cwd: process.cwd(),
    outDir: options.commandsDir,
    extraArgs: [
      "index",
      "--root",
      options.target.absoluteTargetRoot,
      ...options.target.sourceRoots.flatMap((sourceRoot) => ["--src", sourceRoot]),
      "--out",
      options.indexDir,
      "--json"
    ]
  });

  if (!command.ok) {
    if (options.requireKit) {
      throw new Error(command.error || `my-dev-kit index failed with exit code ${command.exitCode}`);
    }
    warnings.push("my-dev-kit index command was unavailable or failed.");
  }

  return {
    ok: command.ok,
    indexDir: options.indexDir,
    durationMs: command.durationMs,
    warnings,
    command
  };
}

/**
 * Runs search -> lookup -> slice -> source against an already prepared index. Never invokes
 * `index`; `durationMs` covers retrieval only.
 */
export async function runMyDevKitRetrievalFromIndex(options: {
  evaluationCase: EvaluationCase;
  kitCommand: string;
  indexDir: string;
  commandsDir: string;
  requireKit: boolean;
}): Promise<MyDevKitRetrievalResult> {
  const started = Date.now();
  const warnings: string[] = [];
  const commands: MeasuredCommandResult[] = [];
  const { commandsDir, indexDir } = options;

  const searchCommand = await runMeasuredCommand({
    commandId: "search",
    commandString: options.kitCommand,
    cwd: process.cwd(),
    outDir: commandsDir,
    extraArgs: ["search", "--index", indexDir, "--query", options.evaluationCase.query, "--json"]
  });
  commands.push(searchCommand);
  if (!searchCommand.ok) {
    if (options.requireKit) {
      throw new Error(searchCommand.error || `my-dev-kit search failed with exit code ${searchCommand.exitCode}`);
    }
    warnings.push("my-dev-kit search command failed.");
    return skippedRetrieval(options.evaluationCase.id, warnings, commands, Date.now() - started);
  }

  const searchPayload = parseJsonIfPossible(searchCommand.stdout);
  const candidates = readSearchResults(searchPayload);
  const selected = candidates[0];
  if (!selected) {
    warnings.push("No my-dev-kit search candidate was found.");
    return skippedRetrieval(options.evaluationCase.id, warnings, commands, Date.now() - started);
  }

  const candidate = pickCandidateFields(selected);
  const selectedNodeId = candidate.nodeId;
  const selectedFile = candidate.file;
  const selectedSymbol = candidate.symbol;
  let lookupOutput = "";
  let sliceOutput = "";
  let sourceOutput = "";

  if (selectedNodeId) {
    const lookupCommand = await runMeasuredCommand({
      commandId: "lookup",
      commandString: options.kitCommand,
      cwd: process.cwd(),
      outDir: commandsDir,
      extraArgs: ["lookup", "--index", indexDir, "--node", selectedNodeId, "--json"]
    });
    commands.push(lookupCommand);
    if (lookupCommand.ok) {
      lookupOutput = lookupCommand.stdout;
    } else {
      warnings.push("my-dev-kit lookup command failed.");
    }

    const sliceCommand = await runMeasuredCommand({
      commandId: "slice",
      commandString: options.kitCommand,
      cwd: process.cwd(),
      outDir: commandsDir,
      extraArgs: ["slice", "--index", indexDir, "--node", selectedNodeId, "--json"]
    });
    commands.push(sliceCommand);
    if (sliceCommand.ok) {
      sliceOutput = sliceCommand.stdout;
    } else {
      warnings.push("my-dev-kit slice command failed.");
    }

    const sourceCommand = await runMeasuredCommand({
      commandId: "source",
      commandString: options.kitCommand,
      cwd: process.cwd(),
      outDir: commandsDir,
      extraArgs: ["source", "--index", indexDir, "--node", selectedNodeId, "--max-lines", "160", "--format", "numbered"]
    });
    commands.push(sourceCommand);
    if (sourceCommand.ok) {
      sourceOutput = sourceCommand.stdout;
    } else {
      warnings.push("my-dev-kit source command failed.");
    }
  } else {
    warnings.push("No my-dev-kit node id was available after search.");
  }

  const contextText = [sourceOutput, sliceOutput, lookupOutput, searchCommand.stdout].find((text) => text && text.trim().length > 0) ?? "";
  const filesRead = selectedFile ? [selectedFile] : [];

  return {
    caseId: options.evaluationCase.id,
    skipped: contextText.length === 0,
    warnings,
    totalChars: countTextChars(contextText),
    totalEstimatedTokens: countEstimatedTokens(contextText),
    tokenCountMethod,
    contextText,
    filesRead,
    commands,
    selectedNodeId,
    selectedFile,
    selectedSymbol,
    durationMs: Date.now() - started
  };
}

/**
 * Legacy per-case lifecycle: builds a case-specific index and retrieves from it. `commands`
 * starts with the index command and `durationMs` covers the whole lifecycle including indexing.
 */
export async function runMyDevKitRetrieval(options: {
  evaluationCase: EvaluationCase;
  kitCommand: string;
  outputDir: string;
  requireKit: boolean;
}): Promise<MyDevKitRetrievalResult> {
  const started = Date.now();
  const commandsDir = path.join(options.outputDir, "commands", options.evaluationCase.id);
  const indexDir = path.join(options.outputDir, "indexes", options.evaluationCase.id);

  const index = await buildMyDevKitIndex({
    target: options.evaluationCase,
    kitCommand: options.kitCommand,
    indexDir,
    commandsDir,
    requireKit: options.requireKit
  });
  if (!index.ok) {
    return skippedRetrieval(options.evaluationCase.id, [...index.warnings], [index.command], Date.now() - started);
  }

  const retrieval = await runMyDevKitRetrievalFromIndex({
    evaluationCase: options.evaluationCase,
    kitCommand: options.kitCommand,
    indexDir,
    commandsDir,
    requireKit: options.requireKit
  });

  return {
    ...retrieval,
    warnings: [...index.warnings, ...retrieval.warnings],
    commands: [index.command, ...retrieval.commands],
    durationMs: Date.now() - started
  };
}
