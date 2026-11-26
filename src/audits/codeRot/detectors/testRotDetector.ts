import fs from "node:fs";
import { KitSourceEvidenceAcquisitionError, qualifyKitImportPredicate } from "../../core/kitSourceEvidence.js";
import type { KitSourceReader } from "../../core/kitSourceProvider.js";
import { kitPredicateContent } from "../utils/sourceFactsLookup.js";
import path from "node:path";
import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import type { SourceFileFacts } from "../../core/sourceFacts.js";
import type { InventoryFileEntry } from "../../core/projectInventory.js";
import { collectPythonProjectMetadata, type PythonProjectMetadataSnapshot } from "../../core/pythonProjectMetadata.js";
import { collectJvmProjectMetadata, type JvmProjectMetadataSnapshot } from "../../core/jvmProjectMetadata.js";
import { deduplicateIssuesById, makeCodeRotIssue } from "../utils/issueFactories.js";
import { getImportSourceFacts, indexSourceFactsByPath } from "../utils/sourceFactsLookup.js";
import { splitLines } from "../utils/textLines.js";
import {
  jvmImportLooksPossiblyLocal,
} from "../utils/jvmSourceFactsUtils.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 4 — test-rot detector.
//
// Bounded (per-file MAX_READ_BYTES skip), regex/structural only.
//
// Two spec bullets are intentionally SKIPPED here to avoid duplicate
// reporting with other detectors (documented in the Batch 4 spec itself):
//   - "fixtures not referenced by tests" is implemented once, in
//     deadCodeCandidateDetector.ts's findUnreferencedFixtures(), not here.
//   - "test commands documented in docs but missing from package.json
//     scripts" overlaps with staleCommandReferenceDetector.ts's existing
//     doc-command check and is intentionally not re-implemented here.
// ---------------------------------------------------------------------------

const DETECTOR_ID = "test-rot";
export const MAX_READ_BYTES = 200_000;

