import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocalRepositorySubject, type LocalRepositorySubject } from "../../../src/evaluation/localRepositorySubject/index.js";
import {
  analyzeContextPackGeneration,
  assertContextPackExternalProjectionIsPrivate,
  collectContextPackExternalPrivateValues,
  collectContextPackSourceFragments,
  CONTEXT_PACK_GENERATION_ERROR_TEXT,
  CONTEXT_PACK_IDENTITY_REDACTION,
  CONTEXT_PACK_NAME_SUBSTRING_MIN_LENGTH,
  CONTEXT_PACK_PRIVACY_FAILURE_MESSAGE,
  CONTEXT_PACK_REDACTED_CASE_TITLE,
  CONTEXT_PACK_SOURCE_FRAGMENT_MIN_LENGTH,
  CONTEXT_PACK_UNEXPECTED_EXTERNAL_FAILURE_MESSAGE,
  describeContextPackLocalSubjectFailureForPersistence,
  executeLocalRepositorySubjectContextPackGeneration,
  projectContextPackAnalysisForExternalLocalPersistence,
  projectContextPackExecutionForExternalLocalPersistence,
  type ContextPackExternalPrivateValues,
  type ContextPackGenerationCaseResult
} from "../../../src/experiments/plugins/contextPackGeneration/index.js";
import { LocalSubjectExecutionError } from "../../../src/experiments/plugins/contextWindowScaling/localSubjectErrors.js";
import { makeTempDir, removeTempDir } from "../../evaluation/localRepositorySubject/fixtureRepository.js";
import type { LocalSubjectFixture } from "../contextWindowScaling/localSubjectFixture.js";
import { clearCpgKitEnv, CPG_MARKERS, cpgKitCommand, cpgLocalSubjectCases, createCpgLocalSubjectFixture } from "./externalLocalFixture.js";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let fixture: LocalSubjectFixture;
let subject: LocalRepositorySubject;
let results: ContextPackGenerationCaseResult[];
let workParent: string;
let privateValues: ContextPackExternalPrivateValues;

beforeAll(async () => {
  fixture = await createCpgLocalSubjectFixture();
  subject = await loadLocalRepositorySubject({
    config: { schemaVersion: "1.0.0", subjectId: "cpg-subject", cases: cpgLocalSubjectCases() },
    repositoryPath: fixture.root
  });
  workParent = makeTempDir("cpg-priv-work-");
  results = (await executeLocalRepositorySubjectContextPackGeneration({ subject, kitCommand: cpgKitCommand(), workRoot: path.join(workParent, "lab") })).results;
  privateValues = collectContextPackExternalPrivateValues({ subject, results, outputRoot: path.join(workParent, "lab") });
});

afterAll(() => {
  clearCpgKitEnv();
  for (const directory of [...fixture.directories, workParent]) removeTempDir(directory);
});

const serialize = (value: unknown) => JSON.stringify(value);

describe("real in-memory results (the private inputs of the projection)", () => {
  it("carry the real identities, real packs and real source text before projection", () => {
    expect(results).toHaveLength(2);
    const [one] = results;
    expect(one.evidence.caseName).toBe(CPG_MARKERS.title);
    expect(one.evidence.treatments[1].identityEvidence?.files).toEqual(expect.arrayContaining([CPG_MARKERS.engineFile, CPG_MARKERS.helperFile]));
    expect(one.evidence.treatments[1].packArtifactPath).toMatch(/context-pack\.json$/);
    expect(serialize(one.pack)).toContain(CPG_MARKERS.engineSource);
    expect(one.pack?.symbols.map((symbol) => symbol.name)).toContain(CPG_MARKERS.engineSymbol);
    expect(one.pack?.task.summary).toContain(CPG_MARKERS.query);
  });

  it("gather every private identity class for the assertion", () => {
    expect(privateValues.filePaths).toEqual(expect.arrayContaining([CPG_MARKERS.engineFile, CPG_MARKERS.testFile, "src/ignored.ts", "src/main.ts"]));
    expect(privateValues.symbolNames).toEqual(expect.arrayContaining([CPG_MARKERS.engineSymbol, CPG_MARKERS.helperSymbol]));
    expect(privateValues.nodeIds).toEqual(expect.arrayContaining([`symbol:${CPG_MARKERS.engineFile}#${CPG_MARKERS.engineSymbol}`, `file:${CPG_MARKERS.testFile}`]));
    expect(privateValues.taskTexts).toEqual(expect.arrayContaining([CPG_MARKERS.title, expect.stringContaining(CPG_MARKERS.query)]));
    expect(privateValues.factIds).toEqual(expect.arrayContaining([CPG_MARKERS.fact, CPG_MARKERS.factTwo, CPG_MARKERS.factThree]));
    expect(privateValues.privateRoots).toContain(subject.repositoryRoot);
    expect(privateValues.sourceFragments.some((fragment) => fragment.includes(CPG_MARKERS.engineSource))).toBe(true);
  });
});

