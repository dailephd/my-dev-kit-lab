import fs from "node:fs";
import path from "node:path";
import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import { currentClaimPatternFor, plannedClaimPatternFor } from "../utils/docClaimPatterns.js";
import { readBoundedFileText } from "../utils/boundedRead.js";
import { deduplicateIssuesById, makeCodeRotIssue } from "../utils/issueFactories.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 4 — security/validation assumption-rot detector.
//
// Narrow regex checks on doc content only -- no LLM, no broad semantic
// judgment. This detector is deliberately conservative: it was run against
// this repo's own real docs during development and every sub-check below
// was verified to produce zero findings against this repo's current,
// hedged docs (see the detector's own test file for the self-scan
// regression guard).
//
// Explicitly SKIPPED (spec-documented, not implemented in this batch):
//   - "docs describing a scoped `--checks` run as a full release gate" is
//     owned entirely by docsCodeMismatchDetector.ts's
//     FULL_RELEASE_GATE_FOR_SCOPED_CHECKS_PATTERN check -- not duplicated
//     here.
//   - "stale security:validate --flag doc check" is SKIPPED: there is no
//     cheap, deterministic source of the real current flag set for
//     security:validate (would require parsing
//     scripts/security/validate.ts's own CLI option parser), so this batch
//     cannot verify a doc-mentioned flag against ground truth without
//     re-implementing that parser here. Left for a future batch.
//   - the optional "imprecise caveat" catch-all (absolute-sounding word
//     with no hedge, outside the specific patterns below) is SKIPPED as
//     off-by-default per the spec's own guidance -- it was too easy to
//     produce false positives against legitimate, confident (but accurate)
//     prose without a real semantic check, so it is not implemented.
// ---------------------------------------------------------------------------

const DETECTOR_ID = "security-validation-assumption-rot";
const MAX_READ_BYTES = 200_000;

const TOOL_PASSED_WITHOUT_HEDGE_PATTERN = /\b(codeql|semgrep|osv-scanner)\b[^.\n]{0,60}\bpassed\b/i;
const HEDGE_NEARBY_PATTERN = /\b(optional|skipped|if available|when available|unavailable|absent)\b/i;
const SKIPPED_EQUALS_PASSED_PATTERN = /\bskipped\b[^.\n]{0,60}\b(equivalent to|same as|counts as)\b[^.\n]{0,20}\bpassed\b/i;
const EXHAUSTIVE_SECRET_CLAIM_PATTERN = /\b(exhaustive|complete|comprehensive)\b[^.\n]{0,30}\bsecret\b/i;
const COMPLETE_NETWORK_ISOLATION_PATTERN = /\b(complete|full|guaranteed)\b[^.\n]{0,30}\bnetwork isolation\b|\bguarantees? no network\b/i;
const V021_SECURITY_CONTEXT_PATTERN = /\bv0\.2\.1\b/;
const SECURITY_CONTEXT_LINE_PATTERN = /\bsecurity\b/i;
// Negation/hedge words that, appearing near an "exhaustive/complete secret"
// or "complete network isolation" match, indicate the sentence is correctly
// DENYING the claim (e.g. "cannot prove exhaustive secret absence") rather
// than making it. Discovered via a real false positive against this repo's
// own docs/security-validation-framework.md, which correctly says "cannot
// prove exhaustive secret absence".
const CLAIM_NEGATION_NEARBY_PATTERN = /\b(cannot|can't|not|never|no|bounded|does not|doesn't)\b/i;
// Historical/superseded framing that demotes an old-version security
// mention from "stale current-state claim" to "correctly historical" --
// e.g. changelog entries and roadmap "previous baseline" sections.
const HISTORICAL_VERSION_FRAMING_PATTERN = /\b(previous|completed|historical|superseded|prior baseline)\b/i;

