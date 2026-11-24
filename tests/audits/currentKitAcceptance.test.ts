import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Existing source-checkout verifier is plain ESM.
import { verifyNativeTests, verifyResponsibilityInventory, prospectiveCurrentFindings, verifyCurrentDecisions, verifyHostedMetadata, currentIdentity, verifyCurrentLane, bindCurrent, CURRENT_CONTRACT, CURRENT_ROUTE, HISTORICAL_STATE, CURRENT_PROTECTED_TESTS } from '../../scripts/verifyCurrentKitAcceptance.mjs';
// @ts-expect-error Existing source-checkout path authority is plain ESM.
import { publicTemporaryRoot } from '../../scripts/run-verification-lane.mjs';

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const oracle = JSON.parse(fs.readFileSync('tests/fixtures/audits/kitGate4AcceptedBaseline.v010.json', 'utf8'));
const policy = JSON.parse(fs.readFileSync('tests/fixtures/audits/currentKitAcceptance.v010.json', 'utf8'));
const owned: string[] = [];
afterEach(() => { for (const p of owned.splice(0)) fs.rmSync(p, { recursive: true }); });
function nativeFixture() {
  const root = process.cwd(), file = path.join(root, 'tests/audits/currentKitAcceptance.test.ts');
  const listing = [{ name: 'suite > required', file }];
  const native = { success: true, numTotalTests: 1, numPassedTests: 1, numPendingTests: 0, numTodoTests: 0, numFailedTests: 0,
    testResults: [{ name: file, assertionResults: [{ ancestorTitles: ['suite'], title: 'required', status: 'passed', failureMessages: [] }] }] };
  return { root, listing, native, inspect: () => verifyNativeTests(native, listing, root, process.platform, 'protected') };
}
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'current-kit-gate-')); owned.push(root);
  const put = (file: string, bytes: string | Buffer) => { const p = path.join(root, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); };
  for (const file of ['package.json', 'package-lock.json', 'scripts/verifyCurrentKitAcceptance.mjs', 'scripts/verify-private-provenance.mjs',
    'tests/fixtures/audits/currentKitAcceptance.v010.json', 'tests/fixtures/audits/kitGate4AcceptedBaseline.v010.json',
    'node_modules/@dailephd/my-dev-kit/package.json', 'node_modules/@dailephd/my-dev-kit/dist/cli.js', 'node_modules/vitest/dist/cli.js',
    ...Object.keys(oracle.fixtureFileHashes)]) put(file, fs.readFileSync(file));
  put('dist/fixture.txt', 'fixture build'); put('.gitignore', 'node_modules/\ndist/\n.my-dev-kit-workflow/\n');
  const git = (a: string[]) => execFileSync('git', a, { cwd: root, windowsHide: true, stdio: 'pipe' });
  git(['init', '--quiet']); git(['add', '--', '.gitignore', 'package.json', 'package-lock.json', 'scripts', 'tests']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']);
  return { root, put };
}

