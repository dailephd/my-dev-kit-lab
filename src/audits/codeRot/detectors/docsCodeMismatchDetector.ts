import fs from "node:fs";
import path from "node:path";
import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import type { SourceOfTruthSnapshot } from "../../core/sourceOfTruth.js";
import { collectJvmProjectMetadata, type JvmProjectMetadataSnapshot } from "../../core/jvmProjectMetadata.js";
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

// v0.3.3 Batch 3 -- FeatureCheck.isImplemented now receives both
// sourceOfTruth (existing) and jvmMetadata (new) so a Gradle/Maven/Android
// feature check can be expressed the same way the existing npm-focused
// checks already are, without a parallel check mechanism.
type FeatureCheckContext = {
  sourceOfTruth: SourceOfTruthSnapshot;
  jvmMetadata: JvmProjectMetadataSnapshot;
};
type FeatureCheck = {
  featureId: string;
  label: string;
  subjectPattern: string;
  isImplemented: (ctx: FeatureCheckContext) => boolean;
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
    isImplemented: (ctx) => ctx.sourceOfTruth.security.hasSecurityValidationSourceDir && ctx.sourceOfTruth.security.hasSecurityValidateScript,
  },
  {
    featureId: "experiment-framework",
    label: "experiment framework",
    subjectPattern: "experiment (?:framework|plugin)",
    isImplemented: (ctx) => ctx.sourceOfTruth.experiment.hasExperimentsSourceDir && ctx.sourceOfTruth.experiment.hasExperimentListScript,
  },
  // v0.3.3 Batch 3 -- Gradle/Maven/Android feature-claim checks, using only
  // static JVM metadata (see jvmProjectMetadata.ts). Never runs Gradle,
  // Maven, or any Android tooling.
  {
    featureId: "gradle-support",
    label: "Gradle",
    subjectPattern: "Gradle",
    isImplemented: (ctx) => ctx.jvmMetadata.hasGradleBuild || ctx.jvmMetadata.hasGradleSettings,
  },
  {
    featureId: "maven-support",
    label: "Maven",
    subjectPattern: "Maven",
    isImplemented: (ctx) => ctx.jvmMetadata.hasMavenPom,
  },
  {
    featureId: "android-validation",
    label: "Android validation",
    // Negative lookbehind excludes "(non-Android)"-style negated mentions
    // (this project's own docs legitimately describe things as
    // "the general (non-Android) ... adapter", which is a claim about the
    // *adapter*, not about Android -- without this guard, "is implemented"
    // appearing later in the same sentence about the adapter would
    // falsely match as an Android claim).
    subjectPattern: "(?<!non-)Android(?: validation| support)?",
    // Android automated validation is not implemented anywhere in this
    // project (see the v0.3.x/v0.4.x roadmap) -- this is a permanently
    // false signal, not a metadata lookup, so a claim that it is
    // implemented/current is always a genuine mismatch until a future
    // version actually builds it. This does not implement any Android
    // detection itself (no AndroidManifest.xml/Gradle-Android-plugin/
    // Compose/AGP/SDK/emulator awareness) -- it only reuses the existing
    // current-vs-planned claim mechanism for a feature this project
    // already knows, out of band, does not exist.
    isImplemented: () => false,
  },
];

