import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import type { DeclarationFactKind } from "../../core/sourceFacts.js";
import { readBoundedFileText } from "../utils/boundedRead.js";
import {
  firstPathSegment,
  GENERIC_INFRA_BASENAMES,
  baseNameNoExt,
  isGenericOrTestPrefixedDeclarationName,
} from "../utils/filePatternUtils.js";
import { deduplicateIssuesById, makeCodeRotIssue } from "../utils/issueFactories.js";
import { indexSourceFactsByPath } from "../utils/sourceFactsLookup.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 4 — duplicate/parallel implementation candidate detector.
//
// Every check here is a *candidate* signal, never proof of duplication --
// title/description wording is deliberately hedged throughout. Bounded,
// deterministic, no fuzzy text similarity and no large file reads (only a
// cheap regex scan of already-small detector source files for the
// registry-id-duplicate sub-check).
//
// Simplifications made relative to the full Batch 4 spec bullet list (see
// docs handed to this batch for the original wording):
//   - "multiple report renderers for same feature family" is folded into the
//     generic same-basename-across-unrelated-roots check (below) rather than
//     a separate report-specific check -- a dedicated report-directory scan
//     would duplicate that same logic for one category of directory.
//   - "multiple validation runners for same command surface" and "duplicated
//     script families where only one is documented" are SKIPPED: both
//     require inferring "same command surface"/"same family" from script
//     naming, which risks false positives without semantic judgment (out of
//     scope). Left for a future batch if a cheap deterministic signal is
//     found.
//   - The registry-duplicate-id check is intentionally narrow: it scans
//     source text of files under src/audits/codeRot/detectors/ for
//     `id: "..."` string literals via a cheap regex (not a semantic parse),
//     per the spec's own suggested simplification for that bullet.
// ---------------------------------------------------------------------------

const DETECTOR_ID = "duplicate-implementation-candidate";
const MAX_READ_BYTES = 200_000;

// Directory-name pairs commonly conflated in real projects (singular vs.
// plural, or synonym pairs). Flagged only when BOTH variants exist as a
// first path segment among inventoried files.
const PARALLEL_DIR_PAIRS: readonly [string, string][] = [
  ["report", "reports"],
  ["test", "tests"],
  ["util", "utils"],
  ["script", "scripts"],
  ["doc", "docs"],
];

export const DUPLICATE_IMPLEMENTATION_DETECTOR: AuditDetector = {
  id: DETECTOR_ID,
  auditType: "code-rot",
  title: "Duplicate/parallel implementation candidate",
  description:
    "Detects candidate (not proven) duplicate or parallel implementations: overlapping npm script entrypoints, parallel singular/plural directories, duplicate detector-registry ids, and repeated basenames across unrelated source roots.",
  supportedIncludeAreas: ["cli", "package", "architecture"],
  shouldSkip: (ctx: AuditDetectorContext) => {
    if (!ctx.config.include.includes("package")) {
      return { skip: true, reason: "--include does not select package; this detector's primary signal is package.json scripts." };
    }
    return { skip: false };
  },
  run: (ctx: AuditDetectorContext): AuditIssue[] => {
    const issues: AuditIssue[] = [];
    const pkg = ctx.sourceOfTruth.package;

    if (pkg) {
      issues.push(...findDuplicateScriptEntrypoints(pkg.scripts));
    }

    if (ctx.config.include.includes("architecture")) {
      issues.push(...findParallelDirectories(ctx.inventory.files.map((f) => f.relativePath)));
      issues.push(...findDuplicateBasenamesAcrossRoots(ctx.inventory.sourceFiles.map((f) => f.relativePath)));
      issues.push(...findDuplicateDeclarationCandidates(ctx));
    }

    issues.push(...findDuplicateDetectorRegistryIds(ctx));

    return deduplicateIssuesById(issues);
  },
};