// Shared with acquisition applicability: fixture production-source areas do
// not acquire executable-test obligations from the outer tests/ directory.
// Their raw command checks remain selected. Unknown source types stay unknown.
export function isTestRotRawOnlyInput(file: Pick<InventoryFileEntry, "role" | "relativePath" | "language">): boolean {
  if (file.language === "json" || ["config", "generated", "vendor", "report-output"].includes(file.role) ||
      file.relativePath.endsWith(".gradle") || file.relativePath.endsWith(".gradle.kts")) return true;
  if (!/(?:^|\/)fixtures\//.test(file.relativePath)) return false;
  // These fixture formats are data or recorded output. The enclosing tests
  // directory still makes their bounded command text applicable.
  if (["markdown", "xml", "toml"].includes(file.language) ||
      /(?:^|\/)\.gitattributes$|\.(?:properties|jks|tap|[jt]s\.input)$/.test(file.relativePath) ||
      /(?:^|\/)(?:PROVENANCE|malformed-json)\.txt$/.test(file.relativePath) ||
      /(?:^|\/)fixtures\/ecosystem\/context-integrity\/[^/]+\/[^/]+\/(?:00-request|(?:artifacts|tool-versions)\/[^/]+)\.txt$/.test(file.relativePath)) return true;
  if (!["typescript", "javascript", "python", "java", "kotlin", "rust"].includes(file.language)) return false;
  const sourceIndex = file.relativePath.lastIndexOf("/src/");
  if (sourceIndex < 0) return false;
  const tail = file.relativePath.slice(sourceIndex + 5).split("/");
  if ((file.language === "java" || file.language === "kotlin") && tail[0] === "main") return true;
  if (tail.slice(0, -1).some(segment => /^(?:__tests__|tests?|specs?|.*Test)$/i.test(segment))) return false;
  const basename = tail.at(-1)!;
  return !/^(?:test|spec)|[._-](?:test|spec)(?:[._-]|$)|(?:Test|Tests|Spec)\.[^.]+$/i.test(basename);
}

const RELATIVE_IMPORT_PATTERN = /(?:from|require\()\s*["'](\.\.?\/[^"']+)["']/g;
const NPM_RUN_PATTERN = /npm run ([\w:.-]+)/g;
const TEST_TITLE_VERSION_PATTERN = /\b(describe|it|test)\s*\(\s*["'`][^"'`]*\bv(\d+\.\d+\.\d+)\b/;
const HISTORICAL_HEDGE_PATTERN = /\b(regression|historical|legacy)\b/i;
const VITEST_RUN_ARG_PATTERN = /vitest run ([^\s&|]+)/g;

export const TEST_ROT_DETECTOR: AuditDetector = {
  id: DETECTOR_ID,
  auditType: "code-rot",
  title: "Test rot",
  description:
    "Detects test files importing missing source files, stale npm-run references, committed .skip/.only usage, stale version mentions in test titles, and package scripts referencing missing test paths.",
  supportedIncludeAreas: ["tests", "cli", "package"],
  shouldSkip: (ctx: AuditDetectorContext) => {
    if (!ctx.config.include.includes("tests")) {
      return { skip: true, reason: "--include does not select tests; this detector's checks are test-file-based." };
    }
    return { skip: false };
  },
  run: async (ctx: AuditDetectorContext): Promise<AuditIssue[]> => {
    if (ctx.sourceFacts?.provider === "kit" && !ctx.kitSourceReader) throw new KitSourceEvidenceAcquisitionError("invalid-request", "Kit-backed detector requires its validated per-audit reader; native fallback is forbidden.");
    const issues: AuditIssue[] = [];
    const scriptNames = new Set(ctx.sourceOfTruth.commands.allScriptNames);
    const currentVersion = ctx.sourceOfTruth.package?.version ?? null;
    const sourceFactsIndex = indexSourceFactsByPath(ctx.sourceFacts);
    // v0.3.2 Batch 2 -- computed once per run, not per test file. Presence-
    // only/simple-text-extraction (see pythonProjectMetadata.ts); used below
    // purely as weak supporting context on Python findings, never as a
    // required condition -- its absence must not change whether a finding
    // is emitted, only add or omit one extra evidence line.
    const pythonMetadata = collectPythonProjectMetadata(ctx.target.rootPath, ctx.inventory);
    // v0.3.3 Batch 2 -- same "computed once, weak supporting context only"
    // treatment as pythonMetadata above.
    const jvmMetadata = collectJvmProjectMetadata(ctx.target.rootPath, ctx.inventory);

    const inspectTest = async (testFile: AuditDetectorContext["inventory"]["testFiles"][number], ctx: AuditDetectorContext): Promise<AuditIssue[]> => {
      const issues: AuditIssue[] = [];
      // Preserve Lab's bounded lexical-policy scope; no occurrence query applies.
      if (testFile.sizeBytes > MAX_READ_BYTES) return issues;
      if (testFile.relativePath.startsWith("tests/audits/codeRot/")) return issues;
      if (ctx.sourceFacts?.provider === "not-collected") throw new KitSourceEvidenceAcquisitionError("selection-incomplete", `Required test ${testFile.relativePath} is unselected.`);
      const observed = sourceFactsIndex.get(testFile.relativePath);
      const rawOnly = isTestRotRawOnlyInput(testFile);
      if (rawOnly) ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "imports evidence",
        source: { kind: "file", identity: testFile.relativePath }, capability: "imports",
        actualStatus: observed?.kit?.capabilities.imports ?? "unavailable", status: "NOT_APPLICABLE", mandatory: false, diagnostic: "",
        reason: "Configuration, report, or data/production-source fixture has no executable-test import predicate; raw command checks remain selected." });
      const unsupportedRaw = ctx.kitSourceReader?.unsupportedRawContentReason?.(testFile.relativePath);
      const rawContent = unsupportedRaw ? ctx.kitSourceReader?.authenticatedRawTestContent?.(testFile.relativePath) : undefined;
      if (unsupportedRaw && rawContent === undefined) {
        if (!ctx.reportUnavailable) throw new KitSourceEvidenceAcquisitionError("capability-insufficient", unsupportedRaw);
        ctx.reportUnavailable(DETECTOR_ID, "bounded-content predicates", testFile.relativePath, unsupportedRaw, "raw-content");
        return issues;
      }
      let content: string;
      try {
        if (rawOnly) {
          issues.push(...await findRawOnlyNpmRunReferences(ctx, testFile.relativePath, scriptNames, rawContent));
          return issues;
        }
        // Every lexical predicate can run on the complete validated text.
        // Import resolution below still requires independent Kit facts/proofs.
        content = rawContent ?? await ctx.kitSourceReader?.cachedAuthenticatedFixtureContent?.(testFile.relativePath)
          ?? await kitPredicateContent(ctx.kitSourceReader, testFile.relativePath, ["npm run ", "describe", "it", "test", "from", "require("]);
      } catch (error) {
        if (ctx.reportUnavailable &&
            error instanceof KitSourceEvidenceAcquisitionError && error.category === "capability-insufficient") {
          ctx.reportUnavailable(DETECTOR_ID, "bounded-content predicates", testFile.relativePath, error.message, "raw-content");
          return issues;
        }
        throw error;
      }
      if (content === null) return issues;

      // tests/audits/codeRot/ is this project's own audit-detector test
      // suite. Its whole purpose is to construct FIXTURE content (via
      // writeFile() string arguments) that mimics the exact textual
      // patterns this file's checks look for -- fake relative imports,
      // fake "npm run <command>" references, "describe.skip("/"it.only(",
      // and version-numbered test titles like `it("... v0.2.1 ...")`.
      // Scanning those fixture strings as if they were real test-file
      // content produces false positives against this repo's own accurate
      // tests (confirmed via self-testing on every one of the checks
      // below). This whole subdirectory is therefore excluded from this
      // detector's per-file checks -- a project without an audit-detector
      // test suite of its own would never hit this exclusion.
      if (testFile.relativePath.startsWith("tests/audits/codeRot/")) return issues;

      const reader = ctx.kitSourceReader;
      const jsTs = observed?.language === "typescript" || observed?.language === "javascript";
      const scopedDomains = jsTs && reader?.expressionDomains
        ? await reader.expressionDomains(testFile.relativePath) : undefined;
      const domainMissing = new Set<string>();
      const linked = new Set<string>();
      for (const { linkedImportFactId, proof } of scopedDomains ?? []) {
        if (linkedImportFactId) linked.add(linkedImportFactId);
        const imp = observed?.imports.find(i => i.provenance?.factId === linkedImportFactId);
        const missingRelative = !!imp?.source.startsWith(".") && proof.excludesSelectedDomain;
        if (missingRelative && imp) domainMissing.add(imp.source);
        // The expression validator admits a positive witness only for a
        // singleton operand. A finite candidate bound cannot resolve a call.
        const qualified = proof.excludesSelectedDomain || proof.positivePaths.length > 0;
        const bound = reader?.expressionReference ? proof.selectedTargetUpperBound : undefined;
        ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "missing-source-import",
          source: { kind: "file", identity: testFile.relativePath }, capability: "imports",
          actualStatus: proof.outcome, status: missingRelative ? "FINDING_SUPPORTED"
            : qualified ? "QUALIFIED" : "UNDETERMINED", mandatory: true, diagnostic: proof.reasonCode ?? "",
          reason: qualified ? "Validated R3 expression reference or selected-domain exclusion."
            : bound ? "Dynamic import evidence has a finite selected-target bound without qualified destination coverage."
              : "Dynamic import evidence has no exact witness or complete selected-domain exclusion.",
          proof: { kind: "import-domain", snapshotId: proof.snapshotId,
            references: [proof.expressionFactId, ...(linkedImportFactId ? [linkedImportFactId] : []),
              ...(qualified ? proof.positivePaths : bound ?? [])] },
        });
      }
      const partialImports = observed?.kit?.capabilities.imports === "partial";
      const accountedImports = partialImports && jsTs && scopedDomains !== undefined &&
        observed.imports.every(imp => qualifyKitImportPredicate(observed, imp) === "QUALIFIED_POSITIVE") &&
        reader?.explicitImportsCompleteWithExpressions?.(testFile.relativePath, observed.imports.length);
      if (accountedImports && reader) {
        ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "imports evidence",
          source: { kind: "file", identity: testFile.relativePath }, capability: "imports",
          actualStatus: "partial", status: "QUALIFIED", mandatory: true, diagnostic: "",
          reason: "Authenticated explicit imports and complete expression inventory account for the import observations.",
          proof: { kind: "import-domain", snapshotId: reader.snapshotId,
            references: scopedDomains.map(({ proof }) => proof.expressionFactId) } });
      }
      if (partialImports && !accountedImports) {
        const reason = observed.diagnostics.map(d => d.code + ": " + d.message).join("; ");
        if (!ctx.reportUnavailable) throw new KitSourceEvidenceAcquisitionError("capability-insufficient", testFile.relativePath + " requires complete imports. " + reason);
        ctx.reportUnavailable(DETECTOR_ID, "missing-source-import", testFile.relativePath, reason);
      }
      let kitMissing = domainMissing;
      if (!partialImports || jsTs) {
        try {
          kitMissing = new Set([...domainMissing, ...await kitMissingImports(ctx, testFile.relativePath, content, observed, linked)]);
        } catch (error) {
          if (ctx.reportUnavailable &&
              error instanceof KitSourceEvidenceAcquisitionError && error.category === "capability-insufficient") {
            ctx.reportUnavailable(DETECTOR_ID, "missing-source-import", testFile.relativePath, error.message);
          } else throw error;
        }
      }
      issues.push(...findMissingSourceImports(ctx, testFile.relativePath, content, kitMissing));
      // v0.3.1 Batch 4 -- when the TypeScript/JavaScript analyzer actually
      // parsed this test file, also check its structured reference proofs.
      // This catches import forms the regex above misses (e.g. multi-line
      // import statements) without duplicate-reporting a specifier both
      // checks already found: idCues use the same shape
      // (testRelativePath, "missing-source-import", specifier), so an
      // identical id is deduplicated by deduplicateIssuesById() below.
      // Domain-backed linked imports retain their own authenticated inference
      // even when a separate expression leaves the file inventory partial.
      const parsedFacts = kitMissing.size ? observed : getImportSourceFacts(sourceFactsIndex, testFile.relativePath);
      if (parsedFacts?.language === "python") {
        // v0.3.2 Batch 2 -- Python relative imports use dotted-module
        // notation (".module", "..pkg.module"), not TS/JS's path-like
        // "./module" syntax. Routing Python facts through the TS/JS
        // resolver below would misresolve every relative Python import and
        // flag it as missing regardless of whether it actually exists --
        // this guard is the fix for that latent cross-language bug.
        issues.push(...findMissingPythonSourceImports(ctx, testFile.relativePath, parsedFacts, pythonMetadata, kitMissing));
      } else if (parsedFacts?.language === "java" || parsedFacts?.language === "kotlin") {
        // v0.3.3 Batch 2 -- Java/Kotlin imports are fully-qualified dotted
        // package names ("com.example.Foo"), neither TS/JS's path-like
        // "./module" syntax nor Python's dotted-relative-import syntax.
        // Routing them through either existing resolver would misresolve
        // every import -- this guard is the JVM analogue of the Python
        // guard immediately above.
        issues.push(...findMissingJvmSourceImports(ctx, testFile.relativePath, parsedFacts, jvmMetadata, kitMissing));
      } else if (parsedFacts) {
        issues.push(...findMissingSourceImportsFromSourceFacts(testFile.relativePath, parsedFacts, kitMissing));
      }
      issues.push(...findStaleNpmRunReferences(testFile.relativePath, content, scriptNames));
      issues.push(...findTestModifierUsage(ctx, testFile, observed, content));
      if (currentVersion) issues.push(...findStaleVersionMentions(testFile.relativePath, content, currentVersion));
      return issues;
    };

    // Bound native Kit processes while committing findings and coverage in
    // inventory order, independently of asynchronous completion order.
    for (let offset = 0; offset < ctx.inventory.testFiles.length; offset += 4) {
      const jobs = ctx.inventory.testFiles.slice(offset, offset + 4).map(testFile => {
        const events: (() => void)[] = [];
        const perFile: AuditDetectorContext = { ...ctx,
          reportUnavailable: ctx.reportUnavailable ? (...args) => { events.push(() => ctx.reportUnavailable!(...args)); } : undefined,
          reportCoverage: ctx.reportCoverage ? coverage => { events.push(() => ctx.reportCoverage!(coverage)); } : undefined,
        };
        return { events, run: () => inspectTest(testFile, perFile) };
      });
      const outcomes = await Promise.allSettled(jobs.map(job => job.run()));
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.status === "rejected") throw outcome.reason;
        for (const event of jobs[index]!.events) event();
        issues.push(...outcome.value);
      }
    }
    if (ctx.config.include.includes("package") && ctx.sourceOfTruth.package) {
      issues.push(...findScriptsReferencingMissingTestPaths(ctx));
    }

    return deduplicateIssuesById(issues);
  },
};

