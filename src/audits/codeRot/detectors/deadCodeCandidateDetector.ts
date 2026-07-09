import path from "node:path";
import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import type { InventoryFileEntry } from "../../core/projectInventory.js";
import type { PackageTruth } from "../../core/sourceOfTruth.js";
import type { SourceFileFacts } from "../../core/sourceFacts.js";
import { readBoundedFileText } from "../utils/boundedRead.js";
import { baseNameNoExt } from "../utils/filePatternUtils.js";
import { deduplicateIssuesById, makeCodeRotIssue } from "../utils/issueFactories.js";
import { collectRelativeImportBasenames, getParsedSourceFacts, indexSourceFactsByPath } from "../utils/sourceFactsLookup.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 4 — dead-code candidate detector.
//
// Every finding here is a candidate, not proof of dead code -- title wording
// stays hedged throughout. Bounded (per-file MAX_READ_BYTES skip), no
// subprocess, no exports/type-usage analysis (see SKIPPED note below).
//
// Explicitly SKIPPED (spec-documented, not implemented in this batch):
//   - "exported symbols unused" -- there is no existing safe/cheap way in
//     this repo to determine which exported symbols are referenced
//     elsewhere without a real TypeScript program (ts-morph/checker), which
//     is out of scope for a bounded regex-based detector. Not implemented.
// ---------------------------------------------------------------------------

const DETECTOR_ID = "dead-code-candidate";
const MAX_READ_BYTES = 200_000;
const OLD_DIR_SEGMENT_PATTERN = /^(old|deprecated|legacy|_archive)$/i;
const ORPHAN_GENERATED_PATTERN = /\.generated\.|\.bak$|\.orig$/;
const IMPORT_SPECIFIER_PATTERN = /(?:from|require\()\s*["']([^"']+)["']/g;
const PLANNED_LABEL_PATTERN = /\b(planned|future|roadmap|not implemented|not yet implemented|coming soon)\b/i;
const SETUP_FILE_PATTERN = /setup[tT]ests?|vitest\.setup|test-setup/i;

export const DEAD_CODE_CANDIDATE_DETECTOR: AuditDetector = {
  id: DETECTOR_ID,
  auditType: "code-rot",
  title: "Dead-code candidate",
  description:
    "Detects candidate (not proven) unused files: scripts/ files not referenced by any package.json script, source files with no in-repo importer, files under old/deprecated/legacy directories not mentioned in docs, and orphaned generated-looking files.",
  supportedIncludeAreas: ["cli", "package", "tests"],
  shouldSkip: (ctx: AuditDetectorContext) => {
    if (!ctx.config.include.includes("package") && !ctx.config.include.includes("tests")) {
      return { skip: true, reason: "--include selects neither package nor tests; this detector's checks need at least one." };
    }
    return { skip: false };
  },
  run: (ctx: AuditDetectorContext): AuditIssue[] => {
    const issues: AuditIssue[] = [];
    const pkg = ctx.sourceOfTruth.package;
    const docsConcat = concatDocsContent(ctx);

    if (ctx.config.include.includes("package") && pkg) {
      issues.push(...findUnreferencedScriptFiles(ctx, pkg));
    }

    if (ctx.config.include.includes("cli") || ctx.config.include.includes("architecture")) {
      issues.push(...findUnreferencedSourceFiles(ctx, pkg, docsConcat));
    }

    issues.push(...findOldOrDeprecatedFilesNotInDocs(ctx, docsConcat));
    issues.push(...findOrphanedGeneratedFiles(ctx.inventory.files));

    if (ctx.config.include.includes("tests")) {
      issues.push(...findUnreferencedFixtures(ctx));
    }

    return deduplicateIssuesById(issues);
  },
};

function concatDocsContent(ctx: AuditDetectorContext): string {
  const parts: string[] = [];
  for (const docFile of ctx.inventory.docsFiles) {
    const content = readBoundedFileText(ctx.target.rootPath, docFile.relativePath, docFile.sizeBytes, MAX_READ_BYTES);
    if (content !== null) parts.push(content);
  }
  return parts.join("\n");
}

function docsDescribeAsPlanned(docsConcat: string, relativePath: string): boolean {
  const base = baseNameNoExt(relativePath);
  const idx = docsConcat.indexOf(base);
  if (idx === -1) return false;
  const windowStart = Math.max(0, idx - 100);
  const windowEnd = Math.min(docsConcat.length, idx + base.length + 100);
  return PLANNED_LABEL_PATTERN.test(docsConcat.slice(windowStart, windowEnd));
}

function binTargetsAsSourceCandidates(pkg: PackageTruth): Set<string> {
  const raw: string[] = pkg.bin === null ? [] : typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin);
  const candidates = new Set<string>();
  for (const target of raw) {
    candidates.add(target);
    if (target.startsWith("dist/") && target.endsWith(".js")) {
      candidates.add(`${target.slice("dist/".length, -".js".length)}.ts`);
    }
  }
  if (pkg.main) candidates.add(pkg.main);
  if (pkg.module) candidates.add(pkg.module);
  if (pkg.types) candidates.add(pkg.types);
  return candidates;
}

