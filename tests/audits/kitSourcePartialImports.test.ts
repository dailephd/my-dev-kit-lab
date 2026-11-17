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
function fixture(partial: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-partial-imports-'));
  roots.push(root);
  const files = {
    'package.json': JSON.stringify({name:'fixture',version:'1.0.0',scripts:{test:'vitest run'}}),
    'src/sdk.ts': 'export const alive = true;\n',
    'src/load.ts': partial ? "import {pathToFileURL} from 'node:url'; const runtime={sdk:'verified/sdk.js'}; export async function load(){return await import(pathToFileURL(runtime.sdk).href)}\n" : "export async function load(){return await import('./sdk.js')}\n",
    'tests/load.test.ts': "import '../src/sdk.js';\nit.skip('known independent finding',()=>{});\n" + (partial ? "const target='./unknown.js'; await import(target); await import(String(target));\n" : "await import('../src/sdk.js');\n"),
    'src/old/retired.ts': '// independent old directory finding\n',
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
    const root=fixture(false), result=await runAudit({config:config(root),toolRoot:root});
    expect(result.exitCode).toBe(0);
    expect(result.detectorErrors).toEqual([]);
    expect(result.sourceFacts.files.every(f=>f.kit?.capabilities.imports==='complete')).toBe(true);
    expect(result.issues.some(i=>i.detectorId==='test-rot')).toBe(true);
  },120000);
  it('continues independent checks across mixed files without false missing/dead import conclusions; required coverage cannot pass even with fail-on none',async()=>{
    const root=fixture(true), result=await runAudit({config:config(root),toolRoot:root});
    const partial=result.sourceFacts.files.filter(f=>f.kit?.capabilities.imports==='partial');
    expect(partial.map(f=>f.relativePath)).toEqual(['src/load.ts','tests/load.test.ts']);
    expect(partial.every(f=>f.diagnostics.some(d=>d.code==='kit:unsupported-dynamic-import'))).toBe(true);
    expect(result.exitCode).toBe(2);
    expect(result.coverage!.some(c=>c.status==='UNAVAILABLE' && c.mandatory && c.capability==='imports')).toBe(true);
    expect(result.coverage!.filter(c=>c.mandatory && c.status==='UNAVAILABLE').length).toBe(result.detectorErrors.length);
    expect(result.exitReason).toContain('INCOMPLETE');
    expect(result.detectorErrors.some(e=>e.message.includes('tests/fixtures/view.html') && e.message.includes('raw-content'))).toBe(true);
    expect(result.issues.some(i=>i.id.includes('unreferenced-fixture'))).toBe(false);
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
  const root=fixture(false);
  const file='tests/fixtures/config.gradle.kts';
  fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
  fs.writeFileSync(path.join(root,file),'// npm run vanished\n// test.only("configuration text")\nandroid { buildTypes { release { isDebuggable = false } } }\n');
  const result=await runAudit({config:normalizeAuditConfig({target:root,include:'tests',failOn:'none'},root),toolRoot:root});
  expect(result.exitCode).toBe(0);
  expect(result.detectorErrors).toEqual([]);
  expect(result.issues.some(i=>i.title.includes('vanished') && i.affectedFiles.includes(file))).toBe(true);
  expect(result.issues.some(i=>i.title.includes('.only') && i.affectedFiles.includes(file))).toBe(false);
  expect(result.coverage!.filter(c=>c.source.identity===file && c.capability==='imports').every(c=>c.status==='NOT_APPLICABLE')).toBe(true);
},120000);

it('keeps raw JSON fixture selection optional for the semantic import domain',async()=>{
  const root=fixture(false);
  fs.writeFileSync(path.join(root,'tests/data.json'),'{}\n');
  const result=await runAudit({config:config(root),toolRoot:root});
  expect(result.exitCode).toBe(0);
  expect(result.detectorErrors).toEqual([]);
  expect(result.coverage!.filter(c=>c.source.identity==='tests/data.json').every(c=>!c.mandatory)).toBe(true);
},120000);
