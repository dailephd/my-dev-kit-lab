import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { runMeasuredCommand } from "../../core/runMeasuredCommand.js";
import { createBenchmarkSandbox } from "../benchmarkSandbox/createBenchmarkSandbox.js";
import { removeBenchmarkSandbox } from "../benchmarkSandbox/removeBenchmarkSandbox.js";
import { buildMinimalHostEnv } from "../benchmarkSandbox/minimalHostEnv.js";
import { BENCHMARK_SANDBOX_EXCLUDED_NAMES, resolvePhysicalPath } from "../benchmarkSandbox/pathPolicy.js";
import { digestTreeSnapshot, scanProjectTree, snapshotProjectTree } from "../benchmarkSandbox/treeSnapshot.js";
import { captureTargetSnapshot } from "../targetImmutability/captureTargetSnapshot.js";
import { compareTargetSnapshots } from "../targetImmutability/compareTargetSnapshots.js";
import { assertEvidence, closed, literal, strings, text } from "./eco00ContractValidation.js";
import { evidenceDigest, insideEvidenceRoot, normalizeEvidencePath, qualifySubject, readEvidenceBytes, sha256 } from "./identity.js";
import { qualificationIdentity, validateQualification } from "./importNativeEvidence.js";
import { adaptNativeEvidence } from "./nativeAdapters.js";
import { verificationPlanSha256 } from "./verificationPlan.js";
import type { LabEvidenceCaptureAuthorizationV1, LabEvidenceCaptureRequestV1, LabEvidenceCaptureResultV1, LabEvidenceQualificationV1 } from "./types.js";

export function validateCaptureAuthorization(value: unknown): asserts value is LabEvidenceCaptureAuthorizationV1 {
  const a = closed(value, ["authorizationVersion", "allowLocalCodeExecution", "canonicalTargetRoot", "disposableExecutionRoot", "allowedCheckIds", "allowedTestFiles", "allowedWritableRoot", "timeoutMs", "stdoutMaxBytes", "stderrMaxBytes", "networkPolicy", "environmentExtras"]);
  literal(a.authorizationVersion, ["1.0.0"]); assertEvidence(a.allowLocalCodeExecution === true, "UNAUTHORIZED_EXECUTION"); [a.canonicalTargetRoot, a.disposableExecutionRoot, a.allowedWritableRoot].forEach(v => { text(v); assertEvidence(path.isAbsolute(v as string), "INVALID_AUTHORIZED_ROOT"); }); strings(a.allowedCheckIds, 1, 64); strings(a.allowedTestFiles, 1, 64); a.allowedTestFiles.forEach(normalizeEvidencePath);
  for (const [name, maximum] of [["timeoutMs", 120000], ["stdoutMaxBytes", 1048576], ["stderrMaxBytes", 1048576]] as const) assertEvidence(typeof a[name] === "number" && Number.isSafeInteger(a[name]) && (a[name] as number) > 0 && (a[name] as number) <= maximum, "EXECUTION_LIMIT");
  assertEvidence(a.networkPolicy === "not-enforced", "UNSUPPORTED_NETWORK_POLICY", "Initial capture cannot enforce child-process network isolation");
  const extras = closed(a.environmentExtras, [], ["CI", "NO_COLOR", "LANG", "LC_ALL", "TZ", "SOURCE_DATE_EPOCH"]); Object.values(extras).forEach(v => text(v));
}
async function executableIdentity(): Promise<string> { const hash = createHash("sha256"); for await (const bytes of createReadStream(process.execPath)) hash.update(bytes); return hash.digest("hex"); }

