import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { TUTORIAL_MANIFEST_SCHEMA_VERSION, type TutorialManifestV1 } from "../tutorial/tutorialManifest.js";
import { looksLikeUrl, outputRelativePath, verifyArtifactFile, type GalleryMediaKind } from "./galleryPathSafety.js";
import type { GalleryManifestItem, GalleryManifestItemStatus, GalleryManifestMetric } from "./types.js";

// Trusted, read-only artifact-family readers for `gallery build --source`. Each reader recognizes a family
// from an existing producer schema/signature, reads only the bounded metadata needed to identify and display
// it, and never executes artifact content. Gallery items only ever carry statuses the producer recorded.

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const TUTORIAL_MANIFEST_RELATIVE = "artifacts/tutorial-manifest.json";
const SUPPORTED_AUDIT_SCHEMA = "1.0";
const SUPPORTED_SECURITY_SCHEMA = 1;
const PROMPT_COMPARISON_SCHEMA = "prompt-template-comparison/1.0.0";

type Family =
  | "controlled-experiment"
  | "plugin-experiment-report"
  | "warm-index-campaign"
  | "audit-report"
  | "security-validation-report"
  | "android-validation-report"
  | "tutorial-run"
  | "prompt-template-comparison";

type Json = Record<string, unknown>;
type Found = { family: Family; file: string; root: string; data: Json };

export type ReadGallerySourcesResult = { items: GalleryManifestItem[] };

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function bounded(value: string, limit = 300): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
}
function itemId(family: Family, identity: string, file: string): string {
  return `${family}-${slug(identity)}-${createHash("sha256").update(file).digest("hex").slice(0, 8)}`;
}

