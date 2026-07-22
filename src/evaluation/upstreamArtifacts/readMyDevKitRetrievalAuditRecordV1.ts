import type { UpstreamArtifactReadResult } from "./artifactReadTypes.js";
import type { RetrievalAuditRecord } from "./myDevKitContextArtifactsV1.js";
import { readJsonArtifactFile } from "./readJsonArtifact.js";
import { validateMyDevKitRetrievalAuditRecordV1 } from "./validateMyDevKitRetrievalAuditRecordV1.js";

const ARTIFACT_KIND = "my-dev-kit-retrieval-audit-record-v1" as const;

export async function readMyDevKitRetrievalAuditRecordV1(
  sourcePath: string
): Promise<UpstreamArtifactReadResult<RetrievalAuditRecord>> {
  const loaded = await readJsonArtifactFile(ARTIFACT_KIND, sourcePath);
  if (!loaded.ok) return loaded;
  return validateMyDevKitRetrievalAuditRecordV1(loaded.value, loaded.sourcePath);
}
