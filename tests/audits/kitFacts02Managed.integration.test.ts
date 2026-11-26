import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runAuditCommandFromArgs } from "../../src/commands/runAuditCommand.js";
import type { AuditPredicateCoverage } from "../../src/audits/core/auditRegistry.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import {
  collectKitSourceFacts, resolveQualifiedKitArchive, type KitSourceReader,
} from "../../src/audits/core/kitSourceProvider.js";

const archive = process.env.LAB_FACTS02_KIT_ARCHIVE;
const packageRoot = process.env.LAB_FACTS02_KIT_PACKAGE_ROOT;
if (!!archive !== !!packageRoot) throw new Error("Set both LAB_FACTS02_KIT_ARCHIVE and LAB_FACTS02_KIT_PACKAGE_ROOT.");
const exact = it.skipIf(!archive && !packageRoot);
const candidate = () => resolveQualifiedKitArchive(archive!, packageRoot!);

function subject(name: string, files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-facts02-" + name + "-"));
  const target = path.join(root, "target");
  for (const [relative, content] of Object.entries({
    "package.json": '{"name":"facts02-subject","version":"1.0.0","type":"module"}',
    "CHANGELOG.md": "# Changelog\n\n## v1.0.0 — Initial entry\n",
    ...files,
  })) {
    const file = path.join(target, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return { root, target };
}

const wrapper = 'import { test as base } from "@playwright/test";\nexport const test = base.extend({});\n';
const conditionalSkip = 'test.skip(process.env.FLAG === "1", "intentional review");';
const only = 'test.only("independent review", () => {});';

async function nativeAudit(
  fixture: ReturnType<typeof subject>, name: string, threshold: "none" | "medium",
) {
  const workspace = path.join(fixture.root, name);
  fs.mkdirSync(workspace);
  const exit = await runAuditCommandFromArgs([
    "--target", fixture.target, "--types", "code-rot", "--include", "docs,tests,package,architecture,cli",
    "--format", "json,text", "--fail-on", threshold, "--kit-archive", archive!, "--kit-package-root", packageRoot!,
  ], { evidenceWorkspace: workspace });
  const receipts = path.join(workspace, "lab-output", "evidence");
  const [id] = fs.readdirSync(receipts);
  const receipt = path.join(receipts, id!);
  const { evidence } = JSON.parse(fs.readFileSync(path.join(receipt, "audit-result.json"), "utf8"));
  return {
    exit, receipt, coverage: evidence.coverage as AuditPredicateCoverage[],
    ids: (evidence.issues as { id: string }[]).map(issue => issue.id),
  };
}

exact("exact FACTS02: raw-only vendor and generated files reach readers and detectors", async () => {
  const vendor = "vendor/library.mjs";
  const generated = "generated/schema.mjs";
  const rawFiles = {
    [vendor]: 'export const vendorMarker = "vendor";\n',
    [generated]: 'export const generatedMarker = "generated";\n' + "// raw-limit\n".repeat(205),
  };
  const fixture = subject("raw-only", {
    ...rawFiles,
    "src/peer.mjs": "export const peer = 1;\n",
    "tests/entry.test.mjs": 'import "../src/peer.mjs";\n',
  });
  const inventory = scanProjectInventory(fixture.target);
  expect(inventory.files.filter(file => file.relativePath in rawFiles).map(file => file.role).sort())
    .toEqual(["generated", "vendor"]);
  let reader: KitSourceReader | undefined;
  const snapshot = await collectKitSourceFacts({
    targetRoot: fixture.target, inventory, requiredCapabilities: [], includeScriptsRoot: false,
    requiredPaths: [vendor, generated], capabilitiesForPath: () => [],
    onReader: value => { reader = value; },
  }, { ...candidate(), workDir: path.join(fixture.root, "raw-reader") });
  try {
    expect(snapshot.files.some(file => file.relativePath in rawFiles)).toBe(false);
    for (const [file, anchor] of [[vendor, "vendorMarker"], [generated, "generatedMarker"]] as const) {
      expect(reader!.selectedFile(file)).toMatchObject({
        status: "parsed", sizeBytes: Buffer.byteLength(rawFiles[file]), lineCount: expect.any(Number),
        contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(await reader!.occurrences(file, anchor)).toMatchObject({ complete: true, truncated: false, matchCount: 1 });
      expect(await reader!.authenticatedFixtureContent!(file)).toBe(rawFiles[file]);
    }
    expect(await reader!.occurrences(generated, "raw-limit")).toMatchObject({
      complete: false, truncated: true, matchCount: 205, returnedMatches: 200, reasonCode: "MATCHES_TRUNCATED",
    });
    expect(() => reader!.selectedFile("../vendor/library.mjs")).toThrow();
    fs.writeFileSync(path.join(fixture.target, vendor), rawFiles[vendor].replace("vendor\"", "edited\""));
    await expect(reader!.occurrences(vendor, "vendorMarker")).rejects.toMatchObject({ category: "stale-evidence" });
  } finally {
    fs.writeFileSync(path.join(fixture.target, vendor), rawFiles[vendor]);
    await reader?.dispose();
  }
  const native = await nativeAudit(fixture, "none", "none");
  expect(native.exit).toBe(0);
  const artifact = JSON.parse(fs.readFileSync(path.join(native.receipt, "kit-selection.json"), "utf8"));
  expect(artifact.evidence.inventory.map((file: { path: string }) => file.path)).toEqual(expect.arrayContaining([vendor, generated]));
  expect(native.coverage.some(row => row.capability === "imports" && row.mandatory && row.source.identity in rawFiles)).toBe(false);
}, 60_000);

exact("exact FACTS02: conditioned Playwright skip survives complete exit 0 and threshold exit 1", async () => {
  const fixture = subject("complete", {
    "src/peer.mjs": "export const peer = 1;\n",
    "tests/wrapper.mjs": wrapper,
    "tests/entry.test.mjs": [
      'import { test } from "./wrapper.mjs";',
      'import { peer } from "../src/peer.mjs";',
      'const destination = "../src/peer.mjs";',
      "void import(destination);",
      conditionalSkip,
      'test("checks the peer", () => { if (peer !== 1) throw new Error("unexpected peer"); });',
    ].join("\n"),
  });
  const expectedIds = ["test-rot:tests/entry.test.mjs:skip-usage:5"];
  const complete = await nativeAudit(fixture, "none", "none");
  expect(complete.exit).toBe(0);
  expect(complete.ids).toEqual(expectedIds);
  const threshold = await nativeAudit(fixture, "threshold", "medium");
  expect(threshold.exit).toBe(1);
  expect(threshold.ids).toEqual(expectedIds);
}, 60_000);

exact.each([false, true])("exact FACTS02: accounted expression-only imports with unknown sibling %s", async unknown => {
  const origin = "tests/entry.test.mjs";
  const fixture = subject("expression-accounting", {
    "src/peer.mjs": "export const peer = 1;\n",
    "tests/wrapper.mjs": wrapper,
    [origin]: [
      'import { test } from "./wrapper.mjs";',
      'import { peer } from "../src/peer.mjs";',
      'const prefix = "../src/";',
      'void import(prefix + "peer.mjs");',
      conditionalSkip,
      'test("checks the peer", () => { if (peer !== 1) throw new Error("unexpected peer"); });',
    ].join("\n"),
    ...(unknown ? {
      "src/unwitnessed.mjs": "export const value = 1;\n",
      "tests/unknown.test.mjs": "void import(process.env.DESTINATION);\n",
    } : {}),
  });
  const outcome = await nativeAudit(fixture, "none", "none");
  expect(outcome.exit).toBe(unknown ? 2 : 0);
  expect(outcome.ids).toContain("test-rot:tests/entry.test.mjs:skip-usage:5");
  const expressionFactId = "audit-fact:tests%2Fentry.test.mjs#dynamic-import-expression#4#5#0";
  const source = { kind: "file", identity: origin };
  expect(outcome.coverage).toContainEqual(expect.objectContaining({
    detectorId: "dead-code-candidate", predicate: "imports evidence", source, capability: "imports",
    status: "QUALIFIED", actualStatus: "partial", mandatory: true,
    proof: expect.objectContaining({ kind: "import-domain", references: [expressionFactId] }),
  }));
  expect(outcome.coverage).toContainEqual(expect.objectContaining({
    detectorId: "test-rot", predicate: "missing-source-import", source, status: "QUALIFIED",
    proof: expect.objectContaining({ references: [expressionFactId, "src/peer.mjs"] }),
  }));
  if (unknown) {
    expect(outcome.coverage).toContainEqual(expect.objectContaining({
      detectorId: "dead-code-candidate", predicate: "unreferenced-source-file blocked candidate",
      source: { kind: "file", identity: "src/unwitnessed.mjs" }, status: "UNDETERMINED",
    }));
  }
}, 60_000);

exact("exact FACTS02: unknown expressions preserve mandatory exit 2 and independent findings", async () => {
  const fixture = subject("incomplete", {
    "src/peer.mjs": "export const peer = 1;\n",
    "tests/entry.test.mjs": [
      'import { test } from "@playwright/test";',
      'import "../src/gone.mjs";',
      'const destination = "../src/peer.mjs";',
      "void import(destination);",
      'void import(process.env.RUNTIME_DESTINATION);',
      only,
    ].join("\n"),
  });
  const outcome = await nativeAudit(fixture, "none", "none");
  expect(outcome.exit).toBe(2);
  expect(outcome.ids).toEqual(expect.arrayContaining([
    "test-rot:tests/entry.test.mjs:missing-source-import:../src/gone.mjs",
    "test-rot:tests/entry.test.mjs:only-usage:6",
  ]));
  expect(outcome.coverage).toContainEqual(expect.objectContaining({
    predicate: "missing-source-import", mandatory: true,
    reason: expect.stringMatching(/dynamic|expression|runtime/i),
  }));
  expect(outcome.coverage).toContainEqual(expect.objectContaining({
    detectorId: "test-rot", predicate: "imports evidence", actualStatus: "partial", status: "QUALIFIED",
    source: { kind: "file", identity: "tests/entry.test.mjs" },
  }));
}, 60_000);

exact.each(["standalone", "batch", "stream"] as const)(
  "exact FACTS02: negotiated runner evidence through %s",
  async transport => {
    const fixture = subject(transport, {
      "tests/direct.spec.ts": 'import { test } from "@playwright/test";\n' + conditionalSkip + "\n",
      "tests/local.spec.ts": 'import { test as base } from "@playwright/test";\nconst test = base.extend({});\n' + only + "\n",
      "tests/imported.spec.ts": 'import { test } from "./support/fixture";\n' + conditionalSkip + "\n",
      "tests/support/fixture.ts": wrapper,
      "tests/partial.spec.ts": 'import { test } from "@playwright/test";\n' + only + '\ntest["skip"](flag);\n',
      "tests/unsupported.spec.ts": 'import type { test } from "@playwright/test";\ntest.skip(flag);\n',
    });
    let reader: KitSourceReader | undefined;
    const launches: string[] = [];
    await collectKitSourceFacts({
      targetRoot: fixture.target, inventory: scanProjectInventory(fixture.target),
      requiredCapabilities: [], includeScriptsRoot: false, onReader: current => { reader = current; },
    }, {
      ...candidate(), workDir: path.join(fixture.root, "kit"),
      disableStream: transport !== "stream", disableBatch: transport === "standalone",
      onKitLaunch: event => launches.push(JSON.stringify(event)),
    });
    try {
      expect(reader!.testModifierProof!("tests/direct.spec.ts")).toMatchObject({
        coverage: "complete", runnerBinding: { kind: "direct-playwright" },
        observations: [{ modifier: "skip", calleeSpan: { startLine: 2 } }],
      });
      expect(reader!.testModifierProof!("tests/local.spec.ts")).toMatchObject({
        coverage: "complete", runnerBinding: { kind: "local-extended-playwright", baseLocalName: "base" },
        observations: [{ modifier: "only", calleeSpan: { startLine: 3 } }],
      });
      expect(reader!.testModifierProof!("tests/imported.spec.ts")).toMatchObject({
        coverage: "complete", runnerBinding: {
          kind: "imported-extended-playwright", wrapper: { path: "tests/support/fixture.ts" },
        },
        observations: [{ modifier: "skip", calleeSpan: { startLine: 2 } }],
      });
      expect(reader!.testModifierProof!("tests/partial.spec.ts")).toMatchObject({
        coverage: "partial", observations: [{ modifier: "only" }],
      });
      expect(reader!.testModifierProof!("tests/unsupported.spec.ts")).toBeUndefined();
      const wrapperPath = path.join(fixture.target, "tests/support/fixture.ts");
      fs.appendFileSync(wrapperPath, "\n// Changed wrapper premise\n");
      expect(() => reader!.testModifierProof!("tests/imported.spec.ts")).toThrow(/stale-evidence/);
      expect(reader!.testModifierProof!("tests/direct.spec.ts")?.coverage).toBe("complete");
    } finally {
      fs.writeFileSync(path.join(fixture.root, "launches.json"), JSON.stringify(launches, null, 2));
      await reader?.dispose();
    }
  }, 60_000,
);
async function withReader(
  fixture: ReturnType<typeof subject>,
  inspect: (reader: KitSourceReader, files: Awaited<ReturnType<typeof collectKitSourceFacts>>["files"]) => Promise<void>,
  disableStream = false,
) {
  let reader: KitSourceReader | undefined;
  const snapshot = await collectKitSourceFacts({
    targetRoot: fixture.target, inventory: scanProjectInventory(fixture.target), requiredCapabilities: [],
    includeScriptsRoot: false, onReader: current => { reader = current; },
  }, { ...candidate(), workDir: path.join(fixture.root, "kit"), disableStream });
  try {
    await inspect(reader!, snapshot.files);
  } finally {
    await reader?.dispose();
  }
}

exact("exact FACTS02: adapted bindings and ordinary reference domains preserve identities and freshness", async () => {
  const fixture = subject("ordinary", {
    "tsconfig.json": '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}',
    "src/entry.ts": [
      'import "./direct.ts";',
      'import "./extension";',
      'import "./substitute.js";',
      'import "@/alias";',
      'export { value } from "./reexport.ts";',
      'import "./multi";',
      'import "./gone.mjs";',
      'import "../excluded/present.mjs";',
      'import "bare-package";',
      'const destination = "./extension";',
      'export const { a: local, nest: [head], stable } = await import(destination);',
    ].join("\n"),
    "src/direct.ts": "export const value = 1;",
    "src/extension.ts": "export const value = 1;",
    "src/substitute.ts": "export const value = 1;",
    "src/alias.ts": "export const value = 1;",
    "src/reexport.ts": "export const value = 1;",
    "src/multi.js": "export const value = 1;",
    "src/multi.ts": "export const value = 1;",
    "src/broken.ts": "export const { recovered } = (;",
    "excluded/present.mjs": "export const value = 1;",
  });
  await withReader(fixture, async (reader, files) => {
    const entry = files.find(file => file.relativePath === "src/entry.ts")!;
    const declarations = entry.declarations.filter(fact => ["head", "local", "stable"].includes(fact.name));
    expect(declarations.map(fact => fact.name).sort()).toEqual(["head", "local", "stable"]);
    for (const fact of declarations) {
      expect(fact).toMatchObject({ exported: true, provenance: {
        startLine: 11, endLine: 11, startColumn: expect.any(Number), endColumn: expect.any(Number),
      } });
      expect(fact.provenance!.endColumn).toBeGreaterThan(fact.provenance!.startColumn!);
    }
    expect(entry.exports.map(fact => fact.name)).toEqual(expect.arrayContaining(["head", "local", "stable"]));
    expect(reader.selectedFile("src/broken.ts").capabilities.declarations).not.toBe("complete");
    const read = (specifier: string) => reader.importTarget(entry.imports.find(fact => fact.source === specifier)!.provenance!.factId);
    for (const [specifier, target] of [
      ["./direct.ts", "src/direct.ts"], ["./extension", "src/extension.ts"],
      ["./substitute.js", "src/substitute.ts"], ["@/alias", "src/alias.ts"],
    ]) {
      expect(await read(specifier!)).toMatchObject({ qualifiedSourceReferencePath: target });
    }
    const [reexport] = reader.reExportTargets!("src/entry.ts");
    expect(await reader.importTarget(reexport!.id)).toMatchObject({ qualifiedSourceReferencePath: "src/reexport.ts" });
    const multi = await read("./multi");
    expect(multi.selectedTargetUpperBound).toEqual(["src/multi.js", "src/multi.ts"]);
    expect(multi.qualifiedSourceReferencePath).toBeUndefined();
    expect(await read("./gone.mjs")).toMatchObject({ applicableSourceReferenceAbsent: true, selectedTargetUpperBound: [] });
    expect((await read("../excluded/present.mjs")).applicableSourceReferenceAbsent).toBeUndefined();
    expect((await read("bare-package")).qualifiedSourceReferencePath).toBeUndefined();
    for (const [name, specifier] of [
      ["src/direct.ts", "./direct.ts"],
      ["tsconfig.json", "@/alias"],
      ["src/substitute.tsx", "./substitute.js"],
      ["src/entry.ts", "./extension"],
    ]) {
      const file = path.join(fixture.target, name!);
      const before = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
      if (name === "tsconfig.json") fs.writeFileSync(file, '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["missing/*"]}}}');
      else fs.appendFileSync(file, "\n");
      try {
        await expect(read(specifier!)).rejects.toMatchObject({ category: "stale-evidence" });
      } finally {
        if (before) fs.writeFileSync(file, before);
        else fs.unlinkSync(file);
      }
    }
  }, true);
}, 60_000);

exact("exact FACTS02: expression-only and literal-linked observations preserve finite and unknown domains", async () => {
  const origin = "tests/entry.test.mjs";
  const fixture = subject("computed", {
    [origin]: [
      'const prefix = "../src/";',
      'void import(prefix + "peer.mjs");',
      'void import("../src/peer.mjs");',
      'void import(flag ? "../src/peer.mjs" : "../src/other.mjs");',
      'void import("../src/" + "gone.mjs");',
      'void import(process.env.RUNTIME_DESTINATION);',
    ].join("\n"),
    "src/peer.mjs": "export const value = 1;",
    "src/other.mjs": "export const value = 2;",
  });
  await withReader(fixture, async (reader, files) => {
    const entry = files.find(file => file.relativePath === origin)!;
    const linkedImport = entry.imports.find(fact => fact.source === "../src/peer.mjs")!;
    const cases = await reader.expressionDomains!(origin);
    expect(cases).toHaveLength(5);
    expect(cases[0]).toMatchObject({ proof: {
      expressionFactId: "audit-fact:tests%2Fentry.test.mjs#dynamic-import-expression#2#5#0", positivePaths: ["src/peer.mjs"],
    } });
    expect(cases[0]!.linkedImportFactId).toBeUndefined();
    expect(cases[1]).toMatchObject({ linkedImportFactId: linkedImport.provenance!.factId, proof: { positivePaths: ["src/peer.mjs"] } });
    expect(cases[2]!.proof).toMatchObject({ selectedTargetUpperBound: ["src/other.mjs", "src/peer.mjs"], positivePaths: [] });
    expect(cases[3]!.proof.excludesSelectedDomain).toBe(true);
    expect(cases[4]!.proof).toMatchObject({ domainComplete: false, positivePaths: [] });
    expect(reader.explicitImportsCompleteWithExpressions!(origin, entry.imports.length)).toBe(true);
  });
}, 60_000);

exact("exact FACTS02: an unaccounted import inventory still blocks the audit", async () => {
  const origin = "tests/entry.test.mjs";
  const fixture = subject("unaccounted", {
    [origin]: 'require(process.env.RUNTIME_DESTINATION);\nimport "../src/gone.mjs";\n',
    "src/peer.mjs": "export const peer = 1;\n",
  });
  const outcome = await nativeAudit(fixture, "none", "none");
  expect(outcome.exit).toBe(2);
  expect(outcome.ids).toContain("test-rot:tests/entry.test.mjs:missing-source-import:../src/gone.mjs");
  expect(outcome.coverage).toContainEqual(expect.objectContaining({
    source: { kind: "file", identity: origin }, capability: "imports",
    mandatory: true, actualStatus: "partial",
  }));
}, 60_000);

exact("exact FACTS02: published installation cannot substitute for the A5-R1 install", () => {
  const publishedRoot = path.resolve("node_modules/@dailephd/my-dev-kit");
  expect(() => resolveQualifiedKitArchive(archive!, publishedRoot)).toThrow(/package-identity/);
  const originalA5 = path.resolve(path.dirname(archive!), "../../f02-a5/pack", path.basename(archive!));
  expect(fs.statSync(originalA5).isFile()).toBe(true);
  expect(() => resolveQualifiedKitArchive(originalA5, packageRoot!)).toThrow(/does not match a qualified local archive/);
});
exact("exact FACTS02: ambiguous ordinary routes limit candidate-specific reverse-reference gaps", async () => {
  const fixture = subject("candidate-closure", {
    "src/direct.mjs": "export const direct = 1;\n",
    "src/independent.mjs": "export const independent = 1;\n",
    "src/ambiguous.js": "export const ambiguous = 1;\n",
    "src/ambiguous.ts": "export const ambiguous = 2;\n",
    "tests/entry.test.mjs": [
      'import "../src/direct.mjs";', 'import "../src/ambiguous";',
    ].join("\n"),
  });
  const outcome = await nativeAudit(fixture, "none", "none");
  expect(outcome.exit).toBe(2);
  expect(outcome.coverage).toContainEqual(expect.objectContaining({
    predicate: "unreferenced-source-file candidate exclusion", status: "QUALIFIED",
    source: { kind: "file", identity: "src/independent.mjs" },
  }));
  for (const path of ["src/ambiguous.js", "src/ambiguous.ts"]) {
    expect(outcome.coverage).toContainEqual(expect.objectContaining({
      predicate: "unreferenced-source-file blocked candidate", status: "UNDETERMINED",
      source: { kind: "file", identity: path },
    }));
  }
  expect(outcome.ids.some(id => id.includes("src/direct.mjs"))).toBe(false);
}, 60_000);

exact("exact FACTS02: Track C scopes nested commands and recognizes the exact v-prefixed heading", async () => {
  const fixture = subject("track-c", {
    "README.md": '# Commands\n\n`npm --prefix reporting run dashboard-only`\n`npm --prefix absent run unresolved`\n',
    "dashboard/package.json": '{"scripts":{"test:runtime":"node --version","test:visual":"node --version","dashboard-only":"node --version"}}',
    "dashboard/README.md": [
      "# Dashboard", "", "From the repository root:", "", "```powershell", "cd dashboard", "npm ci", "```", "",
      "Run `npm run test:runtime` for runtime checks.", "Run `npm run test:visual` for validation.",
    ].join("\n"),
    "reporting/package.json": '{"scripts":{"test:runtime":"node --version","test:permissions":"node --version"}}',
    "reporting/README.md": [
      "# Reporting", "", "From the repository root:", "", "```powershell", "npm --prefix reporting ci", "```", "",
      "Run `npm run test:runtime` for runtime checks.", "Run `npm run test:permissions` for permissions.",
    ].join("\n"),
    "src/peer.mjs": "export const peer = 1;\n",
    "tests/entry.test.mjs": 'import "../src/peer.mjs";\n',
  });
  const complete = await nativeAudit(fixture, "none", "none");
  expect(complete.exit).toBe(0);
  expect(complete.ids.filter(id => /stale-command-reference|missing-current-version-section/.test(id)))
    .toEqual(["stale-command-reference:README.md:missing-script:dashboard-only:reporting/package.json"]);
  const report = JSON.parse(fs.readFileSync(path.join(complete.receipt, "reports", "code-rot-audit.json"), "utf8"));
  expect(report.sourceOfTruth.warnings).toContainEqual(expect.stringContaining("absent"));
  fs.writeFileSync(path.join(fixture.target, "CHANGELOG.md"), [
    "# Changelog", "## [1.0.00]", "## v1.0.0-other", "## v1.0.0+different",
    "<!--", "## 1.0.0", "-->", "```md", "## [v1.0.0]", "```",
  ].join("\n"));
  const missing = await nativeAudit(fixture, "missing-section", "none");
  expect(missing.ids).toContain("package-release-rot:CHANGELOG.md:missing-current-version-section:1.0.0");
}, 60_000);

exact("exact FACTS02: test re-exports and substituted imports qualify independently of unknown modifiers", async () => {
  const origin = "tests/entry.test.mts";
  const fixture = subject("import-predicate", {
    [origin]: [
      'import { test } from "@playwright/test";',
      'import "../src/substitute.mjs";',
      'export { value } from "../src/exported.mjs";',
      'import "../node_modules/isolated/present.mjs";',
      'import "../src/genuine-missing.mjs";',
      only,
      'test["skip"](process.env.OPTIONAL);',
    ].join("\n"),
    "src/substitute.mts": "export const value = 1;\n",
    "src/exported.mts": "export const value = 1;\n",
    "node_modules/isolated/present.mjs": "export const value = 1;\n",
  });
  const outcome = await nativeAudit(fixture, "none", "none");
  expect(outcome.exit).toBe(2);
  expect(outcome.ids.filter(id => id.includes(":missing-source-import:"))).toEqual([
    "test-rot:tests/entry.test.mts:missing-source-import:../src/genuine-missing.mjs",
  ]);
  expect(outcome.ids).toContain("test-rot:tests/entry.test.mts:only-usage:6");
  expect(outcome.coverage).toContainEqual(expect.objectContaining({
    source: { kind: "file", identity: origin }, detectorId: "test-rot", predicate: "missing-source-import",
    mandatory: true, reason: expect.stringContaining("../node_modules/isolated/present.mjs"),
  }));
  expect(outcome.coverage).toContainEqual(expect.objectContaining({
    source: { kind: "file", identity: origin }, predicate: "executable test modifiers",
    capability: "test-observations", mandatory: true, actualStatus: "partial",
  }));
}, 60_000);

const exactCli = archive && packageRoot ? candidate().expectation?.cliSha256 : undefined;
const a6r1Cli = "3c661671355ec6475768a6658cfd94d3c5f21184e1177af12418d7cac9999797";
const step5R1Cli = "764590dc9c53dfb61ff3236da701745117e2baa40cd1464dca1ed4f57ca7b17f";
const a6 = it.skipIf(exactCli !== "8b225c4b41c0dc5799c681ccc3ad61241f1606dbefa4f21c45b3f2de105653cb" && exactCli !== a6r1Cli && exactCli !== step5R1Cli);
const a6r1 = it.skipIf(exactCli !== a6r1Cli && exactCli !== step5R1Cli);
const bundlerConfig = '{"compilerOptions":{"module":"esnext","moduleResolution":"bundler","resolveJsonModule":true,"baseUrl":".","paths":{"@/*":["src/*"]}}}';

a6("exact A6: consumes bounded Bundler imports, alternatives, and applicable absence", async () => {
  const origin = "tests/bundler.test.ts";
  const fixture = subject("bundler", {
    "tsconfig.json": bundlerConfig,
    [origin]: [
      'import "../src/explicit.ts";',
      'import "../src/extensionless";',
      'import "../src/substitution.js";',
      'import "../src/directory";',
      'import "@/alias";',
      'export { value } from "../src/reexport";',
      'import "../src/multi";',
      'import "../src/gone.ts";',
      'import "../src/asset.json";',
    ].join("\n"),
    "src/explicit.ts": "export const value = 1;",
    "src/extensionless.ts": "export const value = 2;",
    "src/substitution.ts": "export const value = 3;",
    "src/directory/index.ts": "export const value = 4;",
    "src/alias.ts": "export const value = 5;",
    "src/reexport.ts": "export const value = 6;",
    "src/multi.ts": "export const value = 7;",
    "src/multi.js": "export const value = 8;",
    "src/asset.json": '{"value":9}',
    "unsupported/tsconfig.json": '{"extends":"../tsconfig.json","compilerOptions":{"moduleSuffixes":[".native",""]}}',
    "unsupported/origin.ts": 'import "../src/explicit.ts";',
  });
  await withReader(fixture, async (reader, files) => {
    const read = (specifier: string, file = origin) => reader.importTarget(
      files.find(entry => entry.relativePath === file)!.imports.find(fact => fact.source === specifier)!.provenance!.factId,
    );
    for (const [specifier, target] of [
      ["../src/explicit.ts", "src/explicit.ts"],
      ["../src/extensionless", "src/extensionless.ts"],
      ["../src/substitution.js", "src/substitution.ts"],
      ["../src/directory", "src/directory/index.ts"],
      ["@/alias", "src/alias.ts"],
    ] as const) {
      expect(await read(specifier)).toMatchObject({
        qualifiedSourceReferencePath: target, selectedTargetUpperBound: [target],
      });
    }
    const [reexport] = reader.reExportTargets!(origin);
    expect(await reader.importTarget(reexport!.id)).toMatchObject({ qualifiedSourceReferencePath: "src/reexport.ts" });
    const multi = await read("../src/multi");
    expect(multi.selectedTargetUpperBound).toEqual(["src/multi.js", "src/multi.ts"]);
    expect(multi.qualifiedSourceReferencePath).toBeUndefined();
    expect(await read("../src/gone.ts")).toMatchObject({
      applicableSourceReferenceAbsent: true, selectedTargetUpperBound: [],
    });
    for (const [specifier, file, reason] of [
      ["../src/asset.json", origin, "UNSUPPORTED_CANDIDATE_SHAPE"],
      ["../src/explicit.ts", "unsupported/origin.ts", "UNQUALIFIED_CONFIGURATION_OR_MAPPING"],
    ] as const) {
      const proof = await read(specifier, file);
      expect(proof.ordinarySourceReferenceReason).toBe(reason);
      expect(proof.qualifiedSourceReferencePath).toBeUndefined();
      expect(proof.applicableSourceReferenceAbsent).toBeUndefined();
    }
  });
  const audit = await nativeAudit(fixture, "bundler-audit", "none");
  expect(audit.exit).toBe(2);
  const unresolved = audit.coverage.filter(row => row.source.identity === origin &&
    row.predicate === "missing-source-import" && row.status === "UNAVAILABLE");
  expect(unresolved.map(row => row.reason)).toEqual([
    expect.stringContaining("Import ../src/multi:"),
    expect.stringContaining("Import ../src/asset.json:"),
  ]);
  expect(audit.ids.filter(id => id.startsWith("test-rot:" + origin + ":missing-source-import:")))
    .toEqual(["test-rot:" + origin + ":missing-source-import:../src/gone.ts"]);
}, 60_000);

a6("exact A6: imported Bundler runner closes a noisy modifier domain independently", async () => {
  const completePath = "tests/noisy.spec.ts";
  const partialPath = "tests/unresolved.spec.ts";
  const positive = [
    'import { test } from "./support/fixture";',
    'import { it } from "vitest";',
    ...Array.from({ length: 32 }, (_, i) => 'it(process.env.CASE_' + i + ', () => {});'),
    'it.skip("legacy observation", () => {});',
    conditionalSkip,
  ].join("\n");
  const fixture = subject("bundler-noisy", {
    "tsconfig.json": bundlerConfig,
    "tests/support/fixture.ts": wrapper,
    [completePath]: positive,
    [partialPath]: positive + '\ntest["skip"](process.env.FLAG === "1");',
  });
  await withReader(fixture, async reader => {
    const artifact = JSON.parse(fs.readFileSync(path.join(fixture.root, "kit/index/source-audit-evidence.json"), "utf8")) as {
      source: { snapshotId: string };
      files: { path: string; diagnostics: { code: string }[] }[];
    };
    expect(artifact.source.snapshotId).toBe(reader.snapshotId);
    for (const origin of [completePath, partialPath]) {
      expect(artifact.files.find(file => file.path === origin)?.diagnostics).toContainEqual(
        expect.objectContaining({ code: "diagnostics-truncated" }),
      );
      expect(reader.testModifierProof!(origin)).toMatchObject({
        coverage: origin === completePath ? "complete" : "partial",
        reasonCodes: origin === completePath ? [] : ["UNSUPPORTED_MODIFIER_FORM"],
        observations: [{ modifier: "skip", calleeSpan: { startLine: 36 } }],
        runnerBinding: { kind: "imported-extended-playwright", wrapper: { path: "tests/support/fixture.ts" } },
      });
    }
  });
  const audit = await nativeAudit(fixture, "modifier-audit", "none");
  expect(audit.exit).toBe(2);
  expect(audit.coverage.filter(row => row.predicate === "executable test modifiers" && row.mandatory &&
    (row.status === "UNAVAILABLE" || row.status === "UNDETERMINED")).map(row => row.source.identity))
    .toEqual([partialPath]);
  for (const origin of [completePath, partialPath]) {
    expect(audit.ids.filter(id => id.startsWith("test-rot:" + origin + ":skip-usage:")).sort())
      .toEqual(["test-rot:" + origin + ":skip-usage:35", "test-rot:" + origin + ":skip-usage:36"]);
  }
}, 60_000);

a6r1("exact A6-R1: consumes a bounded Bundler reference with unrelated compiler options", async () => {
  const origin = "tests/unit/entry.test.ts";
  const specifier = "../../src/peer";
  const target = "src/peer.ts";
  const fixture = subject("bounded-options", {
    "tsconfig.json": JSON.stringify({ compilerOptions: {
      module: "ESNext", moduleResolution: "Bundler",
      noUncheckedIndexedAccess: true, types: ["node", "browser-types"],
    } }),
    [origin]: 'import "../../src/peer";',
    [target]: "export const peer = 1;",
  });
  await withReader(fixture, async (reader, files) => {
    const entry = files.find(file => file.relativePath === origin);
    const observation = entry?.imports.find(fact => fact.source === specifier);
    expect(observation?.provenance?.factId).toBeTruthy();
    expect(await reader.importTarget(observation!.provenance!.factId)).toMatchObject({
      qualifiedSourceReferencePath: target, selectedTargetUpperBound: [target],
    });
  });
  const audit = await nativeAudit(fixture, "complete", "none");
  expect(audit.exit).toBe(0);
  expect(audit.coverage.filter(row => row.mandatory && ["UNAVAILABLE", "UNDETERMINED"].includes(row.status))).toEqual([]);
  expect(audit.ids).not.toContain("test-rot:" + origin + ":missing-source-import:" + specifier);
}, 60_000);
