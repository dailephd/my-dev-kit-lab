import path from "node:path";
import { isBuiltin } from "node:module";
import { hasImmediateRelativeSpelling, KitSourceEvidenceAcquisitionError, qualifyKitImportPredicate } from "../../core/kitSourceEvidence.js";
import { kitPredicateContent, requireCompleteKitOccurrence } from "../utils/sourceFactsLookup.js";
import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import type { InventoryFileEntry } from "../../core/projectInventory.js";
import type { PackageTruth } from "../../core/sourceOfTruth.js";
import type { SourceFileFacts } from "../../core/sourceFacts.js";
import { readBoundedFileText } from "../utils/boundedRead.js";
import { baseNameNoExt, isGenericOrTestPrefixedDeclarationName } from "../utils/filePatternUtils.js";
import { deduplicateIssuesById, makeCodeRotIssue } from "../utils/issueFactories.js";
import { collectRelativeImportBasenames, getParsedSourceFacts, indexSourceFactsByPath } from "../utils/sourceFactsLookup.js";
import { isJvmLifecycleOrConventionalDeclarationName, jvmImportSimpleName, jvmImportLooksPossiblyLocal } from "../utils/jvmSourceFactsUtils.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 4 — dead-code candidate detector.
//
// Every finding here is a candidate, not proof of dead code -- title wording
// stays hedged throughout. Bounded (per-file MAX_READ_BYTES skip), no
// subprocess, no exports/type-usage analysis (see SKIPPED note below).
//
// Explicitly SKIPPED (spec-documented, not implemented in this batch):
//   - "exported symbols unused" -- there is no existing safe/cheap way in
//     this repo to determine which exported symbols are referenced
//     elsewhere without a real TypeScript program (ts-morph/checker), which
//     is out of scope for a bounded regex-based detector. Not implemented.
// ---------------------------------------------------------------------------