// Groups scripts by the file path they invoke (first "scripts/..." token in
// the command) and flags when 2+ distinct script names invoke the exact
// same target file -- a strong, low-noise duplicate-entrypoint signal.
function findDuplicateScriptEntrypoints(scripts: Record<string, string>): AuditIssue[] {
  const byTarget = new Map<string, string[]>();
  for (const [name, command] of Object.entries(scripts)) {
    const match = command.match(/\b(scripts\/[\w./-]+\.[cm]?[jt]sx?)\b/);
    if (!match) continue;
    const target = match[1];
    const names = byTarget.get(target) ?? [];
    names.push(name);
    byTarget.set(target, names);
  }

  const issues: AuditIssue[] = [];
  for (const [target, names] of byTarget) {
    if (names.length < 2) continue;
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["script-entrypoint-candidate", target],
        title: `Multiple npm scripts may be duplicate entrypoints for "${target}"`,
        description: `Scripts ${sortedNames.map((n) => `"${n}"`).join(", ")} all invoke "${target}" -- this may indicate duplicate/parallel CLI entrypoints for the same feature, or may be intentional aliasing. Inspect manually before consolidating.`,
        severity: "medium",
        confidence: "medium",
        falsePositiveRisk: "medium",
        category: "duplicate-implementation-candidate",
        recommendedAction: "Manually confirm whether these scripts are intentional aliases or accidental duplicates before consolidating or removing any of them.",
        suggestedFixStrategy: "If duplicated unintentionally, keep one canonical script name and remove or redirect the others.",
        validationCommands: ["npm run audit -- --types code-rot --include package"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "reference",
            message: `${sortedNames.length} package.json scripts invoke the same target file.`,
            filePath: "package.json",
            excerpt: sortedNames.join(", "),
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: ["package.json", target],
      })
    );
  }
  return issues;
}

function findParallelDirectories(relativePaths: readonly string[]): AuditIssue[] {
  const topSegments = new Set(relativePaths.map((p) => firstPathSegment(p)).filter((s): s is string => s !== null));
  // Also consider the file itself as a "segment" for root-level layout
  // (rare, but keeps this check symmetric for flat projects).
  for (const p of relativePaths) {
    if (!p.includes("/")) topSegments.add(p);
  }

  const issues: AuditIssue[] = [];
  for (const [a, b] of PARALLEL_DIR_PAIRS) {
    if (topSegments.has(a) && topSegments.has(b)) {
      issues.push(
        makeCodeRotIssue({
          auditType: "code-rot",
          detectorId: DETECTOR_ID,
          idCues: ["parallel-directory-candidate", a, b],
          title: `Both "${a}/" and "${b}/" exist as top-level directories`,
          description: `Both "${a}/" and "${b}/" are present at the project root -- this may indicate parallel/overlapping directories for the same responsibility. Inspect manually before consolidating.`,
          severity: "low",
          confidence: "low",
          falsePositiveRisk: "medium",
          category: "duplicate-implementation-candidate",
          recommendedAction: `Confirm whether "${a}/" and "${b}/" serve distinct purposes; if not, consolidate into one.`,
          suggestedFixStrategy: `Merge "${a}/" and "${b}/" or rename one to make the distinction explicit.`,
          validationCommands: ["npm run audit -- --types code-rot --include architecture"],
          releaseBlocking: false,
          implementationBlocking: false,
          autoFixEligible: false,
          evidence: [
            {
              kind: "observation",
              message: `Both "${a}/" and "${b}/" exist as top-level project directories.`,
              source: DETECTOR_ID,
              confidence: "low",
            },
          ],
          affectedFiles: [`${a}/`, `${b}/`],
        })
      );
    }
  }
  return issues;
}

