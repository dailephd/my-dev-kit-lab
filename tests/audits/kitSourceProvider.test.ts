import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import { kitPredicateContent } from "../../src/audits/codeRot/utils/sourceFactsLookup.js";
import {
  QUALIFIED_KIT_CANDIDATE,
  QUALIFIED_PUBLISHED_KIT,
  QUALIFIED_SW123_P6_R2_KIT,
  QUALIFIED_SW123_P6_R7_KIT,
  collectKitSourceFacts,
  resolveInstalledKitPackage,
  selectKitSourceRoots,
  type KitCandidateExpectation,
  type KitCommandRunner,
} from "../../src/audits/core/kitSourceProvider.js";
import { KitSourceEvidenceAcquisitionError } from "../../src/audits/core/kitSourceEvidence.js";
import { resolveApplicableKitRequirements, requiredKitCapabilitiesForPath } from "../../src/audits/core/auditRegistry.js";
import { DEFAULT_AUDIT_REGISTRY } from "../../src/audits/core/auditRegistry.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { qualifyKitDeclarationPredicate, qualifyKitImportPredicate } from "../../src/audits/core/kitSourceEvidence.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { renderAuditJsonReport } from "../../src/audits/report/renderAuditJsonReport.js";
import { resolveAuditTarget } from "../../src/audits/core/auditTarget.js";
import { runMeasuredCommand, type MeasuredCommandResult } from "../../src/core/runMeasuredCommand.js";

const CANDIDATE_ROOT = path.resolve(
  process.env.LAB_KIT_CANDIDATE_ROOT ??
    (process.env.LAB_VERIFICATION_LANE === "private" ? path.join(".my-dev-kit-workflow", "tools", "v010-lab-kit-gate4", "kit-candidate-05", "node_modules", "@dailephd", "my-dev-kit") : path.join("node_modules", "@dailephd", "my-dev-kit"))
);
if (!fs.existsSync(path.join(CANDIDATE_ROOT, "package.json"))) throw new Error("Required Kit provider missing");
const installedExpectation = process.env.LAB_VERIFICATION_LANE === "private" ? QUALIFIED_KIT_CANDIDATE : QUALIFIED_PUBLISHED_KIT;

const roots: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lab-kit-${prefix}-`));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function hashTree(root: string): string {
  const entries: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) walk(full);
      else entries.push(`${path.relative(root, full)}:${createHash("sha256").update(fs.readFileSync(full)).digest("hex")}`);
    }
  };
  walk(root);
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function expectAcquisitionFailure(promise: Promise<unknown>, category: string): Promise<KitSourceEvidenceAcquisitionError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(KitSourceEvidenceAcquisitionError);
    expect((error as KitSourceEvidenceAcquisitionError).category).toBe(category);
    return error as KitSourceEvidenceAcquisitionError;
  }
  throw new Error(`expected ${category} failure`);
}

// ---------------------------------------------------------------------------
// Package resolution (fake installed packages; no subprocess)
// ---------------------------------------------------------------------------

const FAKE_EXPECTATION: KitCandidateExpectation = { ...QUALIFIED_KIT_CANDIDATE, cliSha256: null };

function fakePackage(overrides: { name?: string; version?: string; bin?: unknown; cli?: string | null; extra?: (root: string) => void } = {}): string {
  const root = tempDir("pkg");
  writeFiles(root, {
    "package.json": JSON.stringify({
      name: overrides.name ?? FAKE_EXPECTATION.packageName,
      version: overrides.version ?? FAKE_EXPECTATION.packageVersion,
      bin: overrides.bin ?? { "my-dev-kit": "dist/cli.js" },
    }),
  });
  if (overrides.cli !== null) {
    writeFiles(root, { "dist/cli.js": overrides.cli ?? `// ${FAKE_EXPECTATION.extractorRevision}\n` });
  }
  overrides.extra?.(root);
  return root;
}

describe("installed Kit package resolution", () => {
  it("accepts an installed package with the expected identity and a contained CLI", () => {
    const root = fakePackage();
    const pkg = resolveInstalledKitPackage({ installedPackageRoot: root, expectation: FAKE_EXPECTATION });
    expect(pkg.packageName).toBe("@dailephd/my-dev-kit");
    expect(pkg.packageVersion).toBe("1.14.0");
    expect(path.relative(fs.realpathSync(root), pkg.cliPath).startsWith("..")).toBe(false);
  });

  it("fails when the package is not installed", () => {
    expect(() => resolveInstalledKitPackage({ installedPackageRoot: path.join(os.tmpdir(), "lab-kit-definitely-absent"), expectation: FAKE_EXPECTATION })).toThrowError(
      /package-missing/
    );
  });

  it("does not resolve Kit from Lab's own environment when it is not installed", () => {
    let category: string | undefined;
    try {
      resolveInstalledKitPackage({ expectation: FAKE_EXPECTATION });
    } catch (error) {
      category = (error as KitSourceEvidenceAcquisitionError).category;
    }
    // Lab declares no Kit dependency in this batch: normal resolution fails closed.
    expect(["package-missing", "package-identity", "extractor-mismatch"]).toContain(category);
  });

  it.each([
    ["a different package name", { name: "@dailephd/other" }],
    ["a different candidate version", { version: "1.13.0" }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => resolveInstalledKitPackage({ installedPackageRoot: fakePackage(overrides), expectation: FAKE_EXPECTATION })).toThrowError(/package-identity/);
  });

  it("rejects an unpinned CLI build and a wrong extractor revision", () => {
    expect(() =>
      resolveInstalledKitPackage({ installedPackageRoot: fakePackage(), expectation: { ...FAKE_EXPECTATION, cliSha256: "0".repeat(64) } })
    ).toThrowError(/package-identity/);
    expect(() =>
      resolveInstalledKitPackage({ installedPackageRoot: fakePackage({ cli: "// source-audit-v0.0.1\n" }), expectation: FAKE_EXPECTATION })
    ).toThrowError(/extractor-mismatch/);
  });

  it.each([
    ["a missing CLI file", { cli: null }],
    ["a bin entry that escapes the package", { bin: { "my-dev-kit": "../outside.js" } }],
    ["an absolute bin entry", { bin: { "my-dev-kit": path.resolve(os.tmpdir(), "x.js") } }],
    ["no my-dev-kit bin entry", { bin: { other: "dist/cli.js" } }],
    ["a non-JavaScript CLI", { bin: { "my-dev-kit": "dist/cli.txt" }, extra: (root: string) => writeFiles(root, { "dist/cli.txt": "source-audit-v1.2.0" }) }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => resolveInstalledKitPackage({ installedPackageRoot: fakePackage(overrides as never), expectation: FAKE_EXPECTATION })).toThrowError(/cli-containment/);
  });

  it("rejects a CLI that resolves outside the package through a junction or symlink", () => {
    const outside = tempDir("outside");
    writeFiles(outside, { "cli.js": `// ${FAKE_EXPECTATION.extractorRevision}\n` });
    const root = fakePackage({ cli: null });
    try {
      fs.symlinkSync(outside, path.join(root, "dist"), "junction");
    } catch {
      return; // Link creation unavailable on this host; reported, not passed.
    }
    expect(() => resolveInstalledKitPackage({ installedPackageRoot: root, expectation: FAKE_EXPECTATION })).toThrowError(/cli-containment/);
  });
});

describe("Kit source root selection", () => {
  it("selects actual inventory source roots and excludes build output", () => {
    const root = tempDir("roots");
    writeFiles(root, { "src/a.ts": "", "tests/a.test.ts": "", "scripts/s.ts": "", "dist/x.ts": "" });
    const inventory = scanProjectInventory(root);
    expect(selectKitSourceRoots(root, inventory, ["src/a.ts", "tests/a.test.ts"]).sourceRoots).toEqual(["src", "tests"]);
    expect(selectKitSourceRoots(root, inventory).sourceRoots).toEqual(["scripts", "src", "tests"]);
    const bare = tempDir("roots-bare");
    writeFiles(bare, { "src/a.ts": "" });
    expect(selectKitSourceRoots(bare, scanProjectInventory(bare)).sourceRoots).toEqual(["src"]);
  });
});

// ---------------------------------------------------------------------------
// Deterministic fake Kit world for narrow failure tests
// ---------------------------------------------------------------------------

type FakeFile = { path: string; sizeBytes: number; contentSha256: string; lineCount: number; language: string; role: string };

type Mutators = {
  status?: string;
  artifact?: (artifact: Record<string, any>) => void;
  manifest?: (manifest: Record<string, any>) => void;
  skipArtifact?: boolean;
  inventoryPage?: (index: number, page: Record<string, any>) => Record<string, any>;
  factPage?: (filePath: string, index: number, page: Record<string, any>) => Record<string, any>;
  capabilities?: Record<string, string>;
  rawResult?: (kind: "index" | "audit-files" | "audit-file", result: MeasuredCommandResult) => MeasuredCommandResult;
  rootsAreOverridden?: string[];
  extraInventory?: FakeFile[];
  droppedFromInventory?: readonly string[];
  declarationsPerFile?: number;
};

const SNAPSHOT = "1".repeat(64);

function result(stdout: string, extra: Partial<MeasuredCommandResult> = {}): MeasuredCommandResult {
  return {
    commandId: "fake",
    commandString: "fake",
    executable: process.execPath,
    args: [],
    cwd: ".",
    startedAt: "",
    endedAt: "",
    durationMs: 0,
    exitCode: 0,
    stdout,
    stderr: "",
    stdoutPath: "",
    stderrPath: "",
    telemetryPath: "",
    ok: true,
    ...extra,
  };
}

