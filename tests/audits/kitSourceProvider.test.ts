import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import {
  QUALIFIED_KIT_CANDIDATE,
  collectKitSourceFacts,
  resolveInstalledKitPackage,
  selectKitSourceRoots,
  type KitCandidateExpectation,
  type KitCommandRunner,
} from "../../src/audits/core/kitSourceProvider.js";
import { KitSourceEvidenceAcquisitionError } from "../../src/audits/core/kitSourceEvidence.js";
import { runMeasuredCommand, type MeasuredCommandResult } from "../../src/core/runMeasuredCommand.js";

const CANDIDATE_ROOT = path.resolve(
  process.env.LAB_KIT_CANDIDATE_ROOT ??
    path.join(".my-dev-kit-workflow", "tools", "v010-lab-kit-gate4", "kit-candidate-05", "node_modules", "@dailephd", "my-dev-kit")
);
const candidateInstalled = fs.existsSync(path.join(CANDIDATE_ROOT, "package.json"));

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
  artifact?: (artifact: Record<string, any>) => void;
  manifest?: (manifest: Record<string, any>) => void;
  skipArtifact?: boolean;
  inventoryPage?: (index: number, page: Record<string, any>) => Record<string, any>;
  factPage?: (filePath: string, index: number, page: Record<string, any>) => Record<string, any>;
  capabilities?: Record<string, string>;
  rawResult?: (kind: "index" | "audit-files" | "audit-file", result: MeasuredCommandResult) => MeasuredCommandResult;
  rootsAreOverridden?: string[];
  extraInventory?: FakeFile[];
  droppedFromInventory?: string[];
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
    status: "parsed",
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

describe.skipIf(!candidateInstalled)("exact installed Kit candidate", () => {
  let packageHashBefore = "";
  beforeAll(() => {
    packageHashBefore = hashTree(CANDIDATE_ROOT);
  });

  it("resolves the qualified candidate identity with a contained CLI", () => {
    const pkg = resolveInstalledKitPackage({ expectation: QUALIFIED_KIT_CANDIDATE, installedPackageRoot: CANDIDATE_ROOT });
    expect(pkg.packageName).toBe("@dailephd/my-dev-kit");
    expect(pkg.packageVersion).toBe("1.14.0");
    expect(pkg.cliSha256).toBe(QUALIFIED_KIT_CANDIDATE.cliSha256);
    expect(path.relative(fs.realpathSync(CANDIDATE_ROOT), pkg.cliPath)).toBe(path.join("dist", "cli.js"));
  });

  it("rejects the same installation when a different build is expected", () => {
    expect(() => resolveInstalledKitPackage({ installedPackageRoot: CANDIDATE_ROOT, expectation: { ...QUALIFIED_KIT_CANDIDATE, cliSha256: "0".repeat(64) } })).toThrowError(/package-identity/);
    expect(() => resolveInstalledKitPackage({ installedPackageRoot: CANDIDATE_ROOT, expectation: { ...QUALIFIED_KIT_CANDIDATE, extractorRevision: "source-audit-v9.9.9" } })).toThrowError(/extractor-mismatch/);
    expect(() => resolveInstalledKitPackage({ installedPackageRoot: CANDIDATE_ROOT, expectation: { ...QUALIFIED_KIT_CANDIDATE, packageVersion: "1.15.0" } })).toThrowError(/package-identity/);
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
    const pkg = resolveInstalledKitPackage({ expectation: QUALIFIED_KIT_CANDIDATE, installedPackageRoot: CANDIDATE_ROOT });
    const snapshot = await collectKitSourceFacts(
      { targetRoot: project, inventory: scanProjectInventory(project), requiredCapabilities: ["declarations", "imports"], includeScriptsRoot: false },
      { expectation: QUALIFIED_KIT_CANDIDATE, installedPackageRoot: CANDIDATE_ROOT, runCommand }
    );

    // The installed candidate CLI was actually invoked.
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((call) => call.executable === process.execPath && call.args[0] === pkg.cliPath)).toBe(true);

    expect(snapshot.provider).toBe("kit");
    const evidence = snapshot.kitEvidence!;
    expect(evidence).toMatchObject({
      packageName: "@dailephd/my-dev-kit",
      packageVersion: "1.14.0",
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
      { expectation: QUALIFIED_KIT_CANDIDATE, installedPackageRoot: CANDIDATE_ROOT }
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
      collectKitSourceFacts({ targetRoot: project, inventory, requiredCapabilities: ["declarations"], includeScriptsRoot: false }, { expectation: QUALIFIED_KIT_CANDIDATE, installedPackageRoot: CANDIDATE_ROOT }),
      "stale-evidence"
    );
  }, 120000);

  it("selects Lab source outside the conventional roots with validated evidence", async () => {
    const project = tempDir("real-outside");
    writeFiles(project, { "package.json": JSON.stringify({ name: "fx", version: "1.0.0" }), "src/a.ts": "export const a = 1;\n", "lib/b.ts": "export const b = 1;\n" });
    const facts = await collectKitSourceFacts(
        { targetRoot: project, inventory: scanProjectInventory(project), requiredCapabilities: ["declarations"], includeScriptsRoot: false },
        { expectation: QUALIFIED_KIT_CANDIDATE, installedPackageRoot: CANDIDATE_ROOT }
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