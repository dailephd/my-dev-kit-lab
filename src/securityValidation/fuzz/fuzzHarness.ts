import type { SecurityCheckResult, SecurityFinding } from "../types.js";
import { createPrng, type Prng } from "./randomInput.js";

// ---------------------------------------------------------------------------
// Fuzz harness — bounded, deterministic, fast
//
// Designed for smoke-level release validation.
// - Seeded PRNG for reproducibility.
// - Configurable iteration count (default: low for CI speed).
// - Crashes become structured findings.
// - Expected validation errors do NOT count as crashes.
// ---------------------------------------------------------------------------

export type FuzzResult = {
  targetId: string;
  targetName: string;
  iterations: number;
  crashes: FuzzCrash[];
  durationMs: number;
};

export type FuzzCrash = {
  iteration: number;
  input: string;
  errorMessage: string;
  stack?: string;
};

export type FuzzTarget = {
  id: string;
  name: string;
  generateInput: (prng: Prng, iteration: number) => string;
  // Returns undefined = OK, string = expected/validation error (not a crash).
  // Throws = crash (becomes a finding).
  run: (input: string) => undefined | string;
};

export type FuzzHarnessOptions = {
  seed?: number;
  iterations?: number;
  maxCrashesPerTarget?: number;
};

export async function runFuzzTarget(
  target: FuzzTarget,
  options: FuzzHarnessOptions = {}
): Promise<FuzzResult> {
  const seed = options.seed ?? 0xdeadbeef;
  const iterations = options.iterations ?? 50;
  const maxCrashes = options.maxCrashesPerTarget ?? 10;

  const prng = createPrng(seed);
  const crashes: FuzzCrash[] = [];
  const started = Date.now();

  for (let i = 0; i < iterations && crashes.length < maxCrashes; i++) {
    const input = target.generateInput(prng, i);
    try {
      target.run(input);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      crashes.push({ iteration: i, input: input.slice(0, 200), errorMessage, stack });
    }
  }

  return {
    targetId: target.id,
    targetName: target.name,
    iterations,
    crashes,
    durationMs: Date.now() - started,
  };
}

export async function runAllFuzzTargets(
  targets: FuzzTarget[],
  options: FuzzHarnessOptions = {}
): Promise<SecurityCheckResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();

  const allResults: FuzzResult[] = [];
  for (const target of targets) {
    const result = await runFuzzTarget(target, options);
    allResults.push(result);
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - started;

  const allCrashes = allResults.flatMap((r) =>
    r.crashes.map((c) => ({ targetId: r.targetId, targetName: r.targetName, ...c }))
  );

  const findings: SecurityFinding[] = allCrashes.map((c) => ({
    id: `fuzz-crash-${c.targetId}-iter-${c.iteration}`,
    title: `Fuzz crash in ${c.targetName} (iteration ${c.iteration})`,
    severity: "major" as const,
    category: "fuzz-smoke" as const,
    description: c.errorMessage,
    evidence: `Input (first 200 chars): ${c.input}${c.stack ? `\nStack: ${c.stack.slice(0, 300)}` : ""}`,
    recommendation: "Investigate and add defensive input validation in the parser.",
    releaseImpact: "Should fix before release",
  }));

  const totalIterations = allResults.reduce((sum, r) => sum + r.iterations, 0);

  return {
    id: "fuzz-smoke",
    name: `Fuzz smoke (${targets.length} targets, ${totalIterations} total iterations)`,
    category: "fuzz-smoke",
    status: findings.length === 0 ? "passed" : "failed",
    severity: findings.length === 0 ? "informational" : "major",
    startedAt,
    finishedAt,
    durationMs,
    findings,
  };
}