// Weak/low-confidence signal: the same basename repeated across 2-3
// unrelated top-level source roots, excluding generic infra names (index,
// types, config, etc.) that legitimately repeat by convention.
function findDuplicateBasenamesAcrossRoots(sourceRelativePaths: readonly string[]): AuditIssue[] {
  const byBasename = new Map<string, Set<string>>();
  for (const relativePath of sourceRelativePaths) {
    const base = baseNameNoExt(relativePath).toLowerCase();
    if (GENERIC_INFRA_BASENAMES.has(base)) continue;
    const top = firstTopLevelUnderSrc(relativePath);
    if (top === null) continue;
    const roots = byBasename.get(base) ?? new Set<string>();
    roots.add(top);
    byBasename.set(base, roots);
  }

  const issues: AuditIssue[] = [];
  for (const [base, roots] of byBasename) {
    if (roots.size < 2 || roots.size > 3) continue;
    const sortedRoots = [...roots].sort((a, b) => a.localeCompare(b));
    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["basename-repeat-candidate", base, ...sortedRoots],
        title: `Basename "${base}" repeats across unrelated source roots (weak signal)`,
        description: `A file named "${base}.*" exists under multiple unrelated top-level source directories: ${sortedRoots.join(", ")}. This is a weak candidate signal for parallel implementations -- inspect manually.`,
        severity: "info",
        confidence: "low",
        falsePositiveRisk: "high",
        category: "duplicate-implementation-candidate",
        recommendedAction: "Manually confirm whether these files serve genuinely different purposes before taking any action.",
        suggestedFixStrategy: "No automatic action -- rename or consolidate only after manual review.",
        validationCommands: ["npm run audit -- --types code-rot --include architecture"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "observation",
            message: `Basename "${base}" appears under ${sortedRoots.length} different top-level source directories.`,
            source: DETECTOR_ID,
            confidence: "low",
          },
        ],
        affectedFiles: sortedRoots,
      })
    );
  }
  return issues;
}

function firstTopLevelUnderSrc(relativePath: string): string | null {
  const parts = relativePath.split("/");
  if (parts.length < 3) return null; // need at least src/<dir>/file
  if (parts[0] !== "src" && parts[0] !== "scripts") return null;
  return `${parts[0]}/${parts[1]}`;
}

// v0.3.1 Batch 4 -- source-facts-aware duplicate-declaration candidate
// check. Weak/low-confidence signal, same spirit as
// findDuplicateBasenamesAcrossRoots(): the same exported declaration name
// and kind (e.g. two exported `class Logger`) appears in 2-4 distinct
// "source"-role files that a registered analyzer actually parsed. Bounded
// to declaration kinds that carry real implementation weight
// (function/class/interface/type/enum) -- "variable"/"constant"/"method"/
// "unknown" are excluded as too noisy (methods repeat across unrelated
// classes by convention; module-scope variables/constants repeat even more
// often). Generic/lifecycle declaration names (run, init, handler, __init__,
// test_*, ...) are excluded via isGenericOrTestPrefixedDeclarationName() for
// the same reason GENERIC_INFRA_BASENAMES excludes generic file basenames
// above. Requires ctx.sourceFacts -- returns no issues when it is absent
// (e.g. existing detector unit tests that build a literal
// AuditDetectorContext without it), so this check is purely additive.
const NOISY_DECLARATION_KINDS = new Set<DeclarationFactKind>(["variable", "constant", "method", "unknown"]);

