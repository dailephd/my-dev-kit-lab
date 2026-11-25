import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import { extractDocCommandReferences } from "../utils/docCommandReferences.js";
import { deduplicateIssuesById, makeCodeRotIssue } from "../utils/issueFactories.js";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 3 — stale command/workflow reference detector.
//
// Two deterministic checks, both requiring "docs" in --include (see
// shouldSkip below):
//   A. A doc references "npm run <script>" for a script that is not a
//      current package.json script, and the surrounding text is not
//      labeled planned/future/roadmap/not implemented/later version.
//   B. An "important public" package.json script (the small, deliberately
//      curated list below) is never mentioned anywhere in docs/COMMANDS.md.
//
// Reads doc text directly (via inventory.docsFiles + a bounded fs.readFile)
// rather than re-deriving it from sourceOfTruth.docs.files, because
// DocsFileTruth only carries boolean "mentions" flags, not the line/excerpt
// detail this detector's evidence needs (Batch 3 spec 3.4: "matched line or
// excerpt if cheaply available").
// ---------------------------------------------------------------------------

const DETECTOR_ID = "stale-command-reference";

// Deliberately small and curated -- these are the command surfaces a v0.3.0
// user is expected to discover via docs/COMMANDS.md. Internal/helper
// scripts are never flagged missing, per Batch 3 scope ("avoid flagging
// internal helper scripts unless docs claim comprehensive command
// coverage" -- Batch 3 does not implement that comprehensive-coverage-claim
// check, so this list stays fixed and small).
const IMPORTANT_PUBLIC_SCRIPTS = ["audit", "security:validate", "experiment:list", "experiment:describe", "experiment:run", "test:security"];

const MAX_DOC_READ_BYTES = 200_000;

