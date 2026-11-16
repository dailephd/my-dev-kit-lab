// Private source-checkout composition for the separately authorized LAB-KIT-01
// current route. Historical verification remains in verify-private-provenance.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { sourceIdentity, publicTemporaryRoot, verificationOutputDirectory, ownedDirectory, PRIVATE_TEST_FILES } from './run-verification-lane.mjs';

export const CURRENT_CONTRACT = 'LAB-KIT-01-CURRENT-CANDIDATE-ACCEPTANCE/1.0.0';
export const CURRENT_ROUTE = 'V010-KIT-CURRENT-ACCEPTANCE-ROUTE-01/1.0.0';
export const HISTORICAL_STATE = Object.freeze({ provenance: 'UNVERIFIED', privateVerification: 'NOT_PASSED', readinessBinding: 'NOT_PASSED' });
export const PLATFORM_TESTS = Object.freeze([
  'tests/security/securityOutputPathIdentity.test.ts',
  'tests/security/cliAdversarialPathBoundary.test.ts',
  'tests/experiments/incrementalChangeStaleness/incrementalChangeStalenessPlugin.test.ts',
  'tests/experiments/incrementalChangeStaleness/incrementalChangeStalenessPluginV2.test.ts',
  'tests/core/runMeasuredCommandBounded.spec.ts', 'tests/runtime/packageResource.spec.ts',
  'tests/core/resolveCommand.spec.ts',
]);
export const CURRENT_PROTECTED_TESTS = Object.freeze([
  'tests/audits/kitGate5AcceptedBaseline.test.ts', 'tests/audits/kitSourcePartialImports.test.ts',
  'tests/audits/kitSourceEvidence.test.ts', 'tests/audits/kitSourceProvider.test.ts',
  'tests/audits/auditRunnerKitBridge.test.ts', 'tests/audits/auditCommandCodeRotSmoke.test.ts',
  'tests/audits/verificationLanes.test.ts', 'tests/audits/currentKitAcceptance.test.ts', ...PLATFORM_TESTS,
]);
const ORACLE = 'tests/fixtures/audits/kitGate4AcceptedBaseline.v010.json';
const POLICY = 'tests/fixtures/audits/currentKitAcceptance.v010.json';
const ORACLE_SHA = 'a30cad80f5de3975cc17d6b804d7aeedccdb3a3d7f412b5950c098a3176f3457';
const KIT_CLI_SHA = 'ac66e5a4a06b48f7a7bbbf03734002bd6686cc6aa2343d097ff374f52fcb486f';
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = b => createHash('sha256').update(b).digest('hex');
const stable = v => JSON.stringify(v, (_k, x) => x && !Array.isArray(x) && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
const assert = (ok, reason) => { if (!ok) throw new Error(reason); };
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
async function owners(root) {
  const base = pathToFileURL(path.join(root, 'dist/')).href;
  const [identity, process] = await Promise.all([
    import(new URL('src/evaluation/executableEvidence/identity.js', base)),
    import(new URL('src/core/runMeasuredCommand.js', base)),
  ]);
  return { read: identity.readEvidenceBytes, run: process.runMeasuredCommand };
}
async function read(root, file, limit = 64 * 1024 * 1024) { return (await owners(SOURCE_ROOT)).read(root, file, limit); }
async function nativeBytes(root, directory, file, digest) {
  const bytes = await (await owners(SOURCE_ROOT)).read(directory, file, 128 * 1024 * 1024);
  assert(hash(bytes) === digest, 'Tampered/missing native bytes: ' + file); return bytes;
}
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
function tree(root) {
  const rows = [];
  const visit = (dir, rel = '') => { for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name), child = rel ? rel + '/' + name : name, stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink(), 'Linked immutable tree');
    if (stat.isDirectory()) visit(file, child); else { assert(stat.isFile(), 'Unsafe immutable tree'); rows.push([child, hash(fs.readFileSync(file))]); }
  } };
  visit(root); return hash(stable(rows));
}
// Cross-platform equality permits CRLF/LF only for round-trip UTF-8 text without
// NUL. The existing raw identity remains mandatory for local before/after checks.
function portableIdentity(root) {
  const files = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean).sort();
  return hash(stable(files.map(file => { const bytes = fs.readFileSync(path.join(root, file)), text = bytes.toString('utf8');
    return [file.replaceAll('\\', '/'), hash(!text.includes('\0') && Buffer.from(text).equals(bytes) ? text.replace(/\r\n/g, '\n') : bytes)]; })));
}
export async function currentIdentity(root) {
  const source = sourceIdentity(root); // Also refuses unsafe source paths/links.
  const oracleBytes = await read(root, ORACLE), oracle = JSON.parse(oracleBytes);
  assert(hash(oracleBytes) === ORACLE_SHA, 'Modified accepted oracle');
  assert(oracle.decisions.length === 150 && Object.keys(oracle.fixtureFileHashes).length === 121, 'Incomplete accepted domain');
  for (const [file, digest] of Object.entries(oracle.fixtureFileHashes)) assert(hash(await read(root, file)) === digest, 'Modified fixture: ' + file);
  const policy = JSON.parse(await read(root, POLICY));
  assert(policy.contractId === CURRENT_CONTRACT && policy.routeId === CURRENT_ROUTE &&
    policy.authorization.proposalSha256 === 'f4595f2b0f9ac0a56d96a8c22b6f78f2cec24b8d6c4f6030e11dd8b3a166a36e' &&
    policy.authorization.decisionId === 'SW-121-USER-AUTHORIZATION' && policy.authorization.scope === 'ALL_A_L_WITH_REAL_THREE_PLATFORM_EVIDENCE', 'Unapproved current contract');
  assert(stable(policy.historical) === stable(HISTORICAL_STATE), 'Historical PASS substitution');
  const kit = JSON.parse(await read(root, 'node_modules/@dailephd/my-dev-kit/package.json'));
  const kitCli = await read(root, 'node_modules/@dailephd/my-dev-kit/dist/cli.js');
  assert(kit.name === '@dailephd/my-dev-kit' && kit.version === '1.15.0' && hash(kitCli) === KIT_CLI_SHA, 'Invalid Kit runtime');
  const pkg = JSON.parse(await read(root, 'package.json')), lock = JSON.parse(await read(root, 'package-lock.json'));
  assert(pkg.dependencies['@dailephd/my-dev-kit'] === '1.15.0' && lock.packages['node_modules/@dailephd/my-dev-kit'].version === '1.15.0', 'Invalid Kit lock identity');
  return { candidateSha: git(root, ['rev-parse', 'HEAD']), sourceIdentity: source, portableSourceIdentity: portableIdentity(root),
    lockSha256: hash(await read(root, 'package-lock.json')), packageMetadataSha256: hash(await read(root, 'package.json')),
    oracleSha256: ORACLE_SHA, policySha256: hash(await read(root, POLICY)), kitCliSha256: KIT_CLI_SHA,
    kitPackageIdentity: tree(path.join(root, 'node_modules/@dailephd/my-dev-kit')),
    nodeSha256: hash(fs.readFileSync(process.execPath)), nodeVersion: process.version,
    vitestSha256: hash(await read(root, 'node_modules/vitest/dist/cli.js')),
    buildIdentity: tree(path.join(root, 'dist')), collectorSha256: hash(await read(root, 'scripts/verifyCurrentKitAcceptance.mjs')),
    verifierSha256: hash(await read(root, 'scripts/verify-private-provenance.mjs')) };
}
function publicArgs() { return PRIVATE_TEST_FILES.flatMap(file => ['--exclude', file]); }
export function currentCommand(lane) {
  if (lane === 'public') return publicArgs();
  if (lane === 'protected') return [...CURRENT_PROTECTED_TESTS];
  if (lane === 'platform') return [...PLATFORM_TESTS];
  throw new Error('Unknown finite current lane');
}
function skipAllowed(file, name, platform, lane) {
  if (platform !== 'darwin' && file.endsWith('/securityOutputPathIdentity.test.ts') && name.includes('actual /var and /private/var')) return true;
  if (platform !== 'win32' && file.endsWith('/core/runMeasuredCommandBounded.spec.ts') && name.includes('RSP-047')) return true;
  if (platform !== 'win32' && file.endsWith('/commands/runSecurityValidationCommand.spec.ts') && name.includes('physical Windows path casing')) return true;
  if (platform !== 'win32' && file.endsWith('/security/cliAdversarialPathBoundary.test.ts') && name.includes('(win32)')) return true;
  if (platform !== 'win32' && file.endsWith('/evaluation/benchmarkSandbox/sandboxGitContainment.spec.ts') && name.startsWith('benchmark sandbox Git containment at the observed Windows path-length boundary > ')) return true;
  if (platform === 'win32' && file.endsWith('/core/resolveCommand.spec.ts') && name.includes('non-Windows absolute path that exists but is not executable')) return true;
  if (platform !== 'win32' && file.endsWith('/runtime/packageResource.spec.ts') && name.includes('rejects a Windows-style backslash traversal escape')) return true;
  if (lane === 'public' && /contextWindowScalingLocalSubjectRealKit|contextWindowScaling\/localSubjectRealKit|retrievalPrecisionRecallLocalSubjectRealKit|agentSuccessRate\/realKitContext|incrementalChangeStalenessRealUpstreamSmoke/.test(file)) return true;
  return false;
}
const relFile = (root, file) => (/^[A-Za-z]:/.test(root) ? path.win32 : path.posix).relative(root, file).replaceAll('\\', '/');
export function verifyResponsibilityInventory(original, independent, root) {
  const keys = rows => rows.map(t => relFile(root, t.file) + '::' + t.name).sort();
  assert(stable(keys(original)) === stable(keys(independent)), 'Stale/filtered responsibility inventory');
}
export function verifyNativeTests(native, listing, root, platform, lane) {
  assert(Array.isArray(listing) && listing.length > 0 && Array.isArray(native.testResults), 'Missing native result/list');
  const expected = listing.map(t => relFile(root, t.file) + '::' + t.name).sort();
  // Vitest deliberately truncates parameter displays, so legitimate cases may
  // have equal titles. Compare the complete multiset, not a lossy set. Scientific
  // decision IDs are separately reopened and required to be unique (150/150).
  const actual = [], skipped = [], files = new Set();
  for (const file of native.testResults) {
    const relative = relFile(root, file.name); assert(!relative.startsWith('../') && relative.startsWith('tests/'), 'Native target escape');
    assert(!files.has(relative), 'Conflicting duplicate native file'); files.add(relative);
    for (const test of file.assertionResults) {
      const name = [...test.ancestorTitles, test.title].join(' > ');
      if (test.status === 'pending' || test.status === 'skipped') { assert(skipAllowed(relative, name, platform, lane), 'Required responsibility unavailable: ' + name); skipped.push(name); }
      else { assert(test.status === 'passed' && (!test.failureMessages || test.failureMessages.length === 0), 'Native assertion failed: ' + name); actual.push(relative + '::' + name); }
    }
  }
  assert(stable(actual.sort()) === stable(expected), 'Filtered/incomplete native responsibilities');
  assert(native.numTotalTests === actual.length + skipped.length && native.numPassedTests === actual.length && native.numPendingTests === skipped.length &&
    native.numTodoTests === 0 && native.numFailedTests === 0 && native.success === true, 'Forged native summary');
  return { total: actual.length + skipped.length, passed: actual.length, skipped: skipped.length, responsibilityDigest: hash(stable(expected)) };
}
export function verifyCurrentDecisions(result, oracle, policy) {
  const expected = oracle.decisions.map(d => ({ decisionId: d.decisionId, normalizedKitFindings: d.normalizedKitFindings }));
  assert(result.contractId === CURRENT_CONTRACT && result.provider === 'published-1.15.0' && result.decisions?.length === 150 &&
    stable(result.decisions) === stable(expected), 'Incomplete/changed findings or mandatory coverage');
  const roots = [...new Set(oracle.decisions.map(d => d.fixtureRoot))].sort();
  assert(Array.isArray(result.coverage) && result.coverage.length === roots.length && new Set(result.coverage.map(c => c.fixtureRoot)).size === roots.length, 'Incomplete mandatory coverage');
  for (const fixtureRoot of roots) {
    const cell = result.coverage.find(c => c.fixtureRoot === fixtureRoot), detectors = oracle.decisions.filter(d => d.fixtureRoot === fixtureRoot).map(d => d.detectorId).sort();
    assert(cell && stable(cell.detectors) === stable(detectors) && cell.detectorErrors?.length === 0 && cell.skippedDetectors?.length === 0 && cell.exitCode === 0, 'Unavailable mandatory import/detector coverage');
  }
  const differences = oracle.decisions.filter(d => d.acceptedDifferenceDisposition);
  assert(policy.reviews.length === 16 && new Set(policy.reviews.map(r => r.decisionId)).size === 16, 'Incomplete disposition review');
  for (const d of differences) {
    const review = policy.reviews.find(r => r.decisionId === d.decisionId), incomparable = d.acceptedDifferenceDisposition.profileQualification?.classification === 'INCOMPARABLE_PROFILES';
    assert(review && review.findingsSha256 === hash(stable(d.normalizedKitFindings)) && review.sourceWitnesses.length > 0 &&
      review.currentDisposition === (incomparable ? 'INCOMPARABLE_PROFILES_RETAINED' : 'QUALIFIED_CURRENT_BOUNDED_SCOPE') &&
      review.reason.length > 40 && review.historicalProvenance === 'UNVERIFIED', 'Unresolved disposition: ' + d.decisionId);
    assert(!incomparable || review.parityClaim === false, 'Incomparable profile promoted to parity');
  }
  return { decisions: 150, dispositions: 16, incomparableProfiles: 3 };
}
function authorityDirectory(root, output) {
  const common = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']));
  assert(path.basename(common) === '.git', 'Unknown Git authority');
  verificationOutputDirectory(path.dirname(common), path.join(output, 'marker.json'));
}
async function invoke(root, output, id, args, env, timeoutMs = 7_200_000, executable = process.execPath) {
  const result = await (await owners(root)).run({ commandId: id, executable, args, cwd: root, resolveCommand: executable !== process.execPath,
    outDir: output, env, timeoutMs, stdoutMaxBytes: 64 * 1024 * 1024, stderrMaxBytes: 8 * 1024 * 1024,
    terminateProcessTree: true });
  const summary = { exitCode: result.exitCode, timedOut: result.timedOut ?? false, outputLimit: result.outputLimit ?? null,
    stdout: path.basename(result.stdoutPath), stderr: path.basename(result.stderrPath),
    stdoutSha256: hash(fs.readFileSync(result.stdoutPath)), stderrSha256: hash(fs.readFileSync(result.stderrPath)) };
  write(path.join(output, id + '-invocation.json'), { args, ...summary });
  assert(result.exitCode === 0 && !result.timedOut && !result.outputLimit && result.ok, 'Native process failed: ' + id);
  return summary;
}
async function deriveListing(root, output, lane, env, id) {
  const filename = id + '-listing.json';
  await invoke(root, output, id + '-list', ['node_modules/vitest/vitest.mjs', 'list', ...currentCommand(lane), '--json=' + path.join(output, filename)], env, 300_000);
  return { file: filename, value: JSON.parse(await read(output, filename)) };
}
export async function collectCurrent(root, output, lane) {
  assert(['public', 'protected', 'platform', 'packed'].includes(lane), 'Unknown current lane');
  assert(!fs.existsSync(output), 'Existing/conflicting run destination'); authorityDirectory(root, output);
  const env = { ...process.env, TEMP: publicTemporaryRoot(root), TMP: publicTemporaryRoot(root), TMPDIR: publicTemporaryRoot(root),
    TSX_DISABLE_CACHE: '1', PYTHONDONTWRITEBYTECODE: '1', LAB_VERIFICATION_LANE: 'public', MY_DEV_KIT_LAB_KEEP_PACKED_FIXTURE: '1',
    npm_config_cache: ownedDirectory(root, path.join(root, '.my-dev-kit-workflow/npm-cache')),
    npm_config_logs_dir: ownedDirectory(root, path.join(root, '.my-dev-kit-workflow/npm-logs')),
    PLAYWRIGHT_BROWSERS_PATH: ownedDirectory(root, path.join(root, '.my-dev-kit-workflow/browser-cache')) };
  delete env.LAB_KIT_GATE5_COMPARISON_FILE; delete env.LAB_CURRENT_ORACLE_OUTPUT; delete env.LAB_PUBLIC_VERIFICATION_RESULT;
  if (lane === 'packed') {
    const common = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']));
    const compact = ownedDirectory(path.dirname(common), path.join(path.dirname(common), '.my-dev-kit-workflow/tmp/current-kit-packed-temp'));
    env.TEMP = compact; env.TMP = compact; env.TMPDIR = compact;
  }
  const build = [];
  if (lane === 'packed') {
    const source = sourceIdentity(root);
    build.push({ args: ['scripts/clean-dist.mjs'], invocation: await invoke(root, output, 'clean-build', ['scripts/clean-dist.mjs'], env) });
    build.push({ args: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], invocation: await invoke(root, output, 'compile-build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], env) });
    assert(sourceIdentity(root) === source, 'Source changed during native build');
  }
  const before = await currentIdentity(root), runId = 'lab-kit-current-' + randomUUID(), startedAt = new Date().toISOString();
  try {
    const manifest = { contractId: CURRENT_CONTRACT, routeId: CURRENT_ROUTE, runId, startedAt, lane, identity: before,
      executionRoot: root, build, environment: { platform: process.platform, arch: process.arch, node: process.version }, historical: HISTORICAL_STATE };
    if (lane !== 'packed') {
      const listing = await deriveListing(root, output, lane, env, 'preflight');
      const resultFile = 'native-tests.json';
      if (lane === 'protected') env.LAB_CURRENT_ORACLE_OUTPUT = path.join(output, 'current-decisions.json');
      manifest.command = currentCommand(lane);
      const npmArgs = lane === 'public' ? ['run', 'test:public', '--'] : ['test', '--', ...manifest.command];
      manifest.invocation = await invoke(root, output, 'tests', [...npmArgs,
        '--reporter=json', '--outputFile=' + path.join(output, resultFile)], env, 7_200_000, 'npm');
      manifest.native = { file: resultFile, sha256: hash(await read(output, resultFile)) };
      manifest.listing = { file: listing.file, sha256: hash(await read(output, listing.file)) };
      manifest.observation = verifyNativeTests(JSON.parse(await read(output, resultFile)), listing.value, root, process.platform, lane);
      if (lane === 'protected') manifest.decisions = { file: 'current-decisions.json', sha256: hash(await read(output, 'current-decisions.json')) };
    } else {
      manifest.invocation = await invoke(root, output, 'packed', ['scripts/verify-packed-package.mjs'], env);
      const stdout = (await read(output, manifest.invocation.stdout)).toString('utf8');
      const retained = stdout.match(/^PACKED_PACKAGE_RETAINED_FIXTURE: (.+)$/m)?.[1]?.trim();
      assert(retained && stdout.includes('PACKED_PACKAGE_VERDICT: PASS'), 'Missing native packed acceptance');
      const packFiles = fs.readdirSync(path.join(retained, 'pack')).filter(p => p.endsWith('.tgz'));
      assert(packFiles.length === 1, 'Conflicting package artifacts');
      const archive = path.join(retained, 'pack', packFiles[0]);
      authorityDirectory(root, retained);
      const installed = path.join(retained, 'consumer/node_modules/@dailephd/my-dev-kit-lab');
      manifest.package = { archive, sha256: hash(fs.readFileSync(archive)), installed, installedIdentity: tree(installed) };
      assert(stdout.includes('TARBALL_SHA256: ' + manifest.package.sha256), 'Changed package bytes');
    }
    assert(stable(await currentIdentity(root)) === stable(before), 'Candidate changed during collection');
    manifest.endedAt = new Date().toISOString(); manifest.authentication = 'UNSIGNED_LOCAL_OBSERVATION';
    write(path.join(output, 'manifest.json'), manifest);
    return manifest;
  } catch (error) { write(path.join(output, 'failure.json'), { contractId: CURRENT_CONTRACT, runId, lane, startedAt, error: error.message, historical: HISTORICAL_STATE }); throw error; }
}
export async function verifyCurrentLane(root, manifestFile, verifyOutput) {
  const directory = path.dirname(manifestFile), manifest = JSON.parse(await read(directory, path.basename(manifestFile)));
  const current = await currentIdentity(root);
  assert(manifest.contractId === CURRENT_CONTRACT && manifest.routeId === CURRENT_ROUTE && stable(manifest.historical) === stable(HISTORICAL_STATE), 'Cross-contract/historical substitution');
  assert(stable({ ...manifest.identity, candidateSha: current.candidateSha }) === stable(current), 'Changed candidate/source/build/runtime');
  if (manifest.identity.candidateSha !== current.candidateSha) {
    assert(/^[a-f0-9]{40}$/.test(manifest.identity.candidateSha), 'Changed candidate/source/build/runtime');
    try { git(root, ['merge-base', '--is-ancestor', manifest.identity.candidateSha, current.candidateSha]); }
    catch { throw new Error('Changed candidate/source/build/runtime'); }
  }
  assert(manifest.environment.platform === process.platform && manifest.environment.arch === process.arch && manifest.environment.node === process.version, 'Wrong local native environment; hosted cells require live corroboration');
  assert(['public', 'protected', 'platform', 'packed'].includes(manifest.lane), 'Invalid current lane');
  assert(!fs.existsSync(verifyOutput), 'Duplicate/conflicting verification receipt'); authorityDirectory(root, verifyOutput);
  const stdout = await nativeBytes(root, directory, manifest.invocation.stdout, manifest.invocation.stdoutSha256);
  await nativeBytes(root, directory, manifest.invocation.stderr, manifest.invocation.stderrSha256);
  assert(manifest.invocation.exitCode === 0 && !manifest.invocation.timedOut && !manifest.invocation.outputLimit, 'Forged native invocation');
  let observation;
  if (manifest.lane === 'packed') {
    assert(stable(manifest.build?.map(b => b.args)) === stable([['scripts/clean-dist.mjs'], ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']]), 'Missing native build provenance');
    for (const b of manifest.build) {
      assert(b.invocation.exitCode === 0 && !b.invocation.timedOut && !b.invocation.outputLimit, 'Failed native build');
      await nativeBytes(root, directory, b.invocation.stdout, b.invocation.stdoutSha256);
      await nativeBytes(root, directory, b.invocation.stderr, b.invocation.stderrSha256);
    }
    assert(stdout.toString().includes('PACKED_PACKAGE_VERDICT: PASS') && stdout.toString().includes('SOURCE_CHECKOUT_RUNTIME_DEPENDENCY: NONE_OBSERVED'), 'Forged package PASS');
    assert(fs.existsSync(manifest.package.installed) && fs.existsSync(manifest.package.archive), 'Missing installed package');
    authorityDirectory(root, manifest.package.installed);
    assert(hash(fs.readFileSync(manifest.package.archive)) === manifest.package.sha256 && tree(manifest.package.installed) === manifest.package.installedIdentity &&
      stdout.toString().includes('TARBALL_SHA256: ' + manifest.package.sha256), 'Changed package bytes/install');
    observation = { packageSha256: manifest.package.sha256, installedIdentity: manifest.package.installedIdentity };
  } else {
    assert(stable(manifest.command) === stable(currentCommand(manifest.lane)), 'Filtered-only current command');
    const env = { ...process.env, TEMP: publicTemporaryRoot(root), TMP: publicTemporaryRoot(root), TMPDIR: publicTemporaryRoot(root), TSX_DISABLE_CACHE: '1', LAB_VERIFICATION_LANE: 'public' };
    const native = JSON.parse(await nativeBytes(root, directory, manifest.native.file, manifest.native.sha256));
    assert(Number.isFinite(native.startTime) && native.startTime >= Date.parse(manifest.startedAt) && native.startTime <= Date.parse(manifest.endedAt), 'Stale native execution time');
    const original = JSON.parse(await nativeBytes(root, directory, manifest.listing.file, manifest.listing.sha256));
    const independent = await deriveListing(root, verifyOutput, manifest.lane, env, 'independent');
    verifyResponsibilityInventory(original, independent.value, root);
    observation = verifyNativeTests(native, independent.value, root, manifest.environment.platform, manifest.lane);
    if (manifest.lane === 'protected') {
      const decisions = JSON.parse(await nativeBytes(root, directory, manifest.decisions.file, manifest.decisions.sha256));
      const policy = JSON.parse(await read(root, POLICY)), oracle = JSON.parse(await read(root, ORACLE));
      observation = { ...observation, ...verifyCurrentDecisions(decisions, oracle, policy) };
      for (const review of policy.reviews) for (const witness of review.sourceWitnesses) assert(hash(await read(root, witness.path)) === witness.sha256 && oracle.fixtureFileHashes[witness.path] === witness.sha256, 'Changed review witness');
    }
  }
  assert(stable(await currentIdentity(root)) === stable(current), 'Verifier target changed');
  const receipt = { contractId: CURRENT_CONTRACT, routeId: CURRENT_ROUTE, runId: manifest.runId, lane: manifest.lane,
    executionCandidateSha: manifest.identity.candidateSha, sourceEquivalentRebind: manifest.identity.candidateSha !== current.candidateSha,
    identity: current, environment: manifest.environment, manifestSha256: hash(await read(directory, path.basename(manifestFile))),
    manifestFile, observation, verification: 'CURRENT_LANE_VERIFIED', historical: HISTORICAL_STATE,
    verifiedAt: new Date().toISOString(), authentication: 'UNSIGNED_LOCAL_OBSERVATION_NOT_AUTHORSHIP_ATTESTATION' };
  write(path.join(verifyOutput, 'receipt.json'), receipt); return receipt;
}
export async function bindCurrent(root, inputs, output) {
  assert(inputs.contractId === CURRENT_CONTRACT && Array.isArray(inputs.manifests) && inputs.manifests.length <= 16 &&
    Object.keys(inputs).every(k => ['contractId', 'manifests', 'hostedRunId'].includes(k)), 'Wrong binding contract');
  assert(new Set(inputs.manifests).size === inputs.manifests.length, 'Duplicate/conflicting receipts');
  assert(!fs.existsSync(output), 'Existing current binding'); authorityDirectory(root, output);
  const cells = [];
  // A fresh independent verification process is used by the CLI for each lane;
  // binding reopens every native input again rather than trusting receipt PASS.
  for (const [i, file] of inputs.manifests.entries()) cells.push(await verifyCurrentLane(root, file, path.join(output, 'cell-' + i)));
  if (inputs.hostedRunId !== undefined) cells.push(...await qualifyHostedCurrent(root, inputs.hostedRunId, path.join(output, 'hosted')));
  const lanes = new Set(cells.map(c => c.lane)), platforms = new Set(cells.filter(c => c.lane === 'platform' || c.lane === 'protected').map(c => c.environment.platform));
  const missing = ['public', 'protected', 'packed'].filter(lane => !lanes.has(lane)).map(lane => 'lane:' + lane);
  if (inputs.hostedRunId === undefined) missing.push('hosted-native-run:exact-candidate-CI');
  for (const platform of ['win32', 'linux', 'darwin']) if (!platforms.has(platform)) missing.push('platform:' + platform);
  const receipt = { contractId: CURRENT_CONTRACT, routeId: CURRENT_ROUTE, identity: await currentIdentity(root), historical: HISTORICAL_STATE,
    verdict: missing.length ? 'BLOCKED_REQUIRED_EVIDENCE' : 'PASS_CURRENT_CANDIDATE_ACCEPTANCE', missing,
    cells: cells.map(c => ({ runId: c.runId, lane: c.lane, environment: c.environment, manifestSha256: c.manifestSha256, observation: c.observation, hosted: c.hosted ?? null })),
    verifiedAt: new Date().toISOString(), authentication: 'UNSIGNED_LOCAL_OBSERVATION_NOT_AUTHORSHIP_ATTESTATION', releaseReadiness: 'NOT_ESTABLISHED' };
  assert(new Set(cells.map(c => c.runId)).size === cells.length, 'Conflicting run identities');
  write(path.join(output, 'binding.json'), receipt); return receipt;
}
export function verifyHostedMetadata(run, jobs, artifacts, candidateSha) {
  assert(run.head_sha === candidateSha && run.repository?.full_name === 'dailephd/my-dev-kit-lab' &&
    run.path === '.github/workflows/ci.yml' && ['push', 'workflow_dispatch'].includes(run.event) &&
    run.status === 'completed' && run.conclusion === 'success', 'Missing/stale/failed exact-candidate hosted CI');
  const cells = [['Windows', 'win32', 'windows-latest'], ['Linux', 'linux', 'ubuntu-24.04'], ['macOS', 'darwin', 'macos-latest']];
  return cells.map(([name, platform, runner]) => {
    const job = jobs.jobs?.find(j => j.name === runner + ' / Node 24');
    assert(job?.status === 'completed' && job.conclusion === 'success' && job.labels?.includes(runner), 'Missing actual native job: ' + name);
    const matches = artifacts.artifacts?.filter(a => a.name === 'current-kit-native-' + name);
    assert(matches?.length === 1 && !matches[0].expired && matches[0].size_in_bytes > 0 && matches[0].size_in_bytes <= 64 * 1024 * 1024 &&
      matches[0].workflow_run?.id === run.id && matches[0].workflow_run?.head_sha === candidateSha, 'Missing/conflicting hosted native artifact: ' + name);
    return { name, platform, runner, artifactId: matches[0].id, runId: run.id, jobId: job.id };
  });
}
async function qualifyHostedCurrent(root, runId, output) {
  assert(/^[1-9][0-9]*$/.test(String(runId)), 'Invalid hosted run identity');
  assert(git(root, ['status', '--porcelain', '--untracked-files=all']) === '', 'Hosted binding requires a committed clean candidate');
  authorityDirectory(root, output);
  const identity = await currentIdentity(root), env = { ...process.env, GH_PAGER: 'cat', PAGER: 'cat', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GIT_TERMINAL_PROMPT: '0' };
  delete env.GH_DEBUG;
  const query = async (id, args) => {
    const r = await (await owners(root)).run({ commandId: id, executable: 'gh', args, resolveCommand: true, cwd: root,
      outDir: output, env, timeoutMs: 180_000, stdoutMaxBytes: 8 * 1024 * 1024, stderrMaxBytes: 262144, terminateProcessTree: true });
    assert(r.ok && r.exitCode === 0 && !r.outputLimit && !r.timedOut, 'Hosted evidence unavailable: ' + id);
    return r;
  };
  const endpoint = 'repos/dailephd/my-dev-kit-lab/actions/runs/' + runId;
  const run = JSON.parse((await query('github-run', ['api', endpoint])).stdout);
  const jobs = JSON.parse((await query('github-jobs', ['api', endpoint + '/jobs?per_page=100'])).stdout);
  const artifacts = JSON.parse((await query('github-artifacts', ['api', endpoint + '/artifacts?per_page=100'])).stdout);
  assert(jobs.total_count <= 100 && artifacts.total_count <= 100, 'Incomplete hosted pagination');
  const cells = verifyHostedMetadata(run, jobs, artifacts, identity.candidateSha), verified = [];
  for (const cell of cells) {
    const destination = path.join(output, cell.platform); assert(!fs.existsSync(destination), 'Conflicting hosted download');
    await query('download-' + cell.platform, ['run', 'download', String(runId), '--repo', 'dailephd/my-dev-kit-lab', '--name', 'current-kit-native-' + cell.name, '--dir', destination]);
    const directory = path.join(destination, 'collection'), manifestFile = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(await read(directory, 'manifest.json'));
    assert(manifest.contractId === CURRENT_CONTRACT && manifest.routeId === CURRENT_ROUTE && manifest.lane === 'platform' &&
      manifest.environment.platform === cell.platform && /^v24\./.test(manifest.environment.node) &&
      manifest.identity.candidateSha === identity.candidateSha && manifest.identity.portableSourceIdentity === identity.portableSourceIdentity &&
      manifest.identity.kitCliSha256 === KIT_CLI_SHA && manifest.identity.oracleSha256 === ORACLE_SHA &&
      stable(manifest.historical) === stable(HISTORICAL_STATE) && stable(manifest.command) === stable(PLATFORM_TESTS), 'Foreign/stale native platform evidence');
    await nativeBytes(root, directory, manifest.invocation.stdout, manifest.invocation.stdoutSha256);
    await nativeBytes(root, directory, manifest.invocation.stderr, manifest.invocation.stderrSha256);
    assert(manifest.invocation.exitCode === 0 && !manifest.invocation.timedOut && !manifest.invocation.outputLimit, 'Failed hosted native execution');
    const native = JSON.parse(await nativeBytes(root, directory, manifest.native.file, manifest.native.sha256));
    const listing = JSON.parse(await nativeBytes(root, directory, manifest.listing.file, manifest.listing.sha256));
    const files = [...new Set(listing.map(t => relFile(manifest.executionRoot, t.file)))].sort();
    assert(stable(files) === stable([...PLATFORM_TESTS].sort()), 'Incomplete hosted native selection');
    const observation = verifyNativeTests(native, listing, manifest.executionRoot, cell.platform, 'platform');
    // Live GitHub run/job/artifact identity is required in addition to unsigned
    // local records; caller-authored OS/PASS fields alone never qualify a cell.
    verified.push({ contractId: CURRENT_CONTRACT, runId: manifest.runId, lane: 'platform', environment: manifest.environment,
      manifestSha256: hash(await read(directory, 'manifest.json')), observation, hosted: cell });
    assert(hash(await read(directory, 'manifest.json')) === hash(fs.readFileSync(manifestFile)), 'Downloaded native evidence changed');
  }
  return verified;
}
export async function currentMain(args, root = process.cwd()) {
  const remote = git(root, ['remote', 'get-url', 'origin']).replace(/\.git$/, '');
  assert(['https://github.com/dailephd/my-dev-kit-lab', 'git@github.com:dailephd/my-dev-kit-lab'].includes(remote), 'Wrong current repository authority');
  try { git(root, ['merge-base', '--is-ancestor', '241cdc69f9a0f61d3fc046548fc4c76fa1aff6c4', 'HEAD']); }
  catch { throw new Error('Current candidate is not based on the authorized baseline'); }
  const [operation, ...rest] = args;
  const allowed = operation === 'collect' ? ['--lane', '--out'] : operation === 'verify' || operation === 'bind' ? ['--inputs', '--out'] : [];
  assert(allowed.length && rest.length === allowed.length * 2, 'Usage: --current collect --lane public|protected|platform|packed --out <new-run>; verify|bind --inputs <manifest-or-plan> --out <new-run>');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) { assert(allowed.includes(rest[i]) && !Object.hasOwn(options, rest[i]) && rest[i + 1], 'Unknown/duplicate current option'); options[rest[i]] = rest[i + 1]; }
  const output = path.resolve(options['--out']);
  const result = operation === 'collect' ? await collectCurrent(root, output, options['--lane']) : operation === 'verify'
    ? await verifyCurrentLane(root, path.resolve(options['--inputs']), output)
    : await bindCurrent(root, JSON.parse(fs.readFileSync(options['--inputs'])), output);
  console.log(JSON.stringify(result));
  return result.verdict === 'BLOCKED_REQUIRED_EVIDENCE' ? 2 : 0;
}
