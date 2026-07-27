import type { UpstreamArtifactReadResult } from "./artifactReadTypes.js";
import type { TestContextPacketV1 } from "./supplementalContextTypes.js";
import { readTextArtifactFile } from "./readSupplementalContextTextFile.js";
import { validateSupplementalContextDocumentV1 } from "./validateSupplementalContextDocumentV1.js";

const ARTIFACT_KIND = "orchestrator-test-context-packet-v1" as const;

export async function readTestContextPacketV1(
  sourcePath: string
): Promise<UpstreamArtifactReadResult<TestContextPacketV1>> {
  const loaded = await readTextArtifactFile(ARTIFACT_KIND, sourcePath);
  if (!loaded.ok) return loaded;
  return validateSupplementalContextDocumentV1(
    ARTIFACT_KIND,
    "test-context-packet",
    loaded.text,
    loaded.sourcePath
  ) as UpstreamArtifactReadResult<TestContextPacketV1>;
}
