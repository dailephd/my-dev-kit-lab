import type { UpstreamArtifactReadResult } from "./artifactReadTypes.js";
import type { WorkflowInstructionPacket } from "./orchestratorWorkflowInstructionPacketV1.js";
import { readJsonArtifactFile } from "./readJsonArtifact.js";
import { validateOrchestratorWorkflowInstructionPacketV1 } from "./validateOrchestratorWorkflowInstructionPacketV1.js";

const ARTIFACT_KIND = "orchestrator-workflow-instruction-packet-v1" as const;

export async function readOrchestratorWorkflowInstructionPacketV1(
  sourcePath: string
): Promise<UpstreamArtifactReadResult<WorkflowInstructionPacket>> {
  const loaded = await readJsonArtifactFile(ARTIFACT_KIND, sourcePath);
  if (!loaded.ok) return loaded;
  return validateOrchestratorWorkflowInstructionPacketV1(loaded.value, loaded.sourcePath);
}
