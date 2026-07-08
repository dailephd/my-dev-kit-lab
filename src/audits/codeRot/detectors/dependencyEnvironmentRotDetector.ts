import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import { readBoundedFileText } from "../utils/boundedRead.js";
import { deduplicateIssuesById, makeCodeRotIssue } from "../utils/issueFactories.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 4 — dependency/environment rot detector.
//
// Purely local: reads already-collected sourceOfTruth plus a bounded direct
// read of docs content. No npm install/audit/registry calls and no
// subprocess execution anywhere in this file (enforced by a structural
// test, see dependencyEnvironmentRotDetector.test.ts).
// ---------------------------------------------------------------------------

const DETECTOR_ID = "dependency-environment-rot";
const MAX_READ_BYTES = 200_000;
const OTHER_PACKAGE_MANAGER_INSTALL_PATTERN = /\b(yarn add|pnpm add|pnpm install)\b/gi;
const NPM_INSTALL_NEARBY_PATTERN = /\bnpm (install|ci)\b/i;
const NODE_POLICY_CLAIM_PATTERN = /latest[- ]two|node (?:lts )?policy/i;
const OPTIONAL_TOOL_PATTERN = /\b(codeql|semgrep|osv-scanner)\b/gi;

export const DEPENDENCY_ENVIRONMENT_ROT_DETECTOR: AuditDetector = {
  id: DETECTOR_ID,
  auditType: "code-rot",
  title: "Dependency/environment rot",
  description:
    "Detects package-manager instruction mismatches against the lockfile, Node engine/CI version mismatches, unverifiable Node-policy claims, and scripts invoking optional external tools that are undocumented.",
  supportedIncludeAreas: ["package", "docs", "cli"],
  shouldSkip: (ctx: AuditDetectorContext) => {
    if (!ctx.config.include.includes("package")) {
      return { skip: true, reason: "--include does not select package; this detector's primary signal is package.json/lockfile/CI metadata." };
    }
    return { skip: false };
  },
  run: (ctx: AuditDetectorContext): AuditIssue[] => {
    const issues: AuditIssue[] = [];
    const pkg = ctx.sourceOfTruth.package;
    if (!pkg) return issues;

    if (ctx.config.include.includes("docs")) {
      const docsConcat = concatDocsContent(ctx);
      issues.push(...findPackageManagerMismatch(ctx, docsConcat));
      issues.push(...findNodePolicyClaimMismatch(ctx, docsConcat));
      issues.push(...findUndocumentedOptionalTools(ctx, docsConcat));
    }

    issues.push(...findNodeEngineCiMismatch(ctx));

    return deduplicateIssuesById(issues);
  },
};

function concatDocsContent(ctx: AuditDetectorContext): { relativePath: string; content: string }[] {
  const parts: { relativePath: string; content: string }[] = [];
  for (const docFile of ctx.inventory.docsFiles) {
    const content = readBoundedFileText(ctx.target.rootPath, docFile.relativePath, docFile.sizeBytes, MAX_READ_BYTES);
    if (content !== null) parts.push({ relativePath: docFile.relativePath, content });
  }
  return parts;
}

function findPackageManagerMismatch(ctx: AuditDetectorContext, docs: readonly { relativePath: string; content: string }[]): AuditIssue[] {
  if (!ctx.sourceOfTruth.lockfile.present) return [];

  const issues: AuditIssue[] = [];
  for (const doc of docs) {
    OTHER_PACKAGE_MANAGER_INSTALL_PATTERN.lastIndex = 0;
    for (const match of doc.content.matchAll(OTHER_PACKAGE_MANAGER_INSTALL_PATTERN)) {
      const matchIndex = match.index ?? 0;
      const windowStart = Math.max(0, matchIndex - 150);
      const windowEnd = Math.min(doc.content.length, matchIndex + match[0].length + 150);
      const window = doc.content.slice(windowStart, windowEnd);
      if (NPM_INSTALL_NEARBY_PATTERN.test(window)) continue;

      issues.push(
        makeCodeRotIssue({
          auditType: "code-rot",
          detectorId: DETECTOR_ID,
          idCues: [doc.relativePath, "package-manager-mismatch", match[0].toLowerCase()],
          title: `${doc.relativePath} instructs "${match[0]}" as install method, but package-lock.json (npm) is present`,
          description: `${doc.relativePath} mentions "${match[0]}" as an install instruction with no nearby "npm install"/"npm ci" mention, but this project has an npm package-lock.json as its lockfile.`,
          severity: "medium",
          confidence: "medium",
          falsePositiveRisk: "medium",
          category: "dependency-environment-rot",
          recommendedAction: `Update ${doc.relativePath} to instruct "npm install" or "npm ci" instead.`,
          suggestedFixStrategy: `Replace "${match[0]}" with the npm equivalent in ${doc.relativePath}.`,
          validationCommands: ["npm run audit -- --types code-rot --include package,docs"],
          releaseBlocking: false,
          implementationBlocking: false,
          autoFixEligible: false,
          evidence: [
            {
              kind: "file",
              message: `Doc references "${match[0]}" without a nearby npm install/ci mention, while package-lock.json (npm) is present.`,
              filePath: doc.relativePath,
              source: DETECTOR_ID,
              confidence: "medium",
            },
          ],
          affectedFiles: [doc.relativePath, "package-lock.json"],
        })
      );
    }
  }
  return issues;
}

