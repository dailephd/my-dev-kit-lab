import path from "node:path";
import type { AttackScenario, AttackScenarioContext, AttackScenarioRunOutcome } from "../attackScenario.js";
import { makeEvidence } from "../exploitEvidence.js";
import { captureTargetSnapshot, diffTargetSnapshots, isGeneratedArtifactPath } from "../targetSnapshot.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 3 — target sandbox / read-only validation scenario.
//
// Compares the target's git status "before" (captured by runSecurityValidation
// before any checks ran, threaded via ctx.targetSnapshotBefore) against a
// fresh snapshot taken here (after all other checks in this run finished —
// attack-scenario checks run last in the orchestrator). Never mutates the
// target: only `git status --porcelain` is executed, no clean/reset/restore.
//
// Known limitation: this only detects changes visible to `git status`. It
// cannot detect a file that was modified and then reverted to its original
// content, or changes in a non-git target (which is skipped, not silently
// assumed safe).
// ---------------------------------------------------------------------------

export const TARGET_SANDBOX_SCENARIO: AttackScenario = {
  id: "target-sandbox-read-only",
  title: "Target sandbox: validation does not modify the target working tree",
  description:
    "Compares target git status before and after the validation run to confirm the run did not modify or add tracked/untracked files, and did not write generated security artifacts inside the target.",
  checkId: "boundary",
  applicableProfiles: [],
  severityBaseline: "blocker",
  verdictImpact: "target-project-blocker",
  expectedSafeBehavior:
    "git status for the target is identical before and after the run, except for pre-existing dirtiness which is reported separately and not treated as caused by this run.",
  evidenceRequirements: ["filesystem", "target-modification", "skipped-tool"],
  skipCondition: (ctx: AttackScenarioContext) => {
    if (!ctx.target.hasGit) {
      return "Target is not a git repository; git-status-based read-only verification is not applicable. This does not imply the target was modified.";
    }
    if (!ctx.targetSnapshotBefore || !ctx.targetSnapshotBefore.hasGit) {
      return "No pre-run git status snapshot was available for comparison.";
    }
    return undefined;
  },
  run: async (ctx: AttackScenarioContext): Promise<AttackScenarioRunOutcome> => {
    const before = ctx.targetSnapshotBefore!;
    const after = captureTargetSnapshot(ctx.target.targetRoot, ctx.target.hasGit);
    const diff = diffTargetSnapshots(before, after);

    if (!diff.comparable) {
      return {
        status: "blocked",
        confidence: "low",
        evidence: [
          makeEvidence({
            kind: "skipped-tool",
            source: "git status --porcelain",
            confidence: "low",
            observedBehavior: diff.reason,
            expectedBehavior: "git status should be readable before and after the run for comparison.",
          }),
        ],
        recommendation: "Ensure git is available and the target is a valid git repository to enable this check.",
      };
    }

    const newGeneratedArtifacts = diff.newEntries.filter((e) => isGeneratedArtifactPath(e.path));
    const newOtherEntries = diff.newEntries.filter((e) => !isGeneratedArtifactPath(e.path));

    const evidence = [];

    if (diff.preExistingEntries.length > 0) {
      evidence.push(
        makeEvidence({
          kind: "observation",
          source: "git status --porcelain (before)",
          confidence: "high",
          observedBehavior: `${diff.preExistingEntries.length} pre-existing dirty entr${diff.preExistingEntries.length === 1 ? "y" : "ies"} (not caused by this run).`,
          rawPreview: diff.preExistingEntries.map((e) => `${e.code} ${e.path}`).join(", "),
        })
      );
    }

    for (const entry of newGeneratedArtifacts.slice(0, 10)) {
      evidence.push(
        makeEvidence({
          kind: "target-modification",
          source: "git status --porcelain (after)",
          filePath: entry.path,
          confidence: "high",
          expectedBehavior: "Generated security artifacts must not be written inside the target working tree.",
          observedBehavior: `New entry '${entry.code} ${entry.path}' appeared inside the target during validation.`,
        })
      );
    }

    for (const entry of newOtherEntries.slice(0, 10)) {
      evidence.push(
        makeEvidence({
          kind: "target-modification",
          source: "git status --porcelain (after)",
          filePath: entry.path,
          confidence: "high",
          expectedBehavior: "Target tracked/untracked files must remain unchanged during validation.",
          observedBehavior: `New entry '${entry.code} ${entry.path}' appeared inside the target during validation.`,
        })
      );
    }

    if (newGeneratedArtifacts.length > 0 || newOtherEntries.length > 0) {
      return {
        status: "failed",
        confidence: "high",
        evidence,
        category: "artifact-safety",
        recommendation:
          newGeneratedArtifacts.length > 0
            ? "Generated security report/artifact directories must only be written under the tool's own output area, never inside the target project."
            : "Validation must be strictly read-only with respect to the target working tree.",
      };
    }

    return {
      status: "passed",
      confidence: "high",
      evidence,
      category: "artifact-safety",
    };
  },
};

// Exposed for tests / reuse: default reportDir/rawOutputDir collision check
// used by outputBoundaryScenario, kept here since it reasons about the same
// "target boundary" concept.
export function reportDirIsInsideExternalTarget(reportDir: string, targetRoot: string, isSelf: boolean): boolean {
  if (isSelf) return false;
  const resolvedReportDir = path.resolve(reportDir);
  const resolvedTargetRoot = path.resolve(targetRoot);
  const relative = path.relative(resolvedTargetRoot, resolvedReportDir);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
