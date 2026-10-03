import { describe, expect, it } from "vitest";
import { aggregateContextWindowScaling } from "../../../src/experiments/plugins/contextWindowScaling/metrics.js";
import { LocalSubjectExecutionError } from "../../../src/experiments/plugins/contextWindowScaling/localSubjectErrors.js";
import {
  describeLocalSubjectFailureForPersistence,
  projectEvidenceForExternalLocalPersistence,
  projectExternalLocalTarget,
  projectRunForExternalLocalPersistence,
  redactKnownPaths,
  redactedFileList,
} from "../../../src/experiments/plugins/contextWindowScaling/localSubjectPrivacy.js";
import type { LocalRepositorySubjectManifestV1 } from "../../../src/evaluation/localRepositorySubject/index.js";
import { PASS, caseEvidence, syntheticRun, target, treatmentEvidence } from "./evidenceFactory.js";

const BUDGETS = [8192, 16384];
const KNOWN = ["src/main.ts", "src/secret/ignored.ts", "src/util/helper.ts"];
const PRIVATE_ROOT = process.platform === "win32" ? "C:\\Users\\someone\\private\\repo" : "/home/someone/private/repo";

function evidence() {
  const raw = treatmentEvidence({ variantId: "raw-full-file", budgets: BUDGETS, tokens: 100, shared: PASS, expectedFiles: ["src/main.ts", "src/util/helper.ts"], observedFiles: ["src/main.ts"] });
  raw.evaluation.failureReasons = ["Answer did not mention src/util/helper.ts"];
  raw.evaluation.warnings = [`read ${PRIVATE_ROOT}\\src\\main.ts`];
  raw.errors = [{ code: "x", message: `failed in ${PRIVATE_ROOT} while reading src/secret/ignored.ts` }];
  const guided = treatmentEvidence({ variantId: "my-dev-kit-guided", budgets: BUDGETS, tokens: null, shared: null, expectedFiles: ["src/main.ts"], observedFiles: null });
  return caseEvidence("case-one", [raw, guided]);
}

describe("redactedFileList", () => {
  it("returns one opaque placeholder per file and an empty list for none", () => {
    expect(redactedFileList(0)).toEqual([]);
    expect(redactedFileList(3)).toEqual(["<redacted file 1>", "<redacted file 2>", "<redacted file 3>"]);
  });
});

describe("redactKnownPaths", () => {
  it("replaces longest known paths first, handles both slash styles for private roots, and ignores empty entries", () => {
    const text = `${PRIVATE_ROOT} and ${PRIVATE_ROOT.replace(/\\/g, "/")} saw src/util/helper.ts, src/util and src/main.ts`;
    const redacted = redactKnownPaths(text, ["src/util", "src/util/helper.ts", "src/main.ts", ""], [PRIVATE_ROOT]);
    expect(redacted).not.toContain("someone");
    expect(redacted).not.toContain("helper");
    expect(redacted).not.toContain("main.ts");
    expect(redacted).toContain("<redacted file>");
    expect(redactKnownPaths("nothing here", KNOWN)).toBe("nothing here");
  });
});

