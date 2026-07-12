import fs from "node:fs";
import path from "node:path";
import type { SecurityFinding } from "../../../../securityValidation/types.js";
import type { AndroidDetectionResult } from "../../detection.js";
import type { AndroidManifestComponent } from "../../manifest/types.js";
import type { AndroidManifestParseEntry } from "../../manifest/parseAndroidManifest.js";
import { parseXmlDocument } from "../../manifest/xml/parseXml.js";
import { makeAndroidFinding } from "../../audit/androidFinding.js";
import type { AndroidCheckResult } from "../../validation/checkResult.js";
import { makeCandidateEvidence, type CandidateEvidence, type CandidateResolutionState } from "../candidateEvidence.js";
import { sortCandidateEvidence } from "../ordering.js";
import { resolveAndroidXmlResourceReference } from "../resourceResolution.js";
import { buildAndroidSourceLocation } from "../sourceLocation.js";
import { discoverSecretSourceFiles } from "../secretCandidates/discoverSecretSourceFiles.js";

export const ANDROID_FILE_PROVIDER_AUDIT_CHECK_ID = "android-file-provider-audit";
const FILE_PROVIDER_METADATA = "android.support.FILE_PROVIDER_PATHS";
const PATH_TAGS = new Set(["root-path", "files-path", "cache-path", "external-path", "external-files-path", "external-cache-path", "external-media-path"]);
const EXTERNAL_TAGS = new Set(["external-path", "external-files-path", "external-cache-path", "external-media-path"]);
const MAX_PATH_ENTRIES = 256;
const MAX_EVIDENCE_VALUE = 240;

function sourceLocation(root: string, relativePath: string, line?: number) {
  return buildAndroidSourceLocation(root, path.join(root, relativePath), { line });
}
function standardProvider(name: string): boolean {
  return name === "androidx.core.content.FileProvider" || name === "android.support.v4.content.FileProvider";
}
function directCustomProviders(root: string, detection: AndroidDetectionResult): Map<string, Set<string>> {
  const byModule = new Map<string, Set<string>>();
  const discovery = discoverSecretSourceFiles(root, detection.modules.map((module) => module.path));
  for (const file of discovery.files.filter((candidate) => /\.(java|kt)$/.test(candidate.relativePath))) {
    const moduleKey = file.modulePath ?? "";
    const names = byModule.get(moduleKey) ?? new Set<string>();
    const executable = file.content.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " ");
    for (const match of executable.matchAll(/\bclass\s+([A-Za-z_]\w*)\s*(?:extends\s+|:\s*)(?:androidx\.core\.content\.|android\.support\.v4\.content\.)?FileProvider\s*(?:\(\s*\))?/g)) names.add(match[1]);
    byModule.set(moduleKey, names);
  }
  return byModule;
}
function finding(ruleId: string, title: string, artifactPath: string, line: number | undefined, identity: string, severity: "major" | "minor"): SecurityFinding {
  return makeAndroidFinding({ ruleId, title, severity, confidence: "high", description: `${title}. This is static manifest/XML evidence and does not prove runtime reachability, URI access, or file exposure.`, manifestPath: artifactPath, identity, location: line === undefined ? undefined : { line }, recommendation: "Keep FileProvider non-exported and restrict configured roots to the narrowest required paths." });
}
function candidate(ruleId: Parameters<typeof makeCandidateEvidence>[0]["ruleId"], root: string, artifactPath: string, modulePath: string | undefined, line: number | undefined, summary: string, raw: string | undefined, state: CandidateResolutionState = "resolved", confidence: "low" | "medium" | "high" = "medium"): CandidateEvidence {
  return makeCandidateEvidence({ ruleId, category: "android-file-provider", confidence, modulePath, location: sourceLocation(root, artifactPath, line), summary, rawValue: (raw ?? "(missing)").slice(0, MAX_EVIDENCE_VALUE), resolutionState: state, staticAnalysisLimitations: ["Manifest sources are not merged; resource overlays, installed authorities, URI grants, permission protection levels, and runtime filesystem behavior are not evaluated."] });
}
function protectedProvider(provider: AndroidManifestComponent): boolean {
  return Boolean(provider.permission || provider.readPermission || provider.writePermission);
}
function broadPath(tag: string, rawPath: string | undefined): boolean {
  const value = (rawPath ?? "").trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return tag === "root-path" || value === "" || value === "." || value === "/" || /(^|\/)\.\.(\/|$)/.test(value) || /^[A-Za-z]:\//.test(value) || value.startsWith("/") || (EXTERNAL_TAGS.has(tag) && value.split("/").filter(Boolean).length <= 1);
}
function analyzeAuthorities(root: string, entry: AndroidManifestParseEntry, provider: AndroidManifestComponent, seen: Map<string, string>, out: CandidateEvidence[]): void {
  const raw = provider.authoritiesRaw;
  if (raw === undefined || raw.trim() === "") {
    out.push(candidate("android-file-provider-exported", root, entry.manifestPath, entry.modulePath, provider.location?.line, "FileProvider authority is missing or empty", raw, raw === undefined ? "missing" : "malformed"));
    return;
  }
  const local = new Set<string>();
  for (const authority of raw.split(";")) {
    const normalized = authority.trim();
    if (!normalized) { out.push(candidate("android-file-provider-exported", root, entry.manifestPath, entry.modulePath, provider.location?.line, "FileProvider authority contains an empty entry", authority, "malformed")); continue; }
    if (/\$\{[^}]+\}/.test(normalized)) { out.push(candidate("android-file-provider-exported", root, entry.manifestPath, entry.modulePath, provider.location?.line, "FileProvider authority contains an unresolved placeholder", normalized, "unresolved")); continue; }
    if (!/^[A-Za-z0-9_.-]+$/.test(normalized)) { out.push(candidate("android-file-provider-exported", root, entry.manifestPath, entry.modulePath, provider.location?.line, "FileProvider authority is malformed", normalized, "malformed")); continue; }
    const key = normalized.toLowerCase();
    if (local.has(key) || seen.has(key)) out.push(candidate("android-file-provider-exported", root, entry.manifestPath, entry.modulePath, provider.location?.line, `Duplicate FileProvider authority${seen.has(key) ? " across providers/modules" : " within provider"}`, normalized, "unresolved"));
    local.add(key); seen.set(key, `${entry.modulePath ?? ""}:${entry.manifestPath}:${provider.name}`);
  }
}

