import { TextDecoder } from "node:util";
import { validateMyDevKitContextCapsuleV1 } from "../upstreamArtifacts/validateMyDevKitContextCapsuleV1.js";
import { validateMyDevKitRetrievalAuditRecordV1 } from "../upstreamArtifacts/validateMyDevKitRetrievalAuditRecordV1.js";
import { validateOrchestratorWorkflowInstructionPacketV1 } from "../upstreamArtifacts/validateOrchestratorWorkflowInstructionPacketV1.js";
import { validateNativeOrchestratorInspectionV1 } from "../upstreamArtifacts/validateOrchestratorRunIntegrityV1.js";
import type { JsonObject } from "../upstreamArtifacts/jsonTypes.js";
import { assertEvidence, closed, literal, object, strings, text, validateEco00NativeReference } from "./eco00ContractValidation.js";
import { sha256, validateSubjectBinding } from "./identity.js";
import type { Eco00NativeReference, LabNativeAdapterResultV1, LabSubjectBindingV1 } from "./types.js";

export const NATIVE_EVIDENCE_KINDS = ["node-test-tap-v1", "kit-context-capsule-v1", "kit-retrieval-audit-v1", "orchestrator-workflow-instruction-packet-v1", "orchestrator-run-integrity-v1"] as const;
function base(reference: Eco00NativeReference): LabNativeAdapterResultV1 { return { adapterId: reference.artifactKind, adapterVersion: "1.0.0", nativeArtifact: reference, availability: "available", nativeOutcome: "indeterminate", completeness: "unknown", capabilities: [], counts: null, limitations: [], nativeStatus: null, nativeFreshness: "not-applicable" }; }

