import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import {
  resolveIncrementalChangeStalenessScenarios,
  type IncrementalChangeStalenessResolvedScenarioV1
} from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioSelection.js";
import { writeGraphFakeKit } from "../warmIndexReuse/warmIndexTestHelpers.js";

export const repoRoot = process.cwd();

/**
 * Canonical identities recorded before Batch 3 lifecycle tests: the scenario
 * catalog, the warm-index benchmark case catalog, and the five canonical
 * controlled source/test files (plus the L2 medium-project file).
 */
export const CANONICAL_HASHES: Record<string, string> = {
  "benchmarks/contracts/warm-index-benchmark-cases.json": "f3fc9a6cac68c4d14d27eb5cc7d83944b6064a9edde6206357b2f6c2ceaef4c7",
  "benchmarks/contracts/incremental-change-staleness-scenarios.json": "08e3d440a79708a1f4817017f24821cae423326d3764092866ba7ee6b31d2ae7",
  "benchmarks/projects/task-analytics-large-mixed/py/task_analytics/quality.py": "5faab1bf018de6e647a11a2edffd641a51c0c05b399cb6f58a2c22b0ff035554",
  "benchmarks/projects/task-analytics-large-mixed/py/task_analytics/metrics.py": "da2bfce46ec51016f87b3456a201e69a9d71721002e1781b44fdc59a96650e91",
  "benchmarks/projects/task-analytics-large-mixed/ts/src/services/buildAnalyticsSnapshot.ts": "928af15041715ffa19ae3674e8d4f82e1c5f694cfa2bad1fea03db31bce6cedd",
  "benchmarks/projects/task-analytics-large-mixed/py/tests/test_quality.py": "b5610a2720012532baf6d18e114f375424008e0daadbc27291bfca2ce6316875",
  "benchmarks/projects/task-workflow-medium-ts/src/services/completeTask.ts": "27f6833abb1c5f8fa7226ec8a4857ba267dd48272d7cf094c7a3462e425ca64c"
};

