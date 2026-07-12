// ---------------------------------------------------------------------------
// v0.4.1 Batch 1 — Android resource-reference parsing (`@xml/...` and
// similar). This is genuinely new: no resource-reference resolution exists
// anywhere in the codebase yet (the manifest parser stores refs like
// `application.networkSecurityConfigRef` verbatim, by design — see
// src/mobile/android/manifest/types.ts's comment). This module only parses
// the reference string into a structured shape; resourceResolution.ts
// resolves it against the filesystem.
// ---------------------------------------------------------------------------

export const SUPPORTED_ANDROID_RESOURCE_TYPES = ["xml"] as const;
export type SupportedAndroidResourceType = (typeof SUPPORTED_ANDROID_RESOURCE_TYPES)[number];

export type ParsedAndroidResourceReference =
  | { state: "parsed"; raw: string; type: SupportedAndroidResourceType; name: string; packageQualifier?: undefined }
  | { state: "unsupported-type"; raw: string; type: string; name?: string }
  | { state: "package-qualified"; raw: string; packageQualifier: string; type: string; name: string }
  | { state: "placeholder"; raw: string }
  | { state: "empty"; raw: string }
  | { state: "malformed"; raw: string; reason: string };

const RESOURCE_NAME_PATTERN = /^[a-z0-9_]+$/;

// Parses a raw manifest/resource attribute value such as `@xml/network_security_config`.
// Never throws — every input maps to a structured state.
export function parseAndroidResourceReference(raw: string): ParsedAndroidResourceReference {
  if (raw.length === 0) {
    return { state: "empty", raw };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { state: "malformed", raw, reason: "Reference is whitespace-only" };
  }

  // A `@string/app_name`-style placeholder that itself resolves to another
  // resource is out of scope for this parser (only concrete @xml/... value
  // references are supported); an unresolved build-variable placeholder such
  // as `${networkSecurityConfig}` is reported distinctly.
  if (/^\$\{.*\}$/.test(trimmed)) {
    return { state: "placeholder", raw };
  }

  if (!trimmed.startsWith("@")) {
    return { state: "malformed", raw, reason: "Reference does not start with \"@\"" };
  }

  const body = trimmed.slice(1);
  if (body.length === 0) {
    return { state: "malformed", raw, reason: "Reference has no content after \"@\"" };
  }

  // Package-qualified external reference: @com.example.lib:xml/name
  const colonIndex = body.indexOf(":");
  let packageQualifier: string | undefined;
  let rest = body;
  if (colonIndex !== -1) {
    packageQualifier = body.slice(0, colonIndex);
    rest = body.slice(colonIndex + 1);
    if (packageQualifier.length === 0) {
      return { state: "malformed", raw, reason: "Empty package qualifier before \":\"" };
    }
  }

  const slashIndex = rest.indexOf("/");
  if (slashIndex === -1) {
    return { state: "malformed", raw, reason: "Reference is missing a \"/\" between resource type and name" };
  }

  const type = rest.slice(0, slashIndex);
  const name = rest.slice(slashIndex + 1);

  if (type.length === 0) {
    return { state: "malformed", raw, reason: "Reference is missing a resource type" };
  }
  if (name.length === 0) {
    return { state: "malformed", raw, reason: "Reference is missing a resource name" };
  }
  if (!RESOURCE_NAME_PATTERN.test(name)) {
    return { state: "malformed", raw, reason: `Resource name "${name}" is not a valid Android resource identifier` };
  }

  if (packageQualifier !== undefined) {
    return { state: "package-qualified", raw, packageQualifier, type, name };
  }

  if (!(SUPPORTED_ANDROID_RESOURCE_TYPES as readonly string[]).includes(type)) {
    return { state: "unsupported-type", raw, type, name };
  }

  return { state: "parsed", raw, type: type as SupportedAndroidResourceType, name };
}
