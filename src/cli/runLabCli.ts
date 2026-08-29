import { readFileSync } from "node:fs";
import path from "node:path";
import { runFinalDemoCommand } from "../commands/runFinalDemoCommand.js";
import { runAuditCommandFromArgs } from "../commands/runAuditCommand.js";
import { runSecurityValidationCommandFromArgs } from "../commands/runSecurityValidationCommand.js";
import { runControlledExperimentCommand } from "../commands/runControlledExperimentCommand.js";
import { runExperimentListCommandFromArgs } from "../commands/runExperimentListCommand.js";
import { runExperimentDescribeCommandFromArgs } from "../commands/runExperimentDescribeCommand.js";
import { runExperimentRunCommandFromArgs } from "../commands/runExperimentRunCommand.js";
import { runRenderExperimentReportCommand } from "../commands/renderExperimentReportCommand.js";
import { runGenerateExperimentPlotsCommand } from "../commands/generateExperimentPlotsCommand.js";
import { runBuildGalleryCommand } from "../commands/buildGalleryCommand.js";
import { createLabExecutionContext, discoverPackageRoot } from "../runtime/index.js";
import type { LabExecutionContext } from "../runtime/index.js";
import {
  renderDemoHelp,
  renderExperimentControlledHelp,
  renderExperimentDescribeHelp,
  renderExperimentHelp,
  renderExperimentListHelp,
  renderExperimentRunHelp,
  renderFinalDemoHelp,
  renderGalleryBuildHelp,
  renderGalleryHelp,
  renderPlotsGenerateHelp,
  renderPlotsHelp,
  renderReportHelp,
  renderReportRenderHelp,
  renderSecurityHelp,
  renderTopLevelHelp,
  renderUnknownCommandError
} from "./help.js";

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

type GlobalOptionsResult =
  | { ok: true; workspaceRoot?: string; remaining: string[] }
  | { ok: false; error: string };

export async function runLabCli(argv: string[], options: RunLabCliOptions = {}): Promise<number> {
  const writers = options.writers ?? DEFAULT_WRITERS;

  const globalOptions = parseGlobalOptions(argv);
  if (!globalOptions.ok) {
    writers.stderr(globalOptions.error);
    return CLI_USAGE_EXIT_CODE;
  }
  const remaining = globalOptions.remaining;
  const context = createLabExecutionContext(
    globalOptions.workspaceRoot !== undefined ? { workspaceRoot: globalOptions.workspaceRoot } : {}
  );

  const [command, ...rest] = remaining;

  if (remaining.length === 0 || command === "--help" || command === "-h") {
    writers.stdout(renderTopLevelHelp());
    return 0;
  }

  if (command === "--version" || command === "-V") {
    writers.stdout(readPackageVersion());
    return 0;
  }

  if (command === "security") {
    return runSecurityFamily(rest, writers, context);
  }

  if (command === "audit") {
    return runAuditCommandFromArgs(rest, { context, defaultOutRoot: context.workspaceRoot });
  }

  if (command === "experiment") {
    return runExperimentFamily(rest, writers, context);
  }

  if (command === "report") {
    return runReportFamily(rest, writers);
  }

  if (command === "plots") {
    return runPlotsFamily(rest, writers);
  }

  if (command === "gallery") {
    return runGalleryFamily(rest, writers);
  }

  if (command === "demo") {
    return runDemoCommand(rest, writers);
  }

  if (LEGACY_FINAL_DEMO_FLAGS.has(command)) {
    return runFinalDemoCommand(remaining);
  }

  writers.stderr(renderUnknownCommandError(command));
  return CLI_USAGE_EXIT_CODE;
}

/**
 * Only recognizes a leading "--workspace <path>" pair (must be argv[0]).
 * A --workspace token appearing anywhere else is left untouched for normal
 * command/legacy routing to handle (or reject), per the batch requirement
 * that global options must precede the command.
 */
