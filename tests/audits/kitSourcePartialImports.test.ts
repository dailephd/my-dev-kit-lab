import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runAudit } from '../../src/audits/core/auditRunner.js';
import { normalizeAuditConfig } from '../../src/audits/core/auditConfig.js';
import { collectKitSourceFacts } from '../../src/audits/core/kitSourceProvider.js';
import { scanProjectInventory } from '../../src/audits/core/projectInventory.js';
import { assertRequiredCapabilities, hasQualifiedPartialImports, type KitFileRecord } from '../../src/audits/core/kitSourceEvidence.js';

const roots: string[] = [];
function fixture(profile: 'exact-path' | 'unproved-runtime-mapping' | 'partial') {
  const partial = profile === 'partial';
  const ambiguous = profile === 'unproved-runtime-mapping';
  const extension = profile === 'exact-path' ? 'js' : 'ts';
  const sdkPath = `src/sdk.${extension}`;
  const requestedModule = ambiguous ? "sdk" : "sdk.js";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-partial-imports-'));
  roots.push(root);
  const files = {
    'package.json': JSON.stringify({name:'fixture',version:'1.0.0',scripts:{test:'vitest run'}}),
    [sdkPath]: 'export const alive = true;\n',
    ...(ambiguous ? { 'src/sdk.js': 'export const alternate = true;\n' } : {}),
    [`src/load.${extension}`]: partial ? "import {pathToFileURL} from 'node:url'; const runtime={sdk:'verified/sdk.js'}; export async function load(){return await import(pathToFileURL(runtime.sdk).href)}\n" : `export async function load(){return await import('./${requestedModule}')}\n`,
    [`tests/load.test.${extension}`]: `import '../src/${requestedModule}';\nit.skip('known independent finding',()=>{});\n` + (partial ? "const target='./unknown.js'; await import(target); await import(String(target));\n" : `await import('../src/${requestedModule}');\n` +
      (profile === 'exact-path' ? "await import('../src/load.js');\n" : '')),
    ...(profile === 'exact-path' ? {} : { 'src/old/retired.ts': '// independent old directory finding\n' }),
    ...(partial ? {'tests/fixtures/view.html': '<main>Unsupported content stays unknown</main>\n', 'tests/unresolved.test.ts': "import '../unselected/outside.js'; test.only('another independent finding',()=>{});\n"} : {}),
  };
  for (const [file, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true}); fs.writeFileSync(path.join(root,file),content); }
  return root;
}
afterAll(()=>{for(const root of roots) fs.rmSync(root,{recursive:true,force:true});});
const config = (root:string)=>normalizeAuditConfig({target:root,types:'code-rot',include:'docs,tests,package,architecture,cli',failOn:'none'},root);