async function kitMissingImports(ctx: AuditDetectorContext, filePath: string, content: string, facts?: SourceFileFacts, linked = new Set<string>()): Promise<Set<string>> {
  const reader = ctx.kitSourceReader!;
  const missing = new Set<string>();
  const raw = [...content.matchAll(new RegExp(RELATIVE_IMPORT_PATTERN.source, "g"))].map((match) => match[1]);
  // Qualified JSON supplies raw predicate content, not semantic imports. The
  // complete literal queries above can discharge the lexical predicate only.
  // A lexical import candidate still needs real parsed facts and fails closed.
  if (reader.jsonRawLiteralContent === "selected-test-json-v1" && filePath.endsWith(".json") &&
      facts?.parseStatus === "unsupported" && reader.selectedFile(filePath).status === "unsupported" && raw.length === 0) return missing;
  const jsTs = facts?.language === "typescript" || facts?.language === "javascript";
  const importsCapability = facts?.kit?.capabilities.imports;
  if (!facts || (importsCapability !== "complete" && !(jsTs && importsCapability === "partial"))) {
    throw new KitSourceEvidenceAcquisitionError("capability-insufficient", filePath + " requires complete imports.");
  }
  // A complete semantic inventory determines actual imports. Text inside a
  // fixture string/comment is not another import requiring target proof.
  // Every real import below still requires its authenticated fact and proof.
  if (raw.some(specifier => !facts.imports.some(fact => fact.source === specifier)) && facts.kit?.capabilities.exports !== "complete") {
    const reason = "Relative lexical candidates require complete export evidence to rule out an unrecorded re-export; incomplete exports do not establish absence.";
    if (!ctx.reportUnavailable) throw new KitSourceEvidenceAcquisitionError("capability-insufficient", reason);
    ctx.reportUnavailable(DETECTOR_ID, "missing-source-import", filePath, reason, "exports");
  }
  const reExports = reader.reExportSpecifiers?.(filePath);
  if (!reExports && facts.exports.some(fact => fact.exportOrigin === "re-export")) {
    const reason = filePath + " lacks authenticated re-export source identities.";
    if (!jsTs || !ctx.reportUnavailable || (!reader.ordinarySourceReference && importsCapability === "complete")) {
      throw new KitSourceEvidenceAcquisitionError("capability-insufficient", reason);
    }
    ctx.reportUnavailable(DETECTOR_ID, "missing-source-import", filePath, reason, "exports");
  }
  const reExportTargets = reader.reExportTargets?.(filePath);
  for (const specifier of new Set(reExports ?? [])) {
    if (!specifier.startsWith(".")) continue;
    const targets = reExportTargets?.filter(fact => fact.sourceSpecifier === specifier) ?? [];
    let detail = "";
    if (targets.length > 0 && jsTs) {
      const proofs = await Promise.all(targets.map(async fact => {
        try { return await reader.importTarget(fact.id); }
        catch (error) {
          if ((!reader.ordinarySourceReference && importsCapability === "complete") ||
              !(error instanceof KitSourceEvidenceAcquisitionError) ||
              error.category !== "capability-insufficient" || !ctx.reportUnavailable) throw error;
          return error;
        }
      }));
      const outcomes = proofs.map((proof): ReturnType<typeof jsTsImportOutcome> => proof instanceof KitSourceEvidenceAcquisitionError
        ? { reason: "Proof acquisition unavailable. " + proof.message }
        : jsTsImportOutcome(reader, proof, true));
      if (outcomes.every(outcome => outcome.status === "present")) continue;
      if (outcomes.every(outcome => outcome.status === "missing")) {
        missing.add(specifier);
        continue;
      }
      if (reader.ordinarySourceReference || importsCapability === "partial") {
        detail = outcomes.flatMap(outcome => outcome.reason ? [outcome.reason] : []).join(" ");
      }
    }
    const reason = `Re-export ${specifier} lacks qualified export-target proof; a complete import inventory does not establish export-target presence or absence.` +
      (detail ? " " + detail : "");
    if (!ctx.reportUnavailable) throw new KitSourceEvidenceAcquisitionError("capability-insufficient", reason);
    ctx.reportUnavailable(DETECTOR_ID, "missing-source-import", filePath, reason, "exports");
  }
  for (const imp of facts.imports) {
    if (imp.provenance?.factId && linked.has(imp.provenance.factId)) continue;
    const applicable = facts.language === "java" || facts.language === "kotlin" ? jvmImportLooksPossiblyLocal(imp) : imp.source.startsWith(".");
    if (!applicable) continue;
    if (!imp.provenance?.factId) throw new KitSourceEvidenceAcquisitionError("artifact-invalid", filePath + " import has no validated fact identity.");
    if (importsCapability === "partial" && qualifyKitImportPredicate(facts, imp) !== "QUALIFIED_POSITIVE") {
      throw new KitSourceEvidenceAcquisitionError("artifact-invalid", filePath + " import differs from the authenticated partial inventory.");
    }
    try {
      const proof = await reader.importTarget(imp.provenance.factId);
      if (jsTs) {
        const outcome = jsTsImportOutcome(reader, proof, false, imp.targetPaths);
        if (outcome.status === "missing") missing.add(imp.source);
        if (outcome.status) continue;
        throw new KitSourceEvidenceAcquisitionError("capability-insufficient", filePath + " import " + imp.source + " " + outcome.reason);
      }
      if ((facts.language === "java" || facts.language === "kotlin") && !proof.declarationProof) throw new KitSourceEvidenceAcquisitionError("capability-insufficient", filePath + " JVM import requires qualified declaration-domain evidence.");
      if (proof.status === "outside-selected-roots" || proof.status === "indeterminate") throw new KitSourceEvidenceAcquisitionError("capability-insufficient", filePath + " import " + imp.source + " remains " + proof.status + " (" + proof.reasonCode + ").");
      if (proof.status === "proven-missing") missing.add(imp.source);
    } catch (error) {
      if (!(error instanceof KitSourceEvidenceAcquisitionError) || error.category !== "capability-insufficient" || !ctx.reportUnavailable) throw error;
      ctx.reportUnavailable(DETECTOR_ID, "missing-source-import", filePath, `Import ${imp.source}: ${error.message}`);
    }
  }
  return missing;
}

