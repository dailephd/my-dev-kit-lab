export function renderTopLevelHelp(): string {
  return [
    "my-dev-kit-lab - benchmark, evidence, and evaluation companion for my-dev-kit.",
    "",
    "Usage:",
    "  my-dev-kit-lab --help",
    "  my-dev-kit-lab --version",
    "  my-dev-kit-lab demo final --cases <path> --out <dir> --kit-command <command> [options]",
    "",
    "Options:",
    "  -h, --help     Show this help message",
    "  -V, --version  Show the installed my-dev-kit-lab package version",
    "",
    "Commands:",
    "  demo final     Run the full final demo workflow",
    "",
    "Run \"my-dev-kit-lab demo final --help\" for the full list of demo options.",
    "",
    "Note: the historical direct invocation form (flags without \"demo final\", e.g.",
    "\"my-dev-kit-lab --cases <path> --out <dir> --kit-command <command>\") remains",
    "supported for backward compatibility."
  ].join("\n");
}

export function renderDemoHelp(): string {
  return [
    "my-dev-kit-lab demo - demo command family",
    "",
    "Usage:",
    "  my-dev-kit-lab demo final [options]",
    "  my-dev-kit-lab demo --help",
    "",
    "Commands:",
    "  final   Run the full final demo. Run \"my-dev-kit-lab demo final --help\" for details."
  ].join("\n");
}

export function renderFinalDemoHelp(): string {
  return [
    "my-dev-kit-lab demo final - run the full final demo workflow",
    "",
    "Usage:",
    "  my-dev-kit-lab demo final --cases <path> --out <dir> --kit-command <command> [options]",
    "",
    "Required:",
    "  --cases <path>            Path to the evaluation cases file",
    "  --out <dir>               Output directory for demo artifacts",
    "  --kit-command <command>   Command used to invoke my-dev-kit for the visualization demos",
    "",
    "Options:",
    "  --agents <list>                                    Comma-separated agent ids (default: fake-agent)",
    "  --strategies <list>                                Comma-separated strategies: raw-full-file,my-dev-kit-guided (default: both)",
    "  --complexities <list>                               Comma-separated complexity levels: short,medium,long,multi-step (default: short)",
    "  --case <ids>                                       Comma-separated case ids to run",
    "  --benchmark-project <ids>                          Comma-separated benchmark project ids to run",
    "  --max-runs <n>                                     Maximum number of runs",
    "  --screenshot / --no-screenshot                     Enable/disable report screenshot capture (default: disabled)",
    "  --include-real-agents                              Allow real agent ids (codex, claude)",
    "  --continue-on-failure / --no-continue-on-failure   Continue after a failed run (default: continue-on-failure)",
    "  --timeout-ms <ms>                                  Per-run timeout in milliseconds",
    "",
    "The legacy direct invocation form (the same flags without a leading \"demo final\")",
    "remains supported for backward compatibility."
  ].join("\n");
}

export function renderUnknownCommandError(command: string): string {
  return [
    `Unknown command: ${command}`,
    "Run \"my-dev-kit-lab --help\" for usage."
  ].join("\n");
}