describe("execution projection", () => {
  it("removes every identity class and keeps counts, availability, sizes and statuses exactly", () => {
    const projected = projectContextPackExecutionForExternalLocalPersistence(results);
    const text = serialize(projected);
    for (const secret of [
      CPG_MARKERS.title,
      CPG_MARKERS.query,
      CPG_MARKERS.engineFile,
      CPG_MARKERS.helperFile,
      CPG_MARKERS.testFile,
      CPG_MARKERS.engineSymbol,
      CPG_MARKERS.helperSymbol,
      CPG_MARKERS.engineSource,
      CPG_MARKERS.helperSource,
      CPG_MARKERS.testSource,
      "symbol:src/",
      "file:src/",
      "ZetaPrivate",
      "context-pack.json"
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(() => assertContextPackExternalProjectionIsPrivate(projected, privateValues)).not.toThrow();

    projected.forEach((entry, caseIndex) => {
      const real = results[caseIndex];
      expect(entry.caseId).toBe(real.evidence.caseId);
      expect(entry.benchmarkProject).toBe(real.evidence.benchmarkProject);
      expect(entry.taskLocality).toBe(real.evidence.taskLocality);
      expect(entry.caseName).toBe(CONTEXT_PACK_REDACTED_CASE_TITLE);
      expect(entry.identityRedaction).toEqual(CONTEXT_PACK_IDENTITY_REDACTION);
      entry.treatments.forEach((treatment, index) => {
        const source = real.evidence.treatments[index];
        expect(treatment.treatmentId).toBe(source.treatmentId);
        expect(treatment.status).toBe(source.status);
        expect(treatment.availability).toBe(source.availability);
        expect(treatment.availabilityReason).toBe(source.availabilityReason);
        expect(treatment.size).toEqual(source.size);
        expect(treatment.evidenceNotes).toEqual(source.evidenceNotes);
        expect(treatment.identityEvidence).toBeNull();
        expect(treatment.includedFiles).toEqual([]);
        expect(treatment.packArtifactPath).toBeNull();
        expect(treatment.identityCounts).toEqual({
          files: source.identityEvidence?.files.length,
          symbols: source.identityEvidence?.symbols.length,
          includedFiles: source.includedFiles.length
        });
        expect(treatment.steps.map((step) => [step.kind, step.succeeded, step.reason, step.sourceMode])).toEqual(
          source.steps.map((step) => [step.kind, step.succeeded, step.reason, step.sourceMode])
        );
        expect(treatment.steps.every((step) => step.nodeId === null)).toBe(true);
        expect(treatment.sections === null ? null : treatment.sections.map(({ truncatedCount: _ignored, ...section }) => section)).toEqual(source.sections);
      });
      const pack = real.pack!;
      const slices = entry.treatments[1].sections?.find((section) => section.id === "sourceSlices");
      expect(slices?.truncatedCount).toBe(pack.sourceSlices.filter((slice) => slice.truncated).length);
      expect(entry.treatments[0].sections).toBeNull();
    });
  });

  it("does not mutate its input, is deterministic, and replaces failure text with the fixed per-code text", () => {
    const before = serialize(results);
    const first = projectContextPackExecutionForExternalLocalPersistence(results);
    expect(serialize(results)).toBe(before);
    expect(serialize(projectContextPackExecutionForExternalLocalPersistence(results))).toBe(serialize(first));

    const failing = structuredClone(results[0]);
    failing.evidence.treatments[1].errors = [{ code: "retrieval-failed", message: `boom ${subject.repositoryRoot} ${CPG_MARKERS.engineFile} stack at C:\\secret` }];
    const projected = projectContextPackExecutionForExternalLocalPersistence([failing]);
    expect(projected[0].treatments[1].errors).toEqual([{ code: "retrieval-failed", message: CONTEXT_PACK_GENERATION_ERROR_TEXT["retrieval-failed"] }]);
    expect(serialize(projected)).not.toContain("secret");
  });

  it("projects a failed treatment without identities or counts it never had", () => {
    const failed = structuredClone(results[0]);
    failed.pack = null;
    failed.evidence.treatments[1] = {
      treatmentId: "context-pack",
      status: "failed",
      availability: null,
      availabilityReason: null,
      size: null,
      identityEvidence: null,
      includedFiles: [],
      steps: [{ kind: "search", nodeId: null, sourceMode: null, succeeded: false, reason: "command-failed" }],
      sections: null,
      evidenceNotes: [],
      packArtifactPath: null,
      errors: [{ code: "retrieval-failed", message: "x" }]
    };
    const [projected] = projectContextPackExecutionForExternalLocalPersistence([failed]);
    expect(projected.treatments[1]).toMatchObject({ status: "failed", availability: null, size: null, identityCounts: null, sections: null });
  });
});

describe("analysis projection", () => {
  it("keeps every number, ratio, delta, scope aggregate and membership; replaces only identity lists", () => {
    const analysis = analyzeContextPackGeneration(subject.evaluationCases, results.map((result) => result.evidence));
    const before = serialize(analysis);
    const projected = projectContextPackAnalysisForExternalLocalPersistence(analysis);
    expect(serialize(analysis)).toBe(before);
    expect(projected.scopes).toEqual(analysis.scopes);
    projected.cases.forEach((entry, caseIndex) => {
      const real = analysis.cases[caseIndex];
      expect(entry.comparison).toEqual(real.comparison);
      entry.treatments.forEach((treatment, index) => {
        const source = real.treatments[index];
        expect(treatment.fileF1).toEqual(source.fileF1);
        expect(treatment.symbolF1).toEqual(source.symbolF1);
        expect(treatment.estimatedTokens).toBe(source.estimatedTokens);
        expect(treatment.quality?.fact.coverage).toEqual(source.quality?.fact.coverage);
        expect(treatment.quality?.file.missedFileCount).toBe(source.quality?.file.missedFileCount);
        expect(treatment.quality?.symbol.missedSymbolCount).toBe(source.quality?.symbol.missedSymbolCount);
        expect(treatment.quality?.file.missedFiles?.length).toBe(source.quality?.file.missedFiles?.length);
      });
    });
    const text = serialize(projected);
    for (const secret of [CPG_MARKERS.engineFile, CPG_MARKERS.engineSymbol, CPG_MARKERS.fact, CPG_MARKERS.factTwo, CPG_MARKERS.factThree]) expect(text).not.toContain(secret);
    expect(() => assertContextPackExternalProjectionIsPrivate(projected, privateValues)).not.toThrow();
    // The real analysis does carry identities, so the assertion has something real to catch.
    expect(() => assertContextPackExternalProjectionIsPrivate(analysis, privateValues)).toThrow(CONTEXT_PACK_PRIVACY_FAILURE_MESSAGE);
  });
});

describe("privacy assertion fails closed for every leakage class", () => {
  const clean = { status: "completed", n: 3 };
  const leak = (payload: unknown, values: Partial<ContextPackExternalPrivateValues> = {}) =>
    expect(() => assertContextPackExternalProjectionIsPrivate(payload, { ...privateValues, ...values })).toThrow(CONTEXT_PACK_PRIVACY_FAILURE_MESSAGE);

  it("passes a clean payload", () => {
    expect(() => assertContextPackExternalProjectionIsPrivate(clean, privateValues)).not.toThrow();
  });

  it("fails for a private file path, in forward-slash, backslash and JSON-escaped form", () => {
    leak({ x: CPG_MARKERS.engineFile });
    leak({ x: CPG_MARKERS.engineFile.replace(/\//g, "\\") });
    leak(JSON.stringify({ x: CPG_MARKERS.engineFile.replace(/\//g, "\\") }));
  });

  it("fails for a test path", () => leak({ tests: [CPG_MARKERS.testFile] }));
  it("fails for a symbol identity (distinctive name)", () => leak({ symbol: CPG_MARKERS.engineSymbol }));
  it("fails for a semantic node ID and a call-edge endpoint ID", () => {
    leak({ node: `symbol:${CPG_MARKERS.engineFile}#${CPG_MARKERS.engineSymbol}` });
    leak({ edge: { from: "file:endpoint-sentinel/x.ts", to: "symbol:other" } }, { nodeIds: ["file:endpoint-sentinel/x.ts"] });
  });
  it("fails for task text and a case title", () => {
    leak({ t: CPG_MARKERS.title });
    const fullQuery = privateValues.taskTexts.find((text) => text.includes(CPG_MARKERS.query)) as string;
    leak({ t: `prefix ${fullQuery} suffix` });
    // Ordinary words survive by coincidence only if the title equals them, which the assertion must still catch.
    leak({ status: "completed" }, { taskTexts: ["completed"] });
  });
  it("fails for a fact identifier", () => leak({ f: CPG_MARKERS.fact }));
  it("fails for a private root, a work root and warning text", () => {
    leak({ r: subject.repositoryRoot });
    leak({ r: subject.repositoryRoot.replace(/\\/g, "/") });
    leak({ r: "C:\\Lab\\work" }, { privateRoots: ["C:\\Lab\\work"] });
    leak({ w: "warning prose sentinel" }, { warnings: ["warning prose sentinel"] });
  });

  it("fails for a non-trivial real source fragment anywhere, including inside a longer string and JSON-escaped", () => {
    leak({ s: `see ${privateValues.sourceFragments.find((fragment) => fragment.includes(CPG_MARKERS.engineSource))} here` });
    leak({ s: 'const bodyLine = "ZETA_SOURCE_BODY_SENTINEL_5c2d";' });
    leak(JSON.stringify({ s: 'return "quoted \\" source fragment";' }), { sourceFragments: ['return "quoted \\" source fragment";'] });
  });

  it("uses the frozen threshold: fragments of at least 8 characters are searched, shorter ones never are", () => {
    expect(CONTEXT_PACK_SOURCE_FRAGMENT_MIN_LENGTH).toBe(8);
    expect(() => assertContextPackExternalProjectionIsPrivate({ a: "return;" }, { ...privateValues, sourceFragments: ["return;"] })).not.toThrow();
    expect(() => assertContextPackExternalProjectionIsPrivate({ a: "0123456" }, { ...privateValues, sourceFragments: ["0123456"] })).not.toThrow();
    leak({ a: "01234567" }, { sourceFragments: ["01234567"] });
    expect(collectContextPackSourceFragments([results[0].pack, null]).every((fragment) => fragment.length >= 8)).toBe(true);
    const short = structuredClone(results[0].pack)!;
    short.sourceSlices = [{ ...short.sourceSlices[0], text: "a;\n  }\n\nok();" }];
    expect(collectContextPackSourceFragments([short])).toEqual([]);
  });

  it("does not search short symbol or fact names as substrings (they collide with fixed schema vocabulary)", () => {
    expect(CONTEXT_PACK_NAME_SUBSTRING_MIN_LENGTH).toBe(8);
    expect(() => assertContextPackExternalProjectionIsPrivate({ kind: "search", status: "completed" }, { ...privateValues, symbolNames: ["search", "status"], factIds: ["id"] })).not.toThrow();
  });

  it("scans string payloads such as the serialized manifest", () => {
    leak(JSON.stringify({ file: CPG_MARKERS.helperFile }, null, 2));
  });
});

describe("fixed failure semantics", () => {
  it("never persists arbitrary execution text: issue codes, fixed messages and counts only", () => {
    const text = describeContextPackLocalSubjectFailureForPersistence(
      new LocalSubjectExecutionError(
        [
          { code: "TARGET_MUTATED", message: `the target changed during execution at ${CPG_MARKERS.engineFile}` },
          { code: "SCRATCH_CLEANUP_FAILED", message: `cannot remove ${subject.repositoryRoot}` },
          { code: "EXECUTION_FAILED", message: "context-pack execution failed for a configured case." }
        ],
        { immutability: { status: "mutated", mutations: [{ kind: "modified", identifier: CPG_MARKERS.engineFile }] } as never }
      )
    );
    expect(text).toBe(
      "Local subject context-pack-generation failed (TARGET_MUTATED): the target changed during execution (modified); it was not restored; the private scratch could not be removed; context-pack execution failed for a configured case."
    );
    expect(text).not.toContain(CPG_MARKERS.engineFile);
    expect(text).not.toContain(subject.repositoryRoot);
    expect(CONTEXT_PACK_UNEXPECTED_EXTERNAL_FAILURE_MESSAGE).toContain("details withheld");
    expect(CONTEXT_PACK_PRIVACY_FAILURE_MESSAGE).toContain("no durable output was written");
  });
});