function fakeWorld(targetRoot: string, mutators: Mutators = {}) {
  const calls: string[][] = [];
  const files: FakeFile[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else {
        const relative = path.relative(targetRoot, full).replace(/\\/g, "/");
        if (!/^(src|tests|scripts)\//.test(relative)) continue;
        const bytes = fs.readFileSync(full);
        files.push({
          path: relative,
          sizeBytes: bytes.length,
          contentSha256: createHash("sha256").update(bytes).digest("hex"),
          lineCount: bytes.toString("utf8").split("\n").length,
          language: relative.endsWith(".py") ? "python" : "typescript",
          role: relative.startsWith("tests/") ? "test" : "source",
        });
      }
    }
  };
  walk(targetRoot);
  const inventoryFiles = [...files.filter((file) => !(mutators.droppedFromInventory ?? []).includes(file.path)), ...(mutators.extraInventory ?? [])].sort((a, b) =>
    a.path < b.path ? -1 : 1
  );

  const record = (file: FakeFile, withDiagnostics: boolean) => ({
    path: file.path,
    sizeBytes: file.sizeBytes,
    contentSha256: file.contentSha256,
    language: file.language,
    role: file.role,
    status: mutators.status ?? "parsed",
    lineCount: file.lineCount,
    analyzerId: file.language === "python" ? "python-ast" : "typescript-ast",
    capabilities: {
      declarations: "complete",
      imports: "complete",
      exports: "complete",
      "identifier-literals": "unsupported",
      "test-observations": "unsupported",
      "fixture-references": "unsupported",
      "process-observations": "unsupported",
      "api-client-calls": "not-applicable",
      "source-ranges": "complete",
      ...(mutators.capabilities ?? {}),
    },
    warnings: [],
    ...(withDiagnostics ? { diagnostics: [] } : {}),
  });
  const coverage = {
    selectedFileCount: inventoryFiles.length,
    recordedFileCount: inventoryFiles.length,
    unreadableFileCount: 0,
    excludedPathCount: 0,
    unsupportedFileCount: 0,
    inventoryComplete: true,
    exclusionsAreExplicit: true,
  };
  const factsFor = (file: FakeFile) =>
    Array.from({ length: mutators.declarationsPerFile ?? 1 }, (_, index) => ({
      id: `audit-fact:${encodeURIComponent(file.path)}#declaration#${index + 1}#0#0`,
      kind: "declaration",
      span: { path: file.path, startLine: index + 1, startColumn: 0, endLine: index + 1, endColumn: 4 },
      extractionMethod: "typescript-ast",
      name: `thing${index}`,
      declarationKind: "function",
      visibility: "public",
      exported: true,
      exportOrigin: "declared-export",
      ownerKey: null,
    }));

  const runCommand: KitCommandRunner = async (options) => {
    const args = [...(options.args ?? [])];
    calls.push(args);
    const sub = args[1];
    if (sub === "index") {
      const out = args[args.indexOf("--out") + 1]!;
      const sourceRoots = mutators.rootsAreOverridden ?? args.flatMap((value, index) => (args[index - 1] === "--src" ? [value] : []));
      fs.mkdirSync(out, { recursive: true });
      const artifact: Record<string, any> = {
        artifactKind: "my-dev-kit-v1-source-audit-evidence",
        schemaVersion: "1.1.0",
        producer: { packageName: "@dailephd/my-dev-kit", packageVersion: "1.14.0" },
        source: {
          projectRoot: targetRoot.replace(/\\/g, "/"),
          sourceRoots,
          excludes: [],
          symbolIndexSchemaVersion: "3",
          codeGraphSchemaVersion: "1.1.0",
          selectionFingerprint: "2".repeat(64),
          snapshotId: SNAPSHOT,
        },
        coverage,
        files: inventoryFiles.map((file) => record(file, false)),
      };
      mutators.artifact?.(artifact);
      const bytes = Buffer.from(JSON.stringify(artifact, null, 2) + "\n");
      if (!mutators.skipArtifact) fs.writeFileSync(path.join(out, "source-audit-evidence.json"), bytes);
      const manifest: Record<string, any> = {
        sourceAuditEvidence: {
          path: "source-audit-evidence.json",
          schemaVersion: "1.1.0",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          snapshotId: SNAPSHOT,
        },
      };
      mutators.manifest?.(manifest);
      fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest));
      const raw = result(JSON.stringify({ mode: "index" }));
      return mutators.rawResult ? mutators.rawResult("index", raw) : raw;
    }
    const page = Number(args[args.indexOf("--page") + 1]);
    if (args.includes("--audit-files")) {
      const totalPages = Math.max(1, Math.ceil(inventoryFiles.length / 64));
      let body: Record<string, any> = {
        schemaVersion: "1.1.0",
        snapshotId: SNAPSHOT,
        pageIndex: page,
        pageSize: 64,
        totalItems: inventoryFiles.length,
        totalPages,
        nextPageIndex: page === totalPages - 1 ? null : page + 1,
        mode: "audit-files",
        coverage,
        files: inventoryFiles.slice(page * 64, (page + 1) * 64).map((file) => record(file, false)),
      };
      if (mutators.inventoryPage) body = mutators.inventoryPage(page, body);
      const raw = result(JSON.stringify(body));
      return mutators.rawResult ? mutators.rawResult("audit-files", raw) : raw;
    }
    const filePath = args[args.indexOf("--audit-file") + 1]!;
    const file = inventoryFiles.find((entry) => entry.path === filePath)!;
    const facts = factsFor(file);
    const totalPages = Math.max(1, Math.ceil(facts.length / 128));
    let body: Record<string, any> = {
      schemaVersion: "1.1.0",
      snapshotId: SNAPSHOT,
      pageIndex: page,
      pageSize: 128,
      totalItems: facts.length,
      totalPages,
      nextPageIndex: page === totalPages - 1 ? null : page + 1,
      mode: "audit-file",
      status: "found",
      file: record(file, true),
      facts: facts.slice(page * 128, (page + 1) * 128),
    };
    if (mutators.factPage) body = mutators.factPage(filePath, page, body);
    const raw = result(JSON.stringify(body));
    return mutators.rawResult ? mutators.rawResult("audit-file", raw) : raw;
  };
  return { runCommand, calls };
}

function labProject(): string {
  const root = tempDir("proj");
  writeFiles(root, {
    "package.json": JSON.stringify({ name: "fx", version: "1.0.0" }),
    "src/a.ts": "export function a(): number {\n  return 1;\n}\n",
    "src/b.ts": 'import { a } from "./a";\nexport const b = a();\n',
    "tests/a.test.ts": 'import { a } from "../src/a";\nvoid a;\n',
  });
  return root;
}

describe("explicit predicate acquisition", () => {
  it.each(["declarations", "imports"])("runner enables predicate acquisition for partial %s without erasing the other capability", async capability => {
    const project = labProject(), pkgRoot = fakePackage();
    const expectation = { ...FAKE_EXPECTATION, cliSha256: createHash("sha256").update(fs.readFileSync(path.join(pkgRoot, "dist/cli.js"))).digest("hex") };
    const { runAudit } = await import("../../src/audits/core/auditRunner.js");
    const { normalizeAuditConfig } = await import("../../src/audits/core/auditConfig.js");
    const { qualifyKitImportPredicate, qualifyKitDeclarationPredicate } = await import("../../src/audits/core/kitSourceEvidence.js");
    let executed = false;
    const result = await runAudit({ config: normalizeAuditConfig({ target: project, include: "package,cli,architecture,tests", failOn: "none" }, project),
      toolRoot: project, kitSourceProviderDependencies: { installedPackageRoot: pkgRoot, expectation, runCommand: fakeWorld(project, { capabilities: { [capability]: "partial" } }).runCommand },
      registry: [{ id: "dead-code-candidate", auditType: "code-rot", title: "bridge", description: "bridge", supportedIncludeAreas: ["package"], run: ctx => {
        executed = true;
        const file = ctx.sourceFacts!.files.find(f => f.relativePath === "src/a.ts")!;
        expect(file.kit?.capabilities[capability]).toBe("partial");
        expect(qualifyKitDeclarationPredicate(file, file.declarations[0])).toBe("QUALIFIED_POSITIVE");
        expect(qualifyKitImportPredicate(file)).toBe(capability === "imports" ? "UNAVAILABLE" : "QUALIFIED_NEGATIVE");
        return [];
      } }] });
    expect(executed).toBe(true);
    expect(result.exitCode).toBe(capability === "imports" ? 2 : 0);
    expect(result.coverage!.some(c => c.capability === "imports" && c.mandatory && c.status === (capability === "imports" ? "UNAVAILABLE" : "QUALIFIED"))).toBe(true);
  });

  async function scoped(mutators: Mutators = {}, optIn = true, identity: Partial<KitCandidateExpectation> = {}) {
    const project = labProject(), pkgRoot = fakePackage();
    const expectation = { ...FAKE_EXPECTATION, cliSha256: createHash("sha256").update(fs.readFileSync(path.join(pkgRoot, "dist/cli.js"))).digest("hex"), ...identity };
    const inventory = scanProjectInventory(project);
    const selection = resolveApplicableKitRequirements([{ id: "dead-code-candidate" }, { id: "duplicate-implementation-candidate" }], inventory, ["package", "cli", "architecture", "tests"]);
    return collectKitSourceFacts({ targetRoot: project, inventory, requiredPaths: selection.paths,
      requiredCapabilities: ["declarations", "imports"], includeScriptsRoot: true,
      capabilitiesForPath: file => requiredKitCapabilitiesForPath(selection.requirements, file),
      ...(optIn ? { predicateRequirements: selection.requirements } : {}),
    }, { installedPackageRoot: pkgRoot, expectation, runCommand: fakeWorld(project, mutators).runCommand });
  }

  it.each(["declarations", "imports"])("retains authenticated partial %s only through the explicit route", async capability => {
    const snapshot = await scoped({ capabilities: { [capability]: "partial" } });
    const source = snapshot.files.find(f => f.relativePath === "src/a.ts")!;
    expect(source.kit?.capabilities[capability]).toBe("partial");
    expect(source.parseStatus).toBe("file-level-only");
    expect(source.declarations).toHaveLength(1);
    await expectAcquisitionFailure(scoped({ capabilities: { [capability]: "partial" } }, false), "capability-insufficient");
  });

  it("retains a valid partial file status while keeping unsupported requirements unavailable", async () => {
    const snapshot = await scoped({ status: "partial", capabilities: { declarations: "partial" } });
    expect(snapshot.files.every(file => file.parseStatus === "file-level-only")).toBe(true);
    await expectAcquisitionFailure(scoped({ capabilities: { declarations: "unsupported" } }), "capability-insufficient");
  });

  it.each(["absent", "unknown"] as const)(
    "rejects %s predicate obligations before package resolution", async mode => {
      const predicateRequirements = mode === "absent" ? [] : [{ path: "src/a.ts", detectorId: "unknown-detector", capability: "declarations" as const, applicability: "APPLICABLE_REQUIRED" as const }];
      const project = labProject();
      await expectAcquisitionFailure(collectKitSourceFacts({ targetRoot: project, inventory: scanProjectInventory(project),
        requiredPaths: ["src/a.ts"], requiredCapabilities: ["declarations"], capabilitiesForPath: () => ["declarations"],
        includeScriptsRoot: false, predicateRequirements }, { installedPackageRoot: path.join(project, "absent-kit") }), "invalid-request");
    });

  it.each([
    ["altered bytes", { manifest: (value: any) => { value.sourceAuditEvidence.sha256 = "0".repeat(64); } }, "artifact-invalid"],
    ["missing path", { droppedFromInventory: ["src/a.ts"] }, "selection-incomplete"],
    ["mismatched snapshot", { factPage: (_file: string, _page: number, value: any) => ({ ...value, snapshotId: "0".repeat(64) }) }, "snapshot-mismatch"],
    ["stale exact-file identity", { factPage: (_file: string, _page: number, value: any) => ({ ...value, file: { ...value.file, contentSha256: "0".repeat(64) } }) }, "stale-evidence"],
    ["incomplete pages", { inventoryPage: (_page: number, value: any) => ({ ...value, totalPages: 2, nextPageIndex: null }) }, "page-invalid"],
  ] as const)("keeps %s fatal in the partial route", async (_label, mutators, category) => {
    await expectAcquisitionFailure(scoped({ ...mutators, capabilities: { declarations: "partial" } }), category);
  });

  it.each([
    [{ packageVersion: "0.0.0" }, "package-identity"],
    [{ cliSha256: "0".repeat(64) }, "package-identity"],
    [{ extractorRevision: "source-audit-v0.0.0" }, "extractor-mismatch"],
    [{ cliSha256: null }, "invalid-request"],
  ])("does not bypass producer qualification: %j", async (identity, category) => {
    await expectAcquisitionFailure(scoped({ capabilities: { declarations: "partial" } }, true, identity), category as string);
  });
});

it("does not qualify an unknown future producer from shared metadata or extractor revision", async () => {
  const targetRoot = labProject();
  const expectation = { ...FAKE_EXPECTATION, extractorRevision: "source-audit-v1.3.0" };
  const installedPackageRoot = fakePackage({ cli: "// source-audit-v1.3.0 future producer\n" });
  let disposed: (() => void) | undefined;
  try {
    await collectKitSourceFacts({ targetRoot, inventory: scanProjectInventory(targetRoot), requiredCapabilities: [], includeScriptsRoot: true,
      onReader(reader) {
        disposed = reader.dispose;
        expect(reader.jsTsRelativeImportCandidateProof).toBeUndefined();
        expect(reader.jsonRawLiteralContent).toBeUndefined();
      } }, { installedPackageRoot, expectation, runCommand: fakeWorld(targetRoot).runCommand });
    expect(disposed).toBeDefined();
  } finally { disposed?.(); }
});

