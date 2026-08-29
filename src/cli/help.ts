export function renderTopLevelHelp(): string {
  return [
    "my-dev-kit-lab - benchmark, evidence, and evaluation companion for my-dev-kit.",
    "",
    "Usage:",
    "  my-dev-kit-lab --help",
    "  my-dev-kit-lab --version",
    "  my-dev-kit-lab [--workspace <path>] audit [options]",
    "  my-dev-kit-lab [--workspace <path>] experiment controlled --cases <path> --out <dir> [options]",
    "  my-dev-kit-lab [--workspace <path>] report render --experiment <dir> --out <dir> [options]",
    "  my-dev-kit-lab [--workspace <path>] plots generate --experiment <dir> --out <dir>",
    "  my-dev-kit-lab [--workspace <path>] gallery build --out <dir> [options]",
    "  my-dev-kit-lab demo final --cases <path> --out <dir> --kit-command <command> [options]",
    "",
    "Options:",
    "  -h, --help           Show this help message",
    "  -V, --version        Show the installed my-dev-kit-lab package version",
    "  --workspace <path>   Writable my-dev-kit-lab workspace root (default: <home>/.my-dev-kit-lab).",
    "                       Must appear before the command when used.",
    "",
    "Commands:",
    "  audit                    Run a project audit",
    "  experiment controlled    Run a controlled context-strategy-comparison experiment",
    "  report render             Render an experiment report from controlled-experiment artifacts",
    "  plots generate             Generate experiment plot artifacts",
    "  gallery build              Build a gallery manifest/index",
    "  demo final                 Run the full final demo workflow",
    "",
    "Run \"my-dev-kit-lab <command> --help\" (or \"my-dev-kit-lab <family> <command> --help\") for details.",
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

export function renderExperimentHelp(): string {
  return [
    "my-dev-kit-lab experiment - experiment command family",
    "",
    "Usage:",
    "  my-dev-kit-lab experiment controlled [options]",
    "  my-dev-kit-lab experiment --help",
    "",
    "Commands:",
    "  controlled   Run a controlled context-strategy-comparison experiment.",
    "               Run \"my-dev-kit-lab experiment controlled --help\" for details."
  ].join("\n");
}

export function renderExperimentControlledHelp(): string {
  return [
    "my-dev-kit-lab experiment controlled - run a controlled context-strategy-comparison experiment",
    "",
    "Usage:",
    "  my-dev-kit-lab experiment controlled --cases <path> --out <dir> [options]",
    "",
    "Required:",
    "  --cases <path>   Path to the evaluation cases file",
    "  --out <dir>      Output directory for experiment artifacts",
    "",
    "Options:",
    "  --project-profiles <path>                          Path to the benchmark project profiles file",
    "                                                      (default: the bundled package resource)",
    "  --case <ids>                                       Comma-separated case ids to run",
    "  --benchmark-project <ids>                          Comma-separated benchmark project ids to run",
    "  --agents <list>                                    Comma-separated agent ids (default: fake-agent)",
    "  --strategies <list>                                Comma-separated strategies: raw-full-file,my-dev-kit-guided",
    "  --complexities <list>                               Comma-separated complexity levels: short,medium,long,multi-step",
    "  --timeout-ms <ms>                                  Per-run timeout in milliseconds",
    "  --max-runs <n>                                     Maximum number of runs",
    "  --continue-on-failure / --no-continue-on-failure   Continue after a failed run (default: continue-on-failure)",
    "  --require-agents                                   Fail if no real agent command templates are configured",
    "  --include-real-agents                              Allow real agent ids (codex, claude)",
    "  --command-template-codex <template>                Command template used to invoke the codex agent",
    "  --command-template-claude <template>               Command template used to invoke the claude agent"
  ].join("\n");
}

export function renderReportHelp(): string {
  return [
    "my-dev-kit-lab report - report command family",
    "",
    "Usage:",
    "  my-dev-kit-lab report render [options]",
    "  my-dev-kit-lab report --help",
    "",
    "Commands:",
    "  render   Render an HTML/JSON experiment report from controlled-experiment artifacts.",
    "           Run \"my-dev-kit-lab report render --help\" for details."
  ].join("\n");
}

export function renderReportRenderHelp(): string {
  return [
    "my-dev-kit-lab report render - render an HTML/JSON experiment report from controlled-experiment artifacts",
    "",
    "Usage:",
    "  my-dev-kit-lab report render --experiment <dir> --out <dir> [options]",
    "",
    "Required:",
    "  --experiment <dir>   Path to a controlled-experiment output directory",
    "  --out <dir>          Output directory for the rendered report",
    "",
    "Options:",
    "  --title <title>                    Report title",
    "  --subtitle <subtitle>               Report subtitle",
    "  --screenshot / --no-screenshot      Enable/disable PNG screenshot capture (default: disabled)",
    "  --require-screenshot                Fail unless a screenshot was captured (implies --screenshot)",
    "  --max-prompt-chars <n>              Maximum characters of prompt text to include",
    "  --max-file-tree-entries <n>         Maximum file tree entries to include",
    "  --plots <dir>                       Optional plots directory to include in the report",
    "  --visualizations <dir>              Optional visualization-demos directory to include in the report"
  ].join("\n");
}

export function renderPlotsHelp(): string {
  return [
    "my-dev-kit-lab plots - plots command family",
    "",
    "Usage:",
    "  my-dev-kit-lab plots generate [options]",
    "  my-dev-kit-lab plots --help",
    "",
    "Commands:",
    "  generate   Generate experiment plot artifacts from controlled-experiment artifacts.",
    "             Run \"my-dev-kit-lab plots generate --help\" for details."
  ].join("\n");
}

export function renderPlotsGenerateHelp(): string {
  return [
    "my-dev-kit-lab plots generate - generate chart/plot artifacts from controlled-experiment artifacts",
    "",
    "Usage:",
    "  my-dev-kit-lab plots generate --experiment <dir> --out <dir>",
    "",
    "Required:",
    "  --experiment <dir>   Path to a controlled-experiment output directory",
    "  --out <dir>          Output directory for plot artifacts"
  ].join("\n");
}

export function renderGalleryHelp(): string {
  return [
    "my-dev-kit-lab gallery - gallery command family",
    "",
    "Usage:",
    "  my-dev-kit-lab gallery build [options]",
    "  my-dev-kit-lab gallery --help",
    "",
    "Commands:",
    "  build   Build a gallery manifest/index from report, plots, and visualization artifacts.",
    "          Run \"my-dev-kit-lab gallery build --help\" for details."
  ].join("\n");
}

export function renderGalleryBuildHelp(): string {
  return [
    "my-dev-kit-lab gallery build - build a gallery manifest/index from existing artifacts",
    "",
    "Usage:",
    "  my-dev-kit-lab gallery build --out <dir> [options]",
    "",
    "Required:",
    "  --out <dir>   Output directory for the gallery manifest and index",
    "",
    "Options:",
    "  --report <dir>           Path to a rendered report directory",
    "  --plots <dir>            Path to a plots output directory",
    "  --visualizations <dir>   Path to a visualization-demos output directory",
    "  --experiment <dir>       Path to a controlled-experiment output directory"
  ].join("\n");
}

export function renderUnknownCommandError(command: string): string {
  return [
    `Unknown command: ${command}`,
    "Run \"my-dev-kit-lab --help\" for usage."
  ].join("\n");
}