function findUnreferencedScriptFiles(ctx: AuditDetectorContext, pkg: PackageTruth): AuditIssue[] {
  const scriptCommandsBlob = Object.values(pkg.scripts).join(" \n ");
  const binCandidates = binTargetsAsSourceCandidates(pkg);
  // A scripts/ file that is imported by another script (a shared helper
  // module rather than a CLI entrypoint, e.g.
  // scripts/security/resolveToolRoot.ts) is not dead code even though no
  // package.json script command names it directly -- discovered via a real
  // false positive during self-testing.
  const referencedBasenames = buildReverseReferenceIndex(ctx);
  const issues: AuditIssue[] = [];

  for (const file of ctx.inventory.scriptFiles) {
    const base = baseNameNoExt(file.relativePath);
    if (base.toLowerCase() === "index") continue;
    if (SETUP_FILE_PATTERN.test(path.basename(file.relativePath))) continue;
    if (binCandidates.has(file.relativePath)) continue;
    if (scriptCommandsBlob.includes(file.relativePath) || scriptCommandsBlob.includes(base)) continue;
    if (referencedBasenames.has(base.toLowerCase())) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["unreferenced-script-file", file.relativePath],
        title: `Script file "${file.relativePath}" is not referenced by any package.json script`,
        description: `"${file.relativePath}" exists under scripts/ but no package.json script command mentions its path or basename. This is a candidate for dead code -- confirm it isn't invoked another way (e.g. imported by another script) before removing.`,
        severity: "medium",
        confidence: "medium",
        falsePositiveRisk: "medium",
        category: "dead-code-candidate",
        recommendedAction: "Confirm the file is unused, then either add a script entry or remove the file.",
        suggestedFixStrategy: `Remove "${file.relativePath}" or wire it up to a package.json script.`,
        validationCommands: ["npm run audit -- --types code-rot --include package"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "reference",
            message: "No package.json script command references this file's path or basename.",
            filePath: file.relativePath,
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: [file.relativePath],
      })
    );
  }
  return issues;
}

function buildReverseReferenceIndex(ctx: AuditDetectorContext): Set<string> {
  // v0.3.1 Batch 4 -- seeded with basenames the TypeScript/JavaScript
  // analyzer already resolved from real import declarations (parsed files
  // only). This only ever adds references, never removes them, so it can
  // only reduce false positives relative to the regex-only scan below --
  // safe even though ctx.sourceFacts is optional (returns an empty set when
  // absent, e.g. in existing detector-only unit tests).
  const referencedBasenames = collectRelativeImportBasenames(ctx.sourceFacts);
  const allCandidateFiles: InventoryFileEntry[] = [
    ...ctx.inventory.sourceFiles,
    ...ctx.inventory.testFiles,
    ...ctx.inventory.scriptFiles,
  ];

  for (const file of allCandidateFiles) {
    const content = readBoundedFileText(ctx.target.rootPath, file.relativePath, file.sizeBytes, MAX_READ_BYTES);
    if (content === null) continue;

    IMPORT_SPECIFIER_PATTERN.lastIndex = 0;
    for (const match of content.matchAll(IMPORT_SPECIFIER_PATTERN)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue; // only relative/local specifiers are meaningful here
      const specifierBase = baseNameNoExt(specifier.split("?")[0]);
      referencedBasenames.add(specifierBase.toLowerCase());
    }
  }
  return referencedBasenames;
}

