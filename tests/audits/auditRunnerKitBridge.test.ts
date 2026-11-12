import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The legacy collector is wrapped (not replaced) so tests can prove when it is,
// and is not, invoked.
// Test-only wrapper: lets one test drive the real audit command with an explicit
// Kit request (the command has no provider flag). Production code is untouched.
const forceProvider = vi.hoisted(() => ({ mode: undefined as undefined | "kit", override: undefined as Partial<import("../../src/audits/core/auditRunner.js").RunAuditOptions> | undefined }));
vi.mock("../../src/audits/core/auditRunner.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/audits/core/auditRunner.js")>("../../src/audits/core/auditRunner.js");
  return {
    ...actual,
    runAudit: (options: Parameters<typeof actual.runAudit>[0]) =>
      actual.runAudit(forceProvider.mode ? { ...options, ...forceProvider.override, sourceProviderMode: forceProvider.mode } : options),
  };
});


import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import {
  DEFAULT_AUDIT_REGISTRY,
  KIT_SOURCE_EVIDENCE_REQUIREMENTS,
  NON_SOURCE_DETECTOR_IDS,
  detectorRequiresKitSourceEvidence,
  resolveKitSourceEvidenceRequirement,
  selectDetectors,
  type AuditDetector,
} from "../../src/audits/core/auditRegistry.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import { KitSourceEvidenceAcquisitionError } from "../../src/audits/core/kitSourceEvidence.js";
import { QUALIFIED_KIT_CANDIDATE, type KitCommandRunner } from "../../src/audits/core/kitSourceProvider.js";
import { runAuditCommandFromArgs } from "../../src/commands/runAuditCommand.js";
import { runMeasuredCommand } from "../../src/core/runMeasuredCommand.js";


const CANDIDATE_ROOT = path.resolve(
  process.env.LAB_KIT_CANDIDATE_ROOT ??
    path.join(".my-dev-kit-workflow", "tools", "v010-lab-kit-gate4", "kit-candidate-05", "node_modules", "@dailephd", "my-dev-kit")
);
const candidateInstalled = fs.existsSync(path.join(CANDIDATE_ROOT, "package.json"));

