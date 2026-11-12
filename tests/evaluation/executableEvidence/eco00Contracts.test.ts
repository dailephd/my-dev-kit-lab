import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ECO00_PINS, validateEco00ContractIdentity, validateEco00Subject, validateEco00Environment, validateEco00NativeReference, validateEco00Envelope, validateEco00Requirement, validateEco00Bundle } from "../../../src/evaluation/executableEvidence/eco00ContractValidation.js";

const root = process.env.LAB_ECO00_CONTRACT_ROOT ?? path.resolve("tests/fixtures/ecosystem/executable-evidence-v1");
const schemas = new Map<string, Record<string, any>>();
for (const name of Object.keys(ECO00_PINS).filter(n => n !== "contract-registry")) { const schema = JSON.parse(readFileSync(path.join(root, `eco00-${name}-v1.schema.json`), "utf8")); schemas.set(schema.$id, schema); }
// Independent test-only interpretation of the actual pinned schema keywords.
function conforms(schema: Record<string, any>, value: any): boolean {
  if (schema.$ref) return conforms(schemas.get(schema.$ref)!, value);
  if ("const" in schema && value !== schema.const || schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "object" || value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (schema.required?.some((k: string) => !Object.hasOwn(value, k)) || schema.minProperties && Object.keys(value).length < schema.minProperties) return false;
    for (const [k, v] of Object.entries(value)) { if (schema.properties?.[k]) { if (!conforms(schema.properties[k], v)) return false; } else if (schema.additionalProperties === false || typeof schema.additionalProperties === "object" && !conforms(schema.additionalProperties, v)) return false; }
  }
  if (schema.type === "string" && (typeof value !== "string" || schema.minLength && [...value].length < schema.minLength || schema.pattern && !new RegExp(schema.pattern).test(value))) return false;
  if (schema.format === "date-time" && (typeof value !== "string" || !/^\d{4}-\d\d-\d\d[Tt]\d\d:\d\d:\d\d(?:\.\d+)?(?:[Zz]|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))) return false;
  if (schema.type === "array" || Array.isArray(value)) { if (!Array.isArray(value) || schema.minItems && value.length < schema.minItems || schema.uniqueItems && new Set(value.map((v: unknown) => JSON.stringify(v))).size !== value.length) return false; if (schema.items && value.some((v: unknown) => !conforms(schema.items, v))) return false; }
  for (const conditional of schema.allOf ?? []) if (conforms(conditional.if, value) && !conforms(conditional.then, value)) return false;
  return true;
}
const subject = { schemaVersion: "1.0.0", authority: "lab", namespace: "source", value: "fixture", repository: { owner: "owner", name: "repo", commit: "a".repeat(40) } };
const environment = { schemaVersion: "1.0.0", environmentId: "node-fixture", dimensions: { node: "24.0.0" } };
const reference = { schemaVersion: "1.0.0", producer: { packageName: "node", packageVersion: "24.0.0" }, artifactKind: "node-test-tap-v1", artifactSchemaVersion: "1.0.0", locator: { kind: "path", value: "native/result.tap" }, integrity: { sha256: "b".repeat(64) } };
const examples: Array<[string, (v: unknown) => void, any]> = [
  ["subject-identity", validateEco00Subject, subject], ["environment-identity", validateEco00Environment, environment], ["native-artifact-reference", validateEco00NativeReference, reference],
  ["evidence-envelope", validateEco00Envelope, { schemaVersion: "1.0.0", evidenceId: "test", capabilityId: "tests", subject, environment, nativeArtifact: reference, freshness: "current", observedAt: "2026-11-05T00:00:00Z" }],
  ["evidence-requirement", validateEco00Requirement, { schemaVersion: "1.0.0", requirementId: "tests", capabilityId: "test", criticality: "critical", acceptedArtifactKinds: ["node-test-tap-v1"], responsibility: subject }],
  ["compatibility-bundle", validateEco00Bundle, { schemaVersion: "1.0.0", bundleId: "bundle", status: "certified", components: [{ packageName: "node", packageVersion: "24.0.0", artifactSha256: "c".repeat(64), commit: "d".repeat(40) }], contracts: [{ contractId: "eco.evidence-envelope", schemaVersion: "1.0.0" }], certificationProfile: "cli-verification-v1", testEvidenceRefs: ["exact-result"], supersedesBundleId: "previous" }]
];
function mutations(schema: Record<string, any>, value: any): any[] {
  if (schema.$ref) return mutations(schemas.get(schema.$ref)!, value);
  const variants: any[] = [null];
  if (schema.type === "object") { variants.push({ ...value, unexpected: true }); for (const key of schema.required ?? []) { const v = structuredClone(value); delete v[key]; variants.push(v); } for (const key of Object.keys(value)) { const child = schema.properties?.[key] ?? (typeof schema.additionalProperties === "object" ? schema.additionalProperties : null); if (child) for (const v of mutations(child, value[key])) variants.push({ ...value, [key]: v }); } }
  if (schema.type === "array") { variants.push([], [...value, ...value]); for (const child of mutations(schema.items ?? {}, value[0])) variants.push([child, ...value.slice(1)]); }
  if (schema.type === "string" || schema.const || schema.enum) variants.push("", "unsupported", 7);
  return variants;
}
describe("RSP-001 pinned ECO00 compiled consumer", () => {
  it.each(Object.keys(ECO00_PINS) as Array<keyof typeof ECO00_PINS>)("authenticates original upstream %s bytes and rejects identity drift", name => {
    const original = readFileSync(path.join(root, name === "contract-registry" ? "eco00-contract-registry.json" : `eco00-${name}-v1.schema.json`)); expect(() => validateEco00ContractIdentity(name, original)).not.toThrow(); expect(() => validateEco00ContractIdentity(name, Buffer.concat([original, Buffer.from("\n")]))).toThrow("Pinned ECO-00 source bytes differ");
  });
  it.each(examples)("matches exact original %s required/closed/nested/array constraints", (name, validate, valid) => {
    const schema = [...schemas.values()].find(s => s.$id.endsWith(`/${name}-v1.schema.json`))!;
    for (const candidate of [valid, ...mutations(schema, valid), { ...valid, schemaVersion: "1.1.0" }]) { let accepted = true; try { validate(candidate); } catch { accepted = false; } expect(accepted, `${name}: ${JSON.stringify(candidate).slice(0, 180)}`).toBe(conforms(schema, candidate)); }
  });
  it("keeps canonical strings unbounded while honoring Lab-specific identity bounds separately", () => { expect(() => validateEco00Subject({ ...subject, value: "x".repeat(1025) })).not.toThrow(); });
  it("does not require digests or local locators merely for canonical validity", () => { const { integrity: _integrity, ...r } = reference; expect(() => validateEco00NativeReference({ ...r, locator: { kind: "uri", value: "https://example.invalid/native" } })).not.toThrow(); });
  it("enforces certified/active conditional evidence and actual calendar date shape", () => { const bundle = examples[5][2]; expect(() => validateEco00Bundle({ ...bundle, status: "active", testEvidenceRefs: [] })).toThrow(); expect(() => validateEco00Envelope({ ...examples[3][2], observedAt: "2026-02-30T00:00:00Z" })).toThrow(); });
  it("honors RFC3339 leap-second placement and zone offsets without filesystem or network resolution", () => { for (const observedAt of ["1990-12-31T23:59:60Z", "1990-12-31T15:59:60-08:00", "1991-01-01T00:59:60+01:00"]) expect(() => validateEco00Envelope({ ...examples[3][2], observedAt })).not.toThrow(); for (const observedAt of ["1990-12-31T22:59:60Z", "1990-11-30T23:59:60Z", "2026-11-05T24:00:00Z"]) expect(() => validateEco00Envelope({ ...examples[3][2], observedAt })).toThrow(); });
});