function findUnreferencedSourceFiles(ctx: AuditDetectorContext, pkg: PackageTruth | null, docsConcat: string): AuditIssue[] {
  const referencedBasenames = buildReverseReferenceIndex(ctx);
  const binCandidates = pkg ? binTargetsAsSourceCandidates(pkg) : new Set<string>();
  const sourceFactsIndex = indexSourceFactsByPath(ctx.sourceFacts);
  const issues: AuditIssue[] = [];

  for (const file of ctx.inventory.sourceFiles) {
    if (file.sizeBytes > MAX_READ_BYTES) continue;
    // benchmarks/ and examples/ hold standalone fixture/example project
    // content (often in other languages, e.g. Python) that is meant to be
    // read by the tool under test, not imported by this project's own
    // TS/JS import graph -- scanning them against a TS/JS import-specifier
    // reverse-reference index produces false positives, confirmed via
    // self-testing.
    if (file.relativePath.startsWith("benchmarks/") || file.relativePath.startsWith("examples/")) continue;
    const base = baseNameNoExt(file.relativePath);
    if (base.toLowerCase() === "index") continue;
    if (SETUP_FILE_PATTERN.test(path.basename(file.relativePath))) continue;
    if (binCandidates.has(file.relativePath)) continue;
    if (docsDescribeAsPlanned(docsConcat, file.relativePath)) continue;
    if (referencedBasenames.has(base.toLowerCase())) continue;

    const evidence: AuditIssue["evidence"] = [
      {
        kind: "observation",
        message: "No relative import/require specifier in the scanned source/test/script set resolves to this file's basename.",
        filePath: file.relativePath,
        source: DETECTOR_ID,
        confidence: "low",
      },
    ];
    // v0.3.1 Batch 4 -- when the TypeScript/JavaScript analyzer actually
    // parsed this file, surface its export count as extra candidate
    // evidence (an exported symbol with zero detected external references
    // is more suspicious than an unexported one). This never changes
    // whether the issue is emitted, only its evidence -- the flagging
    // decision above is unchanged from the existing basename-reference
    // heuristic.
    const facts = getParsedSourceFacts(sourceFactsIndex, file.relativePath);
    if (facts) {
      evidence.push(buildSourceFactsEvidence(facts));
    }

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["unreferenced-source-file", file.relativePath],
        title: `Source file "${file.relativePath}" has no detected in-repo importer`,
        description: `No other source or test file's relative import/require specifier appears to reference "${file.relativePath}" by basename. This is a bounded regex-based candidate signal, not a type-level unused-file proof -- confirm manually (dynamic imports, re-exports, or CLI-only usage can evade this scan).`,
        severity: "low",
        confidence: "low",
        falsePositiveRisk: "medium",
        category: "dead-code-candidate",
        recommendedAction: "Confirm the file is genuinely unused before removing it.",
        suggestedFixStrategy: `Remove "${file.relativePath}" if confirmed unused, or wire it into an existing import graph.`,
        validationCommands: ["npm run audit -- --types code-rot --include cli"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence,
        affectedFiles: [file.relativePath],
      })
    );
  }
  return issues;
}

// v0.3.1 Batch 4 -- describes a parsed file's source-facts shape as an
// evidence entry. Only called for parseStatus "parsed" facts (see callers),
// since file-level-only/parse-error facts carry empty fact arrays that
// would misleadingly read as "zero exports" rather than "unknown".
function buildSourceFactsEvidence(facts: SourceFileFacts): AuditIssue["evidence"][number] {
  return {
    kind: "reference",
    message: `Source facts: the TypeScript/JavaScript analyzer parsed this file and recorded ${facts.exports.length} export(s), ${facts.declarations.length} declaration(s), and ${facts.imports.length} import(s).`,
    filePath: facts.relativePath,
    source: DETECTOR_ID,
    confidence: "medium",
  };
}

