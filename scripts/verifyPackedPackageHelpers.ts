import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// v0.4.6 Batch 5 -- pure, independently-testable helpers for
// scripts/verify-packed-package.mjs. Kept as a real TypeScript module
// (rather than inline in the .mjs entrypoint) so it compiles into
// dist/scripts/verifyPackedPackageHelpers.js and can be imported both by
// the acceptance script (dynamic import from dist/, after a build) and
// directly by focused tests, matching the existing scripts/verify-benchmarks.ts
// convention in this repository.
// ---------------------------------------------------------------------------

export function findExactlyOneTarball(filenames: string[]): string {
  const tarballs = filenames.filter((name) => name.endsWith(".tgz"));
  if (tarballs.length === 0) {
    throw new Error("npm pack produced no .tgz file in the pack destination directory.");
  }
  if (tarballs.length > 1) {
    throw new Error(
      `npm pack destination contains ${tarballs.length} .tgz files; expected exactly one: ${tarballs.join(", ")}`
    );
  }
  return tarballs[0];
}

export type InstalledPackageJson = {
  name?: string;
  version?: string;
  engines?: { node?: string };
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type ExpectedPackageIdentity = {
  name: string;
  version: string;
  enginesNode: string | undefined;
  binName: string;
  binTarget: string | undefined;
};

export function validateInstalledPackageIdentity(
  installedPackageJson: InstalledPackageJson,
  expected: ExpectedPackageIdentity
): string[] {
  const problems: string[] = [];
  if (installedPackageJson.name !== expected.name) {
    problems.push(`name mismatch: expected "${expected.name}", got "${installedPackageJson.name}"`);
  }
  if (installedPackageJson.version !== expected.version) {
    problems.push(`version mismatch: expected "${expected.version}", got "${installedPackageJson.version}"`);
  }
  if (installedPackageJson.engines?.node !== expected.enginesNode) {
    problems.push(
      `engines.node mismatch: expected "${expected.enginesNode}", got "${installedPackageJson.engines?.node}"`
    );
  }
  const actualBinTarget = installedPackageJson.bin?.[expected.binName];
  if (actualBinTarget !== expected.binTarget) {
    problems.push(`bin.${expected.binName} mismatch: expected "${expected.binTarget}", got "${actualBinTarget}"`);
  }
  return problems;
}

export function validatePlaywrightRuntimeDependency(
  installedPackageJson: InstalledPackageJson,
  expectedVersion: string
): string[] {
  const problems: string[] = [];
  if (installedPackageJson.dependencies?.playwright !== expectedVersion) {
    problems.push(`dependencies.playwright mismatch: expected "${expectedVersion}", got "${installedPackageJson.dependencies?.playwright}"`);
  }
  if (installedPackageJson.devDependencies?.playwright !== undefined) {
    problems.push("playwright must not remain in devDependencies");
  }
  return problems;
}

export function missingRequiredTarballPaths(files: Iterable<string>, required: readonly string[]): string[] {
  const available = new Set(Array.from(files, (file) => file.replace(/\\/g, "/")));
  return required.filter((file) => !available.has(file));
}

export function validateManifestRelativePaths(
  manifest: { artifacts?: Array<{ path?: string }> },
  runRoot = "runRoot"
): string[] {
  const problems: string[] = [];
  for (const artifact of manifest.artifacts ?? []) {
    if (!artifact.path) continue;
    const artifactPath = artifact.path;
    if (path.posix.isAbsolute(artifactPath) || /^[A-Za-z]:/.test(artifactPath) || artifactPath.includes("\\")) {
      problems.push(`manifest path is not relative POSIX: ${artifactPath}`);
      continue;
    }
    const resolved = path.posix.normalize(path.posix.join("/", artifactPath));
    if (artifactPath === ".." || artifactPath.startsWith("../") || resolved === "/" || resolved.startsWith("/../") || resolved === "/..") {
      problems.push(`manifest path escapes ${runRoot}: ${artifactPath}`);
    }
  }
  return problems;
}

// v0.5.2 Batch 6 -- warm-index real-agent campaign gallery acceptance.
const EXPECTED_WARM_CAMPAIGN_GALLERY_ITEM_IDS = [
  "warm-index-campaign-report",
  "warm-index-campaign-plots",
  "warm-index-execution"
];

type WarmIndexCampaignGalleryManifestItem = {
  id?: string;
  status?: string;
  htmlPath?: string;
  summaryPath?: string;
  runsPath?: string;
  screenshotPath?: string;
  artifactPaths?: string[];
  warnings?: string[];
};

function isBoundedRelativePath(value: string): boolean {
  return !path.win32.isAbsolute(value) && !path.posix.isAbsolute(value) && !/^[A-Za-z]:/.test(value) && !value.includes("\\");
}

/**
 * Proves the narrow warm-index campaign gallery contract from Batch 5/6: exactly the three
 * expected item ids, in order, and every path field/artifactPaths entry a bounded relative POSIX
 * path that never links detailed per-agent evidence (agents/) or provider stdout/stderr/telemetry.
 */
export function validateWarmIndexCampaignGalleryManifest(manifest: { items?: WarmIndexCampaignGalleryManifestItem[] }): string[] {
  const problems: string[] = [];
  const items = manifest.items ?? [];
  const ids = items.map((item) => item.id);
  if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_WARM_CAMPAIGN_GALLERY_ITEM_IDS)) {
    problems.push(`expected gallery item ids ${JSON.stringify(EXPECTED_WARM_CAMPAIGN_GALLERY_ITEM_IDS)}, got ${JSON.stringify(ids)}`);
  }
  for (const item of items) {
    const pathFields: Array<[string, string | undefined]> = [
      ["htmlPath", item.htmlPath],
      ["summaryPath", item.summaryPath],
      ["runsPath", item.runsPath],
      ["screenshotPath", item.screenshotPath]
    ];
    for (const [field, value] of pathFields) {
      if (!value) continue;
      if (!isBoundedRelativePath(value)) {
        problems.push(`item ${item.id} field ${field} is not a bounded relative POSIX path: ${value}`);
      }
      if (/agents\//.test(value) || /\bstdout\b|\bstderr\b|telemetry/i.test(value)) {
        problems.push(`item ${item.id} field ${field} links detailed/forensic agent evidence: ${value}`);
      }
    }
    for (const artifactPath of item.artifactPaths ?? []) {
      if (!isBoundedRelativePath(artifactPath)) {
        problems.push(`item ${item.id} artifactPaths entry is not a bounded relative POSIX path: ${artifactPath}`);
      }
      if (/agents\//.test(artifactPath) || /\bstdout\b|\bstderr\b|telemetry/i.test(artifactPath)) {
        problems.push(`item ${item.id} artifactPaths entry links detailed/forensic agent evidence: ${artifactPath}`);
      }
    }
  }
  return problems;
}

export type WarmIndexCampaignScreenshotEvidence = {
  status: "captured" | "skipped" | "failed";
  commandOutput: string;
  expectedPngPath: string;
  pngExists: boolean;
  reportItem: Pick<WarmIndexCampaignGalleryManifestItem, "status" | "screenshotPath" | "warnings">;
};

/** Validates the optional screenshot outcome against the installed campaign's CLI and gallery evidence. */
export function validateWarmIndexCampaignScreenshotEvidence(evidence: WarmIndexCampaignScreenshotEvidence): string[] {
  const problems: string[] = [];
  const { status, commandOutput, pngExists, reportItem } = evidence;
  const screenshotLine = `Screenshot: ${evidence.expectedPngPath}`;
  if (status === "captured") {
    if (!commandOutput.split(/\r?\n/).includes(screenshotLine)) {
      problems.push("captured screenshot is not reported by the campaign command");
    }
    if (!pngExists) problems.push("screenshot was reported captured but report.png is missing");
    if (reportItem.status !== "pass" || reportItem.screenshotPath !== "../report.png") {
      problems.push("captured screenshot is inconsistent with the gallery report item");
    }
    return problems;
  }

  if (!commandOutput.split(/\r?\n/).includes(`Screenshot: ${status}`)) {
    problems.push(`${status} screenshot outcome is not reported by the campaign command`);
  }
  if (pngExists) problems.push(`${status} screenshot outcome unexpectedly has report.png`);
  if (reportItem.status !== "warning" || reportItem.screenshotPath !== undefined) {
    problems.push(`${status} screenshot outcome is inconsistent with the gallery report item`);
  }

  const warnings = reportItem.warnings ?? [];
  if (status === "skipped") {
    if (!warnings.some((warning) => /Playwright or browser runtime is unavailable/.test(warning))) {
      problems.push("skipped screenshot is missing the browser-unavailable warning");
    }
  } else {
    const failureWarning = warnings.find((warning) => /^Report screenshot capture failed: .+\.$/.test(warning));
    if (!failureWarning) {
      problems.push("failed screenshot is missing explicit gallery failure evidence");
    } else if (!commandOutput.includes(failureWarning.slice("Report screenshot capture failed: ".length, -1))) {
      problems.push("campaign command output does not preserve the screenshot failure detail");
    }
  }
  return problems;
}

