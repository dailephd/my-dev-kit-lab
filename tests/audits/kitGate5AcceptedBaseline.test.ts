import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { DEFAULT_AUDIT_REGISTRY } from "../../src/audits/core/auditRegistry.js";
import { QUALIFIED_PUBLISHED_KIT, type KitCandidateExpectation } from "../../src/audits/core/kitSourceProvider.js";
import { execFileSync } from "node:child_process";
// @ts-expect-error Source-checkout verification is an existing plain ESM owner.
import { verificationOutputDirectory } from "../../scripts/run-verification-lane.mjs";

const root = process.cwd();
const privateLane = process.env.LAB_VERIFICATION_LANE === "private";
const task = path.join(root, ".my-dev-kit-workflow/tmp/v010-lab-kit-gate5/gate5-default-cutover");
const oraclePath = path.join(root, "tests/fixtures/audits/kitGate4AcceptedBaseline.v010.json");
const oracleBytes = fs.readFileSync(oraclePath);
const oracle = JSON.parse(oracleBytes.toString("utf8"));
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
// Public historical-location projection, independently pinned from the private record.
const acceptedOracleSha256 = "a30cad80f5de3975cc17d6b804d7aeedccdb3a3d7f412b5950c098a3176f3457";
const candidate = path.join(root, ".my-dev-kit-workflow/tools/v010-lab-kit-gate4/kit-candidate-05/node_modules/@dailephd/my-dev-kit");
const expectation: KitCandidateExpectation = {
  packageName: "@dailephd/my-dev-kit", packageVersion: "1.14.0",
  artifactSchemaVersion: "1.1.0", extractorRevision: "source-audit-v1.5.0",
  cliSha256: "35dbc49fc91f8c47f1e7cdaf86223414a54517ff25a1a29f87231b2bae3807b8",
};
type Decision = (typeof oracle.decisions)[number];
const fixtureRoots: string[] = [...new Set<string>(oracle.decisions.map((d: Decision) => d.fixtureRoot))].sort();
const completed: { decisionId: string; normalizedKitFindings: unknown }[] = [];
const currentCompleted: { decisionId: string; normalizedKitFindings: unknown }[] = [];
const currentCoverage: unknown[] = [];
const p5Root = process.env.LAB_SW123_P5_ROOT;
const p5Package = process.env.LAB_SW123_P5_PACKAGE_ROOT;
if (Boolean(p5Root) !== Boolean(p5Package)) throw new Error("P5 requires both workspace and installed producer.");
const p5Expectation: KitCandidateExpectation = {
  packageName: "@dailephd/my-dev-kit", packageVersion: "1.15.1", artifactSchemaVersion: "1.1.0",
  extractorRevision: "source-audit-v1.5.1", cliSha256: "591109bd72d4f423865e65eac28e216a754c7abdb470d1df21066c6edc8522eb",
};
const p5Completed: unknown[] = [];
const p5Authority = p5Root ? path.dirname(path.resolve(root, execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8", windowsHide: true }).trim())) : root;
if (p5Root) assertContainedDirectory(p5Root, p5Authority);
const p5Output = p5Root ? fs.mkdtempSync(path.join(p5Root, "candidate-results/accepted-oracle-")) : undefined;

// Identical to the accepted differential normalization: arrays keep their order.
function normalize(value: unknown, target: string): any {
  if (typeof value === "string") return value.split(target).join("<TARGET>").split(target.replace(/\\/g, "/")).join("<TARGET>");
  if (Array.isArray(value)) return value.map((v) => normalize(v, target));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v, target)]));
  return value;
}

function validateOracle(value: typeof oracle): void {
  // Pin the complete public record, including dispositions and every finding field.
  if (sha(JSON.stringify(value, null, 2) + "\n") !== acceptedOracleSha256) throw new Error("Accepted oracle integrity mismatch");
  expect(Object.keys(value)).toEqual(["schemaVersion", "provenance", "normalization", "fixtureFileHashes", "decisions"]);
  expect(value.schemaVersion).toBe("gate5-accepted-oracle-v1");
  expect(value.decisions).toHaveLength(150);
  expect(new Set(value.decisions.map((d: Decision) => d.decisionId)).size).toBe(150);
  expect(new Set(value.decisions.map((d: Decision) => d.fixtureRoot)).size).toBe(15);
  expect(Object.keys(value.fixtureFileHashes)).toHaveLength(121);
  expect(value.decisions.filter((d: Decision) => d.historicalClassification === "COMPLETED_PARITY")).toHaveLength(134);
  expect(value.decisions.filter((d: Decision) => d.acceptedDifferenceDisposition !== null)).toHaveLength(16);
  expect(value.decisions.filter((d: Decision) => d.acceptedDifferenceDisposition?.profileQualification?.classification === "INCOMPARABLE_PROFILES")).toHaveLength(3);
  for (const d of value.decisions) {
    expect(d.decisionId).toBe(`${d.fixtureRoot}::${d.detectorId}`);
    expect(d.normalizedKitFindings.map((f: any) => f.id)).toEqual(d.normalizedKitFindings.map((f: any) => f.id).sort((a: string, b: string) => a.localeCompare(b)));
  }
}

