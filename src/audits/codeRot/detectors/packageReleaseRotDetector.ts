import fs from "node:fs";
import path from "node:path";
import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import { CURRENT_PACKAGE_VERSION_PATTERNS, PUBLISHED_OR_RELEASED_CLAIM_PATTERN, isHedgedNearby } from "../utils/docClaimPatterns.js";
import { deduplicateIssuesById, makeCodeRotIssue } from "../utils/issueFactories.js";
import { splitLines } from "../utils/textLines.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 3 — package/release rot detector.
//
// Local-only: never runs npm pack, npm view, or any network/registry call
// (Batch 3 scope). Owns the publish/release-claim check and the doc-vs-
// package version-mismatch check (both also listed under
// docsCodeMismatchDetector.ts's Batch 3 spec section, but implemented here
// only, to avoid the same underlying signal producing two issues from two
// detectors -- see that file's header comment for the same note from the
// other side).
// ---------------------------------------------------------------------------

const DETECTOR_ID = "package-release-rot";
const MAX_DOC_READ_BYTES = 200_000;

// Paths that should never appear in package.json's "files" allowlist --
// each is either generated content or private/local state, per this
// project's own .gitignore/security-package-content conventions.
const RISKY_FILES_ENTRY_PATTERN = /^(reports|lab-output|\.my-dev-kit|\.env)/i;

export const PACKAGE_RELEASE_ROT_DETECTOR: AuditDetector = {
  id: DETECTOR_ID,
  auditType: "code-rot",
  title: "Package/release rot",
  description:
    "Detects package.json/package-lock.json version or name drift, a missing CHANGELOG section for the current version, stale doc version mentions, unhedged publish/release claims, risky package.json files entries, and self-referencing script commands.",
  supportedIncludeAreas: ["package", "docs", "cli"],
  run: (ctx: AuditDetectorContext): AuditIssue[] => {
    const issues: AuditIssue[] = [];
    const pkg = ctx.sourceOfTruth.package;
    const lockfile = ctx.sourceOfTruth.lockfile;

    if (ctx.config.include.includes("package") && pkg) {
      if (lockfile.present && lockfile.packageManagerConsistent === false) {
        if (lockfile.rootVersion !== null && lockfile.rootVersion !== pkg.version) {
          issues.push(makeVersionMismatchIssue(pkg.version, lockfile.rootVersion));
        } else if (lockfile.rootName !== null && lockfile.rootName !== pkg.name) {
          issues.push(makeNameMismatchIssue(pkg.name, lockfile.rootName));
        }
      }

      if (pkg.files) {
        for (const entry of pkg.files) {
          if (RISKY_FILES_ENTRY_PATTERN.test(entry)) {
            issues.push(makeRiskyFilesEntryIssue(entry));
          }
        }
      }

      for (const [scriptName, command] of Object.entries(pkg.scripts)) {
        for (const match of command.matchAll(/npm run ([\w:.-]+)/g)) {
          const referenced = match[1];
          if (referenced !== scriptName && !(referenced in pkg.scripts)) {
            issues.push(makeSelfReferenceIssue(scriptName, referenced));
          }
        }
      }
    }

    if (ctx.config.include.includes("docs") && pkg) {
      const changelogFile = ctx.inventory.docsFiles.find((f) => path.basename(f.relativePath).toLowerCase() === "changelog.md");
      if (changelogFile) {
        const content = readBoundedText(ctx.target.rootPath, changelogFile.relativePath, changelogFile.sizeBytes);
        if (content !== null && pkg.version) {
          const hasCurrentVersionSection = new RegExp(`^##\\s*\\[${escapeRegExp(pkg.version)}\\]`, "m").test(content);
          if (!hasCurrentVersionSection) {
            issues.push(makeMissingChangelogSectionIssue(changelogFile.relativePath, pkg.version));
          }
        }
      }

      for (const docFile of ctx.inventory.docsFiles) {
        const content = readBoundedText(ctx.target.rootPath, docFile.relativePath, docFile.sizeBytes);
        if (content === null) continue;

        const lines = splitLines(content);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          if (pkg.version) {
            for (const pattern of CURRENT_PACKAGE_VERSION_PATTERNS) {
              const match = line.match(pattern);
              if (match && match[1] !== pkg.version) {
                issues.push(makeStaleDocVersionIssue(docFile.relativePath, i + 1, line, match[1], pkg.version));
              }
            }
          }

          if (PUBLISHED_OR_RELEASED_CLAIM_PATTERN.test(line)) {
            const windowStart = Math.max(0, i - 1);
            const window = lines.slice(windowStart, i + 1).join(" ");
            if (!isHedgedNearby(window)) {
              issues.push(makeUnsupportedPublishClaimIssue(docFile.relativePath, i + 1, line));
            }
          }
        }
      }
    }

    return deduplicateIssuesById(issues);
  },
};