const roots: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lab-kit-runner-${prefix}-`));
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

function fixture(files: Record<string, string>): string {
  const root = tempDir("fx");
  writeFiles(root, { "package.json": JSON.stringify({ name: "fx", version: "1.0.0" }), ...files });
  return root;
}

function detector(id: string, run: AuditDetector["run"] = () => []): AuditDetector {
  return {
    id,
    auditType: "code-rot",
    title: id,
    description: id,
    supportedIncludeAreas: ["docs", "tests", "package", "architecture", "cli"],
    run,
  };
}

function spyRunner(): { runCommand: KitCommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    runCommand: async (options) => {
      calls.push([...(options.args ?? [])]);
      return runMeasuredCommand(options);
    },
  };
}

function configFor(root: string, failOn = "none") {
  return normalizeAuditConfig({ target: root, failOn, out: path.join(root, "audit-out") } as never, root);
}

beforeEach(() => {
  forceProvider.override = undefined;
});

it("propagates a required query failure inside detector.run to CLI exit 2 under fail-on none", async () => {
  const root = fixture({ "tests/check.test.ts": '// npm run vanished\n' });
  const out = path.join(root, "audit-out");
  forceProvider.mode = "kit";
  forceProvider.override = { registry: DEFAULT_AUDIT_REGISTRY.filter((entry) => entry.id === "test-rot"),
    kitSourceProviderDependencies: { expectation: QUALIFIED_KIT_CANDIDATE, installedPackageRoot: CANDIDATE_ROOT, runCommand: async (options) => {
      if (options.args?.includes("--contains")) return { ...(await runMeasuredCommand({ commandId: options.commandId, cwd: options.cwd, outDir: options.outDir, executable: process.execPath, args: ["-e", "process.exit(2)"], resolveCommand: false })), ok: false };
      return runMeasuredCommand(options);
    } } };
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await runAuditCommandFromArgs(["--target", root, "--types", "code-rot", "--include", "tests", "--fail-on", "none", "--out", out])).toBe(2);
    expect(error.mock.calls.flat().join(" ")).toContain("source-occurrence");
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
    expect(fs.existsSync(path.join(out, "code-rot-audit.json"))).toBe(false);
  } finally { forceProvider.mode = undefined; forceProvider.override = undefined; error.mockRestore(); log.mockRestore(); }
}, 120000);

describe("detector requirement selection", () => {
  it("classifies exactly the five frozen source-dependent detectors", () => {
    expect(Object.keys(KIT_SOURCE_EVIDENCE_REQUIREMENTS).sort()).toEqual(
      ["cross-platform-rot", "dead-code-candidate", "docs-code-mismatch", "duplicate-implementation-candidate", "test-rot"].sort()
    );
    for (const id of NON_SOURCE_DETECTOR_IDS) expect(detectorRequiresKitSourceEvidence(id)).toBe(false);
    // Every registered detector is classified one way or the other.
    expect(DEFAULT_AUDIT_REGISTRY.map((entry) => entry.id).sort()).toEqual(
      [...Object.keys(KIT_SOURCE_EVIDENCE_REQUIREMENTS), ...NON_SOURCE_DETECTOR_IDS].sort()
    );
  });

  it("requires Kit only for a selection that contains a source-dependent detector", () => {
    const nonSource = NON_SOURCE_DETECTOR_IDS.map((id) => detector(id));
    expect(resolveKitSourceEvidenceRequirement(nonSource)).toMatchObject({ required: false, detectorIds: [] });
    const withSource = resolveKitSourceEvidenceRequirement([...nonSource, detector("test-rot"), detector("docs-code-mismatch")]);
    expect(withSource).toMatchObject({ required: true, detectorIds: ["test-rot", "docs-code-mismatch"], capabilities: ["declarations", "imports"], includeScriptsRoot: false });
    expect(resolveKitSourceEvidenceRequirement([detector("dead-code-candidate")]).includeScriptsRoot).toBe(true);
  });

  it("is resolved from the already-selected detectors (include areas narrow the selection)", () => {
    const tests = selectDetectors(DEFAULT_AUDIT_REGISTRY, ["code-rot"], ["tests"]);
    expect(tests.map((entry) => entry.id)).toEqual(expect.arrayContaining(["test-rot", "dead-code-candidate"]));
    expect(resolveKitSourceEvidenceRequirement(tests).required).toBe(true);
  });
});

describe("Kit default and retired provider boundary", () => {
  it("defaults to Kit and fails closed when its required package is missing", async () => {
    const root = fixture({ "src/a.ts": "export const a=1;", "tests/a.test.ts": "export {};" });
    const spy = spyRunner();
    await expect(runAudit({ config: configFor(root), toolRoot: root, registry: [detector("test-rot")], kitSourceProviderDependencies: { installedPackageRoot: path.join(root,"missing"), runCommand: spy.runCommand } })).rejects.toMatchObject({ category: "package-missing" });
    expect(spy.calls).toEqual([]);
  });

  it("default and explicit Kit produce identical findings and exit codes", async () => {
    const root = fixture({ "src/a.ts": "export const a=1;", "tests/a.test.ts": "export {};" });
    const options = { config: configFor(root), toolRoot: root, registry: [detector("test-rot")], kitSourceProviderDependencies: { expectation: QUALIFIED_KIT_CANDIDATE, installedPackageRoot: CANDIDATE_ROOT } };
    const byDefault = await runAudit(options), explicit = await runAudit({ ...options, sourceProviderMode: "kit" });
    expect(byDefault.sourceFacts.provider).toBe("kit");
    expect(byDefault.issues).toEqual(explicit.issues); expect(byDefault.exitCode).toBe(explicit.exitCode);
  }, 120000);

  it("C. an explicit Kit request with a missing package is fatal at the runtime boundary, with no fallback", async () => {
    const root = fixture({ "src/a.ts": "export const a = 1;\n", "tests/a.test.ts": "export {};\n" });
    await expect(
      runAudit({ config: configFor(root, "none"), toolRoot: root, registry: [detector("test-rot")], sourceProviderMode: "kit", kitSourceProviderDependencies: { installedPackageRoot: path.join(root, "nope") } })
    ).rejects.toMatchObject({ category: "package-missing" });
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
  });

  it("C. an explicit Kit request with an incompatible candidate is fatal with no fallback", async () => {
    const root = fixture({ "src/a.ts": "export const a = 1;\n", "tests/a.test.ts": "export {};\n" });
    const pkg = tempDir("wrongpkg");
    writeFiles(pkg, {
      "package.json": JSON.stringify({ name: QUALIFIED_KIT_CANDIDATE.packageName, version: "9.9.9", bin: { "my-dev-kit": "dist/cli.js" } }),
      "dist/cli.js": "// x\n",
    });
    await expect(
      runAudit({ config: configFor(root, "none"), toolRoot: root, registry: [detector("test-rot")], sourceProviderMode: "kit", kitSourceProviderDependencies: { installedPackageRoot: pkg } })
    ).rejects.toMatchObject({ category: "package-identity" });
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
  });

  it("rejects the retired mode before reading even invalid configuration", async () => {
    await expect(runAudit({ sourceProviderMode: "legacy-comparison" } as never)).rejects.toEqual(new RangeError('sourceProviderMode "legacy-comparison" is retired; use "kit".'));
  });

  it("E. an explicit Kit non-source-only selection initializes neither Kit nor source analysis", async () => {
    const root = fixture({ "src/a.ts": "export const a = 1;\n" });
    const spy = spyRunner();
    const result = await runAudit({
      config: configFor(root), toolRoot: root, registry: NON_SOURCE_DETECTOR_IDS.map((id) => detector(id)), sourceProviderMode: "kit",
      kitSourceProviderDependencies: { installedPackageRoot: path.join(root, "nope"), runCommand: spy.runCommand },
    });
    expect(result.sourceFacts.provider).toBe("not-collected");
    expect(spy.calls).toEqual([]);
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
  });
});

describe("runAudit source provider selection", () => {
  it("selects detectors before collection and does not touch Kit for a non-source-only selection", async () => {
    const root = fixture({ "src/a.ts": "export const a = 1;\n" });
    const spy = spyRunner();
    const result = await runAudit({
      config: configFor(root),
      toolRoot: root,
      registry: NON_SOURCE_DETECTOR_IDS.map((id) => detector(id)),
      // Deliberately not installed: a non-source run must not even resolve it.
      sourceProviderMode: "kit",
      kitSourceProviderDependencies: { installedPackageRoot: path.join(root, "no-such-kit"), runCommand: spy.runCommand },
    });
    expect(result.sourceFacts.provider).toBe("not-collected");
    expect(result.sourceFacts.files).toEqual([]);
    expect(result.detectorErrors).toEqual([]);
    expect(spy.calls).toEqual([]);
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
  });

  it("keeps findings and ordering identical across providers for non-source detectors", async () => {
    const root = fixture({ "src/a.ts": "export const a = 1;\n" });
    const issue = (id: string) => ({
      id, auditType: "code-rot" as const, detectorId: id, title: id, description: id, severity: "low" as const, confidence: "medium" as const,
      falsePositiveRisk: "low" as const, category: "t", evidence: [], affectedFiles: [], recommendedAction: "", suggestedFixStrategy: "",
      validationCommands: [], releaseBlocking: false, implementationBlocking: false, autoFixEligible: false,
    });
    const registry = [detector("stale-command-reference", () => [issue("one"), issue("two")]), detector("package-release-rot", () => [issue("three")])];
    const kit = await runAudit({ config: configFor(root), toolRoot: root, registry });
    const legacy = await runAudit({ config: configFor(root), toolRoot: root, registry, sourceProviderMode: "kit" });
    expect(kit.issues.map((entry) => entry.id)).toEqual(["one", "two", "three"]);
    expect(kit.issues).toEqual(legacy.issues);
    expect(kit.exitCode).toBe(legacy.exitCode);
  });

  it("rejects null and other untyped runtime values before any audit side effect", async () => {
    for (const value of [null, false, true, 0, "", "KIT", {}, []]) {
      await expect(runAudit({ sourceProviderMode: value } as never)).rejects.toEqual(new RangeError('Unsupported sourceProviderMode; supported value: "kit".'));
    }
  });

  it("makes a missing Kit fatal for a source-dependent selection, even with --fail-on none, with no native fallback", async () => {
    const root = fixture({ "src/a.ts": "export const a = 1;\n", "tests/a.test.ts": "export {};\n" });
    const detectorRan = vi.fn(() => []);
    await expect(
      runAudit({
        config: configFor(root, "none"),
        toolRoot: root,
        registry: [detector("test-rot", detectorRan)],
        sourceProviderMode: "kit",
        kitSourceProviderDependencies: { installedPackageRoot: path.join(root, "no-such-kit") },
      })
    ).rejects.toMatchObject({ name: "KitSourceEvidenceAcquisitionError", category: "package-missing" });
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
    expect(detectorRan).not.toHaveBeenCalled();
  });

  it("does not convert a failed Kit subprocess into a detector error or a clean audit", async () => {
    const root = fixture({ "README.md": "The project uses `com.example.A`.\n", "src/A.java": "public class A {}\n" });
    const pkg = tempDir("fakepkg");
    writeFiles(pkg, {
      "package.json": JSON.stringify({ name: QUALIFIED_KIT_CANDIDATE.packageName, version: QUALIFIED_KIT_CANDIDATE.packageVersion, bin: { "my-dev-kit": "dist/cli.js" } }),
      "dist/cli.js": `// ${QUALIFIED_KIT_CANDIDATE.extractorRevision}\n`,
    });
    const failing: KitCommandRunner = async (options) => ({
      commandId: options.commandId, commandString: "", executable: process.execPath, args: [], cwd: ".", startedAt: "", endedAt: "",
      durationMs: 0, exitCode: 2, stdout: "", stderr: "AUDIT_EVIDENCE_UNAVAILABLE: nope", stdoutPath: "", stderrPath: "", telemetryPath: "", ok: false,
    });
    const error = await runAudit({
      config: configFor(root, "none"),
      toolRoot: root,
      registry: [detector("docs-code-mismatch")],
      sourceProviderMode: "kit",
      kitSourceProviderDependencies: { installedPackageRoot: pkg, expectation: { ...QUALIFIED_KIT_CANDIDATE, cliSha256: null }, runCommand: failing },
    }).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(KitSourceEvidenceAcquisitionError);
    expect((error as KitSourceEvidenceAcquisitionError).category).toBe("artifact-missing");
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
  });

  it("maps an explicitly requested but missing Kit to exit code 2 through the audit command even with --fail-on none", async () => {
    const root = fixture({ "src/a.ts": "export const a = 1;\n", "tests/a.test.ts": "export {};\n" });
    const out = path.join(root, "audit-out");
    forceProvider.mode = "kit";
    forceProvider.override = { kitSourceProviderDependencies: { installedPackageRoot: path.join(root, "missing-kit") } };
    const originalError = console.error;
    const originalLog = console.log;
    const logged: string[] = [];
    console.error = (...args: unknown[]) => void logged.push(args.join(" "));
    console.log = () => undefined;
    try {
      const code = await runAuditCommandFromArgs(["--target", root, "--types", "code-rot", "--include", "tests", "--fail-on", "none", "--out", out]);
      expect(code).toBe(2);
    } finally {
      forceProvider.mode = undefined;
      forceProvider.override = undefined;
      console.error = originalError;
      console.log = originalLog;
    }
    expect(logged.join("\n")).toContain("audit runtime failure");
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
    // No report is written for a failed evidence acquisition.
    expect(fs.existsSync(out)).toBe(false);
  });
});

