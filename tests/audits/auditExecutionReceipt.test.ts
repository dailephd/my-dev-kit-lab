import crypto, { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectKitSourceFacts, QUALIFIED_B3_P1_KIT, QUALIFIED_B5_P1_R7A_KIT, QUALIFIED_PUBLISHED_KIT } from "../../src/audits/core/kitSourceProvider.js";
import { reserveAuditExecution, verifyAuditExecutionReceipts } from "../../src/audits/core/auditExecutionReceipt.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import { runAuditCommandFromArgs } from "../../src/commands/runAuditCommand.js";
import { runMeasuredCommand } from "../../src/core/runMeasuredCommand.js";

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lab-audit-receipt-"));
  const target = path.join(workspace, "target");
  fs.mkdirSync(path.join(target, "tests"), { recursive: true });
  fs.writeFileSync(path.join(target, "package.json"), '{"name":"audit-receipt-test","type":"module"}');
  fs.writeFileSync(path.join(target, "tests", "spec.test.mjs"), 'test.only("independent", () => {});\n');
  const root = path.join(workspace, "lab-output", "evidence");
  const argv = ["--target", target, "--types", "code-rot", "--include", "tests", "--format", "text,json", "--fail-on", "none"];
  return { workspace, target, root, argv };
}

type Digest = { path: string; bytes: number; sha256: string };
function verify(artifact: Digest) {
  const bytes = fs.readFileSync(artifact.path);
  expect(bytes.length).toBe(artifact.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
  return bytes;
}
function load(directory: string, name: string) {
  return JSON.parse(fs.readFileSync(path.join(directory, name + ".json"), "utf8"));
}
function verifyConclusion(directory: string, name: string) {
  const result = load(directory, name);
  expect(result.executionId).toBe(path.basename(directory));
  for (const artifact of result.checkpoints) verify(artifact);
  for (const artifact of result.evidence.reports) verify(artifact);
  return result.evidence;
}
function executions(root: string) {
  return fs.readdirSync(root).map(id => path.join(root, id));
}

it("retains a real nonzero child, its prelaunch argv, and both byte streams before report generation", async () => {
  const { target, workspace, argv, root } = fixture();
  const pkg = path.join(workspace, "kit");
  fs.mkdirSync(pkg);
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({
    name: QUALIFIED_PUBLISHED_KIT.packageName, version: QUALIFIED_PUBLISHED_KIT.packageVersion, bin: "cli.js",
  }));
  fs.writeFileSync(path.join(pkg, "cli.js"), `// ${QUALIFIED_PUBLISHED_KIT.extractorRevision}
process.stdout.write(Buffer.from([255, 10])); process.stderr.write("fixture failure"); process.exitCode = 17;`);
  // The fake CLI exercises retention only. Use a runner seam that starts the
  // real process even though this fixture is outside Kit's predicate profile.
  const receipt = reserveAuditExecution(workspace, target);
  receipt.write("initial", { fixture: true });
  await expect(collectKitSourceFacts({
    targetRoot: target, inventory: scanProjectInventory(target), requiredCapabilities: [], includeScriptsRoot: false,
  }, { installedPackageRoot: pkg, expectation: { ...QUALIFIED_PUBLISHED_KIT, cliSha256: null }, receipt,
    async runCommand(options) {
      expect(load(receipt.directory, options.commandId + "-initial").evidence.args).toEqual(options.args);
      return runMeasuredCommand(options);
    },
  })).rejects.toThrow(/exit 17/);
  const command = load(receipt.directory, "kit-000000-index-result").evidence;
  expect(command.exitCode).toBe(17);
  expect(verify(command.artifacts[0])).toEqual(Buffer.from([255, 10]));
  expect(verify(command.artifacts[1]).toString()).toBe("fixture failure");
  expect(JSON.parse(verify(command.artifacts[2]).toString()).exitCode).toBe(17);
  expect(fs.existsSync(path.join(receipt.directory, "reports"))).toBe(false);

  const before = fs.readFileSync(path.join(receipt.directory, "initial.json"));
  const status = await runAuditCommandFromArgs([...argv, "--retry-of", receipt.id, "--ignored-secret=omit-me"], {
    evidenceWorkspace: workspace, kitSourceProviderDependencies: { installedPackageRoot: path.join(workspace, "missing") },
  });
  expect(status).toBe(2);
  const retry = executions(root).find(dir => dir !== receipt.directory)!;
  expect(load(retry, "initial").evidence).toMatchObject({ retryOf: receipt.id, explicit: { exact: false } });
  expect(fs.readFileSync(path.join(retry, "initial.json"), "utf8")).not.toContain("omit-me");
  expect(fs.readFileSync(path.join(receipt.directory, "initial.json"))).toEqual(before);
  expect(verifyConclusion(retry, "failure")).toMatchObject({ stage: "kit-package-qualification", reports: [], exitCode: 2 });
});

