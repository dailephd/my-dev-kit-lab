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
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  if (platform !== "win32") {
    const posixCandidate = findPosixCommandCandidate(command, env, cwd);
    if (!posixCandidate) {
      return {
        originalCommand: command,
        command,
        argsPrefix: [],
        resolutionKind: "unavailable",
        warnings: [`Command was not found on PATH: ${command}`]
      };
    }
    return {
      originalCommand: command,
      command,
      argsPrefix: [],
      resolutionKind: "direct",
      resolvedPath: posixCandidate,
      warnings: []
    };
  }

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

  return commandForWindowsCandidate(command, candidate, env, options.allowPowerShellShim ?? true);
}

function commandForWindowsCandidate(
  originalCommand: string,
  resolvedPath: string,
  env: NodeJS.ProcessEnv,
  allowPowerShellShim: boolean
): ResolvedCommand {
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
      command: env.ComSpec ?? env.COMSPEC ?? process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe",
      argsPrefix: ["/d", "/s", "/c", "call"],
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

// POSIX (Linux/macOS) command resolution. Unlike the Windows branch above,
// there is no extension-guessing -- a bare command name must match exactly
// one PATH entry, and the match must actually be executable (checked via
// X_OK, not just file existence, so a non-executable regular file with a
// matching name is correctly treated as absent). This mirrors the Windows
// branch's "search PATH, report unavailable if nothing matches" contract:
// previously this platform branch unconditionally reported "direct" without
// ever checking PATH, so a genuinely-missing command (e.g. codeql, semgrep)
// was only discovered as absent when the downstream spawn failed with
// ENOENT -- which staticScans/codeql.ts and staticScans/semgrep.ts
// misclassify as a MAJOR/failed finding rather than a graceful skip,
// causing security:validate to falsely report a release blocker on
// Linux/macOS whenever an optional static-analysis tool is not installed.
function findPosixCommandCandidate(command: string, env: NodeJS.ProcessEnv, cwd: string): string | undefined {
  if (hasPathSeparator(command) || path.isAbsolute(command)) {
    const resolved = path.resolve(cwd, command);
    return isExecutablePosixFile(resolved) ? resolved : undefined;
  }

  for (const searchDir of getPosixPathEntries(env)) {
    const candidate = path.join(searchDir, command);
    if (isExecutablePosixFile(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function getPosixPathEntries(env: NodeJS.ProcessEnv): string[] {
  const pathValue = env.PATH ?? env.Path ?? "";
  return pathValue.split(path.delimiter).filter(Boolean);
}

function isExecutablePosixFile(candidatePath: string): boolean {
  try {
    if (!fs.statSync(candidatePath).isFile()) return false;
    fs.accessSync(candidatePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
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
