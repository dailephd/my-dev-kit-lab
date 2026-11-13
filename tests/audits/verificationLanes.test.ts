import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Existing verification entrypoints are plain ESM scripts.
import { verifyPrivateBytes, validateBinding } from "../../scripts/verify-private-provenance.mjs";
// @ts-expect-error Existing verification entrypoints are plain ESM scripts.
import { publicTemporaryRoot, ownedDirectory, PRIVATE_TEST_FILES, publicExecutionScope } from "../../scripts/run-verification-lane.mjs";
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