async function readJson(file: string, label: string): Promise<Json> {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch (error) {
    throw new Error(`Gallery source ${label}: cannot read ${path.basename(file)} (${error instanceof Error ? error.message : String(error)}).`);
  }
  if (size > MAX_JSON_BYTES) throw new Error(`Gallery source ${label}: ${path.basename(file)} exceeds the ${MAX_JSON_BYTES}-byte limit.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`Gallery source ${label}: ${path.basename(file)} is not valid JSON.`);
  }
  if (!isObject(parsed)) throw new Error(`Gallery source ${label}: ${path.basename(file)} is not a JSON object.`);
  return parsed;
}

/** Signature tests against existing producer schemas. More than one match is an ambiguity error. */
function matchingFamilies(data: Json): Family[] {
  const matches: Family[] = [];
  const plugin = data.plugin;
  const metadata = data.metadata;
  if (isObject(data.scenario) && isObject(data.run) && Array.isArray(data.steps) && Array.isArray(data.artifacts)) {
    matches.push("tutorial-run");
  }
  if (isObject(plugin) && str(plugin.id) !== null && isObject(metadata) && str(metadata.runId) !== null && Array.isArray(data.variants)) {
    const warm = isObject(data.warmIndexReuse) && isObject((data.warmIndexReuse as Json).agentCampaign);
    matches.push(warm ? "warm-index-campaign" : "plugin-experiment-report");
  }
  if (isObject(metadata) && metadata.reportType === "code-rot-audit" && str(data.schemaVersion) !== null) matches.push("audit-report");
  if (Array.isArray(data.checks) && Array.isArray(data.findings) && isObject(data.summary) && str(data.verdict) !== null) {
    matches.push("security-validation-report");
  }
  if (str(data.executiveSummary) !== null && isObject(data.androidProjectSummary) && str(data.verdict) !== null) {
    matches.push("android-validation-report");
  }
  if (num(data.totalRuns) !== null && num(data.completedRuns) !== null && Array.isArray(data.strategies)) matches.push("controlled-experiment");
  if (typeof data.schemaVersion === "string" && data.schemaVersion.startsWith("prompt-template-comparison/")) matches.push("prompt-template-comparison");
  return matches;
}

function classify(data: Json, label: string, file: string): Family | null {
  const matches = matchingFamilies(data);
  if (matches.length > 1) {
    throw new Error(
      `Gallery source ${label}: ${path.basename(file)} matches more than one artifact family (${matches.join(", ")}); refusing ambiguous recognition.`
    );
  }
  return matches[0] ?? null;
}

const KNOWN_NAME =
  /(^code-rot-audit\.json$|^experiment-summary\.json$|-android-security-validation\.json$|-security-validation\.json$|^report\.json$|^tutorial-manifest\.json$|^prompt-template-comparison\.json$)/;

async function collect(sourceArg: string): Promise<Found[]> {
  const label = sourceArg;
  let real: string;
  try {
    real = await realpath(sourceArg);
  } catch {
    throw new Error(`Gallery source ${label} does not exist or is unreadable.`);
  }
  const info = await stat(real);
  const found: Found[] = [];
  const addFile = async (file: string, root: string, explicit: boolean): Promise<void> => {
    const data = await readJson(file, label);
    // The canonical tutorial manifest is recognized by its fixed name so a malformed one gets a specific error.
    const family: Family | null = path.basename(file) === "tutorial-manifest.json" ? "tutorial-run" : classify(data, label, file);
    if (family === null) {
      // A generic report.json that is not a plugin report is simply not ours; a named family file must match.
      if (!explicit && path.basename(file) === "report.json") return;
      throw new Error(`Gallery source ${label}: ${path.basename(file)} is not a recognized or valid artifact family document.`);
    }
    found.push({ family, file, root, data });
  };

  if (info.isFile()) {
    const name = path.basename(real);
    if (!KNOWN_NAME.test(name)) throw new Error(`Gallery source ${label}: unsupported source type (${name}).`);
    let root = path.dirname(real);
    if (name === "tutorial-manifest.json") {
      if (path.basename(root) !== "artifacts") {
        throw new Error(`Gallery source ${label}: a tutorial manifest must be <run-root>/artifacts/tutorial-manifest.json.`);
      }
      root = path.dirname(root);
    }
    await addFile(real, root, true);
    return found;
  }
  if (!info.isDirectory()) throw new Error(`Gallery source ${label} is neither a file nor a directory.`);

  const tutorialManifest = path.join(real, ...TUTORIAL_MANIFEST_RELATIVE.split("/"));
  let hasTutorial = false;
  try {
    hasTutorial = (await stat(tutorialManifest)).isFile();
  } catch {
    hasTutorial = false;
  }
  if (hasTutorial) await addFile(tutorialManifest, real, true);
  const names = (await readdir(real)).filter((name) => name !== "tutorial-manifest.json" && KNOWN_NAME.test(name)).sort();
  for (const name of names) {
    const file = path.join(real, name);
    if ((await stat(file)).isFile()) await addFile(file, real, false);
  }
  if (found.length === 0) {
    throw new Error(`Gallery source ${label}: no supported artifact family was recognized at this root.`);
  }
  return found;
}

async function linkIfPresent(root: string, realOutDir: string, name: string, kind: GalleryMediaKind): Promise<string | null> {
  const verified = await verifyArtifactFile(root, name, kind);
  return verified.ok ? outputRelativePath(realOutDir, verified.absolutePath) : null;
}

async function readPluginFamily(found: Found, realOutDir: string): Promise<GalleryManifestItem> {
  const json = outputRelativePath(realOutDir, found.file);
  if (json === null) throw new Error("Gallery source report has no relative link from the gallery directory.");
  const html = await linkIfPresent(found.root, realOutDir, "report.html", "text");
  const text = await linkIfPresent(found.root, realOutDir, "report.txt", "text");
  const execution = await linkIfPresent(found.root, realOutDir, "warm-index-execution.json", "json");
  const plugin = found.data.plugin as Json;
  const metadata = found.data.metadata as Json;
  const target = isObject(found.data.target) ? found.data.target : {};
  const runStatus = str(metadata.status) ?? "unknown";
  const status: GalleryManifestItemStatus = runStatus === "completed" ? "pass" : runStatus === "skipped" ? "skipped" : "warning";
  const warnings: string[] = [];
  if (status === "warning") warnings.push(`Experiment run status is ${runStatus}.`);
  if (html === null) warnings.push("HTML report unavailable: report.html was not found at the source root.");
  const metrics: GalleryManifestMetric[] = [{ id: "run-status", label: "Run status", value: runStatus }];
  if (Array.isArray(found.data.metrics)) metrics.push({ id: "metric-count", label: "Metric count", value: found.data.metrics.length });
  const campaign = found.family === "warm-index-campaign";
  const tags = [campaign ? "warm-index-campaign" : "experiment-report"];
  if (target.privacyProjection === "external-local-redacted") tags.push("external-local-redacted");
  const artifactPaths = [text, execution].filter((value): value is string => value !== null);
  return {
    id: itemId(found.family, str(metadata.runId) as string, found.file),
    title: `${str(plugin.name) ?? str(plugin.id)} report`,
    description: `Plugin experiment report for run ${str(metadata.runId)} (plugin ${str(plugin.id)}).`,
    kind: campaign ? "warm-index-campaign-report" : "plugin-experiment-report",
    status,
    htmlPath: html ?? "",
    summaryPath: json,
    ...(artifactPaths.length > 0 ? { artifactPaths } : {}),
    sourceFamily: found.family,
    sourceId: `${str(plugin.id)}/${str(metadata.runId)}`,
    tags,
    metrics,
    warnings
  };
}

function simpleItem(
  found: Found,
  realOutDir: string,
  fields: { identity: string; title: string; description: string; kind: string; status: GalleryManifestItemStatus; tags: string[]; metrics: GalleryManifestMetric[]; warnings: string[] }
): GalleryManifestItem {
  const summary = outputRelativePath(realOutDir, found.file);
  if (summary === null) throw new Error(`Gallery source ${path.basename(found.file)} has no relative link from the gallery directory.`);
  const { identity, ...rest } = fields;
  return { ...rest, id: itemId(found.family, identity, found.file), htmlPath: "", summaryPath: summary, sourceFamily: found.family, sourceId: identity };
}

function readAudit(found: Found, realOutDir: string): GalleryManifestItem {
  const data = found.data;
  if (data.schemaVersion !== SUPPORTED_AUDIT_SCHEMA) {
    throw new Error(`Gallery source ${path.basename(found.file)}: unsupported audit report schemaVersion ${JSON.stringify(data.schemaVersion)}.`);
  }
  const exit = isObject(data.exit) ? data.exit : null;
  const summary = isObject(data.summary) ? data.summary : {};
  const metadata = data.metadata as Json;
  const breached = exit?.failOnBreached;
  const warnings: string[] = [];
  let status: GalleryManifestItemStatus = "pass";
  if (exit === null || typeof breached !== "boolean") {
    status = "warning";
    warnings.push("Audit exit status is not recorded in this report.");
  } else if (breached) {
    status = "warning";
    warnings.push("The audit fail-on threshold was breached.");
  }
  const metrics: GalleryManifestMetric[] = [];
  const total = num(summary.totalIssues);
  if (total !== null) metrics.push({ id: "total-issues", label: "Total issues", value: total });
  const label = str(exit?.finalVerdictLabel);
  if (label) metrics.push({ id: "verdict", label: "Audit verdict", value: label });
  const types = Array.isArray(metadata.auditTypes) ? (metadata.auditTypes as unknown[]).filter((t) => typeof t === "string").join(", ") : "audit";
  return simpleItem(found, realOutDir, {
    identity: `code-rot-audit/${str(metadata.generatedAt) ?? "unknown"}`,
    title: "Code-rot audit report",
    description: `Standalone audit report (${types}).`,
    kind: "audit-report",
    status,
    tags: ["audit"],
    metrics,
    warnings
  });
}

function verdictStatus(verdict: string): GalleryManifestItemStatus {
  return verdict === "ready-for-release-preparation" ? "pass" : "warning";
}

function readSecurity(found: Found, realOutDir: string): GalleryManifestItem {
  const data = found.data;
  if (data.schemaVersion !== SUPPORTED_SECURITY_SCHEMA) {
    throw new Error(`Gallery source ${path.basename(found.file)}: unsupported security report schemaVersion ${JSON.stringify(data.schemaVersion)}.`);
  }
  const verdict = str(data.verdict) as string;
  const summary = data.summary as Json;
  const metadata = isObject(data.metadata) ? data.metadata : {};
  const metrics: GalleryManifestMetric[] = [{ id: "verdict", label: "Verdict", value: verdict }];
  for (const [id, label] of [["totalChecks", "Total checks"], ["failed", "Failed checks"], ["totalFindings", "Total findings"], ["blockerFindings", "Blocker findings"]] as const) {
    const value = num(summary[id]);
    if (value !== null) metrics.push({ id, label, value });
  }
  const status = verdictStatus(verdict);
  return simpleItem(found, realOutDir, {
    identity: `${path.basename(found.file, ".json")}/${str(metadata.generatedAt) ?? "unknown"}`,
    title: "Security validation report",
    description: "Standalone security-validation report.",
    kind: "security-validation-report",
    status,
    tags: ["security"],
    metrics,
    warnings: status === "pass" ? [] : [`Security verdict is ${verdict}.`]
  });
}

function readAndroid(found: Found, realOutDir: string): GalleryManifestItem {
  const data = found.data;
  const verdict = str(data.verdict) as string;
  const status = verdictStatus(verdict);
  const metadata = isObject(data.metadata) ? data.metadata : {};
  return simpleItem(found, realOutDir, {
    identity: `${path.basename(found.file, ".json")}/${str(metadata.generatedAt) ?? "unknown"}`,
    title: "Android validation report",
    description: "Static Android/mobile validation report.",
    kind: "android-validation-report",
    status,
    tags: ["android", "security"],
    metrics: [{ id: "verdict", label: "Verdict", value: verdict }],
    warnings: status === "pass" ? [] : [`Android verdict is ${verdict}.`]
  });
}

function readExperiment(found: Found, realOutDir: string): GalleryManifestItem {
  const data = found.data;
  const completed = num(data.completedRuns) as number;
  const total = num(data.totalRuns) as number;
  const problem = ["failedRuns", "skippedRuns", "unavailableRuns", "limitReachedRuns", "timeoutRuns", "invalidOutputRuns"].reduce(
    (sum, key) => sum + (num(data[key]) ?? 0),
    0
  );
  const status: GalleryManifestItemStatus = completed === 0 ? "skipped" : problem > 0 ? "warning" : "pass";
  return simpleItem(found, realOutDir, {
    identity: `experiment/${str(data.generatedAt) ?? "unknown"}`,
    title: "Controlled experiment summary",
    description: "Controlled experiment summary read from experiment-summary.json.",
    kind: "controlled-experiment",
    status,
    tags: ["experiment"],
    metrics: [
      { id: "total-runs", label: "Total runs", value: total },
      { id: "completed-runs", label: "Completed runs", value: completed }
    ],
    warnings: status === "pass" ? [] : [`${completed} of ${total} controlled runs completed.`]
  });
}

// ---------------------------------------------------------------------------
// Prompt-template comparison (v0.9.3)
// ---------------------------------------------------------------------------

async function readPromptComparison(found: Found, realOutDir: string): Promise<GalleryManifestItem> {
  const data = found.data;
  const name = path.basename(found.file);
  if (data.schemaVersion !== PROMPT_COMPARISON_SCHEMA) {
    throw new Error(`Gallery source ${name}: unsupported prompt comparison schemaVersion ${JSON.stringify(data.schemaVersion)}.`);
  }
  const comparison = data.comparison;
  const baseline = data.baseline;
  const candidate = data.candidate;
  const cohort = data.cohort;
  const invalid = data.invalidOutput;
  const improvement = data.behavioralImprovement;
  const bad = (what: string): never => {
    throw new Error(`Gallery source ${name}: malformed prompt comparison (${what}).`);
  };
  if (!isObject(comparison) || (comparison.status !== "COMPARABLE" && comparison.status !== "INCOMPARABLE")) bad("comparison");
  if (!isObject(baseline) || !isObject(candidate)) bad("baseline/candidate");
  if (!isObject(cohort) || num((cohort as Json).matchedUnitCount) === null) bad("cohort");
  if (!isObject(invalid) || !Array.isArray((invalid as Json).strata)) bad("invalidOutput");
  if (!isObject(improvement) || (improvement.status !== "VERIFIED" && improvement.status !== "NOT_VERIFIED")) bad("behavioralImprovement");
  const comparisonObj = comparison as Json;
  const improvementObj = improvement as Json;
  const status = comparisonObj.status as string;
  const base = baseline as Json;
  const cand = candidate as Json;
  const coh = cohort as Json;
  const overall = isObject((invalid as Json).overall) ? ((invalid as Json).overall as Json) : null;
  const metrics: GalleryManifestMetric[] = [
    { id: "comparison-status", label: "Comparison status", value: status },
    { id: "baseline-template", label: "Baseline template", value: str(base.templateId) ?? "unverified" },
    { id: "candidate-template", label: "Candidate template", value: str(cand.templateId) ?? "unverified" },
    { id: "matched-units", label: "Matched units", value: num(coh.matchedUnitCount) as number },
    { id: "eligible-units", label: "Eligible matched units", value: num(coh.eligibleMatchedUnitCount) ?? 0 },
    { id: "behavioral-improvement", label: "Behavioral improvement", value: String((improvement as Json).status) }
  ];
  const rateOf = (side: unknown): number | null => (isObject(side) ? num((side as Json).ratePercent) : null);
  if (overall) {
    const b = rateOf(overall.baseline);
    const c = rateOf(overall.candidate);
    if (b !== null) metrics.push({ id: "baseline-invalid-output-rate", label: "Baseline invalid-output rate", value: Number(b.toFixed(2)), unit: "%" });
    if (c !== null) metrics.push({ id: "candidate-invalid-output-rate", label: "Candidate invalid-output rate", value: Number(c.toFixed(2)), unit: "%" });
    const diff = num(overall.percentagePointDifference);
    if (diff !== null) metrics.push({ id: "invalid-output-difference", label: "Invalid-output difference (baseline minus candidate)", value: Number(diff.toFixed(2)), unit: "pp" });
  }
  const warnings: string[] = [];
  if (status === "INCOMPARABLE") {
    const reasons = Array.isArray(comparisonObj.incomparabilityReasons) ? (comparisonObj.incomparabilityReasons as unknown[]).filter((r): r is string => typeof r === "string") : [];
    for (const reason of reasons.slice(0, 5)) warnings.push(`Incomparable: ${bounded(reason)}`);
    if (reasons.length === 0) warnings.push("Incomparable: no reason recorded.");
  }
  if (improvementObj.status !== "VERIFIED") warnings.push(`Behavioral improvement is ${String(improvementObj.status)}: ${bounded(str(improvementObj.reason) ?? "no reason recorded")}`);
  if (Array.isArray(data.limitations)) {
    for (const limitation of (data.limitations as unknown[]).filter((l): l is string => typeof l === "string").slice(0, 3)) warnings.push(`Limitation: ${bounded(limitation)}`);
  }
  const html = await linkIfPresent(found.root, realOutDir, "prompt-template-comparison.html", "text");
  const text = await linkIfPresent(found.root, realOutDir, "prompt-template-comparison.txt", "text");
  if (html === null) warnings.push("HTML comparison report unavailable: prompt-template-comparison.html was not found.");
  const json = outputRelativePath(realOutDir, found.file);
  if (json === null) throw new Error(`Gallery source ${name} has no relative link from the gallery directory.`);
  const identity = `${str(base.runId) ?? "baseline"}-vs-${str(cand.runId) ?? "candidate"}`;
  return {
    id: itemId("prompt-template-comparison", identity, found.file),
    title: "Prompt template comparison",
    description: `Baseline ${str(base.templateId) ?? "unverified"} versus candidate ${str(cand.templateId) ?? "unverified"} (${status}).`,
    kind: "prompt-template-comparison",
    status: status === "COMPARABLE" ? "pass" : "warning",
    htmlPath: html ?? "",
    summaryPath: json,
    ...(text ? { artifactPaths: [text] } : {}),
    sourceFamily: "prompt-template-comparison",
    sourceId: identity,
    tags: ["prompt-comparison"],
    metrics,
    warnings
  };
}

// ---------------------------------------------------------------------------
// Tutorial runs
// ---------------------------------------------------------------------------

function validateTutorialManifest(data: Json, label: string): TutorialManifestV1 {
  if (data.schemaVersion !== TUTORIAL_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Gallery source ${label}: unsupported tutorial manifest schemaVersion ${JSON.stringify(data.schemaVersion)}.`);
  }
  const bad = (what: string): never => {
    throw new Error(`Gallery source ${label}: malformed tutorial manifest (${what}).`);
  };
  const scenario = data.scenario;
  const run = data.run;
  if (!isObject(scenario) || !str(scenario.id) || !str(scenario.title)) bad("scenario");
  if (!isObject(run) || !str(run.id) || !str(run.status) || !str(run.startedAt) || !str(run.endedAt)) bad("run");
  if (!Array.isArray(data.steps)) bad("steps");
  if (!Array.isArray(data.artifacts)) bad("artifacts");
  for (const key of ["warnings", "cleanupErrors"] as const) {
    const value = data[key];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) bad(key);
  }
  return data as unknown as TutorialManifestV1;
}