function findNodeEngineCiMismatch(ctx: AuditDetectorContext): AuditIssue[] {
  const engines = ctx.sourceOfTruth.package?.engines;
  const nodeEngine = engines?.node;
  if (!nodeEngine) return [];

  const minMatch = nodeEngine.match(/>=?\s*(\d+)/);
  if (!minMatch) return [];
  const minVersion = Number(minMatch[1]);

  const issues: AuditIssue[] = [];
  for (const workflow of ctx.sourceOfTruth.ci.workflows) {
    for (const versionStr of workflow.nodeVersionsReferenced) {
      const versionNum = Number(versionStr);
      if (Number.isNaN(versionNum)) continue;
      if (versionNum >= minVersion) continue;

      issues.push(
        makeCodeRotIssue({
          auditType: "code-rot",
          detectorId: DETECTOR_ID,
          idCues: [workflow.relativePath, "node-engine-ci-mismatch", versionStr],
          title: `CI workflow "${workflow.relativePath}" uses Node ${versionStr}, below package.json's engines.node minimum (${nodeEngine})`,
          description: `package.json declares "engines.node": "${nodeEngine}" (minimum ${minVersion}), but ${workflow.relativePath} references Node ${versionStr}.`,
          severity: "medium",
          confidence: "high",
          falsePositiveRisk: "low",
          category: "dependency-environment-rot",
          recommendedAction: `Update ${workflow.relativePath}'s Node version matrix or relax package.json's engines.node constraint.`,
          suggestedFixStrategy: `Align the Node version in ${workflow.relativePath} with package.json's "engines.node" field.`,
          validationCommands: ["npm run audit -- --types code-rot --include package"],
          releaseBlocking: false,
          implementationBlocking: false,
          autoFixEligible: false,
          evidence: [
            {
              kind: "file",
              message: `CI Node version (${versionStr}) is below package.json's engines.node minimum (${minVersion}).`,
              filePath: workflow.relativePath,
              expected: nodeEngine,
              observed: versionStr,
              source: DETECTOR_ID,
              confidence: "high",
            },
          ],
          affectedFiles: [workflow.relativePath, "package.json"],
        })
      );
    }
  }
  return issues;
}

function findNodePolicyClaimMismatch(ctx: AuditDetectorContext, docs: readonly { relativePath: string; content: string }[]): AuditIssue[] {
  const allWorkflowVersions = new Set<string>();
  for (const workflow of ctx.sourceOfTruth.ci.workflows) {
    for (const v of workflow.nodeVersionsReferenced) allWorkflowVersions.add(v);
  }
  // Only flag when the claim is checkable in a low-noise way: CI has exactly
  // one pinned version total, yet docs explicitly claim a multi-version
  // policy.
  if (allWorkflowVersions.size !== 1) return [];

  const issues: AuditIssue[] = [];
  for (const doc of docs) {
    if (!NODE_POLICY_CLAIM_PATTERN.test(doc.content)) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [doc.relativePath, "node-policy-claim-mismatch"],
        title: `${doc.relativePath} claims a multi-version Node policy, but CI pins exactly one Node version`,
        description: `${doc.relativePath} mentions a "latest two"/Node LTS policy claim, but CI workflows collectively reference exactly one Node version (${[...allWorkflowVersions][0]}).`,
        severity: "medium",
        confidence: "medium",
        falsePositiveRisk: "medium",
        category: "dependency-environment-rot",
        recommendedAction: `Update ${doc.relativePath} or expand the CI Node version matrix to match the claim.`,
        suggestedFixStrategy: `Align the Node-version policy claim in ${doc.relativePath} with the actual CI matrix.`,
        validationCommands: ["npm run audit -- --types code-rot --include package,docs"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "observation",
            message: "Doc claims a multi-version Node policy while CI references exactly one Node version.",
            filePath: doc.relativePath,
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: [doc.relativePath],
      })
    );
  }
  return issues;
}

function findUndocumentedOptionalTools(ctx: AuditDetectorContext, docs: readonly { relativePath: string; content: string }[]): AuditIssue[] {
  const pkg = ctx.sourceOfTruth.package;
  if (!pkg) return [];

  const mentionedTools = new Set<string>();
  for (const [scriptName, command] of Object.entries(pkg.scripts)) {
    OPTIONAL_TOOL_PATTERN.lastIndex = 0;
    for (const match of command.matchAll(OPTIONAL_TOOL_PATTERN)) {
      mentionedTools.add(`${match[1].toLowerCase()}::${scriptName}`);
    }
  }
  if (mentionedTools.size === 0) return [];

  const combinedDocsLower = docs.map((d) => d.content).join("\n").toLowerCase();
  const issues: AuditIssue[] = [];
  const seenTools = new Set<string>();
  for (const entry of mentionedTools) {
    const [tool, scriptName] = entry.split("::");
    if (seenTools.has(tool)) continue;
    if (combinedDocsLower.includes(tool)) continue;
    seenTools.add(tool);

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["undocumented-optional-tool", tool],
        title: `Script "${scriptName}" invokes external tool "${tool}", which is not mentioned in any doc`,
        description: `package.json script "${scriptName}" invokes "${tool}", but no doc file mentions it as optional or required.`,
        severity: "low",
        confidence: "low",
        falsePositiveRisk: "medium",
        category: "dependency-environment-rot",
        recommendedAction: `Document "${tool}" as an optional/required tool in the relevant docs.`,
        suggestedFixStrategy: `Add a short mention of "${tool}" (optional/required, and how it's skipped when unavailable) to docs/COMMANDS.md.`,
        validationCommands: ["npm run audit -- --types code-rot --include package,docs"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "observation",
            message: `"${tool}" appears in a package.json script command but not in any doc file.`,
            filePath: "package.json",
            source: DETECTOR_ID,
            confidence: "low",
          },
        ],
        affectedFiles: ["package.json"],
      })
    );
  }
  return issues;
}
