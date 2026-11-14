import { createHash } from "node:crypto";
import { lstat, realpath, open, stat } from "node:fs/promises";
import path from "node:path";
import { canonicalCampaignJson } from "../../experiments/plugins/agentSuccessRate/campaignIdentity.js";
import { readRepositoryIdentity } from "../localRepositorySubject/gitRepository.js";
import { assertEvidence, closed, digest, LabEvidenceError, literal, strings, text, validateEco00Environment, validateEco00Subject } from "./eco00ContractValidation.js";
import type { Eco00Subject, LabSelectedInputsV1, LabSubjectBindingV1 } from "./types.js";

export const EVIDENCE_LIMITS = Object.freeze({ files: 2000, inputBytes: 1048576, totalInputBytes: 16777216, path: 512, string: 1024, depth: 24, nodes: 200000, artifactBytes: 8388608, totalArtifactBytes: 16777216, requirements: 200, checks: 64, displayed: 100, reason: 240 });
export function sha256(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export function canonicalEvidenceJson(value: unknown): string {
  // Keep the existing finite/plain-object/key-order implementation authoritative.
  let nodes = 0;
  const visit = (v: unknown, depth: number): void => {
    assertEvidence(++nodes <= EVIDENCE_LIMITS.nodes && depth <= EVIDENCE_LIMITS.depth, "UNVERIFIABLE", "Identity exceeds maximum canonicalization depth 24 or 200000 object nodes");
    if (typeof v === "string") assertEvidence(v.length <= EVIDENCE_LIMITS.string, "UNVERIFIABLE", "Identity string exceeds 1024 characters");
    if (typeof v === "number") assertEvidence(Number.isFinite(v), "UNVERIFIABLE", "Non-finite numeric identity value");
    if (v && typeof v === "object") { assertEvidence(Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype, "INVALID_PROTOTYPE"); assertEvidence(Object.getOwnPropertySymbols(v).length === 0 && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => Object.hasOwn(d, "value")), "UNSUPPORTED_OBJECT_SHAPE"); if (Array.isArray(v)) assertEvidence(Object.keys(v).length === v.length && Object.keys(v).every((k, i) => k === String(i)), "UNSUPPORTED_ARRAY_SHAPE"); else assertEvidence(Object.keys(v).length === Object.getOwnPropertyNames(v).length, "UNSUPPORTED_OBJECT_SHAPE"); Object.keys(v).forEach(k => { assertEvidence(k.length <= 1024); visit((v as Record<string, unknown>)[k], depth + 1); }); }
  };
  visit(value, 0); return canonicalCampaignJson(value);
}
export function evidenceDigest(value: unknown): string { return sha256(canonicalEvidenceJson(value)); }
export function normalizeEvidencePath(value: unknown): string {
  assertEvidence(typeof value !== "string" || value.length <= 512, "UNVERIFIABLE", "Maximum normalized path length 512 exceeded"); text(value, 512); const normalized = value.replace(/\\/g, "/").normalize("NFC");
  assertEvidence(!/^\/|[:\x00-\x1f\x7f]/.test(normalized) && !path.win32.isAbsolute(value) && !path.posix.isAbsolute(value), "OUTSIDE_AUTHORIZED_ROOT");
  assertEvidence(normalized.split("/").every(segment => segment !== "" && segment !== "." && segment !== ".." && !/[. ]$/.test(segment) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)), "OUTSIDE_AUTHORIZED_ROOT");
  return normalized;
}
export function insideEvidenceRoot(root: string, target: string): boolean { const r = path.relative(root, target); return r === "" || (!r.startsWith(`..${path.sep}`) && r !== ".." && !path.isAbsolute(r)); }
export async function evidenceRootIdentity(root: string): Promise<string> { const physical = await realpath(root); const s = await stat(physical, { bigint: true }); assertEvidence(s.isDirectory(), "ROOT_IDENTITY_MISMATCH"); return evidenceDigest({ path: process.platform === "win32" ? physical.toLowerCase() : physical, device: s.dev.toString(), inode: s.ino.toString() }); }
/** Bounded handle read corroborated against both path and opened file identity. */
export async function readEvidenceBytes(root: string, relative: string, maxBytes: number, expectedRootIdentity?: string): Promise<Buffer> {
  const normalized = normalizeEvidencePath(relative); const realRoot = await realpath(root);
  const rootBefore = await stat(realRoot, { bigint: true }); assertEvidence(rootBefore.isDirectory(), "ROOT_IDENTITY_MISMATCH");
  if (expectedRootIdentity !== undefined) assertEvidence(await evidenceRootIdentity(root) === expectedRootIdentity, "ROOT_IDENTITY_MISMATCH");
  const requested = path.resolve(realRoot, ...normalized.split("/")); const physical = await realpath(requested);
  assertEvidence(insideEvidenceRoot(realRoot, physical), "OUTSIDE_AUTHORIZED_ROOT");
  const before = await stat(physical, { bigint: true }); assertEvidence(before.isFile(), "INVALID_NATIVE_SHAPE", "Native payload must be a regular file"); assertEvidence(before.size <= BigInt(maxBytes), "OVERSIZED", `Input exceeds ${maxBytes}-byte limit: ${normalized}`);
  const handle = await open(physical, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    assertEvidence(opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size && opened.mtimeNs === before.mtimeNs && opened.ctimeNs === before.ctimeNs, "CHANGED_DURING_READ");
    const buffer = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < buffer.length) { const read = await handle.read(buffer, offset, buffer.length - offset, offset); if (read.bytesRead === 0) break; offset += read.bytesRead; }
    const after = await handle.stat({ bigint: true }); const pathAfter = await stat(requested, { bigint: true });
    const rootAfter = await stat(root, { bigint: true }); assertEvidence(rootAfter.dev === rootBefore.dev && rootAfter.ino === rootBefore.ino && await realpath(root) === realRoot, "CHANGED_DURING_READ", "Authorized evidence root changed during read");
    assertEvidence(offset === buffer.length && after.size === before.size && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs && pathAfter.dev === before.dev && pathAfter.ino === before.ino && pathAfter.size === before.size && pathAfter.mtimeNs === before.mtimeNs && pathAfter.ctimeNs === before.ctimeNs && await realpath(requested) === physical, "CHANGED_DURING_READ");
    return buffer;
  } finally { await handle.close(); }
}
export function validateSelectedInputs(value: unknown): asserts value is LabSelectedInputsV1 {
  const v = closed(value, ["paths", "exclusions", "policyId", "relevantIgnoredPaths"]); text(v.policyId); assertEvidence(!Array.isArray(v.paths) || v.paths.length <= 2000, "UNVERIFIABLE", "Maximum selected identity files 2000 exceeded"); strings(v.paths, 1, 2000); strings(v.exclusions); strings(v.relevantIgnoredPaths);
  const normalized = v.paths.map(normalizeEvidencePath); assertEvidence(new Set(normalized.map(p => process.platform === "win32" ? p.toLowerCase() : p)).size === normalized.length, "DUPLICATE_NORMALIZED_PATH");
  v.exclusions.forEach(normalizeEvidencePath); v.relevantIgnoredPaths.forEach(p => assertEvidence(normalized.includes(normalizeEvidencePath(p)), "INCOMPLETE_IDENTITY", "Explicit relevant ignored input is not independently selected"));
}
export async function qualifySubject(root: string, subject: Eco00Subject, selection: LabSelectedInputsV1): Promise<{ binding: LabSubjectBindingV1; reasons: string[] }> {
  validateEco00Subject(subject); validateSelectedInputs(selection); const reasons: string[] = []; const entries: Array<{ path: string; size: number; sha256: string }> = [];
  const selected = new Set(selection.paths.map(normalizeEvidencePath));
  for (const filename of ["package.json", "npm-shrinkwrap.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]) {
    try { await lstat(path.join(root, filename)); if (!selected.has(filename)) reasons.push(`Required package input is not selected: ${filename}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") reasons.push(`Required input cannot be inspected: ${filename}`); }
  }
  let total = 0;
  const rootIdentity = await evidenceRootIdentity(root);
  for (const relative of [...selected].sort()) { try { const remaining = 16777216 - total; const bytes = await readEvidenceBytes(root, relative, Math.min(1048576, remaining), rootIdentity); total += bytes.length; entries.push({ path: relative, size: bytes.length, sha256: sha256(bytes) }); } catch (error) { const code = error instanceof LabEvidenceError ? error.code === "OVERSIZED" && total > 15728640 ? "AGGREGATE_IDENTITY_BOUND" : error.code : "UNREADABLE"; reasons.push(`${relative}: ${code}`.slice(0, 240)); if (total >= 16777216) break; } }
  let commit: string | null = null; let dirty = "unknown";
  try { const repository = await readRepositoryIdentity(root); commit = repository.identity.commit; dirty = repository.identity.workingTreeDirty ? "dirty" : "clean"; } catch { /* Non-Git disposable fixtures still have a complete scoped content identity. */ }
  const environment = { canonicalECO00EnvironmentOrNull: { schemaVersion: "1.0.0" as const, environmentId: evidenceDigest({ node: process.version, platform: process.platform, arch: process.arch }), dimensions: { node: process.version, platform: process.platform, architecture: process.arch } }, nodeVersion: process.version, platform: process.platform, architecture: process.arch, environmentSelectionDigest: evidenceDigest({ node: process.version, platform: process.platform, architecture: process.arch }) };
  const binding: LabSubjectBindingV1 = { subject, source: { repositoryRootIdentity: await evidenceRootIdentity(root), commitShaOrNull: commit, sourceManifestSha256OrNull: reasons.length ? null : evidenceDigest(entries), dirtyTrackedState: dirty, selectedUntrackedState: evidenceDigest(entries), selectionDigest: evidenceDigest({ ...selection, paths: [...selected].sort(), exclusions: selection.exclusions.map(normalizeEvidencePath).sort(), relevantIgnoredPaths: selection.relevantIgnoredPaths.map(normalizeEvidencePath).sort() }), completeness: reasons.length ? "unverifiable" : "complete" }, environment, runtime: { buildIdentityOrNull: null, sourceToRuntimeBinding: "not-applicable", corroboration: [] }, provenance: "independently-corroborated" };
  return { binding, reasons };
}
export function validateSubjectBinding(value: unknown): asserts value is LabSubjectBindingV1 {
  canonicalEvidenceJson(value); const v = closed(value, ["subject", "source", "environment", "runtime", "provenance"]); validateEco00Subject(v.subject);
  const s = closed(v.source, ["repositoryRootIdentity", "commitShaOrNull", "sourceManifestSha256OrNull", "dirtyTrackedState", "selectedUntrackedState", "selectionDigest", "completeness"]); digest(s.repositoryRootIdentity); if (s.commitShaOrNull !== null) assertEvidence(typeof s.commitShaOrNull === "string" && /^[a-f0-9]{40}$/.test(s.commitShaOrNull)); if (s.sourceManifestSha256OrNull !== null) digest(s.sourceManifestSha256OrNull); text(s.dirtyTrackedState); text(s.selectedUntrackedState); digest(s.selectionDigest); literal(s.completeness, ["complete", "incomplete", "unverifiable"]);
  const e = closed(v.environment, ["canonicalECO00EnvironmentOrNull", "nodeVersion", "platform", "architecture", "environmentSelectionDigest"]); if (e.canonicalECO00EnvironmentOrNull !== null) validateEco00Environment(e.canonicalECO00EnvironmentOrNull); [e.nodeVersion, e.platform, e.architecture].forEach(x => text(x)); digest(e.environmentSelectionDigest);
  const r = closed(v.runtime, ["buildIdentityOrNull", "sourceToRuntimeBinding", "corroboration"]); if (r.buildIdentityOrNull !== null) digest(r.buildIdentityOrNull); literal(r.sourceToRuntimeBinding, ["verified", "unverified", "not-applicable"]); strings(r.corroboration); literal(v.provenance, ["declared", "independently-corroborated", "unverified"]);
}
