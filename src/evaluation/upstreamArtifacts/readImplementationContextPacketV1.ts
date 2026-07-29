import type { UpstreamArtifactReadResult } from "./artifactReadTypes.js";
import type { ImplementationContextPacketV1 } from "./supplementalContextTypes.js";
import { readTextArtifactFile } from "./readSupplementalContextTextFile.js";
import { validateSupplementalContextDocumentV1 } from "./validateSupplementalContextDocumentV1.js";

const ARTIFACT_KIND = "orchestrator-implementation-context-packet-v1" as const;

export async function readImplementationContextPacketV1(
  sourcePath: string
): Promise<UpstreamArtifactReadResult<ImplementationContextPacketV1>> {
  const loaded = await readTextArtifactFile(ARTIFACT_KIND, sourcePath);
  if (!loaded.ok) return loaded;
  return validateSupplementalContextDocumentV1(
    ARTIFACT_KIND,
    "implementation-context-packet",
    loaded.text,
    loaded.sourcePath
  ) as UpstreamArtifactReadResult<ImplementationContextPacketV1>;
}