function findDuplicateDeclarationCandidates(ctx: AuditDetectorContext): AuditIssue[] {
  if (!ctx.sourceFacts) return [];
  const index = indexSourceFactsByPath(ctx.sourceFacts);
  const byKey = new Map<string, { name: string; kind: DeclarationFactKind; paths: Set<string> }>();

  for (const facts of index.values()) {
    if (facts.role !== "source") continue;
    if (facts.parseStatus !== "parsed") continue;

    for (const decl of facts.declarations) {
      if (!decl.exported) continue;
      if (NOISY_DECLARATION_KINDS.has(decl.kind)) continue;
      const nameLower = decl.name.toLowerCase();
      if (isGenericOrTestPrefixedDeclarationName(nameLower)) continue;

      // v0.3.2 Batch 2 -- the key is scoped by `facts.analyzerId` (not
      // `facts.language`) so a Python declaration is only ever compared
      // against other Python declarations, never against a same-named
      // TypeScript/JavaScript one. `analyzerId`, not `language`, is the
      // right scope here: TypeScript and JavaScript are two different
      // NormalizedLanguage values but share one analyzer
      // (typescript-javascript-analyzer) and were already compared together
      // before this batch -- scoping by `language` instead would have
      // silently split that existing, still-desired TS/JS pairing in two
      // (each side then below the "2+ files" threshold, so both would be
      // dropped entirely), which is exactly the "preserve existing
      // TypeScript/JavaScript duplicate behavior" regression this batch
      // must not introduce. Scoping by `analyzerId` fixes the real
      // cross-language bug (Python vs TS/JS) without touching TS/JS's own
      // existing behavior at all.
      const key = `${facts.analyzerId}:${decl.kind}:${nameLower}`;
      const entry = byKey.get(key) ?? { name: decl.name, kind: decl.kind, paths: new Set<string>() };
      entry.paths.add(facts.relativePath);
      byKey.set(key, entry);
    }
  }

  const issues: AuditIssue[] = [];
  for (const entry of byKey.values()) {
    if (entry.paths.size < 2 || entry.paths.size > 4) continue;
    const sortedPaths = [...entry.paths].sort((a, b) => a.localeCompare(b));

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["duplicate-declaration-candidate", entry.kind, entry.name.toLowerCase(), ...sortedPaths],
        title: `Exported ${entry.kind} "${entry.name}" is declared in ${sortedPaths.length} unrelated files (weak signal)`,
        description: `An exported ${entry.kind} named "${entry.name}" is declared in: ${sortedPaths.join(", ")}. This is a source-facts-derived candidate signal (same declaration name and kind, not a semantic-equivalence check) for parallel implementations -- inspect manually before consolidating.`,
        severity: "info",
        confidence: "low",
        falsePositiveRisk: "high",
        category: "duplicate-implementation-candidate",
        recommendedAction: "Manually confirm whether these declarations serve genuinely different purposes before taking any action.",
        suggestedFixStrategy: "No automatic action -- rename or consolidate only after manual review.",
        validationCommands: ["npm run audit -- --types code-rot --include architecture"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "reference",
            message: `Source facts: an exported ${entry.kind} named "${entry.name}" was parsed in ${sortedPaths.length} distinct files.`,
            excerpt: sortedPaths.join(", "),
            source: DETECTOR_ID,
            confidence: "low",
          },
        ],
        affectedFiles: sortedPaths,
      })
    );
  }
  return issues;
}

// Cheap regex scan (not a semantic parse) of already-small detector source
// files for exported `id: "..."` string literals. Flags duplicates only if
// genuinely found via this file-based check -- per the spec's own allowed
// simplification, this does not attempt to reconcile against
// DEFAULT_AUDIT_REGISTRY at runtime (that would be circular).
function findDuplicateDetectorRegistryIds(ctx: AuditDetectorContext): AuditIssue[] {
  const detectorFiles = ctx.inventory.sourceFiles.filter((f) => /\/detectors\/[\w-]+\.ts$/.test(f.relativePath));
  if (detectorFiles.length === 0) return [];

  const idsToFiles = new Map<string, string[]>();
  for (const file of detectorFiles) {
    const content = readBoundedFileText(ctx.target.rootPath, file.relativePath, file.sizeBytes, MAX_READ_BYTES);
    if (content === null) continue;
    const match = content.match(/\bid:\s*DETECTOR_ID\b/) ? content.match(/const DETECTOR_ID\s*=\s*"([^"]+)"/) : content.match(/\bid:\s*"([^"]+)"/);
    if (!match) continue;
    const id = match[1];
    const files = idsToFiles.get(id) ?? [];
    files.push(file.relativePath);
    idsToFiles.set(id, files);
  }

  const issues: AuditIssue[] = [];
  for (const [id, files] of idsToFiles) {
    if (files.length < 2) continue;
    const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));
    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["duplicate-detector-id", id],
        title: `Multiple detector files declare the same detector id "${id}"`,
        description: `Files ${sortedFiles.map((f) => `"${f}"`).join(", ")} appear to declare the same detector id "${id}". Registry construction rejects true duplicate ids at runtime; this file-based scan is a defensive early signal.`,
        severity: "medium",
        confidence: "medium",
        falsePositiveRisk: "low",
        category: "duplicate-implementation-candidate",
        recommendedAction: "Rename one of the conflicting detector ids.",
        suggestedFixStrategy: `Give each detector a unique id string.`,
        validationCommands: ["npm run audit -- --types code-rot --include architecture"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "reference",
            message: `Detector id "${id}" found in ${sortedFiles.length} files.`,
            excerpt: sortedFiles.join(", "),
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: sortedFiles,
      })
    );
  }
  return issues;
}