const DETECTOR_ID = "dead-code-candidate";
const SCRIPT_ORIGIN_PROOF_REQUIRED = "Script reference origins require a qualified R3 selected-domain proof.";
export const MAX_READ_BYTES = 200_000;
const OLD_DIR_SEGMENT_PATTERN = /^(old|deprecated|legacy|_archive)$/i;
const ORPHAN_GENERATED_PATTERN = /\.generated\.|\.bak$|\.orig$/;
const IMPORT_SPECIFIER_PATTERN = /(?:from|require\()\s*["']([^"']+)["']/g;
const PLANNED_LABEL_PATTERN = /\b(planned|future|roadmap|not implemented|not yet implemented|coming soon)\b/i;
const SETUP_FILE_PATTERN = /setup[tT]ests?|vitest\.setup|test-setup/i;
const PYTHON_DECLARATION_PREDICATE = "possibly-unreferenced-python-declaration";
const JVM_DECLARATION_PREDICATE = "possibly-unreferenced-jvm-declaration";

function isJvmLanguage(language: string): boolean {
  return language === "java" || language === "kotlin";
}

export const DEAD_CODE_CANDIDATE_DETECTOR: AuditDetector = {
  id: DETECTOR_ID,
  auditType: "code-rot",
  title: "Dead-code candidate",
  description:
    "Detects candidate (not proven) unused files: scripts/ files not referenced by any package.json script, source files with no in-repo importer, files under old/deprecated/legacy directories not mentioned in docs, and orphaned generated-looking files.",
  supportedIncludeAreas: ["cli", "package", "tests"],
  shouldSkip: (ctx: AuditDetectorContext) => {
    if (!ctx.config.include.includes("package") && !ctx.config.include.includes("tests")) {
      return { skip: true, reason: "--include selects neither package nor tests; this detector's checks need at least one." };
    }
    return { skip: false };
  },
  run: async (ctx: AuditDetectorContext): Promise<AuditIssue[]> => {
    if (ctx.sourceFacts?.provider === "kit" && !ctx.kitSourceReader) throw new KitSourceEvidenceAcquisitionError("invalid-request", "Kit-backed detector requires its validated per-audit reader; native fallback is forbidden.");
    const issues: AuditIssue[] = [];
    const pkg = ctx.sourceOfTruth.package;
    const docsConcat = concatDocsContent(ctx);
    const filePredicates = new Map<string, readonly InventoryFileEntry[]>();
    const declarationPredicates: string[] = [];
    const unavailablePredicates = new Set<string>();
    const r3 = ctx.kitSourceReader?.expressionDomains;
    const positiveReferences = collectRelativeImportBasenames(r3 && ctx.sourceFacts ? {
      ...ctx.sourceFacts, files: ctx.sourceFacts.files.filter(file => file.language !== "javascript" && file.language !== "typescript"),
    } : ctx.sourceFacts);
    for (const file of ctx.sourceFacts?.files ?? []) {
      if (r3 && (file.language === "javascript" || file.language === "typescript")) continue;
      if (!file.exports.some(fact => fact.exportOrigin === "re-export")) continue;
      for (const specifier of ctx.kitSourceReader?.reExportSpecifiers?.(file.relativePath) ?? []) {
        if (specifier.startsWith(".")) positiveReferences.add(baseNameNoExt(specifier.split("?")[0]).toLowerCase());
      }
    }
    const registerFilePredicate = (predicate: string, candidates: readonly InventoryFileEntry[]) => {
      if (candidates.length) filePredicates.set(predicate, candidates);
      else ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate,
        source: { kind: "domain", identity: "eligible selected file candidates" }, capability: "imports",
        actualStatus: "not-required", status: "NOT_APPLICABLE", mandatory: false, diagnostic: "",
        reason: "No eligible file remains after existing policy exclusions and independently qualified positive references; no reference-absence premise is required." });
    };
    if (ctx.config.include.includes("package") && pkg && ctx.inventory.scriptFiles.length) {
      registerFilePredicate("unreferenced-script-file", unreferencedScriptCandidates(ctx, pkg, positiveReferences));
    }
    if (ctx.config.include.includes("cli") || ctx.config.include.includes("architecture")) {
      if (ctx.inventory.sourceFiles.length) registerFilePredicate("unreferenced-source-file", unreferencedSourceCandidates(ctx, pkg, docsConcat, positiveReferences));
      if (ctx.inventory.sourceFiles.some(f => f.language === "python")) declarationPredicates.push(PYTHON_DECLARATION_PREDICATE);
      if (ctx.inventory.sourceFiles.some(f => isJvmLanguage(f.language))) declarationPredicates.push(JVM_DECLARATION_PREDICATE);
    }
    const predicates = [...filePredicates.keys(), ...declarationPredicates];
    const unwitnessedCandidates = new Set([...filePredicates.values()].flatMap(files => files.map(file => file.relativePath)));
    const allFileCandidatePaths = new Set(unwitnessedCandidates);
    const exactReferences = new Set<string>();
    // Keep one diagnostic probe for a substituted candidate. An immediate
    // spelling is a separate opportunity to obtain an authenticated witness.
    const triedIndexedFallbacks = new Set<string>();
    const boundedScriptOrigins = new Map<string, Set<string>>();
    const pendingFileGaps: { path: string; predicate: string; reason: string; possibleTargets?: ReadonlySet<string> }[] = [];
    if (predicates.length === 0) {
      // No semantic import inventory is consumed when every absence family
      // has no remaining candidate. Raw fixture checks retain their own proof.
      for (const file of ctx.sourceFacts?.files ?? []) {
        const actualStatus = file.kit?.capabilities.imports;
        if ((file.role === "source" || file.role === "test") && (actualStatus === "complete" || actualStatus === "partial")) {
          ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "imports evidence",
            source: { kind: "file", identity: file.relativePath }, capability: "imports", actualStatus,
            status: "NOT_APPLICABLE", mandatory: false, diagnostic: "",
            reason: "All selected reference-absence families have no remaining candidate; semantic import completeness is not a premise of the remaining raw fixture checks." });
        }
      }
    }
    const reportGap = (filePath: string, predicate: string, reason: string, targetScoped = false) => {
      if (!ctx.reportUnavailable) throw new KitSourceEvidenceAcquisitionError("capability-insufficient", reason);
      if (!targetScoped) unavailablePredicates.add(predicate);
      ctx.reportUnavailable(DETECTOR_ID, predicate, filePath, reason);
    };
    const unavailable = (filePath: string, reason: string, affectedPredicates: readonly string[], possibleTargets?: ReadonlySet<string>) => {
      for (const predicate of affectedPredicates) {
        if (r3 && filePredicates.has(predicate)) pendingFileGaps.push({ path: filePath, predicate, reason, possibleTargets });
        else reportGap(filePath, predicate, reason);
      }
    };
    const builtinReference = (specifier: string) => !process.env.NODE_OPTIONS?.trim() &&
      specifier.startsWith("node:") && isBuiltin(specifier);
    if (r3 && filePredicates.size) {
      for (const script of ctx.inventory.scriptFiles) {
        if (script.role !== "config") unavailable(script.relativePath,
          SCRIPT_ORIGIN_PROOF_REQUIRED, [...filePredicates.keys()]);
      }
    }
    if (predicates.length && ctx.sourceFacts?.provider === "kit") {
      // The entire selected reference domain matters, not just candidate files
      // or the completeness of one local import inventory.
      const participants = [...new Map([...ctx.inventory.sourceFiles, ...ctx.inventory.testFiles, ...ctx.inventory.scriptFiles]
        .filter(f => (f.role === "source" || f.role === "test") &&
          ["typescript", "javascript", "python", "java", "kotlin", "rust"].includes(f.language))
        .map(f => [f.relativePath, f])).values()];
      const checks: { filePath: string; predicates: readonly string[]; run: () => Promise<string | undefined> }[] = [];
      const sourceFacts = indexSourceFactsByPath(ctx.sourceFacts);
      for (const entry of participants) {
        const file = sourceFacts.get(entry.relativePath);
        if (!file) throw new KitSourceEvidenceAcquisitionError("selection-incomplete", `Required reverse-reference source ${entry.relativePath} is unselected.`);
        const jvm = isJvmLanguage(file.language);
        const affected = predicates.filter(predicate => {
          // Declaration heuristics use imported names from their own language domain.
          if (predicate === PYTHON_DECLARATION_PREDICATE) return file.language === "python";
          if (predicate === JVM_DECLARATION_PREDICATE) return jvm;
          // JVM imports can bind to Java/Kotlin declarations. Textual
          // from/require matches are checked separately for file predicates.
          return !jvm || filePredicates.get(predicate)!.some(candidate => isJvmLanguage(candidate.language));
        });
        const reportDisjoint = (subject: string) => {
          for (const predicate of predicates) {
            if (affected.includes(predicate)) continue;
            ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate,
              source: { kind: "file", identity: entry.relativePath }, capability: "imports",
              actualStatus: file.kit?.capabilities.imports ?? "unavailable", status: "NOT_APPLICABLE", mandatory: false,
              diagnostic: "", reason: `${subject} cannot contribute an imported name or binding to this predicate's selected language domain.` });
          }
        };
        if (r3 && (file.language === "javascript" || file.language === "typescript") && affected.length) {
          if (ctx.kitSourceReader?.ambientClassification?.(entry.relativePath)?.outcome === "proven-ambient-only") {
            for (const predicate of affected) ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate,
              source: { kind: "file", identity: entry.relativePath }, capability: "imports", actualStatus: "not-required",
              status: "NOT_APPLICABLE", mandatory: false, diagnostic: "",
              reason: "Authenticated entire-file ambient stub cannot contribute executable references." });
            continue;
          }
          const reader = ctx.kitSourceReader!;
          const domains = (await r3(entry.relativePath)).map(({ proof, linkedDestination, linkedImportFactId }) => {
            const linkedBound = linkedDestination?.selectedTargetUpperBound;
            return {
              linkedImportFactId,
              proof,
              positivePaths: linkedDestination?.positivePath ? [linkedDestination.positivePath] : proof.positivePaths,
              selectedTargetUpperBound: linkedBound ?? proof.selectedTargetUpperBound,
              excludesSelectedDomain: linkedBound?.length === 0 || proof.excludesSelectedDomain,
            };
          });
          if (domains.some(({ proof }) => proof.snapshotId !== reader.snapshotId)) {
            throw new KitSourceEvidenceAcquisitionError("snapshot-mismatch", "Reverse-reference proof belongs to a different Kit snapshot.");
          }
          const linked = new Set(domains.map(d => d.linkedImportFactId));
          for (const { positivePaths } of domains) for (const target of positivePaths) {
            exactReferences.add(target);
            unwitnessedCandidates.delete(target);
          }

          const staticImports = file.imports.filter(imp => !linked.has(imp.provenance?.factId));
          const reExports = reader.reExportTargets?.(entry.relativePath) ?? [];
          const accountedImports = reader.explicitImportsCompleteWithExpressions?.(entry.relativePath, file.imports.length);
          const importsComplete = qualifyKitImportPredicate(file) === "QUALIFIED_NEGATIVE" || accountedImports;
          const exportsComplete = file.kit?.capabilities.exports === "complete" &&
            reExports.length === file.exports.filter(fact => fact.exportOrigin === "re-export").length;
          const inventoriesComplete = importsComplete && exportsComplete;
          const newProfile = reader.ordinarySourceReference === true;
          if (reader.expressionReference && file.kit?.capabilities.imports === "partial" && accountedImports &&
              domains.length && file.imports.every(imp => qualifyKitImportPredicate(file, imp) === "QUALIFIED_POSITIVE")) {
            ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "imports evidence",
              source: { kind: "file", identity: entry.relativePath }, capability: "imports",
              actualStatus: "partial", status: "QUALIFIED", mandatory: true, diagnostic: "",
              reason: "Authenticated explicit imports and complete expression inventory account for the import observations.",
              proof: { kind: "import-domain", snapshotId: reader.snapshotId,
                references: domains.map(({ proof }) => proof.expressionFactId) } });
          }
          const possiblePaths = new Set(domains.flatMap(({ selectedTargetUpperBound }) => selectedTargetUpperBound ?? []));
          let bounded = inventoriesComplete && domains.every(({ selectedTargetUpperBound, excludesSelectedDomain }) =>
            selectedTargetUpperBound !== undefined || excludesSelectedDomain);
          let legacyExclusionProbe = bounded &&
            reExports.every(fact => fact.sourceSpecifier.startsWith(".") || builtinReference(fact.sourceSpecifier)) &&
            staticImports.every(imp => qualifyKitImportPredicate(file, imp) === "QUALIFIED_POSITIVE" &&
              !!imp.provenance?.factId && (builtinReference(imp.source) ||
                (imp.source.startsWith(".") && imp.importResolution === "unresolved")));
          const inventoryBlockers: string[] = [];
          if (!importsComplete) inventoryBlockers.push("incomplete import inventory");
          if (!exportsComplete) inventoryBlockers.push("incomplete re-export inventory");
          const expressionBlockers = domains.filter(({ selectedTargetUpperBound, excludesSelectedDomain }) => !excludesSelectedDomain &&
            (!selectedTargetUpperBound || selectedTargetUpperBound.some(target => !exactReferences.has(target))))
            .map(({ proof }) => "dynamic import [" + proof.expressionFactId + "]: " + (proof.reasonCode ?? proof.outcome));
          const blockers = newProfile ? [...inventoryBlockers, ...expressionBlockers] : [];

          const targetProofs = new Map<string, Awaited<ReturnType<typeof reader.importTarget>>>();
          const recordEdge = async (kind: string, specifier: string, factId: string, indexedTarget?: string, request = true) => {
            if (builtinReference(specifier)) return;
            let proof = targetProofs.get(factId);
            let unavailableReason: string | undefined;
            if (!proof && request) {
              try {
                proof = await reader.importTarget(factId);
                targetProofs.set(factId, proof);
              } catch (error) {
                if (!(error instanceof KitSourceEvidenceAcquisitionError) || error.category !== "capability-insufficient") throw error;
                unavailableReason = error.message;
              }
            }
            for (const target of new Set([proof?.exactSelectedPath, newProfile ? proof?.qualifiedSourceReferencePath : undefined])) {
              if (!target || (indexedTarget && indexedTarget !== target) ||
                  !allFileCandidatePaths.has(target) || exactReferences.has(target)) continue;
              exactReferences.add(target);
              unwitnessedCandidates.delete(target);
              ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "selected module reference",
                source: { kind: "file", identity: entry.relativePath }, capability: "imports",
                actualStatus: "present", status: "QUALIFIED", mandatory: false, diagnostic: "",
                reason: target === proof?.exactSelectedPath
                  ? "Kit confirms one selected immediate target for this recorded module reference."
                  : "Kit qualifies one selected static source reference for this recorded module reference.",
                proof: { kind: "import-target", snapshotId: reader.snapshotId, references: [factId, target] } });
            }
            const legacyExclusion = indexedTarget === undefined && proof?.status === "proven-missing";
            const bound = (newProfile ? proof?.selectedTargetUpperBound : undefined) ?? (legacyExclusion ? [] : undefined);
            if (bound) {
              for (const target of bound) possiblePaths.add(target);
              if (bound.length === 0) {
                ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "selected module exclusion",
                  source: { kind: "file", identity: entry.relativePath }, capability: "imports",
                  actualStatus: legacyExclusion ? "proven-missing" : "disjoint-selected-domain",
                  status: "QUALIFIED", mandatory: false, diagnostic: "",
                  reason: proof?.directExternalReferenceExcluded ? "Kit qualified a direct external package outside the selected source domain."
                    : "Kit exhausted the recorded module reference's candidates in the complete selection.",
                  proof: { kind: "import-target", snapshotId: reader.snapshotId, references: [factId, ...(legacyExclusion ? proof!.candidatePaths : [])] } });
              } else if (bound.some(target => !exactReferences.has(target))) {
                blockers.push(kind + " " + JSON.stringify(specifier) + " [" + factId + "]: qualified domain still permits " + bound.join(", "));
              }
              return;
            }
            bounded = false;
            legacyExclusionProbe = false;
            const status = proof ? proof.status + " (" + proof.reasonCode + ")" : undefined;
            const detail = newProfile
              ? unavailableReason ? "proof unavailable (" + unavailableReason + ")" :
                proof?.ordinarySourceReferenceReason ? "domain incomplete (" + proof.ordinarySourceReferenceReason + ")" :
                  status ? status + "; no exhaustive target proof" : "proof not requested"
              : status ?? "no exhaustive target proof";
            blockers.push(kind + " " + JSON.stringify(specifier) + " [" + factId + "]: " + detail);
          };

          for (const imp of staticImports) {
            if (!unwitnessedCandidates.size) break;
            if (qualifyKitImportPredicate(file, imp) !== "QUALIFIED_POSITIVE" || !imp.provenance?.factId) {
              bounded = false;
              legacyExclusionProbe = false;
              blockers.push("unqualified import fact: " + JSON.stringify(imp.source));
              continue;
            }
            const indexedTarget = imp.importResolution === "resolved-local" && imp.targetPaths?.length === 1
              ? imp.targetPaths[0] : undefined;
            let legacyPositiveProbe = false;
            if (!newProfile && indexedTarget && unwitnessedCandidates.has(indexedTarget)) {
              const immediate = hasImmediateRelativeSpelling(entry.relativePath, imp.source, indexedTarget);
              legacyPositiveProbe = immediate || !triedIndexedFallbacks.has(indexedTarget);
              if (!immediate) triedIndexedFallbacks.add(indexedTarget);
            }
            await recordEdge("import", imp.source, imp.provenance.factId, indexedTarget,
              newProfile || legacyPositiveProbe || legacyExclusionProbe);
          }
          for (const fact of reExports) {
            if (!unwitnessedCandidates.size) break;
            await recordEdge("re-export", fact.sourceSpecifier, fact.id, undefined, newProfile || fact.sourceSpecifier.startsWith("."));
          }
          if (!newProfile) blockers.push(...expressionBlockers, ...inventoryBlockers);
          if (bounded) boundedScriptOrigins.set(entry.relativePath, new Set(affected));
          if (bounded && possiblePaths.size === 0) {
            for (const predicate of affected) ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate,
              source: { kind: "file", identity: entry.relativePath }, capability: "imports",
              actualStatus: "disjoint-selected-domain", status: "QUALIFIED", mandatory: false, diagnostic: "",
              reason: "Complete import and re-export evidence confines this origin to explicit Node built-ins or proven selected-domain exclusions." });
          } else {
            unavailable(entry.relativePath, "Selected JS/TS reverse-reference domain lacks exact reference or complete exclusion evidence."
              + (blockers.length ? " Unresolved references: " + blockers.join(" | ") + "." : ""), affected, bounded ? possiblePaths : undefined);
          }
          continue;
        }
        if (qualifyKitImportPredicate(file) !== "QUALIFIED_NEGATIVE") {
          reportDisjoint(`The ${file.language} import inventory`);
          if (affected.length) checks.push({ filePath: entry.relativePath, predicates: affected,
            run: async () => "Reverse-reference absence requires complete authenticated imports across the selected source domain." });
          continue;
        }
        for (const imp of file.imports) {
          if (!(imp.source.startsWith(".") || (jvm && jvmImportLooksPossiblyLocal(imp)))) continue;
          const factId = imp.provenance?.factId;
          if (!factId) throw new KitSourceEvidenceAcquisitionError("artifact-invalid", `Import in ${entry.relativePath} lacks fact identity.`);
          if (jvm) reportDisjoint(`JVM import ${imp.source}`);
          if (!affected.length) continue;
          checks.push({ filePath: entry.relativePath, predicates: affected, run: async () => {
            try {
              const proof = await ctx.kitSourceReader!.importTarget(factId);
              if (proof.status === "indeterminate" || proof.status === "outside-selected-roots") {
                return `Import ${imp.source} remains ${proof.status} (${proof.reasonCode}); it may reference a candidate.`;
              }
            } catch (error) {
              if (!(error instanceof KitSourceEvidenceAcquisitionError) || error.category !== "capability-insufficient") throw error;
              return `Import ${imp.source}: ${error.message}`;
            }
          } });
        }
      }
      // Match acquisition's bounded concurrency. Fold settled outcomes in the
      // original file/fact order. No proof is skipped; invalid evidence is fatal.
      for (let offset = 0; offset < checks.length; offset += 4) {
        const batch = checks.slice(offset, offset + 4);
        const outcomes = await Promise.allSettled(batch.map(check => check.run()));
        for (const [index, outcome] of outcomes.entries()) {
          if (outcome.status === "rejected") throw outcome.reason;
          const check = batch[index]!;
          if (outcome.value !== undefined) unavailable(check.filePath, outcome.value, check.predicates);
        }
      }
    }

    if (r3 && pkg) for (const file of filePredicates.get("unreferenced-source-file") ?? []) {
      const script = sourceRootScript(pkg, file.relativePath);
      if (!script || exactReferences.has(file.relativePath)) continue;
      exactReferences.add(file.relativePath);
      ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "selected package script root",
        source: { kind: "file", identity: file.relativePath }, capability: "imports",
        actualStatus: "positive-witness", status: "QUALIFIED", mandatory: false, diagnostic: "",
        reason: 'package.json script ' + JSON.stringify(script) + ' identifies this selected entry or configuration file.' });
    }
    const remainingFilePredicates = new Set(filePredicates.keys());
    for (const [predicate, candidates] of filePredicates) {
      if (candidates.some(candidate => !exactReferences.has(candidate.relativePath))) continue;
      remainingFilePredicates.delete(predicate);
      ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate,
        source: { kind: "domain", identity: "eligible selected file candidates" }, capability: "imports",
        actualStatus: "positive-witness", status: "NOT_APPLICABLE", mandatory: false, diagnostic: "",
        reason: "Every eligible candidate has an authenticated positive path witness." });
    }
    const blocks = (gap: typeof pendingFileGaps[number], candidate: string) =>
      !exactReferences.has(candidate) && (!gap.possibleTargets || gap.possibleTargets.has(candidate));
    const applicableGaps = pendingFileGaps.filter(gap => remainingFilePredicates.has(gap.predicate) &&
      (gap.reason !== SCRIPT_ORIGIN_PROOF_REQUIRED || !boundedScriptOrigins.get(gap.path)?.has(gap.predicate)));
    const blockedPaths = new Map<string, Set<string>>();
    for (const gap of applicableGaps) {
      const affected = filePredicates.get(gap.predicate)!.filter(candidate => blocks(gap, candidate.relativePath));
      if (!affected.length) continue;
      const paths = blockedPaths.get(gap.predicate) ?? new Set<string>();
      for (const candidate of affected) paths.add(candidate.relativePath);
      blockedPaths.set(gap.predicate, paths);
      reportGap(gap.path, gap.predicate, gap.reason, true);
    }
    let references = new Set(positiveReferences);
    const availableFilePredicates = [...remainingFilePredicates].filter(predicate =>
      !unavailablePredicates.has(predicate) && filePredicates.get(predicate)!.some(candidate =>
        !exactReferences.has(candidate.relativePath) && !blockedPaths.get(predicate)?.has(candidate.relativePath)));
    if (availableFilePredicates.length) {
      try { references = await buildReverseReferenceIndex(ctx, r3 ? positiveReferences : undefined); }
      catch (error) {
        if (!(error instanceof KitSourceEvidenceAcquisitionError) || error.category !== "capability-insufficient" || !ctx.reportCoverage) throw error;
        for (const predicate of availableFilePredicates) {
          unavailablePredicates.add(predicate);
          ctx.reportCoverage({ detectorId: DETECTOR_ID, predicate,
            source: { kind: "domain", identity: "selected project reverse-reference sources" }, capability: "raw-content",
            actualStatus: "unavailable", status: "UNAVAILABLE", mandatory: true, diagnostic: "", reason: error.message });
        }
      }
    }

    if (r3) for (const predicate of remainingFilePredicates) {
      if (!blockedPaths.has(predicate) && !(ctx.kitSourceReader?.ordinarySourceReference &&
          applicableGaps.some(gap => gap.predicate === predicate && gap.possibleTargets))) continue;
      for (const candidate of filePredicates.get(predicate)!) {
        const file = candidate.relativePath;
        if (exactReferences.has(file) || references.has(baseNameNoExt(file).toLowerCase())) continue;
        const blockers = applicableGaps.filter(gap => gap.predicate === predicate && blocks(gap, file));
        if (!blockers.length) {
          ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: predicate + " candidate exclusion",
            source: { kind: "file", identity: file }, capability: "imports", actualStatus: "disjoint-selected-domain",
            status: "QUALIFIED", mandatory: false, diagnostic: "",
            reason: "The remaining bounded JS/TS import domains for this check exclude this candidate." });
          continue;
        }
        ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: predicate + " blocked candidate",
          source: { kind: "file", identity: file }, capability: "imports", actualStatus: "unresolved",
          status: "UNDETERMINED", mandatory: false, diagnostic: "",
          reason: "See " + predicate + " mandatory gaps. " + blockers.length + " pending origin records cannot rule out this path." });
      }
    }

    if (availableFilePredicates.includes("unreferenced-script-file") && !unavailablePredicates.has("unreferenced-script-file") && pkg) {
      const excluded = new Set([...exactReferences, ...(blockedPaths.get("unreferenced-script-file") ?? [])]);
      issues.push(...(await findUnreferencedScriptFiles(ctx, pkg, references, excluded)));
    }

    if (availableFilePredicates.includes("unreferenced-source-file") && !unavailablePredicates.has("unreferenced-source-file")) {
      const excluded = new Set([...exactReferences, ...(blockedPaths.get("unreferenced-source-file") ?? [])]);
      issues.push(...(await findUnreferencedSourceFiles(ctx, pkg, docsConcat, references, excluded)));
    }

    issues.push(...findOldOrDeprecatedFilesNotInDocs(ctx, docsConcat));
    issues.push(...findOrphanedGeneratedFiles(ctx.inventory.files));

    if (ctx.config.include.includes("tests")) {
      issues.push(...(await findUnreferencedFixtures(ctx)));
    }

    if (declarationPredicates.includes(PYTHON_DECLARATION_PREDICATE) && !unavailablePredicates.has(PYTHON_DECLARATION_PREDICATE)) {
      issues.push(...findPossiblyUnreferencedPythonDeclarations(ctx));
    }
    if (declarationPredicates.includes(JVM_DECLARATION_PREDICATE) && !unavailablePredicates.has(JVM_DECLARATION_PREDICATE)) {
      issues.push(...findPossiblyUnreferencedJvmDeclarations(ctx));
    }

    return deduplicateIssuesById(issues);
  },
};

