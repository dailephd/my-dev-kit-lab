import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseCommandString, serializeCommand } from "../core/commandLine.js";
import { runMeasuredCommand } from "../core/runMeasuredCommand.js";
import { buildMyDevKitVisualizationCommands } from "./buildMyDevKitVisualizationCommands.js";
import type { VisualizationDemoArtifacts, VisualizationDemoCommand, VisualizationDemoRun } from "./types.js";
import { writeVisualizationDemoArtifacts } from "./writeVisualizationDemoArtifacts.js";

export async function runVisualizationDemos(options: {
  projectPath: string;
  kitCommand: string;
  outDir: string;
  query?: string;
  nodeId?: string;
  requireAll?: boolean;
  timeoutMs?: number;
  commands?: VisualizationDemoCommand[];
}): Promise<VisualizationDemoArtifacts> {
  const outDir = path.resolve(options.outDir);
  const projectPath = path.resolve(options.projectPath);
  const kitCommand = normalizeKitCommand(options.kitCommand);
  const commands =
    options.commands ??
    buildMyDevKitVisualizationCommands({
      projectPath,
      kitCommand,
      outDir,
      query: options.query,
      nodeId: options.nodeId
    });
  await mkdir(path.join(outDir, "commands"), { recursive: true });
  await mkdir(path.join(outDir, "artifacts"), { recursive: true });
  const runs: VisualizationDemoRun[] = [];
  const warnings: string[] = [];

  for (const command of commands) {
    const commandOutDir = path.join(outDir, "commands", command.id);
    const measured = await runMeasuredCommand({
      commandId: command.id,
      commandString: command.command,
      cwd: command.cwd,
      outDir: commandOutDir,
      extraArgs: command.args,
      timeoutMs: options.timeoutMs
    });
    const expectedArtifacts = command.expectedArtifacts.map((artifactPath) => ({ path: artifactPath, exists: existsSync(artifactPath) }));
    const producedArtifactPaths = expectedArtifacts.filter((artifact) => artifact.exists).map((artifact) => artifact.path);
    const runWarnings = [
      ...expectedArtifacts.filter((artifact) => !artifact.exists).map((artifact) => `Expected artifact was not produced: ${artifact.path}`)
    ];
    const errors = measured.ok ? [] : [(measured.error ?? measured.stderr) || `Command exited with code ${measured.exitCode}`];
    if (runWarnings.length > 0) warnings.push(...runWarnings.map((warning) => `${command.id}: ${warning}`));
    if (!measured.ok) warnings.push(`${command.id}: command failed or is unsupported.`);
    runs.push({
      id: command.id,
      name: command.name,
      commandString: command.command,
      args: command.args,
      cwd: command.cwd,
      exitCode: measured.exitCode,
      durationMs: measured.durationMs,
      stdoutPath: measured.stdoutPath,
      stderrPath: measured.stderrPath,
      producedArtifactPaths,
      expectedArtifacts,
      warnings: runWarnings,
      errors,
      ok: measured.ok,
      measured
    });
    if (!measured.ok && options.requireAll) {
      break;
    }
  }

  return writeVisualizationDemoArtifacts({
    outDir,
    projectPath,
    kitCommand,
    runs,
    warnings
  });
}

function normalizeKitCommand(command: string): string {
  const parsed = parseCommandString(command);
  if ((parsed.executable === "node" || parsed.executable === "node.exe") && parsed.args[0] && !path.isAbsolute(parsed.args[0])) {
    const scriptPath = path.resolve(process.cwd(), parsed.args[0]);
    if (existsSync(scriptPath)) {
      return serializeCommand([parsed.executable, scriptPath, ...parsed.args.slice(1)]);
    }
  }
  return command;
}
