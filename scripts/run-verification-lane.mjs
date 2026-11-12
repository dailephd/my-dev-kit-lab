import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PRIVATE_TEST_FILES = ['tests/audits/kitSourceDifferential.test.ts', 'tests/audits/kitSourceReaderReplacement.test.ts'];
export function publicExecutionScope(args) {
  for (let index = 0; index < args.length; index++) {
    if (['--reporter', '--maxWorkers', '--minWorkers'].includes(args[index]) && args[index + 1]) { index++; continue; }
    if (/^--(?:reporter|maxWorkers|minWorkers)=.+/.test(args[index]) || ['--no-cache', '--no-file-parallelism'].includes(args[index])) continue;
    return 'focused'; // Unknown options can filter or shard tests; fail closed.
  }
  return 'full';
}
export function sourceIdentity(root) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).filter(Boolean).sort();
  return createHash('sha256').update(JSON.stringify(files.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))).digest('hex');
}
export function ownedDirectory(root, directory) {
  const relative = path.relative(root, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Verification output outside repository');
  let current = root;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe verification directory');
    } else fs.mkdirSync(current);
  }
  return fs.realpathSync(directory);
}
export function verificationOutputDirectory(authority, filename) {
  const directory = path.dirname(path.resolve(filename));
  if (![path.join(authority, '.my-dev-kit-workflow'), path.join(authority, '.my-dev-kit-context')].some(root => {
    const relative = path.relative(root, directory);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  })) throw new Error('Verification results must remain in private project-owned output roots');
  return ownedDirectory(authority, directory);
}
export function runPublicTests(args = [], root = process.cwd()) {
  const temp = ownedDirectory(root, path.join(root, '.my-dev-kit-workflow/tmp/public-tests'));
  ownedDirectory(root, path.join(root, '.my-dev-kit-context'));
  const env = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, TSX_DISABLE_CACHE: '1', LAB_VERIFICATION_LANE: 'public' };
  const before = sourceIdentity(root);
  const command = [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...PRIVATE_TEST_FILES.flatMap(file => ['--exclude', file]), ...args];
  console.log('PUBLIC_LANE: current published-provider behavior; private historical authentication is a separate MANDATORY gate, not executed here.');
  const result = spawnSync(process.execPath, command, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  const after = sourceIdentity(root), passed = result.status === 0 && before === after;
  const record = { schemaVersion: '1.0.0', lane: 'public', scope: publicExecutionScope(args), status: passed ? 'PASS' : 'FAIL', exitCode: result.status, candidateSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(), sourceIdentity: before, sourceUnchanged: before === after, command: [process.execPath, ...command], excludedPrivateFiles: PRIVATE_TEST_FILES, privateLane: 'REQUIRED_SEPARATE_GATE', environment: { node: process.version, platform: process.platform, arch: process.arch }, timestamp: new Date().toISOString() };
  const output = process.env.LAB_PUBLIC_VERIFICATION_RESULT;
  if (output) {
    const common = path.resolve(root, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim());
    if (path.basename(common) !== '.git') throw new Error('Unrecognized Git ownership');
    verificationOutputDirectory(path.dirname(common), output);
    fs.writeFileSync(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  }
  return passed ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === '--prepare-ci') {
    const root = fs.realpathSync(process.cwd()), temp = ownedDirectory(root, path.join(root, '.my-dev-kit-workflow/tmp/public-tests'));
    const values = { TEMP: temp, TMP: temp, TMPDIR: temp, TSX_DISABLE_CACHE: '1', npm_config_cache: ownedDirectory(root, path.join(root, '.my-dev-kit-workflow/npm-cache')), npm_config_logs_dir: ownedDirectory(root, path.join(root, '.my-dev-kit-workflow/npm-logs')), PLAYWRIGHT_BROWSERS_PATH: ownedDirectory(root, path.join(root, '.my-dev-kit-workflow/browser-cache')) };
    ownedDirectory(root, path.join(root, '.my-dev-kit-context'));
    if (!process.env.GITHUB_ENV) throw new Error('CI environment output missing');
    fs.appendFileSync(process.env.GITHUB_ENV, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
    console.log('Public prerequisites use physical project-owned paths. Private provenance remains a separate mandatory protected gate.');
  } else {
    if (process.argv[2] !== 'public') throw new Error('Expected public verification lane');
    process.exitCode = runPublicTests(process.argv.slice(3));
  }
}