function concatDocsContent(ctx: AuditDetectorContext): string {
  const parts: string[] = [];
  for (const docFile of ctx.inventory.docsFiles) {
    const content = readBoundedFileText(ctx.target.rootPath, docFile.relativePath, docFile.sizeBytes, MAX_READ_BYTES);
    if (content !== null) parts.push(content);
  }
  return parts.join("\n");
}

function docsDescribeAsPlanned(docsConcat: string, relativePath: string): boolean {
  const base = baseNameNoExt(relativePath);
  const idx = docsConcat.indexOf(base);
  if (idx === -1) return false;
  const windowStart = Math.max(0, idx - 100);
  const windowEnd = Math.min(docsConcat.length, idx + base.length + 100);
  return PLANNED_LABEL_PATTERN.test(docsConcat.slice(windowStart, windowEnd));
}

function sourceRootScript(pkg: PackageTruth, candidate: string): string | undefined {
  return Object.entries(pkg.scripts).find(([, command]) => {
    // A direct, option-free command names its entry point. Avoid interpreting
    // shell syntax, interpolated commands or arbitrary basename matches.
    const entry = /^(?:node|tsx) +(?:\.\/)?([\w.-]+(?:\/[\w.-]+)*)$/.exec(command.trim())?.[1];
    if (entry === candidate) return true;
    return candidate === "tsup.config.ts" && command.trim() === "tsup" &&
      !!(pkg.devDependencies.tsup || pkg.dependencies.tsup);
  })?.[0];
}

