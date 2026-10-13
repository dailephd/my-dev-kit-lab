import { link, lstat, mkdir, open, readdir, readFile, realpath, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { isSameOrInside, resolvePhysicalPath } from "../../../evaluation/benchmarkSandbox/pathPolicy.js";
import { campaignAssert, campaignHash, canonicalCampaignJson, compareCampaignIdentity, validateCampaignIdentity, type CampaignIdentity } from "./campaignIdentity.js";
import { CAMPAIGN_CHECKPOINT_MAX_BYTES, requiredCampaignArtifacts, validateCampaignCheckpoint, validateCampaignCompletion, validateCampaignHistory, validateCampaignRelativePath, type CampaignCheckpoint, type CampaignCompletion } from "./campaignCheckpoint.js";
import type { AgentSuccessTreatmentEvidenceV1 } from "./executionTypes.js";
import { projectCampaignTreatmentEvidence } from "./campaignCheckpoint.js";
import { analyzeAgentSuccessTreatment } from "./analysis.js";
import { writeAgentSuccessRateArtifactTargets } from "./plugin.js";
import { CAMPAIGN_CHECKPOINT_SCHEMA_V2, mapCampaignEpochEvidence, validateCampaignCheckpointV2, validateCampaignHistoryV2, type CampaignCheckpointV2, type CampaignEpoch } from "./campaignRecovery.js";

export type CampaignStoreBoundary = { outputRoot: string; toolRoot: string };
/** Command preflight, including a not-yet-created output root. No filesystem mutation. */
export async function validateCampaignOutputPath(boundary: CampaignStoreBoundary, sourceRoot?: string): Promise<void> {
  const root = path.resolve(boundary.outputRoot);
  const physicalRoot = await resolveCampaignRoot(root);
  const roots = await Promise.all([boundary.toolRoot, moduleRoot, ...(path.basename(path.resolve(moduleRoot)) === "dist" ? [path.dirname(path.resolve(moduleRoot))] : []), ...(sourceRoot ? [sourceRoot] : [])].map(resolvePhysicalPath));
  for (const protectedRoot of roots) {
    campaignAssert(!samePhysicalPath(physicalRoot, protectedRoot), "PROTECTED_OUTPUT_ROOT");
    for (const segment of ["src", "scripts", "dist", "node_modules", "benchmarks", "tests"]) {
      const protectedPath = path.join(protectedRoot, segment);
      campaignAssert(!isSameOrInside(protectedPath, physicalRoot) && !isSameOrInside(physicalRoot, protectedPath), "PROTECTED_OUTPUT_ROOT");
    }
  }
}
const GENERATION = /^generation-(\d{10})\.json$/;
const TEMPORARY = /^\.temporary-[a-f0-9-]{36}\.json$/;
const STORE_SEGMENT = "campaign-checkpoints";
const STORE_OWNER = "campaign-checkpoint-store-v1";
const moduleRoot = fileURLToPath(new URL("../../../../", import.meta.url));
type StoredCheckpoint = CampaignCheckpoint | CampaignCheckpointV2;
const durableCheckpoints = new WeakMap<StoredCheckpoint, string>();
function samePhysicalPath(left: string, right: string): boolean { return isSameOrInside(left, right) && isSameOrInside(right, left); }

async function plain(candidate: string, kind: "file" | "directory"): Promise<void> {
  const stat = await lstat(candidate);
  campaignAssert(!stat.isSymbolicLink() && (kind === "file" ? stat.isFile() : stat.isDirectory()), "UNSAFE_FILESYSTEM_TARGET");
}
/** Inspect every ancestor; refuse links/junctions and fail closed on inspection errors. */
async function plainAncestors(candidate: string): Promise<void> {
  let current = path.resolve(candidate);
  for (;;) { await plain(current, "directory"); const parent = path.dirname(current); if (parent === current) return; current = parent; }
}
/** Resolve filesystem aliases before inspecting ancestors (macOS exposes /var as /private/var). */
export async function resolveCampaignRoot(candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  let existing = resolved;
  const remainder: string[] = [];
  for (;;) {
    try { await plain(existing, "directory"); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      campaignAssert(parent !== existing, "UNSAFE_FILESYSTEM_TARGET");
      remainder.unshift(path.basename(existing));
      existing = parent;
    }
  }
  const physicalExisting = await realpath(existing);
  await plainAncestors(physicalExisting);
  return path.join(physicalExisting, ...remainder);
}
async function validateRoot(boundary: CampaignStoreBoundary): Promise<string> {
  const root = await resolveCampaignRoot(boundary.outputRoot);
  const physicalRoot = root;
  const packageRoots = await Promise.all([boundary.toolRoot, moduleRoot, ...(path.basename(path.resolve(moduleRoot)) === "dist" ? [path.dirname(path.resolve(moduleRoot))] : [])].map(resolvePhysicalPath));
  for (const packageRoot of packageRoots) {
    campaignAssert(!samePhysicalPath(physicalRoot, packageRoot), "PROTECTED_OUTPUT_ROOT");
    for (const segment of ["src", "scripts", "dist", "node_modules", "benchmarks", "tests"]) { const protectedRoot = path.join(packageRoot, segment); campaignAssert(!isSameOrInside(protectedRoot, physicalRoot) && !isSameOrInside(physicalRoot, protectedRoot), "PROTECTED_OUTPUT_ROOT"); }
  }
  return root;
}
async function safeFile(root: string, relative: string): Promise<string> {
  validateCampaignRelativePath(relative);
  const target = resolveWithinRoot(root, relative);
  await plainAncestors(path.dirname(target)); await plain(target, "file");
  const [physicalRoot, physicalTarget] = await Promise.all([realpath(root), realpath(target)]);
  campaignAssert(isSameOrInside(physicalRoot, physicalTarget) && !samePhysicalPath(physicalTarget, physicalRoot), "ARTIFACT_ESCAPE");
  return target;
}
async function boundedRead(file: string, max: number): Promise<Buffer> {
  await plain(file, "file");
  const handle = await open(file, "r");
  try { const before = await handle.stat(); campaignAssert(before.isFile() && before.size <= max, "DATA_BOUND"); const result = Buffer.alloc(before.size + 1); let size = 0; for (;;) { const n = await handle.read(result, size, result.length - size, size); size += n.bytesRead; if (n.bytesRead === 0 || size === result.length) break; } campaignAssert(size === before.size && (await handle.stat()).size === before.size, "FILE_CHANGED_DURING_READ"); return result.subarray(0, size); } finally { await handle.close(); }
}
async function ownedDirectory(parent: string, name: string, owner: string, create: boolean): Promise<string | null> {
  const dir = resolveWithinRoot(parent, name);
  let created = false;
  try { await lstat(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; if (!create) return null; await mkdir(dir); created = true; }
  await plainAncestors(dir);
  const marker = path.join(dir, "owner.json");
  if (created) { const h = await open(marker, "wx"); try { await h.writeFile(owner, "utf8"); await h.sync(); } finally { await h.close(); } }
  campaignAssert((await boundedRead(marker, 1024)).toString("utf8") === owner, "UNKNOWN_DIRECTORY_OWNER");
  return dir;
}
async function directory(boundary: CampaignStoreBoundary, identity: CampaignIdentity, create: boolean, v2 = false): Promise<string | null> {
  validateCampaignIdentity(identity);
  const root = await validateRoot(boundary);
  const owner = v2 ? "campaign-checkpoint-store-v2" : STORE_OWNER;
  const store = await ownedDirectory(root, v2 ? "campaign-checkpoints-v2" : STORE_SEGMENT, owner, create);
  return store === null ? null : ownedDirectory(store, identity.digest, `${owner}:${identity.digest}`, create);
}
function generationName(n: number): string { campaignAssert(Number.isSafeInteger(n) && n >= 1 && n <= 1_000_000); return `generation-${String(n).padStart(10, "0")}.json`; }

export async function prepareCampaignCompletion(boundary: CampaignStoreBoundary, identity: CampaignIdentity, task: AgentSuccessTaskV1, source: AgentSuccessTreatmentEvidenceV1): Promise<CampaignCompletion> {
  const root = await validateRoot(boundary);
  const evidence = projectCampaignTreatmentEvidence(source);
  const artifacts = [];
  for (const reference of requiredCampaignArtifacts(evidence, task)) { const bytes = await boundedRead(await safeFile(root, reference.path), 32 * 1024 * 1024); artifacts.push({ ...reference, sha256: campaignHash(bytes), bytes: bytes.length }); }
  const result: CampaignCompletion = { sourceSchema: "my-dev-kit-lab-agent-success-rate-execution-v1", evidence, taskSuccess: analyzeAgentSuccessTreatment(task, evidence).metrics.taskSuccess.value === true, artifacts };
  validateCampaignCompletion(result, identity, task, source.treatmentId);
  return result;
}
async function verifyArtifacts(boundary: CampaignStoreBoundary, checkpoint: StoredCheckpoint): Promise<void> {
  const root = await validateRoot(boundary);
  for (const unit of checkpoint.units) for (const reference of unit.completion?.artifacts ?? []) { const bytes = await boundedRead(await safeFile(root, reference.path), 32 * 1024 * 1024); campaignAssert(bytes.length === reference.bytes && campaignHash(bytes) === reference.sha256, "ARTIFACT_INTEGRITY"); }
  if (checkpoint.schemaVersion === CAMPAIGN_CHECKPOINT_SCHEMA_V2) {
    for (const unit of checkpoint.units) for (const epoch of unit.epochs) {
      await verifyEpochDirectory(boundary, checkpoint.identity, epoch);
      for (const reference of epoch.terminal?.artifacts ?? []) { const bytes = await boundedRead(await safeFile(root, reference.path), 32 * 1024 * 1024); campaignAssert(bytes.length === reference.bytes && campaignHash(bytes) === reference.sha256, "ARTIFACT_INTEGRITY"); }
    }
    for (const reference of checkpoint.finalization?.artifacts ?? []) { const bytes = await boundedRead(await safeFile(root, reference.path), 32 * 1024 * 1024); campaignAssert(bytes.length === reference.bytes && campaignHash(bytes) === reference.sha256, "ARTIFACT_INTEGRITY"); }
    if (checkpoint.finalization) campaignAssert((await boundedRead(path.join(root, "campaign-final-owner-v2.json"), 16384)).toString("utf8") === canonicalCampaignJson({ schema: "campaign-final-owner-v2", identity: checkpoint.identity.digest, runId: checkpoint.runId, completedAt: checkpoint.finalization.completedAt, artifacts: checkpoint.finalization.artifacts }), "FINAL_OWNER_MISMATCH");
  }
}
export async function readCampaignCheckpoint(boundary: CampaignStoreBoundary, expected: CampaignIdentity, tasks: readonly AgentSuccessTaskV1[]): Promise<{ checkpoint: CampaignCheckpoint | null; temporaryFiles: string[]; identityVerification: "MATCH" | "UNVERIFIABLE"; reusable: boolean }> {
  return readStoredCheckpoint(boundary, expected, tasks, false) as ReturnType<typeof readCampaignCheckpoint>;
}
export async function readCampaignCheckpointV2(boundary: CampaignStoreBoundary, expected: CampaignIdentity, tasks: readonly AgentSuccessTaskV1[]): Promise<{ checkpoint: CampaignCheckpointV2 | null; temporaryFiles: string[]; identityVerification: "MATCH" | "UNVERIFIABLE"; reusable: boolean }> {
  return readStoredCheckpoint(boundary, expected, tasks, true) as ReturnType<typeof readCampaignCheckpointV2>;
}
async function readStoredCheckpoint(boundary: CampaignStoreBoundary, expected: CampaignIdentity, tasks: readonly AgentSuccessTaskV1[], v2: boolean): Promise<{ checkpoint: StoredCheckpoint | null; temporaryFiles: string[]; identityVerification: "MATCH" | "UNVERIFIABLE"; reusable: boolean }> {
  const dir = await directory(boundary, expected, false, v2);
  if (dir === null) return { checkpoint: null, temporaryFiles: [], identityVerification: compareCampaignIdentity(expected, expected) === "MATCH" ? "MATCH" : "UNVERIFIABLE", reusable: false };
  const names = await readdir(dir); campaignAssert(names.length <= 10_000, "DATA_BOUND");
  const generations = names.filter((n) => GENERATION.test(n)).sort();
  campaignAssert(names.every((n) => GENERATION.test(n) || TEMPORARY.test(n) || ["owner.json", "writer.json"].includes(n)), "UNEXPECTED_STORE_ENTRY");
  let previous: StoredCheckpoint | null = null;
  let verification: "MATCH" | "UNVERIFIABLE" = "MATCH";
  for (let i = 0; i < generations.length; i++) {
    const name = generations[i]!;
    campaignAssert(name === generationName(i + 1), "GENERATION_GAP_OR_AMBIGUITY");
    const bytes = await boundedRead(path.join(dir, name), CAMPAIGN_CHECKPOINT_MAX_BYTES);
    let loaded: unknown; try { loaded = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("CHECKPOINT_CORRUPTION"); }
    if (v2) validateCampaignCheckpointV2(loaded, tasks); else validateCampaignCheckpoint(loaded, tasks);
    const committed = loaded as StoredCheckpoint; campaignAssert(committed.generation === i + 1, "GENERATION_MISMATCH");
    const comparison = compareCampaignIdentity(expected, committed.identity); campaignAssert(comparison !== "MISMATCH" && committed.identity.digest === expected.digest, "IDENTITY_MISMATCH"); if (comparison === "UNVERIFIABLE") verification = comparison;
    if (previous) { if (v2) validateCampaignHistoryV2(previous as CampaignCheckpointV2, committed as CampaignCheckpointV2, tasks); else validateCampaignHistory(previous as CampaignCheckpoint, committed as CampaignCheckpoint); }
    else campaignAssert(committed.parentIntegrity === null && committed.units.every((u) => u.state === "pending") && (!v2 || (committed as CampaignCheckpointV2).finalization === null), "INVALID_INITIAL_HISTORY");
    await verifyArtifacts(boundary, committed); previous = committed;
  }
  if (previous) durableCheckpoints.set(previous, await resolvePhysicalPath(boundary.outputRoot));
  return { checkpoint: previous, temporaryFiles: names.filter((n) => TEMPORARY.test(n)).sort(), identityVerification: verification, reusable: previous !== null && verification === "MATCH" };
}

/** Hooks are failure-only seams; no filesystem operation or validation can be replaced. */
export async function writeCampaignCheckpoint(boundary: CampaignStoreBoundary, checkpoint: CampaignCheckpoint, tasks: readonly AgentSuccessTaskV1[], failureHook?: (phase: "temporary-opened" | "temporary-written" | "before-publication" | "published") => void | Promise<void>, dispatch?: CampaignDispatchOwnership): Promise<void> {
  return writeStoredCheckpoint(boundary, checkpoint, tasks, failureHook, dispatch);
}
export async function writeCampaignCheckpointV2(boundary: CampaignStoreBoundary, checkpoint: CampaignCheckpointV2, tasks: readonly AgentSuccessTaskV1[], failureHook?: (phase: "temporary-opened" | "temporary-written" | "before-publication" | "published") => void | Promise<void>, dispatch?: CampaignDispatchOwnership): Promise<void> {
  return writeStoredCheckpoint(boundary, checkpoint, tasks, failureHook, dispatch);
}
async function writeStoredCheckpoint(boundary: CampaignStoreBoundary, checkpoint: StoredCheckpoint, tasks: readonly AgentSuccessTaskV1[], failureHook?: (phase: "temporary-opened" | "temporary-written" | "before-publication" | "published") => void | Promise<void>, dispatch?: CampaignDispatchOwnership): Promise<void> {
  const v2 = checkpoint.schemaVersion === CAMPAIGN_CHECKPOINT_SCHEMA_V2;
  if (v2) validateCampaignCheckpointV2(checkpoint, tasks); else validateCampaignCheckpoint(checkpoint, tasks);
  await assertDispatchWriter(boundary, checkpoint.identity, dispatch);
  const dir = await directory(boundary, checkpoint.identity, true, v2); campaignAssert(dir !== null);
  const writer = path.join(dir, "writer.json");
  let lock; try { lock = await open(writer, "wx"); } catch { throw new Error("WRITER_OWNERSHIP_CONFLICT"); }
  const token = randomUUID(); let published = false;
  try {
    await lock.writeFile(token); await lock.sync(); await lock.close();
    await assertDispatchWriter(boundary, checkpoint.identity, dispatch);
    const current = await readStoredCheckpoint(boundary, checkpoint.identity, tasks, v2);
    if (current.checkpoint) { if (v2) validateCampaignHistoryV2(current.checkpoint as CampaignCheckpointV2, checkpoint as CampaignCheckpointV2, tasks); else validateCampaignHistory(current.checkpoint as CampaignCheckpoint, checkpoint as CampaignCheckpoint); }
    else campaignAssert(checkpoint.generation === 1 && checkpoint.parentIntegrity === null && checkpoint.units.every((u) => u.state === "pending") && (!v2 || (checkpoint as CampaignCheckpointV2).finalization === null), "INVALID_INITIAL_HISTORY");
    await verifyArtifacts(boundary, checkpoint);
    const temp = path.join(dir, `.temporary-${randomUUID()}.json`);
    const h = await open(temp, "wx");
    try { await failureHook?.("temporary-opened"); await h.writeFile(`${canonicalCampaignJson(checkpoint)}\n`); await failureHook?.("temporary-written"); await h.sync(); } finally { await h.close(); }
    await plainAncestors(dir); await failureHook?.("before-publication");
    await assertDispatchWriter(boundary, checkpoint.identity, dispatch);
    await verifyArtifacts(boundary, checkpoint);
    const target = path.join(dir, generationName(checkpoint.generation));
    // Same-filesystem hard-link publication creates a previously absent name; it cannot replace an existing name.
    await link(temp, target); published = true; await failureHook?.("published");
    const observed = await boundedRead(target, CAMPAIGN_CHECKPOINT_MAX_BYTES);
    campaignAssert(observed.toString("utf8") === `${canonicalCampaignJson(checkpoint)}\n`, "PUBLICATION_INTEGRITY");
    await verifyArtifacts(boundary, checkpoint);
    await unlink(temp);
    campaignAssert((await boundedRead(writer, 100)).toString("utf8") === token, "WRITER_OWNERSHIP_CHANGED");
    await unlink(writer);
    durableCheckpoints.set(checkpoint, await resolvePhysicalPath(boundary.outputRoot));
  } catch (e) {
    await lock.close().catch(() => undefined);
    if (!published) { campaignAssert((await boundedRead(writer, 100)).toString("utf8") === token, "WRITER_OWNERSHIP_CHANGED"); await unlink(writer); }
    // A post-publication failure leaves the ownership marker and committed generation for explicit recovery.
    throw e;
  }
}

/** Process-local capability plus an exclusive, durable output-root marker. No stale-marker recovery. */
export type CampaignDispatchOwnership = { readonly identityDigest: string };
const dispatches = new WeakMap<CampaignDispatchOwnership, { root: string; token: string; dev: number; ino: number }>();
const DISPATCH_MARKER = "campaign-dispatch.json";

export async function acquireCampaignDispatch(boundary: CampaignStoreBoundary, identity: CampaignIdentity): Promise<CampaignDispatchOwnership> {
  validateCampaignIdentity(identity);
  campaignAssert(compareCampaignIdentity(identity, identity) === "MATCH", "IDENTITY_UNVERIFIABLE");
  const root = await validateRoot(boundary);
  const marker = path.join(root, DISPATCH_MARKER);
  const token = canonicalCampaignJson({ schema: "campaign-dispatch-v1", identity: identity.digest, token: randomUUID() });
  let handle;
  try { handle = await open(marker, "wx"); } catch { throw new Error("DISPATCH_OWNERSHIP_CONFLICT"); }
  // A failed acquisition leaves an uncertain marker; it is never silently stolen.
  try {
    await handle.writeFile(token); await handle.sync();
    const stat = await handle.stat();
    const ownership = Object.freeze({ identityDigest: identity.digest });
    dispatches.set(ownership, { root: await resolvePhysicalPath(root), token, dev: stat.dev, ino: stat.ino });
    // An already active checkpoint publication cannot become a campaign dispatch.
    for (const v2 of [false, true]) {
      const dir = await directory(boundary, identity, false, v2);
      if (dir) {
        try { await lstat(path.join(dir, "writer.json")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        throw new Error("WRITER_OWNERSHIP_CONFLICT");
      }
    }
    return ownership;
  } finally { await handle.close(); }
}

export async function assertCampaignDispatch(boundary: CampaignStoreBoundary, identity: CampaignIdentity, ownership: CampaignDispatchOwnership): Promise<void> {
  const owner = dispatches.get(ownership);
  campaignAssert(owner && samePhysicalPath(owner.root, await resolvePhysicalPath(await validateRoot(boundary))) && ownership.identityDigest === identity.digest, "DISPATCH_OWNER_INVALID");
  const marker = path.join(owner.root, DISPATCH_MARKER);
  const stat = await lstat(marker);
  campaignAssert(stat.dev === owner.dev && stat.ino === owner.ino && (await boundedRead(marker, 1024)).toString("utf8") === owner.token, "DISPATCH_OWNER_CHANGED");
}

async function assertDispatchWriter(boundary: CampaignStoreBoundary, identity: CampaignIdentity, ownership?: CampaignDispatchOwnership): Promise<void> {
  const root = await validateRoot(boundary);
  if (ownership) return assertCampaignDispatch(boundary, identity, ownership);
  try { await lstat(path.join(root, DISPATCH_MARKER)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new Error("DISPATCH_OWNERSHIP_REQUIRED");
}

export async function releaseCampaignDispatch(boundary: CampaignStoreBoundary, identity: CampaignIdentity, ownership: CampaignDispatchOwnership): Promise<void> {
  await assertCampaignDispatch(boundary, identity, ownership);
  await unlink(path.join(boundary.outputRoot, DISPATCH_MARKER));
  dispatches.delete(ownership);
}

async function ensurePlainDirectory(root: string, relative: string): Promise<string> {
  let current = root;
  for (const segment of relative.split("/")) {
    current = resolveWithinRoot(current, segment);
    try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    await plainAncestors(current);
  }
  return current;
}

/** Verify safe, absent provider output before handing its path to the established provider runner. */
export async function prepareCampaignProviderOutput(boundary: CampaignStoreBoundary, identity: CampaignIdentity, ownership: CampaignDispatchOwnership, relative: string): Promise<void> {
  await assertCampaignDispatch(boundary, identity, ownership);
  validateCampaignRelativePath(relative);
  const root = await validateRoot(boundary);
  await ensurePlainDirectory(root, path.posix.dirname(relative));
  try { await lstat(resolveWithinRoot(root, relative)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new Error("ARTIFACT_COLLISION");
}

/** New files only. Existing files require a verified committed reference and identical bytes. */
export async function persistCampaignArtifact(boundary: CampaignStoreBoundary, identity: CampaignIdentity, ownership: CampaignDispatchOwnership, relative: string, content: string, committed?: StoredCheckpoint): Promise<void> {
  await assertCampaignDispatch(boundary, identity, ownership);
  validateCampaignRelativePath(relative);
  const root = await validateRoot(boundary);
  const bytes = Buffer.from(content, "utf8"); campaignAssert(bytes.length <= 32 * 1024 * 1024, "DATA_BOUND");
  await ensurePlainDirectory(root, path.posix.dirname(relative));
  const target = resolveWithinRoot(root, relative);
  let handle;
  try { handle = await open(target, "wx"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    campaignAssert(committed?.identity.digest === identity.digest, "ARTIFACT_COLLISION");
    const durableRoot = durableCheckpoints.get(committed);
    campaignAssert(durableRoot !== undefined && samePhysicalPath(durableRoot, await resolvePhysicalPath(root)), "ARTIFACT_OWNER_UNVERIFIED");
    const dir = await directory(boundary, identity, false, committed.schemaVersion === CAMPAIGN_CHECKPOINT_SCHEMA_V2); campaignAssert(dir !== null, "ARTIFACT_OWNER_UNVERIFIED");
    const published = await boundedRead(path.join(dir, generationName(committed.generation)), CAMPAIGN_CHECKPOINT_MAX_BYTES);
    campaignAssert(published.toString("utf8") === `${canonicalCampaignJson(committed)}\n`, "ARTIFACT_OWNER_UNVERIFIED");
    const reference = [...committed.units.flatMap((u) => u.completion?.artifacts ?? []), ...(committed.schemaVersion === CAMPAIGN_CHECKPOINT_SCHEMA_V2 ? committed.finalization?.artifacts ?? [] : [])].find((a) => a.path === relative);
    campaignAssert(reference && reference.bytes === bytes.length && reference.sha256 === campaignHash(bytes), "ARTIFACT_COLLISION");
    const observed = await boundedRead(await safeFile(root, relative), 32 * 1024 * 1024);
    campaignAssert(observed.equals(bytes), "ARTIFACT_COLLISION");
    return;
  }
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  campaignAssert((await boundedRead(await safeFile(root, relative), 32 * 1024 * 1024)).equals(bytes), "ARTIFACT_INTEGRITY");
}

export async function persistCampaignSupportingArtifacts(boundary: CampaignStoreBoundary, identity: CampaignIdentity, ownership: CampaignDispatchOwnership, task: AgentSuccessTaskV1, result: import("./executionTypes.js").AgentSuccessTreatmentResult, epoch?: CampaignEpoch): Promise<void> {
  const expected = requiredCampaignArtifacts(result.evidence, task, epoch !== undefined);
  const files = [...result.contextFiles, ...result.patchFiles];
  campaignAssert(new Set(files.map((f) => f.relativePath)).size === files.length, "ARTIFACT_REFERENCE_MISMATCH");
  campaignAssert(canonicalCampaignJson(files.map((f) => f.relativePath).sort()) === canonicalCampaignJson(expected.filter((r) => r.kind !== "provider").map((r) => r.path).sort()), "ARTIFACT_REFERENCE_MISMATCH");
  for (const attempt of result.evidence.attempts?.map((a) => a.evidence) ?? [result.evidence]) {
    const proposed = files.find((f) => f.relativePath === attempt.proposedPatchPath);
    if (epoch && attempt.proposedPatchPath === null) campaignAssert(!attempt.patch.attempted && attempt.patch.proposedPatchBytes === 0, "ARTIFACT_SIZE_MISMATCH");
    else campaignAssert(proposed && Buffer.byteLength(proposed.content, "utf8") === attempt.patch.proposedPatchBytes, "ARTIFACT_SIZE_MISMATCH");
    if (attempt.realAgent && attempt.realAgent.context.contextArtifactPath !== null) {
      const context = files.find((f) => f.relativePath === attempt.realAgent!.context.contextArtifactPath);
      campaignAssert(context && context.content.length === attempt.realAgent.context.contextChars, "ARTIFACT_SIZE_MISMATCH");
    }
  }
  if (epoch) await verifyEpochDirectory(boundary, identity, epoch);
  const scoped = (relative: string) => epoch ? `${epoch.namespace}/${relative}` : relative;
  for (const file of files) await persistCampaignArtifact(boundary, identity, ownership, scoped(file.relativePath), file.content);
  // Provider artifacts were produced by the existing runner. Prove containment and flush before completion.
  for (const reference of expected.filter((r) => r.kind === "provider")) {
    await assertCampaignDispatch(boundary, identity, ownership);
    const target = await safeFile(await validateRoot(boundary), scoped(reference.path));
    await boundedRead(target, 32 * 1024 * 1024);
    const handle = await open(target, "r+"); try { await handle.sync(); } finally { await handle.close(); }
  }
}

function epochOwner(identity: CampaignIdentity, epoch: CampaignEpoch): string {
  return canonicalCampaignJson({ schema: "campaign-epoch-owner-v1", identity: identity.digest, caseId: epoch.caseId, treatmentId: epoch.treatmentId, ordinal: epoch.ordinal, epoch: epoch.id, parentRevision: epoch.parentRevision, namespace: epoch.namespace });
}
async function verifyEpochDirectory(boundary: CampaignStoreBoundary, identity: CampaignIdentity, epoch: CampaignEpoch): Promise<string> {
  const root = await validateRoot(boundary); validateCampaignRelativePath(epoch.namespace);
  const target = resolveWithinRoot(root, epoch.namespace); await plainAncestors(target);
  campaignAssert((await boundedRead(path.join(target, "owner.json"), 1024)).toString("utf8") === epochOwner(identity, epoch), "EPOCH_OWNER_UNVERIFIED");
  return target;
}
/** Allocation is exclusive. A failed reservation leaves owned evidence, never a reusable invocation. */
export async function allocateCampaignEpoch(boundary: CampaignStoreBoundary, identity: CampaignIdentity, ownership: CampaignDispatchOwnership, epoch: CampaignEpoch): Promise<string> {
  await assertCampaignDispatch(boundary, identity, ownership); validateCampaignRelativePath(epoch.namespace);
  const root = await validateRoot(boundary);
  const parent = await ensurePlainDirectory(root, path.posix.dirname(epoch.namespace));
  const target = resolveWithinRoot(parent, path.posix.basename(epoch.namespace));
  await mkdir(target); await plainAncestors(target);
  const handle = await open(path.join(target, "owner.json"), "wx");
  try { await handle.writeFile(epochOwner(identity, epoch)); await handle.sync(); } finally { await handle.close(); }
  return verifyEpochDirectory(boundary, identity, epoch);
}
export async function prepareCampaignEpochTerminal(boundary: CampaignStoreBoundary, identity: CampaignIdentity, task: AgentSuccessTaskV1, epoch: CampaignEpoch, source: AgentSuccessTreatmentEvidenceV1, reason: NonNullable<CampaignEpoch["terminal"]>["reason"]): Promise<NonNullable<CampaignEpoch["terminal"]>> {
  await verifyEpochDirectory(boundary, identity, epoch);
  const local = projectCampaignTreatmentEvidence(source); const root = await validateRoot(boundary);
  const artifacts = [];
  for (const reference of requiredCampaignArtifacts(local, task, reason !== "evaluated")) {
    const relative = `${epoch.namespace}/${reference.path}`;
    const bytes = await boundedRead(await safeFile(root, relative), 32 * 1024 * 1024);
    artifacts.push({ ...reference, path: relative, sha256: campaignHash(bytes), bytes: bytes.length });
  }
  return { reason, outcome: local.realAgent?.providerStatus ?? "not-invoked", evidence: mapCampaignEpochEvidence(local, epoch.namespace, "prefix"), artifacts };
}

/** An immutable owned publication intent permits safe recovery of a partially written final family. */
export async function publishCampaignFinalArtifacts(boundary: CampaignStoreBoundary, identity: CampaignIdentity, ownership: CampaignDispatchOwnership, targets: Array<{ relativePath: string; content: string }>, runId: string, completedAt: string): Promise<NonNullable<CampaignCheckpointV2["finalization"]>> {
  await assertCampaignDispatch(boundary, identity, ownership);
  const root = await validateRoot(boundary);
  const artifacts = targets.map(t => ({ path: t.relativePath, kind: "provider" as const, sha256: campaignHash(t.content), bytes: Buffer.byteLength(t.content) })).sort((a, b) => a.path < b.path ? -1 : 1);
  const owner = canonicalCampaignJson({ schema: "campaign-final-owner-v2", identity: identity.digest, runId, completedAt, artifacts });
  const marker = path.join(root, "campaign-final-owner-v2.json");
  try { await lstat(marker); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    for (const target of targets) {
      validateCampaignRelativePath(target.relativePath);
      try { await lstat(resolveWithinRoot(root, target.relativePath)); throw new Error("ARTIFACT_COLLISION"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    }
    const handle = await open(marker, "wx"); try { await handle.writeFile(owner); await handle.sync(); } finally { await handle.close(); }
  }
  campaignAssert((await boundedRead(marker, 16384)).toString("utf8") === owner, "FINAL_OWNER_MISMATCH");
  await writeAgentSuccessRateArtifactTargets(targets.map(t => ({ filePath: resolveWithinRoot(root, t.relativePath), content: t.content })), {
    ensureDirectory: async () => {},
    exists: async file => { try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } },
    writeFile: (file, content) => persistCampaignArtifact(boundary, identity, ownership, path.relative(root, file).replace(/\\/g, "/"), content),
    removeFile: async () => {}
  }, async target => {
    await assertCampaignDispatch(boundary, identity, ownership);
    campaignAssert((await boundedRead(marker, 16384)).toString("utf8") === owner, "FINAL_OWNER_MISMATCH");
    const bytes = await boundedRead(await safeFile(root, path.relative(root, target.filePath).replace(/\\/g, "/")), 32 * 1024 * 1024);
    campaignAssert(bytes.equals(Buffer.from(target.content)), "ARTIFACT_INTEGRITY"); return true;
  });
  return { completedAt, artifacts };
}
