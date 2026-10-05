import { describe, expect, it } from "vitest";
import { checkRetrievalRedactionTruthfulness } from "../../../scripts/externalLocalPrivacyScan.js";
import {
  aggregateRetrievalPrecisionRecall,
  assertExternalLocalProjectionIsPrivate,
  describeRetrievalLocalSubjectFailureForPersistence,
  projectRetrievalEvidenceForExternalLocalPersistence,
  REDACTED_CASE_TITLE,
  type RetrievalPrecisionRecallCaseEvidenceV1
} from "../../../src/experiments/plugins/retrievalPrecisionRecall/index.js";
import { LocalSubjectExecutionError } from "../../../src/experiments/plugins/contextWindowScaling/localSubjectErrors.js";
import { caseEvidenceFor, evidenceOf, failedCaseEvidence, makeEvaluationCase } from "./retrievalPrecisionRecallTestHelpers.js";

const caseA = makeEvaluationCase({ id: "ext-a", project: "subject", files: ["src/private-a.ts", "src/private-b.ts", "src/private-c.ts"], symbols: ["SecretAlpha", "SecretBeta", "SecretGamma"], locality: "cross-module" });
const caseB = makeEvaluationCase({ id: "ext-b", project: "subject", files: ["src/private-a.ts"], symbols: ["SecretAlpha"] });

function realEvidence(): RetrievalPrecisionRecallCaseEvidenceV1[] {
  const a = caseEvidenceFor(
    caseA,
    evidenceOf(["src/private-a.ts", "src/noise-one.ts", "src/noise-two.ts"], [{ name: "SecretAlpha", file: "src/private-a.ts" }, { name: "NoiseSymbol", file: "src/noise-one.ts" }]),
    321
  );
  a.retrieval!.warnings = ["upstream said: could not read src/private-a.ts", "second warning RPR_WARNING_PROSE"];
  a.errors = [{ code: "retrieval-failed", message: "raw caught error mentioning src/private-b.ts" }];
  const b = caseEvidenceFor(caseB, evidenceOf([]), 0); // trustworthy empty retrieval: empty identity lists must stay empty
  const c = caseEvidenceFor(caseB, evidenceOf(["src/private-a.ts"], [], "partial")); // unavailable lists must stay null
  c.caseId = "ext-c";
  return [a, b, c, { ...failedCaseEvidence(caseB), caseId: "ext-d" }];
}

