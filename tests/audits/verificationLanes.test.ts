import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Existing verification entrypoints are plain ESM scripts.
import { verifyPrivateBytes, validateBinding } from "../../scripts/verify-private-provenance.mjs";
// @ts-expect-error Existing verification entrypoints are plain ESM scripts.
import { sourceIdentity, observeSourceExecution, runPublicTests, publicTemporaryRoot, ownedDirectory, PRIVATE_TEST_FILES, publicExecutionScope } from "../../scripts/run-verification-lane.mjs";
const owned: string[] = [];
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
afterEach(() => { for (const root of owned.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verification-lanes-")); owned.push(root);
  const directory = path.join(root, "tests/fixtures/audits"); fs.mkdirSync(directory, { recursive: true });
  const decisions = Array.from({ length: 150 }, (_, i) => ({ decisionId: `decision-${String(i).padStart(3, "0")}`, normalizedKitFindings: [] }));
  const records = [
    { identity: "CANDIDATE05_EXACT_COMMIT_QUALIFICATION", candidate: { sourceCommit: "c".repeat(40), packageVersion: "1.14.0" }, schemaVersion: "1.1.0", extractorRevision: "source-audit-v1.5.0" },
    { decisions: decisions.map(d => ({ canonicalDecisionId: d.decisionId, kitFindings: [] })) }, { decisions }
  ];
  const paths: Record<string, string> = {};
  const artifacts = records.map((record, i) => { const bytes = JSON.stringify(record), id = String(i), file = path.join(root, id + ".json"); fs.writeFileSync(file, bytes); paths[id] = file; return { id, kind: "historical-json", sizeBytes: Buffer.byteLength(bytes), sha256: sha(bytes) }; });
  const oracle = JSON.stringify({ provenance: { gate4ReconciliationSha256: artifacts[1].sha256, canonicalLedgerSha256: artifacts[2].sha256 }, decisions });
  fs.writeFileSync(path.join(directory, "kitGate4AcceptedBaseline.v010.json"), oracle);
  fs.writeFileSync(path.join(directory, "historicalEvidenceIdentity.v010.json"), JSON.stringify({ oracleSha256: sha(oracle), candidate05: { qualificationSha256: artifacts[0].sha256, sourceCommit: "c".repeat(40), packageVersion: "1.14.0" }, artifacts }));
  return { root, inputs: { paths } };
}
describe("public temporary IPC root", () => {
  it("inherits the project temporary root in a real tsx command and preserves failure exit status", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ipc-child-")); owned.push(root);
    const temp = publicTemporaryRoot(process.cwd());
    const env = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, TSX_DISABLE_CACHE: "1" };
    const cli = path.resolve("node_modules/tsx/dist/cli.mjs");
    const child = spawnSync(process.execPath, [cli, "--eval", "console.log(require('node:os').tmpdir())"], { env, encoding: "utf8", windowsHide: true });
    expect(child.status, child.stderr).toBe(0); expect(child.stdout.trim()).toBe(temp);
    const failed = spawnSync(process.execPath, [cli, "--eval", "process.exit(7)"], { env, encoding: "utf8", windowsHide: true });
    expect(failed.status, failed.stderr).toBe(7);
  });
  it("uses a physical contained directory, rejects collisions and unsafe links, and respects Unix IPC bounds", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ipc-")); owned.push(root);
    const temp = publicTemporaryRoot(root, "win32");
    expect(temp).toBe(fs.realpathSync(temp));
    expect(path.relative(root, temp)).toBe(path.join(".my-dev-kit-workflow", "t"));
    for (const [platform, bound] of [["darwin", 104], ["linux", 108]] as const) {
      const length = Buffer.byteLength(path.join(temp, "tsx-4294967295", "2147483647.pipe")) + 1;
      if (length <= bound) expect(publicTemporaryRoot(root, platform)).toBe(temp);
      else expect(() => publicTemporaryRoot(root, platform)).toThrow("too long");
    }
    fs.rmdirSync(temp); fs.writeFileSync(temp, "collision");
    expect(() => publicTemporaryRoot(root, "win32")).toThrow("Unsafe");
    fs.unlinkSync(temp);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ipc-out-")); owned.push(outside);
    fs.symlinkSync(outside, temp, process.platform === "win32" ? "junction" : "dir");
    expect(() => publicTemporaryRoot(root, "win32")).toThrow("Unsafe");
  });
});

