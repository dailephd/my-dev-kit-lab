import { describe, expect, it } from "vitest";
import {
  buildRequiredFileEvidence,
  classifyStaleRisk,
  compareCorrectness,
  compareRequiredFileEvidence,
  normalizeRequiredFilePath,
  type CorrectnessComparableV1,
  type RequiredFileEvidenceStatusV1
} from "../../../src/experiments/plugins/incrementalChangeStaleness/comparison.js";

const AVAILABLE = (score: number): CorrectnessComparableV1 => ({ available: true, score });
const UNAVAILABLE: CorrectnessComparableV1 = { available: false };

describe("correctness comparison (TST-B4-029..032)", () => {
  it("stale score lower -> stale-worse", () => {
    expect(compareCorrectness(AVAILABLE(0.5), AVAILABLE(0.9))).toBe("stale-worse");
  });
  it("equal scores -> same", () => {
    expect(compareCorrectness(AVAILABLE(0.7), AVAILABLE(0.7))).toBe("same");
  });
  it("stale score higher -> stale-better", () => {
    expect(compareCorrectness(AVAILABLE(0.9), AVAILABLE(0.5))).toBe("stale-better");
  });
  it("either side unavailable -> unknown, never coerced to 0", () => {
    expect(compareCorrectness(UNAVAILABLE, AVAILABLE(0.9))).toBe("unknown");
    expect(compareCorrectness(AVAILABLE(0.9), UNAVAILABLE)).toBe("unknown");
    expect(compareCorrectness(UNAVAILABLE, UNAVAILABLE)).toBe("unknown");
  });
});

describe("required-file evidence (TST-B4-033..040)", () => {
  it("all required files read -> present", () => {
    const evidence = buildRequiredFileEvidence({ requiredFiles: ["src/a.ts", "src/b.ts"], observedFiles: ["src/b.ts", "src/a.ts"], observedFilesComplete: true });
    expect(evidence.status).toBe("present");
    expect(evidence.missingFiles).toEqual([]);
  });
  it("one required file absent -> missing, with the missing file named", () => {
    const evidence = buildRequiredFileEvidence({ requiredFiles: ["src/a.ts", "src/b.ts"], observedFiles: ["src/a.ts"], observedFilesComplete: true });
    expect(evidence.status).toBe("missing");
    expect(evidence.missingFiles).toEqual(["src/b.ts"]);
  });
  it("a search hit that was never read does not count as observed (caller only passes actually-read files)", () => {
    // Simulates the caller passing only files actually read into context, not search candidates.
    const evidence = buildRequiredFileEvidence({ requiredFiles: ["src/a.ts"], observedFiles: [], observedFilesComplete: true });
    expect(evidence.status).toBe("missing");
  });
  it("incomplete/unavailable read evidence -> unknown, never missing", () => {
    const evidence = buildRequiredFileEvidence({ requiredFiles: ["src/a.ts"], observedFiles: [], observedFilesComplete: false });
    expect(evidence.status).toBe("unknown");
    expect(evidence.reason).toBeTruthy();
  });
  it("required/observed/missing arrays normalize separators and sort deterministically", () => {
    const evidence = buildRequiredFileEvidence({
      requiredFiles: ["src\\b.ts", "./src/a.ts", "src/a.ts"],
      observedFiles: ["src\\a.ts"],
      observedFilesComplete: true
    });
    expect(evidence.requiredFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(evidence.observedFiles).toEqual(["src/a.ts"]);
    expect(evidence.missingFiles).toEqual(["src/b.ts"]);
  });
  it("normalizeRequiredFilePath strips backslashes and leading ./ segments", () => {
    expect(normalizeRequiredFilePath("./src\\a.ts")).toBe("src/a.ts");
  });
});

const PRESENT: RequiredFileEvidenceStatusV1 = "present";
const MISSING: RequiredFileEvidenceStatusV1 = "missing";
const UNKNOWN: RequiredFileEvidenceStatusV1 = "unknown";

describe("required-file evidence relation (TST-B4-041..045)", () => {
  it("missing/present -> stale-worse", () => {
    expect(compareRequiredFileEvidence({ status: MISSING }, { status: PRESENT })).toBe("stale-worse");
  });
  it("present/missing -> stale-better", () => {
    expect(compareRequiredFileEvidence({ status: PRESENT }, { status: MISSING })).toBe("stale-better");
  });
  it("present/present -> same", () => {
    expect(compareRequiredFileEvidence({ status: PRESENT }, { status: PRESENT })).toBe("same");
  });
  it("missing/missing -> same", () => {
    expect(compareRequiredFileEvidence({ status: MISSING }, { status: MISSING })).toBe("same");
  });
  it("unknown on either side -> unknown", () => {
    expect(compareRequiredFileEvidence({ status: UNKNOWN }, { status: PRESENT })).toBe("unknown");
    expect(compareRequiredFileEvidence({ status: PRESENT }, { status: UNKNOWN })).toBe("unknown");
  });
});

describe("stale-risk classification precedence (TST-B4-046..056)", () => {
  it("correctness stale-worse + files same -> observed-stale-regression", () => {
    expect(classifyStaleRisk("stale-worse", "same").staleRiskClassification).toBe("observed-stale-regression");
  });
  it("correctness same + files stale-worse -> observed-stale-regression", () => {
    expect(classifyStaleRisk("same", "stale-worse").staleRiskClassification).toBe("observed-stale-regression");
  });
  it("correctness stale-worse + files unknown -> observed-stale-regression (Rule 1 wins over unknown)", () => {
    expect(classifyStaleRisk("stale-worse", "unknown").staleRiskClassification).toBe("observed-stale-regression");
  });
  it("correctness unknown + files stale-worse -> observed-stale-regression (Rule 1 wins over unknown)", () => {
    expect(classifyStaleRisk("unknown", "stale-worse").staleRiskClassification).toBe("observed-stale-regression");
  });
  it("correctness unknown + files same -> inconclusive", () => {
    expect(classifyStaleRisk("unknown", "same").staleRiskClassification).toBe("inconclusive");
  });
  it("correctness same + files unknown -> inconclusive", () => {
    expect(classifyStaleRisk("same", "unknown").staleRiskClassification).toBe("inconclusive");
  });
  it("same + same -> no-observed-stale-regression", () => {
    expect(classifyStaleRisk("same", "same").staleRiskClassification).toBe("no-observed-stale-regression");
  });
  it("stale-better + same -> no-observed-stale-regression", () => {
    expect(classifyStaleRisk("stale-better", "same").staleRiskClassification).toBe("no-observed-stale-regression");
  });
  it("same + stale-better -> no-observed-stale-regression", () => {
    expect(classifyStaleRisk("same", "stale-better").staleRiskClassification).toBe("no-observed-stale-regression");
  });
  it("stale-better + stale-better -> no-observed-stale-regression", () => {
    expect(classifyStaleRisk("stale-better", "stale-better").staleRiskClassification).toBe("no-observed-stale-regression");
  });
  it("never emits safe/unsafe/winner/recommendation vocabulary", () => {
    const seen = new Set<string>();
    for (const correctness of ["stale-worse", "same", "stale-better", "unknown"] as const) {
      for (const files of ["stale-worse", "same", "stale-better", "unknown"] as const) {
        seen.add(classifyStaleRisk(correctness, files).staleRiskClassification);
      }
    }
    expect(seen).toEqual(new Set(["observed-stale-regression", "no-observed-stale-regression", "inconclusive"]));
  });
});
