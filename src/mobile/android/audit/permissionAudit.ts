import type { SecurityFinding } from "../../../securityValidation/types.js";
import type { AndroidDetectionResult } from "../detection.js";
import type { AndroidManifestParseEntry } from "../manifest/parseAndroidManifest.js";
import type { AndroidCheckResult } from "../validation/checkResult.js";
import { makeAndroidFinding } from "./androidFinding.js";
import { buildAndroidManifestCheckResult } from "./checkResultBuilder.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 3 — initial Android permission audit.
//
// Conservative by design (agents.txt Batch 3 section 7.13): a declared
// permission is not automatically a vulnerability. Ordinary connectivity
// permissions (INTERNET etc.) never produce a finding. Recognized sensitive
// permission groups produce a "minor" (review-required) finding. Unknown/
// custom permissions produce an "informational" review finding. The only
// escalation is foreground + background location declared together, which
// still stays at "minor" (a legitimate, common pattern — not proof of
// misuse).
// ---------------------------------------------------------------------------

const LOW_RISK_PERMISSIONS = new Set([
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.ACCESS_WIFI_STATE",
  "android.permission.VIBRATE",
  "android.permission.WAKE_LOCK",
  "android.permission.RECEIVE_BOOT_COMPLETED",
]);

const SENSITIVE_PERMISSION_GROUPS: Record<string, string> = {
  "android.permission.ACCESS_FINE_LOCATION": "location",
  "android.permission.ACCESS_COARSE_LOCATION": "location",
  "android.permission.ACCESS_BACKGROUND_LOCATION": "background-location",
  "android.permission.CAMERA": "camera",
  "android.permission.RECORD_AUDIO": "microphone",
  "android.permission.READ_CONTACTS": "contacts",
  "android.permission.WRITE_CONTACTS": "contacts",
  "android.permission.GET_ACCOUNTS": "contacts",
  "android.permission.READ_CALENDAR": "calendar",
  "android.permission.WRITE_CALENDAR": "calendar",
  "android.permission.SEND_SMS": "sms",
  "android.permission.READ_SMS": "sms",
  "android.permission.RECEIVE_SMS": "sms",
  "android.permission.RECEIVE_MMS": "sms",
  "android.permission.READ_CALL_LOG": "call-log",
  "android.permission.WRITE_CALL_LOG": "call-log",
  "android.permission.PROCESS_OUTGOING_CALLS": "call-log",
  "android.permission.READ_PHONE_STATE": "phone",
  "android.permission.CALL_PHONE": "phone",
  "android.permission.BLUETOOTH_CONNECT": "nearby-devices",
  "android.permission.BLUETOOTH_SCAN": "nearby-devices",
  "android.permission.BLUETOOTH_ADVERTISE": "nearby-devices",
  "android.permission.NEARBY_WIFI_DEVICES": "nearby-devices",
  "android.permission.READ_EXTERNAL_STORAGE": "storage-legacy",
  "android.permission.WRITE_EXTERNAL_STORAGE": "storage-legacy",
  "android.permission.MANAGE_EXTERNAL_STORAGE": "storage-legacy",
  "android.permission.READ_MEDIA_IMAGES": "media",
  "android.permission.READ_MEDIA_VIDEO": "media",
  "android.permission.READ_MEDIA_AUDIO": "media",
  "android.permission.POST_NOTIFICATIONS": "notifications",
  "android.permission.BODY_SENSORS": "body-sensors",
  "android.permission.BODY_SENSORS_BACKGROUND": "body-sensors",
  "android.permission.ACTIVITY_RECOGNITION": "activity-recognition",
  "android.permission.FOREGROUND_SERVICE": "foreground-service",
  "android.permission.REQUEST_INSTALL_PACKAGES": "package-install",
  "android.permission.QUERY_ALL_PACKAGES": "package-visibility",
};

