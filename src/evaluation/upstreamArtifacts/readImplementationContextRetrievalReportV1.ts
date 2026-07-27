import type { UpstreamArtifactReadResult } from "./artifactReadTypes.js";
import type { ImplementationContextRetrievalReportV1 } from "./supplementalContextTypes.js";
import { readTextArtifactFile } from "./readSupplementalContextTextFile.js";
import { validateSupplementalContextDocumentV1 } from "./validateSupplementalContextDocumentV1.js";

const ARTIFACT_KIND = "orchestrator-implementation-context-retrieval-report-v1" as const;

export async function readImplementationContextRetrievalReportV1(
  sourcePath: string
): Promise<UpstreamArtifactReadResult<ImplementationContextRetrievalReportV1>> {
  const loaded = await readTextArtifactFile(ARTIFACT_KIND, sourcePath);
  if (!loaded.ok) return loaded;
  return validateSupplementalContextDocumentV1(
    ARTIFACT_KIND,
    "implementation-context-retrieval-report",
    loaded.text,
    loaded.sourcePath
  ) as UpstreamArtifactReadResult<ImplementationContextRetrievalReportV1>;
}
