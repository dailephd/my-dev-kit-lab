import { readFile } from "node:fs/promises";
import { resolveWithinRoot } from "../../core/pathSafety.js";
import type { ExperimentRun } from "../../experiments/index.js";
import { CONTEXT_PACK_GENERATION_PLUGIN_ID } from "../../experiments/plugins/contextPackGeneration/metadata.js";
import type { ContextPackGenerationRun } from "../../experiments/plugins/contextPackGeneration/plugin.js";
import { CONTEXT_PACK_SCHEMA_VERSION, type ContextPack } from "../../experiments/plugins/contextPackGeneration/types.js";

function isContextPack(value: unknown, caseId: string): value is ContextPack {
  if (typeof value !== "object" || value === null) return false;
  const pack = value as Partial<Record<keyof ContextPack, unknown>>;
  return (
    pack.schemaVersion === CONTEXT_PACK_SCHEMA_VERSION &&
    pack.caseId === caseId &&
    typeof pack.task === "object" &&
    pack.task !== null &&
    Array.isArray(pack.files) &&
    Array.isArray(pack.symbols) &&
    Array.isArray(pack.sourceSlices) &&
    Array.isArray(pack.callRelationships) &&
    Array.isArray(pack.tests) &&
    Array.isArray(pack.evidenceNotes)
  );
}

/**
 * Reads the persisted per-case pack artifacts the plugin already wrote under the output root. It never reruns retrieval or
 * reopens repository source. A missing or invalid artifact is simply absent: the report then marks that preview unavailable.
 */
export async function loadContextPackArtifacts(run: ExperimentRun, outputRoot: string): Promise<Map<string, ContextPack>> {
  const packs = new Map<string, ContextPack>();
  if (run.pluginId !== CONTEXT_PACK_GENERATION_PLUGIN_ID) return packs;
  const evidence = (run as Partial<ContextPackGenerationRun>).caseExecutionEvidence ?? [];
  for (const entry of evidence) {
    const relativePath = entry.treatments.find((treatment) => treatment.treatmentId === "context-pack")?.packArtifactPath;
    if (!relativePath) continue;
    try {
      const parsed: unknown = JSON.parse(await readFile(resolveWithinRoot(outputRoot, relativePath), "utf8"));
      if (isContextPack(parsed, entry.caseId)) packs.set(entry.caseId, parsed);
    } catch {
      // Unreadable or unsafe artifact: the preview is reported as pack-artifact-unavailable, never as an empty pack.
    }
  }
  return packs;
}
