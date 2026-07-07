import path from "node:path";
import type { AttackScenario, AttackScenarioContext, AttackScenarioRunOutcome } from "../attackScenario.js";
import { makeEvidence } from "../exploitEvidence.js";
import { getPayloadsForGroup } from "../payloadCorpus.js";
import { reportDirIsInsideExternalTarget } from "./targetSandboxScenario.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 3 — output/generated-artifact boundary scenario.
//
// Two parts:
//  1. A real safety check: does the *default* (no --out) report output
//     directory resolve inside an external target's working tree? That is
//     the one genuinely dangerous default-behavior case (Batch 1/2 already
//     made --out itself user-directed and unrestricted by design, so an
//     explicit --out escaping is not itself a finding here).
//  2. Deterministic, non-destructive classification of the "output-boundary"
//     payload corpus (paths with spaces, relative, absolute, home-dir) to
//     produce evidence that path resolution behaves predictably — this does
//     not write any files.
// ---------------------------------------------------------------------------

export const OUTPUT_BOUNDARY_SCENARIO: AttackScenario = {
  id: "output-boundary-report-dir",
  title: "Output boundary: generated reports are not written inside an external target",
  description:
    "Confirms the default report output directory does not resolve inside an external target's working tree, and classifies output-boundary payload path resolution without writing any files.",
  checkId: "boundary",
  applicableProfiles: [],
  severityBaseline: "major",
  verdictImpact: "release-blocker",
  expectedSafeBehavior:
    "The default report output directory resolves outside any external target's working tree; payload path resolution is deterministic.",
  evidenceRequirements: ["filesystem", "observation"],
  run: async (ctx: AttackScenarioContext): Promise<AttackScenarioRunOutcome> => {
    const evidence = [];
    const insideTarget = reportDirIsInsideExternalTarget(
      ctx.config.reportDir,
      ctx.target.targetRoot,
      ctx.target.isSelf
    );

    evidence.push(
      makeEvidence({
        kind: "filesystem",
        source: "default report output directory",
        filePath: path.resolve(ctx.config.reportDir),
        confidence: "high",
        expectedBehavior: "Default report output directory must not resolve inside an external target project.",
        observedBehavior: ctx.target.isSelf
          ? "Self-validation: report directory is expected to be under the tool root."
          : insideTarget
            ? `Report directory resolves inside external target root '${ctx.target.targetRoot}'.`
            : `Report directory resolves outside external target root '${ctx.target.targetRoot}'.`,
      })
    );

    const payloads = getPayloadsForGroup("output-boundary");
    for (const p of payloads) {
      const resolved = path.resolve(ctx.toolRoot, p.value);
      evidence.push(
        makeEvidence({
          kind: "observation",
          source: `output-boundary payload '${p.id}'`,
          confidence: "medium",
          observedBehavior: `Resolved deterministically without any file write.`,
          rawPreview: `${p.value} -> ${resolved}`,
        })
      );
    }

    if (insideTarget) {
      return {
        status: "failed",
        confidence: "high",
        evidence,
        recommendation:
          "Ensure the default report output directory is derived from the tool root, not the target root, for external-target validation.",
      };
    }

    return {
      status: "passed",
      confidence: "high",
      evidence,
    };
  },
};
