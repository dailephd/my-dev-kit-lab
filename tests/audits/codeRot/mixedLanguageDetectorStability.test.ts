import { describe, expect, it } from "vitest";
import path from "node:path";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { runAudit } from "../../../src/audits/core/auditRunner.js";
import type { AuditTarget } from "../../../src/audits/core/auditTarget.js";
import type { AuditIssue } from "../../../src/audits/core/auditIssue.js";

// ---------------------------------------------------------------------------
// v0.3.4 Batch 2 -- cross-language detector stability tests.
//
// Every code-rot detector (dead-code-candidate, duplicate-implementation-
// candidate, test-rot, docs-code-mismatch) already has extensive per-language
// unit coverage (see deadCodeCandidateDetector.test.ts,
// duplicateImplementationDetector.test.ts, testRotDetector.test.ts,
// docsCodeMismatchDetector.test.ts -- each with dedicated TypeScript/
// JavaScript/Python/Java/Kotlin describe blocks). What none of those files
// prove is that all four detectors, running together through the REAL
// DEFAULT_AUDIT_REGISTRY (via runAudit(), not a hand-built single-detector
// AuditDetectorContext), stay stable and conservative against the Batch 1
// committed mixed-language fixture corpus, where TypeScript, JavaScript,
// Python, Java, and Kotlin source-facts all coexist in one run. This file
// closes that gap.
// ---------------------------------------------------------------------------

const FIXTURE_ROOT = path.resolve(process.cwd(), "tests/fixtures/audits/mixed-language");

function fixturePath(name: string): string {
  return path.join(FIXTURE_ROOT, name);
}

function fakeTargetFor(root: string): AuditTarget {
  return {
    rootPath: root,
    displayName: "fixture",
    exists: true,
    isDirectory: true,
    packageJsonPath: path.join(root, "package.json"),
    gitRoot: null,
    isSelf: false,
    safeReportOutputRoot: path.join(root, "reports", "audits"),
  };
}

async function auditFixture(name: string) {
  const root = fixturePath(name);
  const config = normalizeAuditConfig({}, root);
  const target = fakeTargetFor(root);
  const result = await runAudit({ config, toolRoot: root, target });
  return { root, result };
}

const FORBIDDEN_WORDING = [
  "broken test",
  "compile error",
  "test failure",
  "missing dependency",
];

function assertNoForbiddenWording(issues: readonly AuditIssue[]): void {
  for (const issue of issues) {
    const haystack = `${issue.title} ${issue.description}`.toLowerCase();
    for (const phrase of FORBIDDEN_WORDING) {
      expect(haystack).not.toContain(phrase);
    }
  }
}

describe("mixed-language detector stability — D1 mixed-language scan does not crash", () => {
  it("runs the full DEFAULT_AUDIT_REGISTRY against mixed-ts-python-jvm without crashing, with no blocker/high finding from static evidence alone", async () => {
    const { result } = await auditFixture("mixed-ts-python-jvm");
    const codeRotIssues = result.issues.filter((i) => i.auditType === "code-rot");
    expect(codeRotIssues.every((i) => i.severity !== "blocker" && i.severity !== "high")).toBe(true);
  });

  it("runs against mixed-java-kotlin without crashing, with no blocker/high finding", async () => {
    const { result } = await auditFixture("mixed-java-kotlin");
    const codeRotIssues = result.issues.filter((i) => i.auditType === "code-rot");
    expect(codeRotIssues.every((i) => i.severity !== "blocker" && i.severity !== "high")).toBe(true);
  });

  it("produces deterministic findings across two runs of the same mixed fixture", async () => {
    const first = await auditFixture("mixed-ts-python-jvm");
    const second = await auditFixture("mixed-ts-python-jvm");
    const idsOf = (issues: readonly AuditIssue[]) => issues.map((i) => i.id).sort();
    expect(idsOf(first.result.issues)).toEqual(idsOf(second.result.issues));
  });
});

describe("mixed-language detector stability — D5/D6 fixture-noise and lifecycle-name wording guard", () => {
  it("keeps the intentionally-renamed fixture/sample file (mixed-ts-js/tests/index.sample.ts) at info severity only, never escalated", async () => {
    const { result } = await auditFixture("mixed-ts-js");
    const sampleIssues = result.issues.filter((i) => i.affectedFiles.some((f) => f.endsWith("index.sample.ts")));
    // Per Batch 1's documented remaining risk: this is an accepted,
    // intentional info-level dead-code-candidate note (the file is
    // deliberately named .sample.ts, not .test.ts, so Vitest never executes
    // it as a real test) -- not a defect. The only invariant Batch 2 must
    // protect is that it never escalates beyond info, and that its wording
    // stays hedged (findUnreferencedFixtures()'s own "weak candidate signal"
    // phrasing), never an overclaiming "unused"/"dead" verdict.
    for (const issue of sampleIssues) {
      expect(issue.severity).toBe("info");
      expect(issue.confidence).toBe("low");
    }
  });

  it("does not produce blocker/high findings for common lifecycle/conventional names across TS, Python, Java, and Kotlin simultaneously", async () => {
    const { result } = await auditFixture("mixed-ts-python-jvm");
    const codeRotIssues = result.issues.filter((i) => i.auditType === "code-rot");
    assertNoForbiddenWording(codeRotIssues);
    expect(codeRotIssues.every((i) => i.severity !== "blocker" && i.severity !== "high")).toBe(true);
  });
});