function binTargetsAsSourceCandidates(pkg: PackageTruth): Set<string> {
  const raw: string[] = pkg.bin === null ? [] : typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin);
  const candidates = new Set<string>();
  for (const target of raw) {
    candidates.add(target);
    if (target.startsWith("dist/") && target.endsWith(".js")) {
      candidates.add(`${target.slice("dist/".length, -".js".length)}.ts`);
    }
  }
  if (pkg.main) candidates.add(pkg.main);
  if (pkg.module) candidates.add(pkg.module);
  if (pkg.types) candidates.add(pkg.types);
  return candidates;
}

function unreferencedScriptCandidates(ctx: AuditDetectorContext, pkg: PackageTruth, referencedBasenames: Set<string>): InventoryFileEntry[] {
  const scriptCommandsBlob = Object.values(pkg.scripts).join(" \n ");
  const binCandidates = binTargetsAsSourceCandidates(pkg);
  // A scripts/ file that is imported by another script (a shared helper
  // module rather than a CLI entrypoint, e.g.
  // scripts/security/resolveToolRoot.ts) is not dead code even though no
  // package.json script command names it directly -- discovered via a real
  // false positive during self-testing.
  return ctx.inventory.scriptFiles.filter(file => {
    const base = baseNameNoExt(file.relativePath);
    return base.toLowerCase() !== "index" && !SETUP_FILE_PATTERN.test(path.basename(file.relativePath)) &&
      !binCandidates.has(file.relativePath) && !scriptCommandsBlob.includes(file.relativePath) && !scriptCommandsBlob.includes(base) &&
      !referencedBasenames.has(base.toLowerCase());
  });
}