function jsTsImportOutcome(
  reader: KitSourceReader, proof: Awaited<ReturnType<KitSourceReader["importTarget"]>>,
  reExport: boolean, indexedTargets?: readonly string[],
): { status?: "present" | "missing"; reason?: string } {
  if (reader.ordinarySourceReference && /^\.\.?\//.test(proof.sourceSpecifier)) {
    if (proof.qualifiedSourceReferencePath) return { status: "present" };
    if (proof.applicableSourceReferenceAbsent) return { status: "missing" };
  }
  if (proof.status === "proven-missing" && reader.jsTsRelativeImportCandidateProof === "mjs-extensionless-complete-v1") {
    return { status: "missing" };
  }
  if (reader.ordinarySourceReference) {
    if (proof.selectedTargetUpperBound !== undefined) {
      return { reason: proof.selectedTargetUpperBound.length
        ? "has a finite selected-target bound without a qualified source reference."
        : "has an empty selected-target bound without applicable physical absence." };
    }
    return { reason: "lacks a qualified source reference (" + (proof.ordinarySourceReferenceReason ?? proof.reasonCode) + ")." };
  }
  if (proof.status === "present" && (reExport ||
      indexedTargets?.some(target => proof.candidatePaths.includes(target) && /\.(ts|tsx|js|mjs|cjs)$/.test(target)))) {
    return { status: "present" };
  }
  if (proof.status === "present") return { reason: "target presence is outside the verified legacy candidate policy." };
  if (proof.status === "proven-missing") return { reason: "lacks qualified legacy .mjs/extensionless candidate proof semantics." };
  return { reason: "remains " + proof.status + " (" + proof.reasonCode + ")." };
}