export function auditAndroidFileProviders(targetRoot: string, detection: AndroidDetectionResult, manifests: AndroidManifestParseEntry[]): AndroidCheckResult {
  if (detection.projectKind === "non-android") return { id: ANDROID_FILE_PROVIDER_AUDIT_CHECK_ID, category: "android-file-provider", title: "Android FileProvider audit", status: "unsupported", requirementLevel: "optional", ran: false, skipped: true, skipInfo: { checkId: ANDROID_FILE_PROVIDER_AUDIT_CHECK_ID, reason: "Target was not detected as Android.", requirementLevel: "optional", verdictImpact: "does not apply", recommendedNextAction: "Run against an Android project." }, evidence: [], findings: [], warnings: [], errors: [], sourcePaths: [], confidence: "unknown", environmentRequirements: [], candidateEvidence: [] };

  const findings: SecurityFinding[] = []; const candidates: CandidateEvidence[] = []; const sources = new Set<string>(); const seenAuthorities = new Map<string, string>(); const custom = directCustomProviders(targetRoot, detection);
  for (const entry of manifests) for (const provider of entry.manifest.providers) {
    const simpleName = provider.name.split(".").at(-1) ?? provider.name;
    const confirmed = standardProvider(provider.name) || (custom.get(entry.modulePath ?? "")?.has(simpleName) ?? false);
    if (!confirmed) { if (/FileProvider$/i.test(provider.name)) candidates.push(candidate("android-file-provider-exported", targetRoot, entry.manifestPath, entry.modulePath, provider.location?.line, "FileProvider-like class is not a directly proven FileProvider subclass", provider.name, "unresolved", "low")); continue; }
    sources.add(entry.manifestPath); const library = entry.modulePath !== undefined && detection.libraryModules.includes(entry.modulePath);
    analyzeAuthorities(targetRoot, entry, provider, seenAuthorities, candidates);
    if (provider.exported === true) {
      if (library) candidates.push(candidate("android-file-provider-exported", targetRoot, entry.manifestPath, entry.modulePath, provider.location?.line, "Library manifest explicitly exports a FileProvider; application merged behavior requires review", provider.name, "resolved"));
      else findings.push(finding("android-file-provider-exported", "Confirmed FileProvider is explicitly exported", entry.manifestPath, provider.location?.line, provider.name, "major"));
      // The generic exported-component audit already owns the exact unprotected-provider finding.
      if (!protectedProvider(provider)) candidates.push(candidate("android-file-provider-missing-protection", targetRoot, entry.manifestPath, entry.modulePath, provider.location?.line, "Exported FileProvider has no provider/read/write permission (generic exported audit owns the equivalent finding)", provider.name, "resolved", "high"));
    } else if (provider.exported === undefined) candidates.push(candidate("android-file-provider-exported", targetRoot, entry.manifestPath, entry.modulePath, provider.location?.line, "FileProvider exported state is missing or unresolved", provider.exportedRaw, provider.exportedRaw === undefined ? "missing" : "unresolved"));
    if (provider.grantUriPermissions === undefined) candidates.push(candidate("android-file-provider-exported", targetRoot, entry.manifestPath, entry.modulePath, provider.location?.line, "FileProvider grantUriPermissions is missing or unresolved", provider.grantUriPermissionsRaw, provider.grantUriPermissionsRaw === undefined ? "missing" : "unresolved", "low"));
    for (const value of [provider.permission, provider.readPermission, provider.writePermission].filter((item): item is string => item !== undefined)) if (value.trim() === "" || /\$\{[^}]+\}/.test(value)) candidates.push(candidate("android-file-provider-missing-protection", targetRoot, entry.manifestPath, entry.modulePath, provider.location?.line, "Provider permission value is empty or unresolved", value, value.trim() === "" ? "malformed" : "unresolved"));

    const metadata = (provider.metadata ?? []).filter((item) => item.name === FILE_PROVIDER_METADATA);
    if (metadata.length === 0) { candidates.push(candidate("android-file-provider-missing-paths-xml", targetRoot, entry.manifestPath, entry.modulePath, provider.location?.line, "FileProvider has no FILE_PROVIDER_PATHS metadata", undefined, "missing")); continue; }
    const references = [...new Set(metadata.map((item) => item.resource ?? item.value ?? ""))];
    if (references.length > 1) { candidates.push(candidate("android-file-provider-unresolved-reference", targetRoot, entry.manifestPath, entry.modulePath, metadata[0].location?.line, "Conflicting FILE_PROVIDER_PATHS metadata entries were not selected arbitrarily", references.join(";"), "unresolved")); continue; }
    const reference = references[0];
    if (!reference || metadata.some((item) => !item.resource)) { candidates.push(candidate("android-file-provider-missing-paths-xml", targetRoot, entry.manifestPath, entry.modulePath, metadata[0].location?.line, "FILE_PROVIDER_PATHS metadata has no concrete android:resource", reference, reference ? "unsupported" : "missing")); continue; }
    const resolution = resolveAndroidXmlResourceReference(targetRoot, path.join(targetRoot, entry.modulePath ?? "."), reference);
    if (resolution.state !== "resolved") { const state: CandidateResolutionState = resolution.state === "missing" ? "missing" : resolution.state === "malformed-reference" ? (/\$\{/.test(reference) ? "unresolved" : "malformed") : resolution.state === "unsupported-reference" ? "unsupported" : "unresolved"; candidates.push(candidate(resolution.state === "missing" ? "android-file-provider-missing-paths-xml" : "android-file-provider-unresolved-reference", targetRoot, entry.manifestPath, entry.modulePath, metadata[0].location?.line, `FILE_PROVIDER_PATHS resource is ${resolution.state}${resolution.state === "ambiguous" ? ` (${resolution.candidates.length} candidates)` : ""}`, reference, state)); continue; }

    const resource = resolution.candidates[0]; sources.add(resource.relativePath); let xml: string;
    try { xml = fs.readFileSync(path.join(targetRoot, resource.relativePath), "utf8"); } catch { candidates.push(candidate("android-file-provider-missing-paths-xml", targetRoot, resource.relativePath, entry.modulePath, undefined, "Resolved paths XML could not be read", resource.relativePath, "missing")); continue; }
    const parsed = parseXmlDocument(xml);
    if (!parsed.ok) { candidates.push(candidate("android-file-provider-malformed-paths-xml", targetRoot, resource.relativePath, entry.modulePath, parsed.error.location.line, "FileProvider paths XML is malformed", parsed.error.message, "malformed")); continue; }
    if (parsed.root.localName !== "paths") { candidates.push(candidate("android-file-provider-malformed-paths-xml", targetRoot, resource.relativePath, entry.modulePath, parsed.root.location.line, `Unsupported FileProvider paths root <${parsed.root.tagName}>`, parsed.root.tagName, "unsupported")); continue; }
    if (parsed.root.children.length > MAX_PATH_ENTRIES) candidates.push(candidate("android-file-provider-malformed-paths-xml", targetRoot, resource.relativePath, entry.modulePath, parsed.root.location.line, `FileProvider paths XML exceeds the ${MAX_PATH_ENTRIES}-entry analysis bound`, String(parsed.root.children.length), "unsupported"));
    const identities = new Map<string, string>(); const exact = new Set<string>();
    for (const child of parsed.root.children.slice(0, MAX_PATH_ENTRIES)) {
      const name = child.attributes.find((attribute) => attribute.localName === "name")?.value;
      const rawPath = child.attributes.find((attribute) => attribute.localName === "path")?.value;
      if (!PATH_TAGS.has(child.localName)) { candidates.push(candidate("android-file-provider-broad-paths", targetRoot, resource.relativePath, entry.modulePath, child.location.line, "Unsupported FileProvider path element", child.tagName, "unsupported")); continue; }
      if (name === undefined || name.trim() === "") candidates.push(candidate("android-file-provider-broad-paths", targetRoot, resource.relativePath, entry.modulePath, child.location.line, "FileProvider path entry has a missing or empty name", name, "malformed"));
      if (rawPath === undefined) candidates.push(candidate("android-file-provider-broad-paths", targetRoot, resource.relativePath, entry.modulePath, child.location.line, "FileProvider path entry is missing path", undefined, "malformed"));
      const normalized = (rawPath ?? "").trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").slice(0, MAX_EVIDENCE_VALUE);
      const exactKey = `${child.localName}:${name ?? ""}:${normalized}`; const prior = identities.get(name ?? "");
      if (exact.has(exactKey)) candidates.push(candidate("android-file-provider-broad-paths", targetRoot, resource.relativePath, entry.modulePath, child.location.line, "Duplicate FileProvider path entry", exactKey, "unresolved"));
      else if (name !== undefined && prior !== undefined && prior !== `${child.localName}:${normalized}`) candidates.push(candidate("android-file-provider-broad-paths", targetRoot, resource.relativePath, entry.modulePath, child.location.line, "Conflicting FileProvider path entries share the same name", `${name}:${prior}:${child.localName}:${normalized}`, "unresolved"));
      exact.add(exactKey); if (name !== undefined) identities.set(name, `${child.localName}:${normalized}`);
      if (broadPath(child.localName, rawPath)) {
        if (provider.exported === true && !library) findings.push(finding("android-file-provider-broad-paths", `Exported FileProvider has broad <${child.localName}> path`, resource.relativePath, child.location.line, `${entry.modulePath ?? ""}:${provider.name}:${name ?? ""}:${normalized}`, "major"));
        else candidates.push(candidate("android-file-provider-broad-paths", targetRoot, resource.relativePath, entry.modulePath, child.location.line, `Potentially broad <${child.localName}> path`, normalized, "resolved"));
      }
    }
  }
  const uniqueFindings = [...new Map(findings.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const uniqueCandidates = [...new Map(candidates.map((item) => [item.id, item])).values()];
  return { id: ANDROID_FILE_PROVIDER_AUDIT_CHECK_ID, category: "android-file-provider", title: "Android FileProvider audit", status: uniqueFindings.length ? "failed" : "passed", requirementLevel: "required", ran: true, skipped: false, evidence: [`${sources.size} manifest/XML artifact(s) inspected`], findings: uniqueFindings, warnings: ["Static analysis only: manifests are not merged; resource overlays, runtime URI grants, installed authorities, and provider-backed filesystem access are not evaluated."], errors: [], sourcePaths: [...sources].sort((a, b) => a.localeCompare(b)), confidence: "high", environmentRequirements: [], candidateEvidence: sortCandidateEvidence(uniqueCandidates) };
}