describe('qualified partial import coverage',()=>{
  it('keeps strict assertions and refuses unsupported, failed, unqualified or corrupt partial records',()=>{
    const record = {status:'parsed',path:'src/a.ts',contentSha256:'a'.repeat(64),capabilities:{imports:'partial'},diagnostics:[{code:'unsupported-dynamic-import',message:'unresolved target'}]} as unknown as KitFileRecord;
    expect(hasQualifiedPartialImports(record)).toBe(true);
    expect(()=>assertRequiredCapabilities(record,['imports'])).toThrow(/partial/);
    for(const override of [{status:'failed'},{status:'partial'},{contentSha256:'bad'},{diagnostics:[]},{capabilities:{imports:'unsupported'}}]) expect(hasQualifiedPartialImports({...record,...override} as KitFileRecord)).toBe(false);
  });
  it('preserves static/literal dynamic complete results and success semantics',async()=>{
    const root=fixture('exact-path'), result=await runAudit({config:config(root),toolRoot:root});
    expect(result.exitCode, JSON.stringify(result.detectorErrors, null, 2)).toBe(0);
    expect(result.detectorErrors).toEqual([]);
    expect(result.sourceFacts.files.every(f=>f.kit?.capabilities.imports==='complete')).toBe(true);
    expect(result.sourceFacts.files.find(f => f.relativePath === 'tests/load.test.js')?.imports)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: '../src/sdk.js',
          importResolution: 'resolved-local',
          targetPaths: ['src/sdk.js'],
        }),
      ]));
    expect(result.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detectorId: 'test-rot',
        predicate: 'missing-source-import',
        source: { kind: 'file', identity: 'tests/load.test.js' },
        capability: 'imports',
        status: 'QUALIFIED',
        proof: expect.objectContaining({ kind: 'import-domain', references: expect.arrayContaining(['src/sdk.js']) }),
      }),
    ]));
    expect(result.issues.some(i=>i.detectorId==='test-rot' && i.title.includes('.skip'))).toBe(true);
  },120000);
  it('keeps an ambiguous TypeScript runtime mapping incomplete without inferring missing or unused source', async () => {
    const root = fixture('unproved-runtime-mapping');
    const result = await runAudit({ config: config(root), toolRoot: root });

    expect(result.exitCode).toBe(2);
    expect(result.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detectorId: 'test-rot',
        predicate: 'missing-source-import',
        source: { kind: 'file', identity: 'tests/load.test.ts' },
        capability: 'imports',
        status: 'UNAVAILABLE',
        reason: expect.stringContaining('finite selected-target bound'),
        mandatory: true,
      }),
      expect.objectContaining({
        detectorId: 'dead-code-candidate',
        predicate: 'unreferenced-source-file',
        capability: 'imports',
        status: 'UNAVAILABLE',
        mandatory: true,
      }),
    ]));
    expect(result.issues.some(i=>i.detectorId==='test-rot' && i.title.includes('.skip'))).toBe(true);
    expect(result.issues.filter(i => i.title.includes('missing source') ||
      (i.title.includes('no detected in-repo importer') && i.affectedFiles.some(file => /^src\/sdk\.(js|ts)$/.test(file))))).toEqual([]);
  }, 120000);

  it('continues independent checks across mixed files without false missing/dead import conclusions; required coverage cannot pass even with fail-on none',async()=>{
    const root=fixture('partial'), result=await runAudit({config:config(root),toolRoot:root});
    const partial=result.sourceFacts.files.filter(f=>f.kit?.capabilities.imports==='partial');
    expect(partial.map(f=>f.relativePath)).toEqual(['src/load.ts','tests/load.test.ts']);
    expect(partial.every(f=>f.diagnostics.some(d=>d.code==='kit:unsupported-dynamic-import'))).toBe(true);
    expect(result.exitCode).toBe(2);
    expect(result.coverage!.some(c=>c.status==='UNAVAILABLE' && c.mandatory && c.capability==='imports')).toBe(true);
    const incomplete = result.coverage!.filter(c => c.mandatory &&
      (c.status === 'UNAVAILABLE' || c.status === 'UNDETERMINED'));
    expect(incomplete.filter(c => c.status === 'UNDETERMINED')).toEqual([
      expect.objectContaining({
        detectorId: 'test-rot',
        predicate: 'missing-source-import',
        source: { kind: 'file', identity: 'tests/load.test.ts' },
        capability: 'imports',
        diagnostic: 'INCOMPLETE_REFERENCE_PROFILE',
      }),
    ]);
    const projectedErrors = incomplete.map(c => ({
      id: c.detectorId,
      message: `PARTIAL_COVERAGE UNAVAILABLE: ${c.predicate}; ${c.source.kind}=${c.source.identity}; ` +
        `capability=${c.capability}; status=${c.actualStatus}; ${c.reason}; ${c.diagnostic}`,
    }));
    const coverageErrors = result.detectorErrors.filter(error => error.message.startsWith('PARTIAL_COVERAGE UNAVAILABLE: '));
    expect(result.detectorErrors.filter(error => !error.message.startsWith('PARTIAL_COVERAGE UNAVAILABLE: '))).toEqual([]);
    expect(coverageErrors.map(error => JSON.stringify(error)).sort()).toEqual(
      projectedErrors.map(error => JSON.stringify(error)).sort(),
    );
    expect(result.exitReason).toContain('INCOMPLETE');
    expect(result.detectorErrors.some(e=>e.message.includes('file=tests/fixtures/view.html; capability=imports') && e.message.includes('status=unsupported'))).toBe(true);
    expect(result.issues.filter(i => i.id.includes('unreferenced-fixture'))).toEqual([
      expect.objectContaining({ affectedFiles: ['tests/fixtures/view.html'], confidence: 'low' }),
    ]);
    expect(result.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detectorId: 'dead-code-candidate',
        predicate: 'fixture literal absence view.html',
        source: { kind: 'file', identity: 'tests/fixtures/view.html' },
        capability: 'raw-content',
        status: 'QUALIFIED',
        proof: expect.objectContaining({ kind: 'exact-literal-byte' }),
      }),
    ]));
    expect(result.issues.some(i=>i.detectorId==='test-rot' && i.title.includes('.skip'))).toBe(true);
    expect(result.issues.some(i=>i.title.includes('old/deprecated'))).toBe(true);
    expect(result.issues.some(i=>i.detectorId==='test-rot' && i.title.includes('.only'))).toBe(true);
    expect(result.issues.filter(i=>i.title.includes('missing source') || i.title.includes('no in-repo') || i.title.includes('no importer'))).toEqual([]);
    for(const file of partial) expect(result.detectorErrors.some(e=>e.id==='dead-code-candidate' && e.message.includes(file.relativePath) && e.message.includes('UNAVAILABLE'))).toBe(true);
    expect(result.detectorErrors.some(e=>e.id==='test-rot' && e.message.includes('missing-source-import'))).toBe(true);
    // Direct provider callers remain strict unless they explicitly defer to consumers.
    await expect(collectKitSourceFacts({targetRoot:root,inventory:scanProjectInventory(root),requiredCapabilities:['imports'],includeScriptsRoot:false})).rejects.toMatchObject({category:'capability-insufficient'});
  },120000);
});

