import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { campaignAssert, campaignHash, canonicalCampaignJson } from "../../experiments/plugins/agentSuccessRate/campaignIdentity.js";
import { validateCampaignOutputPath, type CampaignStoreBoundary } from "../../experiments/plugins/agentSuccessRate/campaignCheckpointStore.js";
import type { ValidatedCampaignProgress } from "../../experiments/plugins/agentSuccessRate/campaignProgress.js";
import { readCampaignProgressScientificFamily } from "../../experiments/plugins/agentSuccessRate/campaignProgress.js";
import { resolvePhysicalPath } from "../../evaluation/benchmarkSandbox/pathPolicy.js";
import { agentSuccessRatePlugin, mapAgentSuccessRateToRun } from "../../experiments/plugins/agentSuccessRate/plugin.js";
import { writePluginExperimentReports } from "./writePluginExperimentReports.js";
import { buildPluginExperimentReport } from "./buildPluginExperimentReport.js";
import { renderPluginExperimentReportText } from "./renderPluginExperimentReportText.js";
import { renderPluginExperimentReportHtml } from "./renderPluginExperimentReportHtml.js";
import { buildAgentSuccessCampaignProgressReport } from "./buildAgentSuccessCampaignProgressReport.js";
import { renderAgentSuccessCampaignProgressText } from "./renderAgentSuccessCampaignProgressText.js";
import { renderAgentSuccessCampaignProgressHtml } from "./renderAgentSuccessCampaignProgressHtml.js";

