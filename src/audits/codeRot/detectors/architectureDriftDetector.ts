import fs from "node:fs";
import path from "node:path";
import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import { currentClaimPatternFor } from "../utils/docClaimPatterns.js";
import { readBoundedFileText } from "../utils/boundedRead.js";
import { deduplicateIssuesById, makeCodeRotIssue } from "../utils/issueFactories.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 4 — architecture drift detector.
//
// Deterministic path/claim checks only -- no semantic judgment. Two of the
// checks below (stale/missing backtick path mentions, and the hardcoded
// "audit framework described as planned while implemented" check) are
// deliberately scoped to docs/ARCHITECTURE.md and docs/CURRENT_STATE.md
// only, not every doc file. Both files' own headers state their purpose is
// describing CURRENT implemented state ("This file is the concise source of
// truth for the checked-in implementation" / "Current implemented
// architecture"). docs/ROADMAP.md, by contrast, is full of legitimate
// backtick-quoted "Suggested architecture" paths for genuinely
// not-yet-built future work items -- scanning it with the same "does this
// path exist" check would produce many false positives against accurate,
// correctly-labeled-as-future roadmap content. Restricting scope keeps this
// detector's signal high-confidence.
// ---------------------------------------------------------------------------

const DETECTOR_ID = "architecture-drift";
const MAX_READ_BYTES = 200_000;
const CURRENT_STATE_DOC_BASENAMES = new Set(["architecture.md", "current_state.md"]);
const BACKTICK_SRC_PATH_PATTERN = /`(src\/[\w./-]+|scripts\/[\w./-]+)`/g;
const HISTORICAL_FRAMING_PATTERN = /\b(historical|previously|used to|no longer|removed|deprecated)\b/i;
const PLANNED_FRAMING_PATTERN = /\b(planned|future|roadmap|not (?:yet )?implemented)\b/i;
const AUDIT_FRAMEWORK_SUBJECT_PATTERN = /\baudit (?:framework|contracts)\b|\bcode rot detector\b/i;
const MIN_SOURCE_FILES_FOR_MAJOR_DIR = 3;

export const ARCHITECTURE_DRIFT_DETECTOR: AuditDetector = {
  id: DETECTOR_ID,
  auditType: "code-rot",
  title: "Architecture drift",
  description:
    "Detects deterministic drift between documentation and actual source layout: doc-claimed paths that don't exist, the audit framework described as planned while implemented, major source directories missing from ARCHITECTURE.md, and unhedged manual-pentest/Android implementation claims.",
  supportedIncludeAreas: ["architecture", "docs", "package", "cli"],
  shouldSkip: (ctx: AuditDetectorContext) => {
    if (!ctx.config.include.includes("docs") && !ctx.config.include.includes("architecture")) {
      return { skip: true, reason: "--include selects neither docs nor architecture; this detector's checks are docs-based." };
    }
    return { skip: false };
  },
  run: (ctx: AuditDetectorContext): AuditIssue[] => {
    const issues: AuditIssue[] = [];
    const hasAndroidValidationSource = fs.existsSync(
      path.join(ctx.target.rootPath, "src", "mobile", "android", "validate", "validateAndroidTarget.ts")
    );
    const currentStateDocs = ctx.inventory.docsFiles.filter((f) => CURRENT_STATE_DOC_BASENAMES.has(path.basename(f.relativePath).toLowerCase()));

    for (const docFile of currentStateDocs) {
      const content = readBoundedFileText(ctx.target.rootPath, docFile.relativePath, docFile.sizeBytes, MAX_READ_BYTES);
      if (content === null) continue;

      issues.push(...findStaleOrMissingBacktickPaths(ctx, docFile.relativePath, content));
    }

    issues.push(...findAuditFrameworkDescribedAsPlanned(ctx, currentStateDocs));

    const architectureDoc = ctx.inventory.docsFiles.find((f) => path.basename(f.relativePath).toLowerCase() === "architecture.md");
    if (architectureDoc) {
      const content = readBoundedFileText(ctx.target.rootPath, architectureDoc.relativePath, architectureDoc.sizeBytes, MAX_READ_BYTES);
      if (content !== null) {
        issues.push(...findMajorDirsAbsentFromArchitectureDoc(ctx, architectureDoc.relativePath, content));
      }
    }

    for (const docFile of ctx.inventory.docsFiles) {
      const content = readBoundedFileText(ctx.target.rootPath, docFile.relativePath, docFile.sizeBytes, MAX_READ_BYTES);
      if (content === null) continue;
      issues.push(...findUnsupportedCurrentClaims(docFile.relativePath, content, hasAndroidValidationSource));
    }

    return deduplicateIssuesById(issues);
  },
};