function makeVersionMismatchIssue(packageVersion: string | null, lockfileVersion: string): AuditIssue {
  return makeCodeRotIssue({
    auditType: "code-rot",
    detectorId: DETECTOR_ID,
    idCues: ["version-mismatch", packageVersion ?? "unknown", lockfileVersion],
    title: "package.json and package-lock.json version mismatch",
    description: `package.json version is "${packageVersion}" but package-lock.json's root version is "${lockfileVersion}".`,
    severity: "blocker",
    confidence: "high",
    falsePositiveRisk: "low",
    category: "package-release-rot",
    recommendedAction: "Run npm install to regenerate package-lock.json so both versions match.",
    suggestedFixStrategy: "npm install (lockfile-only update is sufficient if dependencies did not change).",
    validationCommands: ["npm install --package-lock-only"],
    releaseBlocking: true,
    implementationBlocking: false,
    autoFixEligible: false,
    evidence: [
      {
        kind: "file",
        message: "Version field mismatch between package.json and package-lock.json.",
        filePath: "package-lock.json",
        expected: packageVersion ?? undefined,
        observed: lockfileVersion,
        source: DETECTOR_ID,
        confidence: "high",
      },
    ],
    affectedFiles: ["package.json", "package-lock.json"],
  });
}

function makeNameMismatchIssue(packageName: string | null, lockfileName: string): AuditIssue {
  return makeCodeRotIssue({
    auditType: "code-rot",
    detectorId: DETECTOR_ID,
    idCues: ["name-mismatch", packageName ?? "unknown", lockfileName],
    title: "package.json and package-lock.json name mismatch",
    description: `package.json name is "${packageName}" but package-lock.json's root name is "${lockfileName}".`,
    severity: "high",
    confidence: "high",
    falsePositiveRisk: "low",
    category: "package-release-rot",
    recommendedAction: "Run npm install to regenerate package-lock.json so both names match.",
    suggestedFixStrategy: "npm install (lockfile-only update is sufficient if dependencies did not change).",
    validationCommands: ["npm install --package-lock-only"],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    evidence: [
      {
        kind: "file",
        message: "Name field mismatch between package.json and package-lock.json.",
        filePath: "package-lock.json",
        expected: packageName ?? undefined,
        observed: lockfileName,
        source: DETECTOR_ID,
        confidence: "high",
      },
    ],
    affectedFiles: ["package.json", "package-lock.json"],
  });
}

function makeRiskyFilesEntryIssue(entry: string): AuditIssue {
  return makeCodeRotIssue({
    auditType: "code-rot",
    detectorId: DETECTOR_ID,
    idCues: ["risky-files-entry", entry],
    title: `package.json "files" field includes a risky-looking path: "${entry}"`,
    description: `package.json's "files" allowlist includes "${entry}", which looks like generated or private content rather than intentional package content.`,
    severity: "medium",
    confidence: "medium",
    falsePositiveRisk: "low",
    category: "package-release-rot",
    recommendedAction: `Remove "${entry}" from package.json's "files" field unless it is intentionally published.`,
    suggestedFixStrategy: `Edit the "files" array in package.json to drop "${entry}".`,
    validationCommands: ["npm pack --dry-run"],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    evidence: [
      {
        kind: "file",
        message: `"files" entry matches a known risky pattern.`,
        filePath: "package.json",
        excerpt: entry,
        source: DETECTOR_ID,
        confidence: "medium",
      },
    ],
    affectedFiles: ["package.json"],
  });
}

function makeSelfReferenceIssue(scriptName: string, referenced: string): AuditIssue {
  return makeCodeRotIssue({
    auditType: "code-rot",
    detectorId: DETECTOR_ID,
    idCues: ["script-references-missing-script", scriptName, referenced],
    title: `Script "${scriptName}" references undefined script "${referenced}"`,
    description: `package.json script "${scriptName}" runs "npm run ${referenced}", but "${referenced}" is not itself a defined script.`,
    severity: "high",
    confidence: "high",
    falsePositiveRisk: "low",
    category: "package-release-rot",
    recommendedAction: `Add the missing "${referenced}" script, or fix "${scriptName}" to reference an existing script.`,
    suggestedFixStrategy: `Edit package.json's "${scriptName}" script.`,
    validationCommands: [`npm run ${scriptName}`],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    evidence: [
      {
        kind: "file",
        message: `Script command references a script name that does not exist.`,
        filePath: "package.json",
        excerpt: `"${scriptName}": "... npm run ${referenced} ..."`,
        source: DETECTOR_ID,
        confidence: "high",
      },
    ],
    affectedFiles: ["package.json"],
  });
}