async function findUnreferencedScriptFiles(ctx: AuditDetectorContext, pkg: PackageTruth, referencedBasenames: Set<string>, referencedPaths: ReadonlySet<string>): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];
  for (const file of unreferencedScriptCandidates(ctx, pkg, referencedBasenames)) {
    if (referencedPaths.has(file.relativePath)) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["unreferenced-script-file", file.relativePath],
        title: `Script file "${file.relativePath}" is not referenced by any package.json script`,
        description: `"${file.relativePath}" exists under scripts/ but no package.json script command mentions its path or basename. This is a candidate for dead code -- confirm it isn't invoked another way (e.g. imported by another script) before removing.`,
        severity: "medium",
        confidence: "medium",
        falsePositiveRisk: "medium",
        category: "dead-code-candidate",
        recommendedAction: "Confirm the file is unused, then either add a script entry or remove the file.",
        suggestedFixStrategy: `Remove "${file.relativePath}" or wire it up to a package.json script.`,
        validationCommands: ["npm run audit -- --types code-rot --include package"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "reference",
            message: "No package.json script command references this file's path or basename.",
            filePath: file.relativePath,
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: [file.relativePath],
      })
    );
  }
  return issues;
}

async function buildReverseReferenceIndex(ctx: AuditDetectorContext, r3References?: Set<string>): Promise<Set<string>> {
  // v0.3.1 Batch 4 -- seeded with basenames the TypeScript/JavaScript
  // analyzer already resolved from real import declarations (parsed files
  // only). This only ever adds references, never removes them, so it can
  // only reduce false positives relative to the regex-only scan below --
  // safe even though ctx.sourceFacts is optional (returns an empty set when
  // absent, e.g. in existing detector-only unit tests).
  const referencedBasenames = r3References ? new Set(r3References) : collectRelativeImportBasenames(ctx.sourceFacts);
  const allCandidateFiles: InventoryFileEntry[] = [
    ...ctx.inventory.sourceFiles,
    ...ctx.inventory.testFiles,
    ...ctx.inventory.scriptFiles,
  ];

  for (const file of allCandidateFiles) {
    if (file.role === "config" || r3References && (file.language === "typescript" || file.language === "javascript")) continue;
    // Match the existing bounded native predicate before requesting raw evidence.
    if (file.sizeBytes > MAX_READ_BYTES) continue;
    if (ctx.sourceFacts?.provider === "not-collected") throw new KitSourceEvidenceAcquisitionError("selection-incomplete", `Required reverse-reference source ${file.relativePath} is unselected.`);
    const rawContent = ctx.kitSourceReader?.authenticatedRawTestContent?.(file.relativePath);
    const unsupportedRaw = ctx.kitSourceReader?.unsupportedRawContentReason?.(file.relativePath);
    if (unsupportedRaw && rawContent === undefined) throw new KitSourceEvidenceAcquisitionError("capability-insufficient", unsupportedRaw);
    const content = rawContent ?? await kitPredicateContent(ctx.kitSourceReader, file.relativePath, ["from", "require("]);
    if (content === null) continue;

    IMPORT_SPECIFIER_PATTERN.lastIndex = 0;
    for (const match of content.matchAll(IMPORT_SPECIFIER_PATTERN)) {
      const specifier = match[1];
      if (ctx.kitSourceReader && /[\r\n]/.test(specifier)) throw new KitSourceEvidenceAcquisitionError("capability-insufficient", "Multiline lexical import text needs byte-preserving context.");
      if (!specifier.startsWith(".")) continue; // only relative/local specifiers are meaningful here
      const specifierBase = baseNameNoExt(specifier.split("?")[0]);
      referencedBasenames.add(specifierBase.toLowerCase());
    }
  }
  return referencedBasenames;
}

function unreferencedSourceCandidates(ctx: AuditDetectorContext, pkg: PackageTruth | null, docsConcat: string, referencedBasenames: Set<string>): InventoryFileEntry[] {
  const binCandidates = pkg ? binTargetsAsSourceCandidates(pkg) : new Set<string>();
  return ctx.inventory.sourceFiles.filter(file => {
    if (file.role === "config" || file.sizeBytes > MAX_READ_BYTES) return false;
    // This relative import/require basename policy does not model Rust mod/use
    // targets. Syntax-only imports cannot establish Rust file non-reference.
    // Fixture and script predicates remain independently applicable.
    if (file.language === "rust") return false;
    // benchmarks/ and examples/ hold standalone fixture/example project
    // content (often in other languages, e.g. Python) that is meant to be
    // read by the tool under test, not imported by this project's own
    // TS/JS import graph -- scanning them against a TS/JS import-specifier
    // reverse-reference index produces false positives, confirmed via
    // self-testing.
    if (file.relativePath.startsWith("benchmarks/") || file.relativePath.startsWith("examples/")) return false;
    const base = baseNameNoExt(file.relativePath);
    return base.toLowerCase() !== "index" && !SETUP_FILE_PATTERN.test(path.basename(file.relativePath)) &&
      !binCandidates.has(file.relativePath) && !docsDescribeAsPlanned(docsConcat, file.relativePath) &&
      !referencedBasenames.has(base.toLowerCase());
  });
}

async function findUnreferencedSourceFiles(ctx: AuditDetectorContext, pkg: PackageTruth | null, docsConcat: string, referencedBasenames: Set<string>, referencedPaths: ReadonlySet<string>): Promise<AuditIssue[]> {
  const sourceFactsIndex = indexSourceFactsByPath(ctx.sourceFacts);
  const issues: AuditIssue[] = [];
  for (const file of unreferencedSourceCandidates(ctx, pkg, docsConcat, referencedBasenames)) {
    if (referencedPaths.has(file.relativePath)) continue;
    const base = baseNameNoExt(file.relativePath);

    const evidence: AuditIssue["evidence"] = [
      {
        kind: "observation",
        message: "No relative import/require specifier in the scanned source/test/script set resolves to this file's basename.",
        filePath: file.relativePath,
        source: DETECTOR_ID,
        confidence: "low",
      },
    ];
    // v0.3.1 Batch 4 -- when the TypeScript/JavaScript analyzer actually
    // parsed this file, surface its export count as extra candidate
    // evidence (an exported symbol with zero detected external references
    // is more suspicious than an unexported one). This never changes
    // whether the issue is emitted, only its evidence -- the flagging
    // decision above is unchanged from the existing basename-reference
    // heuristic.
    const facts = getParsedSourceFacts(sourceFactsIndex, file.relativePath);
    if (facts) {
      evidence.push(buildSourceFactsEvidence(facts));
    }

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["unreferenced-source-file", file.relativePath],
        title: `Source file "${file.relativePath}" has no detected in-repo importer`,
        description: `No other source or test file's relative import/require specifier appears to reference "${file.relativePath}" by basename. This is a bounded regex-based candidate signal, not a type-level unused-file proof -- confirm manually (dynamic imports, re-exports, or CLI-only usage can evade this scan).`,
        severity: "low",
        confidence: "low",
        falsePositiveRisk: "medium",
        category: "dead-code-candidate",
        recommendedAction: "Confirm the file is genuinely unused before removing it.",
        suggestedFixStrategy: `Remove "${file.relativePath}" if confirmed unused, or wire it into an existing import graph.`,
        validationCommands: ["npm run audit -- --types code-rot --include cli"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence,
        affectedFiles: [file.relativePath],
      })
    );
  }
  return issues;
}