it("retains an absent required path before running Kit", async () => {
  const { target, workspace } = fixture();
  const receipt = reserveAuditExecution(workspace, target);
  await expect(collectKitSourceFacts({ targetRoot: target, inventory: scanProjectInventory(target),
    requiredPaths: ["tests/absent.test.mjs"], requiredCapabilities: [], includeScriptsRoot: false },
    { receipt })).rejects.toThrow(/selection-incomplete/);
  expect(load(receipt.directory, "lab-required-source-scope").evidence).toMatchObject({
    requiredPaths: ["tests/absent.test.mjs"], unresolvedPaths: ["tests/absent.test.mjs"], complete: false,
  });
  expect(fs.readdirSync(receipt.directory)).toEqual(["lab-required-source-scope.json"]);
});

const archive = process.env.LAB_R3_KIT_ARCHIVE;
const pkg = process.env.LAB_R3_INSTALLED_KIT;
it.skipIf(!archive || !pkg)("retains qualified selection, partial coverage, collisions and invalid artifacts", async () => {
  const { target, workspace, argv, root } = fixture();
  const deps = { expectation: QUALIFIED_B3_P1_KIT, qualifiedArchivePath: archive, installedPackageRoot: pkg };
  const out = path.join(workspace, "reports");
  const run = (extra: string[] = [], dependencies = deps) => runAuditCommandFromArgs([...argv, ...extra], {
    evidenceWorkspace: workspace, kitSourceProviderDependencies: dependencies,
  });
  expect(await run(["--out", out])).toBe(0);
  const [success] = executions(root);
  const complete = verifyConclusion(success, "outcome");
  expect(complete.exitCode).toBe(0);
  expect(complete.reports).toHaveLength(2);
  const selection = load(success, "kit-selection").evidence.inventory;
  const relevant = selection.find((file: { path: string }) => file.path === "tests/spec.test.mjs");
  const source = load(success, "source-inventory").evidence.inventory.find((file: { path: string }) => file.path === relevant.path);
  expect(source).toMatchObject({ bytes: relevant.sizeBytes, sha256: relevant.contentSha256 });
  const selected = load(success, "kit-artifact-identity").evidence;
  expect(selected.source.selectionFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(selected.coverage.inventoryComplete).toBe(true);

  expect(await run(["--retry-of", path.basename(success), "--out", out])).toBe(2);
  const collision = executions(root).find(dir => dir !== success)!;
  expect(verifyConclusion(collision, "failure")).toMatchObject({ stage: "report-generation", error: expect.stringContaining("EEXIST") });
  verifyConclusion(success, "outcome");

  const beforeMissing = executions(root);
  expect(await run(["--require-source", "tests/absent.test.mjs"])).toBe(2);
  const missing = executions(root).find(dir => !beforeMissing.includes(dir))!;
  expect(verifyConclusion(missing, "failure")).toMatchObject({ stage: "declared-required-files", category: "selection-incomplete" });
  expect(load(missing, "declared-required-files").evidence).toEqual([{ path: "tests/absent.test.mjs", present: false }]);

  const beforeSelectionGap = executions(root);
  const missingDuringIndex = path.join(target, "tests", "spec.test.mjs");
  fs.writeFileSync(path.join(target, "tests", "another.test.mjs"), 'test("another", () => {});');
  const omitDuringIndex = { ...deps, async runCommand(options: Parameters<typeof runMeasuredCommand>[0]) {
    if (options.args?.[1] !== "index") return runMeasuredCommand(options);
    const bytes = fs.readFileSync(missingDuringIndex);
    fs.unlinkSync(missingDuringIndex);
    try { return await runMeasuredCommand(options); }
    finally { fs.writeFileSync(missingDuringIndex, bytes); }
  } };
  expect(await run([], omitDuringIndex)).toBe(2);
  const gap = executions(root).find(dir => !beforeSelectionGap.includes(dir))!;
  expect(verifyConclusion(gap, "failure")).toMatchObject({ stage: "kit-required-coverage", category: "selection-incomplete" });
  expect(load(gap, "kit-required-inclusion").evidence).toContainEqual({ file: "tests/spec.test.mjs", selected: false });
  expect(load(gap, "kit-000000-index-result").evidence.exitCode).toBe(0);

  const beforePartial = executions(root);
  fs.appendFileSync(path.join(target, "tests", "spec.test.mjs"), "void import(process.env.UNRESOLVED);\n");
  expect(await run()).toBe(2);
  const partial = executions(root).find(dir => !beforePartial.includes(dir))!;
  expect(verifyConclusion(partial, "outcome")).toMatchObject({ exitCode: 2, reports: expect.any(Array) });
  expect(load(partial, "audit-result").evidence.issues.some((issue: { id: string }) => issue.id.includes("only"))).toBe(true);

  const beforeTamper = executions(root);
  const tamperingDeps = { ...deps, async runCommand(options: Parameters<typeof runMeasuredCommand>[0]) {
    const result = await runMeasuredCommand(options);
    if (options.args?.[1] === "index") {
      fs.appendFileSync(path.join(options.cwd, "index", "source-audit-evidence.json"), "tamper");
    }
    return result;
  } };
  expect(await run([], tamperingDeps)).toBe(2);
  const invalid = executions(root).find(dir => !beforeTamper.includes(dir))!;
  expect(verifyConclusion(invalid, "failure")).toMatchObject({ stage: "kit-artifact-validation", reports: [], exitCode: 2 });
  verify(load(invalid, "kit-index-artifacts").evidence[1]);

  const beforeMismatch = executions(root);
  const otherArchive = path.join(workspace, "other.tgz");
  fs.writeFileSync(otherArchive, "different bytes");
  expect(await run([], { ...deps, qualifiedArchivePath: otherArchive })).toBe(2);
  const mismatch = executions(root).find(dir => !beforeMismatch.includes(dir))!;
  expect(verifyConclusion(mismatch, "failure")).toMatchObject({ category: "package-identity", reports: [] });
  expect(verify(load(mismatch, "kit-package-request").evidence.observedArchive).toString()).toBe("different bytes");
}, 120_000);

describe("internal audit receipt journal", () => {
  const mode = "MY_DEV_KIT_LAB_RECEIPT_JOURNAL_V1";
  const request = { selector: "line-range", requestSha256: "a".repeat(64) };
  const logical = { kind: "source-range", family: "source" };
  const journalFolder = "receipt-journal-v1";
  const segmentName = "segment-00000000.bin";

  afterEach(() => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    vi.unstubAllEnvs();
  });

  function start(value = "1") {
    vi.stubEnv(mode, value);
    const { workspace, target } = fixture();
    return reserveAuditExecution(workspace, target);
  }

  function stream(receipt: ReturnType<typeof start>) {
    const events = [
      { type: "ready", pid: 123 },
      { type: "frame-sent", requestId: "1", selector: request.selector, inputSha256: "b".repeat(64), requestBytes: 123 },
      { type: "frame-complete", requestId: "1", selector: request.selector, responseBytes: 456 },
      { type: "retiring", reason: "dispose" },
      { type: "closed", exit: 0 },
    ];
    receipt.write("initial", { fixture: true });
    receipt.write("kit-logical-1", logical, request);
    events.forEach((event, index) => receipt.write("kit-stream-" + (index + 1), { family: "source", ...event }));
    receipt.write("outcome", { reports: [], exitCode: 0 });
    return events;
  }

  it("reopens ordered exact payloads through their legacy checkpoint references", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    syncBuiltinESMExports();
    vi.stubEnv(mode, undefined);
    const { workspace, target } = fixture();
    const legacy = reserveAuditExecution(workspace, target);
    const events = stream(legacy);
    const receipt = start();
    stream(receipt);
    expect(receipt.id).toBe(legacy.id);
    const replay = verifyAuditExecutionReceipts(receipt.directory, { requireJournal: true });
    const prior = verifyAuditExecutionReceipts(legacy.directory);
    expect(replay.checkpoints.map(checkpoint => path.basename(checkpoint.path))).toEqual(
      prior.checkpoints.map(checkpoint => path.basename(checkpoint.path)));
    expect(replay.journal?.records).toBe(events.length + 1);
    expect(fs.readdirSync(receipt.directory).sort()).toEqual(["initial.json", "outcome.json", journalFolder].sort());
    for (const checkpoint of replay.checkpoints) {
      const name = path.basename(checkpoint.path, ".json");
      const original = prior.read(name);
      expect(replay.read(name)).toEqual(original);
      expect(createHash("sha256").update(original).digest("hex")).toBe(checkpoint.sha256);
    }
    expect(() => verifyAuditExecutionReceipts(legacy.directory, { requireJournal: true })).toThrow(/required/);
  });

  it("validates mode before the execution directory can be reserved", () => {
    vi.stubEnv(mode, "0");
    const { workspace, target, root } = fixture();
    expect(() => reserveAuditExecution(workspace, target)).toThrow(/Invalid MY_DEV_KIT_LAB_RECEIPT_JOURNAL_V1/);
    expect(fs.existsSync(root)).toBe(false);
  });

  it("keeps concurrent callers in invocation order using bounded physical files", async () => {
    const receipt = start();
    await Promise.all(Array.from({ length: 1000 }, (_, index) => Promise.resolve().then(() => {
      receipt.write("kit-logical-" + (index + 1), logical, request);
    })));
    receipt.write("failure", { reports: [], exitCode: 2 });
    const replay = verifyAuditExecutionReceipts(receipt.directory, { requireJournal: true });
    expect(replay.checkpoints.map(checkpoint => path.basename(checkpoint.path))).toEqual(
      Array.from({ length: 1000 }, (_, index) => "kit-logical-" + (index + 1) + ".json"));
    expect(replay.journal?.segments.map(segment => segment.file)).toEqual([segmentName]);
    expect(fs.readdirSync(path.join(receipt.directory, journalFolder)).sort()).toEqual(["manifest.json", "sealed", segmentName]);
  });

  it("rolls over by bytes and seals each segment", () => {
    const receipt = start();
    const reason = "x".repeat(9 * 1024 * 1024);
    for (let sequence = 1; sequence <= 8; sequence++) {
      receipt.write("kit-stream-" + sequence, { family: "source", type: "failed", reason });
    }
    receipt.write("failure", { reports: [], exitCode: 2 });
    const journal = verifyAuditExecutionReceipts(receipt.directory, { requireJournal: true }).journal!;
    expect(journal.segments.map(segment => [segment.file, segment.records])).toEqual([
      [segmentName, 7], ["segment-00000001.bin", 1],
    ]);
    expect(journal.segments.every(segment => segment.bytes <= 64 * 1024 * 1024)).toBe(true);
  });

  it("latches an unsuccessful flush and refuses to publish a terminal receipt", () => {
    const receipt = start();
    const flush = vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
      throw new Error("injected storage failure");
    });
    expect(() => receipt.write("kit-logical-1", logical, request)).toThrow(/injected storage/);
    expect(flush).toHaveBeenCalledOnce();
    expect(() => receipt.write("failure", { reports: [], exitCode: 2 })).toThrow(/no longer writable/);
    expect(() => verifyAuditExecutionReceipts(receipt.directory)).toThrow(/terminal/);
  });

  it("withholds the completion marker when the terminal flush fails", () => {
    const receipt = start();
    receipt.write("kit-logical-1", logical, request);
    const fsync = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync")
      .mockImplementationOnce(fsync)
      .mockImplementationOnce(fsync)
      .mockImplementationOnce(() => { throw new Error("terminal flush failed"); });
    expect(() => receipt.write("outcome", { reports: [], exitCode: 0 })).toThrow(/terminal flush failed/);
    expect(fs.existsSync(path.join(receipt.directory, "outcome.json"))).toBe(true);
    expect(() => verifyAuditExecutionReceipts(receipt.directory, { requireJournal: true })).toThrow(/completion marker/);
  });

  it.each(["before-commit", "after-commit", "after-terminal"])("recovers only sealed output after a process exit (%s)", boundary => {
    const { workspace, target, root } = fixture();
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import fs from "node:fs";
      import { reserveAuditExecution } from "./src/audits/core/auditExecutionReceipt.ts";
      const [workspace, target, boundary] = process.argv.slice(1);
      const receipt = reserveAuditExecution(workspace, target);
      if (boundary === "before-commit") fs.fsyncSync = () => process.exit(73);
      receipt.write("kit-logical-1", { kind: "source-range", family: "source" },
        { selector: "line-range", requestSha256: "a".repeat(64) });
      if (boundary === "after-terminal") receipt.write("outcome", { exitCode: 0, reports: [] });
      process.exit(73);
    `, workspace, target, boundary], {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true,
      env: { ...process.env, [mode]: "1", TSX_DISABLE_CACHE: "1" },
    });
    expect(child.status, child.stderr).toBe(73);
    const [directory] = executions(root);
    if (boundary === "after-terminal") {
      expect(verifyAuditExecutionReceipts(directory!, { requireJournal: true }).journal?.records).toBe(1);
    } else {
      expect(() => verifyAuditExecutionReceipts(directory!, { requireJournal: true })).toThrow(/terminal/);
    }
  });

  it.each(["truncated", "missing", "extra", "forged-hash", "sequence-gap", "replayed", "missing-seal", "swapped", "duplicated"])(
    "rejects %s persisted output", corruption => {
      const receipt = start();
      stream(receipt);
      const root = path.join(receipt.directory, journalFolder);
      const file = path.join(root, segmentName);
      const bytes = fs.readFileSync(file);
      const manifestPath = path.join(root, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const headerLength = bytes.readUInt32LE(0);
      switch (corruption) {
        case "truncated": fs.truncateSync(file, bytes.length - 3); break;
        case "missing": fs.unlinkSync(file); break;
        case "extra": fs.copyFileSync(file, path.join(root, "segment-00000001.bin")); break;
        case "missing-seal": fs.unlinkSync(manifestPath); break;
        case "swapped":
        case "duplicated": {
          const endOfRecord = (start: number) => {
            const payload = start + 4 + bytes.readUInt32LE(start);
            const header: { bytes: number } = JSON.parse(bytes.toString("utf8", start + 4, payload));
            return payload + header.bytes;
          };
          const first = endOfRecord(0);
          const second = endOfRecord(first);
          const altered = corruption === "swapped"
            ? Buffer.concat([bytes.subarray(first, second), bytes.subarray(0, first), bytes.subarray(second)])
            : Buffer.concat([bytes.subarray(0, first), bytes]);
          fs.writeFileSync(file, altered);
          manifest.segments[0].bytes = altered.length;
          manifest.segments[0].sha256 = createHash("sha256").update(altered).digest("hex");
          fs.writeFileSync(manifestPath, JSON.stringify(manifest) + "\n");
          break;
        }
        default: {
          const text = bytes.toString("utf8", 4, 4 + headerLength);
          const altered = corruption === "forged-hash" ? text.replace(/"sha256":"./, match =>
            match.slice(0, -1) + (match.endsWith("0") ? "1" : "0")) : corruption === "sequence-gap"
            ? text.replace('"sequence":1', '"sequence":2') : text.replace('"kit-logical-1"', '"kit-logical-0"');
          bytes.write(altered, 4);
          fs.writeFileSync(file, bytes);
          manifest.segments[0].sha256 = createHash("sha256").update(bytes).digest("hex");
          fs.writeFileSync(manifestPath, JSON.stringify(manifest) + "\n");
        }
      }
      expect(() => verifyAuditExecutionReceipts(receipt.directory, { requireJournal: true })).toThrow();
    },
  );

  it("rejects checkpoint traversal and journal junctions", () => {
    const escape = start();
    expect(() => escape.write("../outside", {})).toThrow(/receipt name/);
    expect(fs.existsSync(path.join(path.dirname(escape.directory), "outside.json"))).toBe(false);
    const receipt = start();
    const root = path.join(receipt.directory, journalFolder);
    fs.rmdirSync(root);
    fs.symlinkSync(escape.directory, root, process.platform === "win32" ? "junction" : "dir");
    expect(() => receipt.write("kit-logical-1", logical, request)).toThrow(/identity/);
  });

  it("rejects a segment replayed from another execution even with an updated physical digest", () => {
    const oldReceipt = start();
    stream(oldReceipt);
    const current = start();
    stream(current);
    const root = path.join(current.directory, journalFolder);
    const manifestPath = path.join(root, "manifest.json");
    const bytes = fs.readFileSync(path.join(oldReceipt.directory, journalFolder, segmentName));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    fs.writeFileSync(path.join(root, segmentName), bytes);
    manifest.segments[0].bytes = bytes.length;
    manifest.segments[0].sha256 = createHash("sha256").update(bytes).digest("hex");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest) + "\n");
    expect(() => verifyAuditExecutionReceipts(current.directory, { requireJournal: true })).toThrow(/envelope identity/);
  });

  const qualifiedArchivePath = process.env.LAB_R8_R6_R2_KIT_ARCHIVE;
  const installedPackageRoot = process.env.LAB_R8_R6_R2_KIT_PACKAGE;
  it.skipIf(!qualifiedArchivePath || !installedPackageRoot)("keeps the CLI report and mandatory source exit in journal mode", async () => {
    vi.stubEnv(mode, "1");
    const { workspace, target, root, argv } = fixture();
    const run = (extra: string[]) => runAuditCommandFromArgs([...argv, ...extra], {
      evidenceWorkspace: workspace,
      kitSourceProviderDependencies: { expectation: QUALIFIED_B5_P1_R7A_KIT, qualifiedArchivePath, installedPackageRoot },
    });
    expect(await run(["--require-source", "tests/absent.test.mjs"])).toBe(2);
    const [failure] = executions(root);
    const failed = verifyAuditExecutionReceipts(failure!, { requireJournal: true });
    expect(failed.terminal).toBe("failure");
    expect(JSON.parse(failed.read("declared-required-files").toString()).evidence).toEqual([
      { path: "tests/absent.test.mjs", present: false },
    ]);
    expect(load(failure!, "failure").evidence).toMatchObject({ category: "selection-incomplete", exitCode: 2 });
    expect(await run([])).toBe(0);
    const outcome = executions(root).find(directory => directory !== failure)!;
    const replay = verifyAuditExecutionReceipts(outcome, { requireJournal: true });
    expect(replay.terminal).toBe("outcome");
    expect(replay.journal!.records).toBeGreaterThan(0);
    const reports: Digest[] = load(outcome, "outcome").evidence.reports;
    for (const report of reports) verify(report);
    expect(JSON.parse(replay.read("kit-package").toString()).evidence.cliSha256).toBe(QUALIFIED_B5_P1_R7A_KIT.cliSha256);
    vi.stubEnv(mode, undefined);
    expect(await run([])).toBe(0);
    const legacy = executions(root).find(directory => directory !== failure && directory !== outcome)!;
    const legacyReports: Digest[] = load(legacy, "outcome").evidence.reports;
    const jsonReport = (files: Digest[]) => JSON.parse(verify(files.find(file => file.path.endsWith(".json"))!).toString());
    expect(Object.keys(jsonReport(reports))).toEqual(Object.keys(jsonReport(legacyReports)));
    expect(jsonReport(reports).schemaVersion).toBe(jsonReport(legacyReports).schemaVersion);
    expect(fs.readFileSync(path.join(target, "tests/spec.test.mjs"), "utf8")).toBe('test.only("independent", () => {});\n');
  }, 30_000);
});
