import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateVerificationPlan, verificationPlanSha256 } from "../../../src/evaluation/executableEvidence/verificationPlan.js";
import type { LabVerificationPlanV1 } from "../../../src/evaluation/executableEvidence/types.js";
const fixture = (name = "plan-cli-valid") => JSON.parse(readFileSync(`tests/fixtures/ecosystem/executable-evidence-v1/${name}.json`, "utf8")) as LabVerificationPlanV1;
describe("RSP-002 frozen verification policy", () => {
  it.each(["plan-cli-valid", "plan-cli-required-failure", "plan-local-app-valid"])("validates %s", name => expect(() => validateVerificationPlan(fixture(name))).not.toThrow());
  it("rejects execution authority embedded in a plan", () => expect(() => validateVerificationPlan(fixture("plan-invalid-authorization"))).toThrow());
  it("binds exact policy and ordered requirements without a self-referential digest", () => { const p = fixture(); const original = verificationPlanSha256(p); expect(verificationPlanSha256(structuredClone(p))).toBe(original); p.policyVersion = "1.0.1"; expect(verificationPlanSha256(p)).not.toBe(original); expect(() => validateVerificationPlan({ ...p, planSha256: original })).toThrow(); });
  it("normalizes and sorts selected reference paths before plan hashing", () => { const p = fixture(); const digest = verificationPlanSha256(p); p.selectedInputs.paths = p.selectedInputs.paths.reverse().map(s => s.replaceAll("/", "\\")); expect(verificationPlanSha256(p)).toBe(digest); });
  it.each(["commandString", "argv", "shell", "script", "evaluator"])("rejects check field %s", field => { const p = fixture(); (p.checks[0] as unknown as Record<string, unknown>)[field] = "never executed"; expect(() => validateVerificationPlan(p)).toThrow(); });
  it("rejects duplicate requirements and oversized requirement/check sets", () => { const p = fixture(); p.requirements.push(structuredClone(p.requirements[0])); expect(() => validateVerificationPlan(p)).toThrow(); p.requirements = Array.from({ length: 201 }, (_, i) => ({ ...p.requirements[0], requirementId: `r${i}` })); expect(() => validateVerificationPlan(p)).toThrow(); });
  it("requires an explicit policy reason for not-applicable evidence", () => { const p = fixture(); p.requirements[0].applicability = "not-applicable"; expect(() => validateVerificationPlan(p)).toThrow(); p.requirements[0].applicabilityReason = "Policy excludes browser for CLI-only execution"; expect(() => validateVerificationPlan(p)).not.toThrow(); });
  it("does not allow two executable checks to hide behind one capability", () => { const p = fixture(); p.checks.push({ ...p.checks[0], checkId: "another" }); expect(() => validateVerificationPlan(p)).toThrow("Each executable check"); });
});