function pathExistsInInventoryOrDisk(ctx: AuditDetectorContext, claimedPath: string): boolean {
  const trimmed = claimedPath.replace(/\/$/, "");
  const inventoryHit = ctx.inventory.files.some((f) => f.relativePath === trimmed || f.relativePath.startsWith(`${trimmed}/`));
  if (inventoryHit) return true;
  try {
    return fs.existsSync(path.join(ctx.target.rootPath, trimmed));
  } catch {
    return false;
  }
}

function findStaleOrMissingBacktickPaths(ctx: AuditDetectorContext, docRelativePath: string, content: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const seen = new Set<string>();

  BACKTICK_SRC_PATH_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(BACKTICK_SRC_PATH_PATTERN)) {
    const claimedPath = match[1];
    if (seen.has(claimedPath)) continue;
    seen.add(claimedPath);
    if (pathExistsInInventoryOrDisk(ctx, claimedPath)) continue;

    const matchIndex = match.index ?? 0;
    const windowStart = Math.max(0, matchIndex - 200);
    const windowEnd = Math.min(content.length, matchIndex + claimedPath.length + 200);
    const window = content.slice(windowStart, windowEnd);
    const isHistorical = HISTORICAL_FRAMING_PATTERN.test(window);

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [docRelativePath, isHistorical ? "stale-path-mention" : "claimed-path-missing", claimedPath],
        title: isHistorical
          ? `${docRelativePath} mentions a stale (historically-framed) path: "${claimedPath}"`
          : `${docRelativePath} claims path "${claimedPath}" exists, but it does not`,
        description: isHistorical
          ? `${docRelativePath} mentions "${claimedPath}" with historical framing, and the path no longer exists on disk. Low-severity because it is explicitly framed as historical.`
          : `${docRelativePath} references "${claimedPath}" as a current path (backtick code span), but no such file or directory exists in the project.`,
        severity: isHistorical ? "low" : "medium",
        confidence: isHistorical ? "medium" : "medium",
        falsePositiveRisk: "medium",
        category: "architecture-drift",
        recommendedAction: isHistorical
          ? `Confirm whether the historical reference to "${claimedPath}" is still useful context.`
          : `Update ${docRelativePath} to reference an existing path, or restore/implement "${claimedPath}".`,
        suggestedFixStrategy: `Correct or remove the "${claimedPath}" reference in ${docRelativePath}.`,
        validationCommands: ["npm run audit -- --types code-rot --include architecture,docs"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: "Backtick-quoted path does not exist on disk.",
            filePath: docRelativePath,
            excerpt: claimedPath,
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: [docRelativePath],
      })
    );
  }
  return issues;
}

function findAuditFrameworkDescribedAsPlanned(ctx: AuditDetectorContext, currentStateDocs: readonly { relativePath: string; sizeBytes: number }[]): AuditIssue[] {
  const auditImplemented = fs.existsSync(path.join(ctx.target.rootPath, "src", "audits")) && "audit" in (ctx.sourceOfTruth.package?.scripts ?? {});
  if (!auditImplemented) return [];

  const issues: AuditIssue[] = [];
  for (const docFile of currentStateDocs) {
    const content = readBoundedFileText(ctx.target.rootPath, docFile.relativePath, docFile.sizeBytes, MAX_READ_BYTES);
    if (content === null) continue;

    AUDIT_FRAMEWORK_SUBJECT_PATTERN.lastIndex = 0;
    const subjectMatch = AUDIT_FRAMEWORK_SUBJECT_PATTERN.exec(content);
    if (!subjectMatch) continue;

    const matchIndex = subjectMatch.index;
    const windowStart = Math.max(0, matchIndex - 400);
    const windowEnd = Math.min(content.length, matchIndex + subjectMatch[0].length + 400);
    const window = content.slice(windowStart, windowEnd);
    if (!PLANNED_FRAMING_PATTERN.test(window)) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [docFile.relativePath, "audit-framework-planned-but-implemented"],
        title: `${docFile.relativePath} describes the audit framework as planned/future, but it is already implemented`,
        description: `${docFile.relativePath} mentions "${subjectMatch[0]}" near planned/future/not-implemented wording, but src/audits exists and package.json defines an "audit" script -- the audit framework is already implemented, not merely planned.`,
        severity: "high",
        confidence: "medium",
        falsePositiveRisk: "medium",
        category: "architecture-drift",
        recommendedAction: `Update ${docFile.relativePath} to describe the audit framework's actual current implementation status.`,
        suggestedFixStrategy: `Move the audit-framework description in ${docFile.relativePath} out of the planned/future section.`,
        validationCommands: ["npm run audit -- --types code-rot --include architecture,docs"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: "Doc describes the audit framework as planned/future near this mention, but src/audits exists and an \"audit\" npm script is defined.",
            filePath: docFile.relativePath,
            excerpt: subjectMatch[0],
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: [docFile.relativePath],
      })
    );
  }
  return issues;
}