async function readTutorial(found: Found, realOutDir: string): Promise<GalleryManifestItem> {
  const manifest = validateTutorialManifest(found.data, path.basename(found.root));
  const warnings: string[] = [
    ...manifest.warnings.map((warning) => bounded(warning)),
    ...manifest.cleanupErrors.map((error) => `Cleanup error: ${bounded(error)}`)
  ];
  const records = manifest.artifacts.filter(isObject) as unknown as Array<{ kind?: string; status?: string; path?: string; error?: string }>;

  const resolveKind = async (kind: string, media: GalleryMediaKind, human: string): Promise<string[]> => {
    const matching = records.filter((record) => record.kind === kind);
    if (matching.length === 0) {
      warnings.push(`${human} unavailable: not recorded in the tutorial manifest.`);
      return [];
    }
    const links: string[] = [];
    for (const record of matching) {
      if (record.status !== "written") {
        warnings.push(`${human} unavailable: artifact status is ${record.status ?? "unknown"}${record.error ? ` (${bounded(record.error)})` : ""}.`);
        if (record.status === "failed") degraded = true;
        continue;
      }
      const verified = await verifyArtifactFile(found.root, record.path, media);
      if (!verified.ok) {
        warnings.push(`${human} unavailable: ${verified.reason}.`);
        degraded = true;
        continue;
      }
      const link = outputRelativePath(realOutDir, verified.absolutePath);
      if (link === null) {
        warnings.push(`${human} unavailable: no relative link exists from the gallery directory.`);
        degraded = true;
      } else links.push(link);
    }
    return links;
  };

  let degraded = false;
  const videos = await resolveKind("video", "video", "Video");
  const screenshots = await resolveKind("screenshot", "screenshot", "Screenshot");
  const markdown = await resolveKind("markdown", "markdown", "Markdown");
  const subtitles = [...(await resolveKind("srt", "text", "SRT subtitles")), ...(await resolveKind("vtt", "text", "VTT subtitles"))];

  const runStatus = manifest.run.status;
  // Media the manifest truthfully records as absent does not downgrade a passed run; a recorded artifact that
  // failed or cannot be verified does.
  const status: GalleryManifestItemStatus = runStatus === "passed" && !degraded && manifest.cleanupErrors.length === 0 ? "pass" : "warning";
  if (runStatus !== "passed") warnings.unshift(`Tutorial run status is ${runStatus}; the run did not pass.`);
  const summary = outputRelativePath(realOutDir, found.file);
  const duration = num(manifest.run.durationMs);
  return {
    id: itemId("tutorial-run", `${manifest.scenario.id}-${manifest.run.id}`, found.file),
    title: manifest.scenario.title,
    description: manifest.scenario.description ?? `Tutorial run ${manifest.run.id}.`,
    kind: "tutorial-run",
    status,
    htmlPath: "",
    ...(summary === null ? {} : { summaryPath: summary }),
    ...(screenshots[0] ? { screenshotPath: screenshots[0] } : {}),
    artifactPaths: subtitles,
    sourceFamily: "tutorial-run",
    sourceId: `${manifest.scenario.id}/${manifest.run.id}`,
    ...(videos[0] ? { videoPath: videos[0] } : {}),
    ...(markdown[0] ? { markdownPath: markdown[0] } : {}),
    ...(screenshots.length > 0 ? { screenshotPaths: screenshots } : {}),
    tags: ["tutorial"],
    metrics: [
      { id: "run-status", label: "Run status", value: runStatus },
      { id: "step-count", label: "Step count", value: manifest.steps.length },
      ...(duration !== null ? [{ id: "duration-ms", label: "Duration", value: duration, unit: "ms" }] : [])
    ],
    warnings
  };
}