it('does not assign executable test obligations to a Gradle configuration fixture; raw command checks remain',async()=>{
  const root=fixture('exact-path');
  const file='tests/fixtures/config.gradle.kts';
  fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
  fs.writeFileSync(path.join(root,file),'// npm run vanished\n// test.only("configuration text")\nandroid { buildTypes { release { isDebuggable = false } } }\n');
  const result=await runAudit({config:normalizeAuditConfig({target:root,include:'tests',failOn:'none'},root),toolRoot:root});
  expect(result.exitCode, JSON.stringify(result.detectorErrors, null, 2)).toBe(0);
  expect(result.detectorErrors).toEqual([]);
  expect(result.issues.some(i=>i.title.includes('vanished') && i.affectedFiles.includes(file))).toBe(true);
  expect(result.issues.some(i=>i.title.includes('.only') && i.affectedFiles.includes(file))).toBe(false);
  expect(result.coverage!.filter(c=>c.source.identity===file && c.capability==='imports').every(c=>c.status==='NOT_APPLICABLE')).toBe(true);
},120000);

it('keeps raw JSON fixture selection optional for the semantic import domain',async()=>{
  const root=fixture('exact-path');
  fs.writeFileSync(path.join(root,'tests/data.json'),'{}\n');
  const result=await runAudit({config:config(root),toolRoot:root});
  expect(result.exitCode, JSON.stringify(result.detectorErrors, null, 2)).toBe(0);
  expect(result.detectorErrors).toEqual([]);
  expect(result.coverage!.filter(c=>c.source.identity==='tests/data.json' && c.capability==='imports').every(c=>!c.mandatory)).toBe(true);
  expect(result.coverage!.some(c=>c.source.identity==='tests/data.json' && c.capability==='raw-content' && c.status==='QUALIFIED')).toBe(true);
},120000);