async function acquire(mutators: Mutators = {}, capabilities: Array<"declarations" | "imports"> = ["declarations", "imports"], workDirOwned = true) {
  const project = labProject();
  const world = fakeWorld(project, mutators);
  const pkgRoot = fakePackage();
  const inventory = scanProjectInventory(project);
  const workDir = workDirOwned ? undefined : tempDir("work");
  const promise = collectKitSourceFacts(
    { targetRoot: project, inventory, requiredCapabilities: capabilities, includeScriptsRoot: false },
    { installedPackageRoot: pkgRoot, expectation: FAKE_EXPECTATION, runCommand: world.runCommand, workDir }
  );
  return { promise, world, project, workDir };
}

describe("Kit source provider with deterministic fake commands", () => {
  it("indexes, traverses and adapts a consistent fake world", async () => {
    const { promise, world } = await acquire();
    const snapshot = await promise;
    expect(snapshot.provider).toBe("kit");
    expect(snapshot.files.map((file) => file.relativePath)).toEqual(["src/a.ts", "src/b.ts", "tests/a.test.ts"]);
    expect(snapshot.kitEvidence?.traversalComplete).toBe(true);
    expect(snapshot.kitEvidence?.snapshotId).toBe(SNAPSHOT);
    // index + 1 inventory page + 3 exact-file lookups.
    expect(world.calls.map((args) => args[1])).toEqual(expect.arrayContaining(["index", "lookup"]));
    expect(world.calls).toHaveLength(5);
    const index = world.calls.find((args) => args[1] === "index")!;
    expect(index.slice(2, 3)).toEqual(["--root"]);
    expect(index).toContain("--json");
    expect(index.filter((arg) => arg === "--src")).toHaveLength(2);
  });

  it("invokes Kit with process.execPath and an argument array, never a shell", async () => {
    const project = labProject();
    const seen: Array<{ executable?: string; resolveCommand?: boolean; timeoutMs?: number; stdoutMaxBytes?: number; stderrMaxBytes?: number; terminateProcessTree?: boolean }> = [];
    const world = fakeWorld(project);
    await collectKitSourceFacts(
      { targetRoot: project, inventory: scanProjectInventory(project), requiredCapabilities: ["declarations"], includeScriptsRoot: false },
      {
        installedPackageRoot: fakePackage(),
        expectation: FAKE_EXPECTATION,
        runCommand: async (options) => {
          seen.push(options as never);
          return world.runCommand(options);
        },
      }
    );
    expect(new Set(seen.map((entry) => entry.executable))).toEqual(new Set([process.execPath]));
    expect(seen.every((entry) => entry.resolveCommand === false && entry.terminateProcessTree === true)).toBe(true);
    expect(seen.find((entry) => entry.timeoutMs === 300000)).toBeDefined();
    expect(seen.filter((entry) => entry.timeoutMs === 30000).length).toBe(seen.length - 1);
    expect(new Set(seen.map((entry) => entry.stdoutMaxBytes))).toEqual(new Set([8388608]));
    expect(new Set(seen.map((entry) => entry.stderrMaxBytes))).toEqual(new Set([262144]));
  });

  it("cleans up a provider-owned working directory and keeps an injected one", async () => {
    const owned = await acquire({}, ["declarations"], true);
    await owned.promise;
    const kept = await acquire({}, ["declarations"], false);
    await kept.promise;
    expect(fs.existsSync(path.join(kept.workDir!, "index", "manifest.json"))).toBe(true);
  });

  it("does not write inside the inspected target", async () => {
    const project = labProject();
    const before = hashTree(project);
    const world = fakeWorld(project);
    await collectKitSourceFacts(
      { targetRoot: project, inventory: scanProjectInventory(project), requiredCapabilities: ["declarations"], includeScriptsRoot: false },
      { installedPackageRoot: fakePackage(), expectation: FAKE_EXPECTATION, runCommand: world.runCommand }
    );
    expect(hashTree(project)).toBe(before);
  });

  it("paginates inventory and facts with many files and many facts", async () => {
    const project = labProject();
    for (let index = 0; index < 70; index += 1) writeFiles(project, { [`src/gen/g${String(index).padStart(3, "0")}.ts`]: `export const g${index} = ${index};\n` });
    const world = fakeWorld(project, { declarationsPerFile: 130 });
    const snapshot = await collectKitSourceFacts(
      { targetRoot: project, inventory: scanProjectInventory(project), requiredCapabilities: ["declarations"], includeScriptsRoot: false },
      { installedPackageRoot: fakePackage(), expectation: FAKE_EXPECTATION, runCommand: world.runCommand }
    );
    expect(snapshot.kitEvidence?.inventoryPages).toBe(2);
    expect(snapshot.kitEvidence?.factPages).toBe(2 * snapshot.files.length);
    expect(snapshot.files.every((file) => file.declarations.length === 130)).toBe(true);
  });

  describe("failure classification", () => {
    it("fails on a nonzero subprocess exit", async () => {
      const { promise } = await acquire({ rawResult: (kind, raw) => (kind === "index" ? result("", { ok: false, exitCode: 2, stderr: "BOOM: nope" }) : raw) });
      const error = await expectAcquisitionFailure(promise, "subprocess-failed");
      expect(error.detail).toContain("BOOM");
    });

    it("fails on a subprocess timeout and does not start a native fallback", async () => {
      const { promise } = await acquire({ rawResult: (kind, raw) => (kind === "index" ? result("", { ok: false, exitCode: null, timedOut: true }) : raw) });
      await expectAcquisitionFailure(promise, "subprocess-timeout");
    });

    it("fails on an output byte-limit violation without parsing truncated JSON", async () => {
      const { promise } = await acquire({
        rawResult: (kind, raw) => (kind === "audit-files" ? result('{"schemaVersion":', { ok: false, outputLimit: { stream: "stdout", limitBytes: 8388608 } }) : raw),
      });
      await expectAcquisitionFailure(promise, "output-limit");
    });

    it("fails on exit 0 with invalid JSON", async () => {
      const { promise } = await acquire({ rawResult: (kind, raw) => (kind === "audit-files" ? result("not json") : raw) });
      await expectAcquisitionFailure(promise, "invalid-json");
    });

    it("classifies a stale-source stderr code", async () => {
      const { promise } = await acquire({
        rawResult: (kind, raw) => (kind === "audit-file" ? result("", { ok: false, exitCode: 2, stderr: "STALE_SOURCE_EVIDENCE: src/a.ts changed" }) : raw),
      });
      await expectAcquisitionFailure(promise, "stale-evidence");
    });

    it("fails when Kit reports success but no index is not an index result", async () => {
      const { promise } = await acquire({ rawResult: (kind, raw) => (kind === "index" ? result(JSON.stringify({ mode: "search" })) : raw) });
      await expectAcquisitionFailure(promise, "artifact-invalid");
    });
  });

  describe("artifact and manifest validation", () => {
    it("fails when the audit artifact is missing", async () => {
      const { promise } = await acquire({ skipArtifact: true });
      await expectAcquisitionFailure(promise, "artifact-missing");
    });

    it("fails when the manifest checksum does not match", async () => {
      const { promise } = await acquire({ manifest: (manifest) => { manifest.sourceAuditEvidence.sha256 = "0".repeat(64); } });
      await expectAcquisitionFailure(promise, "artifact-invalid");
    });

    it("fails on a wrong artifact schema", async () => {
      const { promise } = await acquire({ artifact: (artifact) => { artifact.schemaVersion = "2.0.0"; } });
      await expectAcquisitionFailure(promise, "schema-mismatch");
    });

    it("fails on a wrong producer identity", async () => {
      const { promise } = await acquire({ artifact: (artifact) => { artifact.producer.packageVersion = "9.9.9"; } });
      await expectAcquisitionFailure(promise, "package-identity");
    });

    it("fails on a wrong source-root identity", async () => {
      const { promise } = await acquire({ rootsAreOverridden: ["lib"] });
      await expectAcquisitionFailure(promise, "root-mismatch");
    });

    it("fails when the artifact describes another project root", async () => {
      const { promise } = await acquire({ artifact: (artifact) => { artifact.source.projectRoot = "C:/elsewhere"; } });
      await expectAcquisitionFailure(promise, "root-mismatch");
    });
  });

  describe("page and traversal validation", () => {
    it("fails on mixed snapshot ids", async () => {
      const { promise } = await acquire({ factPage: (_path, _index, page) => ({ ...page, snapshotId: "9".repeat(64) }) });
      await expectAcquisitionFailure(promise, "snapshot-mismatch");
    });

    it("fails on duplicate fact identities across files", async () => {
      const { promise } = await acquire({
        factPage: (_path, _index, page) => ({ ...page, facts: page.facts.map((fact: any) => ({ ...fact, id: "audit-fact:shared#1" })) }),
      });
      await expectAcquisitionFailure(promise, "page-invalid");
    });

    it("fails on a repeated inventory page", async () => {
      const project = labProject();
      for (let index = 0; index < 70; index += 1) writeFiles(project, { [`src/gen/g${String(index).padStart(3, "0")}.ts`]: `export const g${index} = 1;\n` });
      const world = fakeWorld(project, { inventoryPage: (index, page) => (index === 1 ? { ...page, pageIndex: 0, nextPageIndex: 1, files: [] } : page) });
      await expectAcquisitionFailure(
        collectKitSourceFacts(
          { targetRoot: project, inventory: scanProjectInventory(project), requiredCapabilities: [], includeScriptsRoot: false },
          { installedPackageRoot: fakePackage(), expectation: FAKE_EXPECTATION, runCommand: world.runCommand }
        ),
        "page-invalid"
      );
    });

    it("fails on a missing terminal page", async () => {
      const { promise } = await acquire({ inventoryPage: (_index, page) => ({ ...page, totalPages: 2, totalItems: 65, nextPageIndex: 1 }) });
      await expectAcquisitionFailure(promise, "page-invalid");
    });

    it("fails on a path-traversal file identity", async () => {
      const { promise } = await acquire({
        inventoryPage: (_index, page) => ({ ...page, files: [{ ...page.files[0], path: "../escape.ts" }, ...page.files.slice(1)] }),
      });
      await expectAcquisitionFailure(promise, "path-invalid");
    });

    it("fails on incomplete enumeration (coverage mismatch)", async () => {
      const { promise } = await acquire({
        inventoryPage: (_index, page) => ({ ...page, coverage: { ...page.coverage, inventoryComplete: false } }),
        artifact: (artifact) => { artifact.coverage.inventoryComplete = false; },
      });
      await expectAcquisitionFailure(promise, "selection-incomplete");
    });
  });

  describe("selection and freshness", () => {
    it("fails when a required Lab file is missing from Kit's selection", async () => {
      const { promise } = await acquire({ droppedFromInventory: ["src/b.ts"] });
      const error = await expectAcquisitionFailure(promise, "selection-incomplete");
      expect(error.message).toContain("src/b.ts");
    });

    it("fails when a source changed between Lab's scan and Kit's index", async () => {
      const project = labProject();
      const inventory = scanProjectInventory(project);
      fs.appendFileSync(path.join(project, "src", "a.ts"), "// changed after Lab scanned it\n");
      const world = fakeWorld(project);
      await expectAcquisitionFailure(
        collectKitSourceFacts(
          { targetRoot: project, inventory, requiredCapabilities: ["declarations"], includeScriptsRoot: false },
          { installedPackageRoot: fakePackage(), expectation: FAKE_EXPECTATION, runCommand: world.runCommand }
        ),
        "stale-evidence"
      );
    });

    it("fails when the exact-file record disagrees with the inventory record", async () => {
      const { promise } = await acquire({ factPage: (_path, _index, page) => ({ ...page, file: { ...page.file, contentSha256: "7".repeat(64) } }) });
      await expectAcquisitionFailure(promise, "stale-evidence");
    });

    it.each([
      ["partial", "partial"],
      ["unsupported", "unsupported"],
      ["failed", "failed"],
    ])("fails when a required capability is %s", async (_label, status) => {
      const { promise } = await acquire({ capabilities: { imports: status } });
      await expectAcquisitionFailure(promise, "capability-insufficient");
    });

    it("fails when a required capability is missing from the record", async () => {
      const { promise } = await acquire({
        inventoryPage: (_index, page) => ({ ...page, files: page.files.map((file: any) => ({ ...file, capabilities: Object.fromEntries(Object.entries(file.capabilities).filter(([key]) => key !== "imports")) })) }),
      });
      await expectAcquisitionFailure(promise, "page-invalid");
    });

    it("does not require capabilities no selected detector needs", async () => {
      const { promise } = await acquire({ capabilities: { imports: "unsupported" } }, ["declarations"]);
      const snapshot = await promise;
      const file = snapshot.files[0]!;
      expect(file.kit?.capabilities.imports).toBe("unsupported");
      expect(file.diagnostics.some((diagnostic) => diagnostic.code === "kit:capability-unsupported")).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Exact installed private candidate (no fake commands)
// ---------------------------------------------------------------------------

describe("exact installed Kit candidate", () => {
  let packageHashBefore = "";
  beforeAll(() => {
    packageHashBefore = hashTree(CANDIDATE_ROOT);
  });

  it("resolves the qualified candidate identity with a contained CLI", () => {
    const pkg = resolveInstalledKitPackage({ expectation: installedExpectation, installedPackageRoot: CANDIDATE_ROOT });
    expect(pkg.packageName).toBe("@dailephd/my-dev-kit");
    expect(pkg.packageVersion).toBe(installedExpectation.packageVersion);
    expect(pkg.cliSha256).toBe(installedExpectation.cliSha256);
    expect(path.relative(fs.realpathSync(CANDIDATE_ROOT), pkg.cliPath)).toBe(path.join("dist", "cli.js"));
  });

  it("rejects the same installation when a different build is expected", () => {
    expect(() => resolveInstalledKitPackage({ installedPackageRoot: CANDIDATE_ROOT, expectation: { ...installedExpectation, cliSha256: "0".repeat(64) } })).toThrowError(/package-identity/);
    expect(() => resolveInstalledKitPackage({ installedPackageRoot: CANDIDATE_ROOT, expectation: { ...installedExpectation, extractorRevision: "source-audit-v9.9.9" } })).toThrowError(/extractor-mismatch/);
    expect(() => resolveInstalledKitPackage({ installedPackageRoot: CANDIDATE_ROOT, expectation: { ...installedExpectation, packageVersion: "9.9.9" } })).toThrowError(/package-identity/);
  });

  it("indexes a mixed-language fixture through the real CLI and adapts the facts", async () => {
    const project = tempDir("real-mixed");
    writeFiles(project, {
      "package.json": JSON.stringify({ name: "fx", version: "1.0.0" }),
      "src/main.ts": 'import { helper } from "./helper";\nexport function run(): number {\n  return helper();\n}\n',
      "src/helper.ts": "export function helper(): number { return 1; }\nexport class Box {}\n",
      "src/sample.py": '__all__ = ["pub"]\nimport os\ndef pub():\n    return 1\ndef _priv():\n    pass\n',
      "src/Sample.java": "package a;\npublic class Sample {\n  void pk() {}\n}\nclass Hidden {}\n",
      "src/Sample.kt": "package a\ninternal class Hidden\nfun top() {}\n",
      "tests/sample.test.ts": 'import { run } from "../src/main";\n// npm run build\ntest("x", () => { run(); });\n',
    });
    const targetBefore = hashTree(project);
    const calls: Array<{ executable?: string; args: string[] }> = [];
    const runCommand: KitCommandRunner = async (options) => {
      calls.push({ executable: options.executable, args: [...(options.args ?? [])] });
      return runMeasuredCommand(options);
    };
    const pkg = resolveInstalledKitPackage({ expectation: installedExpectation, installedPackageRoot: CANDIDATE_ROOT });
    const snapshot = await collectKitSourceFacts(
      { targetRoot: project, inventory: scanProjectInventory(project), requiredCapabilities: ["declarations", "imports"], includeScriptsRoot: false },
      { expectation: installedExpectation, installedPackageRoot: CANDIDATE_ROOT, runCommand }
    );

    // The installed candidate CLI was actually invoked.
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((call) => call.executable === process.execPath && call.args[0] === pkg.cliPath)).toBe(true);

    expect(snapshot.provider).toBe("kit");
    const evidence = snapshot.kitEvidence!;
    expect(evidence).toMatchObject({
      packageName: "@dailephd/my-dev-kit",
      packageVersion: installedExpectation.packageVersion,
      artifactSchemaVersion: "1.1.0",
      extractorRevision: "source-audit-v1.5.0",
      sourceRoots: ["src", "tests"],
      selectedFileCount: 6,
      traversalComplete: true,
    });
    expect(evidence.snapshotId).toMatch(/^[0-9a-f]{64}$/);
    // Output order is Lab's deterministic inventory order, not Kit's ordinal order.
    expect(snapshot.files.map((file) => file.relativePath)).toEqual([
      "src/helper.ts",
      "src/main.ts",
      "src/Sample.java",
      "src/Sample.kt",
      "src/sample.py",
      "tests/sample.test.ts",
    ]);

    const byPath = new Map(snapshot.files.map((file) => [file.relativePath, file]));
    const py = byPath.get("src/sample.py")!;
    expect(py.language).toBe("python");
    expect(py.exports[0]).toMatchObject({ name: "pub", exportOrigin: "python-all" });
    expect(py.declarations.find((d) => d.name === "_priv")).toMatchObject({ exported: false, exportState: "not-exported" });

    const java = byPath.get("src/Sample.java")!;
    expect(java.declarations.find((d) => d.name === "Sample")).toMatchObject({ visibility: "public", kind: "class" });
    expect(java.kit?.capabilities.exports).toBe("partial");
    expect(java.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(["kit:visibility-inferred-exports", "kit:capability-partial", "kit:capability-unsupported"]));

    const main = byPath.get("src/main.ts")!;
    expect(main.imports[0]).toMatchObject({ source: "./helper", importedNames: ["helper"], importResolution: "resolved-local", targetPaths: ["src/helper.ts"] });
    expect(main.imports[0]!.provenance).toMatchObject({ producer: "kit", startLine: 1 });
    expect(main.declarations[0]!.provenance?.factId).toMatch(/^audit-fact:/);

    // Kit-reported role/language are preserved as evidence.
    expect(byPath.get("tests/sample.test.ts")!.kit?.producerRole).toBe("test");

    // No write in the target, none in the installed package.
    expect(hashTree(project)).toBe(targetBefore);
    expect(hashTree(CANDIDATE_ROOT)).toBe(packageHashBefore);
  }, 180000);

  it("traverses multiple inventory pages and multiple fact pages with one snapshot id", async () => {
    const project = tempDir("real-pages");
    writeFiles(project, { "package.json": JSON.stringify({ name: "fx", version: "1.0.0" }) });
    for (let index = 0; index < 66; index += 1) writeFiles(project, { [`src/gen/g${String(index).padStart(3, "0")}.ts`]: `export const g${index} = ${index};\n` });
    writeFiles(project, { "src/big.ts": Array.from({ length: 130 }, (_, index) => `export const big${index} = ${index};`).join("\n") + "\n" });
    const snapshot = await collectKitSourceFacts(
      { targetRoot: project, inventory: scanProjectInventory(project), requiredCapabilities: ["declarations", "imports"], includeScriptsRoot: false },
      { expectation: installedExpectation, installedPackageRoot: CANDIDATE_ROOT }
    );
    expect(snapshot.kitEvidence?.selectedFileCount).toBe(67);
    expect(snapshot.kitEvidence?.inventoryPages).toBe(2);
    // big.ts yields a declaration and an export fact per constant: 260 facts = 3 pages.
    expect(snapshot.kitEvidence?.factPages).toBe(66 + 3);
    expect(snapshot.files.find((file) => file.relativePath === "src/big.ts")!.declarations).toHaveLength(130);
  }, 240000);

  it("fails stale when a source file changes after Lab's scan", async () => {
    const project = tempDir("real-stale");
    writeFiles(project, { "package.json": JSON.stringify({ name: "fx", version: "1.0.0" }), "src/a.ts": "export const a = 1;\n" });
    const inventory = scanProjectInventory(project);
    fs.writeFileSync(path.join(project, "src", "a.ts"), "export const a = 123456;\n");
    await expectAcquisitionFailure(
      collectKitSourceFacts({ targetRoot: project, inventory, requiredCapabilities: ["declarations"], includeScriptsRoot: false }, { expectation: installedExpectation, installedPackageRoot: CANDIDATE_ROOT }),
      "stale-evidence"
    );
  }, 120000);

  it("selects Lab source outside the conventional roots with validated evidence", async () => {
    const project = tempDir("real-outside");
    writeFiles(project, { "package.json": JSON.stringify({ name: "fx", version: "1.0.0" }), "src/a.ts": "export const a = 1;\n", "lib/b.ts": "export const b = 1;\n" });
    const facts = await collectKitSourceFacts(
        { targetRoot: project, inventory: scanProjectInventory(project), requiredCapabilities: ["declarations"], includeScriptsRoot: false },
        { expectation: installedExpectation, installedPackageRoot: CANDIDATE_ROOT }
      );
    expect(facts.kitEvidence?.sourceRoots).toEqual(["lib", "src"]);
    expect(facts.files.map((file) => file.relativePath)).toEqual(["lib/b.ts", "src/a.ts"]);
  }, 120000);
});

it("accepts the exact published 1.15.0 provider and authenticates its selected source", async () => {
  const published = path.join(process.cwd(), "node_modules/@dailephd/my-dev-kit");
  const pkg = resolveInstalledKitPackage({ installedPackageRoot: published });
  expect(pkg.packageVersion).toBe("1.15.0");
  expect(pkg.cliSha256).toBe("ac66e5a4a06b48f7a7bbbf03734002bd6686cc6aa2343d097ff374f52fcb486f");
  const project = tempDir("published-source");
  writeFiles(project, { "src/main.ts": "export const answer = 42;\n" });
  for (let i = 0; i < 66; i++) writeFiles(project, { [`src/g${i}.ts`]: `export const g${i} = ${i};\n` });
  writeFiles(project, { "src/big.ts": Array.from({ length: 130 }, (_, i) => `export const item${i} = ${i};`).join("\n") });
  const snapshot = await collectKitSourceFacts(
    { targetRoot: project, inventory: scanProjectInventory(project), requiredCapabilities: ["declarations"], includeScriptsRoot: false },
    { installedPackageRoot: published }
  );
  expect(snapshot.files.find(f => f.relativePath === "src/main.ts")!.declarations.some(d => d.name === "answer")).toBe(true);
  expect(snapshot.kitEvidence?.inventoryPages).toBe(2);
  expect(snapshot.files.find(f => f.relativePath === "src/big.ts")!.declarations).toHaveLength(130);
  expect(snapshot.kitEvidence!.factPages).toBeGreaterThan(snapshot.files.length);
  expect(snapshot.kitEvidence?.packageVersion).toBe("1.15.0");
}, 120000);
describe("partial-import deferral never relaxes evidence integrity", () => {
  it.each<[string, Mutators, string]>([
    ["schema", {artifact: a => {a.schemaVersion = "invalid";}}, "schema-mismatch"],
    ["artifact hash", {manifest: m => {m.sourceAuditEvidence.sha256 = "0".repeat(64);}}, "artifact-invalid"],
    ["producer", {artifact: a => {a.producer.packageVersion = "9.9.9";}}, "package-identity"],
    ["selection", {droppedFromInventory: ["src/b.ts"]}, "selection-incomplete"],
    ["source hash", {factPage: (_p,_i,page) => ({...page,file:{...page.file,contentSha256:"7".repeat(64)}})}, "stale-evidence"],
    ["snapshot", {factPage: (_p,_i,page) => ({...page,snapshotId:"9".repeat(64)})}, "snapshot-mismatch"],
    ["truncated stream", {rawResult: (kind,raw) => kind === "audit-files" ? result('{"schemaVersion":', {ok:false,outputLimit:{stream:"stdout",limitBytes:8388608}}) : raw}, "output-limit"],
    ["corrupt facts", {factPage: (_p,_i,page) => ({...page,facts:page.facts.map((f:any)=>({...f,span:{...f.span,path:"../escape.ts"}}))})}, "path-invalid"],
  ])("refuses %s with its established category", async (_name,mutators,category) => {
    const project=labProject(), world=fakeWorld(project,mutators);
    await expectAcquisitionFailure(collectKitSourceFacts({targetRoot:project,inventory:scanProjectInventory(project),requiredCapabilities:["declarations","imports"],includeScriptsRoot:false,deferPartialImports:true},
      {installedPackageRoot:fakePackage(),expectation:FAKE_EXPECTATION,runCommand:world.runCommand}), category);
  });
});

const p6R8Package = process.env.LAB_SW123_P6_R8_PACKAGE_ROOT;
it.skipIf(!p6R8Package)("qualifies the P6-R7 import and bounded ranges without admitting unrelated proof profiles", async () => {
  const expectation = QUALIFIED_SW123_P6_R7_KIT;
  const installedPackageRoot = p6R8Package!;
  expect(resolveInstalledKitPackage({ installedPackageRoot, expectation })).toMatchObject({
    packageVersion: "1.15.1", cliSha256: expectation.cliSha256,
  });
  for (const [override, category] of [
    [{ cliSha256: "0".repeat(64) }, "package-identity"],
    [{ cliSha256: null }, "package-identity"],
    [{ extractorRevision: "source-audit-v1.5.2" }, "extractor-mismatch"],
    [{ packageVersion: "1.15.2" }, "package-identity"],
    [{ artifactSchemaVersion: "1.0.0" }, "schema-mismatch"],
  ] as const) {
    expect(() => resolveInstalledKitPackage({
      installedPackageRoot, expectation: { ...expectation, ...override },
    })).toThrowError(new RegExp(category));
  }

  const root = tempDir("p6-r8");
  const origin = "tests/check.test.ts";
  const source = 'const target = "../src/peer.js";\nexport const load = () => import(target);\n';
  writeFiles(root, { "package.json": '{"name":"p6-r8","version":"0.0.0"}', [origin]: source,
    "src/peer.ts": "export const value = 1;\n" });
  const detector = DEFAULT_AUDIT_REGISTRY.find(entry => entry.id === "test-rot")!;
  const result = await runAudit({
    config: normalizeAuditConfig({ target: root, include: "tests", failOn: "none" }, root),
    toolRoot: root,
    registry: [{ ...detector, async run(ctx) {
      const reader = ctx.kitSourceReader!;
      expect(reader.jsTsRelativeImportCandidateProof).toBeUndefined();
      expect(reader.jsonRawLiteralContent).toBeUndefined();
      expect(reader.reExportTargets).toBeUndefined();
      expect(await reader.authenticatedContent!(origin)).toBe(source);
      const facts = ctx.sourceFacts!.files.find(file => file.relativePath === origin)!;
      expect(qualifyKitImportPredicate(facts)).toBe("QUALIFIED_NEGATIVE");
      const fact = facts.imports.find(f => f.source === "../src/peer.js")!;
      expect(qualifyKitImportPredicate(facts, fact)).toBe("QUALIFIED_POSITIVE");
      expect(await reader.importTarget(fact.provenance!.factId)).toMatchObject({
        status: "present", originFile: origin, candidatePaths: ["src/peer.ts"],
      });
      return detector.run(ctx);
    } }],
    kitSourceProviderDependencies: { installedPackageRoot, expectation },
  });
  expect(result.exitCode).toBe(0);
  expect(result.detectorErrors).toEqual([]);
  expect(result.issues).toEqual([]);
  expect(result.coverage?.some(record => record.mandatory && record.status === "UNAVAILABLE")).toBe(false);
}, 120000);

// Opt-in installed artifact qualification. The unpublished subject is never
// substituted for the production dependency or the default provider identity.
const p6Root = process.env.LAB_SW123_P6_R3_ROOT;
const p6Package = process.env.LAB_SW123_P6_R3_PACKAGE_ROOT;
if (Boolean(p6Root) !== Boolean(p6Package) || (p6Root && (process.env.LAB_SW123_P5_ROOT || process.env.LAB_SW123_P5_PACKAGE_ROOT))) {
  throw new Error("Select one complete SW123 qualification lane.");
}
const p5Root = p6Root ?? process.env.LAB_SW123_P5_ROOT;
const p5Package = p6Package ?? process.env.LAB_SW123_P5_PACKAGE_ROOT;
if (p5Root || p5Package) {
  if (!p5Root || !p5Package) throw new Error("P5 requires both its owned workspace and installed package root.");
  const workspace = fs.realpathSync(p5Root);
  const installed = fs.realpathSync(p5Package);
  const expectation: KitCandidateExpectation = p6Root ? QUALIFIED_SW123_P6_R2_KIT : {
    packageName: "@dailephd/my-dev-kit", packageVersion: "1.15.1",
    artifactSchemaVersion: "1.1.0", extractorRevision: "source-audit-v1.5.1",
    cliSha256: "591109bd72d4f423865e65eac28e216a754c7abdb470d1df21066c6edc8522eb",
  };
  const ownedDirectory = (area: string, label: string) => {
    const parent = fs.realpathSync(path.join(workspace, area));
    const relative = path.relative(workspace, parent);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Uncontained P5 output.");
    return fs.mkdtempSync(path.join(parent, label + "-"));
  };
  const evidenceDirectory = ownedDirectory(p6Root ? "qualification" : "candidate-results", "native-tests");
  const save = (label: string, value: unknown) => fs.writeFileSync(path.join(evidenceDirectory, label + ".json"), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  const target = (label: string, files: Record<string, string>) => {
    const root = ownedDirectory(p6Root ? "raw-reader" : "integration-target", label);
    writeFiles(root, { "package.json": JSON.stringify({ name: label, version: "1.0.0", scripts: { test: "vitest run" } }), ...files });
    return root;
  };
  const dependencies = (label: string, mutate?: (args: string[], index: string) => void) => {
    const workDir = ownedDirectory(p6Root ? "negative-cases" : "integration-index", label), calls: unknown[] = [];
    const runCommand: KitCommandRunner = async options => {
      const result = await runMeasuredCommand(options);
      const args = [...(options.args ?? [])];
      calls.push({ executable: options.executable, args, ok: result.ok, exitCode: result.exitCode,
        stdoutSha256: createHash("sha256").update(result.stdout).digest("hex"), stderr: result.stderr });
      if (result.ok && args[1] === "index") mutate?.(args, path.join(workDir, "index"));
      return result;
    };
    return { deps: { installedPackageRoot: installed, expectation, workDir, runCommand }, calls, workDir };
  };
  const config = (root: string, include = "docs,tests,package,architecture,cli", failOn = "none") =>
    normalizeAuditConfig({ target: root, include, failOn, out: path.join(evidenceDirectory, "reports") }, process.cwd());

  describe(p6Root ? "SW123 P6-R3 installed candidate" : "SW123 P5 installed candidate", () => {
    if (p6Root) it("qualifies P6-R2 selected unsupported text and static re-export facts through the installed reader", async () => {
      const root = target("selected-raw-and-reexport", {
        "src/main.ts": "import './peer.js';\nexport { value as alias } from './peer.js';\nexport const direct = 1;\n",
        "src/peer.ts": "export const value = 1;\n",
        "src/cycle.ts": "export { alias } from './main.js';\nexport * from './cycle.js';\nexport * from 'external';\n",
        "src/raw.xml": "<raw>witness</raw>\n",
        "src/empty.xml": "",
        "src/many.xml": "witness ".repeat(201),
        "src/large.xml": "x".repeat(200001),
        "src/binary.properties": "abc\0defghij",
        "src/invalid.xml": "invalid",
        "scripts/unselected.xml": "witness",
      });
      fs.writeFileSync(path.join(root, "src/invalid.xml"), Buffer.from([0xc3, 0x28]));
      const bridge = dependencies("selected-raw-and-reexport");
      let reader: import("../../src/audits/core/kitSourceProvider.js").KitSourceReader | undefined;
      try {
        const result = await collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root),
          requiredCapabilities: ["imports", "exports"], requiredPaths: ["src/main.ts", "src/peer.ts", "src/cycle.ts"],
          includeScriptsRoot: false, onReader: value => { reader = value; } }, bridge.deps);
        const r = reader!;
        expect(result.files.map(file => file.relativePath)).not.toContain("src/raw.xml");
        expect(r.selectedFile("src/raw.xml")).toMatchObject({ status: "unsupported",
          capabilities: { imports: "unsupported", exports: "unsupported", declarations: "unsupported" } });
        const raw = await r.occurrences("src/raw.xml", "witness");
        expect(raw).toMatchObject({ complete: true, matchCount: 1 });
        expect(await r.authenticatedContent!("src/raw.xml")).toBe("<raw>witness</raw>\n");
        await expect(r.authenticatedContent!("src/empty.xml")).rejects.toMatchObject({ category: "capability-insufficient" });
        expect(await r.occurrences("src/empty.xml", "witness")).toMatchObject({ complete: true, matchCount: 0 });
        expect(await r.authenticatedContent!("src/empty.xml")).toBe("");
        expect(await r.occurrences("src/many.xml", "witness")).toMatchObject({ complete: false, truncated: true, matchCount: 201 });
        for (const file of ["src/large.xml", "src/binary.properties", "src/invalid.xml"]) {
          expect(() => r.selectedFile(file)).toThrow(/capability-insufficient/);
        }
        expect(() => r.occurrences("scripts/unselected.xml", "witness")).toThrow(/selection-incomplete/);
        expect(() => r.occurrences("../outside.xml", "witness")).toThrow(/path-invalid/);
        const main = result.files.find(file => file.relativePath === "src/main.ts")!;
        const imp = await r.importTarget(main.imports[0]!.provenance!.factId);
        const staticExport = r.reExportTargets!("src/main.ts")[0]!;
        const proof = await r.importTarget(staticExport.id);
        expect(proof).toMatchObject({ importFactId: staticExport.id, originFile: "src/main.ts",
          sourceSpecifier: "./peer.js", status: "present", candidatePaths: ["src/peer.ts"],
          selectionComplete: true, reasonCode: "TARGET_IN_SELECTED_INVENTORY" });
        expect(imp).toMatchObject({ status: "present", candidatePaths: ["src/peer.ts"] });
        const direct = main.exports.find(fact => fact.name === "direct")!;
        expect(() => r.importTarget(direct.provenance!.factId)).toThrow(/invalid-request/);
        expect(() => r.importTarget(staticExport.id + "-fabricated")).toThrow(/invalid-request/);
        const cycle = r.reExportTargets!("src/cycle.ts");
        const external = cycle.find(fact => fact.sourceSpecifier === "external")!;
        expect(await r.importTarget(external.id)).toMatchObject({ status: "indeterminate" });
        const self = cycle.find(fact => fact.sourceSpecifier === "./cycle.js")!;
        expect(await r.importTarget(self.id)).toMatchObject({ status: "present", candidatePaths: ["src/cycle.ts"] });
        fs.writeFileSync(path.join(root, "src/raw.xml"), "<raw>changed</raw>\n");
        await expect(r.occurrences("src/raw.xml", "changed")).rejects.toMatchObject({ category: "stale-evidence" });
        save("selected-raw-and-reexport", { raw, imp, proof, calls: bridge.calls, workDir: bridge.workDir });
      } finally { reader?.dispose(); }
    }, 120000);

    if (p6Root) it("uses immediate re-export proofs in test-rot and rejects a mismatched returned origin", async () => {
      const root = target("reexport-predicate", {
        "tests/reexport.test.ts": "export { value } from '../src/peer.js';\nexport * from './gone.js';\n",
        "src/peer.ts": "export const value = 1;\n",
      });
      const run = (bridge: ReturnType<typeof dependencies>) => runAudit({
        config: config(root, "tests", "medium"), toolRoot: root,
        registry: DEFAULT_AUDIT_REGISTRY.filter(detector => detector.id === "test-rot"),
        kitSourceProviderDependencies: bridge.deps,
      });
      const bridge = dependencies("reexport-predicate");
      const result = await run(bridge);
      expect(result.issues.map(issue => issue.id)).toEqual(["test-rot:tests/reexport.test.ts:missing-source-import:./gone.js"]);
      expect(result.exitCode).toBe(1);
      expect(result.coverage?.some(gap => gap.predicate === "missing-source-import" && gap.status === "UNAVAILABLE")).toBe(false);
      const corrupt = dependencies("reexport-origin-mismatch");
      const native = corrupt.deps.runCommand;
      corrupt.deps.runCommand = async options => {
        const response = await native(options);
        if (!response.ok || !options.args?.includes("--audit-import-target")) return response;
        return { ...response, stdout: JSON.stringify({ ...JSON.parse(response.stdout), originFile: "src/peer.ts" }) };
      };
      await expect(run(corrupt)).rejects.toMatchObject({ category: "artifact-invalid" });
      save("reexport-predicate", { result, calls: bridge.calls, mismatchedCalls: corrupt.calls });
    }, 120000);

    it.each(["complete", "partial"])("qualifies command-only JSON from %s literal evidence without demanding unrelated whole content", async mode => {
      const file = "tests/packet.json";
      const body = JSON.stringify({ before: Array.from({ length: 180 }, (_, i) => `before ${i}`),
        commands: Array.from({ length: mode === "partial" ? 201 : 1 }, () => "npm run removed"),
        after: Array.from({ length: 180 }, (_, i) => `after ${i}`) }, null, 2) + "\n";
      const root = target("raw-command-" + mode, { [file]: body });
      const bridge = dependencies("raw-command-" + mode);
      const result = await runAudit({ config: config(root, "tests", "none"), toolRoot: root,
        registry: DEFAULT_AUDIT_REGISTRY.filter(detector => detector.id === "test-rot"), kitSourceProviderDependencies: bridge.deps });
      expect(result.sourceFacts.files.find(entry => entry.relativePath === file)!.kit!.capabilities.imports).toBe("unsupported");
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.id).toBe("test-rot:tests/packet.json:stale-npm-run-reference:removed");
      expect(result.issues[0]!.severity).toBe("medium");
      expect(result.exitCode).toBe(mode === "partial" ? 2 : 0);
      expect(result.coverage?.some(record => record.predicate === "bounded-content predicates" && record.status === "UNAVAILABLE")).toBe(mode === "partial");
      expect(result.coverage?.some(record => record.predicate === "bounded-content predicates" && record.status === "QUALIFIED")).toBe(mode === "complete");
      save("raw-command-" + mode, { result, calls: bridge.calls, workDir: bridge.workDir });
    }, 120000);

    it("authenticates empty selected source bytes without requesting a nonexistent first line", async () => {
      const root = target("empty-raw-content", {
        "tests/check.test.ts": "export {};\n",
        "tests/fixtures/python/src/__init__.py": "",
      });
      const bridge = dependencies("empty-raw-content");
      let reader: import("../../src/audits/core/kitSourceProvider.js").KitSourceReader | undefined;
      try {
        await collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root),
          requiredCapabilities: [], requiredPaths: ["tests/check.test.ts", "tests/fixtures/python/src/__init__.py"],
          includeScriptsRoot: false, onReader: value => { reader = value; } }, bridge.deps);
        const file = reader!.selectedFile("tests/fixtures/python/src/__init__.py");
        expect(file.sizeBytes).toBe(0);
        expect(file.contentSha256).toBe(createHash("sha256").update("").digest("hex"));
        expect(await reader!.authenticatedContent!(file.path)).toBe("");
        expect(bridge.calls.some(call => (call as { args: string[] }).args.includes("--start"))).toBe(false);
        save("empty-raw-content", { file, calls: bridge.calls, workDir: bridge.workDir });
      } finally { reader?.dispose(); }
    }, 120000);

    it("qualifies raw JSON bytes independently of a truncated literal-match inventory", async () => {
      const root = target("partial-literal-complete-bytes", {
        "tests/payload.json": JSON.stringify({ text: "it ".repeat(201) }) + "\n",
        "tests/long.test.ts": "// it\n".repeat(201) + "export {};\n",
      });
      const bridge = dependencies("partial-literal-complete-bytes");
      const result = await runAudit({ config: config(root, "tests"), toolRoot: root,
        registry: DEFAULT_AUDIT_REGISTRY.filter(detector => detector.id === "test-rot").map(detector => ({ ...detector, run: async ctx => {
          expect(await kitPredicateContent(ctx.kitSourceReader, "tests/payload.json", ["it"])).toBe(JSON.stringify({ text: "it ".repeat(201) }) + "\n");
          expect(await kitPredicateContent(ctx.kitSourceReader, "tests/long.test.ts", ["it"])).toBe("// it\n".repeat(201) + "export {};\n");
          return detector.run(ctx);
        } })), kitSourceProviderDependencies: bridge.deps });
      expect(result.exitCode).toBe(0);
      expect(result.issues).toEqual([]);
      expect(result.detectorErrors).toEqual([]);
      expect(result.sourceFacts.files.find(file => file.relativePath === "tests/payload.json")!.kit!.capabilities.imports).toBe("unsupported");
      save("partial-literal-complete-bytes", { result, calls: bridge.calls, workDir: bridge.workDir });
    }, 120000);

    it("retains authenticated positive fixture and re-export identities without claiming their domains complete", async () => {
      const root = target("positive-references", {
        "tests/check.test.ts": 'const fixture = path.resolve(process.cwd(), "tests/fixtures/payload.json");\n',
        "tests/fixtures/payload.json": '{"value":"payload"}\n',
        "src/thing.ts": "export const thing = 1;\n",
        "src/reexport.ts": 'export { thing } from "./thing.js";\n',
      });
      const bridge = dependencies("positive-references");
      let reader: import("../../src/audits/core/kitSourceProvider.js").KitSourceReader | undefined;
      try {
        const facts = await collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root),
          requiredCapabilities: [], requiredPaths: ["tests/check.test.ts", "src/reexport.ts", "src/thing.ts"],
          includeScriptsRoot: false, onReader: value => { reader = value; } }, bridge.deps);
        expect(reader!.fixtureReferenceBasenames!("tests/check.test.ts")).toContain("payload.json");
        expect(reader!.reExportSpecifiers!("src/reexport.ts")).toEqual(["./thing.js"]);
        await reader!.occurrences("tests/fixtures/payload.json", '"');
        expect(await reader!.authenticatedContent!("tests/fixtures/payload.json")).toBe('{"value":"payload"}\n');
        expect(facts.files.find(file => file.relativePath === "tests/check.test.ts")!.kit!.capabilities["fixture-references"]).toBe("partial");
        expect(() => reader!.fixtureReferenceBasenames!("../escape.ts")).toThrow();
        save("positive-references", { facts, calls: bridge.calls, workDir: bridge.workDir });
      } finally { reader?.dispose(); }
      expect(() => reader!.reExportSpecifiers!("src/reexport.ts")).toThrow(/closed/);
    }, 120000);

    it("keeps freshly generated historical 1.15.0 Kotlin evidence partial under its separate original producer profile", async () => {
      const relative = "tests/fixtures/config.gradle.kts", root = target("historical-contract", {
        "tests/reference.test.ts": "const fixture='config.gradle.kts'; test('fixture reference',()=>void fixture);\n",
      });
      const source = "tests/fixtures/android/advanced-security-fixtures/release-configuration/kotlin-release-debuggable-false.gradle.kts";
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), fs.readFileSync(source), { flag: "wx" });
      const bridge = dependencies("historical-contract");
      const result = await runAudit({ config: config(root, "tests"), toolRoot: root, kitSourceProviderDependencies: {
        ...bridge.deps, installedPackageRoot: path.resolve("node_modules/@dailephd/my-dev-kit"), expectation: QUALIFIED_PUBLISHED_KIT,
      } });
      const file = result.sourceFacts.files.find(f => f.relativePath === relative)!;
      expect(file.kit!.capabilities).toMatchObject({ declarations: "partial", imports: "partial", jvmDeclarations: "unsupported" });
      expect(qualifyKitImportPredicate(file)).toBe("UNAVAILABLE");
      expect(file.diagnostics.some(d => d.code === "kit:kotlin-script-statement")).toBe(true);
      expect(result.exitCode).toBe(0); // Current configuration applicability, not the old whole-source audit.
      save("historical-contract", { evidenceKind: "fresh historical-producer contract regression; not original incident artifact", result, workDir: bridge.workDir, calls: bridge.calls });
    }, 120000);

    if (!p6Root) it("binds the installed archive identity and exact current Gradle fixture without executable-test obligations", async () => {
      expect(resolveInstalledKitPackage({ installedPackageRoot: installed, expectation })).toMatchObject({
        packageName: expectation.packageName, packageVersion: "1.15.1", cliSha256: expectation.cliSha256,
      });
      expect(QUALIFIED_PUBLISHED_KIT.packageVersion).toBe("1.15.0");
      expect(() => resolveInstalledKitPackage({ installedPackageRoot: installed })).toThrowError(/package-identity/);
      const relative = "tests/fixtures/android/advanced-security-fixtures/release-configuration/kotlin-release-debuggable-false.gradle.kts";
      const bytes = fs.readFileSync(relative), root = target("exact-gradle", {
        "tests/reference.test.ts": "const fixture = 'kotlin-release-debuggable-false.gradle.kts'; test('fixture reference',()=>void fixture);\n",
      });
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), bytes, { flag: "wx" });
      const bridge = dependencies("exact-gradle");
      const result = await runAudit({ config: config(root, "tests"), toolRoot: root, kitSourceProviderDependencies: bridge.deps });
      const artifact = JSON.parse(fs.readFileSync(path.join(bridge.workDir, "index/source-audit-evidence.json"), "utf8"));
      const record = artifact.files.find((f: {path: string}) => f.path === relative);
      expect(record.contentSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(record.capabilities).toMatchObject({ declarations: "partial", imports: "complete", jvmDeclarations: "unsupported", exports: "partial", "source-ranges": "partial" });
      const file = result.sourceFacts.files.find(f => f.relativePath === relative)!;
      expect(file.role).toBe("config");
      expect(file.imports).toEqual([]);
      expect(file.diagnostics.some(d => d.code === "kit:kotlin-script-statement")).toBe(true);
      expect(qualifyKitImportPredicate(file)).toBe("QUALIFIED_NEGATIVE");
      expect(qualifyKitDeclarationPredicate(file)).toBe("UNAVAILABLE");
      expect(result.exitCode).toBe(0);
      expect(result.detectorErrors).toEqual([]);
      expect(result.issues).toEqual([]);
      expect(result.coverage!.filter(c => c.source.identity === relative && c.capability === "imports").every(c => c.status === "NOT_APPLICABLE")).toBe(true);
      expect(bridge.calls.length).toBeGreaterThan(2);
      save("exact-gradle", { fixtureSha256: record.contentSha256, record, artifactSource: artifact.source, result, calls: bridge.calls, workDir: bridge.workDir });
    }, 120000);

    it.each(["\n", "\r\n"])("authenticates contiguous large-file Kit ranges with %j newlines before registry predicates", async newline => {
      const text = ['const DETECTOR_ID = "shared";', 'export const detector = { id: DETECTOR_ID };',
        ...Array.from({ length: 300 }, (_, i) => `// padding ${i}`), ''].join(newline);
      const root = target("whole-context", { "src/detectors/a.ts": text, "src/detectors/b.ts": text });
      const bridge = dependencies("whole-context");
      const result = await runAudit({ config: config(root), toolRoot: root,
        registry: DEFAULT_AUDIT_REGISTRY.filter(d => d.id === "duplicate-implementation-candidate"),
        kitSourceProviderDependencies: bridge.deps });
      const duplicates = result.issues.filter(i => i.id.includes("duplicate-detector-id"));
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]).toMatchObject({ severity: "medium", confidence: "medium" });
      expect(result.detectorErrors).toEqual([]);
      expect(result.exitCode).toBe(0);
      expect((bridge.calls as { args: string[] }[]).some(c => c.args.includes("--start"))).toBe(true);
      save("whole-context-" + (newline === "\n" ? "lf" : "crlf"), { result, calls: bridge.calls, workDir: bridge.workDir });
    }, 120000);

    it.each(["\n", "\r\n"])("authenticates bounded large selected JSON occurrence windows (%j)", async newline => {
      const relative = "tests/fixtures/repeated.json";
      const json = JSON.stringify({ title: "it ".repeat(200), padding: "x".repeat(38000), command: "npm run vanished" }) + newline;
      const root = target("json-context", { [relative]: json });
      const bridge = dependencies("json-context");
      const result = await runAudit({ config: config(root), toolRoot: root,
        registry: DEFAULT_AUDIT_REGISTRY.filter(d => d.id === "test-rot"), kitSourceProviderDependencies: bridge.deps });
      expect(result.issues.some(i => i.affectedFiles.includes(relative) && i.title.includes("npm run vanished"))).toBe(true);
      expect(result.detectorErrors).toEqual([]);
      const calls = bridge.calls as { args: string[] }[];
      expect(calls.some(c => c.args.includes(relative) && c.args.includes("--contains"))).toBe(true);
      save("json-context-" + (newline === "\n" ? "lf" : "crlf"), { result, calls, workDir: bridge.workDir });
    }, 120000);

    it("retains generated/vendor test-fixture raw checks without semantic import obligations", async () => {
      const root = target("generated-test-inputs", {
        "tests/fixtures/generated/schema.ts": "// npm run vanished-generated\nexport type Schema = { id: string };\n",
        "tests/fixtures/vendor/lib.py": "# npm run vanished-vendor\ndef helper():\n    return 1\n",
      });
      const bridge = dependencies("generated-test-inputs");
      const result = await runAudit({ config: config(root), toolRoot: root,
        registry: DEFAULT_AUDIT_REGISTRY.filter(d => d.id === "test-rot"), kitSourceProviderDependencies: bridge.deps });
      expect(result.issues.map(i => i.title)).toEqual([
        expect.stringContaining("vanished-generated"), expect.stringContaining("vanished-vendor"),
      ]);
      expect(result.detectorErrors).toEqual([]);
      expect(result.coverage!.some(c => c.mandatory && c.capability === "imports")).toBe(false);
      expect(result.coverage!.filter(c => c.capability === "raw-content").every(c => c.status === "QUALIFIED")).toBe(true);
      expect(result.exitCode).toBe(0);
      save("generated-test-inputs", { result, calls: bridge.calls, workDir: bridge.workDir });
    }, 120000);

    it("bounds concurrent test-file reads and preserves finding and unavailable-predicate order", async () => {
      const paths = ["tests/a.test.ts", "tests/b.test.ts", "tests/c.test.ts", "tests/d.test.ts"];
      const root = target("ordered-test-reads", Object.fromEntries(paths.map(file => [file,
        "const target='./unknown.js'; void import(target); test.only('qualified positive',()=>{});\n"])));
      const bridge = dependencies("ordered-test-reads");
      const original = bridge.deps.runCommand;
      let active = 0, peak = 0;
      bridge.deps.runCommand = async options => {
        if (options.args?.[1] !== "source") return original(options);
        active++; peak = Math.max(peak, active);
        try { return await original(options); } finally { active--; }
      };
      const result = await runAudit({ config: config(root), toolRoot: root,
        registry: DEFAULT_AUDIT_REGISTRY.filter(d => d.id === "test-rot"), kitSourceProviderDependencies: bridge.deps });
      expect(peak).toBe(4);
      expect(result.issues.map(i => i.affectedFiles[0])).toEqual(paths);
      expect(result.coverage!.filter(c => c.mandatory && c.status === "UNAVAILABLE").map(c => c.source.identity)).toEqual(paths);
      expect(result.exitCode).toBe(2);
      save("ordered-test-reads", { result, peak, calls: bridge.calls, workDir: bridge.workDir });
    }, 120000);

    it.each(["content", "coordinates", "path", "null"])("rejects synthetic whole-context range %s corruption without native fallback", async corruption => {
      const text = 'const DETECTOR_ID = "shared";\nexport const detector = { id: DETECTOR_ID };\n' + '// padding\n'.repeat(300);
      const root = target("invalid-context", { "src/detectors/a.ts": text });
      const bridge = dependencies("invalid-context");
      let changed = false;
      const original = bridge.deps.runCommand;
      const runCommand: KitCommandRunner = async options => {
        const result = await original(options);
        if (options.args?.includes("--start") && result.ok) {
          if (corruption === "null") { changed = true; return { ...result, stdout: "null" }; }
          const raw = JSON.parse(result.stdout);
          if (corruption === "content") raw.content = raw.content.replace("shared", "forged");
          if (corruption === "coordinates") raw.startLine++;
          if (corruption === "path") raw.filePath = "src/other.ts";
          changed = true;
          return { ...result, stdout: JSON.stringify(raw) };
        }
        return result;
      };
      await expect(runAudit({ config: config(root), toolRoot: root,
        registry: DEFAULT_AUDIT_REGISTRY.filter(d => d.id === "duplicate-implementation-candidate"),
        kitSourceProviderDependencies: { ...bridge.deps, runCommand } })).rejects.toMatchObject({
          category: corruption === "content" ? "stale-evidence" : "artifact-invalid",
        });
      expect(changed).toBe(true);
      save("invalid-context-" + corruption, { syntheticCorruption: corruption, calls: bridge.calls });
    }, 120000);

    it("keeps a corrupt concurrently requested import proof fatal", async () => {
      const root = target("invalid-parallel-proof", {
        "src/a.ts": "import './target.js';\n",
        "src/b.ts": "import './target.js';\n",
        "src/target.ts": "export const target = 1;\n",
      });
      const bridge = dependencies("invalid-parallel-proof");
      const original = bridge.deps.runCommand;
      let corrupted = false;
      const runCommand: KitCommandRunner = async options => {
        const result = await original(options);
        if (options.args?.includes("--audit-import-target") && result.ok) {
          corrupted = true;
          return { ...result, stdout: JSON.stringify({ ...JSON.parse(result.stdout), snapshotId: "0".repeat(64) }) };
        }
        return result;
      };
      await expect(runAudit({ config: config(root), toolRoot: root,
        registry: DEFAULT_AUDIT_REGISTRY.filter(d => d.id === "dead-code-candidate"),
        kitSourceProviderDependencies: { ...bridge.deps, runCommand } })).rejects.toMatchObject({ category: "snapshot-mismatch" });
      expect(corrupted).toBe(true);
      save("invalid-parallel-proof", { syntheticProofCorruption: "snapshot", calls: bridge.calls });
    }, 120000);

    it("retains mixed-capability positives, independent findings and separate mandatory gaps deterministically", async () => {
      const root = target("mixed", {
        "src/NoImports.kts": 'class ScriptPresent {}\nprintln("statement")\n',
        "src/Explicit.kts": 'import java.io.File\nprintln("statement")\n',
        "src/Ambiguous.kts": 'import java.io.File as\nclass Observed {}\n',
        "src/main/kotlin/com/example/Present.kt": 'package com.example\nclass Present {}\n',
        "src/main/java/com/example/Stable.java": 'package com.example;\npublic class Stable {}\n',
        "src/helper.py": 'def python_present():\n    return 1\n',
        "src/lib.rs": 'pub fn rust_present() -> u32 { 1 }\n',
        "src/plain.js": 'export const jsPresent = 1;\n',
        "src/dynamic.js": "import './plain.js'; export const retainedJS=1; const target='./unknown.js'; void import(target);\n",
        "src/partial.ts": 'export function retained() { return 1; } const target="./unknown.js"; void import(target);\n',
        "src/importer.ts": "import '../unselected/hidden.js';\n",
        "src/candidate.ts": 'export const candidate = 1;\n',
        "src/old/retired.ts": '// independent deprecated candidate\n',
        "src/orphan.generated.ts": '// independent generated candidate\n',
        "tests/real.test.ts": "import '../src/candidate.js';\nimport '../src/plain.js';\ntest.only('independent finding',()=>{});\n",
        "tests/fixtures/config.gradle.kts": '// npm run vanished\nandroid { buildTypes { release { isDebuggable = false } } }\n',
        "README.md": 'Security validation is implemented.\nUse `com.example.Present`, `ScriptPresent`, `com.example.Missing`, and `com.example.Other`.\n',
      });
      const registry = DEFAULT_AUDIT_REGISTRY.filter(d => ["docs-code-mismatch", "test-rot", "dead-code-candidate"].includes(d.id));
      const firstBridge = dependencies("mixed-first"), secondBridge = dependencies("mixed-second");
      let activeProofs = 0, peakProofs = 0;
      const measured = firstBridge.deps.runCommand;
      firstBridge.deps.runCommand = async options => {
        if (!options.args?.includes("--audit-import-target")) return measured(options);
        activeProofs++; peakProofs = Math.max(peakProofs, activeProofs);
        try { return await measured(options); } finally { activeProofs--; }
      };
      const first = await runAudit({ config: config(root), toolRoot: root, registry, kitSourceProviderDependencies: firstBridge.deps });
      const second = await runAudit({ config: config(root), toolRoot: root, registry, kitSourceProviderDependencies: secondBridge.deps });
      save("mixed-observed", { first, second, workDirs: [firstBridge.workDir, secondBridge.workDir], calls: [firstBridge.calls, secondBridge.calls] });
      expect(peakProofs).toBeGreaterThan(1);
      expect(peakProofs).toBeLessThanOrEqual(4);
      const byPath = new Map(first.sourceFacts.files.map(f => [f.relativePath, f]));
      for (const file of ["src/NoImports.kts", "src/Explicit.kts"]) {
        expect(byPath.get(file)!.kit!.capabilities).toMatchObject({ declarations: "partial", imports: "complete" });
        expect(qualifyKitImportPredicate(byPath.get(file)!)).toBe("QUALIFIED_NEGATIVE");
        expect(qualifyKitDeclarationPredicate(byPath.get(file)!)).toBe("UNAVAILABLE");
      }
      expect(byPath.get("src/Explicit.kts")!.imports[0]).toMatchObject({ source: "java.io.File", provenance: { extractionMethod: "kotlin-lexical" } });
      expect(byPath.get("src/Ambiguous.kts")!.kit!.capabilities.imports).toBe("partial");
      expect(qualifyKitImportPredicate(byPath.get("src/Ambiguous.kts")!)).toBe("UNAVAILABLE");
      expect(byPath.get("src/partial.ts")!.declarations.length).toBeGreaterThan(0);
      expect(byPath.get("src/partial.ts")!.kit!.capabilities.imports).toBe("partial");
      expect(qualifyKitImportPredicate(byPath.get("src/partial.ts")!)).toBe("UNAVAILABLE");
      expect(qualifyKitDeclarationPredicate(byPath.get("src/partial.ts")!, byPath.get("src/partial.ts")!.declarations[0])).toBe("QUALIFIED_POSITIVE");
      expect(byPath.get("src/main/kotlin/com/example/Present.kt")!.kit!.capabilities).toMatchObject({ declarations: "complete", imports: "complete" });
      for (const [file, language] of [["src/main/java/com/example/Stable.java", "java"], ["src/helper.py", "python"], ["src/lib.rs", "rust"], ["src/plain.js", "javascript"]]) {
        expect(byPath.get(file)!.language).toBe(language);
        expect(byPath.get(file)!.declarations.length).toBeGreaterThan(0);
        expect(byPath.get(file)!.declarations[0].provenance!.factId).toMatch(/^audit-fact:/);
      }
      const dynamicJS = byPath.get("src/dynamic.js")!;
      expect(dynamicJS.kit!.capabilities.imports).toBe("partial");
      expect(qualifyKitImportPredicate(dynamicJS)).toBe("UNAVAILABLE");
      expect(qualifyKitImportPredicate(dynamicJS, dynamicJS.imports[0])).toBe("QUALIFIED_POSITIVE");
      expect(first.exitCode).toBe(2);
      for (const cue of ["security validation", ".only", "old/deprecated", "orphaned", "vanished"]) expect(first.issues.some(i => i.title.toLowerCase().includes(cue)), cue).toBe(true);
      expect(first.issues.some(i => /symbol not found|no detected in-repo importer|imports a missing source/.test(i.title))).toBe(false);
      expect(first.coverage!.filter(c => c.predicate.startsWith("jvm-symbol-claim")).map(c => c.predicate)).toEqual([
        "jvm-symbol-claim README.md:2 com.example.Missing", "jvm-symbol-claim README.md:2 com.example.Other",
      ]);
      expect(first.coverage).toEqual(second.coverage);
      expect(first.sourceFacts.kitEvidence!.snapshotId).toBe(second.sourceFacts.kitEvidence!.snapshotId);
      expect(first.issues).toEqual(second.issues);
      expect(new Set(first.detectorErrors.map(e => JSON.stringify(e))).size).toBe(first.detectorErrors.length);
      const report = JSON.parse(renderAuditJsonReport(buildAuditReportModel(first, { target: resolveAuditTarget(root, root), registry })));
      expect(report.schemaVersion).toBe("1.0");
      expect(report.coverage).toBeUndefined();
      expect(report.summary.finalExitCode).toBe(2);
      save("mixed", { first, second, report, workDirs: [firstBridge.workDir, secondBridge.workDir], calls: [firstBridge.calls, secondBridge.calls] });
      const strict = dependencies("strict-partial");
      await expect(collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root), requiredCapabilities: ["declarations", "imports"], includeScriptsRoot: true }, strict.deps)).rejects.toMatchObject({ category: "capability-insufficient" });
    }, 180000);

    it.each([["none", 0], ["medium", 1]] as const)("preserves complete installed-candidate coverage and fail-on %s exit %s", async (failOn, exitCode) => {
      const root = target("threshold-" + failOn, { "tests/threshold.test.ts": "test.only('threshold breach',()=>{});\n" });
      const bridge = dependencies("threshold-" + failOn);
      const result = await runAudit({ config: config(root, "tests", failOn), toolRoot: root,
        registry: DEFAULT_AUDIT_REGISTRY.filter(d => d.id === "test-rot"), kitSourceProviderDependencies: bridge.deps });
      expect(result.exitCode).toBe(exitCode);
      expect(result.detectorErrors).toEqual([]);
      expect(result.issues.some(i => i.title.includes(".only"))).toBe(true);
      save("threshold-" + failOn, { result, workDir: bridge.workDir, calls: bridge.calls });
    }, 120000);

    it("independently qualifies exact CLI raw JSON/generated and mjs/extensionless proof profiles before consuming them", async () => {
      const root = target("proof-profiles", {
        "src/present.ts": "export const present = 1;\n",
        "generated/schema.ts": "export type Schema = { id: string };\n",
        "tests/data.json": '{"marker":"raw fixture"}\n',
        "tests/profile.test.ts": "import '../src/absent.mjs';\nimport '../src/extensionless';\ntest.skip('independent',()=>{});\n",
      });
      const direct = dependencies("profile-independent"), cli = path.join(installed, "dist/cli.js"), index = path.join(direct.workDir, "index");
      const command = async (label: string, args: string[], commandCli = cli) => {
        const result = await direct.deps.runCommand({ commandId: label, cwd: root, outDir: direct.workDir,
          executable: process.execPath, args: [commandCli, ...args], resolveCommand: false });
        expect(result.ok, result.stderr).toBe(true);
        return JSON.parse(result.stdout);
      };
      await command("independent-index", ["index", "--root", root, "--src", "src", "--src", "tests", "--src", "generated", "--out", index, "--json"]);
      const artifact = JSON.parse(fs.readFileSync(path.join(index, "source-audit-evidence.json"), "utf8"));
      const observations: unknown[] = [];
      for (const [file, marker] of [["tests/data.json", "marker"], ["generated/schema.ts", "Schema"]]) {
        const record = artifact.files.find((f: {path: string}) => f.path === file);
        expect(record.contentSha256).toBe(createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex"));
        const raw = await command("raw-occurrence", ["source", "--index", index, "--file", file, "--contains", marker, "--json"]);
        expect(raw).toMatchObject({ complete: true, matchCount: 1 });
        observations.push({ file, record, raw });
      }
      const facts = artifact.files.find((f: {path: string}) => f.path === "tests/profile.test.ts").facts;
      for (const specifier of ["../src/absent.mjs", "../src/extensionless"]) {
        const fact = facts.find((f: {kind: string;sourceSpecifier: string}) => f.kind === "import" && f.sourceSpecifier === specifier);
        const proof = await command("import-proof", ["lookup", "--index", index, "--audit-import-target", fact.id, "--json"]);
        expect(proof).toMatchObject({ status: "proven-missing" });
        expect(proof.candidatePaths).toContain(specifier.slice(3) + (specifier.endsWith(".mjs") ? "" : ".ts"));
        const publishedProof = await command("historical-import-proof", ["lookup", "--index", index, "--audit-import-target", fact.id, "--json"],
          path.resolve("node_modules/@dailephd/my-dev-kit/dist/cli.js"));
        expect(proof).toEqual(publishedProof);
        observations.push({ fact, proof, publishedProof });
      }
      save("independent-profiles", { observations, artifactSource: artifact.source, workDir: direct.workDir, calls: direct.calls });
      const bridge = dependencies("profile-consumer");
      let result: Awaited<ReturnType<typeof runAudit>> | undefined, failure: unknown;
      try { result = await runAudit({ config: config(root), toolRoot: root, kitSourceProviderDependencies: bridge.deps }); }
      catch (error) { failure = error; }
      save("profile-consumer", { result, failure: failure instanceof Error ? failure.message : failure, workDir: bridge.workDir, calls: bridge.calls });
      expect(failure).toBeUndefined();
      expect(result!.detectorErrors).toEqual([]);
      expect(result!.exitCode).toBe(0);
      expect(result!.issues.filter(i => i.detectorId === "test-rot" && i.title.includes("missing source")).length).toBe(2);
    }, 120000);

    it.each([
      ["package-name", { packageName: "@dailephd/incorrect" }, "package-identity"],
      ["package-version", { packageVersion: "1.15.2" }, "package-identity"],
      ["cli-digest", { cliSha256: "0".repeat(64) }, "package-identity"],
      ["extractor-revision", { extractorRevision: "source-audit-v0.0.0" }, "extractor-mismatch"],
    ] as const)("refuses incorrect installed %s without weakening package resolution", (label, changed, category) => {
      expect(() => resolveInstalledKitPackage({ installedPackageRoot: installed, expectation: { ...expectation, ...changed } })).toThrowError(new RegExp(category));
      save(label, { syntheticExpectationCorruption: changed, expectedCategory: category });
    });

    it.each(["schema", "artifact-bytes", "manifest-hash", "snapshot", "source-bytes", "record-shape"])("keeps synthetic %s corruption fatal through real installed acquisition", async label => {
      const root = target("negative-" + label, { "src/a.ts": "export const a = 1;\n" });
      const bridge = dependencies("negative-" + label, (_args, index) => {
        const artifactPath = path.join(index, "source-audit-evidence.json"), manifestPath = path.join(index, "manifest.json");
        const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")), manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (label === "artifact-bytes") { fs.appendFileSync(artifactPath, " "); return; }
        if (label === "manifest-hash") manifest.sourceAuditEvidence.sha256 = "0".repeat(64);
        if (label === "source-bytes") { fs.appendFileSync(path.join(root, "src/a.ts"), "// synthetic post-index mutation\n"); return; }
        if (label === "schema") artifact.schemaVersion = "9.0.0";
        if (label === "snapshot") artifact.source.snapshotId = "0".repeat(64);
        if (label === "record-shape") artifact.files[0].status = "invalid-record-status";
        if (label !== "manifest-hash") {
          const bytes = Buffer.from(JSON.stringify(artifact)); fs.writeFileSync(artifactPath, bytes);
          manifest.sourceAuditEvidence.sha256 = createHash("sha256").update(bytes).digest("hex");
        }
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      });
      let caught: unknown;
      try { await runAudit({ config: config(root, "package"), toolRoot: root, kitSourceProviderDependencies: bridge.deps }); }
      catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(KitSourceEvidenceAcquisitionError);
      save("negative-" + label, { syntheticCorruption: label, category: (caught as KitSourceEvidenceAcquisitionError).category,
        message: (caught as Error).message, workDir: bridge.workDir, calls: bridge.calls });
    }, 120000);
  });
}