export function sha256OfFile(absolutePath: string): string {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

export function expectCanonicalFilesUnchanged(): void {
  for (const [relativePath, expectedSha] of Object.entries(CANONICAL_HASHES)) {
    expect(sha256OfFile(path.resolve(repoRoot, relativePath))).toBe(expectedSha);
  }
}

/** No canonical benchmark directory may ever contain lifecycle index output. */
export function expectNoIndexOutputInCanonicalProjects(): void {
  for (const project of ["task-analytics-large-mixed", "task-workflow-medium-ts"]) {
    const root = path.resolve(repoRoot, "benchmarks/projects", project);
    expect(existsSync(path.join(root, "manifest.json"))).toBe(false);
    expect(existsSync(path.join(root, ".my-dev-kit"))).toBe(false);
  }
}

// Disposable runtime roots must stay inside the repository worktree (Batch 2
// containment), so lifecycle run roots live under the gitignored
// .my-dev-kit-context/ directory rather than the OS temp directory.
export const testRuntimeParent = path.join(repoRoot, ".my-dev-kit-context", "test-runtime");

export function makeRunOwnedRoot(tracked: string[], prefix = "ics-batch3-"): string {
  mkdirSync(testRuntimeParent, { recursive: true });
  const dir = mkdtempSync(path.join(testRuntimeParent, prefix));
  tracked.push(dir);
  return dir;
}

/** Fake upstream CLI scripts are test infrastructure, not targets; they may live in the OS temp dir. */
export function makeKitDir(tracked: string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ics-batch3-kit-"));
  tracked.push(dir);
  return dir;
}

export type LifecycleFakeKit = { command: string; logPath: string };

/**
 * Real-shaped fake my-dev-kit: manifest + symbol index + code graph for every
 * .ts/.js/.py file under the `--src` roots (relative to `--root`), a fixed
 * `--version`, and a log of every invoked subcommand. Optional tampering is
 * applied to the written manifest after `index`, only for --out paths
 * containing `tamperWhenOutContains` (all indexes when omitted).
 */
export function writeLifecycleFakeKit(
  dir: string,
  options: { tamper?: "projectRoot" | "noCodeGraph"; tamperWhenOutContains?: string } = {}
): LifecycleFakeKit {
  const graph = writeGraphFakeKit(dir, { symbols: {} });
  if (!options.tamper) {
    return graph;
  }
  const graphScript = path.join(dir, "fake-kit-graph.mjs");
  const wrapperPath = path.join(dir, "fake-kit-tamper.mjs");
  writeFileSync(
    wrapperPath,
    [
      `import fs from "node:fs";`,
      `import path from "node:path";`,
      `import { spawnSync } from "node:child_process";`,
      `const args = process.argv.slice(2);`,
      `const result = spawnSync(process.execPath, [${JSON.stringify(graphScript)}, ...args], { stdio: "inherit" });`,
      `if (args[0] === "index" && result.status === 0) {`,
      `  const out = args[args.indexOf("--out") + 1];`,
      `  const needle = ${JSON.stringify(options.tamperWhenOutContains ?? "")};`,
      `  if (!needle || out.replace(/\\\\/g, "/").includes(needle)) {`,
      `    const manifestPath = path.join(out, "manifest.json");`,
      `    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));`,
      options.tamper === "projectRoot" ? `    manifest.projectRoot = manifest.projectRoot + "-elsewhere";` : "",
      options.tamper === "noCodeGraph" ? `    delete manifest.artifacts.codeGraph;` : "",
      `    fs.writeFileSync(manifestPath, JSON.stringify(manifest));`,
      `  }`,
      `}`,
      `process.exit(result.status ?? 1);`
    ].join("\n")
  );
  return { command: `node ${wrapperPath}`, logPath: graph.logPath };
}

export function readKitLog(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

export async function resolveScenario(scenarioId: string): Promise<IncrementalChangeStalenessResolvedScenarioV1> {
  const [resolved] = await resolveIncrementalChangeStalenessScenarios({ repoRoot, scenarioIds: [scenarioId] });
  return resolved;
}

/** The deterministic lifecycle stage sequence of one successful scenario. */
export const EXPECTED_READY_LIFECYCLE_EVENTS = [
  "treatment-targets-created",
  "pre-mutation-source-state-captured",
  "pre-mutation-equivalence-proven",
  "stale-index:baseline-index-built",
  "stale-index:baseline-snapshot-captured",
  "stale-index:baseline-graph-loaded",
  "stale-index:baseline-identity-verified",
  "full-refresh:baseline-index-built",
  "full-refresh:baseline-snapshot-captured",
  "full-refresh:baseline-graph-loaded",
  "full-refresh:baseline-identity-verified",
  "baseline-tool-identity-verified",
  "baseline-barrier-ready",
  "stale-index:mutation-applied",
  "full-refresh:mutation-applied",
  "post-mutation-source-state-captured",
  "post-mutation-equivalence-proven",
  "stale-index:baseline-freshness-stale",
  "full-refresh:baseline-freshness-stale",
  "baseline-changed-paths-symmetric",
  "stale-index:baseline-retained-as-active",
  "full-refresh:refreshed-index-built",
  "full-refresh:refreshed-snapshot-captured",
  "full-refresh:refreshed-graph-loaded",
  "full-refresh:refreshed-identity-verified",
  "full-refresh:refreshed-freshness-fresh",
  "tool-identity-consistent",
  "full-refresh:refreshed-active",
  "lifecycle-ready"
];

export type FakeRefreshBehavior = "applied" | "fallback" | "not-needed" | "fail" | "invalid";

export type IncrementalFakeKitOptions = {
  /** How `--incremental` behaves against an index directory without cache metadata (default: cache-missing fallback). */
  bootstrap?: "cache-missing" | "wrong-reason" | "applied" | "fail" | "no-evidence";
  /** How `--incremental` behaves once cache metadata exists, per requested scope. Default: applied. */
  refresh?: Partial<Record<"changed-files" | "affected-neighborhood", FakeRefreshBehavior>>;
  /** A full (non-incremental) index whose --out contains this text fails. */
  failFullWhenOutContains?: string;
};

/**
 * Test-local fake that models the documented my-dev-kit 1.12.5 `--incremental --refresh-scope` JSON
 * contract on top of the real-shaped lifecycle fake kit. Incremental invocations always leave a
 * complete index of the current target (so freshness can be proven) plus `cache-metadata.json`, and
 * every `index` invocation's arguments are appended to `<returned argsLogPath>`.
 */
export function writeIncrementalLifecycleFakeKit(
  dir: string,
  options: IncrementalFakeKitOptions = {}
): LifecycleFakeKit & { argsLogPath: string } {
  const graph = writeGraphFakeKit(dir, { symbols: {} });
  const graphScript = path.join(dir, "fake-kit-graph.mjs");
  const wrapperPath = path.join(dir, "fake-kit-incremental.mjs");
  const argsLogPath = `${wrapperPath}.args.log`;
  writeFileSync(
    wrapperPath,
    [
      `import fs from "node:fs";`,
      `import path from "node:path";`,
      `import { spawnSync } from "node:child_process";`,
      `const options = ${JSON.stringify(options)};`,
      `const args = process.argv.slice(2);`,
      `if (args[0] !== "index") { const r = spawnSync(process.execPath, [${JSON.stringify(graphScript)}, ...args], { stdio: "inherit" }); process.exit(r.status ?? 1); }`,
      `fs.appendFileSync(${JSON.stringify(argsLogPath)}, JSON.stringify(args) + "\\n");`,
      `const out = args[args.indexOf("--out") + 1];`,
      `const normalizedOut = out.replace(/\\\\/g, "/");`,
      `const incremental = args.includes("--incremental");`,
      `if (!incremental) {`,
      `  if (options.failFullWhenOutContains && normalizedOut.includes(options.failFullWhenOutContains)) { process.stderr.write("forced full index failure"); process.exit(1); }`,
      `  const r = spawnSync(process.execPath, [${JSON.stringify(graphScript)}, ...args], { stdio: "inherit" }); process.exit(r.status ?? 1);`,
      `}`,
      `const scope = args[args.indexOf("--refresh-scope") + 1];`,
      `const cachePath = path.join(out, "cache-metadata.json");`,
      `const cachePresent = fs.existsSync(cachePath);`,
      `const behavior = cachePresent ? (options.refresh?.[scope] ?? "applied") : (options.bootstrap ?? "cache-missing");`,
      `if (behavior === "fail") { process.stderr.write("forced incremental failure"); process.exit(1); }`,
      `const forwarded = args.filter((value, i) => value !== "--incremental" && value !== "--refresh-scope" && args[i - 1] !== "--refresh-scope");`,
      `const r = spawnSync(process.execPath, [${JSON.stringify(graphScript)}, ...forwarded], { stdio: ["ignore", "pipe", "inherit"] });`,
      `if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);`,
      `fs.writeFileSync(cachePath, JSON.stringify({ cache: "fake" }));`,
      `const base = { requestedScope: scope, appliedScope: scope, selectionStatus: "applied", fallbackReason: null, seedFileCount: scope === "affected-neighborhood" ? 1 : null, seedSymbolCount: scope === "affected-neighborhood" ? 2 : null, affectedNodeCount: scope === "affected-neighborhood" ? 5 : null, affectedEdgeCount: scope === "affected-neighborhood" ? 4 : null, forcedNeighborReanalysisFileCount: 0, forcedNeighborSample: [], freshExtractionFileCount: 1, reusedFileCount: 9 };`,
      `const fallback = (reason) => ({ ...base, appliedScope: "full", selectionStatus: "fallback-full", fallbackReason: reason, seedFileCount: null, seedSymbolCount: null, affectedNodeCount: null, affectedEdgeCount: null, freshExtractionFileCount: 10, reusedFileCount: 0 });`,
      `let evidence;`,
      `if (behavior === "cache-missing") evidence = fallback("cache-missing");`,
      `else if (behavior === "wrong-reason") evidence = fallback("cache-incompatible");`,
      `else if (behavior === "applied") evidence = base;`,
      `else if (behavior === "fallback") evidence = fallback("seed-selection-unavailable");`,
      `else if (behavior === "not-needed") evidence = { ...base, appliedScope: "none", selectionStatus: "not-needed", seedFileCount: null, seedSymbolCount: null, affectedNodeCount: null, affectedEdgeCount: null, freshExtractionFileCount: 0, reusedFileCount: 10 };`,
      `else if (behavior === "invalid") evidence = { ...base, selectionStatus: "maybe" };`,
      `else evidence = undefined;`,
      `console.log(JSON.stringify(evidence === undefined ? { ok: true } : { ok: true, incrementalRefresh: evidence }));`,
      `process.exit(0);`
    ].join("\n")
  );
  return { command: `node ${wrapperPath}`, logPath: graph.logPath, argsLogPath };
}

export function readIndexArgsLog(argsLogPath: string): string[][] {
  return readKitLog(argsLogPath).map((line) => JSON.parse(line) as string[]);
}
