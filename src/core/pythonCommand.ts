import { spawnSync } from "node:child_process";

export type PythonCommand = {
  command: string;
  argsPrefix: string[];
};

export type ResolvePythonCommandOptions = {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  probeAvailability?: (candidate: PythonCommand) => boolean;
};

const WINDOWS_PYTHON_CANDIDATES: PythonCommand[] = [
  { command: "py", argsPrefix: ["-3"] },
  { command: "python", argsPrefix: [] }
];

const POSIX_PYTHON_CANDIDATES: PythonCommand[] = [
  { command: "python3", argsPrefix: [] },
  { command: "python", argsPrefix: [] }
];

export function resolvePythonCommand(options: ResolvePythonCommandOptions = {}): PythonCommand {
  const candidates =
    (options.platform ?? process.platform) === "win32"
      ? WINDOWS_PYTHON_CANDIDATES
      : POSIX_PYTHON_CANDIDATES;
  const probe = options.probeAvailability ?? ((candidate) => canRunPython(candidate, options.timeoutMs ?? 5_000));

  for (const candidate of candidates) {
    if (probe(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function canRunPython(candidate: PythonCommand, timeoutMs: number): boolean {
  const result = spawnSync(candidate.command, [...candidate.argsPrefix, "--version"], {
    encoding: "utf8",
    shell: false,
    timeout: timeoutMs,
    windowsHide: true
  });
  return !result.error && result.status === 0;
}
