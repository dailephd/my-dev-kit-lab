import type { AttackScenario, AttackScenarioContext, AttackScenarioRunOutcome } from "../attackScenario.js";
import { makeEvidence } from "../exploitEvidence.js";
import { getPayloadsForGroup } from "../payloadCorpus.js";
import { resolveWithinRoot } from "../../../core/pathSafety.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 3 — path traversal scenario.
//
// Exercises the existing src/core/pathSafety.ts containment helper
// (resolveWithinRoot) — used for writes that must stay within a declared
// root — against the deterministic path-traversal payload corpus, plus a
// small set of legitimate paths that must continue to be accepted (spaces,
// safe relative/absolute-within-root paths). Pure path-math only; nothing is
// read or written to disk.
// ---------------------------------------------------------------------------

const LEGITIMATE_PATH_CASES = [
  { id: "relative-with-spaces", value: "safe sub dir/output.txt", shouldReject: false },
  { id: "relative-nested", value: "a/b/c/output.json", shouldReject: false },
];

export const PATH_TRAVERSAL_SCENARIO: AttackScenario = {
  id: "path-traversal-containment",
  title: "Path traversal: containment helper rejects escape payloads and accepts legitimate paths",
  description:
    "Verifies resolveWithinRoot() rejects the deterministic path-traversal payload corpus and continues to accept legitimate relative paths, including ones with spaces.",
  checkId: "boundary",
  applicableProfiles: [],
  severityBaseline: "blocker",
  verdictImpact: "tool-framework-blocker",
  expectedSafeBehavior:
    "Every path-traversal payload throws when passed to resolveWithinRoot(); every legitimate path resolves without throwing.",
  evidenceRequirements: ["filesystem", "observation"],
  run: async (ctx: AttackScenarioContext): Promise<AttackScenarioRunOutcome> => {
    const evidence = [];
    const unrejectedTraversals: string[] = [];
    const wronglyRejectedLegit: string[] = [];

    // Payloads whose escape depends on a URL-decode step that never happens
    // at the filesystem-path layer (resolveWithinRoot does no decoding, by
    // design — Node's path module treats "%2f" as a literal filename
    // character, not a separator). These correctly resolve *inside* root and
    // are recorded as informational evidence only, not a rejection failure.
    const payloadsNotApplicableToRawPathResolution = new Set(["path-traversal-encoded"]);

    const traversalPayloads = getPayloadsForGroup("path-traversal");
    for (const p of traversalPayloads) {
      let rejected = false;
      let observed = "";
      try {
        const resolved = resolveWithinRoot(ctx.target.targetRoot, p.value);
        observed = `Resolved to '${resolved}' without being rejected.`;
      } catch {
        rejected = true;
        observed = "Rejected (threw), as expected.";
      }
      if (!rejected && !payloadsNotApplicableToRawPathResolution.has(p.id)) {
        unrejectedTraversals.push(p.id);
      }
      evidence.push(
        makeEvidence({
          kind: "filesystem",
          source: `resolveWithinRoot() with payload '${p.id}'`,
          confidence: "high",
          expectedBehavior: payloadsNotApplicableToRawPathResolution.has(p.id)
            ? "No path separators present without decoding; resolving inside root is safe (not an escape)."
            : "Path-traversal payloads must be rejected (thrown), never silently resolved.",
          observedBehavior: observed,
          rawPreview: p.value,
        })
      );
    }

    for (const c of LEGITIMATE_PATH_CASES) {
      let accepted = false;
      let observed = "";
      try {
        const resolved = resolveWithinRoot(ctx.target.targetRoot, c.value);
        accepted = true;
        observed = `Resolved to '${resolved}' as expected.`;
      } catch (err) {
        observed = `Unexpectedly rejected: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (!accepted) {
        wronglyRejectedLegit.push(c.id);
      }
      evidence.push(
        makeEvidence({
          kind: "filesystem",
          source: `resolveWithinRoot() with legitimate path '${c.id}'`,
          confidence: "high",
          expectedBehavior: "Legitimate relative paths (including ones with spaces) must be accepted.",
          observedBehavior: observed,
          rawPreview: c.value,
        })
      );
    }

    if (unrejectedTraversals.length > 0 || wronglyRejectedLegit.length > 0) {
      const parts: string[] = [];
      if (unrejectedTraversals.length > 0) {
        parts.push(`${unrejectedTraversals.length} traversal payload(s) were not rejected: ${unrejectedTraversals.join(", ")}`);
      }
      if (wronglyRejectedLegit.length > 0) {
        parts.push(`${wronglyRejectedLegit.length} legitimate path(s) were wrongly rejected: ${wronglyRejectedLegit.join(", ")}`);
      }
      return {
        status: "failed",
        confidence: "high",
        evidence,
        recommendation: parts.join("; "),
      };
    }

    return {
      status: "passed",
      confidence: "high",
      evidence,
    };
  },
};
