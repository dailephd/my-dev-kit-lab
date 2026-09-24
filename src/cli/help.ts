export function renderTopLevelHelp(): string {
  return [
    "my-dev-kit-lab - benchmark, evidence, and evaluation companion for my-dev-kit.",
    "",
    "Usage:",
    "  my-dev-kit-lab --help",
    "  my-dev-kit-lab --version",
    "  my-dev-kit-lab [--workspace <path>] security validate [options]",
    "  my-dev-kit-lab [--workspace <path>] audit [options]",
    "  my-dev-kit-lab [--workspace <path>] experiment list",
    "  my-dev-kit-lab [--workspace <path>] experiment describe --experiment <id>",
    "  my-dev-kit-lab [--workspace <path>] experiment run --experiment <id> [options]",
    "  my-dev-kit-lab [--workspace <path>] experiment controlled --cases <path> --out <dir> [options]",
    "  my-dev-kit-lab [--workspace <path>] report render --experiment <dir> --out <dir> [options]",
    "  my-dev-kit-lab [--workspace <path>] plots generate --experiment <dir> --out <dir>",
    "  my-dev-kit-lab [--workspace <path>] gallery build --out <dir> [options]",
    "  my-dev-kit-lab tutorial validate --scenario <path> [--target-contract <path>]",
    "  my-dev-kit-lab [--workspace <path>] tutorial run --scenario <path> --target-contract <path> [options]",
    "  my-dev-kit-lab demo final --cases <path> --out <dir> --kit-command <command> [options]",
    "",
    "Options:",
    "  -h, --help           Show this help message",
    "  -V, --version        Show the installed my-dev-kit-lab package version",
    "  --workspace <path>   Writable my-dev-kit-lab workspace root (default: <home>/.my-dev-kit-lab).",
    "                       Must appear before the command when used.",
    "",
    "Commands:",
    "  security validate        Run security validation",
    "  audit                    Run a project audit",
    "  experiment list           List registered experiment plugins",
    "  experiment describe       Describe a registered experiment plugin",
    "  experiment run             Run a registered experiment plugin",
    "  experiment controlled    Run a controlled context-strategy-comparison experiment",
    "  report render             Render an experiment report from controlled-experiment artifacts",
    "  plots generate             Generate experiment plot artifacts",
    "  gallery build              Build a gallery manifest/index",
    "  tutorial validate          Validate a tutorial scenario and optional target contract",
    "  tutorial run               Run a declarative browser tutorial scenario",
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
    "  my-dev-kit-lab experiment list",
    "  my-dev-kit-lab experiment describe --experiment <id>",
    "  my-dev-kit-lab experiment run --experiment <id> [options]",
    "  my-dev-kit-lab experiment controlled [options]",
    "  my-dev-kit-lab experiment --help",
    "",
    "Commands:",
    "  list         List registered experiment plugins.",
    "               Run \"my-dev-kit-lab experiment list --help\" for details.",
    "  describe     Describe a registered experiment plugin.",
    "               Run \"my-dev-kit-lab experiment describe --help\" for details.",
    "  run          Run a registered experiment plugin through the generic runner.",
    "               Run \"my-dev-kit-lab experiment run --help\" for details.",
    "  controlled   Run a controlled context-strategy-comparison experiment.",
    "               Run \"my-dev-kit-lab experiment controlled --help\" for details."
  ].join("\n");
}

export function renderExperimentListHelp(): string {
  return [
    "my-dev-kit-lab experiment list - list registered experiment plugins",
    "",
    "Usage:",
    "  my-dev-kit-lab experiment list [--json]",
    "",
    "Options:",
    "  --json   Print the experiment list as JSON instead of a human-readable summary"
  ].join("\n");
}

export function renderExperimentDescribeHelp(): string {
  return [
    "my-dev-kit-lab experiment describe - describe a registered experiment plugin",
    "",
    "Usage:",
    "  my-dev-kit-lab experiment describe --experiment <id> [--json]",
    "",
    "Required:",
    "  --experiment <id>   Registered experiment plugin id (see \"my-dev-kit-lab experiment list\")",
    "",
    "Options:",
    "  --json   Print the description as JSON instead of a human-readable summary"
  ].join("\n");
}