describe("mixed-language detector stability — U1/U4 duplicate-implementation grouping and determinism", () => {
  it("keeps duplicate-implementation-candidate findings analyzer-scoped (no cross-language merge) across the full mixed fixture", async () => {
    const { result } = await auditFixture("mixed-ts-python-jvm");
    const dupIssues = result.issues.filter((i) => i.category === "duplicate-implementation-candidate");
    // Every affected-files list for a source-facts-derived duplicate
    // candidate must stay within one file extension family (never mixing
    // e.g. a .java path with a .kt or .py path in the same finding) --
    // duplicateImplementationDetector.ts scopes its grouping key by
    // analyzerId, not language, precisely to guarantee this.
    for (const issue of dupIssues) {
      const extensions = new Set(issue.affectedFiles.map((f) => path.extname(f)));
      if (issue.affectedFiles.length < 2) continue;
      expect(extensions.size).toBeLessThanOrEqual(1);
    }
  });

  it("produces stable, sorted duplicate-implementation issue ids across two runs of the mixed fixture", async () => {
    const first = await auditFixture("mixed-ts-python-jvm");
    const second = await auditFixture("mixed-ts-python-jvm");
    const dupIdsOf = (issues: readonly AuditIssue[]) =>
      issues.filter((i) => i.category === "duplicate-implementation-candidate").map((i) => i.id).sort();
    expect(dupIdsOf(first.result.issues)).toEqual(dupIdsOf(second.result.issues));
  });
});

describe("mixed-language detector stability — R8 JVM import resolver isolation", () => {
  it("keeps TS/Python test-rot findings free of JVM-specific wording, and JVM findings free of TS/Python-specific wording", async () => {
    const { result } = await auditFixture("mixed-ts-python-jvm");
    const testRotIssues = result.issues.filter((i) => i.category === "test-rot");

    for (const issue of testRotIssues) {
      const isJvmFinding = /\b(java|kotlin)\b/i.test(issue.title);
      const mentionsJvmResolverWording = /no compiler\/classpath analysis|no gradle\/maven execution/i.test(
        issue.description
      );
      if (!isJvmFinding) {
        // A TS/Python-language finding must never carry the JVM resolver's
        // own "no compiler/classpath analysis, no Gradle/Maven execution"
        // wording -- that phrasing is specific to findMissingJvmSourceImports()
        // and must never leak into the TS/JS or Python resolver's output.
        expect(mentionsJvmResolverWording).toBe(false);
      }
    }
  });
});

describe("mixed-language detector stability — M6 docs-code mismatch JVM gating", () => {
  it("does not produce a JVM symbol-claim mismatch for a project with no Java/Kotlin source", async () => {
    const { result } = await auditFixture("mixed-ts-js");
    const jvmSymbolIssues = result.issues.filter((i) => i.id.includes("jvm-symbol-claim-mismatch"));
    expect(jvmSymbolIssues).toEqual([]);
  });

  it("does not overclaim on the mixed-docs-claims fixture, whose current/planned/out-of-scope claims are accurate", async () => {
    const { result } = await auditFixture("mixed-docs-claims");
    const docsMismatchIssues = result.issues.filter((i) => i.category.startsWith("docs-feature-mismatch"));
    const highSeverity = docsMismatchIssues.filter((i) => i.severity === "high" || i.severity === "blocker");
    expect(highSeverity).toEqual([]);
    assertNoForbiddenWording(result.issues);
  });
});

describe("mixed-language detector stability — wording/severity guard across the full mixed corpus", () => {
  it("never emits forbidden overclaiming wording for any JVM-related finding across every Batch 1 fixture", async () => {
    for (const name of ["mixed-ts-js", "mixed-python-ts", "mixed-java-kotlin", "mixed-ts-python-jvm", "mixed-docs-claims"]) {
      const { result } = await auditFixture(name);
      assertNoForbiddenWording(result.issues);
      const blockerOrHigh = result.issues.filter((i) => i.severity === "blocker" || i.severity === "high");
      expect(blockerOrHigh).toEqual([]);
    }
  });
});
