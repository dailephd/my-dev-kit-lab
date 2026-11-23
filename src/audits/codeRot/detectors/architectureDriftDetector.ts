import fs from "node:fs";
import path from "node:path";
import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import { currentClaimPatternFor, plannedClaimPatternFor } from "../utils/docClaimPatterns.js";
import { splitLines } from "../utils/textLines.js";
import { androidValidationImplementation, type AndroidImplementation } from "../utils/androidValidationEvidence.js";
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
const AUDIT_FRAMEWORK_SUBJECT = "(?:audit (?:framework|contracts)|code rot detector)";
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
    const androidImplementation = androidValidationImplementation(ctx);
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
      issues.push(...findUnsupportedCurrentClaims(ctx, docFile.relativePath, content, androidImplementation));
    }

    return deduplicateIssuesById(issues);
  },
};


type ClaimContext = "current" | "planned" | "historical";

function architectureClaimLines(content: string) {
  const headings: { level: number; context: ClaimContext | undefined }[] = [];
  let fence: string | undefined;
  let plannedList = false;
  const lines: { line: string; prose: string; context: ClaimContext }[] = [];
  for (const line of splitLines(content)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker && (!fence || (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()))) {
      fence = fence ? undefined : marker[1];
      continue;
    }
    if (fence || /^\s*>|^ {4}\S/.test(line)) continue;
    const heading = /^ {0,3}(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      while (headings.length && headings.at(-1)!.level >= level) headings.pop();
      const title = heading[2];
      const context = /\b(?:historical|history|archived|previous releases?)\b|^v\d+\.\d+/i.test(title) ? "historical"
        : PLANNED_FRAMING_PATTERN.test(title) && !/\bversus\b/i.test(title) ? "planned"
        : /^(?:current|implemented)\b/i.test(title) ? "current" : undefined;
      headings.push({ level, context });
      plannedList = false;
      continue;
    }
    const prose = line.replace(/(`+).*?\1|"[^"]*"/g, " ");
    if (/^\s*(?:the following|features?)\b.*\b(?:planned|not implemented)\b.*:\s*$/i.test(prose)) {
      plannedList = true;
      continue;
    }
    const listItem = /^\s*[-*]\s+/.test(prose);
    if (prose.trim() && !listItem) plannedList = false;
    const enclosing = headings.some(item => item.context === "historical") ? "historical"
      : [...headings].reverse().find(item => item.context)?.context ?? "current";
    const context = enclosing === "current" && plannedList && listItem ? "planned" : enclosing;
    lines.push({ line, prose, context });
  }
  return lines;
}

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

  for (const { line, context } of architectureClaimLines(content)) {
    if (context !== "current" || /\b(?:if|hypothetical|for example|when present|file named|named)\b/i.test(line)) continue;
    for (const match of line.matchAll(BACKTICK_SRC_PATH_PATTERN)) {
      const claimedPath = match[1];
      if (seen.has(claimedPath) || pathExistsInInventoryOrDisk(ctx, claimedPath)) continue;
      seen.add(claimedPath);
      const isHistorical = HISTORICAL_FRAMING_PATTERN.test(line);

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

    const explicitClaim = plannedClaimPatternFor(AUDIT_FRAMEWORK_SUBJECT);
    const subject = new RegExp("\\b" + AUDIT_FRAMEWORK_SUBJECT + "\\b", "i");
    const match = architectureClaimLines(content).find(({ prose, context }) =>
      context !== "historical" && !/\b(?:for example|suppose|hypothetical)\b/i.test(prose) &&
      (explicitClaim.test(prose) || (context === "planned" && /^\s*[-*]\s+(?:generic\s+)?(?:audit (?:framework|contracts)|code rot detector)\b/i.test(prose))));
    const subjectMatch = match?.prose.match(subject);
    if (!subjectMatch) continue;

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

function findUnsupportedCurrentClaims(ctx: AuditDetectorContext, docRelativePath: string, content: string, androidImplementation: AndroidImplementation): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const subjects: { id: string; label: string; pattern: string }[] = [
    { id: "manual-pentest", label: "manual pentest", pattern: "manual pentest" },
    { id: "android-validation", label: "Android/mobile validation", pattern: "(?:android (?:validation|support))" },
  ];

  for (const subject of subjects) {
    const pattern = currentClaimPatternFor(subject.pattern);
    const match = architectureClaimLines(content)
      .filter(({ context, prose }) => context === "current" && !/\b(?:for example|suppose|hypothetical)\b/i.test(prose))
      .map(({ prose }) => pattern.exec(prose))
      .find(candidate => candidate !== null);
    if (!match) continue;
    if (subject.id === "android-validation" && androidImplementation !== "absent") {
      ctx.reportCoverage?.({
        detectorId: DETECTOR_ID, predicate: "documented Android validation implementation",
        source: { kind: "file", identity: docRelativePath }, capability: "command-registration",
        actualStatus: androidImplementation, status: androidImplementation === "implemented" ? "QUALIFIED" : "UNDETERMINED",
        mandatory: false, diagnostic: "",
        reason: androidImplementation === "implemented"
          ? "An inventoried registered command and its bounded Android implementation agree with the claim."
          : "The available command registration and source do not settle this claim.",
      });
      continue;
    }

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