// v0.3.3 Batch 3 -- backtick-quoted-only Java/Kotlin FQCN-shaped symbol
// scan (T1-T4). Requiring the mention to be inside an inline code span
// (`` `com.example.Foo` ``) is what keeps this conservative: ordinary prose
// mentioning a capitalized word is extremely common and would be far too
// noisy to scan directly, but a backtick-quoted, fully-dotted,
// lowercase-package-then-Capitalized-name token is specifically how a
// real symbol reference is conventionally written in markdown docs.
const BACKTICK_SPAN_PATTERN = /`([^`]+)`/g;
const JVM_FQCN_PATTERN = /^[a-z][\w]*(?:\.[a-z][\w]*)*\.[A-Z]\w*$/;

// Reused by both the symbol-claim check and the Gradle/Maven command-claim
// check below: a broader set of future/negative-boundary hedge phrases than
// docClaimPatterns.ts's own HEDGE_PATTERN (which is narrowly scoped to
// "not yet published"-style wording) -- this project's own docs
// legitimately say things like "Android support is planned" or "does not
// support Gradle yet", which must never be treated as a current-state claim.
const JVM_FUTURE_OR_NEGATIVE_HEDGE_PATTERN =
  /\b(planned|future|deferred|not yet|out of scope|does not support|doesn't support|will support|not implemented|not supported)\b/i;

const GRADLE_COMMAND_PATTERN = /\b(?:\.\/)?gradlew(?:\.bat)?\b|\bgradle\b/i;
const MAVEN_COMMAND_PATTERN = /\bmvnw(?:\.cmd)?\b|\bmvn\b/i;

// Declaration kinds treated as safe, implementation-weight symbol claims --
// same conservative kind allowlist Batch 2's duplicate/dead-code checks
// already use (methods/variables/constants excluded as too noisy/ambiguous
// for a name-only, no-package-tracking cross-check).
const JVM_SYMBOL_DECLARATION_KINDS = new Set(["class", "interface", "enum", "function"]);

function collectKnownJvmDeclarationNames(ctx: AuditDetectorContext): Set<string> {
  const names = new Set<string>();
  if (!ctx.sourceFacts) return names;
  for (const file of ctx.sourceFacts.files) {
    if (file.language !== "java" && file.language !== "kotlin") continue;
    if (file.parseStatus !== "parsed") continue;
    for (const decl of file.declarations) {
      if (JVM_SYMBOL_DECLARATION_KINDS.has(decl.kind)) names.add(decl.name);
    }
  }
  return names;
}

export const DOCS_CODE_MISMATCH_DETECTOR: AuditDetector = {
  id: DETECTOR_ID,
  auditType: "code-rot",
  title: "Documentation/code mismatch",
  description:
    "Detects deterministic mismatches between documentation claims and source-of-truth data: feature-implementation claims, full-release-gate-for-scoped-checks wording, and (v0.3.3) Java/Kotlin symbol claims plus Gradle/Maven feature/command claims against static JVM metadata.",
  supportedIncludeAreas: ["docs", "architecture", "cli", "package"],
  shouldSkip: (ctx: AuditDetectorContext) => {
    if (!ctx.config.include.includes("docs")) {
      return { skip: true, reason: "--include does not select docs; this detector's checks are docs-based." };
    }
    return { skip: false };
  },
  run: (ctx: AuditDetectorContext): AuditIssue[] => {
    const issues: AuditIssue[] = [];
    // v0.3.3 Batch 3 -- computed once per run, same "cheap, static,
    // presence-only" treatment as pythonMetadata/jvmMetadata elsewhere in
    // this codebase (see testRotDetector.ts). Never runs Gradle/Maven/any
    // JVM tooling.
    const jvmMetadata = collectJvmProjectMetadata(ctx.target.rootPath, ctx.inventory);
    const featureCtx: FeatureCheckContext = { sourceOfTruth: ctx.sourceOfTruth, jvmMetadata };
    const knownJvmDeclarationNames = collectKnownJvmDeclarationNames(ctx);

    for (const docFile of ctx.inventory.docsFiles) {
      const content = readBoundedText(ctx.target.rootPath, docFile.relativePath, docFile.sizeBytes);
      if (content === null) continue;

      const lines = splitLines(content);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (const feature of FEATURE_CHECKS) {
          if (feature.featureId === "security-validation" && isAndroidScopedSecurityValidationClaim(line)) {
            continue;
          }
          const currentMatch = currentClaimPatternFor(feature.subjectPattern).test(line);
          const plannedMatch = plannedClaimPatternFor(feature.subjectPattern).test(line);
          const implemented = feature.isImplemented(featureCtx);

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

        if (!JVM_FUTURE_OR_NEGATIVE_HEDGE_PATTERN.test(line)) {
          issues.push(
            ...findJvmSymbolClaimMismatches(docFile.relativePath, i + 1, line, jvmMetadata, knownJvmDeclarationNames)
          );
          issues.push(...findJvmBuildCommandClaimMismatches(docFile.relativePath, i + 1, line, jvmMetadata));
        }
      }
    }

    return deduplicateIssuesById(issues);
  },
};

// v0.3.3 Batch 3 -- T1/T2/T3/T4. Gated on the project having ANY real
// Java/Kotlin source at all (jvmMetadata.hasJavaSource/hasKotlinSource) --
// without this gate, a project with no JVM code whatsoever (e.g. this repo
// itself) would have every backtick-quoted FQCN-shaped mention trivially
// "fail" to match anything, which would be pure noise rather than a real
// signal. Matches by simple declaration name only (see
// collectKnownJvmDeclarationNames()'s header comment) -- this cannot verify
// the claimed package prefix actually matches, only that some declaration
// with that name exists somewhere in the scanned Java/Kotlin source, which
// is why this is always a "weak signal" candidate, never a proof.
function findJvmSymbolClaimMismatches(
  relativePath: string,
  lineNumber: number,
  line: string,
  jvmMetadata: JvmProjectMetadataSnapshot,
  knownJvmDeclarationNames: Set<string>
): AuditIssue[] {
  if (!jvmMetadata.hasJavaSource && !jvmMetadata.hasKotlinSource) return [];

  const issues: AuditIssue[] = [];
  BACKTICK_SPAN_PATTERN.lastIndex = 0;
  for (const match of line.matchAll(BACKTICK_SPAN_PATTERN)) {
    const candidate = match[1];
    if (!JVM_FQCN_PATTERN.test(candidate)) continue;
    const simpleName = candidate.slice(candidate.lastIndexOf(".") + 1);
    if (knownJvmDeclarationNames.has(simpleName)) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [relativePath, "jvm-symbol-claim-mismatch", String(lineNumber), candidate],
        title: `Docs mention a Java/Kotlin symbol not found in static source facts: "${candidate}"`,
        description: `${relativePath}:${lineNumber} mentions \`${candidate}\`, but no scanned Java/Kotlin declaration named "${simpleName}" was found. This is a static source-facts signal from a conservative, name-only scan -- it cannot verify the claimed package prefix, only that no declaration with this simple name exists anywhere in the scanned Java/Kotlin file set, so this is a candidate docs-code mismatch (weak signal), not proof.`,
        severity: "info",
        confidence: "low",
        falsePositiveRisk: "high",
        category: "docs-feature-mismatch",
        recommendedAction: `Confirm "${candidate}" exists (it may be defined outside the scanned source set) before treating this as stale documentation.`,
        suggestedFixStrategy: `Update ${relativePath} to reference an existing Java/Kotlin symbol, or add the missing declaration.`,
        validationCommands: ["npm run audit -- --types code-rot --include docs"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: `Static source-facts check did not find a Java/Kotlin declaration named "${simpleName}" in the scanned file set.`,
            filePath: relativePath,
            line: lineNumber,
            excerpt: line.trim().slice(0, 200),
            source: DETECTOR_ID,
            confidence: "low",
          },
        ],
        affectedFiles: [relativePath],
      })
    );
  }
  return issues;
}