// v0.3.1 Batch 4 -- describes a parsed file's source-facts shape as an
// evidence entry. Only called for parseStatus "parsed" facts (see callers),
// since file-level-only/parse-error facts carry empty fact arrays that
// would misleadingly read as "zero exports" rather than "unknown".
function buildSourceFactsEvidence(facts: SourceFileFacts): AuditIssue["evidence"][number] {
  const exportOrigins = [...new Set(facts.exports.map(({ exportOrigin }) => exportOrigin ?? "unspecified"))].sort();
  return {
    kind: "reference",
    message: `Source facts for "${facts.relativePath}" (${facts.language}): recorded ${facts.exports.length} export(s), ${facts.declarations.length} declaration(s), and ${facts.imports.length} import(s). ` +
      `Export counts describe recorded entries (origin metadata: ${exportOrigins.join(", ") || "none recorded"}); cross-provider count equivalence is not established.`,
    filePath: facts.relativePath,
    source: DETECTOR_ID,
    confidence: "medium",
  };
}

// v0.3.2 Batch 2 -- conservative, declaration-level Python dead-code
// candidate check. TS/JS module-level "unused exported symbol" detection is
// explicitly SKIPPED in this file's own header comment (no safe/cheap way
// without a real type-checker) -- this Python-only check is narrower and
// safer than that skipped TS/JS idea would be, because Python source facts
// already carry declarations *and* a repo-wide cross-file "imported name"
// index (unlike anything comparable for TS/JS bare specifiers), so the
// false-positive surface is much smaller. Every one of the skip conditions
// below is a deliberate, spec-required conservatism -- see the requirements
// list in this batch's task description. Findings stay at the lowest
// severity/confidence tier in this detector's own schema (matches
// findUnreferencedFixtures()'s tier) and use "candidate"/"may indicate"
// wording throughout, never "unused" or "dead".
function findPossiblyUnreferencedPythonDeclarations(ctx: AuditDetectorContext): AuditIssue[] {
  if (!ctx.sourceFacts) return [];
  const index = indexSourceFactsByPath(ctx.sourceFacts);

  // Cross-file "this name was imported somewhere" signal -- a declaration
  // named here is referenced by at least one `from module import name`
  // elsewhere in the scanned Python file set, which is the strongest signal
  // this conservative scan can offer (Python source facts carry no
  // call/identifier reference tracking -- see pythonAnalyzer.ts's header
  // comment on why `references` stays empty by design).
  const importedNamesAcrossProject = new Set<string>();
  for (const facts of index.values()) {
    if (facts.language !== "python") continue;
    for (const imp of facts.imports) {
      if (facts.kit ? qualifyKitImportPredicate(facts, imp) !== "QUALIFIED_POSITIVE" : facts.parseStatus !== "parsed") continue;
      for (const name of imp.importedNames ?? []) importedNamesAcrossProject.add(name);
    }
  }

  const issues: AuditIssue[] = [];
  for (const facts of index.values()) {
    if (facts.language !== "python" || facts.role !== "source" || facts.parseStatus !== "parsed") continue;
    // __init__.py commonly exists only to re-export a package's public
    // surface or to mark a directory as a package -- its declarations (if
    // any) are conservatively excluded entirely rather than guessed at.
    if (path.basename(facts.relativePath) === "__init__.py") continue;

    for (const decl of facts.declarations) {
      // Methods are excluded entirely -- this detector has no existing
      // method-level dead-code evidence model for any language (TS/JS
      // methods are never flagged either), and Python method visibility is
      // even harder to infer safely (inherited/overridden/dispatched via
      // duck typing).
      if (decl.kind === "method") continue;
      if (!decl.exported) continue; // leading-underscore convention already applied by pythonAnalyzer.ts
      if (isGenericOrTestPrefixedDeclarationName(decl.name)) continue; // main/run/setup/teardown/__init__/__call__/test_*
      // A name explicitly listed in a real `__all__` is the file's own
      // strongest "this is public API" declaration -- skip rather than
      // second-guess it.
      // Legacy Python exports contain only explicit __all__ members. Kit
      // also supplies conventional exports; only its complete, positively
      // identified python-all evidence establishes this exemption.
      if (facts.exports.some((e) => e.name === decl.name &&
        (!facts.kit || (facts.kit.capabilities.exports === "complete" && e.exportOrigin === "python-all")))) continue;
      if (importedNamesAcrossProject.has(decl.name)) continue;

      issues.push(
        makeCodeRotIssue({
          auditType: "code-rot",
          detectorId: DETECTOR_ID,
          idCues: ["unreferenced-python-declaration", facts.relativePath, decl.kind, decl.name],
          title: `Python ${decl.kind} "${decl.name}" in "${facts.relativePath}" has no detected cross-file import (weak signal)`,
          description: `"${decl.name}" (${decl.kind}) is declared in "${facts.relativePath}" and does not appear as an imported name in any other scanned Python file. This is a deterministic source-facts signal from a conservative, non-semantic scan -- it does not resolve dynamic imports, framework/plugin discovery, string-based dispatch, or usage from outside the scanned project, so it may indicate dead code but is not proof. Confirm manually before removing.`,
          severity: "info",
          confidence: "low",
          falsePositiveRisk: "high",
          category: "dead-code-candidate",
          recommendedAction: "Confirm the declaration is genuinely unused before removing it.",
          suggestedFixStrategy: `Remove "${decl.name}" from "${facts.relativePath}" if confirmed unused, or reference it from another module.`,
          validationCommands: ["npm run audit -- --types code-rot --include cli"],
          releaseBlocking: false,
          implementationBlocking: false,
          autoFixEligible: false,
          evidence: [
            {
              kind: "reference",
              message: `Source facts: the Python analyzer parsed this file and found no other scanned Python file importing the name "${decl.name}". Static-analysis limitation -- confidence reduced because this scan cannot see dynamic imports or usage outside the scanned file set.`,
              filePath: facts.relativePath,
              source: DETECTOR_ID,
              confidence: "low",
            },
          ],
          affectedFiles: [facts.relativePath],
        })
      );
    }
  }
  return issues;
}