export const SECURITY_VALIDATION_ASSUMPTION_ROT_DETECTOR: AuditDetector = {
  id: DETECTOR_ID,
  auditType: "code-rot",
  title: "Security/validation assumption rot",
  description:
    "Detects docs that describe optional/skipped security tools as passed, claim exhaustive secret detection or complete network isolation, claim manual pentest/Android validation as current, reference stale pre-current security versions, or describe attack scenarios as planned when they are already implemented.",
  supportedIncludeAreas: ["docs", "cli", "package"],
  shouldSkip: (ctx: AuditDetectorContext) => {
    if (!ctx.config.include.includes("docs")) {
      return { skip: true, reason: "--include does not select docs; this detector's checks are docs-based." };
    }
    return { skip: false };
  },
  run: (ctx: AuditDetectorContext): AuditIssue[] => {
    const issues: AuditIssue[] = [];
    const pkgVersion = ctx.sourceOfTruth.package?.version ?? null;
    const hasSecurityValidationSourceDir = ctx.sourceOfTruth.security.hasSecurityValidationSourceDir;
    const hasAttackScenariosDir = fs.existsSync(path.join(ctx.target.rootPath, "src", "securityValidation", "attackScenarios"));
    const hasAndroidValidationSource = fs.existsSync(
      path.join(ctx.target.rootPath, "src", "mobile", "android", "validate", "validateAndroidTarget.ts")
    );

    for (const docFile of ctx.inventory.docsFiles) {
      const content = readBoundedFileText(ctx.target.rootPath, docFile.relativePath, docFile.sizeBytes, MAX_READ_BYTES);
      if (content === null) continue;

      issues.push(...findToolPassedWithoutHedge(docFile.relativePath, content));
      issues.push(...findSkippedEqualsPassed(docFile.relativePath, content));
      issues.push(...findExhaustiveSecretClaim(docFile.relativePath, content));
      issues.push(...findCompleteNetworkIsolationClaim(docFile.relativePath, content));
      issues.push(...findUnsupportedCurrentClaims(docFile.relativePath, content, hasAndroidValidationSource));
      if (pkgVersion) issues.push(...findStaleV021SecurityMention(docFile.relativePath, content, pkgVersion));
      if (hasSecurityValidationSourceDir && hasAttackScenariosDir) {
        issues.push(...findAttackScenariosDescribedAsPlanned(docFile.relativePath, content));
      }
    }

    return deduplicateIssuesById(issues);
  },
};

function findToolPassedWithoutHedge(relativePath: string, content: string): AuditIssue[] {
  const match = TOOL_PASSED_WITHOUT_HEDGE_PATTERN.exec(content);
  if (!match) return [];
  const matchIndex = match.index;
  const window = content.slice(Math.max(0, matchIndex - 80), Math.min(content.length, matchIndex + match[0].length + 80));
  if (HEDGE_NEARBY_PATTERN.test(window)) return [];

  return [
    makeCodeRotIssue({
      auditType: "code-rot",
      detectorId: DETECTOR_ID,
      idCues: [relativePath, "tool-passed-without-hedge"],
      title: `${relativePath} claims an optional security tool "passed" without a hedge word nearby`,
      description: `${relativePath} says "${match[0]}" without a nearby "optional"/"skipped"/"if available" hedge. Optional tools (CodeQL/Semgrep/OSV-Scanner) can be absent and reported as skipped -- describing them as unconditionally "passed" is misleading.`,
      severity: "high",
      confidence: "medium",
      falsePositiveRisk: "medium",
      category: "security-validation-assumption-rot",
      recommendedAction: `Add a hedge ("optional", "when available") near this claim in ${relativePath}, or clarify that a skip is not a pass.`,
      suggestedFixStrategy: `Rephrase the claim in ${relativePath} to distinguish "passed" from "skipped (optional tool unavailable)".`,
      validationCommands: ["npm run audit -- --types code-rot --include docs"],
      releaseBlocking: false,
      implementationBlocking: false,
      autoFixEligible: false,
      evidence: [
        {
          kind: "file",
          message: "Matched an unhedged optional-tool-passed claim pattern.",
          filePath: relativePath,
          excerpt: match[0].slice(0, 200),
          source: DETECTOR_ID,
          confidence: "medium",
        },
      ],
      affectedFiles: [relativePath],
    }),
  ];
}

function findSkippedEqualsPassed(relativePath: string, content: string): AuditIssue[] {
  const match = SKIPPED_EQUALS_PASSED_PATTERN.exec(content);
  if (!match) return [];
  return [
    makeCodeRotIssue({
      auditType: "code-rot",
      detectorId: DETECTOR_ID,
      idCues: [relativePath, "skipped-equals-passed"],
      title: `${relativePath} equates a skipped check with a passed check`,
      description: `${relativePath} says "${match[0]}" -- a skipped optional check must never be described as equivalent to a passed check.`,
      severity: "high",
      confidence: "high",
      falsePositiveRisk: "low",
      category: "security-validation-assumption-rot",
      recommendedAction: `Correct ${relativePath} to clearly state that a skipped check is not the same as a passed check.`,
      suggestedFixStrategy: `Remove or rephrase the "skipped ... equivalent to ... passed" wording in ${relativePath}.`,
      validationCommands: ["npm run audit -- --types code-rot --include docs"],
      releaseBlocking: false,
      implementationBlocking: false,
      autoFixEligible: false,
      evidence: [
        {
          kind: "file",
          message: "Matched a skipped-equals-passed phrasing pattern.",
          filePath: relativePath,
          excerpt: match[0].slice(0, 200),
          source: DETECTOR_ID,
          confidence: "high",
        },
      ],
      affectedFiles: [relativePath],
    }),
  ];
}