export function renderExperimentRunHelp(): string {
  return [
    "my-dev-kit-lab experiment run - run a registered experiment plugin through the generic runner",
    "",
    "Usage:",
    "  my-dev-kit-lab experiment run --experiment <id> [options]",
    "",
    "Required:",
    "  --experiment <id>   Registered experiment plugin id (see \"my-dev-kit-lab experiment list\")",
    "",
    "Common options (all plugins):",
    "  --target <path>                                    Local target project path (default: self)",
    "  --out <dir>                                         Output directory for experiment artifacts",
    "                                                      (default: beneath the workspace when installed)",
    "  --cases <path>                                      Path to the evaluation cases file",
    "                                                      (default: the bundled package resource)",
    "  --project-profiles <path>                          Path to the benchmark project profiles file",
    "                                                      (default: the bundled package resource)",
    "  --case <ids>                                       Comma-separated case ids to run",
    "  --benchmark-project <ids>                          Comma-separated benchmark project ids to run",
    "",
    "warm-index-reuse only:",
    "  --kit-command <command>                            my-dev-kit command used to build one index per benchmark",
    "                                                      project and retrieve per task",
    "                                                      (default: npx @dailephd/my-dev-kit@latest)",
    "                                                      Legacy/default mode uses the deterministic fake agent only;",
    "                                                      agent options below are not accepted by this plugin.",
    "  --campaign <preset>                                 Runs the selected real-agent campaign preset: codex-full,",
    "                                                      claude-full, codex-timeout-isolation. Selects Codex or",
    "                                                      Claude as the preset's single provider and requires",
    "                                                      --include-real-agents. The preset owns the bundled",
    "                                                      production corpus and project profiles; explicit",
    "                                                      --cases/--project-profiles and --target are rejected in",
    "                                                      campaign mode. --case and --benchmark-project narrow the",
    "                                                      preset's case set. --kit-command and --timeout-ms are",
    "                                                      accepted. The report distinguishes warm-index",
    "                                                      infrastructure status from agent/provider outcome status;",
    "                                                      provider token telemetry may be unavailable and is never",
    "                                                      replaced by a context-size estimate. A campaign run",
    "                                                      automatically produces the report JSON/text/HTML, the",
    "                                                      four warm-index SVG plots, a best-effort report PNG",
    "                                                      screenshot, and a gallery manifest/index. A missing",
    "                                                      Playwright/browser runtime makes screenshot capture skip",
    "                                                      without invalidating the campaign; an unexpected",
    "                                                      screenshot failure makes the command unsuccessful after",
    "                                                      preserving the report, plots, and gallery. Legacy",
    "                                                      non-campaign warm-index runs retain their existing",
    "                                                      report-only behavior.",
    "",
    "context-strategy-comparison only:",
    "  --agents <list>                                    Comma-separated agent ids (default: fake-agent)",
    "  --strategies <list>                                Comma-separated strategies: raw-full-file,my-dev-kit-guided",
    "  --complexities <list>                               Comma-separated complexity levels: short,medium,long,multi-step",
    "  --timeout-ms <ms>                                  Per-run timeout in milliseconds",
    "  --max-runs <n>                                     Maximum number of runs",
    "  --continue-on-failure / --no-continue-on-failure   Continue after a failed run (default: continue-on-failure)",
    "  --require-agents                                   Fail if no real agent command templates are configured",
    "  --include-real-agents                              Allow real agent ids (codex, claude)",
    "  --command-template-codex <template>                Command template used to invoke the codex agent",
    "  --command-template-claude <template>               Command template used to invoke the claude agent",
    "  --no-screenshot                                     Accepted for compatibility; the plugin-aware report",
    "                                                      path does not capture screenshots yet"
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
    "  generate   Generate experiment plot artifacts from controlled-experiment or supported",
    "             plugin experiment artifacts (warm-index-reuse).",
    "             Run \"my-dev-kit-lab plots generate --help\" for details."
  ].join("\n");
}