export function auditAndroidPermissions(detection: AndroidDetectionResult, manifests: AndroidManifestParseEntry[]): AndroidCheckResult {
  const findings: SecurityFinding[] = [];
  const evidence: string[] = [];
  const warnings: string[] = [];

  for (const entry of manifests) {
    const declaredNames = new Set(entry.manifest.permissions.map((p) => p.name));
    const seen = new Set<string>();

    for (const permission of entry.manifest.permissions) {
      if (seen.has(permission.name)) continue;
      seen.add(permission.name);

      if (LOW_RISK_PERMISSIONS.has(permission.name)) {
        continue;
      }

      const group = SENSITIVE_PERMISSION_GROUPS[permission.name];
      const duplicateCount = entry.manifest.permissions.filter((p) => p.name === permission.name).length;
      const duplicateNote = duplicateCount > 1 ? [`declared ${duplicateCount} times (deduplicated for this finding)`] : [];

      if (group === "background-location") {
        const hasForeground = declaredNames.has("android.permission.ACCESS_FINE_LOCATION") || declaredNames.has("android.permission.ACCESS_COARSE_LOCATION");
        findings.push(
          makeAndroidFinding({
            ruleId: hasForeground ? "android-permission-background-and-foreground-location" : "android-permission-sensitive",
            title: hasForeground
              ? "Background location declared alongside foreground location"
              : `Sensitive permission declared: ${permission.name}`,
            severity: "minor",
            confidence: "high",
            description: hasForeground
              ? "The manifest declares ACCESS_BACKGROUND_LOCATION together with a foreground location permission. This is a common, legitimate pattern, but background location access typically requires explicit justification for store review."
              : `The manifest declares the sensitive permission ${permission.name} (group: ${group}). This is not automatically a vulnerability; review that the app's functionality justifies the request.`,
            manifestPath: entry.manifestPath,
            identity: permission.name,
            location: permission.location,
            evidenceDetails: [`sourceElement=${permission.sourceElement ?? "uses-permission"}`, `group=${group}`, ...duplicateNote],
            recommendation: "Confirm the permission is required for a real user-facing feature and document the justification.",
          })
        );
        continue;
      }

      if (group) {
        findings.push(
          makeAndroidFinding({
            ruleId: "android-permission-sensitive",
            title: `Sensitive permission declared: ${permission.name}`,
            severity: "minor",
            confidence: "high",
            description: `The manifest declares the sensitive permission ${permission.name} (group: ${group}). This is not automatically a vulnerability; review that the app's functionality justifies the request.`,
            manifestPath: entry.manifestPath,
            identity: permission.name,
            location: permission.location,
            evidenceDetails: [`sourceElement=${permission.sourceElement ?? "uses-permission"}`, `group=${group}`, ...duplicateNote],
            recommendation: "Confirm the permission is required for a real user-facing feature and document the justification.",
          })
        );
        continue;
      }

      if (!permission.name.startsWith("android.permission.")) {
        findings.push(
          makeAndroidFinding({
            ruleId: "android-permission-unknown-custom",
            title: `Unknown custom permission declared: ${permission.name}`,
            severity: "informational",
            confidence: "high",
            description: `The manifest declares a custom permission "${permission.name}" that is not a recognized platform permission. This is not automatically dangerous; review its purpose and, if it protects app components, whether its protectionLevel is appropriate.`,
            manifestPath: entry.manifestPath,
            identity: permission.name,
            location: permission.location,
            evidenceDetails: [`sourceElement=${permission.sourceElement ?? "uses-permission"}`, ...duplicateNote],
            recommendation: "Review the custom permission's purpose and protection level.",
          })
        );
      }
    }

    if (entry.manifest.permissions.length > 0) {
      evidence.push(`${entry.manifestPath}: ${entry.manifest.permissions.length} permission declaration(s) inspected`);
    }
  }

  return buildAndroidManifestCheckResult({
    id: "android-permissions-audit",
    category: "android-permissions",
    title: "Android permission audit",
    detection,
    manifests,
    findings,
    evidence,
    warnings,
  });
}