describe("mandatory protected verification and exact-candidate binding", () => {
  it("examines actual private bytes and all 150 decisions", () => { const f = fixture(); expect(verifyPrivateBytes(f.root, f.inputs)).toMatchObject({ status: "PASS", decisions: 150, equivalent: 150 }); });
  it("fails missing evidence and altered bytes instead of trusting expected metadata", () => {
    const f = fixture(); expect(() => verifyPrivateBytes(f.root, { paths: {} })).toThrow("Missing private artifact");
    fs.appendFileSync(f.inputs.paths["0"], " "); expect(() => verifyPrivateBytes(f.root, f.inputs)).toThrow("Private byte identity mismatch");
  });
  it("rejects stale commits, stale source trees, failed lanes and incomplete release execution", () => {
    const identity = { candidateSha: "a".repeat(40), source: "b".repeat(64), oracleSha256: "c".repeat(64) };
    const binding = { schemaVersion: "1.0.0", candidateSha: identity.candidateSha, sourceIdentity: identity.source, oracleSha256: identity.oracleSha256, publicLane: { status: "PASS", scope: "focused", exitCode: 0, sourceUnchanged: true, candidateSha: identity.candidateSha, sourceIdentity: identity.source }, privateLane: { status: "PASS" }, privateTestsExitCode: 0, decisions: 150, equivalent: 150 };
    expect(validateBinding(binding, identity)).toBe(true);
    expect(() => validateBinding(binding, identity, true)).toThrow("Full public suite required");
    for (const change of [{ candidateSha: "other" }, { sourceIdentity: "other" }, { privateTestsExitCode: 1 }, { privateLane: { status: "BLOCKED" } }, { publicLane: { status: "PASS", exitCode: 1 } }, { decisions: 149 }]) expect(() => validateBinding({ ...binding, ...change }, identity)).toThrow();
  });
  it("confines output and keeps historical tests assigned to a mandatory separate lane", () => {
    const f = fixture(); expect(ownedDirectory(f.root, path.join(f.root, "runtime"))).toBe(fs.realpathSync(path.join(f.root, "runtime")));
    expect(() => ownedDirectory(f.root, path.dirname(f.root))).toThrow();
    expect(PRIVATE_TEST_FILES).toContain("tests/audits/kitSourceDifferential.test.ts");
  });
  it("never presents filtered, sharded or unknown public execution as a full suite", () => {
    expect(publicExecutionScope([])).toBe("full");
    expect(publicExecutionScope(["--reporter", "verbose", "--maxWorkers", "2"])).toBe("full");
    for (const args of [["tests/audits"], ["--testNamePattern", "one"], ["--shard", "1/2"], ["--exclude", "tests/security"], ["--unknown"]]) expect(publicExecutionScope(args)).toBe("focused");
  });
});


