import type { UpstreamArtifactReadResult } from "./artifactReadTypes.js";
import type { OrchestratorRunIntegrityEvidenceV1 } from "./orchestratorRunIntegrityV1.js";
import { readJsonArtifactFile } from "./readJsonArtifact.js";
import { validateOrchestratorRunIntegrityEvidenceV1 } from "./validateOrchestratorRunIntegrityV1.js";

const ARTIFACT_KIND = "orchestrator-run-integrity-evidence-v1" as const;

export async function readOrchestratorRunIntegrityEvidenceV1(
  sourcePath: string
): Promise<UpstreamArtifactReadResult<OrchestratorRunIntegrityEvidenceV1>> {
  const loaded = await readJsonArtifactFile(ARTIFACT_KIND, sourcePath);
  if (!loaded.ok) return loaded;
  return validateOrchestratorRunIntegrityEvidenceV1(loaded.value, loaded.sourcePath);
}
