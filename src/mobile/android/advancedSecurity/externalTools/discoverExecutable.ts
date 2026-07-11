import { resolveCommand } from "../../../../core/resolveCommand.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — allowlisted external-tool executable discovery.
//
// Reuses the existing cross-platform resolver (src/core/resolveCommand.ts,
// already used by src/securityValidation/commandRunner.ts and the Gradle
// wrapper planner) rather than a second PATH-search implementation. Only a
// fixed, closed candidate-basename list per tool may ever be tried — no
// caller-provided executable name is accepted anywhere in Batch 7.
// ---------------------------------------------------------------------------

export type DiscoveredExecutable = { available: true; command: string; basename: string } | { available: false };

// PATH resolution itself legitimately needs the real environment (a
// minimized env would defeat PATH search); only the later *analysis* spawn
// uses the minimized environment built by minimalEnvironment.ts.
export function discoverAllowlistedExecutable(candidateBasenames: readonly string[], cwd: string): DiscoveredExecutable {
  for (const basename of candidateBasenames) {
    const resolved = resolveCommand(basename, { cwd, env: process.env, allowPowerShellShim: false });
    if (resolved.resolutionKind !== "unavailable") {
      return { available: true, command: basename, basename };
    }
  }
  return { available: false };
}