// ---------------------------------------------------------------------------

/**
 * Reads every explicitly supplied source, in the supplied order. Repeated sources and repeated artifacts
 * (same physical file and family) produce one item. Any unreadable, malformed, unsupported or ambiguous
 * source fails the whole build; no placeholder success item is ever produced.
 */
export async function readGallerySources(options: { sources: readonly string[]; realOutDir: string }): Promise<ReadGallerySourcesResult> {
  const items: GalleryManifestItem[] = [];
  const seen = new Set<string>();
  for (const source of options.sources) {
    if (source.trim() === "") throw new Error("Gallery source path must not be empty.");
    if (looksLikeUrl(source)) throw new Error(`Gallery source ${source}: URLs are not supported; supply a local path.`);
    for (const entry of await collect(source)) {
      const key = `${entry.family}|${await realpath(entry.file)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      switch (entry.family) {
        case "tutorial-run":
          items.push(await readTutorial(entry, options.realOutDir));
          break;
        case "plugin-experiment-report":
        case "warm-index-campaign":
          items.push(await readPluginFamily(entry, options.realOutDir));
          break;
        case "audit-report":
          items.push(readAudit(entry, options.realOutDir));
          break;
        case "security-validation-report":
          items.push(readSecurity(entry, options.realOutDir));
          break;
        case "android-validation-report":
          items.push(readAndroid(entry, options.realOutDir));
          break;
        case "controlled-experiment":
          items.push(readExperiment(entry, options.realOutDir));
          break;
        case "prompt-template-comparison":
          items.push(await readPromptComparison(entry, options.realOutDir));
          break;
      }
    }
  }
  return { items };
}