// v0.3.3 Batch 2 -- conservative, declaration-level Java/Kotlin dead-code
// candidate check. Same spirit and lowest severity/confidence tier as
// findPossiblyUnreferencedPythonDeclarations() above, adapted for the two
// key differences in what Java/Kotlin source facts can safely support:
//
//   - Method/constructor declarations (DeclarationFactKind "method") are
//     EXCLUDED ENTIRELY, for both languages. There is no call-tracking
//     evidence in this project's source-facts model for any language
//     (`references` stays empty everywhere -- see javaAnalyzer.ts's and
//     kotlinAnalyzer.ts's own header comments), so a method-level check
//     would have zero real evidence behind it and would flag nearly every
//     method with equal (lack of) signal -- pure noise. This mirrors the
//     existing Python check's own "methods are excluded entirely" rule
//     exactly (see above), just extended to two more languages. This also
//     conservatively covers Java constructors without needing a dedicated
//     constructor detector, since javaAnalyzer.ts represents constructors
//     as kind "method" too.
//   - Kotlin top-level `fun` declarations (kind "function") ARE
//     considered, the direct analogue of Python's module-level `def` --
//     but Java has no equivalent (every Java method lives inside a
//     class/interface/enum), so only class/interface/enum kinds are
//     considered for Java.
//
// `exported` already folds Java's public/protected/private/package-private
// and Kotlin's public/internal/protected/private visibility into a single
// boolean (see both analyzers' "Visibility mapping" header comments) --
// exported (public) declarations are skipped entirely here, since a public
// API is expected to be used from outside the scanned file set and this
// scan has no way to see that.
function findPossiblyUnreferencedJvmDeclarations(ctx: AuditDetectorContext): AuditIssue[] {
  if (!ctx.sourceFacts) return [];
  const index = indexSourceFactsByPath(ctx.sourceFacts);

  // Cross-file "this simple name was imported somewhere" signal, combined
  // across Java and Kotlin since either language can import the other in a
  // mixed JVM project -- the strongest signal this conservative scan can
  // offer, same role as Python's importedNamesAcrossProject above.
  const importedSimpleNamesAcrossProject = new Set<string>();
  for (const facts of index.values()) {
    if (facts.language !== "java" && facts.language !== "kotlin") continue;
    for (const imp of facts.imports) {
      if (facts.kit ? qualifyKitImportPredicate(facts, imp) !== "QUALIFIED_POSITIVE" : facts.parseStatus !== "parsed") continue;
      importedSimpleNamesAcrossProject.add(jvmImportSimpleName(imp.source));
    }
  }

  const issues: AuditIssue[] = [];
  for (const facts of index.values()) {
    if (facts.language !== "java" && facts.language !== "kotlin") continue;
    if (facts.role !== "source" || facts.parseStatus !== "parsed") continue;

    for (const decl of facts.declarations) {
      if (decl.kind === "method") continue; // methods/constructors -- see header comment
      if (facts.language === "java" && decl.kind === "function") continue; // never produced by javaAnalyzer.ts, defensive
      if (decl.exported || decl.exportState === "unknown") continue; // unknown accessibility cannot establish nonpublic candidacy
      if (isJvmLifecycleOrConventionalDeclarationName(decl.name)) continue;
      if (importedSimpleNamesAcrossProject.has(decl.name)) continue;

      const languageLabel = facts.language === "java" ? "Java" : "Kotlin";
      issues.push(
        makeCodeRotIssue({
          auditType: "code-rot",
          detectorId: DETECTOR_ID,
          idCues: [`unreferenced-${facts.language}-declaration`, facts.relativePath, decl.kind, decl.name],
          title: `${languageLabel} ${decl.kind} "${decl.name}" in "${facts.relativePath}" has no detected cross-file import (weak signal)`,
          description: `"${decl.name}" (${decl.kind}) is declared in "${facts.relativePath}" and is not exported/public, and does not appear as an imported simple name in any other scanned Java/Kotlin file. This is a deterministic static source-facts signal from a conservative, non-semantic scan -- no compiler/classpath analysis was performed, and no Gradle/Maven execution was performed, so this cannot see reflection-based access, dependency-injection wiring, framework/plugin discovery, or usage from outside the scanned project. It may indicate a candidate for removal but is not proof. Confirm manually before removing.`,
          severity: "info",
          confidence: "low",
          falsePositiveRisk: "high",
          category: "dead-code-candidate",
          recommendedAction: "Confirm the declaration is genuinely unused before removing it.",
          suggestedFixStrategy: `Remove "${decl.name}" from "${facts.relativePath}" if confirmed unused, or reference it from another module.`,
          validationCommands: ["npm run audit -- --types code-rot --include cli"],
          releaseBlocking: false,
          implementationBlocking: false,
          autoFixEligible: false,
          evidence: [
            {
              kind: "reference",
              message: `Source facts: the ${languageLabel} analyzer parsed this file and found no other scanned Java/Kotlin file importing the simple name "${decl.name}". Static-analysis limitation -- confidence reduced because this scan cannot see reflection/DI usage, framework discovery, or usage outside the scanned file set, and no compiler/classpath analysis was performed.`,
              filePath: facts.relativePath,
              source: DETECTOR_ID,
              confidence: "low",
            },
          ],
          affectedFiles: [facts.relativePath],
        })
      );
    }
  }
  return issues;
}

function findOldOrDeprecatedFilesNotInDocs(ctx: AuditDetectorContext, docsConcat: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const file of ctx.inventory.files) {
    const segments = file.relativePath.split("/");
    const hasOldSegment = segments.slice(0, -1).some((seg) => OLD_DIR_SEGMENT_PATTERN.test(seg));
    if (!hasOldSegment) continue;
    if (docsConcat.includes(file.relativePath) || docsConcat.includes(path.basename(file.relativePath))) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["old-deprecated-file-not-in-docs", file.relativePath],
        title: `File under an old/deprecated/legacy directory is not mentioned in docs: "${file.relativePath}"`,
        description: `"${file.relativePath}" sits under a directory named old/deprecated/legacy/_archive, and no doc file mentions its path or basename. This is a candidate for dead code.`,
        severity: "medium",
        confidence: "medium",
        falsePositiveRisk: "low",
        category: "dead-code-candidate",
        recommendedAction: "Confirm the file is genuinely obsolete, then remove it or document why it is retained.",
        suggestedFixStrategy: `Remove "${file.relativePath}" or add a doc note explaining why it is kept.`,
        validationCommands: ["npm run audit -- --types code-rot --include cli"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: "File is under an old/deprecated/legacy/_archive-named directory and is not mentioned in any doc file.",
            filePath: file.relativePath,
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: [file.relativePath],
      })
    );
  }
  return issues;
}

function findOrphanedGeneratedFiles(files: readonly InventoryFileEntry[]): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const file of files) {
    if (file.likelyGenerated) continue; // already caught by inventory's own generated category
    if (!ORPHAN_GENERATED_PATTERN.test(path.basename(file.relativePath))) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["orphaned-generated-looking-file", file.relativePath],
        title: `Orphaned generated-looking file: "${file.relativePath}"`,
        description: `"${file.relativePath}" has a generated/backup-looking name (.generated., .bak, .orig) but is not classified as generated content by the project inventory. This is a candidate for dead code.`,
        severity: "low",
        confidence: "medium",
        falsePositiveRisk: "medium",
        category: "dead-code-candidate",
        recommendedAction: "Confirm the file is stale generated/backup content, then remove it.",
        suggestedFixStrategy: `Remove "${file.relativePath}" if confirmed stale.`,
        validationCommands: ["npm run audit -- --types code-rot --include cli"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: "Filename matches a generated/backup-looking pattern outside the inventory's own generated-file classification.",
            filePath: file.relativePath,
            source: DETECTOR_ID,
            confidence: "medium",
          },
        ],
        affectedFiles: [file.relativePath],
      })
    );
  }
  return issues;
}

