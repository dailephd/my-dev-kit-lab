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
  htmlPath?: string;
  summaryPath?: string;
  runsPath?: string;
  screenshotPath?: string;
  artifactPaths?: string[];
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
export const UPSTREAM_MY_DEV_KIT_VERSION = "1.12.4";
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
