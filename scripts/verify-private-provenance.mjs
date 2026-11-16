import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PRIVATE_TEST_FILES, sourceIdentity, verificationOutputDirectory } from './run-verification-lane.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

// Inactive SW-120 prototype. No CLI, historical gate or readiness consumer calls
// this function. It checks bytes/cross-bindings, not the truth of a runner's
// outcome claims. `expected` must come from an independent trusted observation,
// never from the submitted bundle. Governance and native assessment remain open.
export const PROSPECTIVE_DRAFT_CONTRACT = 'LAB-KIT-01-CURRENT-CANDIDATE-DRAFT/1.0.0';
export const PROSPECTIVE_DRAFT_ROLES = Object.freeze([
  'source-package', 'kit-runtime', 'decisions', 'detector-coverage',
  'complete-partial', 'invalid-stale-tamper', 'filesystem-windows',
  'filesystem-linux', 'filesystem-macos', 'public-tests',
  'current-protected-tests', 'packed-package', 'immutability',
  'provenance', 'historical-loss',
]);
function readDraftFile(root, relative, maximum = 32 * 1024 * 1024) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Unsafe draft input');
  const absolute = path.resolve(root, relative), rel = path.relative(root, absolute);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('Draft path escape');
  let current = path.parse(absolute).root;
  for (const part of path.relative(current, absolute).split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked draft input');
  }
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > maximum) throw new Error('Invalid draft input size/type');
  const bytes = fs.readFileSync(absolute);
  if (bytes.length !== stat.size) throw new Error('Draft input changed during read');
  return bytes;
}
export function inspectProspectiveDraftBundle(root, bundle, expected) {
  if (!bundle || Object.keys(bundle).sort().join(',') !== 'artifacts,candidateSha,contractId,createdAt,kit,packageSha256,runId,sourceIdentity' ||
      bundle.contractId !== PROSPECTIVE_DRAFT_CONTRACT) throw new Error('Wrong draft contract or fields');
  if (!/^lab-kit-current-[A-Za-z0-9-]+$/.test(bundle.runId ?? '') || bundle.runId !== expected.runId ||
      !Number.isFinite(Date.parse(bundle.createdAt)) || bundle.createdAt !== expected.createdAt) throw new Error('Stale draft run identity');
  for (const [key, length] of [['candidateSha', 40], ['sourceIdentity', 64], ['packageSha256', 64]]) {
    if (!new RegExp('^[a-f0-9]{' + length + '}$').test(bundle[key] ?? '') || bundle[key] !== expected[key]) throw new Error('Draft identity mismatch: ' + key);
  }
  if (canonical(bundle.kit) !== canonical(expected.kit) || bundle.kit?.packageName !== '@dailephd/my-dev-kit' ||
      bundle.kit?.packageVersion !== '1.15.0') throw new Error('Invalid draft Kit identity');
  if (hash(readDraftFile(root, expected.packagePath, 128 * 1024 * 1024)) !== expected.packageSha256 ||
      hash(readDraftFile(root, expected.kitCliPath)) !== bundle.kit.cliSha256) throw new Error('Draft package/runtime bytes changed');
  const oracleBytes = readDraftFile(root, 'tests/fixtures/audits/kitGate4AcceptedBaseline.v010.json');
  if (hash(oracleBytes) !== expected.oracleSha256) throw new Error('Modified draft oracle');
  const oracle = JSON.parse(oracleBytes);
  if (!oracle.fixtureFileHashes || !Object.keys(oracle.fixtureFileHashes).length || oracle.decisions?.length !== 150 ||
      new Set(oracle.decisions.map(d => d.decisionId)).size !== 150) throw new Error('Incomplete draft oracle');
  for (const [file, digest] of Object.entries(oracle.fixtureFileHashes)) {
    if (hash(readDraftFile(root, file)) !== digest) throw new Error('Modified draft fixture: ' + file);
  }
  if (!Array.isArray(bundle.artifacts) || bundle.artifacts.length !== PROSPECTIVE_DRAFT_ROLES.length ||
      new Set(bundle.artifacts.map(a => a.role)).size !== PROSPECTIVE_DRAFT_ROLES.length) throw new Error('Missing/duplicate draft evidence');
  for (const role of PROSPECTIVE_DRAFT_ROLES) {
    const artifact = bundle.artifacts.find(a => a.role === role), digest = expected.evidenceDigests?.[role];
    if (!artifact || !/^[a-f0-9]{64}$/.test(digest ?? '') || artifact.sha256 !== digest) throw new Error('Missing independent draft digest: ' + role);
    const bytes = readDraftFile(expected.evidenceRoot, artifact.path);
    if (hash(bytes) !== digest) throw new Error('Tampered draft evidence: ' + role);
    const record = JSON.parse(bytes);
    for (const key of ['contractId', 'runId', 'candidateSha', 'sourceIdentity', 'packageSha256']) {
      if (record[key] !== bundle[key]) throw new Error('Cross-contract/stale draft evidence: ' + role);
    }
    if (record.role !== role || record.status !== 'PASS' || record.coverage !== 'COMPLETE' || record.qualification !== 'QUALIFIED') throw new Error('Unavailable/unqualified draft evidence: ' + role);
    if (role === 'decisions' && canonical(record.decisions) !== canonical(oracle.decisions)) throw new Error('Draft scientific decisions differ');
    if (role === 'historical-loss' && canonical(record.historical) !== canonical({ provenance: 'UNVERIFIED', privateVerification: 'NOT_PASSED', readinessBinding: 'NOT_PASSED' })) throw new Error('Historical substitution refused');
  }
  return { contractId: PROSPECTIVE_DRAFT_CONTRACT, runId: bundle.runId,
    integrityStatus: 'DRAFT_BYTE_AND_BINDING_CHECKS_PASSED', semanticAssurance: 'NOT_VERIFIED',
    acceptance: 'PENDING_GOVERNANCE_AUTHORIZATION', routeActive: false,
    historical: { provenance: 'UNVERIFIED', privateVerification: 'NOT_PASSED', readinessBinding: 'NOT_PASSED' } };
}
export function verifyPrivateBytes(root, inputs) {
  const contract = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/audits/historicalEvidenceIdentity.v010.json')));
  const oracleBytes = fs.readFileSync(path.join(root, 'tests/fixtures/audits/kitGate4AcceptedBaseline.v010.json'));
  if (hash(oracleBytes) !== contract.oracleSha256) throw new Error('Public oracle identity mismatch');
  const oracle = JSON.parse(oracleBytes), observed = [], json = new Map();
  for (const artifact of contract.artifacts) {
    const filename = inputs.paths?.[artifact.id];
    if (!filename || !path.isAbsolute(filename)) throw new Error('Missing private artifact: ' + artifact.id);
    // Explicit, digest-pinned inputs may be retained in another protected local
    // repository. They are read only; all generated output stays project-owned.
    let current = path.parse(filename).root;
    for (const component of path.relative(current, filename).split(path.sep)) {
      current = path.join(current, component);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked private input');
    }
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe private artifact: ' + artifact.id);
    if (stat.size !== artifact.sizeBytes) throw new Error('Private byte identity mismatch: ' + artifact.id);
    const bytes = fs.readFileSync(filename), actual = hash(bytes);
    if (bytes.length !== artifact.sizeBytes || actual !== artifact.sha256) throw new Error('Private byte identity mismatch: ' + artifact.id);
    observed.push({ id: artifact.id, expectedSize: artifact.sizeBytes, observedSize: bytes.length, expectedSha256: artifact.sha256, observedSha256: actual, status: 'PASS' });
    if (artifact.kind === 'historical-json' || artifact.kind === 'qualification') json.set(actual, JSON.parse(bytes));
  }
  const qualification = json.get(contract.candidate05.qualificationSha256);
  if (qualification?.identity !== 'CANDIDATE05_EXACT_COMMIT_QUALIFICATION' || qualification.candidate.sourceCommit !== contract.candidate05.sourceCommit || qualification.candidate.packageVersion !== contract.candidate05.packageVersion || qualification.schemaVersion !== '1.1.0' || qualification.extractorRevision !== 'source-audit-v1.5.0') throw new Error('Historical producer identity mismatch');
  const reconciliation = json.get(oracle.provenance.gate4ReconciliationSha256), ledger = json.get(oracle.provenance.canonicalLedgerSha256);
  if (!reconciliation || !ledger || oracle.decisions.length !== 150 || ledger.decisions.length !== 150) throw new Error('Incomplete historical ledger');
  const ids = ledger.decisions.map(d => d.decisionId).sort();
  if (canonical(oracle.decisions.map(d => d.decisionId)) !== canonical(ids)) throw new Error('Historical decision domain mismatch');
  for (const decision of oracle.decisions) {
    const accepted = reconciliation.decisions.find(d => d.canonicalDecisionId === decision.decisionId);
    if (!accepted || canonical(accepted.kitFindings) !== canonical(decision.normalizedKitFindings)) throw new Error('Scientific decision mismatch: ' + decision.decisionId);
  }
  return { status: 'PASS', oracleSha256: hash(oracleBytes), decisions: 150, equivalent: 150, candidate05: contract.candidate05, artifacts: observed };
}
export function validateBinding(binding, { candidateSha, source, oracleSha256 }, requireFull = false) {
  if (binding.schemaVersion !== '1.0.0' || binding.candidateSha !== candidateSha || binding.sourceIdentity !== source || binding.oracleSha256 !== oracleSha256) throw new Error('Stale cross-lane binding');
  if (binding.publicLane?.candidateSha !== candidateSha || binding.publicLane.sourceIdentity !== source) throw new Error('Stale public execution identity');
  if (binding.publicLane?.status !== 'PASS' || binding.publicLane.exitCode !== 0 || binding.publicLane.sourceUnchanged !== true || binding.privateLane?.status !== 'PASS' || binding.privateTestsExitCode !== 0 || binding.decisions !== 150 || binding.equivalent !== 150) throw new Error('Unsatisfied verification lane');
  if (requireFull && binding.publicLane.scope !== 'full') throw new Error('Full public suite required for release readiness');
  return true;
}
function main() {
  const root = process.cwd(), args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
  const inputsFile = args.includes('--inputs') ? value('--inputs') : process.env.LAB_PRIVATE_VERIFICATION_INPUTS;
  const output = args.includes('--out') ? value('--out') : process.env.LAB_PRIVATE_VERIFICATION_OUTPUT;
  if (!inputsFile || !output) throw new Error('Mandatory private inputs and output are required');
  // Output belongs to the repository containing this linked checkout, or this checkout itself.
  const common = path.resolve(root, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()), authority = path.dirname(common);
  if (path.basename(common) !== '.git') throw new Error('Unrecognized Git ownership');
  verificationOutputDirectory(authority, output);
  const identity = { candidateSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(), source: sourceIdentity(root), oracleSha256: hash(fs.readFileSync(path.join(root, 'tests/fixtures/audits/kitGate4AcceptedBaseline.v010.json'))) };
  const inputs = JSON.parse(fs.readFileSync(inputsFile));
  const privateLane = verifyPrivateBytes(root, inputs);
  if (args.includes('--check-binding')) {
    const binding = JSON.parse(fs.readFileSync(output));
    validateBinding(binding, identity, !args.includes('--correction'));
    if (binding.verifierSha256 !== hash(fs.readFileSync(new URL(import.meta.url)))) throw new Error('Verifier identity changed');
    if (canonical(binding.privateLane) !== canonical(privateLane)) throw new Error('Binding byte observations differ');
    console.log('PUBLIC_LANE: PASS; PRIVATE_LANE: PASS (bytes reexamined); BINDING_VERIFICATION: PASS. Hosted CI, CodeQL and other readiness gates remain independently required.');
    return;
  }
  if (args.includes('--rebind')) {
    const previous = JSON.parse(fs.readFileSync(value('--rebind')));
    // The current bytes are independently examined again above. Test execution
    // may be reused only for the identical complete public source inventory.
    validateBinding(previous, { ...identity, candidateSha: previous.candidateSha });
    if (previous.verifierSha256 !== hash(fs.readFileSync(new URL(import.meta.url))) || canonical(previous.privateLane) !== canonical(privateLane)) throw new Error('Rebind evidence identity differs');
    const rebound = { ...previous, candidateSha: identity.candidateSha, privateLane, publicLane: { ...previous.publicLane, candidateSha: identity.candidateSha, executionCandidateSha: previous.publicLane.executionCandidateSha ?? previous.publicLane.candidateSha, equivalentSourceIdentity: identity.source }, reboundFromCandidate: previous.candidateSha, timestamp: new Date().toISOString() };
    validateBinding(rebound, identity);
    fs.writeFileSync(output, JSON.stringify(rebound, null, 2) + '\n', { flag: 'wx' });
    fs.writeFileSync(output + '.txt', `Commit-bound lane verification: PASS\nCandidate: ${identity.candidateSha}\nAll private bytes reexamined; identical public source inventory permits reuse of observed test execution.\nScope: ${rebound.readinessScope}\nUnsigned local observation; hosted/full readiness gates remain separate.\n`, { flag: 'wx' });
    return;
  }
  const publicResult = args.includes('--public-result') ? value('--public-result') : process.env.LAB_PUBLIC_VERIFICATION_RESULT;
  if (!publicResult) throw new Error('Observed public lane result required');
  const publicLane = JSON.parse(fs.readFileSync(publicResult));
  if (publicLane.status !== 'PASS' || publicLane.sourceIdentity !== identity.source || publicLane.candidateSha !== identity.candidateSha) throw new Error('Stale or failed public result');
  const command = [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...PRIVATE_TEST_FILES, 'tests/audits/kitGate5AcceptedBaseline.test.ts', '--maxWorkers', '2'];
  const historicalEnvironment = Object.fromEntries(Object.entries(inputs.historicalEnvironment ?? {}).filter(([key]) => /^(?:TEMP|TMP|TMPDIR|TSX_DISABLE_CACHE|npm_config_cache|npm_config_logs_dir|npm_config_logs_max|LAB_KIT_DIFFERENTIAL_TEST_ROOT|LAB_EVIDENCE_INSTALLED_CONSUMER|LAB_EVIDENCE_LAB_ARTIFACT|LAB_EVIDENCE_KIT_ARTIFACT)$/.test(key)));
  const before = sourceIdentity(root), result = spawnSync(process.execPath, command, { cwd: root, env: { ...process.env, ...historicalEnvironment, LAB_VERIFICATION_LANE: 'private' }, stdio: 'inherit', windowsHide: true });
  const binding = { schemaVersion: '1.0.0', candidateSha: identity.candidateSha, sourceIdentity: before, oracleSha256: privateLane.oracleSha256, decisions: privateLane.decisions, equivalent: privateLane.equivalent, publicLane, privateLane, privateTestsExitCode: result.status, command: [process.execPath, ...command], verifierSha256: hash(fs.readFileSync(new URL(import.meta.url))), timestamp: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch }, authentication: 'UNSIGNED_LOCAL_OBSERVATION', readinessScope: publicLane.scope === 'full' ? 'LANE_REQUIREMENTS_ONLY' : 'CORRECTION_FOCUSED_ONLY; full public suite still mandatory' };
  if (sourceIdentity(root) !== before) throw new Error('Source changed during verification');
  validateBinding(binding, identity);
  fs.writeFileSync(output, JSON.stringify(binding, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(output + '.txt', `PRIVATE_LANE: PASS\nArtifacts authenticated: ${privateLane.artifacts.length}\nScientific decisions: 150/150\nCandidate: ${identity.candidateSha}\nBinding: PASS (${binding.readinessScope})\nUnsigned local verification; no claim of hosted private execution.\n`, { flag: 'wx' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === '--current') {
    try { process.exitCode = await (await import('./verifyCurrentKitAcceptance.mjs')).currentMain(process.argv.slice(3)); }
    catch (error) { console.error('CURRENT_KIT_GATE_FAILED: ' + error.message); process.exitCode = 1; }
  } else {
  try { main(); } catch (error) {
    console.error('PRIVATE_OR_BINDING_GATE_FAILED: ' + error.message); process.exitCode = 1;
    const args = process.argv.slice(2), output = args.includes('--out') ? args[args.indexOf('--out') + 1] : process.env.LAB_PRIVATE_VERIFICATION_OUTPUT;
    if (output) try {
      const common = path.resolve(process.cwd(), execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8', windowsHide: true }).trim());
      if (path.basename(common) !== '.git') throw new Error('Unrecognized Git ownership');
      verificationOutputDirectory(path.dirname(common), output);
      const failure = { schemaVersion: '1.0.0', status: 'FAIL', bindingVerification: 'FAIL', error: error.message, timestamp: new Date().toISOString(), authentication: 'UNSIGNED_LOCAL_OBSERVATION' };
      fs.writeFileSync(output + '.failure.json', JSON.stringify(failure, null, 2) + '\n', { flag: 'wx' });
      fs.writeFileSync(output + '.failure.txt', 'PRIVATE_OR_BINDING_GATE_FAILED: ' + error.message + '\n', { flag: 'wx' });
    } catch (persistenceError) { console.error('Failure evidence was not persisted: ' + persistenceError.message); }
  }
  }
}
