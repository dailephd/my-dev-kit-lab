import fs from "node:fs";
import path from "node:path";
import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import type { SourceOfTruthSnapshot } from "../../core/sourceOfTruth.js";
import {
  currentClaimPatternFor,
  plannedClaimPatternFor,
  FULL_RELEASE_GATE_FOR_SCOPED_CHECKS_PATTERN,
  isNegatedNearby,
} from "../utils/docClaimPatterns.js";
import { deduplicateIssuesById, makeCodeRotIssue } from "../utils/issueFactories.js";
import { splitLines } from "../utils/textLines.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 3 — documentation/code mismatch detector.
//
// Deterministic, regex/structured-cue only (no LLM, no broad semantic
// interpretation, per Batch 3 scope). Publish/release claims and doc-vs-
// package version mismatches are deliberately owned by
// packageReleaseRotDetector.ts instead of here (both detectors' Batch 3
// spec sections list overlapping bullets for those two checks; this
// detector focuses on feature-implementation claims and the
// full-release-gate-for-scoped-checks wording pattern, so the same
// underlying signal is never reported twice by two different detectors).
// ---------------------------------------------------------------------------

const DETECTOR_ID = "docs-code-mismatch";
const MAX_DOC_READ_BYTES = 200_000;

type FeatureCheck = {
  featureId: string;
  label: string;
  subjectPattern: string;
  isImplemented: (sourceOfTruth: SourceOfTruthSnapshot) => boolean;
};

// Deliberately small and conservative -- only features with an unambiguous,
// directly-observable source-of-truth signal are checked. Audit's own
// implementation status is intentionally excluded to avoid a
// self-referential "is the audit tool auditing claims about itself"
// complication in this batch.
const FEATURE_CHECKS: readonly FeatureCheck[] = [
  {
    featureId: "security-validation",
    label: "security validation",
    subjectPattern: "security validation",
    isImplemented: (sot) => sot.security.hasSecurityValidationSourceDir && sot.security.hasSecurityValidateScript,
  },
  {
    featureId: "experiment-framework",
    label: "experiment framework",
    subjectPattern: "experiment (?:framework|plugin)",
    isImplemented: (sot) => sot.experiment.hasExperimentsSourceDir && sot.experiment.hasExperimentListScript,
  },
];

export const DOCS_CODE_MISMATCH_DETECTOR: AuditDetector = {
  id: DETECTOR_ID,
  auditType: "code-rot",
  title: "Documentation/code mismatch",
  description:
    "Detects deterministic mismatches between documentation claims and source-of-truth data: feature-implementation claims and full-release-gate-for-scoped-checks wording.",
  supportedIncludeAreas: ["docs", "architecture", "cli", "package"],
  shouldSkip: (ctx: AuditDetectorContext) => {
    if (!ctx.config.include.includes("docs")) {
      return { skip: true, reason: "--include does not select docs; this detector's checks are docs-based." };
    }
    return { skip: false };
  },
  run: (ctx: AuditDetectorContext): AuditIssue[] => {
    const issues: AuditIssue[] = [];

    for (const docFile of ctx.inventory.docsFiles) {
      const content = readBoundedText(ctx.target.rootPath, docFile.relativePath, docFile.sizeBytes);
      if (content === null) continue;

      const lines = splitLines(content);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (const feature of FEATURE_CHECKS) {
          const currentMatch = currentClaimPatternFor(feature.subjectPattern).test(line);
          const plannedMatch = plannedClaimPatternFor(feature.subjectPattern).test(line);
          const implemented = feature.isImplemented(ctx.sourceOfTruth);

          if (currentMatch && plannedMatch) {
            // Same line claims both current and planned for the same
            // subject -- genuinely ambiguous, reported as low-confidence
            // info rather than skipped silently.
            issues.push(
              makeAmbiguousIssue(docFile.relativePath, i + 1, line, feature.label)
            );
            continue;
          }

          if (currentMatch && !implemented) {
            issues.push(
              makeCurrentButMissingIssue(docFile.relativePath, i + 1, line, feature)
            );
          } else if (plannedMatch && implemented) {
            issues.push(
              makePlannedButImplementedIssue(docFile.relativePath, i + 1, line, feature)
            );
          }
        }

        if (FULL_RELEASE_GATE_FOR_SCOPED_CHECKS_PATTERN.test(line) && !isNegatedNearby(line)) {
          issues.push(makeFullReleaseGateIssue(docFile.relativePath, i + 1, line));
        }
      }
    }

    return deduplicateIssuesById(issues);
  },
};

