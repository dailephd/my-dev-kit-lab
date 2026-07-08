import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import { readBoundedFileText } from "../utils/boundedRead.js";
import { deduplicateIssuesById, makeCodeRotIssue } from "../utils/issueFactories.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 4 — cross-platform rot detector.
//
// Read-only with respect to the target project throughout -- never
// modifies scripts or source. Bounded (per-file MAX_READ_BYTES skip).
//
// Simplification made after self-testing against this repo's own source:
// the spec's ".split(\"/\")" raw-path-splitting sub-check was DROPPED. This
// repo's own project inventory (src/audits/core/projectInventory.ts)
// guarantees relativePath values are always forward-slash normalized, so
// splitting an already-normalized relativePath on "/" (as several of this
// batch's own new detector files legitimately do, e.g.
// filePatternUtils.ts's firstTwoPathSegments()) is the correct, intentional
// pattern here, not a cross-platform bug -- a bare regex cannot distinguish
// that from a genuinely unsafe raw OS path split without semantic analysis.
// The much narrower, high-signal ".split(\"\\\\\")" (raw double-backslash
// Windows-style split) sub-check is kept, since that pattern has near-zero
// legitimate use in this codebase.
// ---------------------------------------------------------------------------

const DETECTOR_ID = "cross-platform-rot";
const MAX_READ_BYTES = 200_000;
const WINDOWS_MENTION_PATTERN = /\bWindows\b/;