function findMajorDirsAbsentFromArchitectureDoc(ctx: AuditDetectorContext, docRelativePath: string, content: string): AuditIssue[] {
  const countsByDir = new Map<string, number>();
  for (const file of ctx.inventory.sourceFiles) {
    const parts = file.relativePath.split("/");
    if (parts[0] !== "src" || parts.length < 3) continue;
    const dirName = parts[1];
    countsByDir.set(dirName, (countsByDir.get(dirName) ?? 0) + 1);
  }

  const issues: AuditIssue[] = [];
  const sortedDirs = [...countsByDir.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [dirName, count] of sortedDirs) {
    if (count < MIN_SOURCE_FILES_FOR_MAJOR_DIR) continue;
    if (content.includes(dirName)) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [docRelativePath, "major-dir-absent-from-architecture-doc", dirName],
        title: `Major implemented directory "src/${dirName}" is not mentioned in ${docRelativePath}`,
        description: `"src/${dirName}" contains ${count} source files but is never mentioned in ${docRelativePath}.`,
        severity: "medium",
        confidence: "medium",
        falsePositiveRisk: "medium",
        category: "architecture-drift",
        recommendedAction: `Add "src/${dirName}" to ${docRelativePath}'s module map.`,
        suggestedFixStrategy: `Document the responsibility of "src/${dirName}" in ${docRelativePath}.`,
        validationCommands: ["npm run audit -- --types code-rot --include architecture,docs"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "observation",
            message: `"src/${dirName}" has ${count} source files and is not mentioned anywhere in ${docRelativePath}.`,
            filePath: docRelativePath,
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: [docRelativePath],
      })
    );
  }
  return issues;
}

function findUnsupportedCurrentClaims(docRelativePath: string, content: string, hasAndroidValidationSource: boolean): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const subjects: { id: string; label: string; pattern: string }[] = [
    { id: "manual-pentest", label: "manual pentest", pattern: "manual pentest" },
    { id: "android-validation", label: "Android/mobile validation", pattern: "(?:android (?:validation|support))" },
  ];

  for (const subject of subjects) {
    if (subject.id === "android-validation" && hasAndroidValidationSource) continue;
    const pattern = currentClaimPatternFor(subject.pattern);
    const match = pattern.exec(content);
    if (!match) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [docRelativePath, "unsupported-current-claim", subject.id],
        title: `${docRelativePath} claims "${subject.label}" is implemented/current`,
        description: `${docRelativePath} contains an unhedged "${subject.label} is implemented/current" claim, but there is no corresponding source signal for this repo.`,
        severity: "high",
        confidence: "medium",
        falsePositiveRisk: "medium",
        category: "architecture-drift",
        recommendedAction: `Confirm whether "${subject.label}" is actually implemented; if not, correct ${docRelativePath}.`,
        suggestedFixStrategy: `Rephrase the "${subject.label}" claim in ${docRelativePath} to accurately reflect its planned status.`,
        validationCommands: ["npm run audit -- --types code-rot --include architecture,docs"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: `Matched an unhedged "${subject.label} is implemented/current" claim pattern.`,
            filePath: docRelativePath,
            excerpt: match[0].slice(0, 200),
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: [docRelativePath],
      })
    );
  }
  return issues;
}
