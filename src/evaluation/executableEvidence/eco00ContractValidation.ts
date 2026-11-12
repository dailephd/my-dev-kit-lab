import { createHash } from "node:crypto";
import type { Eco00Bundle, Eco00Envelope, Eco00Environment, Eco00NativeReference, Eco00Requirement, Eco00Subject } from "./types.js";

export const ECO00_PINS = Object.freeze({
  "contract-registry": "768e5376b29ed7ef0cfe9e55be4a5340b88a59b5a05ebcef0e27a9e2c1ffea05",
  "subject-identity": "7492c9ba59e43fa00f8a218195ae2dc1fcb3adc85fdc556af52e64c91315a64e",
  "environment-identity": "5e1fb24564d9b93c2fb320ccede55f07a7b1b11a6321ca1f81401cdfda6834ee",
  "native-artifact-reference": "7e681cdb391f99637a078f853c9620319da68a224abe9844cf829c378bf9ae8d",
  "evidence-envelope": "b70efd30f474ff07ab0b1d4cc368fde0afe59e006944f6d465d4c0c32a0b9962",
  "evidence-requirement": "0744dadc0b3335d3be3e6149681c03beb0a10b441048bdb8d503eeeabd91cbd1",
  "compatibility-bundle": "89238db4207dc35c6b27b465d949a615e0bc2132fc85f532bdfa4247f91ae483"
});
export class LabEvidenceError extends Error { constructor(public readonly code: string, message: string) { super(message.slice(0, 240)); this.name = "LabEvidenceError"; } }
export function validateEco00ContractIdentity(name: keyof typeof ECO00_PINS, originalBytes: Uint8Array): void {
  assertEvidence(createHash("sha256").update(originalBytes).digest("hex") === ECO00_PINS[name], "CONTRACT_IDENTITY_MISMATCH", `Pinned ECO-00 source bytes differ: ${name}`);
}
export function assertEvidence(value: unknown, code = "INVALID_REQUEST", reason = code): asserts value { if (!value) throw new LabEvidenceError(code, reason); }
export function object(value: unknown): Record<string, unknown> { assertEvidence(value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype); return value as Record<string, unknown>; }
export function closed(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const v = object(value); assertEvidence(Reflect.ownKeys(v).length === Object.keys(v).length && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => Object.hasOwn(d, "value") && d.value !== undefined) && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k)), "INVALID_CLOSED_OBJECT"); return v;
}
export function text(value: unknown, max = 1024): asserts value is string { assertEvidence(typeof value === "string" && value.length > 0 && value.length <= max, "INVALID_STRING"); }
export function literal(value: unknown, values: readonly unknown[]): void { assertEvidence(values.includes(value), "INVALID_LITERAL"); }
export function digest(value: unknown): asserts value is string { assertEvidence(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "INVALID_DIGEST"); }
export function strings(value: unknown, min = 0, max = 2000, unique = true): asserts value is string[] {
  assertEvidence(Array.isArray(value) && value.length >= min && value.length <= max, "INVALID_ARRAY"); value.forEach(v => text(v)); if (unique) assertEvidence(new Set(value).size === value.length, "DUPLICATE_VALUE");
}
// ECO-00 strings have no consumer-size limit in the original schemas. Bounds are
// imposed on Lab requests separately, never silently substituted for canonical rules.
function ecoText(v: unknown): void { assertEvidence(typeof v === "string" && v.length > 0, "INVALID_ECO00_STRING"); }
function version(v: Record<string, unknown>): void { literal(v.schemaVersion, ["1.0.0"]); }
function ecoStrings(v: unknown, minimum = 0): void { assertEvidence(Array.isArray(v) && v.length >= minimum); v.forEach(ecoText); assertEvidence(new Set(v).size === v.length); }
export function validateEco00Subject(value: unknown): asserts value is Eco00Subject {
  const v = closed(value, ["schemaVersion", "authority", "namespace", "value"], ["repository"]); version(v); [v.authority, v.namespace, v.value].forEach(ecoText);
  if (v.repository !== undefined) { const r = closed(v.repository, ["owner", "name"], ["commit"]); ecoText(r.owner); ecoText(r.name); if (r.commit !== undefined) assertEvidence(typeof r.commit === "string" && /^[a-f0-9]{40}$/.test(r.commit)); }
}
export function validateEco00Environment(value: unknown): asserts value is Eco00Environment {
  const v = closed(value, ["schemaVersion", "environmentId", "dimensions"]); version(v); ecoText(v.environmentId); const dimensions = object(v.dimensions); assertEvidence(Object.keys(dimensions).length > 0); Object.values(dimensions).forEach(ecoText);
}
export function validateEco00NativeReference(value: unknown): asserts value is Eco00NativeReference {
  const v = closed(value, ["schemaVersion", "producer", "artifactKind", "locator"], ["artifactSchemaVersion", "integrity"]); version(v);
  const producer = closed(v.producer, ["packageName", "packageVersion"]); ecoText(producer.packageName); ecoText(producer.packageVersion); ecoText(v.artifactKind);
  if (v.artifactSchemaVersion !== undefined) ecoText(v.artifactSchemaVersion);
  const locator = closed(v.locator, ["kind", "value"]); literal(locator.kind, ["path", "uri", "opaque-id"]); ecoText(locator.value);
  if (v.integrity !== undefined) digest(closed(v.integrity, ["sha256"]).sha256);
}
export function validateEco00Envelope(value: unknown): asserts value is Eco00Envelope {
  const v = closed(value, ["schemaVersion", "evidenceId", "capabilityId", "subject", "nativeArtifact", "freshness"], ["environment", "observedAt"]); version(v); ecoText(v.evidenceId); ecoText(v.capabilityId); validateEco00Subject(v.subject); validateEco00NativeReference(v.nativeArtifact);
  literal(v.freshness, ["current", "stale", "partially-stale", "unknown", "not-applicable"]); if (v.environment !== undefined) validateEco00Environment(v.environment);
  if (v.observedAt !== undefined) {
    assertEvidence(typeof v.observedAt === "string", "INVALID_DATE_TIME");
    const match = /^(\d{4})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:[Zz]|[+-](\d\d):(\d\d))$/.exec(v.observedAt);
    assertEvidence(match, "INVALID_DATE_TIME"); const [year, month, day, hour, minute, second, zoneHour, zoneMinute] = match.slice(1).map(x => Number(x ?? 0)); const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    assertEvidence(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour < 24 && minute < 60 && second <= 60 && zoneHour < 24 && zoneMinute < 60, "INVALID_DATE_TIME");
    if (second === 60) {
      const offset = /([+-])\d\d:\d\d$/.exec(v.observedAt); const minutes = (zoneHour * 60 + zoneMinute) * (offset?.[1] === "-" ? -1 : 1);
      const utc = new Date(0); utc.setUTCFullYear(year, month - 1, day); utc.setUTCHours(hour, minute - minutes, 59, 0);
      assertEvidence(utc.getUTCHours() === 23 && utc.getUTCMinutes() === 59 && (utc.getUTCMonth() === 5 && utc.getUTCDate() === 30 || utc.getUTCMonth() === 11 && utc.getUTCDate() === 31), "INVALID_DATE_TIME");
    }
  }
}
export function validateEco00Requirement(value: unknown): asserts value is Eco00Requirement {
  const v = closed(value, ["schemaVersion", "requirementId", "capabilityId", "criticality", "acceptedArtifactKinds"], ["responsibility"]); version(v); ecoText(v.requirementId); ecoText(v.capabilityId); literal(v.criticality, ["critical", "noncritical"]); ecoStrings(v.acceptedArtifactKinds, 1); if (v.responsibility !== undefined) validateEco00Subject(v.responsibility);
}
export function validateEco00Bundle(value: unknown): asserts value is Eco00Bundle {
  const v = closed(value, ["schemaVersion", "bundleId", "status", "components", "contracts"], ["testEvidenceRefs", "certificationProfile", "supersedesBundleId"]); version(v); ecoText(v.bundleId); literal(v.status, ["supported", "tested", "certified", "active"]);
  assertEvidence(Array.isArray(v.components) && v.components.length > 0); const components: string[] = [];
  for (const component of v.components) { const c = closed(component, ["packageName", "packageVersion"], ["commit", "artifactSha256"]); ecoText(c.packageName); ecoText(c.packageVersion); if (c.commit !== undefined) assertEvidence(typeof c.commit === "string" && /^[a-f0-9]{40}$/.test(c.commit)); if (c.artifactSha256 !== undefined) digest(c.artifactSha256); components.push(JSON.stringify(Object.fromEntries(Object.entries(c).sort()))); }
  assertEvidence(new Set(components).size === components.length);
  assertEvidence(Array.isArray(v.contracts) && v.contracts.length > 0); for (const contract of v.contracts) { const c = closed(contract, ["contractId", "schemaVersion"]); ecoText(c.contractId); ecoText(c.schemaVersion); }
  if (v.testEvidenceRefs !== undefined) ecoStrings(v.testEvidenceRefs);
  if (v.certificationProfile !== undefined) ecoText(v.certificationProfile); if (v.supersedesBundleId !== undefined) ecoText(v.supersedesBundleId);
  if (v.status === "certified" || v.status === "active") { assertEvidence(v.certificationProfile !== undefined); ecoStrings(v.testEvidenceRefs, 1); }
}
