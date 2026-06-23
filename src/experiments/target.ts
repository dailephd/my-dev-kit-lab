import { resolveLocalProjectTarget } from "../core/localProjectTarget.js";
import type { ExperimentTarget } from "./types.js";

export function resolveExperimentTarget(
  targetPathArg: string | undefined,
  toolRoot: string
): ExperimentTarget {
  const target = resolveLocalProjectTarget(targetPathArg, toolRoot);
  return {
    ...target,
    kind: target.isSelf ? "self" : "external-local",
  };
}
