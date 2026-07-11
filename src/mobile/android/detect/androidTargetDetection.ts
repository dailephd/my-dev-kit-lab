import type { LocalProjectTargetMetadata } from "../../../core/localProjectTarget.js";
import { createAndroidProfile } from "../profile.js";
import { createAndroidTargetMetadata, type AndroidTargetMetadata } from "../targetMetadata.js";
import { detectAndroidProject } from "./detectAndroidProject.js";
import type { AndroidDetectionResult } from "../detection.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 2 — narrow helper combining already-resolved
// LocalProjectTargetMetadata with the Android detector and the Batch 1
// profile/target-metadata builders (section 7.16). This does not create a
// new target resolver: it accepts target metadata the caller already
// resolved via src/core/localProjectTarget.ts.
// ---------------------------------------------------------------------------

export type AndroidTargetDetectionResult = {
  detection: AndroidDetectionResult;
  target: AndroidTargetMetadata;
};

export function detectAndroidTarget(local: LocalProjectTargetMetadata): AndroidTargetDetectionResult {
  const detection = detectAndroidProject(local.targetRoot);
  const androidProfile = createAndroidProfile({
    detectionConfidence: detection.confidence,
    evidence: detection.evidence,
    unsupportedNotes: detection.warnings,
    projectType: detection.projectKind,
    projectSubtype: detection.uiToolkit,
    supportedCapabilities: ["static-detection"],
  });

  return {
    detection,
    target: createAndroidTargetMetadata({ local, androidProfile, detection }),
  };
}