function findMissingSourceImports(ctx: AuditDetectorContext, testRelativePath: string, content: string, kitMissing: Set<string>): AuditIssue[] {
  const issues: AuditIssue[] = [];

  RELATIVE_IMPORT_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(RELATIVE_IMPORT_PATTERN)) {
    const specifier = match[1];
    if (!kitMissing.has(specifier)) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [testRelativePath, "missing-source-import", specifier],
        title: `Test "${testRelativePath}" imports a missing source file: "${specifier}"`,
        description: `${testRelativePath} imports "${specifier}", which does not resolve to an existing file on disk (checked common TS/JS extensions relative to the test file).`,
        severity: "medium",
        confidence: "high",
        falsePositiveRisk: "low",
        category: "test-rot",
        recommendedAction: "Fix or remove the stale import.",
        suggestedFixStrategy: `Update the import specifier "${specifier}" in ${testRelativePath} to point to an existing file.`,
        validationCommands: [`npx vitest run ${testRelativePath}`],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: "Relative import specifier does not resolve to an existing file.",
            filePath: testRelativePath,
            excerpt: specifier,
            source: DETECTOR_ID,
            confidence: "high",
          },
        ],
        affectedFiles: [testRelativePath],
      })
    );
  }
  return issues;
}

// v0.3.1 Batch 4 -- source-facts-derived counterpart to
// findMissingSourceImports() above. Uses the TypeScript/JavaScript
// analyzer's already-parsed ImportFact list instead of a regex scan of raw
// content, so it also catches relative import specifiers the regex above
// misses. Only called for facts with parseStatus "parsed" (see caller) --
// file-level-only/parse-error facts carry an empty imports array that
// would otherwise silently look like "no imports" rather than "unknown".
function findMissingSourceImportsFromSourceFacts(
  testRelativePath: string,
  facts: SourceFileFacts,
  kitMissing: ReadonlySet<string>
): AuditIssue[] {
  const issues: AuditIssue[] = [];

  const specifiers = new Set(facts.imports.map(imp => imp.source));
  // A qualified missing re-export target is not an ordinary import fact.
  for (const specifier of kitMissing) specifiers.add(specifier);

  for (const specifier of specifiers) {
    if (!specifier.startsWith(".") || !kitMissing.has(specifier)) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [testRelativePath, "missing-source-import", specifier],
        title: `Test "${testRelativePath}" imports a missing source file: "${specifier}"`,
        description: `${testRelativePath} imports "${specifier}" (source-facts-derived via the TypeScript/JavaScript analyzer), which does not resolve to an existing file on disk (checked common TS/JS extensions relative to the test file).`,
        severity: "medium",
        confidence: "high",
        falsePositiveRisk: "low",
        category: "test-rot",
        recommendedAction: "Fix or remove the stale import.",
        suggestedFixStrategy: `Update the import specifier "${specifier}" in ${testRelativePath} to point to an existing file.`,
        validationCommands: [`npx vitest run ${testRelativePath}`],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: "Analyzer-recorded relative import specifier does not resolve to an existing file.",
            filePath: testRelativePath,
            excerpt: specifier,
            source: DETECTOR_ID,
            confidence: "high",
          },
        ],
        affectedFiles: [testRelativePath],
      })
    );
  }
  return issues;
}

// Interpret qualified Kit relative-import proofs using the existing Python finding policy.
function findMissingPythonSourceImports(
  ctx: AuditDetectorContext,
  testRelativePath: string,
  facts: SourceFileFacts,
  pythonMetadata: PythonProjectMetadataSnapshot,
  kitMissing: Set<string>
): AuditIssue[] {
  const issues: AuditIssue[] = [];

  for (const imp of facts.imports) {
    if (!imp.source.startsWith(".")) continue; // conservative: only relative Python imports are checked
    if (!kitMissing.has(imp.source)) continue;

    const evidence: AuditIssue["evidence"] = [
      {
        kind: "file",
        message:
          "Analyzer-recorded relative Python import does not resolve to a candidate local module/package file. This is a best-effort, path-based check -- it does not resolve Python's real package/sys.path rules, so confirm manually before treating it as stale.",
        filePath: testRelativePath,
        excerpt: imp.source,
        source: DETECTOR_ID,
        confidence: "low",
      },
    ];
    if (pythonMetadata.hasPytestConfiguration) {
      evidence.push({
        kind: "observation",
        message:
          "Weak supporting context: this project has a detected pytest configuration (pytest.ini, or a pyproject.toml/setup.cfg pytest section), consistent with pytest-style test conventions -- not a requirement for this finding.",
        source: DETECTOR_ID,
        confidence: "low",
      });
    }

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [testRelativePath, "missing-python-source-import", imp.source],
        title: `Test "${testRelativePath}" imports a Python module that may not exist: "${imp.source}"`,
        description: `${testRelativePath} imports "${imp.source}" (source-facts-derived via the Python analyzer). No candidate local module or package file was found relative to the test file. This is a deterministic source-facts signal from a conservative, non-semantic scan -- it does not resolve Python's real package/sys.path rules, namespace packages, or editable installs, so this may indicate a stale import but is not proof.`,
        severity: "low",
        confidence: "low",
        falsePositiveRisk: "medium",
        category: "test-rot",
        recommendedAction: "Confirm the imported Python module exists (it may resolve via a path this scan cannot see) before treating this as stale.",
        suggestedFixStrategy: `Update or remove the import "${imp.source}" in ${testRelativePath} if confirmed stale.`,
        validationCommands: [`npx vitest run ${testRelativePath}`],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence,
        affectedFiles: [testRelativePath],
      })
    );
  }
  return issues;
}