function makeMissingChangelogSectionIssue(relativePath: string, currentVersion: string): AuditIssue {
  return makeCodeRotIssue({
    auditType: "code-rot",
    detectorId: DETECTOR_ID,
    idCues: [relativePath, "missing-current-version-section", currentVersion],
    title: `${relativePath} has no section for the current package version (${currentVersion})`,
    description: `package.json version is "${currentVersion}", but ${relativePath} has no "## [${currentVersion}]" heading.`,
    severity: "high",
    confidence: "high",
    falsePositiveRisk: "low",
    category: "package-release-rot",
    recommendedAction: `Add a "## [${currentVersion}]" section to ${relativePath} describing this release.`,
    suggestedFixStrategy: `Convert the top Unreleased/placeholder section in ${relativePath} into a "## [${currentVersion}]" entry.`,
    validationCommands: ["npm run audit -- --types code-rot --include package,docs"],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    evidence: [
      {
        kind: "file",
        message: `No "## [${currentVersion}]" heading found.`,
        filePath: relativePath,
        expected: `## [${currentVersion}]`,
        source: DETECTOR_ID,
        confidence: "high",
      },
    ],
    affectedFiles: [relativePath],
  });
}

function makeStaleDocVersionIssue(
  relativePath: string,
  lineNumber: number,
  excerpt: string,
  docVersion: string,
  currentVersion: string
): AuditIssue {
  return makeCodeRotIssue({
    auditType: "code-rot",
    detectorId: DETECTOR_ID,
    idCues: [relativePath, "stale-doc-version", docVersion],
    title: `${relativePath} states an outdated current version (${docVersion})`,
    description: `${relativePath}:${lineNumber} describes "${docVersion}" as the current package version, but package.json says "${currentVersion}".`,
    severity: "medium",
    confidence: "medium",
    falsePositiveRisk: "medium",
    category: "package-release-rot",
    recommendedAction: `Update ${relativePath} to reference the current version (${currentVersion}).`,
    suggestedFixStrategy: `Replace "${docVersion}" with "${currentVersion}" in ${relativePath}.`,
    validationCommands: ["npm run audit -- --types code-rot --include package,docs"],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    evidence: [
      {
        kind: "file",
        message: `Doc-stated current version does not match package.json.`,
        filePath: relativePath,
        line: lineNumber,
        excerpt: excerpt.trim().slice(0, 200),
        expected: currentVersion,
        observed: docVersion,
        source: DETECTOR_ID,
        confidence: "medium",
      },
    ],
    affectedFiles: [relativePath],
  });
}

function makeUnsupportedPublishClaimIssue(relativePath: string, lineNumber: number, excerpt: string): AuditIssue {
  return makeCodeRotIssue({
    auditType: "code-rot",
    detectorId: DETECTOR_ID,
    idCues: [relativePath, "unsupported-publish-claim", String(lineNumber)],
    title: `${relativePath} claims publication/release/tag without local support`,
    description: `${relativePath}:${lineNumber} contains an unhedged publish/release/tag claim. This is a local-only tool with no npm registry or GitHub API access, so this claim cannot be verified and is flagged for manual confirmation.`,
    severity: "blocker",
    confidence: "medium",
    falsePositiveRisk: "medium",
    category: "package-release-rot",
    recommendedAction: "Confirm whether publication has actually happened; if not, correct the claim to say it has not yet been published.",
    suggestedFixStrategy: `Rephrase the claim in ${relativePath} to accurately reflect current release state.`,
    validationCommands: ["npm run audit -- --types code-rot --include package,docs"],
    releaseBlocking: true,
    implementationBlocking: false,
    autoFixEligible: false,
    evidence: [
      {
        kind: "file",
        message: "Matched an unhedged publish/release/tag claim pattern with no nearby hedge word.",
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readBoundedText(root: string, relativePath: string, sizeBytes: number): string | null {
  if (sizeBytes > MAX_DOC_READ_BYTES) return null;
  try {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
  } catch {
    return null;
  }
}