describe('authorized current Kit native semantic verification', () => {
  it('derives outcome from assertion rows, not a producer PASS string', () => { const f = nativeFixture(); expect(f.inspect()).toMatchObject({ total: 1, passed: 1 });
    f.native.testResults[0].assertionResults[0].status = 'failed'; expect(f.inspect).toThrow('Native assertion failed'); });
  it('denies filtered public or incomplete protected responsibility coverage', () => { const f = nativeFixture(); f.listing.push({ ...f.listing[0], name: 'suite > missing' }); expect(f.inspect).toThrow('Filtered/incomplete'); });
  it('denies missing native results, duplicate rows and forged summary totals', () => {
    const f = nativeFixture(); expect(() => verifyNativeTests({}, f.listing, f.root, process.platform, 'public')).toThrow('Missing native');
    f.native.numPassedTests = 2; expect(f.inspect).toThrow('Forged native summary'); f.native.numPassedTests = 1;
    f.native.testResults[0].assertionResults.push(f.native.testResults[0].assertionResults[0]); expect(f.inspect).toThrow('Filtered/incomplete');
  });
  it('retains legitimate parameter-name multiplicity without accepting extra or missing cases', () => {
    const f = nativeFixture(); f.listing.push({ ...f.listing[0] });
    f.native.testResults[0].assertionResults.push({ ...f.native.testResults[0].assertionResults[0] });
    f.native.numTotalTests = 2; f.native.numPassedTests = 2;
    expect(f.inspect()).toMatchObject({ total: 2, passed: 2 });
    f.native.testResults[0].assertionResults.pop(); expect(f.inspect).toThrow('Filtered/incomplete');
  });
  it('independently compares complete inventories without depending on parallel collection order', () => {
    const f = nativeFixture(), a = [f.listing[0], { ...f.listing[0], name: 'other' }, f.listing[0]], b = [...a].reverse();
    expect(() => verifyResponsibilityInventory(a, b, f.root)).not.toThrow(); b.pop(); expect(() => verifyResponsibilityInventory(a, b, f.root)).toThrow('Stale/filtered');
  });
  it('never turns required unavailable coverage into an accepted skip', () => { const f = nativeFixture(); f.native.testResults[0].assertionResults[0].status = 'pending'; expect(f.inspect).toThrow('Required responsibility unavailable'); });
  it('qualifies only the declared physical-platform skips, including native Vitest skipped status', () => {
    const f = nativeFixture(), file = path.join(f.root, 'tests/core/resolveCommand.spec.ts');
    f.native.testResults.push({ name: file, assertionResults: [{ ancestorTitles: ['resolveCommand'], title: 'returns unavailable for a non-Windows absolute path that exists but is not executable', status: 'skipped', failureMessages: [] }] });
    f.native.numTotalTests = 2;
    f.native.numPendingTests = 1;
    expect(verifyNativeTests(f.native, f.listing, f.root, 'win32', 'protected')).toMatchObject({ passed: 1, skipped: 1 });
    expect(() => verifyNativeTests(f.native, f.listing, f.root, 'linux', 'protected')).toThrow('Required responsibility');
  });
  it('requires all150 complete findings and keeps incomplete import coverage blocking', () => {
    const result = { contractId: CURRENT_CONTRACT, provider: 'published-1.15.0', decisions: prospectiveCurrentFindings(oracle, policy),
      coverage: [...new Set<string>(oracle.decisions.map((d: any) => d.fixtureRoot))].sort().map(fixtureRoot => ({ fixtureRoot, detectors: oracle.decisions.filter((d: any) => d.fixtureRoot === fixtureRoot).map((d: any) => d.detectorId).sort(), detectorErrors: [] as unknown[], skippedDetectors: [], exitCode: 0 })) };
    expect(verifyCurrentDecisions(result, oracle, policy)).toEqual({ decisions: 150, dispositions: 16, incomparableProfiles: 3 });
    const amended = policy.prospectiveCommentDispositions;
    expect(amended).toHaveLength(2);
    for (const row of amended) {
      const original = oracle.decisions.find((d: any) => d.decisionId === row.decisionId).normalizedKitFindings;
      const current = result.decisions.find((d: any) => d.decisionId === row.decisionId).normalizedKitFindings;
      expect(original.filter((f: any) => !current.some((c: any) => c.id === f.id)).map((f: any) => f.id)).toEqual([row.findingId]);
      expect(current.filter((f: any) => /:(only|skip)-usage:/.test(f.id))).toHaveLength(2);
    }
    const historical = structuredClone(result);
    historical.decisions = oracle.decisions.map((d: any) => ({ decisionId: d.decisionId, normalizedKitFindings: d.normalizedKitFindings }));
    expect(() => verifyCurrentDecisions(historical, oracle, policy)).toThrow('findings');
    const tampered = structuredClone(policy);
    tampered.prospectiveCommentDispositions[0].findingId = 'unexpected';
    expect(() => verifyCurrentDecisions(result, oracle, tampered)).toThrow('Unauthorized prospective');
    const lostPositive = structuredClone(result);
    const cell = lostPositive.decisions.find((d: any) => d.decisionId === amended[0].decisionId);
    cell.normalizedKitFindings = cell.normalizedKitFindings.filter((f: any) => !f.id.includes(':only-usage:'));
    expect(() => verifyCurrentDecisions(lostPositive, oracle, policy)).toThrow('findings');
    const changed = structuredClone(result); changed.decisions[0].normalizedKitFindings = [{ severity: 'low', id: 'forged' }]; expect(() => verifyCurrentDecisions(changed, oracle, policy)).toThrow('findings');
    const unavailable = structuredClone(result); unavailable.coverage[0].detectorErrors.push({ message: 'PARTIAL_COVERAGE UNAVAILABLE' }); expect(() => verifyCurrentDecisions(unavailable, oracle, policy)).toThrow('Unavailable mandatory');
    result.decisions.pop(); expect(() => verifyCurrentDecisions(result, oracle, policy)).toThrow('coverage');
  });
  it('compares only authenticated JVM snapshot provenance while retaining exact finding semantics', () => {
    const decisions = prospectiveCurrentFindings(oracle, policy);
    const java = decisions.find((row: any) => row.decisionId.endsWith('/java::test-rot'));
    const finding = java.normalizedKitFindings.find((row: any) => row.id.includes(':missing-java-source-import:'));
    const proof = { importFactId: finding.evidence[0].message.match(/Import fact: ([^;]+);/)[1], snapshotId: 'ab'.repeat(32) };
    const independent = { [java.decisionId]: { [finding.id]: proof } };
    const result = { contractId: CURRENT_CONTRACT, provider: 'published-1.15.0', decisions: structuredClone(decisions),
      coverage: [...new Set<string>(oracle.decisions.map((row: any) => row.fixtureRoot))].sort().map(fixtureRoot => ({
        fixtureRoot, detectors: oracle.decisions.filter((row: any) => row.fixtureRoot === fixtureRoot)
          .map((row: any) => row.detectorId).sort(), detectorErrors: [], skippedDetectors: [], exitCode: 0,
      })) };
    const actual = result.decisions.find((row: any) => row.decisionId === java.decisionId).normalizedKitFindings.find((row: any) => row.id === finding.id);
    actual.evidence[0].message = actual.evidence[0].message.replace(/[0-9a-f]{64}\.$/, proof.snapshotId + '.');
    const verify = (candidate = result, witnesses = independent) => verifyCurrentDecisions(candidate, oracle, policy, process.cwd(), witnesses);
    expect(verify()).toEqual({ decisions: 150, dispositions: 16, incomparableProfiles: 3 });
    expect(() => verify(result, {})).toThrow('changed findings');
    const differentFact = { ...proof, importFactId: proof.importFactId + 'other' };
    expect(() => verify(result, { [java.decisionId]: { [finding.id]: differentFact } })).toThrow('authenticated JVM');
    for (const field of ['severity', 'confidence', 'id']) {
      const changed = structuredClone(result);
      changed.decisions.find((row: any) => row.decisionId === java.decisionId).normalizedKitFindings.find((row: any) => row.id === finding.id)[field] = 'forged';
      expect(() => verify(changed)).toThrow('changed findings');
    }
    actual.evidence[0].message = actual.evidence[0].message.replace(proof.snapshotId, 'cd'.repeat(32));
    expect(() => verify()).toThrow('changed findings');
  });
  it.each(policy.reviews as Array<Record<string, any>>)('independently preserves bounded source witnesses for $decisionId', review => {
    expect(review.historicalProvenance).toBe('UNVERIFIED');
    for (const w of review.sourceWitnesses) { expect(sha(fs.readFileSync(w.path))).toBe(w.sha256); expect(oracle.fixtureFileHashes[w.path]).toBe(w.sha256); }
    const decision = oracle.decisions.find((d: any) => d.decisionId === review.decisionId);
    if (decision.acceptedDifferenceDisposition.profileQualification) { expect(review.currentDisposition).toBe('INCOMPARABLE_PROFILES_RETAINED'); expect(review.parityClaim).toBe(false); }
    expect(review.reason.length).toBeGreaterThan(40);
  });
  it('checks current Python unknown-export and Java owner-chain witnesses without rewriting historical M13', () => {
    expect(fs.readFileSync('tests/fixtures/audits/kit-differential-v010/python/src/dynamic.py', 'utf8')).toMatch(/__all__ = make_names\(\)/);
    const d = oracle.decisions.find((d: any) => d.decisionId.endsWith('/python::dead-code-candidate'));
    expect(d.normalizedKitFindings.some((f: any) => /unreferenced-python-declaration.*UnknownWidget/.test(f.id))).toBe(false);
    expect(d.acceptedDifferenceDisposition.qualification.explanation).toContain('until owner resolution');
    expect(fs.readFileSync('tests/fixtures/audits/kit-differential-v010/java/src/main/java/com/example/Alpha.java', 'utf8')).toMatch(/class PackageWidget\s*\{\s*public class NestedPublicWidget/);
  });
  it('refuses absent or conflicting current route inputs without borrowing historical acceptance', async () => {
    await expect(bindCurrent(process.cwd(), { contractId: 'LAB-EVIDENCE-01', manifests: [] }, 'unused')).rejects.toThrow('Wrong binding contract');
    await expect(bindCurrent(process.cwd(), { contractId: CURRENT_CONTRACT, manifests: ['same', 'same'] }, 'unused')).rejects.toThrow('Duplicate');
    expect(HISTORICAL_STATE).toEqual({ provenance: 'UNVERIFIED', privateVerification: 'NOT_PASSED', readinessBinding: 'NOT_PASSED' });
    expect(CURRENT_PROTECTED_TESTS).not.toContain('tests/audits/kitSourceDifferential.test.ts');
  });
  it.each(['candidateSha', 'sourceIdentity', 'packageMetadataSha256', 'kitCliSha256'])('refuses changed %s binding', async key => {
    const f = repository(), identity = await currentIdentity(f.root);
    const input = path.join(f.root, '.my-dev-kit-workflow/input'); fs.mkdirSync(input, { recursive: true });
    fs.writeFileSync(path.join(input, 'manifest.json'), JSON.stringify({ contractId: CURRENT_CONTRACT, routeId: CURRENT_ROUTE, historical: HISTORICAL_STATE, identity: { ...identity, [key]: '0'.repeat(64) } }));
    await expect(verifyCurrentLane(f.root, path.join(input, 'manifest.json'), path.join(f.root, '.my-dev-kit-workflow/verify'))).rejects.toThrow('Changed candidate');
  });
  it.each(['package.json', 'node_modules/@dailephd/my-dev-kit/package.json', 'tests/fixtures/audits/kitGate4AcceptedBaseline.v010.json', Object.keys(oracle.fixtureFileHashes)[0]])('refuses invalid runtime/oracle/fixture identity: %s', async file => {
    const f = repository();
    if (file.includes('my-dev-kit/package.json')) f.put(file, JSON.stringify({ name: '@dailephd/my-dev-kit', version: '9.0.0' }));
    else if (file === 'package.json') { const p = JSON.parse(fs.readFileSync(path.join(f.root, file), 'utf8')); p.dependencies['@dailephd/my-dev-kit'] = '9.0.0'; f.put(file, JSON.stringify(p)); }
    else fs.appendFileSync(path.join(f.root, file), 'tampered');
    await expect(currentIdentity(f.root)).rejects.toThrow();
  });
  it('reopens native bytes and denies missing or tampered payloads before semantic qualification', async () => {
    const f = repository(), identity = await currentIdentity(f.root), input = path.join(f.root, '.my-dev-kit-workflow/input'); fs.mkdirSync(input, { recursive: true });
    // Raw-evidence refusal must precede listing prerequisites on every OS.
    // The existing temp authority must still reject this file collision.
    fs.writeFileSync(path.join(f.root, '.my-dev-kit-workflow/t'), 'unusable fixture temp');
    expect(() => publicTemporaryRoot(f.root)).toThrow('Unsafe');
    fs.writeFileSync(path.join(input, 'stdout.txt'), ''); fs.writeFileSync(path.join(input, 'stderr.txt'), '');
    const manifest = { contractId: CURRENT_CONTRACT, routeId: CURRENT_ROUTE, lane: 'protected', identity, historical: HISTORICAL_STATE,
      environment: { platform: process.platform, arch: process.arch, node: process.version }, command: [...CURRENT_PROTECTED_TESTS], invocation: { stdout: 'stdout.txt', stdoutSha256: sha(''), stderr: 'stderr.txt', stderrSha256: sha(''), exitCode: 0 }, native: { file: 'missing.json', sha256: '0'.repeat(64) } };
    fs.writeFileSync(path.join(input, 'manifest.json'), JSON.stringify(manifest));
    await expect(verifyCurrentLane(f.root, path.join(input, 'manifest.json'), path.join(f.root, '.my-dev-kit-workflow/check1'))).rejects.toThrow('ENOENT');
    fs.writeFileSync(path.join(input, 'missing.json'), '{}');
    await expect(verifyCurrentLane(f.root, path.join(input, 'manifest.json'), path.join(f.root, '.my-dev-kit-workflow/check2'))).rejects.toThrow('Tampered');
  });
  it('cannot manufacture a current PASS with empty lanes or historical PASS metadata', async () => {
    const f = repository(), output = path.join(f.root, '.my-dev-kit-workflow/binding');
    const result = await bindCurrent(f.root, { contractId: CURRENT_CONTRACT, manifests: [] }, output);
    expect(result.verdict).toBe('BLOCKED_REQUIRED_EVIDENCE'); expect(result.missing).toContain('lane:protected'); expect(result.missing).toContain('hosted-native-run:exact-candidate-CI');
    await expect(bindCurrent(f.root, { contractId: CURRENT_CONTRACT, manifests: [], historical: { provenance: 'PASS' } }, output)).rejects.toThrow('Wrong binding');
    await expect(bindCurrent(f.root, { contractId: CURRENT_CONTRACT, manifests: [] }, output)).rejects.toThrow('Existing');
    const directory = path.join(f.root, '.my-dev-kit-workflow/wrong'); fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ contractId: CURRENT_CONTRACT, routeId: CURRENT_ROUTE, historical: { ...HISTORICAL_STATE, provenance: 'PASS' } }));
    await expect(verifyCurrentLane(f.root, path.join(directory, 'manifest.json'), path.join(directory, 'verify'))).rejects.toThrow('historical substitution');
  });
  it('requires live exact-SHA hosted job/artifact corroboration; unit mocks are never native evidence', () => {
    const candidate = 'a'.repeat(40), run = { id: 1, head_sha: candidate, repository: { full_name: 'dailephd/my-dev-kit-lab' }, path: '.github/workflows/ci.yml', event: 'push', status: 'completed', conclusion: 'success' };
    const cells = [['Windows', 'windows-latest'], ['Linux', 'ubuntu-24.04'], ['macOS', 'macos-latest']];
    const jobs = { jobs: cells.map(([, runner]) => ({ name: runner + ' / Node 24', labels: [runner], status: 'completed', conclusion: 'success' })) };
    const artifacts = { artifacts: cells.map(([name], i) => ({ id: i + 1, name: 'current-kit-native-' + name, size_in_bytes: 100, expired: false, workflow_run: { id: 1, head_sha: candidate } })) };
    expect(verifyHostedMetadata(run, jobs, artifacts, candidate)).toHaveLength(3);
    expect(() => verifyHostedMetadata({ ...run, head_sha: 'old' }, jobs, artifacts, candidate)).toThrow('exact-candidate');
    artifacts.artifacts.pop(); expect(() => verifyHostedMetadata(run, jobs, artifacts, candidate)).toThrow('artifact');
    jobs.jobs[0].conclusion = 'failure'; expect(() => verifyHostedMetadata(run, jobs, artifacts, candidate)).toThrow('native job');
  });
});