describe("M03 acquisition diagnostic context", () => {
  it.each(["none", "high"])("names selected detector requirements at the CLI boundary with fail-on %s", async failOn => {
    const root = fixture({ "src/a.ts": "export const a = 1;\n", "tests/a.test.ts": "export {};\n" });
    const out = path.join(root, "audit-out");
    const ran = vi.fn(() => []);
    forceProvider.mode = "kit";
    forceProvider.override = {
      registry: [detector("test-rot", ran)],
      kitSourceProviderDependencies: { installedPackageRoot: path.join(root, "missing-kit") },
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runAuditCommandFromArgs(["--target", root, "--types", "code-rot", "--include", "tests", "--fail-on", failOn, "--out", out])).toBe(2);
      const message = error.mock.calls.flat().join(" ");
      expect(message).toContain("package-missing");
      expect(message).toContain("test-rot [imports]");
      expect(message).not.toContain("docs-code-mismatch");
      expect(ran).not.toHaveBeenCalled();
      expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
      expect(fs.existsSync(out)).toBe(false);
    } finally {
      forceProvider.mode = undefined;
      forceProvider.override = undefined;
      error.mockRestore(); log.mockRestore();
    }
  });

  it("derives multiple detector capability mappings and excludes non-source detectors", async () => {
    const root = fixture({ "src/a.ts": "export const a = 1;\n", "tests/a.test.ts": "export {};\n" });
    await expect(runAudit({ config: configFor(root), toolRoot: root, sourceProviderMode: "kit",
      registry: [detector("dead-code-candidate"), detector("test-rot"), detector("package-release-rot")],
      kitSourceProviderDependencies: { installedPackageRoot: path.join(root, "missing-kit") },
    })).rejects.toMatchObject({ category: "package-missing", message: expect.stringContaining("dead-code-candidate [declarations, imports]; test-rot [imports]") });
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
  });

  it("preserves the exact acquisition error, category and detail for a detector-time failure", async () => {
    const root = fixture({});
    const original = new KitSourceEvidenceAcquisitionError("stale-evidence", "STALE_SOURCE_EVIDENCE fact-17", "snapshot-23");
    const caught = await runAudit({ config: configFor(root), toolRoot: root, sourceProviderMode: "kit",
      registry: [detector("test-rot", () => { throw original; })],
    }).catch(error => error);
    expect(caught).toBe(original);
    expect(caught).toMatchObject({ category: "stale-evidence", detail: "snapshot-23" });
    expect(caught.message).toContain("STALE_SOURCE_EVIDENCE fact-17");
    expect(caught.message).toContain("test-rot [imports]");
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
  });
});

