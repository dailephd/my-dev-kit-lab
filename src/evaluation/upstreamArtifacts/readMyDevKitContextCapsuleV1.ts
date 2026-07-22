import type { UpstreamArtifactReadResult } from "./artifactReadTypes.js";
import type { ContextCapsule } from "./myDevKitContextArtifactsV1.js";
import { readJsonArtifactFile } from "./readJsonArtifact.js";
import { validateMyDevKitContextCapsuleV1 } from "./validateMyDevKitContextCapsuleV1.js";

const ARTIFACT_KIND = "my-dev-kit-context-capsule-v1" as const;

export async function readMyDevKitContextCapsuleV1(sourcePath: string): Promise<UpstreamArtifactReadResult<ContextCapsule>> {
  const loaded = await readJsonArtifactFile(ARTIFACT_KIND, sourcePath);
  if (!loaded.ok) return loaded;
  return validateMyDevKitContextCapsuleV1(loaded.value, loaded.sourcePath);
}