function makeCurrentButMissingIssue(
  relativePath: string,
  lineNumber: number,
  excerpt: string,
  feature: FeatureCheck
): AuditIssue {
  return makeCodeRotIssue({
    auditType: "code-rot",
    detectorId: DETECTOR_ID,
    idCues: [relativePath, "current-but-missing", feature.featureId],
    title: `Docs claim "${feature.label}" is implemented/current, but source-of-truth shows it is missing`,
    description: `${relativePath}:${lineNumber} claims "${feature.label}" is implemented/current, but the expected source directory/script is not present.`,
    severity: "high",
    confidence: "medium",
    falsePositiveRisk: "medium",
    category: "docs-feature-mismatch",
    recommendedAction: `Either implement the missing "${feature.label}" pieces, or update ${relativePath} to describe it as planned.`,
    suggestedFixStrategy: `Correct the "${feature.label}" claim in ${relativePath} to match its actual implementation state.`,
    validationCommands: ["npm run audit -- --types code-rot --include docs"],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    evidence: [
      {
        kind: "file",
        message: `Doc claims "${feature.label}" is current/implemented; source-of-truth signal indicates it is not.`,
        filePath: relativePath,
        line: lineNumber,
        excerpt: excerpt.trim().slice(0, 200),
        source: DETECTOR_ID,
        confidence: "medium",
      },
    ],
    affectedFiles: [relativePath],
  });
}

function makePlannedButImplementedIssue(
  relativePath: string,
  lineNumber: number,
  excerpt: string,
  feature: FeatureCheck
): AuditIssue {
  return makeCodeRotIssue({
    auditType: "code-rot",
    detectorId: DETECTOR_ID,
    idCues: [relativePath, "planned-but-implemented", feature.featureId],
    title: `Docs claim "${feature.label}" is planned/future, but it is already implemented`,
    description: `${relativePath}:${lineNumber} describes "${feature.label}" as planned/future, but source-of-truth shows it is already present.`,
    severity: "medium",
    confidence: "medium",
    falsePositiveRisk: "medium",
    category: "docs-feature-mismatch",
    recommendedAction: `Update ${relativePath} to describe "${feature.label}" as implemented/current.`,
    suggestedFixStrategy: `Move the "${feature.label}" description out of the planned/roadmap section in ${relativePath}.`,
    validationCommands: ["npm run audit -- --types code-rot --include docs"],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    evidence: [
      {
        kind: "file",
        message: `Doc claims "${feature.label}" is planned/future; source-of-truth signal indicates it is already implemented.`,
        filePath: relativePath,
        line: lineNumber,
        excerpt: excerpt.trim().slice(0, 200),
        source: DETECTOR_ID,
        confidence: "medium",
      },
    ],
    affectedFiles: [relativePath],
  });
}

function makeAmbiguousIssue(relativePath: string, lineNumber: number, excerpt: string, featureLabel: string): AuditIssue {
  return makeCodeRotIssue({
    auditType: "code-rot",
    detectorId: DETECTOR_ID,
    idCues: [relativePath, "ambiguous", featureLabel, String(lineNumber)],
    title: `Ambiguous implementation-status claim for "${featureLabel}"`,
    description: `${relativePath}:${lineNumber} appears to describe "${featureLabel}" as both current/implemented and planned/future in the same line -- not automatically resolvable.`,
    severity: "info",
    confidence: "low",
    falsePositiveRisk: "high",
    category: "docs-feature-mismatch-ambiguous",
    recommendedAction: "Manually review this line for clarity.",
    suggestedFixStrategy: "Rewrite the sentence so the implementation status of the feature is unambiguous.",
    validationCommands: ["npm run audit -- --types code-rot --include docs"],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    evidence: [
      {
        kind: "file",
        message: "Both a current/implemented cue and a planned/future cue matched the same line for the same subject.",
        filePath: relativePath,
        line: lineNumber,
        excerpt: excerpt.trim().slice(0, 200),
        source: DETECTOR_ID,
        confidence: "low",
      },
    ],
    affectedFiles: [relativePath],
  });
}

function makeFullReleaseGateIssue(relativePath: string, lineNumber: number, excerpt: string): AuditIssue {
  return makeCodeRotIssue({
    auditType: "code-rot",
    detectorId: DETECTOR_ID,
    idCues: [relativePath, "full-release-gate-scoped-claim", String(lineNumber)],
    title: `Docs describe a scoped run as a full release gate`,
    description: `${relativePath}:${lineNumber} appears to describe a scoped (non-full) run as if it were a complete release gate.`,
    severity: "medium",
    confidence: "medium",
    falsePositiveRisk: "medium",
    category: "docs-feature-mismatch",
    recommendedAction: `Clarify in ${relativePath} that a scoped run is not a full release gate.`,
    suggestedFixStrategy: `Add explicit "scoped run, not a full release gate" wording near this claim in ${relativePath}.`,
    validationCommands: ["npm run audit -- --types code-rot --include docs"],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    evidence: [
      {
        kind: "file",
        message: "Matched a scoped-run-described-as-full-release-gate phrasing pattern.",
        filePath: relativePath,
        line: lineNumber,
        excerpt: excerpt.trim().slice(0, 200),
        source: DETECTOR_ID,
        confidence: "medium",
      },
    ],
    affectedFiles: [relativePath],
  });
}

function readBoundedText(root: string, relativePath: string, sizeBytes: number): string | null {
  if (sizeBytes > MAX_DOC_READ_BYTES) return null;
  try {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
  } catch {
    return null;
  }
}
