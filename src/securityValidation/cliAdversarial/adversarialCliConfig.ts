import path from "node:path";

// ---------------------------------------------------------------------------
// Adversarial CLI target configuration
//
// CI tests use a deterministic fake CLI (tests/fixtures/fake-adversarial-cli.js).
// Real my-dev-kit target execution is opt-in via MY_DEV_KIT_SECURITY_TARGET_COMMAND.
// ---------------------------------------------------------------------------

export type AdversarialCliTarget = {
  /** Node.js executable path (process.execPath). */
  nodeExec: string;
  /**
   * Arguments that invoke the CLI, not including user-level args.
   * For the fake CLI: ["/path/to/fake-adversarial-cli.js"]
   * For a real CLI: e.g. ["/path/to/my-dev-kit"] or ["node", "/path/to/index.js"]
   */
  cliArgs: string[];
  /** Whether this is the real my-dev-kit target (vs the fake fixture). */
  isRealTarget: boolean;
  /** Timeout in ms for each CLI invocation. */
  timeoutMs: number;
};

const FAKE_CLI_PATH = path.resolve(
  process.cwd(),
  "tests",
  "fixtures",
  "fake-adversarial-cli.js"
);

/**
 * Returns the adversarial CLI target from environment or falls back to the
 * deterministic fake fixture.
 *
 * To use a real my-dev-kit command in opt-in mode:
 *   MY_DEV_KIT_SECURITY_TARGET_COMMAND=my-dev-kit npm run test:security
 *
 * The real target will be treated as a full command string.
 * If the command is not found or not executable, individual checks are skipped.
 */
export function getAdversarialCliTarget(): AdversarialCliTarget {
  const realTarget = process.env.MY_DEV_KIT_SECURITY_TARGET_COMMAND;
  if (realTarget) {
    return {
      nodeExec: process.execPath,
      cliArgs: [realTarget],
      isRealTarget: true,
      timeoutMs: 30_000,
    };
  }
  return {
    nodeExec: process.execPath,
    cliArgs: [FAKE_CLI_PATH],
    isRealTarget: false,
    timeoutMs: 10_000,
  };
}

/**
 * Returns the base command array (nodeExec + cliArgs) plus any additional args.
 */
export function buildCliCommand(
  target: AdversarialCliTarget,
  extraArgs: string[]
): { command: string; args: string[] } {
  return {
    command: target.nodeExec,
    args: [...target.cliArgs, ...extraArgs],
  };
}
