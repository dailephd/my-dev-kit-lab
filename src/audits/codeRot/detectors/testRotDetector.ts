import fs from "node:fs";
import path from "node:path";
import type { AuditDetector, AuditDetectorContext } from "../../core/auditRegistry.js";
import type { AuditIssue } from "../../core/auditIssue.js";
import type { SourceFileFacts } from "../../core/sourceFacts.js";
import { collectPythonProjectMetadata, type PythonProjectMetadataSnapshot } from "../../core/pythonProjectMetadata.js";
import { collectJvmProjectMetadata, type JvmProjectMetadataSnapshot } from "../../core/jvmProjectMetadata.js";
import { readBoundedFileText } from "../utils/boundedRead.js";
import { baseNameNoExt } from "../utils/filePatternUtils.js";
import { deduplicateIssuesById, makeCodeRotIssue } from "../utils/issueFactories.js";
import { getParsedSourceFacts, indexSourceFactsByPath } from "../utils/sourceFactsLookup.js";
import { splitLines } from "../utils/textLines.js";
import {
  jvmImportCandidatePaths,
  jvmImportLooksPossiblyLocal,
  jvmImportSimpleName,
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
const MAX_READ_BYTES = 200_000;
const RELATIVE_IMPORT_PATTERN = /(?:from|require\()\s*["'](\.\.?\/[^"']+)["']/g;
const NPM_RUN_PATTERN = /npm run ([\w:.-]+)/g;
const SKIP_PATTERN = /\b(describe|it|test)\.skip\s*\(/g;
const ONLY_PATTERN = /\b(describe|it|test)\.only\s*\(/g;
const TEST_TITLE_VERSION_PATTERN = /\b(describe|it|test)\s*\(\s*["'`][^"'`]*\bv(\d+\.\d+\.\d+)\b/;
const HISTORICAL_HEDGE_PATTERN = /\b(regression|historical|legacy)\b/i;
const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs"];
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
  run: (ctx: AuditDetectorContext): AuditIssue[] => {
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

    for (const testFile of ctx.inventory.testFiles) {
      const content = readBoundedFileText(ctx.target.rootPath, testFile.relativePath, testFile.sizeBytes, MAX_READ_BYTES);
      if (content === null) continue;

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
      if (testFile.relativePath.startsWith("tests/audits/codeRot/")) continue;

      issues.push(...findMissingSourceImports(ctx, testFile.relativePath, content));
      // v0.3.1 Batch 4 -- when the TypeScript/JavaScript analyzer actually
      // parsed this test file, also check its structured import facts.
      // This catches import forms the regex above misses (e.g. multi-line
      // import statements) without duplicate-reporting a specifier both
      // checks already found: idCues use the same shape
      // (testRelativePath, "missing-source-import", specifier), so an
      // identical id is deduplicated by deduplicateIssuesById() below.
      const parsedFacts = getParsedSourceFacts(sourceFactsIndex, testFile.relativePath);
      if (parsedFacts?.language === "python") {
        // v0.3.2 Batch 2 -- Python relative imports use dotted-module
        // notation (".module", "..pkg.module"), not TS/JS's path-like
        // "./module" syntax. Routing Python facts through the TS/JS
        // resolver below would misresolve every relative Python import and
        // flag it as missing regardless of whether it actually exists --
        // this guard is the fix for that latent cross-language bug.
        issues.push(...findMissingPythonSourceImports(ctx, testFile.relativePath, parsedFacts, pythonMetadata));
      } else if (parsedFacts?.language === "java" || parsedFacts?.language === "kotlin") {
        // v0.3.3 Batch 2 -- Java/Kotlin imports are fully-qualified dotted
        // package names ("com.example.Foo"), neither TS/JS's path-like
        // "./module" syntax nor Python's dotted-relative-import syntax.
        // Routing them through either existing resolver would misresolve
        // every import -- this guard is the JVM analogue of the Python
        // guard immediately above.
        issues.push(...findMissingJvmSourceImports(ctx, testFile.relativePath, parsedFacts, jvmMetadata));
      } else if (parsedFacts) {
        issues.push(...findMissingSourceImportsFromSourceFacts(ctx, testFile.relativePath, parsedFacts));
      }
      issues.push(...findStaleNpmRunReferences(testFile.relativePath, content, scriptNames));
      issues.push(...findSkipUsage(testFile.relativePath, content));
      issues.push(...findOnlyUsage(testFile.relativePath, content));
      if (currentVersion) issues.push(...findStaleVersionMentions(testFile.relativePath, content, currentVersion));
    }

    if (ctx.config.include.includes("package") && ctx.sourceOfTruth.package) {
      issues.push(...findScriptsReferencingMissingTestPaths(ctx));
    }

    return deduplicateIssuesById(issues);
  },
};

function findMissingSourceImports(ctx: AuditDetectorContext, testRelativePath: string, content: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const testDir = path.dirname(testRelativePath);

  RELATIVE_IMPORT_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(RELATIVE_IMPORT_PATTERN)) {
    const specifier = match[1];
    const resolvedBase = path.join(testDir, specifier).replace(/\\/g, "/");
    const strippedBase = resolvedBase.replace(/\.[cm]?[jt]sx?$/, "");

    const resolved = RESOLVE_EXTENSIONS.some((ext) => fs.existsSync(path.join(ctx.target.rootPath, `${strippedBase}${ext}`)));
    if (resolved) continue;

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
  ctx: AuditDetectorContext,
  testRelativePath: string,
  facts: SourceFileFacts
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const testDir = path.dirname(testRelativePath);

  for (const imp of facts.imports) {
    if (!imp.source.startsWith(".")) continue;
    const resolvedBase = path.join(testDir, imp.source).replace(/\\/g, "/");
    const strippedBase = resolvedBase.replace(/\.[cm]?[jt]sx?$/, "");

    const resolved = RESOLVE_EXTENSIONS.some((ext) => fs.existsSync(path.join(ctx.target.rootPath, `${strippedBase}${ext}`)));
    if (resolved) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [testRelativePath, "missing-source-import", imp.source],
        title: `Test "${testRelativePath}" imports a missing source file: "${imp.source}"`,
        description: `${testRelativePath} imports "${imp.source}" (source-facts-derived via the TypeScript/JavaScript analyzer), which does not resolve to an existing file on disk (checked common TS/JS extensions relative to the test file).`,
        severity: "medium",
        confidence: "high",
        falsePositiveRisk: "low",
        category: "test-rot",
        recommendedAction: "Fix or remove the stale import.",
        suggestedFixStrategy: `Update the import specifier "${imp.source}" in ${testRelativePath} to point to an existing file.`,
        validationCommands: [`npx vitest run ${testRelativePath}`],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: "Analyzer-recorded relative import specifier does not resolve to an existing file.",
            filePath: testRelativePath,
            excerpt: imp.source,
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

// v0.3.2 Batch 2 -- resolves a Python relative-import source (".module",
// "..pkg.sub", or bare "."/".." paired with `from . import name`-style
// imported names) to candidate local file paths, using Python's own
// relative-import level semantics (one leading dot = the importing file's
// own directory, each additional dot = one directory further up). This is a
// conservative, path-based approximation -- it does not resolve namespace
// packages, `sys.path` manipulation, editable installs, or anything beyond
// simple on-disk file/package presence, so returning zero matches is a
// candidate "may indicate a missing module" signal, not proof.
function resolvePythonRelativeImportCandidatePaths(
  testDir: string,
  importSource: string,
  importedNames: readonly string[] | undefined
): string[] {
  if (!importSource.startsWith(".")) return [];

  let dotCount = 0;
  while (dotCount < importSource.length && importSource[dotCount] === ".") dotCount += 1;
  const remainder = importSource.slice(dotCount);
  const upLevels = dotCount - 1;

  let baseDir = testDir;
  for (let i = 0; i < upLevels; i++) baseDir = path.dirname(baseDir);

  const candidates: string[] = [];
  const pushCandidatesFor = (moduleSegment: string) => {
    candidates.push(path.join(baseDir, `${moduleSegment}.py`).replace(/\\/g, "/"));
    candidates.push(path.join(baseDir, moduleSegment, "__init__.py").replace(/\\/g, "/"));
  };

  if (remainder) {
    pushCandidatesFor(remainder.split(".").join("/"));
  } else {
    // Bare "." / ".." (e.g. `from . import sibling`) -- the module lives
    // in `importedNames`, not in `importSource` itself.
    for (const name of importedNames ?? []) pushCandidatesFor(name);
  }
  return candidates;
}

// v0.3.2 Batch 2 -- Python-specific counterpart to
// findMissingSourceImportsFromSourceFacts() above. Only ever called for
// facts with `language === "python"` (see caller) -- the two functions are
// kept fully separate rather than parameterized by language, because their
// resolution algorithms are genuinely different (dotted-module relative-
// import-level semantics vs. path-like specifier semantics), and conflating
// them risked silently misresolving one language or the other. Deliberately
// lower severity/confidence than the TS/JS counterpart: this scan has no
// real package/sys.path awareness, so it is weaker evidence than the
// TS/JS analyzer's near-exact relative-path resolution.
function findMissingPythonSourceImports(
  ctx: AuditDetectorContext,
  testRelativePath: string,
  facts: SourceFileFacts,
  pythonMetadata: PythonProjectMetadataSnapshot
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const testDir = path.dirname(testRelativePath);

  for (const imp of facts.imports) {
    if (!imp.source.startsWith(".")) continue; // conservative: only relative Python imports are checked
    const candidates = resolvePythonRelativeImportCandidatePaths(testDir, imp.source, imp.importedNames);
    if (candidates.length === 0) continue; // nothing checkable (e.g. bare "." with no imported names)

    const resolved = candidates.some((candidate) => fs.existsSync(path.join(ctx.target.rootPath, candidate)));
    if (resolved) continue;

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

// v0.3.3 Batch 2 -- Java/Kotlin-specific counterpart to
// findMissingSourceImportsFromSourceFacts()/findMissingPythonSourceImports()
// above. Only ever called for facts with `language === "java"` or
// `"kotlin"` (see caller) -- kept fully separate from both existing
// resolvers for the same reason the Python resolver is kept separate from
// the TS/JS one: the resolution algorithm (fully-qualified dotted package
// names -> conventional Gradle/Maven source-set paths) is genuinely
// different from either.
//
// Deliberately lower severity/confidence than the TS/JS counterpart, same
// tier as the Python counterpart: this scan has no real classpath/build
// awareness (no Gradle/Maven execution, no compiler), so it is weaker
// evidence than the TS/JS analyzer's near-exact relative-path resolution.
// Standard-library, common third-party test-framework, and wildcard
// imports are skipped entirely via jvmImportLooksPossiblyLocal() -- see
// jvmSourceFactsUtils.ts for the full skip-prefix list and rationale.
function findMissingJvmSourceImports(
  ctx: AuditDetectorContext,
  testRelativePath: string,
  facts: SourceFileFacts,
  jvmMetadata: JvmProjectMetadataSnapshot
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const isKotlin = facts.language === "kotlin";
  const languageLabel = isKotlin ? "Kotlin" : "Java";
  // Kotlin may legitimately import Java source in a mixed JVM project;
  // Java never imports Kotlin-only source through a plain `import`
  // statement in the way this conservative scan can see, so a Java test
  // only ever checks .java candidates.
  const extensions = isKotlin ? ["kt", "java"] : ["java"];
  // Both recognized main and test source-set directories are checked --
  // the latter specifically covers the "importing a test-scoped helper
  // from another test-set file" case (the importing file here is, by
  // definition, already test-scoped, since this function is only ever
  // called from the per-test-file loop above).
  const candidateDirs = [...jvmMetadata.recognizedSourceDirectories, ...jvmMetadata.recognizedTestDirectories];
  const inventoryBasenameIndex = buildJvmInventoryBasenameIndex(ctx, extensions);

  for (const imp of facts.imports) {
    if (!jvmImportLooksPossiblyLocal(imp)) continue;

    // A Java `import static com.example.Foo.bar;` (or a Kotlin top-level
    // member import) has its *member* name as the last dotted segment, not
    // a class name -- this analyzer's ImportFact model (shared across
    // every language) does not distinguish "static import of a member"
    // from "plain class import", so both interpretations are tried: the
    // full dotted path as-is (the common, plain-class-import case), and
    // with its last segment dropped (the static/member-import case). This
    // is a detector-side fix, not a change to javaAnalyzer.ts/
    // kotlinAnalyzer.ts's ImportFact shape.
    const parentSource = imp.source.includes(".") ? imp.source.slice(0, imp.source.lastIndexOf(".")) : null;

    const conventionalCandidates = [
      ...jvmImportCandidatePaths(imp.source, candidateDirs, extensions),
      ...(parentSource ? jvmImportCandidatePaths(parentSource, candidateDirs, extensions) : []),
    ];
    const resolved =
      conventionalCandidates.some((candidate) => fs.existsSync(path.join(ctx.target.rootPath, candidate))) ||
      inventoryBasenameIndex.has(jvmImportSimpleName(imp.source)) ||
      (parentSource !== null && inventoryBasenameIndex.has(jvmImportSimpleName(parentSource)));
    if (resolved) continue;

    const evidence: AuditIssue["evidence"] = [
      {
        kind: "file",
        message: `Analyzer-recorded ${languageLabel} import does not resolve to a candidate local source file under a recognized source-set directory, nor to any inventoried file with a matching basename. This is a best-effort, path-based check -- no compiler/classpath analysis was performed, and no Gradle/Maven execution was performed, so confirm manually before treating it as stale.`,
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
        title: `Test "${testRelativePath}" imports a ${languageLabel} class that may not exist: "${imp.source}"`,
        description: `${testRelativePath} imports "${imp.source}" (source-facts-derived via the ${languageLabel} analyzer). No candidate local source file was found under a recognized source-set directory, and no inventoried file shares its simple name. This is a deterministic source-facts signal from a conservative, non-semantic scan -- no compiler/classpath analysis was performed, and no Gradle/Maven execution was performed, so this does not resolve the real classpath, package visibility, or multi-module project layout. It may indicate a stale import but is not proof.`,
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

// Lowercased-basename index (without extension) of every inventoried
// Java/Kotlin file matching the given extensions -- the lenient,
// last-resort fallback used by findMissingJvmSourceImports() above so a
// real (if unconventionally placed) local file is never flagged as
// missing merely because the project doesn't follow the conventional
// src/main/{java,kotlin} source-set layout (mirrors
// jvmProjectMetadata.ts's own "non-conventional layout" reasoning).
function buildJvmInventoryBasenameIndex(ctx: AuditDetectorContext, extensions: readonly string[]): Set<string> {
  const extSet = new Set(extensions.map((e) => `.${e}`));
  const basenames = new Set<string>();
  for (const file of ctx.inventory.files) {
    if (!extSet.has(file.extension)) continue;
    basenames.add(baseNameNoExt(file.relativePath));
  }
  return basenames;
}

function findStaleNpmRunReferences(testRelativePath: string, content: string, scriptNames: Set<string>): AuditIssue[] {
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
  const lines = splitLines(content);
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

function findSkipUsage(testRelativePath: string, content: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const lines = splitLines(content);
  for (let i = 0; i < lines.length; i++) {
    SKIP_PATTERN.lastIndex = 0;
    const match = SKIP_PATTERN.exec(lines[i]);
    if (!match) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [testRelativePath, "skip-usage", String(i + 1)],
        title: `Committed "${match[1]}.skip(" in "${testRelativePath}"`,
        description: `${testRelativePath}:${i + 1} uses "${match[1]}.skip(" -- confirm this is intentional and not accidentally committed.`,
        severity: "medium",
        confidence: "high",
        falsePositiveRisk: "low",
        category: "test-rot",
        recommendedAction: "Remove .skip if the test should run, or add a comment explaining why it is skipped.",
        suggestedFixStrategy: `Remove "${match[1]}.skip(" at ${testRelativePath}:${i + 1} or document why it is intentionally skipped.`,
        validationCommands: [`npx vitest run ${testRelativePath}`],
        releaseBlocking: false,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: `Found "${match[1]}.skip(" usage.`,
            filePath: testRelativePath,
            line: i + 1,
            excerpt: lines[i].trim().slice(0, 200),
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

function findOnlyUsage(testRelativePath: string, content: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const lines = splitLines(content);
  for (let i = 0; i < lines.length; i++) {
    ONLY_PATTERN.lastIndex = 0;
    const match = ONLY_PATTERN.exec(lines[i]);
    if (!match) continue;

    issues.push(
      makeCodeRotIssue({
        auditType: "code-rot",
        detectorId: DETECTOR_ID,
        idCues: [testRelativePath, "only-usage", String(i + 1)],
        title: `Committed "${match[1]}.only(" in "${testRelativePath}"`,
        description: `${testRelativePath}:${i + 1} uses "${match[1]}.only(" -- this silently excludes every other test in a CI run and is almost always accidental.`,
        severity: "high",
        confidence: "high",
        falsePositiveRisk: "low",
        category: "test-rot",
        recommendedAction: "Remove .only before committing/merging.",
        suggestedFixStrategy: `Remove "${match[1]}.only(" at ${testRelativePath}:${i + 1}.`,
        validationCommands: [`npx vitest run ${testRelativePath}`],
        releaseBlocking: true,
        implementationBlocking: false,
        autoFixEligible: false,
        evidence: [
          {
            kind: "file",
            message: `Found "${match[1]}.only(" usage.`,
            filePath: testRelativePath,
            line: i + 1,
            excerpt: lines[i].trim().slice(0, 200),
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