// Housed here (not in testRotDetector.ts) per the Batch 4 spec's explicit
// instruction to implement this check exactly once to avoid duplicate
// reporting between the two detectors.
async function findUnreferencedFixtures(ctx: AuditDetectorContext): Promise<AuditIssue[]> {
  const fixtureFiles = ctx.inventory.files.filter((f) => f.relativePath.includes("/fixtures/") || f.relativePath.startsWith("fixtures/"));
  if (fixtureFiles.length === 0) return [];

  const tests = ctx.inventory.testFiles.filter(test => test.sizeBytes <= MAX_READ_BYTES);
  // An inventory-qualified empty test domain needs no source query.
  const reader = ctx.kitSourceReader!;
  if (tests.length && !reader) throw new KitSourceEvidenceAcquisitionError("invalid-request", "Required fixture-reference test needs its validated Kit reader.");
  const referenced = new Set<string>();
  const basenames = new Set(fixtureFiles.map(fixture => path.basename(fixture.relativePath)));
  const gaps = new Map<string, { file: string; reason: string }[]>();
  const unsupported = new Map(tests.map(test => [test.relativePath, reader.unsupportedRawContentReason?.(test.relativePath)]));
  const cannotContainBasename = new Map<string, InventoryFileEntry[]>();
  const exactByteAbsences = new Map<string, InventoryFileEntry[]>();
  // Positive references discharge this heuristic without a negative premise
  // about other inputs. Partial reference inventories may supply witnesses.
  for (const test of tests) {
    if (unsupported.get(test.relativePath)) continue;
    for (const base of reader.fixtureReferenceBasenames?.(test.relativePath) ?? []) {
      if (basenames.has(base)) referenced.add(base);
    }
  }
  const pending: typeof tests = [];
  const contentGaps = new Map<string, string>();
  const authenticatedFixtures: typeof tests = [];
  const verifiedRawFixtures = new Set<string>();
  const readContent = reader?.authenticatedFixtureContent ?? reader?.authenticatedContent;
  for (const test of tests) {
    if (referenced.size === basenames.size) break;
    const unsupportedRaw = unsupported.get(test.relativePath);
    let content: string | undefined;
    if (!unsupportedRaw && readContent) {
      try { content = await readContent(test.relativePath); }
      catch (error) {
        if (!(error instanceof KitSourceEvidenceAcquisitionError) || error.category !== "capability-insufficient") throw error;
        if (reader.authenticatedFixtureContent) contentGaps.set(test.relativePath, error.message);
        if (!reader.authenticatedFixtureContent && test.relativePath.endsWith(".json") && reader.jsonRawLiteralContent === "selected-test-json-v1") {
          // Existing Kit windows supply positive observations even when their
          // inventory is truncated. Full raw context still needs the byte hash.
          const probe = await reader.occurrences(test.relativePath, '"');
          for (const match of probe.matches) for (const base of basenames) {
            if (match.content.includes(base)) referenced.add(base);
          }
          try { content = await readContent(test.relativePath); }
          catch (error) {
            if (!(error instanceof KitSourceEvidenceAcquisitionError) || error.category !== "capability-insufficient") throw error;
          }
        }
      }
    }
    if (content === undefined) {
      content = reader.authenticatedRawTestContent?.(test.relativePath);
      if (content !== undefined) verifiedRawFixtures.add(test.relativePath);
    }
    if (content === undefined) pending.push(test);
    else {
      const bytes = verifiedRawFixtures.has(test.relativePath) ? Buffer.from(content, "utf8") : undefined;
      for (const base of basenames) {
        if (bytes ? bytes.includes(base, 0, "utf8") : content.includes(base)) referenced.add(base);
      }
      if (reader.authenticatedFixtureContent) authenticatedFixtures.push(test);
    }
  }
  // Exhaust independent bulk positives before expanding a shared negative
  // premise into candidate-specific missing-source obligations.
  for (const test of pending) {
    const unsupportedRaw = unsupported.get(test.relativePath);
    for (const base of basenames) {
      if (referenced.has(base)) continue;
      // A literal in lossless UTF-8 needs at least its own byte length.
      // The reader has checked the unavailable input's selected byte size.
      if (unsupportedRaw && Buffer.byteLength(base, "utf8") > test.sizeBytes) {
        const inputs = cannotContainBasename.get(base) ?? [];
        inputs.push(test);
        cannotContainBasename.set(base, inputs);
        continue;
      }
      try {
        if (unsupportedRaw) {
          // This predicate compares a literal basename. No decoded line,
          // parser result, or runtime context is needed for this comparison.
          const proof = await reader.byteOccurrences?.(test.relativePath, Buffer.from(base, "utf8").toString("hex"));
          if (proof?.matches.length) {
            referenced.add(base);
            continue;
          }
          if (proof?.complete && proof.matchCount === 0) {
            const inputs = exactByteAbsences.get(base) ?? [];
            inputs.push(test);
            exactByteAbsences.set(base, inputs);
            continue;
          }
          throw new KitSourceEvidenceAcquisitionError("capability-insufficient", unsupportedRaw);
        }
        if (reader.authenticatedFixtureContent) {
          throw new KitSourceEvidenceAcquisitionError("capability-insufficient",
            contentGaps.get(test.relativePath) ?? "No complete authenticated fixture content for this selected test input.");
        }
        const result = await reader.occurrences(test.relativePath, base);
        if (result.matches.length > 0) {
          for (const match of result.matches) for (const candidate of basenames) {
            if (match.content.includes(candidate)) referenced.add(candidate);
          }
          referenced.add(base);
        } else requireCompleteKitOccurrence(result);
      } catch (error) {
        if (!(error instanceof KitSourceEvidenceAcquisitionError) || error.category !== "capability-insufficient" || !ctx.reportUnavailable) throw error;
        const entries = gaps.get(base) ?? [];
        entries.push({ file: test.relativePath, reason: error.message });
        gaps.set(base, entries);
      }
    }
  }
  for (const test of authenticatedFixtures) {
    for (const base of basenames) {
      if (referenced.has(base)) continue;
      ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "fixture literal absence " + base,
        source: { kind: "file", identity: test.relativePath }, capability: "raw-content",
        actualStatus: "complete", status: "QUALIFIED", mandatory: true, diagnostic: "",
        reason: verifiedRawFixtures.has(test.relativePath)
          ? "Exact basename is absent from complete lossless UTF-8 bytes verified against the selected Kit file hash."
          : test.relativePath.endsWith(".json")
            ? "Exact basename is absent from the complete, hash-verified Kit occurrence windows."
            : "Exact basename is absent from the complete, hash-verified Kit source ranges.",
        proof: { kind: verifiedRawFixtures.has(test.relativePath) ? "exact-literal-byte" : "authenticated-source-ranges",
          snapshotId: reader.snapshotId, references: [test.relativePath, base] },
      });
    }
  }
  const unavailable = new Set<string>();
  for (const fixture of fixtureFiles) {
    const base = path.basename(fixture.relativePath);
    if (referenced.has(base)) {
      ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "unreferenced-fixture " + fixture.relativePath,
        source: { kind: "domain", identity: "selected bounded test inputs" }, capability: "raw-content",
        actualStatus: "positive-witness", status: "QUALIFIED", mandatory: true, diagnostic: "",
        reason: "An authenticated basename reference discharges the fixture-absence heuristic; other inputs need not establish absence." });
      continue;
    }
    for (const gap of gaps.get(base) ?? []) {
      unavailable.add(fixture.relativePath);
      ctx.reportUnavailable!(DETECTOR_ID, "unreferenced-fixture " + fixture.relativePath, gap.file, gap.reason, "raw-content");
    }
    for (const test of exactByteAbsences.get(base) ?? []) {
      ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "unreferenced-fixture " + fixture.relativePath,
        source: { kind: "file", identity: test.relativePath }, capability: "raw-content",
        actualStatus: "complete", status: "QUALIFIED", mandatory: true, diagnostic: "",
        reason: "The exact UTF-8 basename has zero matches in the complete authenticated byte scan of this selected input.",
        proof: { kind: "exact-literal-byte", snapshotId: reader.snapshotId, references: [test.relativePath, base] },
      });
    }
    for (const test of cannotContainBasename.get(base) ?? []) {
      ctx.reportCoverage?.({ detectorId: DETECTOR_ID, predicate: "unreferenced-fixture " + fixture.relativePath,
        source: { kind: "file", identity: test.relativePath }, capability: "raw-content",
        actualStatus: "unavailable", status: "NOT_APPLICABLE", mandatory: false, diagnostic: "",
        reason: `The literal basename needs ${Buffer.byteLength(base, "utf8")} UTF-8 bytes and the selected input is only ${test.sizeBytes} bytes.` });
    }
  }

  const issues: AuditIssue[] = [];
  for (const fixture of fixtureFiles) {
    const base = path.basename(fixture.relativePath);
    if (referenced.has(base) || unavailable.has(fixture.relativePath)) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: ["unreferenced-fixture", fixture.relativePath],
        title: `Fixture "${fixture.relativePath}" is not referenced by any test file`,
        description: `"${fixture.relativePath}" is under a fixtures/ directory, but its basename does not appear in any test file's content. This is a weak candidate signal for an unused fixture.`,
        severity: "info",
        confidence: "low",
        falsePositiveRisk: "high",
        category: "dead-code-candidate",
        recommendedAction: "Confirm the fixture is genuinely unused before removing it.",
        suggestedFixStrategy: `Remove "${fixture.relativePath}" if confirmed unused.`,
        validationCommands: ["npm run audit -- --types code-rot --include tests"],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "observation",
            message: "Fixture basename does not appear in any test file's bounded content scan.",
            filePath: fixture.relativePath,
            source: DETECTOR_ID,
            confidence: "low",
          },
        ],
        affectedFiles: [fixture.relativePath],
      })
    );
  }
  return issues;
}