function findOldOrDeprecatedFilesNotInDocs(ctx: AuditDetectorContext, docsConcat: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const file of ctx.inventory.files) {
    const segments = file.relativePath.split("/");
    const hasOldSegment = segments.slice(0, -1).some((seg) => OLD_DIR_SEGMENT_PATTERN.test(seg));
    if (!hasOldSegment) continue;
    if (docsConcat.includes(file.relativePath) || docsConcat.includes(path.basename(file.relativePath))) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["old-deprecated-file-not-in-docs", file.relativePath],
        title: `File under an old/deprecated/legacy directory is not mentioned in docs: "${file.relativePath}"`,
        description: `"${file.relativePath}" sits under a directory named old/deprecated/legacy/_archive, and no doc file mentions its path or basename. This is a candidate for dead code.`,
        severity: "medium",
        confidence: "medium",
        falsePositiveRisk: "low",
        category: "dead-code-candidate",
        recommendedAction: "Confirm the file is genuinely obsolete, then remove it or document why it is retained.",
        suggestedFixStrategy: `Remove "${file.relativePath}" or add a doc note explaining why it is kept.`,
        validationCommands: ["npm run audit -- --types code-rot --include cli"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: "File is under an old/deprecated/legacy/_archive-named directory and is not mentioned in any doc file.",
            filePath: file.relativePath,
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: [file.relativePath],
      })
    );
  }
  return issues;
}

function findOrphanedGeneratedFiles(files: readonly InventoryFileEntry[]): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const file of files) {
    if (file.likelyGenerated) continue; // already caught by inventory's own generated category
    if (!ORPHAN_GENERATED_PATTERN.test(path.basename(file.relativePath))) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["orphaned-generated-looking-file", file.relativePath],
        title: `Orphaned generated-looking file: "${file.relativePath}"`,
        description: `"${file.relativePath}" has a generated/backup-looking name (.generated., .bak, .orig) but is not classified as generated content by the project inventory. This is a candidate for dead code.`,
        severity: "low",
        confidence: "medium",
        falsePositiveRisk: "medium",
        category: "dead-code-candidate",
        recommendedAction: "Confirm the file is stale generated/backup content, then remove it.",
        suggestedFixStrategy: `Remove "${file.relativePath}" if confirmed stale.`,
        validationCommands: ["npm run audit -- --types code-rot --include cli"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: "Filename matches a generated/backup-looking pattern outside the inventory's own generated-file classification.",
            filePath: file.relativePath,
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: [file.relativePath],
      })
    );
  }
  return issues;
}

// Housed here (not in testRotDetector.ts) per the Batch 4 spec's explicit
// instruction to implement this check exactly once to avoid duplicate
// reporting between the two detectors.
function findUnreferencedFixtures(ctx: AuditDetectorContext): AuditIssue[] {
  const fixtureFiles = ctx.inventory.files.filter((f) => f.relativePath.includes("/fixtures/") || f.relativePath.startsWith("fixtures/"));
  if (fixtureFiles.length === 0) return [];

  const testFilesContent: string[] = [];
  for (const testFile of ctx.inventory.testFiles) {
    const content = readBoundedFileText(ctx.target.rootPath, testFile.relativePath, testFile.sizeBytes, MAX_READ_BYTES);
    if (content !== null) testFilesContent.push(content);
  }
  const combinedTestContent = testFilesContent.join("\n");

  const issues: AuditIssue[] = [];
  for (const fixture of fixtureFiles) {
    const base = path.basename(fixture.relativePath);
    if (combinedTestContent.includes(base)) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["unreferenced-fixture", fixture.relativePath],
        title: `Fixture "${fixture.relativePath}" is not referenced by any test file`,
        description: `"${fixture.relativePath}" is under a fixtures/ directory, but its basename does not appear in any test file's content. This is a weak candidate signal for an unused fixture.`,
        severity: "info",
        confidence: "low",
        falsePositiveRisk: "high",
        category: "dead-code-candidate",
        recommendedAction: "Confirm the fixture is genuinely unused before removing it.",
        suggestedFixStrategy: `Remove "${fixture.relativePath}" if confirmed unused.`,
        validationCommands: ["npm run audit -- --types code-rot --include tests"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "observation",
            message: "Fixture basename does not appear in any test file's bounded content scan.",
            filePath: fixture.relativePath,
            source: DETECTOR_ID,
            confidence: "low",
          },
        ],
        affectedFiles: [fixture.relativePath],
      })
    );
  }
  return issues;
}