describe.skipIf(!candidateInstalled)("runAudit with the exact installed Kit candidate", () => {
  const detectorIds = ["docs-code-mismatch", "duplicate-implementation-candidate", "dead-code-candidate", "test-rot"];

  async function runKit(root: string, collected: { seen?: string[] } = {}) {
    const seen: string[] = [];
    const result = await runAudit({
      config: configFor(root),
      toolRoot: root,
      registry: detectorIds.map((id) =>
        detector(id, (ctx) => {
          seen.push(`${id}:${ctx.sourceFacts?.provider}:${ctx.sourceFacts?.files.length}`);
          return [];
        })
      ),
      sourceProviderMode: "kit",
      kitSourceProviderDependencies: { expectation: QUALIFIED_KIT_CANDIDATE, installedPackageRoot: CANDIDATE_ROOT },
    });
    collected.seen = seen;
    return result;
  }

  const fixtures: Record<string, Record<string, string>> = {
    "TypeScript/JavaScript": {
      "src/a.ts": 'import { b } from "./b";\nexport function a() { return b; }\n',
      "src/b.js": "export const b = 1;\n",
      "tests/a.test.ts": 'import { a } from "../src/a";\nvoid a;\n',
    },
    Python: {
      "src/pkg/__init__.py": "",
      "src/pkg/mod.py": '__all__ = ["run"]\nimport os\ndef run():\n    return os.name\n',
      "tests/test_mod.py": "from pkg.mod import run\n",
    },
    "Java/Kotlin": {
      "src/main/java/a/Sample.java": "package a;\npublic class Sample {}\n",
      "src/main/kotlin/a/Thing.kt": "package a\ninternal class Thing\n",
    },
    mixed: {
      "src/a.ts": "export const a = 1;\n",
      "src/mod.py": "def f():\n    return 1\n",
      "src/Sample.java": "public class Sample {}\n",
      "src/Thing.kt": "class Thing\n",
      "tests/a.test.ts": 'import { a } from "../src/a";\nvoid a;\n',
    },
  };

  it.each(Object.entries(fixtures))("runs source-dependent detectors on the %s fixture with Kit evidence", async (_name, files) => {
    const root = fixture(files);
    const collected: { seen?: string[] } = {};
    const result = await runKit(root, collected);
    expect(result.exitCode).toBe(0);
    expect(result.detectorErrors).toEqual([]);
    expect(result.sourceFacts.provider).toBe("kit");
    expect(result.sourceFacts.kitEvidence?.traversalComplete).toBe(true);
    expect(result.sourceFacts.files.length).toBeGreaterThan(0);
    expect(result.sourceFacts.files.every((file) => file.analyzerId?.startsWith("kit:"))).toBe(true);
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
    // Every detector saw the Kit-backed snapshot.
    expect(collected.seen).toHaveLength(detectorIds.length);
    expect(collected.seen!.every((entry) => entry.includes(":kit:"))).toBe(true);
  }, 180000);

  it("retains Kit attribution and keeps retired selection unavailable", async () => {
    const root = fixture(fixtures["mixed"]!); const kit = await runKit(root);
    expect(kit.sourceFacts.provider).toBe("kit");
    expect(kit.sourceFacts.files.every(file => file.analyzerId?.startsWith("kit:"))).toBe(true);
    await expect(runAudit({ sourceProviderMode: "legacy-comparison" } as never)).rejects.toBeInstanceOf(RangeError);
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
  },180000);

  it("invokes the installed candidate CLI and never indexes for a non-source-only run", async () => {
    const root = fixture(fixtures["TypeScript/JavaScript"]!);
    const withKit = spyRunner();
    await runAudit({
      config: configFor(root),
      toolRoot: root,
      registry: [detector("test-rot")],
      sourceProviderMode: "kit",
      kitSourceProviderDependencies: { expectation: QUALIFIED_KIT_CANDIDATE, installedPackageRoot: CANDIDATE_ROOT, runCommand: withKit.runCommand },
    });
    expect(withKit.calls.some((args) => args[1] === "index")).toBe(true);
    expect(withKit.calls.some((args) => args.includes("--audit-files"))).toBe(true);
    expect(withKit.calls.some((args) => args.includes("--audit-file"))).toBe(true);

    const withoutKit = spyRunner();
    await runAudit({
      config: configFor(root),
      toolRoot: root,
      registry: NON_SOURCE_DETECTOR_IDS.map((id) => detector(id)),
      sourceProviderMode: "kit",
      kitSourceProviderDependencies: { expectation: QUALIFIED_KIT_CANDIDATE, installedPackageRoot: CANDIDATE_ROOT, runCommand: withoutKit.runCommand },
    });
    expect(withoutKit.calls).toEqual([]);
  }, 180000);

  it("covers required inventory files outside the conventional roots", async () => {
    const root = fixture({ "src/a.ts": "export const a = 1;\n", "lib/b.ts": "export const b = 1;\n" });
    const result = await runKit(root);
    expect(result.sourceFacts.kitEvidence?.sourceRoots).toEqual(["lib", "src"]);
    expect(fs.existsSync(path.resolve("src/audits/core/collectSourceFacts.ts"))).toBe(false);
  }, 120000);
});