async function plain(p: string, kind: "file" | "directory") {
  const s = await lstat(p);
  campaignAssert(!s.isSymbolicLink() && (kind === "file" ? s.isFile() : s.isDirectory()) && path.resolve(await realpath(p)) === path.resolve(p), "PROGRESS_UNSAFE_PATH");
}
async function writeExclusive(p: string, content: string) {
  const h = await open(p, "wx"); try { await h.writeFile(content, "utf8"); await h.sync(); } finally { await h.close(); }
}
async function readExpected(p: string, expected: string, code: string) {
  await plain(p, "file");
  const length = Buffer.byteLength(expected); campaignAssert(length <= 64 * 1024 * 1024, "PROGRESS_DATA_BOUND");
  const h = await open(p, "r");
  try {
    const before = await h.stat(); campaignAssert(before.isFile() && before.size === length, code);
    const buffer = Buffer.alloc(length + 1); let size = 0;
    for (;;) { const n = await h.read(buffer, size, buffer.length - size, size); size += n.bytesRead; if (!n.bytesRead || size === buffer.length) break; }
    campaignAssert(size === length && (await h.stat()).size === length && buffer.subarray(0, size).toString("utf8") === expected, code);
  } finally { await h.close(); }
}
async function owned(parent: string, name: string, owner: string) {
  const p = path.join(parent, name); let created = false;
  try { await mkdir(p); created = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  await plain(p, "directory");
  if (created) await writeExclusive(path.join(p, "owner.json"), owner);
  await readExpected(path.join(p, "owner.json"), owner, "PROGRESS_OWNER_MISMATCH"); return p;
}
/** Revision-specific files are exclusive. The manifest is published last and verified before returning success. */
export async function writeAgentSuccessCampaignProgressReport(args: {
  snapshot: ValidatedCampaignProgress; boundary: CampaignStoreBoundary;
  failureHook?: (phase: "json-written" | "text-written" | "html-written" | "before-manifest") => void | Promise<void>;
}) {
  const model = buildAgentSuccessCampaignProgressReport(args.snapshot, args.boundary);
  await validateCampaignOutputPath(args.boundary);
  // The checkpoint store has already validated this output root. Use the same physical identity for
  // publication: a legitimate OS alias (for example macOS /var -> /private/var) is not a redirect
  // created inside the campaign tree, and comparing it to the lexical spelling rejects valid roots.
  const root = await resolvePhysicalPath(args.boundary.outputRoot); await plain(root, "directory");
  const family = await owned(root, "campaign-progress-v1", "agent-success-rate-campaign-progress-v1");
  const identity = await owned(family, model.campaignIdentity, `agent-success-rate-campaign-progress-v1:${model.campaignIdentity}`);
  // Ownership blockers can change without a checkpoint transition. Keep both projections immutable at that revision.
  const modelDigest = campaignHash(canonicalCampaignJson(model));
  const revision = `revision-${String(model.checkpointGeneration).padStart(10, "0")}-${model.checkpointRevision}-${modelDigest.slice(0, 16)}`;
  const outDir = path.join(identity, revision);
  const scientific = model.state === "complete" ? await readCampaignProgressScientificFamily(args.snapshot, args.boundary) : null;
  const run = scientific ? mapAgentSuccessRateToRun({ runId: scientific.execution.runId, startedAt: scientific.execution.startedAt, completedAt: scientific.execution.completedAt,
    target: { kind: "self", targetRoot: "[redacted]", toolRoot: "[redacted]", packageName: "@dailephd/my-dev-kit-lab", packageVersion: "0.9.0", hasPackageJson: true, hasLockfile: true, branch: null, commit: null, hasGit: false, isSelf: true },
    caseEvidence: scientific.execution.cases.map(c => ({ ...c, caseName: c.caseId })), analysis: scientific.analysis.analysis, patchArtifactPaths: [],
    providerId: scientific.execution.realAgent?.providerId, ...(scientific.execution.realAgent ? { realSettings: { timeoutMs: scientific.execution.realAgent.timeoutMs, repairAttempts: scientific.execution.realAgent.repairAttempts ?? 0 } } : {}) }) : null;
  if (run) Object.assign(run, { agentSuccessCampaignProgress: model });
  const files = [
    { name: "agent-success-rate-campaign-progress.json", content: `${JSON.stringify(model, null, 2)}\n`, phase: "json-written" as const },
    { name: "agent-success-rate-campaign-progress.txt", content: renderAgentSuccessCampaignProgressText(model), phase: "text-written" as const },
    { name: "agent-success-rate-campaign-progress.html", content: renderAgentSuccessCampaignProgressHtml(model), phase: "html-written" as const }
  ];
  if (run) {
    const built = buildPluginExperimentReport({ run, plugin: agentSuccessRatePlugin.metadata, outputRoot: outDir, generatedAt: run.completedAt });
    const report = { ...built, metadata: { ...built.metadata, outputRoot: "[redacted]" } };
    files.push(
      { name: "report.json", content: `${JSON.stringify({ report, outputPaths: { outDir: "[redacted]", jsonPath: "report.json", htmlPath: "report.html", textPath: "report.txt" } }, null, 2)}\n`, phase: "json-written" },
      { name: "report.txt", content: renderPluginExperimentReportText(report), phase: "text-written" },
      { name: "report.html", content: renderPluginExperimentReportHtml(report), phase: "html-written" }
    );
  }
  const marker = canonicalCampaignJson({ schemaVersion: "agent-success-rate-campaign-progress-publication-v1", campaignIdentity: model.campaignIdentity, checkpointGeneration: model.checkpointGeneration, checkpointRevision: model.checkpointRevision, modelDigest, files: files.map(f => ({ name: f.name, sha256: campaignHash(f.content), bytes: Buffer.byteLength(f.content) })) });
  let created = false;
  try { await mkdir(outDir); created = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  await plain(outDir, "directory");
  if (created) {
    for (const file of files.slice(0, 3)) { await writeExclusive(path.join(outDir, file.name), file.content); await args.failureHook?.(file.phase); }
    // Exclusive directory reservation owns these ordinary report names; the existing writer remains their owner.
    if (run) await writePluginExperimentReports({ run, plugin: agentSuccessRatePlugin.metadata, outputRoot: outDir, generatedAt: run.completedAt, redactOutputRoot: true, exclusive: true });
    for (const f of files) await readExpected(path.join(outDir, f.name), f.content, "PROGRESS_SNAPSHOT_INTEGRITY");
    // The legacy writer owns report rendering. Flush its campaign-only output before committing the group marker.
    for (const f of files.slice(3)) { const h = await open(path.join(outDir, f.name), "r+"); try { await h.sync(); } finally { await h.close(); } }
    await args.failureHook?.("before-manifest"); await writeExclusive(path.join(outDir, "manifest.json"), marker);
  }
  campaignAssert((await readdir(outDir)).sort().join(",") === [...files.map(f => f.name), "manifest.json"].sort().join(","), "PROGRESS_INCOMPLETE_OR_UNKNOWN_SNAPSHOT");
  await readExpected(path.join(outDir, "manifest.json"), marker, "PROGRESS_SNAPSHOT_COLLISION");
  for (const f of files) await readExpected(path.join(outDir, f.name), f.content, "PROGRESS_SNAPSHOT_INTEGRITY");
  return { model, outputPaths: { outDir, jsonPath: path.join(outDir, files[0]!.name), textPath: path.join(outDir, files[1]!.name), htmlPath: path.join(outDir, files[2]!.name), manifestPath: path.join(outDir, "manifest.json") } };
}