// v0.3.3 Batch 3 -- T6/T7/T8/T9. Only matches a Gradle/Maven command token
// inside a backtick-quoted inline code span, for the same "conventionally
// how a real command example is written" reasoning as the symbol check
// above. This never claims the command would actually succeed -- only that
// docs present a command example implying a build tool this project's
// static metadata does not show any trace of.
function findJvmBuildCommandClaimMismatches(
  relativePath: string,
  lineNumber: number,
  line: string,
  jvmMetadata: JvmProjectMetadataSnapshot
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  BACKTICK_SPAN_PATTERN.lastIndex = 0;
  for (const match of line.matchAll(BACKTICK_SPAN_PATTERN)) {
    const candidate = match[1];

    if (GRADLE_COMMAND_PATTERN.test(candidate) && !jvmMetadata.hasGradleBuild && !jvmMetadata.hasGradleSettings && !jvmMetadata.hasGradleWrapper) {
      issues.push(
        makeBuildCommandIssue(relativePath, lineNumber, line, candidate, "Gradle", "no Gradle execution was performed")
      );
    }
    if (MAVEN_COMMAND_PATTERN.test(candidate) && !jvmMetadata.hasMavenPom) {
      issues.push(
        makeBuildCommandIssue(relativePath, lineNumber, line, candidate, "Maven", "no Maven execution was performed")
      );
    }
  }
  return issues;
}

function makeBuildCommandIssue(
  relativePath: string,
  lineNumber: number,
  line: string,
  commandExcerpt: string,
  toolLabel: "Gradle" | "Maven",
  executionNote: string
): AuditIssue {
  return makeCodeRotIssue({
    auditType: "code-rot",
    detectorId: DETECTOR_ID,
    idCues: [relativePath, `${toolLabel.toLowerCase()}-command-claim-mismatch`, String(lineNumber), commandExcerpt],
    title: `Docs include a ${toolLabel} command example, but no ${toolLabel} metadata was found: "${commandExcerpt}"`,
    description: `${relativePath}:${lineNumber} shows the command \`${commandExcerpt}\`, but no ${toolLabel} build/config metadata was found in the project (see jvmProjectMetadata.ts's static presence checks). This is a candidate docs-code mismatch (weak signal), not proof -- ${executionNote}, so this scan cannot confirm the command would actually run.`,
    severity: "info",
    confidence: "low",
    falsePositiveRisk: "high",
    category: "docs-feature-mismatch",
    recommendedAction: `Confirm ${toolLabel} metadata exists (it may live outside the scanned inventory) before treating this as stale documentation.`,
    suggestedFixStrategy: `Update ${relativePath} to remove or correct the ${toolLabel} command example, or add the corresponding ${toolLabel} project files.`,
    validationCommands: ["npm run audit -- --types code-rot --include docs"],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    evidence: [
      {
        kind: "file",
        message: `Static source-facts/metadata check did not find ${toolLabel} build metadata; ${executionNote}.`,
        filePath: relativePath,
        line: lineNumber,
        excerpt: line.trim().slice(0, 200),
        source: DETECTOR_ID,
        confidence: "low",
      },
    ],
    affectedFiles: [relativePath],
  });
}

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

function isAndroidScopedSecurityValidationClaim(line: string): boolean {
  return /\bAndroid\b[^.\n]{0,60}\bsecurity validation\b/i.test(line) || /\bsecurity validation\b[^.\n]{0,30}\bfor Android\b/i.test(line);
}