describe("public lane source immutability", () => {
  function repository(childBody: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lane-identity-")); owned.push(root);
    const git = (args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "pipe" });
    git(["init", "--quiet"]);
    fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
    fs.writeFileSync(path.join(root, "tracked.ts"), "original tracked source\n");
    git(["add", "--", ".gitignore", "tracked.ts"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture"]);
    fs.writeFileSync(path.join(root, "untracked.ts"), "original untracked source\n");
    fs.mkdirSync(path.join(root, "node_modules/vitest"), { recursive: true });
    // Plain child performs real fixture writes; the assertions below exercise
    // the lane's exported byte-inventory seam without a nested tsx environment.
    fs.writeFileSync(path.join(root, "node_modules/vitest/vitest.mjs"),
      'import fs from "node:fs"; import path from "node:path"; import os from "node:os";\n' + childBody);
    return root;
  }
  function runFixture(root: string) {
    // Exercise the exported byte-inventory seam used by the real lane. This
    // child is plain Node, so it needs no nested tsx socket environment.
    const temp = ownedDirectory(root, path.join(root, ".my-dev-kit-workflow/t"));
    return spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs")], {
      cwd: root, env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp }, windowsHide: true,
    });
  }
  it("accepts owned temporary work only after cleanup restores the exact source inventory", () => {
    const root = repository('const d=fs.mkdtempSync(path.join(os.tmpdir(), "owned-")); fs.writeFileSync(path.join(d,"artifact"),"temporary"); fs.rmSync(d,{recursive:true});');
    const before = sourceIdentity(root);
    expect(runFixture(root).status).toBe(0);
    expect(sourceIdentity(root)).toBe(before);
    expect(fs.readFileSync(path.join(root, "untracked.ts"), "utf8")).toBe("original untracked source\n");
    expect(fs.readdirSync(path.join(root, ".my-dev-kit-workflow/t"))).toEqual([]);
  });
  it.each([
    ["changed tracked source", 'fs.writeFileSync("tracked.ts","changed");'],
    ["new untracked source", 'fs.writeFileSync("unexpected.ts","unexpected");'],
    ["changed pre-existing untracked source", 'fs.writeFileSync("untracked.ts","changed");'],
    ["failed temporary cleanup", 'const d=fs.mkdtempSync(path.join(os.tmpdir(),"failed-cleanup-")); fs.writeFileSync(path.join(d,"artifact"),"keep"); let failed=false; try { fs.rmdirSync(d); } catch { failed=true; } if(!failed) process.exit(2);'],
  ])("rejects %s even when the child exits successfully", (_name, body) => {
    const root = repository(body);
    const before = sourceIdentity(root);
    expect(runFixture(root).status).toBe(0);
    expect(sourceIdentity(root)).not.toBe(before);
  });
  it("keeps authorized runtime bytes and nested repositories outside source identity", () => {
    const root = repository('');
    fs.writeFileSync(path.join(root, ".gitignore"), fs.readFileSync(path.resolve(".gitignore")));
    const before = sourceIdentity(root);
    const runtime = ownedDirectory(root, path.join(root, ".my-dev-kit-workflow/t/retained"));
    execFileSync("git", ["init", "--quiet", runtime], { windowsHide: true });
    fs.writeFileSync(path.join(runtime, "artifact"), "retained runtime");
    const observed = observeSourceExecution(root, () => ({ status: 0 }));
    expect(observed.inventoryDiagnostic).toBeNull();
    expect(observed.before).toBe(before);
    expect(observed.after).toBe(before);
    expect(fs.readFileSync(path.join(runtime, "artifact"), "utf8")).toBe("retained runtime");
    fs.writeFileSync(path.join(root, "unexpected.ts"), "unauthorized source");
    expect(sourceIdentity(root)).not.toBe(before);
  });
  it("rejects an unexpected untracked repository directory with a source diagnostic", () => {
    const root = repository('');
    const unexpected = path.join(root, "unexpected");
    fs.mkdirSync(unexpected);
    execFileSync("git", ["init", "--quiet", unexpected], { windowsHide: true });
    expect(() => sourceIdentity(root)).toThrow('SOURCE_INVENTORY_ERROR: unexpected directory');
  });
  it("fails closed on a source junction or symlink, including linked ancestors", () => {
    const root = repository('');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "source-outside-")); owned.push(outside);
    fs.writeFileSync(path.join(outside, "source.ts"), "outside source");
    fs.mkdirSync(path.join(root, "linked"));
    fs.writeFileSync(path.join(root, "linked/source.ts"), "original source");
    execFileSync("git", ["add", "--", "linked/source.ts"], { cwd: root, windowsHide: true });
    fs.rmSync(path.join(root, "linked"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    expect(() => sourceIdentity(root)).toThrow('SOURCE_INVENTORY_ERROR: symbolic link or junction');
  });
  it("records an inventory failure after a successful child without losing the diagnostic", () => {
    const root = repository('');
    const observed = observeSourceExecution(root, () => {
      const unexpected = path.join(root, "leftover"); fs.mkdirSync(unexpected);
      execFileSync("git", ["init", "--quiet", unexpected], { windowsHide: true });
      return { status: 0 };
    });
    expect(observed.result.status).toBe(0);
    expect(observed.before).toEqual(expect.any(String));
    expect(observed.after).toBeNull();
    expect(observed.inventoryDiagnostic).toContain("SOURCE_INVENTORY_ERROR");
  });
  it("emits a canonical FAIL result and never launches a child for invalid initial inventory", () => {
    const root = repository('throw new Error("child must not launch");');
    const unexpected = path.join(root, "unexpected"); fs.mkdirSync(unexpected);
    execFileSync("git", ["init", "--quiet", unexpected], { windowsHide: true });
    const output = path.join(root, ".my-dev-kit-context/failure.json");
    const previous = process.env.LAB_PUBLIC_VERIFICATION_RESULT;
    process.env.LAB_PUBLIC_VERIFICATION_RESULT = output;
    try {
      expect(runPublicTests([], root)).toBe(1);
      expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({
        status: "FAIL", scope: "full", exitCode: 1, childExitCode: null,
        sourceUnchanged: false, sourceIdentity: null,
        inventoryDiagnostic: expect.stringContaining("SOURCE_INVENTORY_ERROR"),
      });
    } finally {
      if (previous === undefined) delete process.env.LAB_PUBLIC_VERIFICATION_RESULT;
      else process.env.LAB_PUBLIC_VERIFICATION_RESULT = previous;
    }
  });

});