function findExhaustiveSecretClaim(relativePath: string, content: string): AuditIssue[] {
  const match = EXHAUSTIVE_SECRET_CLAIM_PATTERN.exec(content);
  if (!match) return [];
  const matchIndex = match.index;
  const window = content.slice(Math.max(0, matchIndex - 60), Math.min(content.length, matchIndex + match[0].length + 20));
  if (CLAIM_NEGATION_NEARBY_PATTERN.test(window)) return [];
  return [
    makeCodeRotIssue({
      auditType: "code-rot",
      detectorId: DETECTOR_ID,
      idCues: [relativePath, "exhaustive-secret-claim"],
      title: `${relativePath} claims exhaustive/complete secret detection`,
      description: `${relativePath} says "${match[0]}" -- secret scanning in this framework is bounded, not exhaustive, per its own documented limitations.`,
      severity: "high",
      confidence: "medium",
      falsePositiveRisk: "medium",
      category: "security-validation-assumption-rot",
      recommendedAction: `Rephrase ${relativePath} to describe secret scanning as bounded rather than exhaustive/complete.`,
      suggestedFixStrategy: `Replace the exhaustive/complete claim in ${relativePath} with hedged wording matching the framework's actual scope.`,
      validationCommands: ["npm run audit -- --types code-rot --include docs"],
      releaseBlocking: false,
      implementationBlocking: false,
      autoFixEligible: false,
      evidence: [
        {
          kind: "file",
          message: "Matched an exhaustive/complete secret-detection claim pattern.",
          filePath: relativePath,
          excerpt: match[0].slice(0, 200),
          source: DETECTOR_ID,
          confidence: "medium",
        },
      ],
      affectedFiles: [relativePath],
    }),
  ];
}

function findCompleteNetworkIsolationClaim(relativePath: string, content: string): AuditIssue[] {
  const match = COMPLETE_NETWORK_ISOLATION_PATTERN.exec(content);
  if (!match) return [];
  const matchIndex = match.index;
  const window = content.slice(Math.max(0, matchIndex - 60), Math.min(content.length, matchIndex + match[0].length + 20));
  if (CLAIM_NEGATION_NEARBY_PATTERN.test(window)) return [];
  return [
    makeCodeRotIssue({
      auditType: "code-rot",
      detectorId: DETECTOR_ID,
      idCues: [relativePath, "complete-network-isolation-claim"],
      title: `${relativePath} claims complete/guaranteed network isolation`,
      description: `${relativePath} says "${match[0]}" -- the network/local-first check is a bounded static assumption check, not proof of runtime network isolation.`,
      severity: "high",
      confidence: "medium",
      falsePositiveRisk: "medium",
      category: "security-validation-assumption-rot",
      recommendedAction: `Rephrase ${relativePath} to describe the network check as bounded rather than a complete/guaranteed isolation proof.`,
      suggestedFixStrategy: `Replace the unhedged network-isolation claim in ${relativePath} with accurate, bounded wording.`,
      validationCommands: ["npm run audit -- --types code-rot --include docs"],
      releaseBlocking: false,
      implementationBlocking: false,
      autoFixEligible: false,
      evidence: [
        {
          kind: "file",
          message: "Matched an unhedged complete-network-isolation claim pattern.",
          filePath: relativePath,
          excerpt: match[0].slice(0, 200),
          source: DETECTOR_ID,
          confidence: "medium",
        },
      ],
      affectedFiles: [relativePath],
    }),
  ];
}

function findUnsupportedCurrentClaims(relativePath: string, content: string, hasAndroidValidationSource: boolean): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const subjects: { id: string; label: string; pattern: string }[] = [
    { id: "manual-pentest", label: "manual pentest", pattern: "manual pentest" },
    { id: "android-validation", label: "Android/mobile validation", pattern: "(?:android (?:validation|support)|mobile validation)" },
  ];

  for (const subject of subjects) {
    if (subject.id === "android-validation" && hasAndroidValidationSource) continue;
    const match = currentClaimPatternFor(subject.pattern).exec(content);
    if (!match) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [relativePath, "unsupported-current-claim", subject.id],
        title: `${relativePath} claims "${subject.label}" is implemented/current`,
        description: `${relativePath} contains an unhedged "${subject.label} is implemented/current" claim, but there is no corresponding source signal for this repo.`,
        severity: "high",
        confidence: "medium",
        falsePositiveRisk: "medium",
        category: "security-validation-assumption-rot",
        recommendedAction: `Confirm whether "${subject.label}" is actually implemented; if not, correct ${relativePath}.`,
        suggestedFixStrategy: `Rephrase the "${subject.label}" claim in ${relativePath} to accurately reflect its planned status.`,
        validationCommands: ["npm run audit -- --types code-rot --include docs"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: `Matched an unhedged "${subject.label} is implemented/current" claim pattern.`,
            filePath: relativePath,
            excerpt: match[0].slice(0, 200),
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: [relativePath],
      })
    );
  }
  return issues;
}