export function renderPlotsGenerateHelp(): string {
  return [
    "my-dev-kit-lab plots generate - generate chart/plot artifacts from experiment artifacts",
    "",
    "Usage:",
    "  my-dev-kit-lab plots generate --experiment <dir> --out <dir>",
    "",
    "Supported inputs:",
    "  - legacy controlled-experiment output directories",
    "  - warm-index-reuse plugin output directories (containing its report.json)",
    "  Other plugin outputs are not plotted by this command.",
    "",
    "Required:",
    "  --experiment <dir>   Path to a supported experiment output directory",
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

export function renderSecurityHelp(): string {
  return [
    "my-dev-kit-lab security - security command family",
    "",
    "Usage:",
    "  my-dev-kit-lab security validate [options]",
    "  my-dev-kit-lab security --help",
    "",
    "Commands:",
    "  validate   Run security validation. Run \"my-dev-kit-lab security validate --help\" for details."
  ].join("\n");
}

export function renderUnknownCommandError(command: string): string {
  return [
    `Unknown command: ${command}`,
    "Run \"my-dev-kit-lab --help\" for usage."
  ].join("\n");
}

export function renderTutorialHelp(): string {
  return [
    "my-dev-kit-lab tutorial - declarative browser tutorial command family",
    "",
    "Usage:",
    "  my-dev-kit-lab tutorial validate --scenario <path> [--target-contract <path>] [--json]",
    "  my-dev-kit-lab [--workspace <path>] tutorial run --scenario <path> --target-contract <path> [options]",
    "  my-dev-kit-lab tutorial --help",
    "",
    "Commands:",
    "  validate   Validate a tutorial scenario, and optionally a target contract and their",
    "             declared target identity. Does not start processes or a browser.",
    "             Run \"my-dev-kit-lab tutorial validate --help\" for details.",
    "  run        Prepare a disposable target, start its declared processes, and execute a",
    "             tutorial scenario in a persistent browser session.",
    "             Run \"my-dev-kit-lab tutorial run --help\" for details."
  ].join("\n");
}

export function renderTutorialValidateHelp(): string {
  return [
    "my-dev-kit-lab tutorial validate - validate tutorial contracts",
    "",
    "Usage:",
    "  my-dev-kit-lab tutorial validate --scenario <path> [--target-contract <path>] [--json]",
    "",
    "Required:",
    "  --scenario <path>           Path to a TutorialScenarioV1 JSON file",
    "",
    "Options:",
    "  --target-contract <path>    Also validate a TutorialTargetContractV1 JSON file and",
    "                              verify that the scenario targetId matches its id",
    "  --json                      Print a deterministic JSON report instead of a summary",
    "",
    "Relative paths resolve against the directory the command was invoked from.",
    "This command is read-only: it creates no directories, runs no commands, starts no",
    "processes, and does not require a browser runtime.",
    "",
    "Exit codes:",
    "  0   Contracts are valid",
    "  1   Contract validation failed",
    "  2   Invalid command usage"
  ].join("\n");
}

export function renderTutorialRunHelp(): string {
  return [
    "my-dev-kit-lab tutorial run - run a declarative browser tutorial scenario",
    "",
    "Usage:",
    "  my-dev-kit-lab [--workspace <path>] tutorial run --scenario <path> --target-contract <path> [--out <dir>] [--json]",
    "",
    "Required:",
    "  --scenario <path>           Path to a TutorialScenarioV1 JSON file",
    "  --target-contract <path>    Path to a TutorialTargetContractV1 JSON file",
    "",
    "Options:",
    "  --out <dir>                 Explicit run directory. An absolute path is used as given;",
    "                              a relative path resolves against the invocation directory.",
    "                              When omitted, the run is written to",
    "                              <workspace>/tutorials/<scenario-id>/<run-id>/",
    "  --json                      Print the TutorialRunResultV1 JSON instead of a summary",
    "",
    "The run prepares a disposable target working copy beneath the run directory, starts the",
    "processes the target contract declares, waits for each declared local readiness probe,",
    "then executes every scenario step in one persistent browser page. Process logs are",
    "written beneath the run directory and are not printed to the terminal.",
    "",
    "Exit codes:",
    "  0   The tutorial run passed",
    "  1   The invocation was valid but the tutorial did not pass",
    "  2   Invalid command usage"
  ].join("\n");
}
