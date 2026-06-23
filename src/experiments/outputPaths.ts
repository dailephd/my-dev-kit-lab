import path from "node:path";
import type { ExperimentTarget } from "./types.js";

export function buildDefaultExperimentOutputRoot(args: {
  toolRoot: string;
  pluginId: string;
  target: ExperimentTarget;
  runId: string;
}): string {
  return path.join(
    args.toolRoot,
    "lab-output",
    "experiments",
    sanitizePathSegment(args.pluginId),
    targetSlug(args.target),
    sanitizePathSegment(args.runId)
  );
}

export function targetSlug(target: ExperimentTarget): string {
  const name = target.packageName ?? path.basename(target.targetRoot);
  const version = target.packageVersion ? `-v${target.packageVersion}` : "";
  const mode = target.isSelf ? "self" : "external";
  return sanitizePathSegment(`${name}${version}-${mode}`);
}

export function sanitizePathSegment(value: string): string {
  const sanitized = value
    .replaceAll("\\", "-")
    .replaceAll("/", "-")
    .replaceAll(":", "-")
    .replaceAll("@", "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || "target";
}

export function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