function findStaleV021SecurityMention(relativePath: string, content: string, currentVersion: string): AuditIssue[] {
  if (isVersionAtLeast(currentVersion, "0.2.2") !== true) return [];
  // CHANGELOG.md entries are definitionally historical records of past
  // versions -- a "v0.2.1" mention there is never a stale current-state
  // claim. Discovered via a real false positive during self-testing.
  if (path.basename(relativePath).toLowerCase() === "changelog.md") return [];

  const lines = content.split(/\r\n|\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!V021_SECURITY_CONTEXT_PATTERN.test(lines[i])) continue;
    const windowStart = Math.max(0, i - 3);
    const windowEnd = Math.min(lines.length, i + 4);
    const windowLines = lines.slice(windowStart, windowEnd);
    const nearbySecurityContext = windowLines.some((l) => SECURITY_CONTEXT_LINE_PATTERN.test(l));
    if (!nearbySecurityContext) continue;
    if (windowLines.some((l) => HISTORICAL_VERSION_FRAMING_PATTERN.test(l))) continue;

    return [
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [relativePath, "stale-v021-security-mention", String(i + 1)],
        title: `${relativePath} mentions v0.2.1 security behavior near current package version ${currentVersion}`,
        description: `${relativePath}:${i + 1} mentions "v0.2.1" in a security-context paragraph, but the current package version is "${currentVersion}" (>= 0.2.2). Confirm this is not describing stale pre-fortification security behavior as current.`,
        severity: "medium",
        confidence: "low",
        falsePositiveRisk: "medium",
        category: "security-validation-assumption-rot",
        recommendedAction: "Confirm whether this v0.2.1 mention is intentionally historical; update if it describes current behavior.",
        suggestedFixStrategy: `Update or clarify the v0.2.1 reference in ${relativePath}.`,
        validationCommands: ["npm run audit -- --types code-rot --include docs"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: "Doc mentions v0.2.1 near security-context wording while the current package version is 0.2.2 or later.",
            filePath: relativePath,
            line: i + 1,
            excerpt: lines[i].trim().slice(0, 200),
            source: DETECTOR_ID,
            confidence: "low",
          },
        ],
        affectedFiles: [relativePath],
      }),
    ];
  }
  return [];
}

function findAttackScenariosDescribedAsPlanned(relativePath: string, content: string): AuditIssue[] {
  const pattern = plannedClaimPatternFor("attack scenario");
  const match = pattern.exec(content);
  if (!match) return [];

  return [
    makeCodeRotIssue({
      auditType: "code-rot",
      detectorId: DETECTOR_ID,
      idCues: [relativePath, "attack-scenarios-planned-but-implemented"],
      title: `${relativePath} describes attack scenarios as planned/future, but they are already implemented`,
      description: `${relativePath} describes "attack scenario" work as planned/future, but src/securityValidation/attackScenarios already exists and the security-validation source directory is present.`,
      severity: "medium",
      confidence: "medium",
      falsePositiveRisk: "medium",
      category: "security-validation-assumption-rot",
      recommendedAction: `Update ${relativePath} to describe attack scenarios as implemented/current.`,
      suggestedFixStrategy: `Move the attack-scenario description in ${relativePath} out of the planned/roadmap section.`,
      validationCommands: ["npm run audit -- --types code-rot --include docs"],
      releaseBlocking: false,
      implementationBlocking: false,
      autoFixEligible: false,
      evidence: [
        {
          kind: "file",
          message: "Doc describes attack scenarios as planned/future while src/securityValidation/attackScenarios already exists.",
          filePath: relativePath,
          excerpt: match[0].slice(0, 200),
          source: DETECTOR_ID,
          confidence: "medium",
        },
      ],
      affectedFiles: [relativePath],
    }),
  ];
}

// Minimal semver-ish "is A >= B" comparison for major.minor.patch strings.
// Returns null when either string doesn't parse cleanly.
function isVersionAtLeast(a: string, b: string): boolean | null {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  if (pa.length !== 3 || pb.length !== 3 || pa.some(Number.isNaN) || pb.some(Number.isNaN)) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return true;
}