// Interpret qualified selected JVM declaration-domain proofs. Metadata supplies
// supporting context only; Kit owns import and target resolution.
function findMissingJvmSourceImports(
  ctx: AuditDetectorContext,
  testRelativePath: string,
  facts: SourceFileFacts,
  jvmMetadata: JvmProjectMetadataSnapshot,
  kitMissing: Set<string>
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const isKotlin = facts.language === "kotlin";
  const languageLabel = isKotlin ? "Kotlin" : "Java";
  // Lab-owned metadata is supporting context, never target-resolution proof.
  const candidateDirs = [...jvmMetadata.recognizedSourceDirectories, ...jvmMetadata.recognizedTestDirectories];
  for (const imp of facts.imports) {
    if (!jvmImportLooksPossiblyLocal(imp)) continue;

    if (!kitMissing.has(imp.source)) continue;

    const evidence: AuditIssue["evidence"] = [
      {
        kind: "file",
        message: `Qualified Kit declaration-domain evidence found no matching declaration in the complete witnessed selected ordinary JVM source domain. A Java static import concerns its owning type only; static-member binding and global compiler/classpath absence are not established. Import fact: ${imp.provenance?.factId}; snapshot: ${ctx.kitSourceReader?.snapshotId}.`,
        filePath: testRelativePath,
        excerpt: imp.source,
        source: DETECTOR_ID,
        confidence: "low",
      },
    ];
    if (candidateDirs.length > 0) {
      evidence.push({
        kind: "observation",
        message: `Weak supporting context: recognized source-set directories for this project are: ${candidateDirs.join(", ")}.`,
        source: DETECTOR_ID,
        confidence: "low",
      });
    }

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [testRelativePath, `missing-${facts.language}-source-import`, imp.source],
        title: `Test "${testRelativePath}" has no selected ${languageLabel} declaration for import "${imp.source}"`,
        description: `${testRelativePath} imports "${imp.source}". Qualified Kit evidence establishes absence of a matching declaration within the complete witnessed selected ordinary JVM source domain. For a Java static import this concerns the owning type only. It does not establish static-member binding or global compiler/classpath absence; the intended declaration may be supplied by another module or dependency.`,
        severity: "low",
        confidence: "low",
        falsePositiveRisk: "medium",
        category: "test-rot",
        recommendedAction: "Confirm the imported class exists (it may resolve via a module/classpath this scan cannot see) before treating this as stale.",
        suggestedFixStrategy: `Update or remove the import "${imp.source}" in ${testRelativePath} if confirmed stale.`,
        validationCommands: [`npx vitest run ${testRelativePath}`],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence,
        affectedFiles: [testRelativePath],
      })
    );
  }
  return issues;
}

function reportAuthenticatedCommandCoverage(ctx: AuditDetectorContext, filePath: string): void {
  ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "bounded-content predicates",
    source: { kind: "file", identity: filePath }, capability: "raw-content",
    actualStatus: "authenticated-content", status: "QUALIFIED", mandatory: true, diagnostic: "",
    reason: "Authenticated whole bytes qualify the raw command predicate independently of literal-inventory completeness." });
}

async function findRawOnlyNpmRunReferences(
  ctx: AuditDetectorContext, filePath: string, scriptNames: Set<string>, rawContent?: string,
): Promise<AuditIssue[]> {
  const reader = ctx.kitSourceReader;
  if (!reader) throw new KitSourceEvidenceAcquisitionError("invalid-request", `${filePath} requires its validated Kit source reader.`);
  const qualify = (actualStatus: string, reason: string) => ctx.reportCoverage?.({ detectorId: DETECTOR_ID,
    predicate: "bounded-content predicates", source: { kind: "file", identity: filePath }, capability: "raw-content",
    actualStatus, status: "QUALIFIED", mandatory: true, diagnostic: "", reason });
  const content = rawContent ?? await reader.cachedAuthenticatedFixtureContent?.(filePath) ?? reader.authenticatedRawTestContent?.(filePath);
  if (content !== undefined) {
    reportAuthenticatedCommandCoverage(ctx, filePath);
    return findStaleNpmRunReferences(filePath, content, scriptNames);
  }
  const result = await reader.occurrences(filePath, "npm run ");
  if (!result.complete) {
    // Whole authenticated bytes can discharge this predicate independently
    // of a truncated literal inventory, without promoting that inventory.
    if (reader.authenticatedContent) {
      try {
        const content = await reader.authenticatedContent(filePath);
        qualify("authenticated-content", "Authenticated whole bytes qualify the raw command predicate independently of literal-inventory completeness.");
        return findStaleNpmRunReferences(filePath, content, scriptNames);
      } catch (error) {
        if (!(error instanceof KitSourceEvidenceAcquisitionError) || error.category !== "capability-insufficient") throw error;
      }
    }
    const reason = `Raw command coverage requires a complete authenticated npm-run literal inventory or whole content; inventory is incomplete (${result.reasonCode}).`;
    if (!ctx.reportUnavailable) throw new KitSourceEvidenceAcquisitionError("capability-insufficient", reason);
    ctx.reportUnavailable(DETECTOR_ID, "bounded-content predicates", filePath, reason, "raw-content");
  } else {
    qualify("complete-literal-inventory", "Complete authenticated npm-run occurrences and their matched lines qualify the command-only predicate; unrelated source lines and semantic imports are not premises.");
  }
  // The original predicate is per-line, including its writeFile exclusion.
  // These are authenticated line observations, never fabricated whole content.
  const lines = new Map<number, string>();
  for (const match of result.matches) {
    for (const [offset, line] of splitLines(match.content).entries()) {
      const number = match.windowStart + offset;
      if (lines.has(number) && lines.get(number) !== line) {
        throw new KitSourceEvidenceAcquisitionError("artifact-invalid", `${filePath} has conflicting authenticated command lines.`);
      }
      lines.set(number, line);
    }
  }
  return findStaleNpmRunReferenceLines(filePath, [...lines].sort(([a], [b]) => a - b).map(([, line]) => line), scriptNames);
}

