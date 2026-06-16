import fs from "node:fs";
import path from "node:path";

export type CommandResolutionKind =
  | "direct"
  | "path-extension"
  | "windows-cmd-shim"
  | "windows-powershell-shim"
  | "unavailable";

export type ResolvedCommand = {
  originalCommand: string;
  command: string;
  argsPrefix: string[];
  resolutionKind: CommandResolutionKind;
  resolvedPath?: string;
  warnings: string[];
};

export type ResolveCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  allowPowerShellShim?: boolean;
};

const windowsExtensionPreference = [".cmd", ".exe", ".bat", ".ps1", ""];

export function resolveCommand(command: string, options: ResolveCommandOptions = {}): ResolvedCommand {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return {
      originalCommand: command,
      command,
      argsPrefix: [],
      resolutionKind: "direct",
      resolvedPath: command,
      warnings: []
    };
  }

  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const candidate = findWindowsCommandCandidate(command, env, cwd);
  if (!candidate) {
    return {
      originalCommand: command,
      command,
      argsPrefix: [],
      resolutionKind: "unavailable",
      warnings: [`Command was not found on PATH: ${command}`]
    };
  }

  return commandForWindowsCandidate(command, candidate, options.allowPowerShellShim ?? true);
}

function commandForWindowsCandidate(originalCommand: string, resolvedPath: string, allowPowerShellShim: boolean): ResolvedCommand {
  const extension = path.extname(resolvedPath).toLowerCase();
  if (extension === ".ps1") {
    if (!allowPowerShellShim) {
      return {
        originalCommand,
        command: resolvedPath,
        argsPrefix: [],
        resolutionKind: "unavailable",
        resolvedPath,
        warnings: [`PowerShell shim execution is disabled for command: ${resolvedPath}`]
      };
    }
    return {
      originalCommand,
      command: "powershell.exe",
      argsPrefix: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolvedPath],
      resolutionKind: "windows-powershell-shim",
      resolvedPath,
      warnings: []
    };
  }

  if (extension === ".cmd" || extension === ".bat") {
    return {
      originalCommand,
      command: process.env.ComSpec ?? "cmd.exe",
      argsPrefix: ["/d", "/s", "/c", resolvedPath],
      resolutionKind: "windows-cmd-shim",
      resolvedPath,
      warnings: []
    };
  }

  return {
    originalCommand,
    command: resolvedPath,
    argsPrefix: [],
    resolutionKind: path.extname(originalCommand) ? "direct" : "path-extension",
    resolvedPath,
    warnings: []
  };
}

function findWindowsCommandCandidate(command: string, env: NodeJS.ProcessEnv, cwd: string): string | undefined {
  if (hasPathSeparator(command) || path.isAbsolute(command)) {
    return findCandidateInDirectory(path.resolve(cwd, command));
  }

  for (const searchDir of getPathEntries(env)) {
    const candidate = findCandidateInDirectory(path.join(searchDir, command));
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function findCandidateInDirectory(basePath: string): string | undefined {
  const extension = path.extname(basePath);
  if (extension) {
    return isExecutableFile(basePath) ? basePath : undefined;
  }
  for (const candidateExtension of windowsExtensionPreference) {
    const candidatePath = `${basePath}${candidateExtension}`;
    if (isExecutableFile(candidatePath)) {
      return candidatePath;
    }
  }
  return undefined;
}

function getPathEntries(env: NodeJS.ProcessEnv): string[] {
  const pathValue = env.Path ?? env.PATH ?? "";
  return pathValue.split(path.delimiter).filter(Boolean);
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function isExecutableFile(candidatePath: string): boolean {
  try {
    return fs.statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}