function parseGlobalOptions(argv: string[]): GlobalOptionsResult {
  if (argv[0] !== "--workspace") {
    return { ok: true, remaining: argv };
  }
  const value = argv[1];
  if (value === undefined) {
    return { ok: false, error: "Missing value for --workspace. Expected a path after --workspace." };
  }
  return { ok: true, workspaceRoot: value, remaining: argv.slice(2) };
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

async function runSecurityFamily(argv: string[], writers: LabCliWriters, context: LabExecutionContext): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (argv.length === 0 || subcommand === "--help" || subcommand === "-h") {
    writers.stdout(renderSecurityHelp());
    return 0;
  }

  if (subcommand === "validate") {
    return runSecurityValidationCommandFromArgs(rest, { context, defaultOutRoot: context.workspaceRoot });
  }

  writers.stderr(renderUnknownCommandError(`security ${subcommand}`));
  return CLI_USAGE_EXIT_CODE;
}

async function runExperimentFamily(argv: string[], writers: LabCliWriters, context: LabExecutionContext): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (argv.length === 0 || subcommand === "--help" || subcommand === "-h") {
    writers.stdout(renderExperimentHelp());
    return 0;
  }

  if (subcommand === "list") {
    if (rest[0] === "--help" || rest[0] === "-h") {
      writers.stdout(renderExperimentListHelp());
      return 0;
    }
    return runExperimentListCommandFromArgs(rest);
  }

  if (subcommand === "describe") {
    if (rest[0] === "--help" || rest[0] === "-h") {
      writers.stdout(renderExperimentDescribeHelp());
      return 0;
    }
    return runExperimentDescribeCommandFromArgs(rest);
  }

  if (subcommand === "run") {
    if (rest[0] === "--help" || rest[0] === "-h") {
      writers.stdout(renderExperimentRunHelp());
      return 0;
    }
    return runExperimentRunCommandFromArgs(rest, { context, installedDefaultOutputRoot: context.workspaceRoot });
  }

  if (subcommand === "controlled") {
    if (rest[0] === "--help" || rest[0] === "-h") {
      writers.stdout(renderExperimentControlledHelp());
      return 0;
    }
    return runControlledExperimentCommand(rest);
  }

  writers.stderr(renderUnknownCommandError(`experiment ${subcommand}`));
  return CLI_USAGE_EXIT_CODE;
}

async function runReportFamily(argv: string[], writers: LabCliWriters): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (argv.length === 0 || subcommand === "--help" || subcommand === "-h") {
    writers.stdout(renderReportHelp());
    return 0;
  }

  if (subcommand === "render") {
    if (rest[0] === "--help" || rest[0] === "-h") {
      writers.stdout(renderReportRenderHelp());
      return 0;
    }
    return runRenderExperimentReportCommand(rest);
  }

  writers.stderr(renderUnknownCommandError(`report ${subcommand}`));
  return CLI_USAGE_EXIT_CODE;
}

async function runPlotsFamily(argv: string[], writers: LabCliWriters): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (argv.length === 0 || subcommand === "--help" || subcommand === "-h") {
    writers.stdout(renderPlotsHelp());
    return 0;
  }

  if (subcommand === "generate") {
    if (rest[0] === "--help" || rest[0] === "-h") {
      writers.stdout(renderPlotsGenerateHelp());
      return 0;
    }
    return runGenerateExperimentPlotsCommand(rest);
  }

  writers.stderr(renderUnknownCommandError(`plots ${subcommand}`));
  return CLI_USAGE_EXIT_CODE;
}

async function runGalleryFamily(argv: string[], writers: LabCliWriters): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (argv.length === 0 || subcommand === "--help" || subcommand === "-h") {
    writers.stdout(renderGalleryHelp());
    return 0;
  }

  if (subcommand === "build") {
    if (rest[0] === "--help" || rest[0] === "-h") {
      writers.stdout(renderGalleryBuildHelp());
      return 0;
    }
    return runBuildGalleryCommand(rest);
  }

  writers.stderr(renderUnknownCommandError(`gallery ${subcommand}`));
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
