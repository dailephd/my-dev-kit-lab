import { existsSync } from "node:fs";
import path from "node:path";
import type { MeasuredCommandResult } from "../../../core/runMeasuredCommand.js";
import { buildMyDevKitIndex } from "../../../evaluation/runMyDevKitRetrieval.js";
import type { MyDevKitIndexBuildResult, MyDevKitIndexTarget } from "../../../evaluation/types.js";

/**
 * One successfully prepared my-dev-kit index that later tasks receive explicitly and retrieve
 * against. It carries only target identity and one-time build evidence; it holds no task state
 * and makes no freshness claim beyond the run that prepared it.
 */
export type WarmIndexSession = {
  readonly indexDir: string;
  readonly buildDurationMs: number;
  readonly targetRoot: string;
  readonly sourceRoots: readonly string[];
  readonly buildCommand: MeasuredCommandResult;
};

export type PrepareWarmIndexSessionResult =
  | { ok: true; session: WarmIndexSession; build: MyDevKitIndexBuildResult }
  | { ok: false; warnings: string[]; build: MyDevKitIndexBuildResult };

/**
 * Builds the index once through the shared `buildMyDevKitIndex` owner. A build that reports
 * success but leaves no index directory is not treated as a prepared session.
 */
export async function prepareWarmIndexSession(options: {
  target: MyDevKitIndexTarget;
  kitCommand: string;
  indexDir: string;
  commandsDir: string;
  requireKit: boolean;
}): Promise<PrepareWarmIndexSessionResult> {
  const build = await buildMyDevKitIndex(options);
  if (!build.ok) {
    return { ok: false, warnings: [...build.warnings], build };
  }
  if (!existsSync(build.indexDir)) {
    const message = `my-dev-kit index reported success but index directory is missing: ${build.indexDir}`;
    if (options.requireKit) {
      throw new Error(message);
    }
    return { ok: false, warnings: [...build.warnings, message], build };
  }
  const session: WarmIndexSession = Object.freeze({
    indexDir: build.indexDir,
    buildDurationMs: build.durationMs,
    targetRoot: options.target.absoluteTargetRoot,
    sourceRoots: Object.freeze([...options.target.sourceRoots]),
    buildCommand: build.command
  });
  return { ok: true, session, build };
}

function normalizeRoot(root: string): string {
  const resolved = path.resolve(root);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Rejects reuse of a session against a different target root or source-root configuration. */
export function assertWarmIndexSessionMatchesTarget(session: WarmIndexSession, target: MyDevKitIndexTarget): void {
  if (normalizeRoot(session.targetRoot) !== normalizeRoot(target.absoluteTargetRoot)) {
    throw new Error(`Warm index session target root ${session.targetRoot} does not match ${target.absoluteTargetRoot}.`);
  }
  const sameSourceRoots =
    session.sourceRoots.length === target.sourceRoots.length &&
    session.sourceRoots.every((sourceRoot, index) => sourceRoot === target.sourceRoots[index]);
  if (!sameSourceRoots) {
    throw new Error(
      `Warm index session source roots [${session.sourceRoots.join(", ")}] do not match [${target.sourceRoots.join(", ")}].`
    );
  }
}