describe("projectEvidenceForExternalLocalPersistence", () => {
  const privacy = { knownFiles: KNOWN, privateRoots: [PRIVATE_ROOT] };

  it("keeps counts exact: placeholders for existing files, an empty list stays empty, unavailable stays null", () => {
    const projected = projectEvidenceForExternalLocalPersistence([evidence()], privacy)[0];
    const [raw, guided] = projected.treatments;
    expect(raw.fileIdentityRedaction).toBe("redacted");
    expect(raw.context.observedFiles).toEqual(["<redacted file 1>"]);
    expect(raw.relevantFileEvidence.expectedRelevantFiles).toEqual(["<redacted file 1>", "<redacted file 2>"]);
    expect(raw.relevantFileEvidence.expectedRelevantFileCount).toBe(2);
    expect(raw.relevantFileEvidence.omittedRelevantFiles).toHaveLength(raw.relevantFileEvidence.omittedRelevantFileCount ?? 0);
    // Guided context was never measured: observed provenance is unavailable, which is different from redacted.
    expect(guided.context.observedFiles).toBeNull();
    expect(guided.fileIdentityRedaction).toBe("redacted");
  });

  it("distinguishes redacted from empty: zero observed files stay an empty list", () => {
    const none = treatmentEvidence({ variantId: "raw-full-file", budgets: BUDGETS, tokens: 10, shared: PASS, expectedFiles: [], observedFiles: [] });
    const projected = projectEvidenceForExternalLocalPersistence([caseEvidence("c", [none, none])], privacy)[0].treatments[0];
    expect(projected.context.observedFiles).toEqual([]);
    expect(projected.relevantFileEvidence.expectedRelevantFiles).toEqual([]);
    expect(projected.fileIdentityRedaction).toBe("redacted");
  });

  it("redacts file names and private roots in every free-text field without touching numbers or identifiers", () => {
    const projected = projectEvidenceForExternalLocalPersistence([evidence()], privacy)[0];
    const serialized = JSON.stringify(projected);
    for (const forbidden of ["src/main.ts", "src/util/helper.ts", "src/secret/ignored.ts", "someone", "helper"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    const raw = projected.treatments[0];
    expect(raw.evaluation.failureReasons[0]).toBe("Answer did not mention <redacted file>");
    expect(raw.context.estimatedTokens).toBe(100);
    expect(raw.budgetCells.map((cell) => cell.contextBudgetTokens)).toEqual(BUDGETS);
    expect(projected.caseId).toBe("case-one");
  });

  it("does not mutate its input", () => {
    const original = evidence();
    const snapshot = JSON.stringify(original);
    projectEvidenceForExternalLocalPersistence([original], privacy);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("keeps the aggregate derivable and its counts equal to the unredacted evidence", () => {
    const original = [evidence()];
    const projected = projectEvidenceForExternalLocalPersistence(original, privacy);
    const before = aggregateContextWindowScaling({ contextBudgets: BUDGETS, cases: original });
    const after = aggregateContextWindowScaling({ contextBudgets: BUDGETS, cases: projected });
    const counts = (aggregate: typeof before) =>
      aggregate.caseTreatmentContextSummaries.map((summary) => ({
        observed: summary.observedFileCount,
        expected: summary.relevantFileEvidence.expectedRelevantFileCount,
        omitted: summary.relevantFileEvidence.omittedRelevantFileCount,
        tokens: summary.estimatedTokens,
      }));
    expect(counts(after)).toEqual(counts(before));
  });
});

describe("projectExternalLocalTarget and projectRunForExternalLocalPersistence", () => {
  const manifest = {
    logicalTargetRoot: "local-repository:subject-x",
    repository: { commit: "a".repeat(40), branch: "main", workingTreeDirty: true },
  } as unknown as LocalRepositorySubjectManifestV1;

  it("exposes logical and Git identity only, with an explicit projection marker", () => {
    const projected = projectExternalLocalTarget(manifest);
    expect(projected).toEqual({
      kind: "external-local",
      targetRoot: "local-repository:subject-x",
      toolRoot: "[redacted]",
      packageName: null,
      packageVersion: null,
      hasPackageJson: false,
      hasLockfile: false,
      branch: "main",
      commit: "a".repeat(40),
      hasGit: true,
      isSelf: false,
      privacyProjection: "external-local-redacted",
    });
  });

  it("replaces the target and machine-local metadata of a run without changing the rest", () => {
    const run = syntheticRun(BUDGETS, [evidence()], `${PRIVATE_ROOT}/out/context-window-scaling-execution.json`);
    run.metadata = { ...(run.metadata ?? {}), outputRoot: `${PRIVATE_ROOT}/out` };
    const projected = projectRunForExternalLocalPersistence(run, projectExternalLocalTarget(manifest));
    expect(projected.target.privacyProjection).toBe("external-local-redacted");
    expect(projected.metadata?.outputRoot).toBe("[redacted]");
    expect(projected.metadata?.executionArtifactPath).toBe("context-window-scaling-execution.json");
    expect(projected.runId).toBe(run.runId);
    expect(projected.cases).toEqual(run.cases);
    expect(run.target).toBe(target);
  });
});

describe("describeLocalSubjectFailureForPersistence", () => {
  const withEvidence = (issues: ConstructorParameters<typeof LocalSubjectExecutionError>[0], extra: ConstructorParameters<typeof LocalSubjectExecutionError>[1] = {}) =>
    new LocalSubjectExecutionError(issues, extra);

  it("describes execution failures by case, treatment and error code only", () => {
    const failed = evidence();
    failed.treatments[0].errors = [];
    failed.treatments[1].status = "failed";
    failed.treatments[1].errors = [{ code: "context-construction-failed", message: "returned src/secret/ignored.ts" }];
    const text = describeLocalSubjectFailureForPersistence(
      withEvidence([{ code: "EXECUTION_FAILED", message: "case c treatment t failed: returned src/secret/ignored.ts" }], { caseEvidence: [failed] })
    );
    expect(text).toBe(
      "Local subject execution failed (EXECUTION_FAILED): execution failed (case case-one treatment my-dev-kit-guided: context-construction-failed)."
    );
    expect(text).not.toContain("ignored.ts");
  });

  it("describes a mutation by kind without file names or the comparison", () => {
    const text = describeLocalSubjectFailureForPersistence(
      withEvidence([{ code: "TARGET_MUTATED", message: "the target changed (git.untracked:src/created.ts)" }], {
        immutability: {
          status: "mutated",
          targetRootPath: PRIVATE_ROOT,
          resolvedTargetRootPath: PRIVATE_ROOT,
          preExistingGitStatusEntryCount: 0,
          newMutationCount: 2,
          mutations: [
            { id: "git.untracked:src/created.ts", kind: "git-untracked-file", fieldPath: "x", before: null, after: null },
            { id: "git.status", kind: "git-status", fieldPath: "y", before: null, after: null },
          ],
        },
      })
    );
    expect(text).toBe("Local subject execution failed (TARGET_MUTATED): the target changed during execution (git-status, git-untracked-file); it was not restored.");
    expect(text).not.toContain("created.ts");
    expect(text).not.toContain("someone");
  });

  it("uses fixed generic text for other issues, keeps every issue, and withholds unknown execution detail", () => {
    const text = describeLocalSubjectFailureForPersistence(
      withEvidence([
        { code: "EXECUTION_FAILED", message: `execution threw: ENOENT ${PRIVATE_ROOT}` },
        { code: "SCRATCH_CLEANUP_FAILED", message: `private scratch could not be removed: ${PRIVATE_ROOT}` },
        { code: "WORK_ROOT_INSIDE_TARGET", message: "x" },
      ])
    );
    expect(text).toContain("execution failed before completing (details withheld)");
    expect(text).toContain("the private scratch could not be removed");
    expect(text).toContain("the output directory must be outside the local subject repository");
    expect(text).not.toContain("someone");
    expect(text.startsWith("Local subject execution failed (EXECUTION_FAILED): ")).toBe(true);
  });
});