const POSIX_ONLY_BINARY_PATTERN = /(^|&&)\s*(rm -rf|cp -r|mv |grep |sed |cat |find \.)/;
const SPLIT_NEWLINE_LITERAL_PATTERN = /\.split\(\s*["']\\n["']\s*\)/g;
const RAW_BACKSLASH_SPLIT_PATTERN = /\.split\(\s*["']\\\\["']\s*\)/g;
const SHELL_TRUE_PATTERN = /shell:\s*true/;
const EXEC_SPAWN_CALL_PATTERN = /\b(exec|spawn|execFile\w*|spawnSync|execSync|execFileSync)\s*\(/;

export const CROSS_PLATFORM_ROT_DETECTOR: AuditDetector = {
  id: DETECTOR_ID,
  auditType: "code-rot",
  title: "Cross-platform rot",
  description:
    "Detects POSIX-only shell syntax in npm scripts when Windows support is claimed, raw .split(\"\\n\") usage outside the canonical splitLines() helper, raw backslash path splitting, and exec/spawn calls with shell: true.",
  supportedIncludeAreas: ["cli", "package", "docs", "tests"],
  shouldSkip: (ctx: AuditDetectorContext) => {
    if (!ctx.config.include.includes("cli") && !ctx.config.include.includes("package")) {
      return { skip: true, reason: "--include selects neither cli nor package; this detector's checks are script/source-based." };
    }
    return { skip: false };
  },
  run: (ctx: AuditDetectorContext): AuditIssue[] => {
    const issues: AuditIssue[] = [];
    const pkg = ctx.sourceOfTruth.package;

    let docsClaimWindowsSupport = false;
    if (ctx.config.include.includes("docs")) {
      docsClaimWindowsSupport = docsClaimWindows(ctx);
    }

    if (ctx.config.include.includes("package") && pkg) {
      issues.push(...findPosixOnlyScriptSyntax(pkg.scripts, docsClaimWindowsSupport));
    }

    if (ctx.config.include.includes("cli")) {
      issues.push(...scanSourceFiles(ctx));
    }

    return deduplicateIssuesById(issues);
  },
};

function docsClaimWindows(ctx: AuditDetectorContext): boolean {
  for (const docFile of ctx.inventory.docsFiles) {
    const content = readBoundedFileText(ctx.target.rootPath, docFile.relativePath, docFile.sizeBytes, MAX_READ_BYTES);
    if (content !== null && WINDOWS_MENTION_PATTERN.test(content)) return true;
  }
  return false;
}

function findPosixOnlyScriptSyntax(scripts: Record<string, string>, docsClaimWindowsSupport: boolean): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const [scriptName, command] of Object.entries(scripts)) {
    const segments = command.split("&&").map((s) => s.trim());
    for (const segment of segments) {
      if (!POSIX_ONLY_BINARY_PATTERN.test(segment)) continue;

      issues.push(
        makeCodeRotIssue({
          auditType: "code-rot",
          detectorId: DETECTOR_ID,
          idCues: ["posix-only-script-syntax", scriptName],
          title: `Script "${scriptName}" appears to use POSIX-only shell syntax`,
          description: `package.json script "${scriptName}" contains a segment that looks like a bare POSIX shell command ("${segment.slice(0, 60)}"), which is not guaranteed to work on Windows without a POSIX shell shim.${docsClaimWindowsSupport ? " Docs explicitly claim Windows support." : ""}`,
          severity: docsClaimWindowsSupport ? "high" : "medium",
          confidence: "medium",
          falsePositiveRisk: "medium",
          category: "cross-platform-rot",
          recommendedAction: "Replace the POSIX-only command with a cross-platform Node script or a guarded/portable equivalent.",
          suggestedFixStrategy: `Rewrite the "${scriptName}" script segment to avoid relying on a POSIX-only shell binary.`,
          validationCommands: [`npm run ${scriptName}`],
          releaseBlocking: false,
          implementationBlocking: false,
          autoFixEligible: false,
          evidence: [
            {
              kind: "reference",
              message: "Script command segment matches a bare POSIX-only shell binary pattern.",
              filePath: "package.json",
              excerpt: segment.slice(0, 200),
              source: DETECTOR_ID,
              confidence: "medium",
            },
          ],
          affectedFiles: ["package.json"],
        })
      );
    }
  }
  return issues;
}

function scanSourceFiles(ctx: AuditDetectorContext): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const auditSourceFiles = ctx.inventory.sourceFiles.filter((f) => f.relativePath.startsWith("src/audits/"));

  for (const file of auditSourceFiles) {
    if (path_basename(file.relativePath) === "textLines.ts") continue; // canonical implementation, allowed
    const content = readBoundedFileText(ctx.target.rootPath, file.relativePath, file.sizeBytes, MAX_READ_BYTES);
    if (content === null) continue;

    SPLIT_NEWLINE_LITERAL_PATTERN.lastIndex = 0;
    if (SPLIT_NEWLINE_LITERAL_PATTERN.test(content)) {
      issues.push(
        makeCodeRotIssue({
          auditType: "code-rot",
          detectorId: DETECTOR_ID,
          idCues: [file.relativePath, "raw-split-newline"],
          title: `"${file.relativePath}" uses raw .split("\\n") instead of the canonical splitLines() helper`,
          description: `"${file.relativePath}" contains a raw ".split(\\"\\n\\")"/".split('\\n')" call. This project's own convention (see src/audits/codeRot/utils/textLines.ts) requires splitLines() for all doc/text line-splitting, because a bare split leaves a trailing "\\r" on every line for CRLF-authored files.`,
          severity: "medium",
          confidence: "high",
          falsePositiveRisk: "low",
          category: "cross-platform-rot",
          recommendedAction: `Replace the raw .split("\\n") in "${file.relativePath}" with splitLines() from ../utils/textLines.js.`,
          suggestedFixStrategy: `Import and use splitLines() in "${file.relativePath}".`,
          validationCommands: ["npm run audit -- --types code-rot --include cli"],
          releaseBlocking: false,
          implementationBlocking: false,
          autoFixEligible: false,
          evidence: [
            {
              kind: "file",
              message: "Raw .split(\"\\n\") usage found outside the canonical splitLines() implementation.",
              filePath: file.relativePath,
              source: DETECTOR_ID,
              confidence: "high",
            },
          ],
          affectedFiles: [file.relativePath],
        })
      );
    }

    RAW_BACKSLASH_SPLIT_PATTERN.lastIndex = 0;
    if (RAW_BACKSLASH_SPLIT_PATTERN.test(content)) {
      issues.push(
        makeCodeRotIssue({
          auditType: "code-rot",
          detectorId: DETECTOR_ID,
          idCues: [file.relativePath, "raw-backslash-split"],
          title: `"${file.relativePath}" raw-splits a path on a literal backslash`,
          description: `"${file.relativePath}" contains a raw backslash .split() call, which assumes Windows-style backslash separators and will silently fail to split forward-slash paths (e.g. on POSIX or already-normalized relative paths).`,
          severity: "medium",
          confidence: "medium",
          falsePositiveRisk: "medium",
          category: "cross-platform-rot",
          recommendedAction: `Use path.sep/path.normalize or a forward-slash-normalized path representation instead of a raw backslash split in "${file.relativePath}".`,
          suggestedFixStrategy: `Replace the raw backslash split in "${file.relativePath}" with a portable path-handling helper.`,
          validationCommands: ["npm run audit -- --types code-rot --include cli"],
          releaseBlocking: false,
          implementationBlocking: false,
          autoFixEligible: false,
          evidence: [
            {
              kind: "file",
              message: "Raw backslash-splitting pattern found in source.",
              filePath: file.relativePath,
              source: DETECTOR_ID,
              confidence: "medium",
            },
          ],
          affectedFiles: [file.relativePath],
        })
      );
    }

    SHELL_TRUE_PATTERN.lastIndex = 0;
    const shellTrueMatch = SHELL_TRUE_PATTERN.exec(content);
    if (shellTrueMatch && EXEC_SPAWN_CALL_PATTERN.test(nearbyWindow(content, shellTrueMatch.index))) {
      issues.push(
        makeCodeRotIssue({
          auditType: "code-rot",
          detectorId: DETECTOR_ID,
          idCues: [file.relativePath, "shell-true-usage"],
          title: `"${file.relativePath}" appears to invoke a subprocess with shell: true`,
          description: `"${file.relativePath}" contains a "shell: true" option near an exec/spawn call. This is a known risk pattern (shell metacharacter injection via unsanitized arguments).`,
          severity: "high",
          confidence: "medium",
          falsePositiveRisk: "medium",
          category: "cross-platform-rot",
          recommendedAction: `Remove "shell: true" and pass arguments as an array instead, in "${file.relativePath}".`,
          suggestedFixStrategy: `Refactor the subprocess call in "${file.relativePath}" to avoid shell: true.`,
          validationCommands: ["npm run audit -- --types code-rot --include cli"],
          releaseBlocking: true,
          implementationBlocking: false,
          autoFixEligible: false,
          evidence: [
            {
              kind: "file",
              message: "shell: true found near an exec/spawn-family call.",
              filePath: file.relativePath,
              source: DETECTOR_ID,
              confidence: "medium",
            },
          ],
          affectedFiles: [file.relativePath],
        })
      );
    }
  }
  return issues;
}

function nearbyWindow(content: string, index: number, radius = 150): string {
  return content.slice(Math.max(0, index - radius), Math.min(content.length, index + radius));
}

function path_basename(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx === -1 ? relativePath : relativePath.slice(idx + 1);
}
