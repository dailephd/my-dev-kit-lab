// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — minimal child-process environment construction.
//
// Neither existing process runner (runSecurityCommand, runMeasuredCommand)
// minimizes the environment — both inherit the full caller process.env.
// External tools are the first Batch 7 use case that must NOT propagate
// arbitrary caller credentials (SEMGREP_APP_TOKEN, GITHUB_TOKEN, NVD_API_KEY,
// cloud credentials, ...) to a spawned child, so this is new, additive
// infrastructure rather than a correction to either existing runner.
// ---------------------------------------------------------------------------

const ALWAYS_ALLOWED_KEYS = ["PATH", "Path", "SystemRoot", "ComSpec", "COMSPEC", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "LC_ALL"];

export type MinimalEnvironmentOptions = {
  // Additional allowed keys beyond ALWAYS_ALLOWED_KEYS, e.g. JAVA_HOME,
  // ANDROID_HOME, ANDROID_SDK_ROOT for tools that require them.
  additionalAllowedKeys?: readonly string[];
  source?: NodeJS.ProcessEnv;
};

// Never returns a value that was not explicitly allowlisted — this is a
// security invariant (agents.txt Batch 7 section 9.10/23.15), not a
// convenience default. A key present in the source env but not in the
// allowlist is silently omitted, never partially masked or renamed.
export function buildMinimalEnvironment(options: MinimalEnvironmentOptions = {}): NodeJS.ProcessEnv {
  const source = options.source ?? process.env;
  const allowedKeys = new Set([...ALWAYS_ALLOWED_KEYS, ...(options.additionalAllowedKeys ?? [])]);
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