function findStaleNpmRunReferences(testRelativePath: string, content: string, scriptNames: Set<string>): AuditIssue[] {
  return findStaleNpmRunReferenceLines(testRelativePath, splitLines(content), scriptNames);
}

function findStaleNpmRunReferenceLines(testRelativePath: string, lines: readonly string[], scriptNames: Set<string>): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const seen = new Set<string>();

  // Scanned per-line (not whole-content) so a line can be cheaply excluded
  // when it's clearly constructing FIXTURE content for another detector's
  // test (e.g. `writeFile(root, "README.md", "Run \`npm run fake-cmd\`
  // ...")`) rather than a real reference to an npm command. This is the
  // exact shape used throughout this repo's own audit-detector test files
  // (see tests/audits/codeRot/*.test.ts) -- without this exclusion, this
  // detector flags this repo's own accurate test suite as if its
  // synthetic fixture strings were real stale command references, a false
  // positive confirmed via self-testing.
  for (const line of lines) {
    if (/\bwriteFile\s*\(/.test(line)) continue;

    NPM_RUN_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(NPM_RUN_PATTERN)) {
      const scriptName = match[1];
      if (scriptNames.has(scriptName) || seen.has(scriptName)) continue;
      seen.add(scriptName);

      issues.push(
        makeCodeRotIssue({
          auditType: "code-rot",
          detectorId: DETECTOR_ID,
          idCues: [testRelativePath, "stale-npm-run-reference", scriptName],
          title: `Test "${testRelativePath}" references "npm run ${scriptName}", which is not a current package.json script`,
          description: `${testRelativePath} references "npm run ${scriptName}" but no such script exists in package.json.`,
          severity: "medium",
          confidence: "medium",
          falsePositiveRisk: "medium",
          category: "test-rot",
          recommendedAction: "Update the test to reference a current script name, or add the missing script.",
          suggestedFixStrategy: `Correct the "npm run ${scriptName}" reference in ${testRelativePath}.`,
          validationCommands: [`npx vitest run ${testRelativePath}`],
          releaseBlocking: false,
          implementationBlocking: false,
          autoFixEligible: false,
          evidence: [
            {
              kind: "file",
              message: `Referenced command "npm run ${scriptName}" not found in package.json scripts.`,
              filePath: testRelativePath,
              source: DETECTOR_ID,
              confidence: "medium",
            },
          ],
          affectedFiles: [testRelativePath],
        })
      );
    }
  }
  return issues;
}


function findTestModifierUsage(ctx: AuditDetectorContext, file: InventoryFileEntry, observed: SourceFileFacts | undefined, content: string): AuditIssue[] {
  if (file.language !== "typescript" && file.language !== "javascript") return [];
  const domain = observed?.kitTestObservations;
  const snapshot = ctx.sourceFacts?.kitEvidence;
  const bound = domain && ctx.sourceFacts?.provider === "kit" && snapshot?.traversalComplete &&
    observed?.relativePath === file.relativePath && domain.contentSha256 === observed.kit?.contentSha256 &&
    domain.snapshotId === snapshot.snapshotId && domain.selectionFingerprint === snapshot.selectionFingerprint &&
    domain.snapshotId === ctx.kitSourceReader?.snapshotId;
  const positives = bound && (domain.producerStatus === "parsed" || domain.producerStatus === "partial") &&
    (domain.capability === "complete" || domain.capability === "partial") ? domain.observations : [];
  const modifierCapability = domain?.directModifierCapability ?? domain?.capability;
  const reader = ctx.kitSourceReader;
  const supplied = ctx.sourceFacts?.provider === "kit" && snapshot?.traversalComplete &&
    snapshot.snapshotId === reader?.snapshotId ? reader?.testModifierProof?.(file.relativePath) : undefined;
  const proof = supplied?.originFile === file.relativePath ? supplied : undefined;
  const complete = proof ? proof.coverage === "complete"
    : bound && modifierCapability === "complete" && domain.producerStatus === "parsed";

  if (!complete) {
    // Raw text can keep a previously checked candidate in scope. It cannot
    // establish an executable call, or qualify the unknown observation domain.
    const mandatory = proof?.coverage === "partial" || /\b(?:describe|it|test)\s*\.\s*(?:skip|only)\s*\(/.test(content);
    const reason = "Executable modifier observations are unavailable or incomplete for the selected file." +
      (proof ? " " + proof.reasonCodes.join(", ") : "");
    if (mandatory && !ctx.reportCoverage && ctx.reportUnavailable) {
      ctx.reportUnavailable(DETECTOR_ID, "executable test modifiers", file.relativePath, reason, "test-observations");
    } else if (mandatory && !ctx.reportCoverage) {
      throw new KitSourceEvidenceAcquisitionError("capability-insufficient", reason);
    } else {
      ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "executable test modifiers",
        source: { kind: "file", identity: file.relativePath }, capability: "test-observations",
        actualStatus: proof?.coverage ?? (bound ? (modifierCapability ?? "unavailable") : "unavailable"), status: "UNAVAILABLE", mandatory,
        diagnostic: "", reason });
    }
  }

  const observations = new Map<string, { modifier: "skip" | "only"; name: string; line: number; playwright: boolean }>();
  const record = (origin: string, modifier: "skip" | "only", name: string, span: {
    startLine: number; startColumn: number | null; endLine: number | null; endColumn: number | null;
  }, playwright: boolean) => {
    const { startLine, startColumn, endLine, endColumn } = span;
    const key = JSON.stringify([origin, modifier, startLine, startColumn, endLine, endColumn]);
    observations.set(key, { modifier, name, line: startLine, playwright });
  };
  for (const fact of positives) {
    const modifier = fact.observationKind === "test-modifier-only" ? "only"
      : fact.observationKind === "test-modifier-skip" ? "skip" : undefined;
    if (!modifier || fact.originPath !== file.relativePath) continue;

    // Modifier facts have a validated runner name.
    record(fact.originPath, modifier, fact.name!, fact.provenance, false);
  }
  for (const { modifier, calleeSpan } of proof?.observations ?? []) {
    record(calleeSpan.path, modifier, "test", calleeSpan, true);
  }

  const lines = splitLines(content);
  const issues: AuditIssue[] = [];
  for (const { modifier, name, line, playwright } of observations.values()) {
    const focus = modifier === "only";
    const call = `${name}.${modifier}(`;
    issues.push(makeCodeRotIssue({
      auditType: "code-rot",
      detectorId: DETECTOR_ID,
      idCues: [file.relativePath, modifier + "-usage", String(line)],
      title: `Committed "${call}" in "${file.relativePath}"`,
      description: playwright
        ? `${file.relativePath}:${line} contains a Playwright "${call}" call. ` +
          (focus ? "Review the focused test modifier before merging." : "Confirm that the skip call is intentional.")
        : `${file.relativePath}:${line} uses "${call}" -- ` + (focus
        ? "this silently excludes every other test in a CI run and is almost always accidental."
        : "confirm this is intentional and not accidentally committed."),
      severity: focus ? "high" : "medium",
      confidence: "high",
      falsePositiveRisk: "low",
      category: "test-rot",
      recommendedAction: focus ? "Remove .only before committing/merging."
        : playwright ? "Review whether the .skip call is intentional and document when it applies."
        : "Remove .skip if the test should run, or add a comment explaining why it is skipped.",
      suggestedFixStrategy: `Remove "${call}" at ${file.relativePath}:${line}` +
        (focus ? "." : playwright ? " or document when it should apply." : " or document why it is intentionally skipped."),
      validationCommands: [playwright ? `npx playwright test ${file.relativePath}` : `npx vitest run ${file.relativePath}`],
      releaseBlocking: focus,
      implementationBlocking: false,
      autoFixEligible: false,
      evidence: [{
        kind: "file",
        message: `Found "${call}" usage.`,
        filePath: file.relativePath,
        line,
        excerpt: (lines[line - 1]?.trim() || call).slice(0, 200),
        source: DETECTOR_ID,
        confidence: "high",
      }],
      affectedFiles: [file.relativePath],
    }));
  }
  return issues;
}

