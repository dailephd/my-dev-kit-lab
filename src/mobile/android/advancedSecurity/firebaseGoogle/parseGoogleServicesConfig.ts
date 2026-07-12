import type { FirebaseArtifactFile, GoogleServicesClient, GoogleServicesConfig } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — bounded, safe google-services.json parsing.
//
// A bare Firebase API key is not a private secret by format (see
// sensitiveCategories.ts) — this parser only records bounded presence
// metadata (a count) for oauth_client/api_key entries, never the values
// themselves. Malformed JSON is handled safely (never throws to the
// caller); unsupported/unexpected shapes degrade to an empty client list
// rather than crashing.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseGoogleServicesConfig(file: FirebaseArtifactFile): GoogleServicesConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return { file, malformed: true, clients: [] };
  }

  const root = asRecord(parsed);
  if (!root) return { file, malformed: true, clients: [] };

  const projectInfo = asRecord(root.project_info);
  const clientsRaw = asArray(root.client) ?? [];

  const clients: GoogleServicesClient[] = clientsRaw.map((entry) => {
    const clientRecord = asRecord(entry) ?? {};
    const clientInfo = asRecord(clientRecord.client_info);
    const androidClientInfo = asRecord(clientInfo?.android_client_info);
    const oauthClient = asArray(clientRecord.oauth_client) ?? [];
    const apiKey = asArray(clientRecord.api_key) ?? [];
    return {
      packageName: asString(androidClientInfo?.package_name),
      mobileSdkAppId: asString(clientInfo?.mobilesdk_app_id),
      apiKeyCount: apiKey.length,
      oauthClientCount: oauthClient.length,
    };
  });

  return {
    file,
    malformed: false,
    projectId: asString(projectInfo?.project_id),
    projectNumber: asString(projectInfo?.project_number),
    storageBucket: asString(projectInfo?.storage_bucket),
    firebaseUrl: asString(projectInfo?.firebase_url),
    clients,
  };
}
