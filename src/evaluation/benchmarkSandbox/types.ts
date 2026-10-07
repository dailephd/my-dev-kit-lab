import type { TreeSnapshotEntry } from "./treeSnapshot.js";

export const BENCHMARK_SANDBOX_SCHEMA_VERSION = "my-dev-kit-lab-benchmark-sandbox-v1";
export const BENCHMARK_SANDBOX_OWNER_MARKER_FILE = "sandbox-owner.json";
export const BENCHMARK_SANDBOX_BASELINE_BRANCH = "sandbox-baseline";

export type BenchmarkSandboxBaseline = {
  /** Commit created by the sandbox itself; every later change is measured against it. */
  commit: string;
  fileCount: number;
  /** Aggregate digest of `manifest`. */
  digest: string;
  /** Sorted path/sha256/size of every baseline file. */
  manifest: readonly TreeSnapshotEntry[];
};

/** A ready sandbox: an independent copy with a clean ephemeral Git baseline. */
export type BenchmarkSandbox = {
  schemaVersion: typeof BENCHMARK_SANDBOX_SCHEMA_VERSION;
  sandboxId: string;
  /** `<runtimeRoot>/<sandboxId>`; the only directory this sandbox owns and may remove. */
  sandboxRoot: string;
  /** The writable project copy (a Git repository of its own). */
  projectRoot: string;
  /** Command artifacts (Git, verification). Lives beside, not inside, the project copy. */
  evidenceRoot: string;
  runtimeRoot: string;
  canonicalProjectRoot: string;
  baseline: BenchmarkSandboxBaseline;
};

export type BenchmarkSandboxOwnerMarker = {
  schemaVersion: typeof BENCHMARK_SANDBOX_SCHEMA_VERSION;
  sandboxId: string;
  runtimeRoot: string;
  canonicalProjectRoot: string;
};

export type CreateBenchmarkSandboxOptions = {
  /** Controlled benchmark project (for example benchmarks/projects/<id>). Never written. */
  canonicalProjectRoot: string;
  /** Caller-owned writable runtime root. Must not overlap the canonical project in either direction. */
  runtimeRoot: string;
  sandboxId: string;
};

export type RemoveBenchmarkSandboxOptions = {
  runtimeRoot: string;
  sandboxId: string;
};

export type RemoveBenchmarkSandboxResult =
  | { removed: true; alreadyAbsent: boolean }
  | { removed: false; reason: string };