function findStaleVersionMentions(testRelativePath: string, content: string, currentVersion: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const lines = splitLines(content);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(TEST_TITLE_VERSION_PATTERN);
    if (!match) continue;
    const mentionedVersion = match[2];
    if (mentionedVersion === currentVersion) continue;
    if (HISTORICAL_HEDGE_PATTERN.test(line)) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [testRelativePath, "stale-version-mention", String(i + 1), mentionedVersion],
        title: `Test title in "${testRelativePath}" mentions version v${mentionedVersion}, not the current package version`,
        description: `${testRelativePath}:${i + 1} mentions "v${mentionedVersion}" in a test title, but the current package version is "${currentVersion}". If this is intentionally a historical/regression reference, mention that in the title.`,
        severity: "low",
        confidence: "low",
        falsePositiveRisk: "medium",
        category: "test-rot",
        recommendedAction: "Confirm whether the version mention should be updated or is intentionally historical.",
        suggestedFixStrategy: `Update the test title in ${testRelativePath} or add "regression"/"historical" wording if intentional.`,
        validationCommands: [`npx vitest run ${testRelativePath}`],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: `Test title mentions "v${mentionedVersion}", current package version is "${currentVersion}".`,
            filePath: testRelativePath,
            line: i + 1,
            excerpt: line.trim().slice(0, 200),
            source: DETECTOR_ID,
            confidence: "low",
          },
        ],
        affectedFiles: [testRelativePath],
      })
    );
  }
  return issues;
}

function findScriptsReferencingMissingTestPaths(ctx: AuditDetectorContext): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const pkg = ctx.sourceOfTruth.package;
  if (!pkg) return issues;

  const knownPaths = new Set(ctx.inventory.files.map((f) => f.relativePath));
  const knownDirPrefixes = new Set(
    ctx.inventory.files.flatMap((f) => {
      const parts = f.relativePath.split("/");
      const prefixes: string[] = [];
      for (let i = 1; i < parts.length; i++) prefixes.push(parts.slice(0, i).join("/"));
      return prefixes;
    })
  );

  for (const [scriptName, command] of Object.entries(pkg.scripts)) {
    VITEST_RUN_ARG_PATTERN.lastIndex = 0;
    for (const match of command.matchAll(VITEST_RUN_ARG_PATTERN)) {
      const referencedPath = match[1].replace(/^["']|["']$/g, "");
      if (knownPaths.has(referencedPath) || knownDirPrefixes.has(referencedPath)) continue;
      if (fs.existsSync(path.join(ctx.target.rootPath, referencedPath))) continue;

      issues.push(
        makeCodeRotIssue({
          auditType: "code-rot",
          detectorId: DETECTOR_ID,
          idCues: ["script-references-missing-test-path", scriptName, referencedPath],
          title: `Script "${scriptName}" references a test path that does not exist: "${referencedPath}"`,
          description: `package.json script "${scriptName}" runs "vitest run ${referencedPath}", but "${referencedPath}" does not exist in the project.`,
          severity: "medium",
          confidence: "high",
          falsePositiveRisk: "low",
          category: "test-rot",
          recommendedAction: "Fix the script's test path, or restore/remove the referenced tests.",
          suggestedFixStrategy: `Edit package.json's "${scriptName}" script to reference an existing test path.`,
          validationCommands: [`npm run ${scriptName}`],
          releaseBlocking: false,
          implementationBlocking: false,
          autoFixEligible: false,
          evidence: [
            {
              kind: "file",
              message: `Script command references a test path that does not exist.`,
              filePath: "package.json",
              excerpt: `"${scriptName}": "... vitest run ${referencedPath} ..."`,
              source: DETECTOR_ID,
              confidence: "high",
            },
          ],
          affectedFiles: ["package.json"],
        })
      );
    }
  }
  return issues;
}
