import path from "node:path";
import { countEstimatedTokens, countTextChars, tokenCountMethod } from "../core/countTokens.js";
import { runMeasuredCommand } from "../core/runMeasuredCommand.js";
import type { EvaluationCase, MyDevKitRetrievalResult } from "./types.js";

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

export async function runMyDevKitRetrieval(options: {
  evaluationCase: EvaluationCase;
  kitCommand: string;
  outputDir: string;
  requireKit: boolean;
}): Promise<MyDevKitRetrievalResult> {
  const started = Date.now();
  const warnings: string[] = [];
  const commandsDir = path.join(options.outputDir, "commands", options.evaluationCase.id);
  const indexesDir = path.join(options.outputDir, "indexes", options.evaluationCase.id);
  const commands = [];

  const indexCommand = await runMeasuredCommand({
    commandId: "index",
    commandString: options.kitCommand,
    cwd: process.cwd(),
    outDir: commandsDir,
    extraArgs: [
      "index",
      "--root",
      options.evaluationCase.absoluteTargetRoot,
      ...options.evaluationCase.sourceRoots.flatMap((sourceRoot) => ["--src", sourceRoot]),
      "--out",
      indexesDir,
      "--json"
    ]
  });
  commands.push(indexCommand);

  if (!indexCommand.ok) {
    if (options.requireKit) {
      throw new Error(indexCommand.error || `my-dev-kit index failed with exit code ${indexCommand.exitCode}`);
    }
    warnings.push("my-dev-kit index command was unavailable or failed.");
    return {
      caseId: options.evaluationCase.id,
      skipped: true,
      warnings,
      totalChars: 0,
      totalEstimatedTokens: 0,
      tokenCountMethod,
      contextText: "",
      filesRead: [],
      commands,
      durationMs: Date.now() - started
    };
  }

  const searchCommand = await runMeasuredCommand({
    commandId: "search",
    commandString: options.kitCommand,
    cwd: process.cwd(),
    outDir: commandsDir,
    extraArgs: ["search", "--index", indexesDir, "--query", options.evaluationCase.query, "--json"]
  });
  commands.push(searchCommand);
  if (!searchCommand.ok) {
    if (options.requireKit) {
      throw new Error(searchCommand.error || `my-dev-kit search failed with exit code ${searchCommand.exitCode}`);
    }
    warnings.push("my-dev-kit search command failed.");
    return {
      caseId: options.evaluationCase.id,
      skipped: true,
      warnings,
      totalChars: 0,
      totalEstimatedTokens: 0,
      tokenCountMethod,
      contextText: "",
      filesRead: [],
      commands,
      durationMs: Date.now() - started
    };
  }

  const searchPayload = parseJsonIfPossible(searchCommand.stdout);
  const candidates = readSearchResults(searchPayload);
  const selected = candidates[0];
  if (!selected) {
    warnings.push("No my-dev-kit search candidate was found.");
    return {
      caseId: options.evaluationCase.id,
      skipped: true,
      warnings,
      totalChars: 0,
      totalEstimatedTokens: 0,
      tokenCountMethod,
      contextText: "",
      filesRead: [],
      commands,
      durationMs: Date.now() - started
    };
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
      extraArgs: ["lookup", "--index", indexesDir, "--node", selectedNodeId, "--json"]
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
      extraArgs: ["slice", "--index", indexesDir, "--node", selectedNodeId, "--json"]
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
      extraArgs: ["source", "--index", indexesDir, "--node", selectedNodeId, "--max-lines", "160", "--format", "numbered"]
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