/** Deliberately bounded flat Node TAP13 subset. Nested test suites and arbitrary TAP directives are unsupported. */
export function adaptNodeTap(bytes: Uint8Array, reference: Eco00NativeReference): LabNativeAdapterResultV1 {
  const result = base(reference); let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return { ...result, availability: "invalid", limitations: ["INVALID_TAP_ENCODING"] }; }
  const lines = source.replace(/\r\n/g, "\n").split("\n"); let version = false; let plan: number | null = null; let tests = 0; let failures = 0; let diagnostic = false; let partial = false; let subtestPending = false;
  const totals = new Map<string, number>();
  const invalid = (reason: string): LabNativeAdapterResultV1 => ({ ...result, availability: "invalid", nativeOutcome: failures ? "failed" : "indeterminate", limitations: [reason] });
  for (const line of lines) {
    if (line === "") continue;
    if (diagnostic) { if (line === "  ...") { diagnostic = false; continue; } if (!/^ {2,}\S|^\s*$/.test(line)) return invalid("INVALID_TAP_DIAGNOSTIC"); continue; }
    if (line === "TAP version 13" && !version && tests === 0 && plan === null) { version = true; continue; }
    if (!version) return invalid("UNSUPPORTED_TAP_VERSION");
    if (line === "  ---" && tests > 0) { diagnostic = true; continue; }
    if (/^# Subtest: .+/.test(line) && !subtestPending && plan === null) { subtestPending = true; continue; }
    const assertion = /^(not ok|ok) ([1-9]\d*) - ([^\r\n]+)$/.exec(line);
    if (assertion) { if (plan !== null || !subtestPending || Number(assertion[2]) !== tests + 1) return invalid("INVALID_TAP_RESULT_ORDER"); tests++; subtestPending = false; if (assertion[1] === "not ok") failures++; if (/ # (?:SKIP|TODO)\b/i.test(assertion[3])) partial = true; continue; }
    const p = /^1\.\.(0|[1-9]\d*)$/.exec(line); if (p) { if (plan !== null || subtestPending || Number(p[1]) !== tests) return invalid("INVALID_TAP_PLAN"); plan = Number(p[1]); continue; }
    const total = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (0|[1-9]\d*)$/.exec(line);
    if (total) { if (plan === null || totals.has(total[1])) return invalid("INVALID_TAP_TOTALS"); totals.set(total[1], Number(total[2])); continue; }
    if (/^# duration_ms (?:\d+(?:\.\d+)?)$/.test(line) && plan !== null) continue;
    return invalid("UNSUPPORTED_TAP_STRUCTURE");
  }
  if (!version || diagnostic || subtestPending || plan === null) return invalid("INCOMPLETE_TAP_STRUCTURE");
  const trustworthy = ["tests", "pass", "fail", "cancelled", "skipped", "todo", "suites"].every(k => totals.has(k));
  if (trustworthy) {
    if (totals.get("tests") !== tests || totals.get("fail") !== failures || totals.get("suites") !== 0 || totals.get("pass")! + failures + totals.get("cancelled")! + totals.get("skipped")! + totals.get("todo")! !== tests) return invalid("CONTRADICTORY_TAP_TOTALS");
    partial ||= totals.get("cancelled")! + totals.get("skipped")! + totals.get("todo")! > 0;
    result.counts = { tests, passed: totals.get("pass")!, failed: failures };
  }
  result.nativeOutcome = failures > 0 ? "failed" : trustworthy && tests > 0 && !partial ? "passed" : "indeterminate";
  result.completeness = trustworthy && !partial ? "complete" : "partial"; result.capabilities = ["native-test-result", ...(trustworthy ? ["trustworthy-test-totals"] : [])]; result.nativeStatus = result.nativeOutcome;
  if (!trustworthy) result.limitations.push("Test totals unavailable"); if (partial) result.limitations.push("Skipped, cancelled or todo tests cannot establish complete success"); return result;
}

export function adaptNativeEvidence(bytes: Uint8Array, reference: Eco00NativeReference, binding: LabSubjectBindingV1): LabNativeAdapterResultV1 {
  validateEco00NativeReference(reference); validateSubjectBinding(binding); const result = base(reference);
  assertEvidence(reference.integrity?.sha256 === sha256(bytes), "DIGEST_MISMATCH");
  if (!(NATIVE_EVIDENCE_KINDS as readonly string[]).includes(reference.artifactKind) || reference.artifactSchemaVersion !== "1.0.0") return { ...result, availability: "unsupported", nativeOutcome: "unavailable", limitations: ["Unsupported exact native kind/schema"] };
  if (reference.artifactKind === "node-test-tap-v1") { if (reference.producer.packageName !== "node") return { ...result, availability: "invalid", limitations: ["Unexpected TAP producer"] }; return adaptNodeTap(bytes, reference); }
  let parsed: JsonObject;
  try { parsed = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))) as JsonObject; } catch { return { ...result, availability: "invalid", limitations: ["Invalid native JSON object"] }; }
  const producer = reference.artifactKind.startsWith("kit-") ? "@dailephd/my-dev-kit" : "@dailephd/my-dev-kit-orchestrator";
  if (reference.producer.packageName !== producer || parsed.schemaVersion !== reference.artifactSchemaVersion) return { ...result, availability: "invalid", limitations: ["Native producer/schema declaration mismatch"] };
  const validated = reference.artifactKind === "kit-context-capsule-v1" ? validateMyDevKitContextCapsuleV1(parsed, "native-bytes") : reference.artifactKind === "kit-retrieval-audit-v1" ? validateMyDevKitRetrievalAuditRecordV1(parsed, "native-bytes") : reference.artifactKind === "orchestrator-workflow-instruction-packet-v1" ? validateOrchestratorWorkflowInstructionPacketV1(parsed, "native-bytes") : validateNativeOrchestratorInspectionV1(parsed, "native-bytes");
  if (!validated.ok) return { ...result, availability: "invalid", limitations: [validated.code] };
  if (reference.artifactKind.startsWith("kit-") && object(parsed.tool).version !== reference.producer.packageVersion) return { ...result, availability: "invalid", limitations: ["Native producer version mismatch"] };
  if (reference.artifactKind === "orchestrator-run-integrity-v1") {
    const native = validateNativeOrchestratorInspectionV1(parsed, "native-bytes"); if (!native.ok) return { ...result, availability: "invalid", limitations: [native.code] };
    result.nativeStatus = native.artifact.integrity.expectedJudgeVerdict; result.nativeOutcome = native.artifact.judge.accepted && native.artifact.judge.finalReportEligible && native.artifact.integrity.ready ? "passed" : native.artifact.checks?.outcome === "failed" ? "failed" : "indeterminate"; result.completeness = "complete"; result.capabilities = ["native-run-integrity", "native-final-report-eligibility"]; result.limitations.push("Lab preserves native decisions; this projection does not supersede Orchestrator eligibility", `Native integrity ready=${native.artifact.integrity.ready}; judge accepted=${native.artifact.judge.accepted}; finalReportEligible=${native.artifact.judge.finalReportEligible}`);
  } else if (reference.artifactKind === "orchestrator-workflow-instruction-packet-v1") {
    result.nativeStatus = String(object(parsed.adequacy).status); result.completeness = object(parsed.truncation).truncated === true || object(parsed.adequacy).requiredContentComplete !== true || object(parsed.adequacy).requiredBudgetSatisfied !== true ? "partial" : "complete"; result.capabilities = ["native-instruction-identity"]; result.limitations.push("Instruction existence does not establish executable success or final-run eligibility");
  } else {
    result.nativeStatus = String(object(parsed.roleAdequacy ?? parsed.contextAdequacy).status); result.completeness = parsed.truncation ? object(parsed.truncation).requiredEvidenceLost === true ? "partial" : "complete" : "unknown"; result.capabilities = ["native-context-readiness"];
    const freshness = parsed.freshness ? object(parsed.freshness).state : "unknown";
    result.nativeFreshness = freshness === "fresh" ? "current" : freshness === "stale" || freshness === "partially-stale" ? freshness : "unknown";
    result.limitations.push(`Native freshness: ${parsed.freshness ? String(object(parsed.freshness).state) : "unknown"}`, "Context evidence is not executable test success", "Native source qualification remains producer-owned");
  }
  return result;
}

export function validateAdapterResult(value: unknown): asserts value is LabNativeAdapterResultV1 {
  const v = closed(value, ["adapterId", "adapterVersion", "nativeArtifact", "availability", "nativeOutcome", "completeness", "capabilities", "counts", "limitations", "nativeStatus", "nativeFreshness"]); text(v.adapterId); literal(v.adapterVersion, ["1.0.0"]); validateEco00NativeReference(v.nativeArtifact); assertEvidence(v.adapterId === v.nativeArtifact.artifactKind); literal(v.availability, ["available", "unavailable", "unsupported", "invalid"]); literal(v.nativeOutcome, ["passed", "failed", "indeterminate", "unavailable"]); literal(v.completeness, ["complete", "partial", "unknown"]); literal(v.nativeFreshness, ["current", "stale", "partially-stale", "unknown", "not-applicable"]); strings(v.capabilities); strings(v.limitations, 0, 2000, false); if (v.nativeStatus !== null) text(v.nativeStatus);
  if (v.counts !== null) { const counts = closed(v.counts, ["tests", "passed", "failed"]); Object.values(counts).forEach(n => assertEvidence(typeof n === "number" && Number.isSafeInteger(n) && n >= 0)); }
}
