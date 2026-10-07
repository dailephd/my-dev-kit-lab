/**
 * Variables a child process needs to locate and start `node` or `git` on the supported platforms. Nothing
 * else is forwarded from the parent: provider keys, tokens, cookies and project secrets must never reach
 * Lab-run verification or Git processes. Names are matched case-insensitively (Windows environments are).
 */
const FORWARDED_NAMES = [
  "path",
  "systemroot",
  "systemdrive",
  "windir",
  "comspec",
  "pathext",
  "temp",
  "tmp",
  "tmpdir",
  "lang",
  "lc_all"
] as const;

/** Defense in depth: even an allowed name is dropped if it looks credential-like. */
const CREDENTIAL_LIKE = /(key|token|secret|passw|credential|auth|cookie|session)/i;

export function buildMinimalHostEnv(
  source: NodeJS.ProcessEnv = process.env,
  extras: Readonly<Record<string, string>> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const actualNames = Object.keys(source);
  for (const wanted of FORWARDED_NAMES) {
    const actual = actualNames.find((name) => name.toLowerCase() === wanted);
    if (actual === undefined) continue;
    const value = source[actual];
    if (value === undefined || CREDENTIAL_LIKE.test(actual)) continue;
    env[actual] = value;
  }
  for (const [name, value] of Object.entries(extras)) {
    env[name] = value;
  }
  return env;
}