function assertContainedDirectory(directory: string, authority = root): void {
  const relative = path.relative(authority, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Uncontained Gate5 directory");
  for (let current = directory; path.relative(authority, current) !== ""; current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Linked Gate5 directory");
    if (path.relative(authority, fs.realpathSync(current)).startsWith("..")) throw new Error("Escaped Gate5 directory");
  }
}

describe("Gate5 committed accepted oracle", () => {
  it("publishes only relative source witnesses and digest-qualified historical locations", () => {
    expect(oracle.normalization.publicProjection.version).toBe("historical-location-projection-v1");
    expect(oracleBytes.toString("utf8")).not.toMatch(/[A-Za-z]:[\\/]+Users[\\/]|\/(?:Users|home)\/[^/]+\//i);
    for (const d of oracle.decisions) {
      const disposition = d.acceptedDifferenceDisposition;
      if (!disposition) continue;
      const identity = disposition.sourceIdentity.candidate;
      expect(identity.installedPackageRoot).toBe(`historical-package:Candidate05:sha256:${identity.cliSha256}`);
      expect(identity.qualificationFile).toBe(`urn:sha256:${identity.qualificationSha256}`);
      const retained = disposition.profileQualification?.retained;
      if (!retained) continue;
      expect(retained.retainedProfileContract.reference).toBe(`urn:sha256:${retained.retainedProfileContract.sha256}`);
      for (const witness of retained.sourceWitnesses) {
        expect(path.isAbsolute(witness.path)).toBe(false);
        expect(witness.path).toMatch(/^tests\/fixtures\//);
        expect(oracle.fixtureFileHashes[witness.path]).toBe(witness.expectedSha256);
        expect(sha(fs.readFileSync(path.join(root, witness.path)))).toBe(witness.expectedSha256);
      }
      for (const check of retained.independentSourceAndProfileChecks) {
        expect(Object.hasOwn(oracle.fixtureFileHashes, check.path)).toBe(true);
      }
    }
  });

  it("authenticates the complete closed accepted record and all tracked fixture bytes", () => {
    expect(sha(oracleBytes)).toBe(acceptedOracleSha256);
    validateOracle(oracle);
    for (const [relative, hash] of Object.entries(oracle.fixtureFileHashes)) expect(sha(fs.readFileSync(path.join(root, relative)))).toBe(hash);
    if (privateLane) expect(sha(fs.readFileSync(path.join(candidate, "dist/cli.js")))).toBe(expectation.cliSha256);
    else expect(sha(fs.readFileSync(path.join(root, "node_modules/@dailephd/my-dev-kit/dist/cli.js")))).toBe(QUALIFIED_PUBLISHED_KIT.cliSha256);
  });

  if (privateLane) it("reproduces the accepted Kit findings and exact ledger domain from original evidence", () => {
    const base = path.join(root, ".my-dev-kit-workflow/tmp/v010-lab-kit-gate4");
    const reconciliation = fs.readFileSync(path.join(base, "gate4-owner-authorized-closeout/comparisons/150-decision-post-closeout-reconciliation.json"));
    const ledger = fs.readFileSync(path.join(base, "correction-09/comparisons/gate4-150-decision-ledger.json"));
    expect(sha(reconciliation)).toBe(oracle.provenance.gate4ReconciliationSha256);
    expect(sha(ledger)).toBe(oracle.provenance.canonicalLedgerSha256);
    const accepted = JSON.parse(reconciliation.toString("utf8"));
    expect(oracle.decisions.map((d: Decision) => d.decisionId)).toEqual(JSON.parse(ledger.toString("utf8")).decisions.map((d: any) => d.decisionId).sort((a: string, b: string) => a.localeCompare(b)));
    for (const d of oracle.decisions) expect(d.normalizedKitFindings).toEqual(accepted.decisions.find((a: any) => a.canonicalDecisionId === d.decisionId).kitFindings);
  });

  it.each(["missing", "extra", "duplicate", "fixture", "hash", "producer", "finding", "disposition", "incomparability"])("rejects %s tampering", (kind) => {
    const copy = structuredClone(oracle);
    const finding = copy.decisions.find((d: Decision) => d.normalizedKitFindings.length).normalizedKitFindings[0];
    switch (kind) {
      case "missing": copy.decisions.pop(); break;
      case "extra": copy.decisions.push({ ...copy.decisions[0], decisionId: "extra" }); break;
      case "duplicate": copy.decisions[1] = copy.decisions[0]; break;
      case "fixture": copy.decisions[0].fixtureRoot = "other"; break;
      case "hash": copy.fixtureFileHashes[Object.keys(copy.fixtureFileHashes)[0]] = "0".repeat(64); break;
      case "producer": copy.provenance.installedCliSha256 = "0".repeat(64); break;
      case "finding": finding.severity = "tampered"; finding.confidence = "tampered"; finding.evidence = []; break;
      case "disposition": copy.decisions.find((d: Decision) => d.acceptedDifferenceDisposition).acceptedDifferenceDisposition = null; break;
      case "incomparability": copy.decisions.find((d: Decision) => d.acceptedDifferenceDisposition?.profileQualification).acceptedDifferenceDisposition.profileQualification.classification = "PARITY"; break;
    }
    expect(() => validateOracle(copy)).toThrow("Accepted oracle integrity mismatch");
  });

  it.each(fixtureRoots.flatMap(fixtureRoot => (privateLane ? ["historical"] : p5Root ? ["published", "p5-candidate"] : ["published"]).map(provider => ({ fixtureRoot, provider }))))("executes ten canonical $provider Kit decisions for $fixtureRoot", async ({ fixtureRoot, provider }) => {
    const base = provider === "p5-candidate" ? path.join(p5Root!, "integration-target") : os.tmpdir();
    assertContainedDirectory(base, p5Root ? p5Authority : root);
    const workspace = fs.mkdtempSync(path.join(base, "gate5-oracle-"));
    const target = path.join(workspace, "target");
    fs.mkdirSync(target);
    for (const [relative, hash] of Object.entries(oracle.fixtureFileHashes)) {
      if (!relative.startsWith(fixtureRoot + "/")) continue;
      const bytes = fs.readFileSync(path.join(root, relative));
      expect(sha(bytes)).toBe(hash);
      const output = path.join(target, relative.slice(fixtureRoot.length + 1).replace(/\.input$/, ""));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, relative.endsWith(".input") ? JSON.parse(bytes.toString("utf8")) : bytes, { flag: "wx" });
    }
    const config = normalizeAuditConfig({ target, types: "code-rot", include: "docs,tests,package,architecture,cli", failOn: "none", out: path.join(workspace, "reports") }, root);
    const workDir = provider === "p5-candidate" ? fs.mkdtempSync(path.join(p5Root!, "integration-index/oracle-")) : path.join(workspace, "kit");
    const result = await runAudit({ config, toolRoot: root, kitSourceProviderDependencies: {
      installedPackageRoot: provider === "historical" ? candidate : provider === "p5-candidate" ? p5Package : path.join(root, "node_modules/@dailephd/my-dev-kit"),
      expectation: provider === "historical" ? expectation : provider === "p5-candidate" ? p5Expectation : QUALIFIED_PUBLISHED_KIT, workDir,
    } });
    if (provider === "p5-candidate") fs.writeFileSync(path.join(p5Output!, path.basename(fixtureRoot) + ".json"), JSON.stringify({ fixtureRoot, workDir, result }, null, 2), { flag: "wx" });
    expect(result.detectorErrors).toEqual([]);
    if (provider === "published") currentCoverage.push({ fixtureRoot, detectors: DEFAULT_AUDIT_REGISTRY.map(d => d.id).sort(),
      detectorErrors: result.detectorErrors, skippedDetectors: result.skippedDetectors, exitCode: result.exitCode });
    const findings = result.issues.map(issue => normalize(issue, target)).sort((a, b) => a.id.localeCompare(b.id));
    // The extractor revision intentionally changes snapshots. Authenticate the
    // new identity independently, then project only the exact snapshot token
    // in the existing JVM proof message. The frozen oracle stays untouched.
    let identityProjection: { historicalSnapshot: string; candidateSnapshot: string } | undefined;
    if (provider === "p5-candidate") {
      const bytes = fs.readFileSync(path.join(workDir, "index/source-audit-evidence.json"));
      const artifact = JSON.parse(bytes.toString("utf8"));
      const manifest = JSON.parse(fs.readFileSync(path.join(workDir, "index/manifest.json"), "utf8"));
      expect(sha(bytes)).toBe(manifest.sourceAuditEvidence.sha256);
      const snapshot = (revision: string) => sha(JSON.stringify({ schemaVersion: artifact.schemaVersion,
        selectionFingerprint: artifact.source.selectionFingerprint, extractorContractRevision: revision,
        files: artifact.files.map((f: any) => ({ path: f.path, contentSha256: f.contentSha256,
          selectionStatus: f.status === "unsupported" ? "unsupported" : "supported", language: f.language, role: f.role, status: f.status })),
      }));
      expect(snapshot("source-audit-v1.5.1")).toBe(artifact.source.snapshotId);
      expect(result.sourceFacts.kitEvidence!.snapshotId).toBe(artifact.source.snapshotId);
      identityProjection = { historicalSnapshot: snapshot("source-audit-v1.5.0"), candidateSnapshot: artifact.source.snapshotId };
    }
    const decisions = oracle.decisions.filter((d: Decision) => d.fixtureRoot === fixtureRoot);
    expect(decisions).toHaveLength(10);
    expect(DEFAULT_AUDIT_REGISTRY.map(d => d.id).sort()).toEqual(decisions.map((d: Decision) => d.detectorId).sort());
    for (const decision of decisions) {
      const actual = findings.filter(f => f.detectorId === decision.detectorId);
      const expected = structuredClone(decision.normalizedKitFindings);
      if (identityProjection) for (const finding of expected) for (const evidence of finding.evidence) {
        if (!evidence.message.startsWith("Qualified Kit declaration-domain evidence found no matching declaration")) continue;
        const oldToken = `snapshot: ${identityProjection.historicalSnapshot}.`;
        expect(evidence.message).toContain(oldToken);
        evidence.message = evidence.message.replace(oldToken, `snapshot: ${identityProjection.candidateSnapshot}.`);
      }
      expect(actual, decision.decisionId).toEqual(expected);
      if (provider === "historical") completed.push({ decisionId: decision.decisionId, normalizedKitFindings: actual });
      else if (provider === "p5-candidate") p5Completed.push({ decisionId: decision.decisionId, normalizedKitFindings: actual, identityProjection });
      else currentCompleted.push({ decisionId: decision.decisionId, normalizedKitFindings: actual });
    }
  }, 180_000);
});

afterAll(() => {
  if (p5Output) fs.writeFileSync(path.join(p5Output, "decisions.json"), JSON.stringify({ expectation: p5Expectation, oracleSha256: acceptedOracleSha256,
    count: p5Completed.length, decisions: p5Completed }, null, 2) + "\n", { flag: "wx" });
});

afterAll(() => {
  const output = process.env.LAB_CURRENT_ORACLE_OUTPUT;
  if (!output) return;
  if (privateLane) throw new Error("Current results cannot use the historical provider");
  const common = path.resolve(root, execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8", windowsHide: true }).trim());
  if (path.basename(common) !== ".git") throw new Error("Unknown current evidence authority");
  verificationOutputDirectory(path.dirname(common), output);
  fs.writeFileSync(output, JSON.stringify({ contractId: "LAB-KIT-01-CURRENT-CANDIDATE-ACCEPTANCE/1.0.0", provider: "published-1.15.0",
    decisions: currentCompleted.sort((a, b) => a.decisionId.localeCompare(b.decisionId)), coverage: currentCoverage }, null, 2) + "\n", { flag: "wx" });
});

afterAll(() => {
  const output = process.env.LAB_KIT_GATE5_COMPARISON_FILE;
  if (!output) return;
  const exact = path.join(task, "comparisons/150-kit-default-vs-accepted-oracle.json");
  if (path.resolve(output) !== exact) throw new Error("Comparison output outside exact Gate5 destination");
  assertContainedDirectory(path.dirname(exact));
  if (completed.length !== 150 || new Set(completed.map(d => d.decisionId)).size !== 150) throw new Error("Incomplete Gate5 execution");
  fs.writeFileSync(exact, JSON.stringify({ oracleSha256: acceptedOracleSha256, decisions: completed.sort((a, b) => a.decisionId.localeCompare(b.decisionId)), historicalDifferences: 16, incomparableProfiles: 3 }, null, 2) + "\n", { flag: "wx" });
});
