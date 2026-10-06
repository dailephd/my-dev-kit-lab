import { taskOutputSegment } from "../warmIndexReuse/selection.js";
import type { ContextPack } from "./types.js";

export const CONTEXT_PACK_ARTIFACT_DIRECTORY = "packs";
export const CONTEXT_PACK_ARTIFACT_SUFFIX = ".context-pack.json";

/**
 * Relative path of a case's bundled pack artifact. The case segment comes from the established safe output-segment helper;
 * a raw case id is never used as a path.
 */
export function contextPackArtifactRelativePath(caseId: string): string {
  return `${CONTEXT_PACK_ARTIFACT_DIRECTORY}/${taskOutputSegment(caseId)}${CONTEXT_PACK_ARTIFACT_SUFFIX}`;
}

/** The per-case artifact is the complete bundled pack (schema my-dev-kit-lab-context-pack-experiment-v1); no envelope, no clock. */
export function buildContextPackArtifact(pack: ContextPack): ContextPack {
  return structuredClone(pack);
}

export function serializeContextPackArtifact(pack: ContextPack): string {
  return `${JSON.stringify(buildContextPackArtifact(pack), null, 2)}\n`;
}