export async function captureAuthorizedEvidence(request: LabEvidenceCaptureRequestV1): Promise<LabEvidenceCaptureResultV1> {
  let sandbox: Awaited<ReturnType<typeof createBenchmarkSandbox>> | null = null;
  try {
    assertEvidence(!Object.hasOwn(request, "signal"), "UNSUPPORTED_CANCELLATION", "Caller-driven cancellation is unsupported by this finite capture profile");
    closed(request, ["plan", "checkId", "authorization", "sandboxId"]); const planSha256 = verificationPlanSha256(request.plan); validateCaptureAuthorization(request.authorization); const a = request.authorization;
    assertEvidence(Number(process.versions.node.split(".")[0]) >= 24, "UNSUPPORTED_NODE_VERSION");
    text(request.sandboxId, 64); assertEvidence(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(request.sandboxId), "INVALID_RUN_ID");
    const check = request.plan.checks.find(c => c.checkId === request.checkId); assertEvidence(check && a.allowedCheckIds.includes(check.checkId) && a.allowedTestFiles.map(normalizeEvidencePath).includes(normalizeEvidencePath(check.testFile)), "UNAUTHORIZED_CHECK");
    assertEvidence(!request.plan.requirements.some(r => r.applicability === "applicable" && r.criticality === "critical" && r.requiredCapabilities.includes("enforced-network-isolation")), "UNSUPPORTED_NETWORK_POLICY");
    const target = await realpath(a.canonicalTargetRoot); assertEvidence(path.resolve(a.canonicalTargetRoot) === target || process.platform === "win32" && path.resolve(a.canonicalTargetRoot).toLowerCase() === target.toLowerCase(), "NONCANONICAL_TARGET");
    const writable = await resolvePhysicalPath(a.allowedWritableRoot); const disposable = await resolvePhysicalPath(a.disposableExecutionRoot);
    assertEvidence(insideEvidenceRoot(writable, disposable) && !insideEvidenceRoot(target, writable) && !insideEvidenceRoot(writable, target), "UNAUTHORIZED_WRITABLE_ROOT");
    const before = await qualifySubject(target, request.plan.subject, request.plan.selectedInputs); assertEvidence(before.binding.source.completeness === "complete", "INCOMPLETE_IDENTITY", before.reasons.join("; "));
    const copyInputs = await scanProjectTree(target, BENCHMARK_SANDBOX_EXCLUDED_NAMES);
    const selectedPaths = request.plan.selectedInputs.paths.map(normalizeEvidencePath);
    assertEvidence(copyInputs.length <= 2000 && copyInputs.every(p => selectedPaths.includes(p)), "INCOMPLETE_IDENTITY", "Every disposable-copy input must be independently selected and bounded");
    assertEvidence(copyInputs.every(p => !/(?:^|\/)(?:\.env(?!\.example$)|\.npmrc$|credentials(?:\.|\/|$)|id_rsa$|id_ed25519$)|\.(?:pem|key|pfx|p12)$/i.test(p)), "CREDENTIAL_FORWARDING_DENIED");
    const nodeSha256 = await executableIdentity();
    sandbox = await createBenchmarkSandbox({ canonicalProjectRoot: target, runtimeRoot: disposable, sandboxId: request.sandboxId });
    const copied = await qualifySubject(sandbox.projectRoot, request.plan.subject, request.plan.selectedInputs);
    assertEvidence(copied.binding.source.sourceManifestSha256OrNull === before.binding.source.sourceManifestSha256OrNull && copied.binding.source.completeness === "complete", "COPY_IDENTITY_MISMATCH");
    // All copyable inputs must be explicitly selected or excluded by the frozen policy.
    const selected = request.plan.selectedInputs.paths.map(normalizeEvidencePath); const excluded = request.plan.selectedInputs.exclusions.map(normalizeEvidencePath);
    assertEvidence(sandbox.baseline.manifest.every(e => selected.includes(e.path) || excluded.includes(e.path)), "INCOMPLETE_IDENTITY", "Disposable input universe contains an unselected input");
    const snapshotConfig = { targetRootPath: sandbox.projectRoot, relativeFilePaths: selected };
    const snapshotBefore = await captureTargetSnapshot(snapshotConfig, { externalLocalSafe: { maxHashedFileBytes: 1048576 } });
    assertEvidence(snapshotBefore.ok, "TARGET_SNAPSHOT_UNAVAILABLE");
    const temp = path.join(sandbox.evidenceRoot, "temp"); await mkdir(temp);
    const env = buildMinimalHostEnv(process.env, { ...a.environmentExtras, TEMP: temp, TMP: temp, TMPDIR: temp, CI: "1", NO_COLOR: "1" });
    const probe = await runMeasuredCommand({ commandId: "node-version", executable: process.execPath, args: ["--version"], cwd: sandbox.projectRoot, outDir: path.join(sandbox.evidenceRoot, "probe"), env, inheritParentEnv: false, resolveCommand: false, timeoutMs: Math.min(a.timeoutMs, 5000), stdoutMaxBytes: Math.min(a.stdoutMaxBytes, 128), stderrMaxBytes: Math.min(a.stderrMaxBytes, 128), terminateProcessTree: true });
    assertEvidence(probe.ok && probe.stdout.trim() === process.version && await executableIdentity() === nodeSha256, "NODE_EXECUTABLE_UNVERIFIABLE");
    const measured = await runMeasuredCommand({ commandId: "native-test", executable: process.execPath, args: ["--test", "--test-reporter=tap", "--", normalizeEvidencePath(check.testFile)], cwd: sandbox.projectRoot, outDir: path.join(sandbox.evidenceRoot, "capture"), env: buildMinimalHostEnv(process.env, { ...a.environmentExtras, TEMP: temp, TMP: temp, TMPDIR: temp, CI: "1", NO_COLOR: "1" }), inheritParentEnv: false, resolveCommand: false, timeoutMs: a.timeoutMs, stdoutMaxBytes: a.stdoutMaxBytes, stderrMaxBytes: a.stderrMaxBytes, terminateProcessTree: true });
    const bytes = await readEvidenceBytes(sandbox.evidenceRoot, "capture/native-test.stdout.txt", a.stdoutMaxBytes); const nativeArtifactSha256 = sha256(bytes);
    assertEvidence(await executableIdentity() === nodeSha256, "NODE_EXECUTABLE_CHANGED");
    const reference = { schemaVersion: "1.0.0" as const, producer: { packageName: "node", packageVersion: process.versions.node }, artifactKind: "node-test-tap-v1", artifactSchemaVersion: "1.0.0", locator: { kind: "path" as const, value: "native/artifact.bin" }, integrity: { sha256: nativeArtifactSha256 } };
    const adapter = adaptNativeEvidence(bytes, reference, before.binding);
    const after = await qualifySubject(target, request.plan.subject, request.plan.selectedInputs);
    const treeAfter = await snapshotProjectTree(sandbox.projectRoot, { excludedNames: [".git"] });
    const canonicalInventoryAfter = await scanProjectTree(target, BENCHMARK_SANDBOX_EXCLUDED_NAMES);
    const snapshotAfter = await captureTargetSnapshot(snapshotConfig, { externalLocalSafe: { maxHashedFileBytes: 1048576 } });
    const mutated = !snapshotAfter.ok || compareTargetSnapshots(snapshotBefore.snapshot, snapshotAfter.snapshot).status !== "unchanged" || evidenceDigest(before.binding.source) !== evidenceDigest(after.binding.source) || evidenceDigest(copyInputs) !== evidenceDigest(canonicalInventoryAfter) || digestTreeSnapshot(treeAfter) !== sandbox.baseline.digest;
    const processFailed = !measured.ok || measured.exitCode !== 0;
    const content: Omit<LabEvidenceQualificationV1, "qualificationId"> = { schemaVersion: "1.0.0", canonicalEnvelope: { schemaVersion: "1.0.0", evidenceId: nativeArtifactSha256, capabilityId: check.capabilityId, subject: request.plan.subject, nativeArtifact: reference, freshness: "current", environment: before.binding.environment.canonicalECO00EnvironmentOrNull! }, planSha256, subjectBinding: before.binding, environmentBinding: before.binding.environment.canonicalECO00EnvironmentOrNull, nativeArtifactSha256, captureOrigin: "direct-capture", invocationOrNull: { checkId: check.checkId, profileId: "node-test-tap-v1", executableSha256: nodeSha256, testFile: normalizeEvidencePath(check.testFile), exitCode: measured.exitCode, timedOut: measured.timedOut === true, outputLimit: measured.outputLimit !== undefined, cleanup: measured.processTreeCleanup ?? "not-required", targetMutation: mutated ? "changed" : "unchanged", disposableExecution: true, networkPolicy: "not-enforced" }, nativeOutcome: processFailed || mutated ? "failed" : adapter.nativeOutcome, completeness: measured.timedOut || measured.outputLimit ? "partial" : adapter.completeness, provenance: "independently-corroborated", limitations: [...adapter.limitations, "Network isolation is not enforced; local code may access account-accessible resources", "Caller cancellation is unsupported", ...(measured.error ? [measured.error.slice(0, 240)] : []), ...(mutated ? ["Unauthorized target or disposable input mutation detected"] : [])], qualifiedAtOrNull: null };
    const removed = await removeBenchmarkSandbox({ runtimeRoot: disposable, sandboxId: request.sandboxId }); sandbox = null;
    if (!removed.removed) { content.invocationOrNull!.cleanup = "failed"; content.limitations.push(`Sandbox cleanup failed: ${removed.reason}`.slice(0, 240)); }
    const qualification = { ...content, qualificationId: qualificationIdentity(content) }; validateQualification(qualification);
    return { ok: true, qualification, adapter, nativeBytes: bytes };
  } catch (error) {
    let cleanup = ""; if (sandbox) { const result = await removeBenchmarkSandbox({ runtimeRoot: sandbox.runtimeRoot, sandboxId: sandbox.sandboxId }); if (!result.removed) cleanup = "; sandbox cleanup failed"; }
    return { ok: false, code: typeof error === "object" && error !== null && "code" in error ? String(error.code) : "CAPTURE_INFRASTRUCTURE_FAILURE", reason: `${error instanceof Error ? error.message : "Capture unavailable"}${cleanup}`.slice(0, 240) };
  }
}
