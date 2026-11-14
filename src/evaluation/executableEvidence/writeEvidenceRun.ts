import { mkdir, realpath, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { resolvePhysicalPath } from "../benchmarkSandbox/pathPolicy.js";
import { assertEvidence, text } from "./eco00ContractValidation.js";
import { canonicalEvidenceJson, insideEvidenceRoot, sha256 } from "./identity.js";
import { validateQualification } from "./importNativeEvidence.js";
import { validateAssessment } from "./evaluateEvidence.js";
import { validateCertificationAssessmentBinding } from "./certifyBundle.js";
import { buildExecutableEvidenceReport, renderExecutableEvidenceText } from "../../report/experiments/executableEvidenceReport.js";
import type { LabCertificationRecordV1, LabEvidenceAssessmentV1, LabEvidenceQualificationV1 } from "./types.js";

type Reservation = { root: string; runId: string };
const reservations = new WeakSet<Reservation>();
export async function reserveEvidenceRun(workspaceRoot: string, outputRoot: string): Promise<Reservation> {
  const allowed = path.join(await resolvePhysicalPath(workspaceRoot), "lab-output", "evidence");
  const output = await resolvePhysicalPath(outputRoot); const runId = path.basename(output); text(runId, 128);
  assertEvidence(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId) && runId !== "." && runId !== "..", "INVALID_RUN_ID");
  assertEvidence(insideEvidenceRoot(allowed, output) && path.dirname(output) === allowed, "UNAUTHORIZED_OUTPUT_ROOT");
  await mkdir(allowed, { recursive: true }); assertEvidence(await realpath(allowed) === allowed, "OUTPUT_ROOT_CHANGED");
  await mkdir(output); const reservation = { root: output, runId }; reservations.add(reservation);
  await writeFile(path.join(output, "manifest.json"), canonicalEvidenceJson({ schemaVersion: "1.0.0", runId, artifacts: [], completionState: "incomplete", failureReason: "Operation has not completed" }) + "\n", { flag: "wx" });
  await mkdir(path.join(output, "native")); return reservation;
}
export async function failEvidenceRun(reservation: Reservation, reason: string): Promise<void> {
  assertEvidence(reservations.has(reservation), "UNOWNED_RUN");
  await writeFile(path.join(reservation.root, "manifest.json"), canonicalEvidenceJson({ schemaVersion: "1.0.0", runId: reservation.runId, artifacts: [], completionState: "incomplete", failureReason: reason.slice(0, 240) }) + "\n"); reservations.delete(reservation);
}
export async function writeEvidenceRun(reservation: Reservation, input: { assessment: LabEvidenceAssessmentV1; qualification?: LabEvidenceQualificationV1; certification?: LabCertificationRecordV1; nativeBytes?: Uint8Array }): Promise<void> {
  assertEvidence(reservations.has(reservation), "UNOWNED_RUN");
  const artifacts: Array<{ path: string; size: number; sha256: string; provenance: "original" | "derived" }> = [];
  try {
    validateAssessment(input.assessment); if (input.qualification) { validateQualification(input.qualification); assertEvidence(input.qualification.planSha256 === input.assessment.planSha256, "PLAN_MISMATCH"); } if (input.certification) validateCertificationAssessmentBinding(input.certification, input.assessment);
    assertEvidence(await realpath(reservation.root) === reservation.root && await realpath(path.join(reservation.root, "native")) === path.join(reservation.root, "native"), "OUTPUT_ROOT_CHANGED");
    const write = async (relative: string, content: string | Uint8Array, provenance: "original" | "derived") => { const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content; const target = path.join(reservation.root, relative); await writeFile(target, bytes, { flag: "wx" }); const verified = await readFile(target); assertEvidence(sha256(verified) === sha256(bytes), "OUTPUT_INTEGRITY_FAILURE"); artifacts.push({ path: relative, size: bytes.length, sha256: sha256(bytes), provenance }); };
    const json = (v: unknown) => canonicalEvidenceJson(v) + "\n";
    if (input.nativeBytes) { assertEvidence(input.qualification && input.nativeBytes.length <= 8388608 && sha256(input.nativeBytes) === input.qualification.nativeArtifactSha256, "DIGEST_MISMATCH"); await write("native/artifact.bin", input.nativeBytes, "original"); }
    if (input.certification) await write("native/references.json", json({ schemaVersion: "1.0.0", references: input.certification.nativeEvidenceRefs }), "derived");
    if (input.qualification) await write("qualification.json", json(input.qualification), "derived");
    await write("assessment.json", json(input.assessment), "derived");
    if (input.certification) await write("certification.json", json(input.certification), "derived");
    const report = buildExecutableEvidenceReport(input); await write("report.json", json(report), "derived"); await write("report.txt", renderExecutableEvidenceText(report), "derived");
    await writeFile(path.join(reservation.root, "manifest.json"), json({ schemaVersion: "1.0.0", runId: reservation.runId, artifacts: artifacts.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), completionState: "complete", failureReason: null })); reservations.delete(reservation);
  } catch (error) {
    await writeFile(path.join(reservation.root, "manifest.json"), canonicalEvidenceJson({ schemaVersion: "1.0.0", runId: reservation.runId, artifacts, completionState: "incomplete", failureReason: (error instanceof Error ? error.message : "Write failed").slice(0, 240) }) + "\n"); reservations.delete(reservation); throw error;
  }
}
