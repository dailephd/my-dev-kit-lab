import { readFileSync } from "node:fs";
import path from "node:path";
import { runFinalDemoCommand } from "../commands/runFinalDemoCommand.js";
import { discoverPackageRoot } from "../runtime/index.js";
import { renderDemoHelp, renderFinalDemoHelp, renderTopLevelHelp, renderUnknownCommandError } from "./help.js";

export const CLI_USAGE_EXIT_CODE = 2;

/**
 * Recognized legacy final-demo flag tokens (mirrors parseRunFinalDemoArgs in
 * src/commands/runFinalDemoCommand.ts). Used only to detect the historical
 * direct invocation form; the legacy argument list itself is delegated to the
 * existing final-demo parser unchanged, never reinterpreted here.
 */
const LEGACY_FINAL_DEMO_FLAGS = new Set([
  "--cases",
  "--out",
  "--kit-command",
  "--agents",
  "--strategies",
  "--complexities",
  "--case",
  "--benchmark-project",
  "--max-runs",
  "--screenshot",
  "--no-screenshot",
  "--include-real-agents",
  "--continue-on-failure",
  "--no-continue-on-failure",
  "--timeout-ms"
]);

export type LabCliWriters = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

const DEFAULT_WRITERS: LabCliWriters = {
  stdout: (message: string) => {
    console.log(message);
  },
  stderr: (message: string) => {
    console.error(message);
  }
};

export type RunLabCliOptions = {
  writers?: LabCliWriters;
};

export async function runLabCli(argv: string[], options: RunLabCliOptions = {}): Promise<number> {
  const writers = options.writers ?? DEFAULT_WRITERS;
  const [command, ...rest] = argv;

  if (argv.length === 0 || command === "--help" || command === "-h") {
    writers.stdout(renderTopLevelHelp());
    return 0;
  }

  if (command === "--version" || command === "-V") {
    writers.stdout(readPackageVersion());
    return 0;
  }

  if (command === "demo") {
    return runDemoCommand(rest, writers);
  }

  if (LEGACY_FINAL_DEMO_FLAGS.has(command)) {
    return runFinalDemoCommand(argv);
  }

  writers.stderr(renderUnknownCommandError(command));
  return CLI_USAGE_EXIT_CODE;
}

async function runDemoCommand(argv: string[], writers: LabCliWriters): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (argv.length === 0 || subcommand === "--help" || subcommand === "-h") {
    writers.stdout(renderDemoHelp());
    return 0;
  }

  if (subcommand === "final") {
    if (rest[0] === "--help" || rest[0] === "-h") {
      writers.stdout(renderFinalDemoHelp());
      return 0;
    }
    return runFinalDemoCommand(rest);
  }

  writers.stderr(renderUnknownCommandError(`demo ${subcommand}`));
  return CLI_USAGE_EXIT_CODE;
}

function readPackageVersion(): string {
  const packageRoot = discoverPackageRoot();
  const packageJsonPath = path.join(packageRoot, "package.json");
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`Unable to read a valid version from ${packageJsonPath}`);
  }
  return parsed.version;
}
