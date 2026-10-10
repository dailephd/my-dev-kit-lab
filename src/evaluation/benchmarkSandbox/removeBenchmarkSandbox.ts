import { lstat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../core/pathSafety.js";
import { isSameOrInside, resolvePhysicalPath, SANDBOX_ID_PATTERN } from "./pathPolicy.js";
import {
  BENCHMARK_SANDBOX_OWNER_MARKER_FILE,
  BENCHMARK_SANDBOX_SCHEMA_VERSION,
  type BenchmarkSandboxOwnerMarker,
  type RemoveBenchmarkSandboxOptions,
  type RemoveBenchmarkSandboxResult
} from "./types.js";

/**
 * Removes one sandbox, and only a sandbox this subsystem created: the directory must be a real directory
 * directly inside the runtime root and carry an ownership marker whose schema, sandbox id and runtime root
 * match. Any mismatch is a refusal that leaves everything on disk untouched. The runtime root itself is
 * never removed.
 */
export async function removeBenchmarkSandbox(options: RemoveBenchmarkSandboxOptions): Promise<RemoveBenchmarkSandboxResult> {
  if (!SANDBOX_ID_PATTERN.test(options.sandboxId)) {
    return { removed: false, reason: "invalid sandbox id." };
  }
  const runtimeRoot = path.resolve(options.runtimeRoot);
  let sandboxRoot: string;
  try {
    sandboxRoot = resolveWithinRoot(runtimeRoot, options.sandboxId);
  } catch {
    return { removed: false, reason: "sandbox path escapes the runtime root." };
  }

  let stats;
  try {
    stats = await lstat(sandboxRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        await lstat(runtimeRoot);
        return { removed: true, alreadyAbsent: true };
      } catch {
        return { removed: false, reason: "the runtime root does not exist." };
      }
    }
    return { removed: false, reason: "the sandbox path could not be inspected." };
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return { removed: false, reason: "the sandbox path is not a plain directory." };
  }
  if (!isSameOrInside(await resolvePhysicalPath(runtimeRoot), await resolvePhysicalPath(sandboxRoot))) {
    return { removed: false, reason: "the sandbox resolves outside the runtime root." };
  }

  let marker: Partial<BenchmarkSandboxOwnerMarker>;
  try {
    marker = JSON.parse(await readFile(path.join(sandboxRoot, BENCHMARK_SANDBOX_OWNER_MARKER_FILE), "utf8")) as Partial<BenchmarkSandboxOwnerMarker>;
  } catch {
    return { removed: false, reason: "no readable ownership marker; the directory is not a recognized sandbox." };
  }
  if (
    marker.schemaVersion !== BENCHMARK_SANDBOX_SCHEMA_VERSION ||
    marker.sandboxId !== options.sandboxId ||
    typeof marker.runtimeRoot !== "string" ||
    path.resolve(marker.runtimeRoot) !== runtimeRoot
  ) {
    return { removed: false, reason: "the ownership marker does not match this sandbox." };
  }

  try {
    await rm(sandboxRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    return { removed: false, reason: `removal failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    await lstat(sandboxRoot);
    return { removed: false, reason: "the sandbox directory still exists after removal." };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { removed: true, alreadyAbsent: false }
      : { removed: false, reason: "the sandbox state could not be verified after removal." };
  }
}