describe("external-local privacy projection", () => {
  it("TST-B4-023 redacts the case title and stamps one explicit redaction marker on every case", () => {
    const projected = projectRetrievalEvidenceForExternalLocalPersistence(realEvidence());
    for (const entry of projected) {
      expect(entry.caseName).toBe(REDACTED_CASE_TITLE);
      expect(entry.identityRedaction).toEqual({ fileIdentities: "redacted", symbolIdentities: "redacted", factIdentities: "redacted", warningText: "redacted", caseTitle: "redacted" });
    }
    expect(projected.map((entry) => entry.caseId)).toEqual(["ext-a", "ext-b", "ext-c", "ext-d"]);
    expect(projected[0].benchmarkProject).toBe("subject");
    expect(projected[0].taskLocality).toBe("cross-module");
  });

  it("TST-B4-024/025/026 replaces file, symbol and fact identities with numbered placeholders of the exact same count", () => {
    const original = realEvidence()[0];
    const [projected] = projectRetrievalEvidenceForExternalLocalPersistence([original]);
    const q = projected.quality!;
    const o = original.quality!;
    expect(q.file.relevantRetrievedFiles).toEqual(["<redacted file 1>"]);
    expect(q.file.irrelevantRetrievedFiles).toEqual(["<redacted file 1>", "<redacted file 2>"]);
    expect(q.file.missedFiles).toEqual(["<redacted file 1>", "<redacted file 2>"]);
    expect(q.symbol.relevantRetrievedSymbols).toEqual(["<redacted symbol 1>"]);
    expect(q.symbol.irrelevantRetrievedSymbols).toEqual(["<redacted symbol 1>"]);
    expect(q.symbol.missedSymbols).toEqual(["<redacted symbol 1>", "<redacted symbol 2>"]);
    expect(q.fact.coveredFactIds?.length).toBe(o.fact.coveredFactIds?.length);
    expect(q.fact.uncoveredFactIds?.length).toBe(o.fact.uncoveredFactIds?.length);
    for (const id of [...(q.fact.coveredFactIds ?? []), ...(q.fact.uncoveredFactIds ?? [])]) expect(id).toMatch(/^<redacted fact \d+>$/);
    // Counts that pair with a list keep matching its length.
    expect(q.file.missedFileCount).toBe(q.file.missedFiles!.length);
    expect(q.symbol.missedSymbolCount).toBe(q.symbol.missedSymbols!.length);
    expect(q.fact.uncoveredFactCount).toBe(q.fact.uncoveredFactIds!.length);
  });

  it("TST-B4-027 never persists upstream warning prose, keeping only a count of placeholders", () => {
    const [projected] = projectRetrievalEvidenceForExternalLocalPersistence([realEvidence()[0]]);
    expect(projected.retrieval!.warnings).toEqual(["<redacted warning 1>", "<redacted warning 2>"]);
    expect(JSON.stringify(projected)).not.toMatch(/could not read|RPR_WARNING_PROSE|upstream said/);
    // Caught error text is replaced by plugin-owned fixed text, never copied.
    expect(projected.errors).toEqual([{ code: "retrieval-failed", message: "The retrieval did not complete." }]);
    expect(JSON.stringify(projected)).not.toContain("raw caught error");
  });

  it("TST-B4-028/039 keeps every number, availability, reason and aggregate exactly equal", () => {
    const original = realEvidence();
    const projected = projectRetrievalEvidenceForExternalLocalPersistence(original);
    const stripIdentity = (value: unknown): unknown =>
      JSON.parse(JSON.stringify(value, (key, v) => (Array.isArray(v) && v.every((item) => typeof item === "string" && /^</.test(item)) && /Files?$|Symbols?$|Ids$|^warnings$/.test(key) ? "IDENTITY_LIST" : v)));
    for (const [index, entry] of projected.entries()) {
      const before = original[index].quality;
      const after = entry.quality;
      if (before === null) {
        expect(after).toBeNull();
        continue;
      }
      for (const key of ["precision", "recall"] as const) {
        expect(after!.file[key]).toEqual(before.file[key]);
        expect(after!.symbol[key]).toEqual(before.symbol[key]);
      }
      expect(after!.fact.coverage).toEqual(before.fact.coverage);
      expect(after!.irrelevantContextRatio).toEqual(before.irrelevantContextRatio);
      expect(after!.retrievedTokenCount).toBe(before.retrievedTokenCount);
      expect(after!.tokenCountMethod).toBe(before.tokenCountMethod);
      expect(after!.expectations).toEqual(before.expectations);
      expect(after!.evidence).toEqual(before.evidence);
      expect(after!.file.missedFileCount).toBe(before.file.missedFileCount);
      expect(after!.symbol.missedSymbolCount).toBe(before.symbol.missedSymbolCount);
      expect(after!.fact.uncoveredFactCount).toBe(before.fact.uncoveredFactCount);
      expect(original[index].retrieval === null ? null : entry.retrieval!.evidenceAvailability).toBe(original[index].retrieval?.evidenceAvailability ?? null);
      expect(entry.retrieval?.commands).toEqual(original[index].retrieval?.commands);
      expect(entry.status).toBe(original[index].status);
    }
    // Aggregates over the projected evidence equal those over the real evidence: projection loses no scientific number.
    expect(aggregateRetrievalPrecisionRecall(projected)).toEqual(aggregateRetrievalPrecisionRecall(original));
    void stripIdentity;
  });

  it("TST-B4-029 preserves null versus empty identity-list semantics", () => {
    const projected = projectRetrievalEvidenceForExternalLocalPersistence(realEvidence());
    const empty = projected[1].quality!; // available, nothing retrieved
    expect(empty.file.relevantRetrievedFiles).toEqual([]);
    expect(empty.file.irrelevantRetrievedFiles).toEqual([]);
    expect(empty.file.missedFiles).toEqual(["<redacted file 1>"]);
    expect(empty.symbol.relevantRetrievedSymbols).toEqual([]);
    const unavailable = projected[2].quality!; // partial evidence: lists could not be computed
    expect(unavailable.file.relevantRetrievedFiles).toBeNull();
    expect(unavailable.file.missedFiles).toBeNull();
    expect(unavailable.symbol.missedSymbols).toBeNull();
    expect(unavailable.fact.uncoveredFactIds).toBeNull();
    expect(projected[3].quality).toBeNull();
    expect(projected[3].retrieval).toBeNull();
  });

  it("passes the shared truthfulness checker, and the checker detects violations", () => {
    const projected = projectRetrievalEvidenceForExternalLocalPersistence(realEvidence());
    expect(checkRetrievalRedactionTruthfulness({ cases: projected })).toEqual([]);

    const broken = structuredClone(projected);
    broken[0].caseName = "Real private title";
    broken[0].quality!.file.missedFiles = ["src/private-b.ts"];
    broken[0].quality!.file.missedFileCount = 5;
    delete (broken[1] as { identityRedaction?: unknown }).identityRedaction;
    const problems = checkRetrievalRedactionTruthfulness({ cases: broken });
    expect(problems.length).toBeGreaterThanOrEqual(4);
    expect(problems.join("\n")).toContain("caseName is not the fixed placeholder");
    expect(problems.join("\n")).toContain("missedFiles[0] is not <redacted file 1>");
    expect(problems.join("\n")).toContain("differs from its count");
    expect(checkRetrievalRedactionTruthfulness({})).toEqual(["artifact has no cases"]);
  });

  it("does not mutate the real evidence it projects", () => {
    const original = realEvidence();
    const snapshot = JSON.stringify(original);
    projectRetrievalEvidenceForExternalLocalPersistence(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("assertExternalLocalProjectionIsPrivate", () => {
  const privateValues = { filePaths: ["src/private-a.ts", "src\\win\\private.ts"], caseTitles: ["A Private Title"], warnings: ["warning prose"] };

  it("accepts a projection and rejects any surviving private file path, title or warning", () => {
    const projected = projectRetrievalEvidenceForExternalLocalPersistence(realEvidence());
    expect(() => assertExternalLocalProjectionIsPrivate(projected, privateValues)).not.toThrow();
    for (const leak of ["src/private-a.ts", "A Private Title", "warning prose", "src\\win\\private.ts"]) {
      expect(() => assertExternalLocalProjectionIsPrivate({ nested: [{ text: `x ${leak} y` }] }, privateValues), leak).toThrow(
        "External-local privacy projection check failed; no durable output was written."
      );
    }
  });
});

describe("describeRetrievalLocalSubjectFailureForPersistence", () => {
  it("describes failures with codes, logical case ids, counts and mutation kinds only", () => {
    const error = new LocalSubjectExecutionError(
      [
        { code: "RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE", message: "case ext-a: retrieval exposed 2 file identities outside the eligible subject universe." },
        { code: "TARGET_MUTATED", message: "the target changed during execution; it was not restored." },
        { code: "SCRATCH_CLEANUP_FAILED", message: "the private scratch could not be removed." }
      ],
      { immutability: { status: "mutated", preExistingGitStatusEntryCount: 0, mutations: [{ id: "private/path.ts", kind: "modified" }, { id: "other.ts", kind: "added" }] } as never }
    );
    const text = describeRetrievalLocalSubjectFailureForPersistence(error);
    expect(text).toBe(
      "Local subject execution failed (RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE): case ext-a: retrieval exposed 2 file identities outside the eligible subject universe; the target changed during execution (added, modified); it was not restored; the private scratch could not be removed."
    );
    expect(text).not.toMatch(/private\/path|other\.ts/);
  });

  it("uses fixed generic text for snapshot and exclusion codes", () => {
    const error = new LocalSubjectExecutionError([{ code: "BEFORE_SNAPSHOT_FAILED", message: "target snapshot before execution failed (X)." }]);
    expect(describeRetrievalLocalSubjectFailureForPersistence(error)).toBe(
      "Local subject execution failed (BEFORE_SNAPSHOT_FAILED): the target snapshot before execution could not be captured."
    );
  });
});