export const STALE_COMMAND_REFERENCE_DETECTOR: AuditDetector = {
  id: DETECTOR_ID,
  auditType: "code-rot",
  title: "Stale command/workflow reference",
  description:
    "Detects documentation references to npm scripts that no longer exist in package.json (and are not clearly labeled planned/future), and important public scripts that are undocumented.",
  supportedIncludeAreas: ["docs", "cli", "package"],
  shouldSkip: (ctx: AuditDetectorContext) => {
    if (!ctx.config.include.includes("docs")) {
      return { skip: true, reason: "--include does not select docs; this detector's checks are docs-based." };
    }
    return { skip: false };
  },
  run: (ctx: AuditDetectorContext): AuditIssue[] => {
    const scriptNames = new Set(Object.keys(ctx.sourceOfTruth.package?.scripts ?? {}));
    const issues: AuditIssue[] = [];
    const contextWarnings = new Set<string>();

    for (const docFile of ctx.inventory.docsFiles) {
      const content = readBoundedText(ctx.target.rootPath, docFile.relativePath, docFile.sizeBytes);
      if (content === null) continue;

      for (const ref of extractDocCommandReferences(content, docFile.relativePath)) {
        if (ref.isLabeledPlanned) continue;

        const directory = ref.packageDirectory;
        const manifestPath = directory ? `${directory}/package.json` : "package.json";
        if (directory === "") {
          if (scriptNames.has(ref.command)) continue;
        } else {
          const metadata = directory === null ? undefined : ctx.sourceOfTruth.nestedPackageScripts.get(directory);
          if (metadata?.state === "valid") {
            if (metadata.scripts.has(ref.command)) continue;
          } else if (metadata?.state !== "no-scripts") {
            const reason = directory === null
              ? "unsupported or ambiguous command context"
              : `${manifestPath}: ${metadata?.state ?? "no eligible inventory entry"}`;
            contextWarnings.add(`${DETECTOR_ID}: ${docFile.relativePath}:${ref.lineNumber}: unresolved package context for npm run ${ref.command} (${reason}).`);
            continue;
          }
        }

        issues.push(
          makeCodeRotIssue({
            auditType: "code-rot",
            detectorId: DETECTOR_ID,
            idCues: [docFile.relativePath, "missing-script", ref.command, ...(directory ? [manifestPath] : [])],
            title: `Documented command "npm run ${ref.command}" is not a current ${manifestPath} script`,
            description: `${docFile.relativePath}:${ref.lineNumber} references "npm run ${ref.command}" as a current command, but no such script exists in ${manifestPath}.`,
            severity: "high",
            confidence: "high",
            falsePositiveRisk: "low",
            category: "stale-command-reference",
            recommendedAction:
              `Either add the missing script to ${manifestPath}, remove the stale example, or label it clearly as planned/future.`,
            suggestedFixStrategy: `Update ${docFile.relativePath} to remove or relabel the "npm run ${ref.command}" example.`,
            validationCommands: ["npm run audit -- --types code-rot --include docs"],
            releaseBlocking: false,
            implementationBlocking: false,
            autoFixEligible: false,
            evidence: [
              {
                kind: "file",
                message: `Referenced command not found in ${manifestPath} scripts.`,
                filePath: docFile.relativePath,
                line: ref.lineNumber,
                excerpt: ref.excerpt,
                source: DETECTOR_ID,
                confidence: "high",
              },
              ...(directory ? [{
                kind: "file" as const,
                message: "Selected package manifest checked for the documented script.",
                filePath: manifestPath,
                source: DETECTOR_ID,
                confidence: "high" as const,
              }] : []),
            ],
            affectedFiles: [docFile.relativePath],
          })
        );
      }
    }

    const commandsDoc = ctx.inventory.docsFiles.find((f) => path.basename(f.relativePath).toLowerCase() === "commands.md");
    const commandsDocContent = commandsDoc
      ? readBoundedText(ctx.target.rootPath, commandsDoc.relativePath, commandsDoc.sizeBytes)
      : null;

    if (commandsDocContent !== null && commandsDoc) {
      for (const scriptName of IMPORTANT_PUBLIC_SCRIPTS) {
        if (!scriptNames.has(scriptName)) continue;
        if (commandsDocContent.includes(scriptName)) continue;

        issues.push(
          makeCodeRotIssue({
            auditType: "code-rot",
            detectorId: DETECTOR_ID,
            idCues: [commandsDoc.relativePath, "undocumented-script", scriptName],
            title: `Implemented script "${scriptName}" is not documented in ${commandsDoc.relativePath}`,
            description: `package.json defines "${scriptName}" but ${commandsDoc.relativePath} never mentions it.`,
            severity: "medium",
            confidence: "medium",
            falsePositiveRisk: "medium",
            category: "undocumented-command",
            recommendedAction: `Add the "${scriptName}" command to ${commandsDoc.relativePath}.`,
            suggestedFixStrategy: `Document "npm run ${scriptName}" with a short usage example in ${commandsDoc.relativePath}.`,
            validationCommands: ["npm run audit -- --types code-rot --include docs"],
            releaseBlocking: false,
            implementationBlocking: false,
            autoFixEligible: false,
            evidence: [
              {
                kind: "reference",
                message: `Script "${scriptName}" present in package.json but not mentioned in ${commandsDoc.relativePath}.`,
                filePath: commandsDoc.relativePath,
                source: DETECTOR_ID,
                confidence: "medium",
              },
            ],
            affectedFiles: [commandsDoc.relativePath],
          })
        );
      }
    }

    for (const warning of contextWarnings) {
      if (!ctx.sourceOfTruth.warnings.includes(warning)) ctx.sourceOfTruth.warnings.push(warning);
    }
    return deduplicateIssuesById(issues);
  },
};

function readBoundedText(root: string, relativePath: string, sizeBytes: number): string | null {
  if (sizeBytes > MAX_DOC_READ_BYTES) return null;
  try {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
  } catch {
    return null;
  }
}