export type DirectorySnapshotEntry = [relativePath: string, sha256: string];

// Deterministic recursive snapshot: sorted relative POSIX-style paths ->
// SHA-256 content hash, for every regular file under root.
export async function snapshotDirectory(root: string): Promise<DirectorySnapshotEntry[]> {
  const entries: DirectorySnapshotEntry[] = [];
  async function walk(dir: string): Promise<void> {
    const dirEntries = await readdir(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(root, fullPath).split(path.sep).join("/");
        const content = await readFile(fullPath);
        const hash = createHash("sha256").update(content).digest("hex");
        entries.push([relPath, hash]);
      }
    }
  }
  await walk(root);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries;
}

export function diffSnapshots(before: DirectorySnapshotEntry[], after: DirectorySnapshotEntry[]): string[] {
  const beforeMap = new Map(before);
  const afterMap = new Map(after);
  const changes: string[] = [];
  for (const [relPath, hash] of beforeMap) {
    if (!afterMap.has(relPath)) {
      changes.push(`removed: ${relPath}`);
    } else if (afterMap.get(relPath) !== hash) {
      changes.push(`modified: ${relPath}`);
    }
  }
  for (const [relPath] of afterMap) {
    if (!beforeMap.has(relPath)) {
      changes.push(`added: ${relPath}`);
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// v0.6.1 Batch 4 -- installed-package affected-neighborhood acceptance helpers.
// Pure and independently testable; the acceptance script owns all process work.
// ---------------------------------------------------------------------------

export const UPSTREAM_MY_DEV_KIT_PACKAGE = "@dailephd/my-dev-kit";
export const UPSTREAM_MY_DEV_KIT_VERSION = "1.12.5";
/** The upstream version the released v0.6.2 two-treatment (V1) acceptance was proven against. Historical only. */
export const HISTORICAL_V1_UPSTREAM_MY_DEV_KIT_VERSION = "1.12.4";
export const UPSTREAM_MY_DEV_KIT_SPEC = `${UPSTREAM_MY_DEV_KIT_PACKAGE}@${UPSTREAM_MY_DEV_KIT_VERSION}`;

/** The six warm-side affected-neighborhood metrics: assessment/report field, generic metric ID, unit. */
export const AFFECTED_NEIGHBORHOOD_METRICS = [
  { field: "changedFileCount", id: "affected-neighborhood-changed-file-count", unit: "count" },
  { field: "changedSymbolCount", id: "affected-neighborhood-changed-symbol-count", unit: "count" },
  { field: "affectedNodeCount", id: "affected-neighborhood-node-count", unit: "count" },
  { field: "affectedEdgeCount", id: "affected-neighborhood-edge-count", unit: "count" },
  { field: "taskOverlapCount", id: "affected-neighborhood-task-overlap-count", unit: "count" },
  { field: "taskOverlapPercent", id: "affected-neighborhood-task-overlap-percent", unit: "percent" }
] as const;

export const AFFECTED_NEIGHBORHOOD_EXPLANATIONS = {
  recommended: "Reindex recommended: the task has confirmed overlap with the affected one-hop baseline graph neighborhood.",
  "not-indicated": "Reindex not indicated by this bounded analysis: complete evidence found no task-node overlap with the affected neighborhood.",
  unknown:
    "Reindex recommendation unknown: evidence is incomplete or unavailable, so absence of observed overlap is not sufficient to conclude that the task is unaffected."
} as const;

/**
 * Validates that a package.json is exactly the pinned published upstream my-dev-kit. Anything else
 * (another package, another version, a range or dist-tag such as `latest`) is a problem.
 */
export function validateUpstreamMyDevKitIdentity(packageJson: { name?: unknown; version?: unknown } | null): string[] {
  const problems: string[] = [];
  if (!packageJson) return ["upstream package.json is missing"];
  if (packageJson.name !== UPSTREAM_MY_DEV_KIT_PACKAGE) problems.push(`upstream package name is ${String(packageJson.name)}, expected ${UPSTREAM_MY_DEV_KIT_PACKAGE}`);
  if (packageJson.version !== UPSTREAM_MY_DEV_KIT_VERSION) problems.push(`upstream package version is ${String(packageJson.version)}, expected ${UPSTREAM_MY_DEV_KIT_VERSION}`);
  return problems;
}

/** Resolves the upstream CLI entry from package.json `bin` (string or map) as a forward-slash relative path. */
export function resolveUpstreamBinRelativePath(packageJson: { bin?: unknown }): string | null {
  const bin = packageJson.bin;
  if (typeof bin === "string") return bin.replace(/\\/g, "/");
  if (bin && typeof bin === "object") {
    const values = Object.values(bin as Record<string, unknown>).filter((value): value is string => typeof value === "string");
    if (values.length > 0) return values[0].replace(/\\/g, "/");
  }
  return null;
}

export type ControlledMutationWrapperConfig = {
  /** Absolute path of the real upstream CLI entry (a .js file run with the current node). */
  upstreamBin: string;
  /** The single file that may be mutated. */
  mutateFile: string;
  /** Text appended to `mutateFile` exactly once. */
  mutationText: string;
  /** Evidence file the wrapper writes (JSON). */
  statePath: string;
  /** Append-only invocation log, one `<command>\t<exit>` line per invocation. */
  logPath: string;
};

/**
 * Source of a verifier-owned, temporary my-dev-kit command wrapper (acceptance infrastructure only;
 * never shipped). Every invocation is delegated to the real upstream CLI with stdio passed through
 * and its exit status preserved; nothing about upstream output or artifacts is altered. After a
 * delegated `search` that follows a successful `index`, the wrapper appends `mutationText` to
 * `mutateFile` exactly once. That is after the index build and after Lab captured its baseline
 * snapshot, so the next task's freshness observes a real change. Failed or absent index runs never
 * cause a mutation.
 */
export function buildControlledMutationKitWrapperSource(config: ControlledMutationWrapperConfig): string {
  return [
    `import { spawnSync } from "node:child_process";`,
    `import { createHash } from "node:crypto";`,
    `import fs from "node:fs";`,
    `const CONFIG = ${JSON.stringify(config)};`,
    `const args = process.argv.slice(2);`,
    `const command = args[0];`,
    `const sha = () => (fs.existsSync(CONFIG.mutateFile) ? createHash("sha256").update(fs.readFileSync(CONFIG.mutateFile)).digest("hex") : null);`,
    `const readState = () => (fs.existsSync(CONFIG.statePath) ? JSON.parse(fs.readFileSync(CONFIG.statePath, "utf8")) : { indexSucceededCount: 0, mutationCount: 0 });`,
    `const shaBeforeDelegate = sha();`,
    `const result = spawnSync(process.execPath, [CONFIG.upstreamBin, ...args], { stdio: "inherit" });`,
    `const status = result.error ? 1 : (result.status ?? 1);`,
    `if (result.error) process.stderr.write("controlled-mutation wrapper could not run the upstream CLI: " + result.error.message + "\\n");`,
    `const state = readState();`,
    `if (command === "index" && status === 0) {`,
    `  state.indexSucceededCount += 1;`,
    `  state.shaBeforeIndex = shaBeforeDelegate;`,
    `  state.shaAfterIndex = sha();`,
    `}`,
    `if (command === "search" && state.indexSucceededCount > 0 && state.mutationCount === 0) {`,
    `  state.shaBeforeMutation = sha();`,
    `  fs.appendFileSync(CONFIG.mutateFile, CONFIG.mutationText);`,
    `  state.mutationCount += 1;`,
    `  state.shaAfterMutation = sha();`,
    `}`,
    `fs.writeFileSync(CONFIG.statePath, JSON.stringify(state));`,
    `fs.appendFileSync(CONFIG.logPath, String(command) + "\\t" + status + "\\n");`,
    `process.exitCode = status;`
  ].join("\n");
}

export type AffectedNeighborhoodExpectation = {
  freshnessStatus: string;
  assessmentStatus: string;
  relationship: string;
  reindexRecommendation: string;
  /** Exact number, "positive" (> 0), or "nonnegative" (finite, >= 0). */
  metrics: Record<(typeof AFFECTED_NEIGHBORHOOD_METRICS)[number]["field"], number | "positive" | "nonnegative">;
};

type JsonRecord = Record<string, unknown>;
const asRecord = (value: unknown): JsonRecord | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null);

function matchesExpectedNumber(value: unknown, expected: number | "positive" | "nonnegative"): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (expected === "positive") return value > 0;
  if (expected === "nonnegative") return value >= 0;
  return value === expected;
}

/**
 * Checks one installed run's affected-neighborhood evidence across every layer: the persisted
 * execution assessment, the structured warm metrics, the generic warm outcome metrics (and their
 * absence on the raw outcome), and the JSON, text, and HTML report surfaces. Returns problems; an
 * empty array means every layer agrees with the scenario expectation and with each other.
 */
export function validateAffectedNeighborhoodLayers(input: {
  caseId: string;
  executionArtifact: unknown;
  report: unknown;
  reportText: string;
  reportHtml: string;
  expected: AffectedNeighborhoodExpectation;
}): string[] {
  const problems: string[] = [];
  const { caseId, expected } = input;
  const tag = `[${caseId}]`;
  const artifact = asRecord(input.executionArtifact);
  if (artifact?.schemaVersion !== "my-dev-kit-lab-warm-index-execution-v1") {
    problems.push(`${tag} execution artifact schemaVersion is not my-dev-kit-lab-warm-index-execution-v1`);
  }
  const executionTasks = ((asRecord((artifact?.projects as unknown[] | undefined)?.[0])?.tasks as unknown[] | undefined) ?? []).map(asRecord);
  const executionTask = executionTasks.find((task) => task?.caseId === caseId) ?? null;
  const assessment = asRecord(executionTask?.affectedNeighborhood);
  if (!assessment) {
    return [...problems, `${tag} execution artifact task has no affectedNeighborhood assessment object`];
  }
  if (assessment.schemaVersion !== "my-dev-kit-lab-affected-neighborhood-assessment-v1") problems.push(`${tag} assessment schemaVersion is unexpected`);
  if (assessment.status !== expected.assessmentStatus) problems.push(`${tag} assessment status is ${String(assessment.status)}, expected ${expected.assessmentStatus}`);
  if (assessment.freshnessStatus !== expected.freshnessStatus) problems.push(`${tag} assessment freshness is ${String(assessment.freshnessStatus)}, expected ${expected.freshnessStatus}`);
  if (assessment.relationship !== expected.relationship) problems.push(`${tag} relationship is ${String(assessment.relationship)}, expected ${expected.relationship}`);
  if (assessment.reindexRecommendation !== expected.reindexRecommendation) {
    problems.push(`${tag} reindexRecommendation is ${String(assessment.reindexRecommendation)}, expected ${expected.reindexRecommendation}`);
  }
  if (executionTask?.warmStatus !== "completed" || executionTask?.rawStatus !== "completed") problems.push(`${tag} execution statuses are not completed/completed`);
  const artifactText = JSON.stringify(input.executionArtifact);
  if (/"nodes"|"edges"|affectedNeighborhoodGraph|"kind":"(?:defines|exports|calls|imports)"/.test(artifactText)) {
    problems.push(`${tag} execution artifact embeds graph node or edge records`);
  }

  const report = asRecord(input.report);
  const warmSection = asRecord(report?.warmIndexReuse);
  const reportTasks = ((asRecord((warmSection?.projects as unknown[] | undefined)?.[0])?.tasks as unknown[] | undefined) ?? []).map(asRecord);
  const reportTask = reportTasks.find((task) => task?.caseId === caseId) ?? null;
  const warm = asRecord(reportTask?.warm);
  const raw = asRecord(reportTask?.raw);
  const block = asRecord(reportTask?.affectedNeighborhood);
  if (!reportTask || !warm || !block) return [...problems, `${tag} report.json has no affectedNeighborhood block for the task`];
  const blockMetrics = asRecord(block.metrics);
  const outcomes = ((report?.cases as unknown[] | undefined) ?? [])
    .map(asRecord)
    .find((entry) => entry?.id === caseId)?.outcomes as unknown[] | undefined;
  const outcomeMetrics = (variantId: string) =>
    (((outcomes ?? []).map(asRecord).find((outcome) => outcome?.variantId === variantId)?.metrics as unknown[] | undefined) ?? []).map(asRecord);
  const warmGeneric = outcomeMetrics("warm-index-reuse");
  const rawGeneric = outcomeMetrics("raw-full-file");

  for (const metric of AFFECTED_NEIGHBORHOOD_METRICS) {
    const { field, id, unit } = metric;
    const assessmentValue = assessment[field];
    const structured = asRecord(warm[field]);
    if (!matchesExpectedNumber(assessmentValue, expected.metrics[field])) {
      problems.push(`${tag} assessment ${field} is ${JSON.stringify(assessmentValue)}, expected ${String(expected.metrics[field])}`);
    }
    if (structured?.availability !== "available" || structured.value !== assessmentValue || structured.unit !== unit || structured.source !== "derived") {
      problems.push(`${tag} structured warm metric ${field} disagrees with the assessment (${JSON.stringify(structured)} vs ${JSON.stringify(assessmentValue)})`);
    }
    if (JSON.stringify(blockMetrics?.[field]) !== JSON.stringify(warm[field])) problems.push(`${tag} report block metric ${field} is not the structured warm metric`);
    const generic = warmGeneric.find((entry) => entry?.id === id);
    if (!generic || generic.value !== assessmentValue || generic.unit !== unit) problems.push(`${tag} warm outcome metric ${id} is missing or disagrees (${JSON.stringify(generic)})`);
    if (rawGeneric.some((entry) => entry?.id === id) || (raw && field in raw)) problems.push(`${tag} raw side carries affected-neighborhood metric ${field}`);
  }

  if (block.status !== assessment.status) problems.push(`${tag} report status ${String(block.status)} differs from the assessment`);
  if (block.relationship !== assessment.relationship) problems.push(`${tag} report relationship ${String(block.relationship)} differs from the assessment`);
  if (block.reindexRecommendation !== assessment.reindexRecommendation) problems.push(`${tag} report recommendation differs from the assessment`);
  const explanation = AFFECTED_NEIGHBORHOOD_EXPLANATIONS[expected.reindexRecommendation as keyof typeof AFFECTED_NEIGHBORHOOD_EXPLANATIONS];
  if (block.recommendationExplanation !== explanation) problems.push(`${tag} report explanation is not the fixed ${expected.reindexRecommendation} wording`);
  const summary = asRecord(warmSection?.affectedNeighborhoodSummary);
  if (!summary || typeof summary.assessedTaskCount !== "number" || summary.assessedTaskCount < 1) problems.push(`${tag} report affectedNeighborhoodSummary is missing`);

  const textExpected = [`Reindex Recommendation: ${expected.reindexRecommendation}`, `Affected Neighborhood Relationship: ${expected.relationship}`, explanation];
  for (const marker of textExpected) if (!input.reportText.includes(marker)) problems.push(`${tag} report.txt lacks "${marker}"`);
  if (!input.reportText.includes("Affected Neighborhood Summary")) problems.push(`${tag} report.txt lacks the affected-neighborhood summary`);
  if (!input.reportHtml.includes("Affected Neighborhood") || !input.reportHtml.includes(explanation)) problems.push(`${tag} report.html lacks the affected-neighborhood presentation or explanation`);
  for (const word of [expected.relationship, expected.reindexRecommendation]) {
    if (!input.reportHtml.includes(word)) problems.push(`${tag} report.html lacks ${word}`);
  }
  for (const metric of AFFECTED_NEIGHBORHOOD_METRICS) {
    const value = assessment[metric.field];
    if (typeof value === "number" && !input.reportHtml.includes(String(value))) problems.push(`${tag} report.html lacks ${metric.field} value ${value}`);
    if (typeof value === "number" && !input.reportText.includes(String(value))) problems.push(`${tag} report.txt lacks ${metric.field} value ${value}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// v0.6.2 Batch 6 -- HISTORICAL V1 (two-treatment) installed-package incremental-change-staleness
// acceptance helpers, retained for the released v0.6.2 contract. Current v0.6.3 acceptance uses the V2
// helpers at the end of this file.
// helpers. Pure and independently testable; the acceptance script owns all
// process work, real upstream install, and the one call into the installed
// package's own pure comparison module (Section 41).
// ---------------------------------------------------------------------------

export const INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_EXPECTED = "my-dev-kit-lab-incremental-change-staleness-execution-v1";

export const INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS = ["U1", "L2", "E1", "P1", "I1", "T1"] as const;

/** Frozen scenario -> controlled file path contract (Section 30/56). */
export const INCREMENTAL_CHANGE_STALENESS_CONTROLLED_PATHS: Record<(typeof INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS)[number], string> = {
  U1: "py/task_analytics/quality.py",
  L2: "src/services/completeTask.ts",
  E1: "py/task_analytics/quality.py",
  P1: "py/task_analytics/metrics.py",
  I1: "ts/src/services/buildAnalyticsSnapshot.ts",
  T1: "py/tests/test_quality.py"
};

const AFFECTED_RELATIONSHIP_VALUES = new Set(["related", "unrelated", "unknown"]);
const AFFECTED_RECOMMENDATION_VALUES = new Set(["recommended", "not-indicated", "unknown"]);
const REQUIRED_FILE_STATUS_VALUES = new Set(["present", "missing", "unknown"]);
const RELATION_VALUES = new Set(["stale-worse", "same", "stale-better", "unknown"]);
const CLASSIFICATION_VALUES = new Set(["observed-stale-regression", "no-observed-stale-regression", "inconclusive"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Validates one persisted execution artifact against the frozen Batch 4/6 contract: schema, exact
 * six-scenario identity/order, treatment order, lifecycle states, active-index-phase, controlled
 * file identity, affected-neighborhood vocabulary/symmetry, retrieval/required-file/correctness
 * shape, comparison vocabulary, and top-level summary counts. Never recomputes a classification.
 */
export function validateIncrementalChangeStalenessArtifact(artifact: unknown): string[] {
  const problems: string[] = [];
  const root = record(artifact);
  if (!root) return ["execution artifact did not parse to a JSON object"];
  if (root.schemaVersion !== INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_EXPECTED) {
    problems.push(`schemaVersion is ${JSON.stringify(root.schemaVersion)}, expected ${INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_EXPECTED}`);
  }
  const scenarios = Array.isArray(root.scenarios) ? root.scenarios.map(record) : [];
  const expectedIds = INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS;
  const actualIds = scenarios.map((s) => s?.scenarioId);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    problems.push(`scenario order/identity mismatch: expected ${JSON.stringify(expectedIds)}, got ${JSON.stringify(actualIds)}`);
  }

  for (const scenario of scenarios) {
    if (!scenario) continue;
    const tag = `[${String(scenario.scenarioId)}]`;
    if (scenario.status !== "ready") {
      problems.push(`${tag} status is ${String(scenario.status)}, expected ready`);
      continue;
    }
    const lifecycle = record(scenario.lifecycle);
    if (!lifecycle) {
      problems.push(`${tag} lifecycle is missing for a ready scenario`);
    } else {
      if (lifecycle.preMutationEquivalence !== "equivalent") problems.push(`${tag} preMutationEquivalence is ${String(lifecycle.preMutationEquivalence)}, expected equivalent`);
      if (lifecycle.postMutationEquivalence !== "equivalent") problems.push(`${tag} postMutationEquivalence is ${String(lifecycle.postMutationEquivalence)}, expected equivalent`);
      if (lifecycle.staleBaselineFreshnessStatus !== "stale") problems.push(`${tag} staleBaselineFreshnessStatus is ${String(lifecycle.staleBaselineFreshnessStatus)}, expected stale`);
      if (lifecycle.fullRefreshBaselineFreshnessStatus !== "stale") problems.push(`${tag} fullRefreshBaselineFreshnessStatus is ${String(lifecycle.fullRefreshBaselineFreshnessStatus)}, expected stale`);
      if (lifecycle.fullRefreshRefreshedFreshnessStatus !== "fresh") problems.push(`${tag} fullRefreshRefreshedFreshnessStatus is ${String(lifecycle.fullRefreshRefreshedFreshnessStatus)}, expected fresh`);
      if (typeof lifecycle.myDevKitVersion !== "string" || !lifecycle.myDevKitVersion.includes(HISTORICAL_V1_UPSTREAM_MY_DEV_KIT_VERSION)) {
        problems.push(`${tag} myDevKitVersion is ${JSON.stringify(lifecycle.myDevKitVersion)}, expected to include ${HISTORICAL_V1_UPSTREAM_MY_DEV_KIT_VERSION}`);
      }
      const controlledPaths = (Array.isArray(lifecycle.controlledFilePaths) ? lifecycle.controlledFilePaths : []).map((p) => String(p).replace(/\\/g, "/"));
      const expectedControlledPath = INCREMENTAL_CHANGE_STALENESS_CONTROLLED_PATHS[scenario.scenarioId as keyof typeof INCREMENTAL_CHANGE_STALENESS_CONTROLLED_PATHS];
      if (!expectedControlledPath || !controlledPaths.some((p) => p.endsWith(expectedControlledPath))) {
        problems.push(`${tag} controlledFilePaths ${JSON.stringify(controlledPaths)} does not contain the frozen path ${JSON.stringify(expectedControlledPath)}`);
      }
    }

    const stale = record(scenario.stale);
    const fullRefresh = record(scenario.fullRefresh);
    if (!stale || !fullRefresh) {
      problems.push(`${tag} missing stale/fullRefresh treatment record for a ready scenario`);
      continue;
    }
    if (stale.treatmentId !== "stale-index" || fullRefresh.treatmentId !== "full-refresh") {
      problems.push(`${tag} treatment order/identity is not stale-index then full-refresh: ${String(stale.treatmentId)}, ${String(fullRefresh.treatmentId)}`);
    }
    if (stale.activeIndexPhase !== "baseline") problems.push(`${tag} stale-index activeIndexPhase is ${String(stale.activeIndexPhase)}, expected baseline`);
    if (fullRefresh.activeIndexPhase !== "refreshed") problems.push(`${tag} full-refresh activeIndexPhase is ${String(fullRefresh.activeIndexPhase)}, expected refreshed`);

    for (const [label, treatment] of [["stale-index", stale] as const, ["full-refresh", fullRefresh] as const]) {
      const retrieval = record(treatment.retrieval);
      if (!retrieval) problems.push(`${tag} ${label} has no retrieval record`);
      const requiredFileEvidence = record(treatment.requiredFileEvidence);
      if (!requiredFileEvidence || !REQUIRED_FILE_STATUS_VALUES.has(String(requiredFileEvidence.status))) {
        problems.push(`${tag} ${label} required-file evidence status is invalid: ${JSON.stringify(requiredFileEvidence?.status)}`);
      } else {
        const required = new Set((Array.isArray(requiredFileEvidence.requiredFiles) ? requiredFileEvidence.requiredFiles : []).map(String));
        const missing = Array.isArray(requiredFileEvidence.missingFiles) ? requiredFileEvidence.missingFiles.map(String) : [];
        if (requiredFileEvidence.status === "present" && missing.length !== 0) problems.push(`${tag} ${label} required-file status is present but missingFiles is nonempty`);
        if (requiredFileEvidence.status === "missing" && (missing.length === 0 || !missing.every((f) => required.has(f)))) {
          problems.push(`${tag} ${label} required-file status is missing but missingFiles is empty or not a subset of requiredFiles`);
        }
      }
      const fakeAgent = record(treatment.fakeAgent);
      if (fakeAgent) {
        const correctness = record(fakeAgent.correctness);
        if (!correctness || typeof correctness.available !== "boolean") problems.push(`${tag} ${label} fake-agent correctness structure is invalid`);
      }
      const affected = record(treatment.affectedNeighborhood);
      if (!affected) {
        problems.push(`${tag} ${label} has no affectedNeighborhood assessment`);
      } else {
        if (!AFFECTED_RELATIONSHIP_VALUES.has(String(affected.relationship))) problems.push(`${tag} ${label} affected-neighborhood relationship is invalid: ${String(affected.relationship)}`);
        if (!AFFECTED_RECOMMENDATION_VALUES.has(String(affected.reindexRecommendation))) problems.push(`${tag} ${label} reindexRecommendation is invalid: ${String(affected.reindexRecommendation)}`);
        for (const field of AFFECTED_NEIGHBORHOOD_METRICS) {
          const value = affected[field.field];
          if (value !== null && typeof value !== "number") problems.push(`${tag} ${label} affected-neighborhood metric ${field.field} is neither a number nor null: ${JSON.stringify(value)}`);
        }
      }
    }

    const staleAffected = record(stale.affectedNeighborhood);
    const fullAffected = record(fullRefresh.affectedNeighborhood);
    if (staleAffected && fullAffected) {
      const symmetryProblems: string[] = [];
      if (staleAffected.status !== fullAffected.status) symmetryProblems.push("status");
      if (staleAffected.relationship !== fullAffected.relationship) symmetryProblems.push("relationship");
      if (staleAffected.reindexRecommendation !== fullAffected.reindexRecommendation) symmetryProblems.push("reindexRecommendation");
      for (const field of AFFECTED_NEIGHBORHOOD_METRICS) {
        if (staleAffected[field.field] !== fullAffected[field.field]) symmetryProblems.push(field.field);
      }
      if (symmetryProblems.length > 0) problems.push(`${tag} stale/full-refresh affected-neighborhood asymmetry: ${symmetryProblems.join(", ")}`);
    }

    const comparison = record(scenario.comparison);
    if (!comparison || !RELATION_VALUES.has(String(comparison.correctnessRelation))) problems.push(`${tag} correctnessRelation is invalid: ${JSON.stringify(comparison?.correctnessRelation)}`);
    if (!comparison || !RELATION_VALUES.has(String(comparison.requiredFileEvidenceRelation))) problems.push(`${tag} requiredFileEvidenceRelation is invalid: ${JSON.stringify(comparison?.requiredFileEvidenceRelation)}`);
    if (!comparison || !CLASSIFICATION_VALUES.has(String(comparison.staleRiskClassification))) problems.push(`${tag} staleRiskClassification is invalid: ${JSON.stringify(comparison?.staleRiskClassification)}`);
  }

  const summary = record(root.summary);
  if (!summary) {
    problems.push("summary object is missing");
  } else {
    if (summary.scenarioCount !== 6) problems.push(`summary.scenarioCount is ${String(summary.scenarioCount)}, expected 6`);
    if ((Number(summary.readyScenarioCount) || 0) + (Number(summary.failedScenarioCount) || 0) !== Number(summary.scenarioCount)) {
      problems.push("summary readyScenarioCount + failedScenarioCount does not equal scenarioCount");
    }
    const classificationSum =
      (Number(summary.observedStaleRegressionCount) || 0) + (Number(summary.noObservedStaleRegressionCount) || 0) + (Number(summary.inconclusiveCount) || 0);
    if (classificationSum !== Number(summary.scenarioCount)) {
      problems.push(`summary classification counts sum to ${classificationSum}, expected ${String(summary.scenarioCount)}`);
    }
  }

  const serialized = JSON.stringify(root);
  if (/"winner"|"overallScore"|"grade"|"recommendedTreatment"|"staleRiskPercent"/.test(serialized)) {
    problems.push("execution artifact contains a forbidden overall-verdict field");
  }
  if (/"nodes"\s*:\s*\[|"edges"\s*:\s*\[|"kind":"(?:defines|exports|calls|imports)"/.test(serialized)) {
    problems.push("execution artifact embeds full graph node/edge records");
  }

  return problems;
}

/**
 * Cross-checks report.json/report.txt/report.html against the persisted execution artifact
 * (Section 48/52/53). Never re-derives a classification from prose; only compares the same
 * already-persisted fields and confirms their presence as text.
 */
export function validateIncrementalChangeStalenessReportConsistency(input: {
  artifact: unknown;
  report: unknown;
  reportText: string;
  reportHtml: string;
}): string[] {
  const problems: string[] = [];
  const artifactScenarios = Array.isArray(record(input.artifact)?.scenarios) ? (record(input.artifact)!.scenarios as unknown[]).map(record) : [];
  const reportSection = record(record(input.report)?.incrementalChangeStaleness);
  if (!reportSection) return ["report.json has no incrementalChangeStaleness section"];
  const reportScenarios = Array.isArray(reportSection.scenarios) ? reportSection.scenarios.map(record) : [];

  if (reportScenarios.length !== artifactScenarios.length) {
    problems.push(`report.json scenario count ${reportScenarios.length} does not match execution artifact scenario count ${artifactScenarios.length}`);
  }
  for (let index = 0; index < artifactScenarios.length; index += 1) {
    const artifactScenario = artifactScenarios[index];
    const reportScenario = reportScenarios[index];
    if (!artifactScenario || !reportScenario) continue;
    if (reportScenario.scenarioId !== artifactScenario.scenarioId) {
      problems.push(`report.json scenario order mismatch at index ${index}: ${String(reportScenario.scenarioId)} vs ${String(artifactScenario.scenarioId)}`);
    }
    const artifactComparison = record(artifactScenario.comparison);
    const reportComparison = record(reportScenario.comparison);
    if (JSON.stringify(reportComparison) !== JSON.stringify(artifactComparison)) {
      problems.push(`${String(artifactScenario.scenarioId)}: report.json comparison disagrees with execution artifact comparison`);
    }
    const classification = String(artifactComparison?.staleRiskClassification ?? "");
    if (classification && !input.reportText.includes(classification)) problems.push(`report.txt lacks classification for ${String(artifactScenario.scenarioId)}: ${classification}`);
    if (classification && !input.reportHtml.includes(classification)) problems.push(`report.html lacks classification for ${String(artifactScenario.scenarioId)}: ${classification}`);
    if (!input.reportText.includes(String(artifactScenario.scenarioId))) problems.push(`report.txt lacks scenario id ${String(artifactScenario.scenarioId)}`);
    if (!input.reportHtml.includes(String(artifactScenario.scenarioId))) problems.push(`report.html lacks scenario id ${String(artifactScenario.scenarioId)}`);
  }

  const artifactSummary = record(record(input.artifact)?.summary);
  if (
    reportSection.scenarioCount !== artifactSummary?.scenarioCount ||
    reportSection.readyScenarioCount !== artifactSummary?.readyScenarioCount ||
    reportSection.failedScenarioCount !== artifactSummary?.failedScenarioCount ||
    reportSection.observedStaleRegressionCount !== artifactSummary?.observedStaleRegressionCount ||
    reportSection.noObservedStaleRegressionCount !== artifactSummary?.noObservedStaleRegressionCount ||
    reportSection.inconclusiveCount !== artifactSummary?.inconclusiveCount
  ) {
    problems.push("report.json summary counts disagree with the execution artifact summary");
  }

  if (!Array.isArray(reportSection.limitations) || reportSection.limitations.length === 0) problems.push("report.json limitations are missing");
  for (const marker of ["scoped", "does not prove stale indexes are generally safe", "did not select or trigger", "not retrieval precision/recall", "deterministic fake-agent"]) {
    if (!input.reportText.toLowerCase().includes(marker.toLowerCase())) problems.push(`report.txt limitations lack expected meaning: "${marker}"`);
    if (!input.reportHtml.toLowerCase().includes(marker.toLowerCase())) problems.push(`report.html limitations lack expected meaning: "${marker}"`);
  }

  for (const forbidden of ["overall stale risk", "stale index is safe", "stale index is unsafe", "full refresh wins", "stale wins", "recommended treatment", ">Winner<", ">Score<"]) {
    if (input.reportText.toLowerCase().includes(forbidden.toLowerCase())) problems.push(`report.txt makes a forbidden overall-verdict claim: "${forbidden}"`);
    if (input.reportHtml.toLowerCase().includes(forbidden.toLowerCase())) problems.push(`report.html makes a forbidden overall-verdict claim: "${forbidden}"`);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// v0.6.3 Batch 5 -- installed-package four-treatment (V2) acceptance helpers. Pure and independently
// testable; the acceptance script owns process work and calls the installed package's own production
// artifact validator. These helpers add the acceptance-only gates (real-upstream partial realization,
// refreshed freshness, operational discrimination) and never reclassify a comparison.
// ---------------------------------------------------------------------------

export const INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2_EXPECTED = "my-dev-kit-lab-incremental-change-staleness-execution-v2";
export const INCREMENTAL_CHANGE_STALENESS_REPORT_SCHEMA_VERSION_V2_EXPECTED = "my-dev-kit-lab-incremental-change-staleness-report-v2";
export const INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS_EXPECTED = ["stale-index", "changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"] as const;
export const INCREMENTAL_CHANGE_STALENESS_V2_COMPARISON_CANDIDATES_EXPECTED = ["stale-index", "changed-files-refresh", "affected-neighborhood-refresh"] as const;
export const FORCED_NEIGHBOR_SAMPLE_CAP = 20;

const STALE_CLASSIFICATIONS_V2 = new Set(["observed-stale-regression", "no-observed-stale-regression", "inconclusive"]);
const PARTIAL_CLASSIFICATIONS_V2 = new Set(["observed-regression-relative-to-full", "no-observed-regression-relative-to-full", "inconclusive"]);

export type IncrementalChangeStalenessV2AcceptanceVerdict =
  | "PASS"
  | "BLOCKED_ARTIFACT_OR_REPORT_CONTRACT_MISMATCH"
  | "BLOCKED_CHANGED_FILES_PARTIAL_NOT_REALIZED"
  | "BLOCKED_AFFECTED_NEIGHBORHOOD_PARTIAL_NOT_REALIZED"
  | "BLOCKED_SCENARIO_DISCRIMINATION_INSUFFICIENT";

export type IncrementalChangeStalenessV2EvidenceRow = {
  scenarioId: string;
  treatmentId: string;
  treatmentIntent: unknown;
  refreshKind: unknown;
  refreshRealization: unknown;
  requestedScope: unknown;
  appliedScope: unknown;
  selectionStatus: unknown;
  fallbackReason: unknown;
  freshExtractionFileCount: unknown;
  reusedFileCount: unknown;
  forcedNeighborReanalysisFileCount: unknown;
  forcedNeighborSample: unknown;
  seedFileCount: unknown;
  affectedNodeCount: unknown;
  baselineFreshness: unknown;
  refreshedFreshness: unknown;
  requiredFileStatus: unknown;
  correctness: string;
  referenceClassification: unknown;
};

export type IncrementalChangeStalenessV2Acceptance = {
  verdict: IncrementalChangeStalenessV2AcceptanceVerdict;
  problems: string[];
  contractProblems: string[];
  changedFilesRealizationProblems: string[];
  affectedRealizationProblems: string[];
  discriminationProblems: string[];
  /** "insufficient" = no forced neighbor anywhere; "invariant-violation" = forced neighbor without a fresh/reused geometry difference. */
  discrimination: "pass" | "insufficient" | "invariant-violation" | "not-evaluated";
  forcedNeighborScenarios: string[];
  geometryDifferenceScenarios: string[];
  rows: IncrementalChangeStalenessV2EvidenceRow[];
};

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

function incrementalEvidence(treatment: JsonRecord | null): JsonRecord | null {
  const refresh = asRecord(treatment?.refreshExecution);
  return refresh?.kind === "incremental" ? asRecord(refresh.incrementalRefresh) : null;
}

/** One flat evidence row per scenario/treatment; unavailable evidence stays null/"unavailable", never zero. */
export function extractIncrementalChangeStalenessV2EvidenceRows(artifact: unknown): IncrementalChangeStalenessV2EvidenceRow[] {
  const rows: IncrementalChangeStalenessV2EvidenceRow[] = [];
  const scenarios = (Array.isArray(asRecord(artifact)?.scenarios) ? (asRecord(artifact)!.scenarios as unknown[]) : []).map(asRecord);
  for (const scenario of scenarios) {
    if (!scenario) continue;
    for (const treatment of (Array.isArray(scenario.treatments) ? scenario.treatments : []).map(asRecord)) {
      if (!treatment) continue;
      const refresh = asRecord(treatment.refreshExecution);
      const upstream = incrementalEvidence(treatment);
      const correctness = asRecord(asRecord(treatment.fakeAgent)?.correctness);
      const comparison = (Array.isArray(scenario.referenceComparisons) ? scenario.referenceComparisons : [])
        .map(asRecord)
        .find((entry) => entry?.candidateTreatmentId === treatment.treatmentId);
      const stale = asRecord(comparison?.comparison);
      rows.push({
        scenarioId: String(scenario.scenarioId),
        treatmentId: String(treatment.treatmentId),
        treatmentIntent: treatment.treatmentIntent ?? null,
        refreshKind: refresh?.kind ?? null,
        refreshRealization: refresh?.realization ?? null,
        requestedScope: upstream?.requestedScope ?? null,
        appliedScope: upstream?.appliedScope ?? null,
        selectionStatus: upstream?.selectionStatus ?? null,
        fallbackReason: upstream ? (upstream.fallbackReason ?? null) : null,
        freshExtractionFileCount: upstream?.freshExtractionFileCount ?? null,
        reusedFileCount: upstream?.reusedFileCount ?? null,
        forcedNeighborReanalysisFileCount: upstream?.forcedNeighborReanalysisFileCount ?? null,
        forcedNeighborSample: upstream?.forcedNeighborSample ?? null,
        seedFileCount: upstream?.seedFileCount ?? null,
        affectedNodeCount: upstream?.affectedNodeCount ?? null,
        baselineFreshness: asRecord(treatment.baselineFreshness)?.status ?? null,
        refreshedFreshness: asRecord(treatment.refreshedFreshness)?.status ?? null,
        requiredFileStatus: asRecord(treatment.requiredFileEvidence)?.status ?? null,
        correctness: correctness?.available === true && typeof correctness.score === "number" ? `available:${correctness.score}` : "unavailable",
        referenceClassification: comparison ? (comparison.kind === "stale-risk" ? (stale?.staleRiskClassification ?? null) : (comparison.classification ?? null)) : null
      });
    }
  }
  return rows;
}

/**
 * Acceptance gates over one persisted V2 execution artifact from the installed package run against the
 * real published upstream. Verdict precedence: contract mismatch, changed-files realization,
 * affected-neighborhood realization, discrimination. A correctness or required-file *difference* is never
 * demanded; null evidence is never coerced to zero.
 */
export function evaluateIncrementalChangeStalenessV2Acceptance(artifact: unknown): IncrementalChangeStalenessV2Acceptance {
  const contractProblems: string[] = [];
  const changedFilesRealizationProblems: string[] = [];
  const affectedRealizationProblems: string[] = [];
  const discriminationProblems: string[] = [];
  const forcedNeighborScenarios: string[] = [];
  const geometryDifferenceScenarios: string[] = [];
  const rows = extractIncrementalChangeStalenessV2EvidenceRows(artifact);

  const root = asRecord(artifact);
  if (!root) {
    const problems = ["execution artifact did not parse to a JSON object"];
    return {
      verdict: "BLOCKED_ARTIFACT_OR_REPORT_CONTRACT_MISMATCH",
      problems,
      contractProblems: problems,
      changedFilesRealizationProblems,
      affectedRealizationProblems,
      discriminationProblems,
      discrimination: "not-evaluated",
      forcedNeighborScenarios,
      geometryDifferenceScenarios,
      rows
    };
  }
  if (root.schemaVersion !== INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2_EXPECTED) {
    contractProblems.push(`schemaVersion is ${JSON.stringify(root.schemaVersion)}, expected ${INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2_EXPECTED}`);
  }
  const scenarios = (Array.isArray(root.scenarios) ? root.scenarios : []).map(asRecord);
  const actualIds = scenarios.map((scenario) => scenario?.scenarioId);
  if (JSON.stringify(actualIds) !== JSON.stringify(INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS)) {
    contractProblems.push(`scenario order/identity mismatch: expected ${JSON.stringify(INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS)}, got ${JSON.stringify(actualIds)}`);
  }

  let discriminationEvaluable = true;
  for (const scenario of scenarios) {
    if (!scenario) continue;
    const id = String(scenario.scenarioId);
    const tag = `[${id}]`;
    if (scenario.status !== "ready") {
      contractProblems.push(`${tag} status is ${String(scenario.status)}, expected ready`);
      discriminationEvaluable = false;
      continue;
    }
    const treatments = (Array.isArray(scenario.treatments) ? scenario.treatments : []).map(asRecord);
    if (JSON.stringify(treatments.map((t) => t?.treatmentId)) !== JSON.stringify(INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS_EXPECTED)) {
      contractProblems.push(`${tag} treatments are not exactly ${INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS_EXPECTED.join(", ")} in order: ${JSON.stringify(treatments.map((t) => t?.treatmentId))}`);
      discriminationEvaluable = false;
      continue;
    }
    const intents = treatments.map((t) => t?.treatmentIntent);
    if (intents.some((intent) => typeof intent !== "string" || intent.length === 0) || new Set(intents).size !== intents.length) {
      contractProblems.push(`${tag} treatment intents are not explicit and distinct: ${JSON.stringify(intents)}`);
    }
    const comparisons = (Array.isArray(scenario.referenceComparisons) ? scenario.referenceComparisons : []).map(asRecord);
    if (JSON.stringify(comparisons.map((c) => c?.candidateTreatmentId)) !== JSON.stringify(INCREMENTAL_CHANGE_STALENESS_V2_COMPARISON_CANDIDATES_EXPECTED)) {
      contractProblems.push(`${tag} reference comparisons are not exactly ${INCREMENTAL_CHANGE_STALENESS_V2_COMPARISON_CANDIDATES_EXPECTED.join(", ")} in order`);
    }
    for (const comparison of comparisons) {
      if (comparison?.referenceTreatmentId !== "full-refresh") contractProblems.push(`${tag} comparison reference is ${String(comparison?.referenceTreatmentId)}, expected full-refresh`);
      if (comparison?.candidateTreatmentId === "stale-index") {
        if (!STALE_CLASSIFICATIONS_V2.has(String(asRecord(comparison.comparison)?.staleRiskClassification))) contractProblems.push(`${tag} stale-index classification is outside the frozen vocabulary`);
      } else if (!PARTIAL_CLASSIFICATIONS_V2.has(String(comparison?.classification))) {
        // Includes not-comparable-as-partial-refresh: a production run that realizes both partials must never produce it.
        contractProblems.push(`${tag} ${String(comparison?.candidateTreatmentId)} classification ${JSON.stringify(comparison?.classification)} is not an acceptable production partial classification`);
      }
    }

    const [stale, changed, affected, full] = treatments;

    const staleRefresh = asRecord(stale?.refreshExecution);
    if (staleRefresh?.kind !== "no-refresh" || staleRefresh.realization !== "NO_REFRESH") contractProblems.push(`${tag} stale-index is not no-refresh/NO_REFRESH`);
    if (stale?.activeIndexPhase !== "baseline") contractProblems.push(`${tag} stale-index activeIndexPhase is ${String(stale?.activeIndexPhase)}, expected baseline`);
    if (asRecord(stale?.baselineFreshness)?.status !== "stale") contractProblems.push(`${tag} stale-index baseline freshness is ${String(asRecord(stale?.baselineFreshness)?.status)}, expected stale`);
    if (stale?.refreshedFreshness !== null) contractProblems.push(`${tag} stale-index must not have refreshed freshness`);

    const fullRefresh = asRecord(full?.refreshExecution);
    if (fullRefresh?.kind !== "full" || fullRefresh.realization !== "FULL_REFRESH" || fullRefresh.incrementalRefresh !== null) {
      contractProblems.push(`${tag} full-refresh is not full/FULL_REFRESH without incrementalRefresh evidence`);
    }
    for (const [label, treatment] of [["changed-files-refresh", changed], ["affected-neighborhood-refresh", affected], ["full-refresh", full]] as const) {
      if (treatment?.activeIndexPhase !== "refreshed") contractProblems.push(`${tag} ${label} activeIndexPhase is ${String(treatment?.activeIndexPhase)}, expected refreshed`);
      if (asRecord(treatment?.baselineFreshness)?.status !== "stale") contractProblems.push(`${tag} ${label} baseline freshness is ${String(asRecord(treatment?.baselineFreshness)?.status)}, expected stale`);
      if (asRecord(treatment?.refreshedFreshness)?.status !== "fresh") contractProblems.push(`${tag} ${label} refreshed freshness is ${String(asRecord(treatment?.refreshedFreshness)?.status)}, expected fresh`);
    }
    for (const treatment of treatments) {
      const evidence = asRecord(treatment?.requiredFileEvidence);
      if (!evidence || !REQUIRED_FILE_STATUS_VALUES.has(String(evidence.status))) contractProblems.push(`${tag} ${String(treatment?.treatmentId)} required-file evidence status is invalid: ${JSON.stringify(evidence?.status)}`);
      const correctness = asRecord(asRecord(treatment?.fakeAgent)?.correctness);
      if (!correctness || typeof correctness.available !== "boolean") contractProblems.push(`${tag} ${String(treatment?.treatmentId)} fake-agent correctness structure is invalid`);
      const relationship = asRecord(treatment?.affectedNeighborhood)?.relationship;
      if (!AFFECTED_RELATIONSHIP_VALUES.has(String(relationship))) contractProblems.push(`${tag} ${String(treatment?.treatmentId)} Lab affected-neighborhood relationship is invalid`);
    }

    // Realization gates: the real upstream must actually have applied each requested partial scope.
    const realization = (treatment: JsonRecord | null, label: "changed-files" | "affected-neighborhood", sink: string[]): JsonRecord | null => {
      const refresh = asRecord(treatment?.refreshExecution);
      const upstream = incrementalEvidence(treatment);
      if (refresh?.kind !== "incremental" || !upstream) {
        sink.push(`${tag} ${label}-refresh has no incremental refresh evidence`);
        return null;
      }
      if (refresh.realization !== "APPLIED_PARTIAL") {
        sink.push(`${tag} ${label}-refresh realization is ${String(refresh.realization)} (requested ${String(upstream.requestedScope)}, applied ${String(upstream.appliedScope)}, status ${String(upstream.selectionStatus)}, fallbackReason ${JSON.stringify(upstream.fallbackReason ?? null)})`);
      }
      if (upstream.requestedScope !== label) sink.push(`${tag} ${label}-refresh upstream requestedScope is ${String(upstream.requestedScope)}`);
      if (upstream.appliedScope !== label) sink.push(`${tag} ${label}-refresh upstream appliedScope is ${String(upstream.appliedScope)}`);
      if (upstream.selectionStatus !== "applied") sink.push(`${tag} ${label}-refresh upstream selectionStatus is ${String(upstream.selectionStatus)}`);
      if ((upstream.fallbackReason ?? null) !== null) sink.push(`${tag} ${label}-refresh upstream fallbackReason is ${JSON.stringify(upstream.fallbackReason)}`);
      for (const field of ["freshExtractionFileCount", "reusedFileCount", "forcedNeighborReanalysisFileCount"] as const) {
        if (!isCount(upstream[field])) contractProblems.push(`${tag} ${label}-refresh ${field} is unavailable or not a non-negative integer: ${JSON.stringify(upstream[field])}`);
      }
      const sample = upstream.forcedNeighborSample;
      const forced = upstream.forcedNeighborReanalysisFileCount;
      if (!Array.isArray(sample) || sample.some((entry) => typeof entry !== "string" || entry.length === 0)) {
        contractProblems.push(`${tag} ${label}-refresh forcedNeighborSample is not a list of path strings`);
      } else {
        if (sample.length > FORCED_NEIGHBOR_SAMPLE_CAP) contractProblems.push(`${tag} ${label}-refresh forcedNeighborSample has ${sample.length} entries, above the cap ${FORCED_NEIGHBOR_SAMPLE_CAP}`);
        if (isCount(forced) && sample.length > forced) contractProblems.push(`${tag} ${label}-refresh forcedNeighborSample (${sample.length}) exceeds forcedNeighborReanalysisFileCount (${forced})`);
        if (isCount(forced) && forced > 0 && sample.length === 0) contractProblems.push(`${tag} ${label}-refresh has ${forced} forced neighbors but an empty forcedNeighborSample`);
      }
      return upstream;
    };
    const changedUpstream = realization(changed, "changed-files", changedFilesRealizationProblems);
    const affectedUpstream = realization(affected, "affected-neighborhood", affectedRealizationProblems);

    if (changedUpstream && affectedUpstream) {
      const forced = affectedUpstream.forcedNeighborReanalysisFileCount;
      const affectedFresh = affectedUpstream.freshExtractionFileCount;
      const changedFresh = changedUpstream.freshExtractionFileCount;
      const affectedReused = affectedUpstream.reusedFileCount;
      const changedReused = changedUpstream.reusedFileCount;
      if (isCount(forced) && isCount(affectedFresh) && isCount(changedFresh) && isCount(affectedReused) && isCount(changedReused)) {
        if (forced > 0) {
          forcedNeighborScenarios.push(id);
          if (affectedFresh > changedFresh && affectedReused < changedReused) geometryDifferenceScenarios.push(id);
          else {
            discriminationProblems.push(
              `${tag} forcedNeighborReanalysisFileCount=${forced} but affected fresh/reused (${affectedFresh}/${affectedReused}) does not exceed/undercut changed-files (${changedFresh}/${changedReused})`
            );
          }
        }
      } else {
        discriminationEvaluable = false;
      }
    } else {
      discriminationEvaluable = false;
    }
  }

  const serialized = JSON.stringify(root);
  const forbiddenKey = /"(winner|bestTreatment|recommendedTreatment|rank|grade|compositeScore|safetyScore|safeToSkipRefresh|staleRiskPercent|refreshSafetyPercent|overallScore)"\s*:/.exec(serialized);
  if (forbiddenKey) contractProblems.push(`execution artifact contains a forbidden aggregate field: ${forbiddenKey[1]}`);
  if (/"nodes"\s*:\s*\[|"edges"\s*:\s*\[|"contextText"\s*:/.test(serialized)) contractProblems.push("execution artifact embeds graph node/edge records or raw context text");

  let discrimination: IncrementalChangeStalenessV2Acceptance["discrimination"] = "not-evaluated";
  if (discriminationEvaluable && changedFilesRealizationProblems.length === 0 && affectedRealizationProblems.length === 0) {
    if (discriminationProblems.length > 0) discrimination = "invariant-violation";
    else if (forcedNeighborScenarios.length === 0) {
      discrimination = "insufficient";
      discriminationProblems.push("no production scenario has affected-neighborhood forcedNeighborReanalysisFileCount > 0");
    } else discrimination = "pass";
  }

  let verdict: IncrementalChangeStalenessV2AcceptanceVerdict = "PASS";
  if (contractProblems.length > 0) verdict = "BLOCKED_ARTIFACT_OR_REPORT_CONTRACT_MISMATCH";
  else if (changedFilesRealizationProblems.length > 0) verdict = "BLOCKED_CHANGED_FILES_PARTIAL_NOT_REALIZED";
  else if (affectedRealizationProblems.length > 0) verdict = "BLOCKED_AFFECTED_NEIGHBORHOOD_PARTIAL_NOT_REALIZED";
  else if (discrimination !== "pass") verdict = "BLOCKED_SCENARIO_DISCRIMINATION_INSUFFICIENT";

  return {
    verdict,
    problems: [...contractProblems, ...changedFilesRealizationProblems, ...affectedRealizationProblems, ...(discrimination === "pass" ? [] : discriminationProblems)],
    contractProblems,
    changedFilesRealizationProblems,
    affectedRealizationProblems,
    discriminationProblems,
    discrimination,
    forcedNeighborScenarios,
    geometryDifferenceScenarios,
    rows
  };
}

const HTML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'" };
const unescapeHtml = (html: string): string => html.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (entity) => HTML_ENTITIES[entity]);

/**
 * Cross-checks the installed package's V2 report.json/report.txt/report.html against the persisted V2
 * execution artifact. Only compares already-persisted fields and confirms their presence as text.
 */
export function validateIncrementalChangeStalenessReportConsistencyV2(input: {
  artifact: unknown;
  report: unknown;
  reportText: string;
  reportHtml: string;
  /** The installed package's own frozen V2 limitations list. */
  expectedLimitations: readonly string[];
}): string[] {
  const problems: string[] = [];
  const artifact = asRecord(input.artifact);
  const section = asRecord(asRecord(input.report)?.incrementalChangeStaleness);
  if (!section) return ["report.json has no incrementalChangeStaleness section"];
  if (section.schemaVersion !== INCREMENTAL_CHANGE_STALENESS_REPORT_SCHEMA_VERSION_V2_EXPECTED) {
    problems.push(`report.json schemaVersion is ${JSON.stringify(section.schemaVersion)}, expected ${INCREMENTAL_CHANGE_STALENESS_REPORT_SCHEMA_VERSION_V2_EXPECTED}`);
  }
  if (JSON.stringify(section.summary) !== JSON.stringify(artifact?.summary)) problems.push("report.json summary disagrees with the execution artifact summary");
  const artifactScenarios = (Array.isArray(artifact?.scenarios) ? artifact!.scenarios : []).map(asRecord);
  const reportScenarios = (Array.isArray(section.scenarios) ? section.scenarios : []).map(asRecord);
  if (artifactScenarios.length !== reportScenarios.length) problems.push(`report.json scenario count ${reportScenarios.length} does not match execution artifact ${artifactScenarios.length}`);

  const text = input.reportText;
  const html = unescapeHtml(input.reportHtml);
  const both = (marker: string, what: string) => {
    if (!text.includes(marker)) problems.push(`report.txt lacks ${what}: "${marker}"`);
    if (!html.includes(marker)) problems.push(`report.html lacks ${what}: "${marker}"`);
  };
  for (let index = 0; index < artifactScenarios.length; index += 1) {
    const expected = artifactScenarios[index];
    const actual = reportScenarios[index];
    if (!expected || !actual) continue;
    const id = String(expected.scenarioId);
    if (actual.scenarioId !== expected.scenarioId) problems.push(`report.json scenario order mismatch at ${index}: ${String(actual.scenarioId)} vs ${id}`);
    for (const field of ["treatments", "referenceComparisons", "lifecycle"] as const) {
      if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) problems.push(`[${id}] report.json ${field} disagrees with the execution artifact`);
    }
    both(id, "scenario id");
    for (const treatment of (Array.isArray(expected.treatments) ? expected.treatments : []).map(asRecord)) {
      const treatmentId = String(treatment?.treatmentId);
      both(`(${treatmentId})`, `treatment section for ${id}`);
      both(String(asRecord(treatment?.refreshExecution)?.realization), `refresh realization for ${id}/${treatmentId}`);
    }
    for (const comparison of (Array.isArray(expected.referenceComparisons) ? expected.referenceComparisons : []).map(asRecord)) {
      const classification = comparison?.kind === "stale-risk" ? asRecord(comparison.comparison)?.staleRiskClassification : comparison?.classification;
      both(String(classification), `reference classification for ${id}/${String(comparison?.candidateTreatmentId)}`);
    }
  }
  for (const marker of ["Reference Comparisons", "Refresh Execution", "Changed-Files Refresh vs Full Refresh", "Affected-Neighborhood Refresh vs Full Refresh", "No Refresh vs Full Refresh", "different evidence families", "Forced-neighbor reanalysis files"]) {
    both(marker, "required section/label");
  }
  if (!Array.isArray(section.limitations) || JSON.stringify(section.limitations) !== JSON.stringify(input.expectedLimitations)) problems.push("report.json limitations differ from the installed frozen V2 limitations");
  for (const limitation of input.expectedLimitations) both(limitation, "limitation");

  for (const forbidden of ["overall stale risk", "stale index is safe", "stale index is unsafe", "full refresh wins", "stale wins", "recommended treatment", "partial refresh is safe", "affected-neighborhood is better", ">Winner<", ">Score<"]) {
    if (text.toLowerCase().includes(forbidden.toLowerCase())) problems.push(`report.txt makes a forbidden claim: "${forbidden}"`);
    if (html.toLowerCase().includes(forbidden.toLowerCase())) problems.push(`report.html makes a forbidden claim: "${forbidden}"`);
  }
  if (/contextText/.test(JSON.stringify(section)) || /contextText/.test(input.reportHtml)) problems.push("report exposes raw retrieved context text");
  return problems;
}
