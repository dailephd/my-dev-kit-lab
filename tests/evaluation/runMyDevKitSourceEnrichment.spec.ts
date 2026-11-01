import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  boundedSourceContentIssue, DEFAULT_BOUNDED_SOURCE_OPTIONS, isBoundedRetrievalResult,
  runMyDevKitBoundedRetrievalFromIndex, runMyDevKitRetrievalStrategyFromIndex, type MyDevKitBoundedSourceOptions
} from "../../src/evaluation/runMyDevKitRetrieval.js";
import { buildIncrementalChangeStalenessRequiredFileEvidence, runIncrementalChangeStalenessTreatmentRetrieval } from "../../src/experiments/plugins/incrementalChangeStaleness/execution.js";
import { cleanupTempDirs, makeFixture, writeIndex } from "./indexSnapshotTestHelpers.js";
import type { EvaluationCase } from "../../src/evaluation/types.js";

afterEach(cleanupTempDirs);
const enrichment = { headerEligibleFilePrefix: 8, headerMaxEndLine: 24, maxDependencyDepth: 2, maxDependencySourceCalls: 8, maxSourceLinesPerCall: 160 };
type File = { text: string; symbols: Record<string, [number, number]> };
type SourceOutput = { file?: string; node?: string; start?: number; end?: number; stdout: string };
type Protocol = { outputs?: SourceOutput[]; eol?: "\n" | "\r\n"; omitLocations?: boolean };

function fixture(files: Record<string, File>, selected: [string, string][], failure?: string, protocol: Protocol = {}) {
  const f = makeFixture(Object.fromEntries(Object.entries(files).map(([file, value]) => [file, value.text])));
  const listed = Object.keys(files);
  writeIndex(f, listed, {
    manifest: { artifacts: { symbolIndex: "symbol-index.json", codeGraph: "code-graph.json" } },
    symbolIndex: { schemaVersion: "3", files: listed.map((file) => ({ path: file,
      symbols: Object.entries(files[file]!.symbols).map(([name, span]) => ({ name, nodeId: `symbolq:${file}#${name}`,
        ...(!protocol.omitLocations ? { location: { file, line: span[0], endLine: span[1] } } : {}) })) })) }
  });
  writeFileSync(path.join(f.indexDir, "code-graph.json"), JSON.stringify({ artifactKind: "code-graph", schemaVersion: "1.1.0", edges: [], nodes: listed.flatMap((file) => [
    { id: `file:${file}`, kind: "file", path: file },
    ...Object.keys(files[file]!.symbols).map((name) => ({ id: `symbolq:${file}#${name}`, kind: "symbol", path: file }))
  ]) }));
  const script = path.join(f.indexDir, "kit.mjs");
  const log = path.join(f.indexDir, "argv.jsonl");
  writeFileSync(script, `import {appendFileSync} from 'node:fs';
const a=process.argv.slice(2), get=k=>a[a.indexOf(k)+1];
appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');
const files=${JSON.stringify(files)}, selected=${JSON.stringify(selected)};
if(a[0]==='search') console.log(JSON.stringify({results:selected.map(([file,name])=>({kind:name?'symbol':'file',path:file,nodeId:name?'symbolq:'+file+'#'+name:'file:'+file}))}));
else if(a[0]==='source') {
 const node=a.includes('--node')?get('--node'):null;
 const file=node?node.slice(node.indexOf(':')+1).split('#')[0]:get('--file');
 const override=${JSON.stringify(protocol.outputs ?? [])}.find(o=>(!o.file||o.file===file)&&(!o.node||o.node===node)&&(o.start===undefined||o.start===+get('--start'))&&(o.end===undefined||o.end===+get('--end')));
 if(override) { process.stdout.write(override.stdout); process.exit(0); }
 if(${JSON.stringify(failure ?? "")}===file) process.exit(1);
 if(${JSON.stringify(failure ?? "")}==='empty') process.exit(0);
 if(${JSON.stringify(failure ?? "")}==='identity') { console.log('1 | wrong file\\n[EOF: unrelated.py (1 lines total)]'); process.exit(0); }
 if(${JSON.stringify(failure ?? "")}==='range') { console.log('4 | first\\n6 | gap'); process.exit(0); }
 const rows=files[file].text.split(/\\r?\\n/);
 if(rows.at(-1)==='') rows.pop();
 const span=node?(node.startsWith('file:')?[1,rows.length]:files[file].symbols[node.split('#')[1]]):[+get('--start'),+get('--end')];
 const start=span[0], end=Math.min(span[1],rows.length,start+(+get('--max-lines'))-1);
 // Frozen Kit renderNumberedSource removes one terminal empty element after joining the slice.
 const printed=rows.slice(start-1,end).join('\\n').split('\\n');
 if(printed.at(-1)==='') printed.pop();
 const width=String(start+printed.length-1).length;
 process.stdout.write(printed.map((row,i)=>String(start+i).padStart(width)+' | '+row).join(${JSON.stringify(protocol.eol ?? "\n")})+'\\n');
 if(!node || node.startsWith('file:') || end<span[1]) console.log('\\n'+(end===rows.length?'[EOF: '+file+' ('+rows.length+' lines total)]':'[CONTINUE: '+file+' from line '+(end+1)+' (reason: window-capped)]'));
} else console.log('{}');`);
  const evaluationCase: EvaluationCase = {
    id: "enrichment", title: "enrichment", benchmarkProject: "todo-ts", targetRoot: f.targetRoot,
    // Dependency fixtures investigate these tests explicitly; incidental-search
    // regressions below replace this with the original non-test API query.
    absoluteTargetRoot: f.targetRoot, sourceRoots: f.sourceRoots,
    query: `original query ${selected.filter(([file]) => /(?:^|\/)tests?\//.test(file)).map(([file]) => file).join(" ")}`,
    expectedFiles: [], expectedSymbols: [], rawIncludeGlobs: []
  };
  const options = { evaluationCase, kitCommand: `node "${script}"`, indexDir: f.indexDir,
    activeIndex: { indexDir: f.indexDir, targetRoot: f.targetRoot, sourceRoots: f.sourceRoots },
    commandsDir: path.join(f.indexDir, "commands"), requireKit: true };
  return {
    ...f, options,
    run: async (bounded: MyDevKitBoundedSourceOptions = { maxSourceFiles: 20, searchLimit: 40, enrichment }) => {
      const result = await runMyDevKitBoundedRetrievalFromIndex({ ...options, boundedSource: bounded });
      if (!isBoundedRetrievalResult(result)) throw new Error("missing bounded protocol");
      return result;
    },
    calls: () => readFileSync(log, "utf8").trim().split("\n").map((row) => JSON.parse(row) as string[])
  };
}

const metrics: File = { text: "STALE_DAY_THRESHOLD = 10\n\n\ndef calculate_project_metrics(rows, current_day, stale_day_threshold=STALE_DAY_THRESHOLD):\n    return stale_day_threshold", symbols: { calculate_project_metrics: [4, 5] } };
const test: File = { text: "from pkg.metrics import calculate_project_metrics\n\ndef test_quality():\n    assert calculate_project_metrics([], 30) == 10", symbols: { test_quality: [3, 4] } };

describe("bounded source enrichment", () => {
  it("R1 A/D: verifies the disposable index independently of the unchanged canonical task and actually enriches it", async () => {
    const f = fixture({ "src/pkg/metrics.py": metrics, "tests/test_quality.py": test }, [["tests/test_quality.py", "test_quality"]]);
    const canonical = makeFixture();
    f.options.evaluationCase.absoluteTargetRoot = canonical.targetRoot;
    f.options.evaluationCase.targetRoot = canonical.targetRoot;
    f.options.evaluationCase.answerKey = { expectedFiles: ["tests/test_quality.py"], expectedSymbols: ["test_quality"], expectedFacts: [], minimumCorrectFacts: 0 };
    const taskBefore = structuredClone(f.options.evaluationCase);
    expect(canonical.targetRoot).not.toBe(f.options.activeIndex.targetRoot);
    const result = await runIncrementalChangeStalenessTreatmentRetrieval({ derivedTask: f.options.evaluationCase, ...f.options });
    expect(result.skipped).toBe(false);
    expect(result.filesRead).toEqual(["tests/test_quality.py", "src/pkg/metrics.py"]);
    expect(result.commands.some((command) => command.commandId.startsWith("source-header"))).toBe(true);
    expect(result.commands.some((command) => command.commandId.startsWith("source-dependency"))).toBe(true);
    expect(buildIncrementalChangeStalenessRequiredFileEvidence({ requiredFiles: ["tests/test_quality.py"], retrieval: result }).status).toBe("present");
    expect(f.options.evaluationCase).toEqual(taskBefore);
  });

  it("R1 B: rejects a manifest that disagrees with both supplied authority and canonical task before any source call", async () => {
    const f = fixture({ "src/pkg/metrics.py": metrics }, [["src/pkg/metrics.py", "calculate_project_metrics"]]);
    const canonical = makeFixture();
    const wrongAuthority = makeFixture();
    f.options.evaluationCase.absoluteTargetRoot = canonical.targetRoot;
    f.options.activeIndex.targetRoot = wrongAuthority.targetRoot;
    await expect(f.run()).rejects.toThrow(/manifest-target-mismatch/);
    expect(f.calls()).toHaveLength(1);
    expect(f.calls()[0][0]).toBe("search");
  });

  it("R1 B: rejects ordered source-root disagreement and a different selected index directory", async () => {
    const f = fixture({ "src/pkg/metrics.py": metrics }, [["src/pkg/metrics.py", "calculate_project_metrics"]]);
    f.options.activeIndex.sourceRoots = ["tests", "src"];
    await expect(f.run()).rejects.toThrow(/manifest-target-mismatch/);
    f.options.activeIndex.sourceRoots = ["src", "tests"];
    f.options.activeIndex.indexDir = path.join(f.indexDir, "other-index");
    await expect(f.run()).rejects.toThrow(/independently selected active index/);
    expect(f.calls().filter((call) => call[0] === "source")).toHaveLength(0);
  });

  it("R1 E: reuses a verified whole file reached through a different dependency symbol selector", async () => {
    const f = fixture({ "src/pkg/metrics.py": metrics, "tests/test_quality.py": test }, [["tests/test_quality.py", "test_quality"], ["src/pkg/metrics.py", ""]]);
    const result = await f.run();
    expect(boundedSourceContentIssue(result, ["tests/test_quality.py"])).toBeNull();
    expect(f.calls().filter((call) => call[0] === "source")).toHaveLength(3);
    expect(result.commands.filter((command) => command.commandId.startsWith("source-dependency"))).toHaveLength(0);
  });

  it("R1 E: a different partial symbol cannot stand in for the required dependency body", async () => {
    const module: File = { text: "def unrelated(): return 1\n\ndef calculate_project_metrics(rows, day): return 10", symbols: { unrelated: [1, 1], calculate_project_metrics: [3, 3] } };
    const f = fixture({ "src/pkg/metrics.py": module, "tests/test_quality.py": test }, [["tests/test_quality.py", "test_quality"], ["src/pkg/metrics.py", "unrelated"]]);
    const result = await f.run();
    expect(result.commands.some((command) => command.commandId.startsWith("source-dependency") && command.args.includes("symbolq:src/pkg/metrics.py#calculate_project_metrics"))).toBe(true);
    expect(result.contextText).toContain("3 | def calculate_project_metrics");
  });
  it("R02: staleness opts in; the shared bounded default stays eight without enrichment", async () => {
    expect(DEFAULT_BOUNDED_SOURCE_OPTIONS).toEqual({ maxSourceFiles: 8, searchLimit: 40 });
    const f = fixture({ "src/pkg/metrics.py": metrics }, [["src/pkg/metrics.py", "calculate_project_metrics"]]);
    const result = await runIncrementalChangeStalenessTreatmentRetrieval({ derivedTask: f.options.evaluationCase, ...f.options });
    expect(isBoundedRetrievalResult(result) && result.boundedCoverage.maxSourceFiles).toBe(20);
    expect(f.calls().filter((call) => call[0] === "source")).toHaveLength(2);
  });

  it("R05/R07/R08: D4 duplicate header regression: a dependency reuses both its primary body and completed header", async () => {
    const f = fixture({ "src/pkg/metrics.py": metrics, "tests/test_quality.py": test }, [["tests/test_quality.py", "test_quality"], ["src/pkg/metrics.py", "calculate_project_metrics"]]);
    const result = await f.run();
    const source = f.calls().filter((call) => call[0] === "source");
    expect(source).toHaveLength(4); // two primary bodies, two missing headers; dependency stage reuses both
    expect(source.filter((call) => call.includes("--file") && call.includes("src/pkg/metrics.py"))).toHaveLength(1);
    expect(boundedSourceContentIssue(result, ["tests/test_quality.py", "src/pkg/metrics.py"])).toBeNull();
    expect(result.contextText).toContain("STALE_DAY_THRESHOLD = 10");
    expect(new Set(source.map((call) => JSON.stringify(call))).size).toBe(source.length);
    expect(result.commands.filter((command) => command.args.includes("source"))).toHaveLength(4);
  });

  it("R08/R15: a named default without its numeric declaration stays unknown despite successful file observation", async () => {
    const f = fixture({ "src/pkg/metrics.py": metrics }, [["src/pkg/metrics.py", "calculate_project_metrics"]]);
    const result = await f.run({ maxSourceFiles: 20, searchLimit: 40, enrichment: { ...enrichment, headerEligibleFilePrefix: 0 } });
    expect(result.filesRead).toContain("src/pkg/metrics.py");
    expect(buildIncrementalChangeStalenessRequiredFileEvidence({ requiredFiles: ["src/pkg/metrics.py"], retrieval: result })).toMatchObject({ status: "unknown", reason: expect.stringContaining("numeric declaration") });
  });

  it("R05/R07: an already covered header is never requested", async () => {
    const full = { ...metrics, symbols: { calculate_project_metrics: [1, 5] as [number, number] } };
    const f = fixture({ "src/pkg/metrics.py": full }, [["src/pkg/metrics.py", "calculate_project_metrics"]]);
    await f.run();
    expect(f.calls().filter((call) => call[0] === "source")).toHaveLength(1);
  });

  it("R06/R09: the header cap preserves an intermediate gap; a partial body cannot prove import absence", async () => {
    const file = "src/behavior.ts";
    const f = fixture({ [file]: { text: [...Array.from({ length: 29 }, () => "// padding"), "export function behavior() { return 1; }"].join("\n"), symbols: { behavior: [30, 30] } } }, [[file, "behavior"]]);
    const result = await f.run();
    const header = f.calls().find((call) => call.includes("--file"))!;
    expect(header.slice(header.indexOf("--start"), header.indexOf("--end") + 2)).toEqual(["--start", "1", "--end", "24"]);
    expect(boundedSourceContentIssue(result, [file])).toContain("25-29");
  });

  it("R09: a complete leading import region supports absence independently of the function excerpt", async () => {
    const file = "src/behavior.ts";
    const f = fixture({ [file]: { text: "import { current } from './current.js';\n\nexport function behavior() { return current(); }", symbols: { behavior: [3, 3] } } }, [[file, "behavior"]]);
    const result = await f.run();
    expect(boundedSourceContentIssue(result, [file])).toBeNull();
    expect(result.contextText).toContain("import { current }");
  });

  it("R10/R14: actual test-source imports reach production with measured index-bound source provenance", async () => {
    const f = fixture({ "src/pkg/metrics.py": metrics, "tests/test_quality.py": test }, [["tests/test_quality.py", "test_quality"]]);
    const result = await f.run();
    expect(result.filesRead).toEqual(["tests/test_quality.py", "src/pkg/metrics.py"]);
    expect(boundedSourceContentIssue(result, ["tests/test_quality.py"])).toBeNull();
    const source = result.commands.filter((command) => command.args.includes("source"));
    expect(source).toHaveLength(4);
    for (const command of source) {
      expect(command.args[command.args.indexOf("--index") + 1]).toBe(f.indexDir);
      expect(command.args[command.args.indexOf("--max-lines") + 1]).toBe("160");
      expect(command.durationMs).toBeGreaterThanOrEqual(0);
      expect(readFileSync(command.stdoutPath, "utf8")).toBe(command.stdout);
    }
  });

  it("R11: dependency headers consume the same call cap as dependency bodies", async () => {
    const f = fixture({ "src/pkg/metrics.py": metrics, "tests/test_quality.py": test }, [["tests/test_quality.py", "test_quality"]]);
    const result = await f.run({ maxSourceFiles: 20, searchLimit: 40, enrichment: { ...enrichment, maxDependencySourceCalls: 1 } });
    expect(result.commands.filter((command) => command.commandId.startsWith("source-dependency"))).toHaveLength(1);
    expect(boundedSourceContentIssue(result, ["tests/test_quality.py"])).toContain("cap");
  });

  it.each([0, 1, 8, 20])("R04: attempts exactly the eligible prefix at budget %i", async (budget) => {
    const files = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`src/f${i}.py`, { text: `def f${i}(): return ${i}`, symbols: { [`f${i}`]: [1, 1] as [number, number] } }]));
    const ranked = Object.keys(files).map((file, i): [string, string] => [file, `f${i}`]);
    const f = fixture(files, ranked);
    const result = await f.run({ maxSourceFiles: budget, searchLimit: 40, enrichment });
    expect(result.boundedCoverage.eligibleCandidateFileCount).toBe(21);
    expect(result.boundedCoverage.candidateBudgetExhausted).toBe(true);
    expect(f.calls().filter((call) => call[0] === "source").map((call) => call[call.indexOf("--node") + 1])).toEqual(ranked.slice(0, budget).map(([file, name]) => `symbolq:${file}#${name}`));
  });

  it("R11: depth two is a hard cap and an unsourced deeper import stays unresolved", async () => {
    const chain = (name: string, dependency: string): File => ({ text: `from pkg.${dependency} import ${dependency}\n\ndef ${name}():\n    return ${dependency}()`, symbols: { [name]: [3, 4] } });
    const f = fixture({ "tests/test_chain.py": chain("test_chain", "a"), "src/pkg/a.py": chain("a", "b"), "src/pkg/b.py": chain("b", "c"), "src/pkg/c.py": { text: "def c(): return 1", symbols: { c: [1, 1] } } }, [["tests/test_chain.py", "test_chain"]]);
    const result = await f.run();
    expect(result.filesRead).toEqual(["tests/test_chain.py", "src/pkg/a.py", "src/pkg/b.py"]);
    expect(boundedSourceContentIssue(result, ["tests/test_chain.py"])).toContain("depth cap");
  });

  it("R11: at most eight dependency source operations execute, including all dependency headers", async () => {
    const files: Record<string, File> = {};
    for (let i = 0; i < 10; i++) files[`src/pkg/f${i}.py`] = { text: `def f${i}(): return ${i}`, symbols: { [`f${i}`]: [1, 1] } };
    files["tests/test_many.py"] = { text: [...Array.from({ length: 10 }, (_, i) => `from pkg.f${i} import f${i}`), "def test_many(): pass"].join("\n"), symbols: { test_many: [1, 11] } };
    const f = fixture(files, [["tests/test_many.py", "test_many"]]);
    const result = await f.run();
    expect(result.commands.filter((command) => command.commandId.startsWith("source-dependency"))).toHaveLength(8);
    expect(boundedSourceContentIssue(result, ["tests/test_many.py"])).toContain("cap");
  });

  it("R12: cycles terminate and third-party modules are never expanded", async () => {
    const root: File = { text: "from pkg.a import a\nimport external_library\ndef test_cycle(): pass", symbols: { test_cycle: [1, 3] } };
    const a: File = { text: "from pkg.b import b\ndef a(): return b()", symbols: { a: [1, 2] } };
    const b: File = { text: "from pkg.a import a\ndef b(): return 1", symbols: { b: [1, 2] } };
    const f = fixture({ "tests/test_cycle.py": root, "src/pkg/a.py": a, "src/pkg/b.py": b }, [["tests/test_cycle.py", "test_cycle"]]);
    const result = await f.run();
    expect(f.calls().filter((call) => call[0] === "source")).toHaveLength(3);
    expect(boundedSourceContentIssue(result, ["tests/test_cycle.py"])).toBeNull();
  });

  it.each(["empty", "identity", "range"])("R13: %s source output stays incomplete despite exit zero", async (failure) => {
    const f = fixture({ "src/pkg/metrics.py": metrics }, [["src/pkg/metrics.py", "calculate_project_metrics"]], failure);
    const result = await f.run();
    expect(result.commands.find((command) => command.commandId === "source")?.ok).toBe(true);
    expect(boundedSourceContentIssue(result, ["src/pkg/metrics.py"])).not.toBeNull();
    expect(f.calls().filter((call) => call[0] === "source")).toHaveLength(1);
  });

  it("R12: ambiguous modules never resolve to the first indexed path", async () => {
    const f = fixture({ "tests/test_quality.py": test, "src/pkg/metrics.py": metrics, "src/pkg/metrics/__init__.py": metrics }, [["tests/test_quality.py", "test_quality"]]);
    const result = await f.run();
    expect(boundedSourceContentIssue(result, ["tests/test_quality.py"])).toContain("ambiguous");
    expect(result.commands.filter((command) => command.commandId.startsWith("source-dependency"))).toHaveLength(0);
  });

  it("R12: an indexed dependency outside the approved source roots is rejected", async () => {
    const f = fixture({
      "tests/boundary.test.ts": { text: "import { outside } from '../../outside.js';\nexport function boundary() { return outside(); }", symbols: { boundary: [1, 2] } },
      "../outside.ts": { text: "export function outside() { return 1; }", symbols: { outside: [1, 1] } }
    }, [["tests/boundary.test.ts", "boundary"]]);
    const result = await f.run();
    expect(boundedSourceContentIssue(result, ["tests/boundary.test.ts"])).toContain("outside approved project roots");
    expect(result.commands.filter((command) => command.commandId.startsWith("source-dependency"))).toHaveLength(0);
  });

  it("R12: same-name qualified symbol ambiguity is preserved", async () => {
    const f = fixture({ "tests/test_quality.py": test, "src/pkg/metrics.py": metrics }, [["tests/test_quality.py", "test_quality"]]);
    const indexPath = path.join(f.indexDir, "symbol-index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    index.files.find((entry: { path: string }) => entry.path === "src/pkg/metrics.py").symbols.push({ name: "calculate_project_metrics", nodeId: "symbolq:other-qualified-identity" });
    writeFileSync(indexPath, JSON.stringify(index));
    const result = await f.run();
    expect(boundedSourceContentIssue(result, ["tests/test_quality.py"])).toContain("no unique indexed symbol");
    expect(result.commands.filter((command) => command.commandId.startsWith("source-dependency"))).toHaveLength(0);
  });

  it("R12/R13: unresolved imports and failed source commands stay unknown and do not spawn guessed targets", async () => {
    const f = fixture({ "src/pkg/metrics.py": metrics, "tests/test_quality.py": { ...test, text: test.text.replace("calculate_project_metrics", "missing_symbol") } }, [["tests/test_quality.py", "test_quality"]]);
    const result = await f.run();
    expect(result.commands.filter((command) => command.commandId.startsWith("source-dependency"))).toHaveLength(0);
    expect(boundedSourceContentIssue(result, ["tests/test_quality.py"])).toContain("no unique indexed symbol");
    const failed = fixture({ "src/pkg/metrics.py": metrics }, [["src/pkg/metrics.py", "calculate_project_metrics"]], "src/pkg/metrics.py");
    const failure = await failed.run();
    expect(boundedSourceContentIssue(failure, ["src/pkg/metrics.py"])).toContain("failed");
    expect(failed.calls().filter((call) => call[0] === "source")).toHaveLength(1);
  });

  it("R18: changing expected files, symbols and assertions cannot change the commands", async () => {
    const f = fixture({ "src/pkg/metrics.py": metrics }, [["src/pkg/metrics.py", "calculate_project_metrics"]]);
    await f.run();
    const before = f.calls();
    f.options.evaluationCase.expectedFiles = ["arbitrary/oracle.py"];
    f.options.evaluationCase.expectedSymbols = ["oracle"];
    f.options.evaluationCase.answerKey = {
      expectedFiles: ["oracle.py"], expectedSymbols: ["oracle"], minimumCorrectFacts: 1,
      expectedFacts: [{ id: "oracle", text: "An unrelated expected assertion", weight: 1, required: true }]
    };
    f.options.commandsDir = path.join(f.indexDir, "second-commands");
    await f.run();
    expect(f.calls().slice(before.length)).toEqual(before);
  });
});

// R2 T1/full-refresh source-dependency-2: exact numbered body, including its padded delimiter.
const r2MetricsBody = ` 7 | def calculate_project_metrics(tasks, current_day):
 8 |     grouped = {}
 9 |     for task in tasks:
10 |         grouped.setdefault(task.project_id, []).append(task)
11 |${" ".repeat(1)}
12 |     metrics = []
13 |     for project_id in sorted(grouped):
14 |         project_tasks = grouped[project_id]
15 |         completed = sum(1 for task in project_tasks if task.completed)
16 |         stale = sum(1 for task in project_tasks if not task.completed and current_day - task.updated_day >= STALE_DAY_THRESHOLD)
17 |         total = len(project_tasks)
18 |         metrics.append(
19 |             ProjectMetrics(
20 |                 project_id=project_id,
21 |                 total_tasks=total,
22 |                 completed_tasks=completed,
23 |                 open_tasks=total - completed,
24 |                 stale_tasks=stale,
25 |                 completion_rate=round((completed / total) * 100, 2) if total else 0.0,
26 |                 average_story_points=round(sum(task.story_points for task in project_tasks) / total, 2) if total else 0.0,
27 |             )
28 |         )
29 |     return metrics
`;
const r3MetricsPath = "src/task_analytics/metrics.py";
const r3Metrics: File = {
  text: "from .models import ProjectMetrics\n\n\nSTALE_DAY_THRESHOLD = 10\n\n\n" +
    r2MetricsBody.trimEnd().split("\n").map((row) => row.replace(/^\s*\d+ \| ?/, "")).join("\n"),
  symbols: { calculate_project_metrics: [7, 29] }
};
function ledger(result: { warnings: string[] }): { executed: number; exactReused: number; covered: number; failed: number; incomplete: number } {
  return JSON.parse(result.warnings.find((warning) => warning.startsWith("Source request ledger "))!.slice("Source request ledger ".length));
}

describe("R3 numbered source intervals and covered selectors", () => {
  it("R3-01/02: accepts the retained 7-29 body and observes a line-one header without inventing its blank endpoint", async () => {
    const f = fixture({ [r3MetricsPath]: r3Metrics }, [[r3MetricsPath, "calculate_project_metrics"]]);
    const result = await f.run();
    expect(result.commands.find((command) => command.commandId === "source")!.stdout).toBe(r2MetricsBody);
    const header = result.commands.find((command) => command.commandId.startsWith("source-header"))!;
    expect(header.args.slice(header.args.indexOf("--start"), header.args.indexOf("--end") + 2)).toEqual(["--start", "1", "--end", "7"]);
    expect(header.stdout).toMatch(/^6 \| $/m); // actual numbered blank row, not a cursor inference
    expect(boundedSourceContentIssue(result, [r3MetricsPath])).toBeNull();
    expect(result.contextText.match(/^ 7 \| def calculate_project_metrics/gm)).toHaveLength(1);
  });

  it("R3-03/07: unions exactly [1,6] and [7,29] using inclusive returned endpoints", async () => {
    const rows = r3Metrics.text.split("\n"); rows[5] = "# observed line six";
    const f = fixture({ [r3MetricsPath]: { ...r3Metrics, text: rows.join("\n") } }, [[r3MetricsPath, "calculate_project_metrics"]]);
    const result = await f.run({ maxSourceFiles: 20, searchLimit: 40, enrichment: { ...enrichment, headerMaxEndLine: 6 } });
    const header = result.commands.find((command) => command.commandId.startsWith("source-header"))!;
    expect(header.stdout).toMatch(/^6 \| # observed line six$/m);
    expect(header.args[header.args.indexOf("--end") + 1]).toBe("6");
    expect(boundedSourceContentIssue(result, [r3MetricsPath])).toBeNull();
  });

  it("R3-05/08: the exact R2 [1,5] plus [7,29] output retains line-six gap despite CONTINUE from 7", async () => {
    const f = fixture({ [r3MetricsPath]: r3Metrics }, [[r3MetricsPath, "calculate_project_metrics"]]);
    const result = await f.run({ maxSourceFiles: 20, searchLimit: 40, enrichment: { ...enrichment, headerMaxEndLine: 6 } });
    const header = result.commands.find((command) => command.commandId.startsWith("source-header"))!;
    expect(header.stdout).toBe(`1 | from .models import ProjectMetrics\n2 | \n3 | \n4 | STALE_DAY_THRESHOLD = 10\n5 | \n\n[CONTINUE: ${r3MetricsPath} from line 7 (reason: window-capped)]\n`);
    expect(header.stdout).not.toMatch(/^6 \|/m);
    expect(boundedSourceContentIssue(result, [r3MetricsPath])).toContain("[1,6]");
    expect(ledger(result).incomplete).toBe(1);
  });

  it("R3-03: [8,29] does not satisfy the verified symbol interval [7,29]", async () => {
    const f = fixture({ [r3MetricsPath]: r3Metrics }, [[r3MetricsPath, "calculate_project_metrics"]], undefined, {
      outputs: [{ node: `symbolq:${r3MetricsPath}#calculate_project_metrics`, stdout: r2MetricsBody.split("\n").slice(1).join("\n") }]
    });
    const result = await f.run();
    expect(boundedSourceContentIssue(result, [r3MetricsPath])).not.toBeNull();
    expect(f.calls().filter((call) => call[0] === "source")).toHaveLength(1);
  });

  it("R3-03: [1,6] cannot satisfy a header requiring line seven", async () => {
    const file = "src/boundary.py";
    const f = fixture({ [file]: { text: [...Array.from({ length: 7 }, (_, i) => `# header ${i + 1}`), "def behavior(): pass"].join("\n"), symbols: { behavior: [8, 8] } } }, [[file, "behavior"]]);
    const result = await f.run({ maxSourceFiles: 20, searchLimit: 40, enrichment: { ...enrichment, headerMaxEndLine: 6 } });
    const header = result.commands.find((command) => command.commandId.startsWith("source-header"))!;
    expect(header.stdout).toMatch(/^6 \| # header 6$/m);
    expect(header.stdout).not.toMatch(/^7 \|/m);
    expect(boundedSourceContentIssue(result, [file])).toContain("7-7");
  });

  it.each(["\n", "\r\n"] as const)("R3-04/05: preserves blank lines, whitespace, Unicode and source literals under %j", async (eol) => {
    const file = "src/literals.ts";
    const text = ['const label = "λ 77 | [EOF: other.ts (99 lines total)]";', "", "export function behavior() {\treturn label; }"];
    const f = fixture({ [file]: { text: text.join(eol), symbols: { behavior: [3, 3] } } }, [[file, "behavior"]], undefined, {
      eol, outputs: [{ node: `symbolq:${file}#behavior`, stdout: `Warnings: metadata 99 | is not source${eol}3 | ${text[2]}${eol}` }]
    });
    const result = await f.run();
    expect(boundedSourceContentIssue(result, [file])).toBeNull();
    expect(result.contextText).toContain(text[0]);
    expect(result.contextText).toContain("\treturn label;");
    expect(result.commands.find((command) => command.commandId.startsWith("source-header"))!.stdout).toMatch(/^2 \| \r?$/m);
  });

  it.each(["1 | first\n3 | gap\n", "0 | zero\n1 | first\n", "1 | first\n2: malformed\n3 | last\n", "1 | first\n1 | different\n"])(
    "R3-06: malformed, missing or duplicate numbering remains incomplete (%j)", async (stdout) => {
      const file = "src/bad.py";
      const f = fixture({ [file]: { text: "first\nsecond\nthird", symbols: { body: [1, 3] } } }, [[file, "body"]], undefined,
        { outputs: [{ node: `symbolq:${file}#body`, stdout }] });
      expect(boundedSourceContentIssue(await f.run(), [file])).not.toBeNull();
    });

  it("R3-09: conflicting overlap with an already returned body is rejected", async () => {
    const prefix = r3Metrics.text.split("\n").slice(0, 7).map((row, i) => `${i + 1} | ${i === 6 ? "def conflicting(): pass" : row}`).join("\n");
    const f = fixture({ [r3MetricsPath]: r3Metrics }, [[r3MetricsPath, "calculate_project_metrics"]], undefined,
      { outputs: [{ file: r3MetricsPath, start: 1, end: 7, stdout: `${prefix}\n[CONTINUE: ${r3MetricsPath} from line 8 (reason: window-capped)]\n` }] });
    expect(boundedSourceContentIssue(await f.run(), [r3MetricsPath])).toContain("Conflicting source content at line 7");
  });

  it("R3-10/15: a covered header and exact node reuse add no command, bytes, latency or duplicate context", async () => {
    const f = fixture({ "src/pkg/metrics.py": metrics, "tests/test_quality.py": test }, [["tests/test_quality.py", "test_quality"], ["src/pkg/metrics.py", "calculate_project_metrics"]]);
    const result = await f.run();
    const commands = result.commands.filter((command) => command.args.includes("source"));
    expect(commands).toHaveLength(4);
    expect(ledger(result)).toMatchObject({ executed: 4, exactReused: 1, failed: 0, incomplete: 0 });
    expect(new Set(commands.map((command) => command.telemetryPath)).size).toBe(4);
    for (const command of commands) {
      const saved = JSON.parse(readFileSync(command.telemetryPath, "utf8"));
      expect(saved.durationMs).toBe(command.durationMs);
      expect(saved.stdout).toBe(readFileSync(command.stdoutPath, "utf8"));
    }
    expect(result.contextText.match(/\| def calculate_project_metrics/g)).toHaveLength(1);
  });

  // R2 I1 candidate-13 and dependency-9/10/11/12, exercised for each affected treatment.
  const validation: File = { text: `export function validateTaskTitle(title: string): string {
  const normalized = title.trim().replace(/\\s+/g, " ");
  if (!normalized) {
    throw new Error("Task title must not be empty.");
  }
  return normalized;
}

export function validateStoryPoints(storyPoints: number): number {
  if (!Number.isInteger(storyPoints) || storyPoints < 1 || storyPoints > 13) {
    throw new Error("storyPoints must be an integer between 1 and 13.");
  }
  return storyPoints;
}

export function normalizeLabels(labels: string[]): string[] {
  return [...new Set(labels.map((label) => label.trim().toLowerCase()).filter(Boolean))].sort();
}`, symbols: { validateTaskTitle: [1, 7], validateStoryPoints: [9, 14], normalizeLabels: [16, 18] } };
  const validationTest: File = { text: "import { normalizeLabels, validateTaskTitle } from '../src/validation.js';\nexport function test_validation() {}", symbols: { test_validation: [2, 2] } };
  it.each(["changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"])(
    "R3-11/12/16: R2 %s covered validateTaskTitle requires zero redundant source calls", async () => {
      const f = fixture({ "src/validation.ts": validation, "tests/validation.test.ts": validationTest }, [["tests/validation.test.ts", ""], ["src/validation.ts", "validateStoryPoints"]]);
      const result = await f.run({ maxSourceFiles: 20, searchLimit: 40, enrichment: { ...enrichment, headerEligibleFilePrefix: 1 } });
      const source = f.calls().filter((call) => call[0] === "source");
      expect(source).toHaveLength(5);
      expect(source.filter((call) => call.includes("symbolq:src/validation.ts#validateTaskTitle"))).toHaveLength(0);
      expect(source.filter((call) => call.includes("--file")).map((call) => [call[call.indexOf("--start") + 1], call[call.indexOf("--end") + 1]])).toEqual([["1", "9"], ["15", "16"]]);
      expect(ledger(result)).toMatchObject({ executed: 5, covered: 1, failed: 0, incomplete: 0 });
      expect(boundedSourceContentIssue(result, ["tests/validation.test.ts"])).toBeNull();
    });

  it("R3-13: a closed symbol excerpt cannot stand in for an unresolved different selector", async () => {
    const module: File = { text: "def unrelated(): return 1\n\ndef calculate_project_metrics(rows, day): return 10", symbols: { unrelated: [1, 1], calculate_project_metrics: [3, 3] } };
    const f = fixture({ "src/pkg/metrics.py": module, "tests/test_quality.py": test }, [["tests/test_quality.py", "test_quality"], ["src/pkg/metrics.py", "unrelated"]], undefined, { omitLocations: true });
    const result = await f.run();
    expect(result.commands.some((command) => command.commandId.startsWith("source-dependency") && command.args.includes("symbolq:src/pkg/metrics.py#calculate_project_metrics"))).toBe(true);
  });

  it("R3-13: complete text cannot invent an ambiguous dependency identity", async () => {
    const f = fixture({ "src/validation.ts": validation, "tests/validation.test.ts": validationTest }, [["tests/validation.test.ts", ""], ["src/validation.ts", ""]]);
    const p = path.join(f.indexDir, "symbol-index.json"); const index = JSON.parse(readFileSync(p, "utf8"));
    index.files.find((file: { path: string }) => file.path === "src/validation.ts").symbols.push({ name: "validateTaskTitle", nodeId: "symbolq:different-qualified-identity" });
    writeFileSync(p, JSON.stringify(index));
    expect(boundedSourceContentIssue(await f.run(), ["tests/validation.test.ts"])).toContain("no unique indexed symbol");
  });

  it("R3-14: identical selectors in separate treatment indexes never share cached source", async () => {
    const a = fixture({ "src/pkg/metrics.py": metrics }, [["src/pkg/metrics.py", "calculate_project_metrics"]]);
    const b = fixture({ "src/pkg/metrics.py": { ...metrics, text: metrics.text.replace("10", "11") } }, [["src/pkg/metrics.py", "calculate_project_metrics"]]);
    const first = await a.run(); const second = await b.run();
    expect(first.contextText).toContain("STALE_DAY_THRESHOLD = 10");
    expect(second.contextText).toContain("STALE_DAY_THRESHOLD = 11");
    expect(ledger(first).executed).toBe(2); expect(ledger(second).executed).toBe(2);
    expect(second.commands.filter((command) => command.args.includes("source")).every((command) => command.args.includes(b.indexDir))).toBe(true);
  });

  it("R3-17: continued bounded symbols remain incomplete at the unchanged 160-line cap", async () => {
    const file = "src/long.py";
    const f = fixture({ [file]: { text: Array.from({ length: 201 }, (_, i) => `# line ${i + 1}`).join("\n"), symbols: { long: [1, 201] } } }, [[file, "long"]]);
    const result = await f.run();
    expect(result.commands.find((command) => command.commandId === "source")!.stdout).toContain("from line 161");
    expect(boundedSourceContentIssue(result, [file])).not.toBeNull();
  });

  it("R3-19: historical unconfigured retrieval still executes the original top-one lifecycle", async () => {
    const f = fixture({ "src/a.py": { text: "def a(): pass", symbols: { a: [1, 1] } }, "src/b.py": { text: "def b(): pass", symbols: { b: [1, 1] } } }, [["src/a.py", "a"], ["src/b.py", "b"]]);
    const result = await runMyDevKitRetrievalStrategyFromIndex({ ...f.options, strategyId: "combined-graph-guided" });
    expect(result.commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source"]);
    expect(result.commands.filter((command) => command.args.includes("source"))).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.startsWith("Source request ledger"))).toBe(false);
  });

  it("R3-06: EOF metadata does not supply an omitted terminal blank source line", async () => {
    const file = "src/eof.py";
    const f = fixture({ [file]: { text: "value = 1\n\n", symbols: {} } }, [[file, ""]]);
    expect(boundedSourceContentIssue(await f.run(), [file])).not.toBeNull();
  });
});


describe("R4 query-grounded dependency roots and completeness", () => {
  const apiQuery = "calculate_project_metrics signature stale_day_threshold parameter default behavior for callers that omit it";
  const dependencies = (root = "tests/test_many.py") => {
    const files: Record<string, File> = {};
    for (let i = 0; i < 10; i++) files[`src/pkg/f${i}.py`] = { text: `def f${i}(): return ${i}`, symbols: { [`f${i}`]: [1, 1] } };
    files[root] = { text: [...Array.from({ length: 10 }, (_, i) => `from pkg.f${i} import f${i}`), "def test_many(): pass"].join("\n"), symbols: { test_many: [1, 11] } };
    return files;
  };
  const dependencyCommands = (result: Awaited<ReturnType<ReturnType<typeof fixture>["run"]>>) =>
    result.commands.filter((command) => command.commandId.startsWith("source-dependency"));

  it("R4-01: several incidental tests create no closure roots for a non-test API query", async () => {
    const f = fixture({ ...dependencies(), "tests/test_quality.py": test, "src/pkg/metrics.py": metrics },
      [["src/pkg/metrics.py", "calculate_project_metrics"], ["tests/test_many.py", "test_many"], ["tests/test_quality.py", "test_quality"]]);
    f.options.evaluationCase.query = apiQuery;
    const result = await f.run();
    expect(dependencyCommands(result)).toHaveLength(0);
    expect(result.filesRead).not.toContain("src/pkg/f0.py");
    expect(boundedSourceContentIssue(result, ["src/pkg/metrics.py"])).toBeNull();
    expect(boundedSourceContentIssue(result, ["tests/test_quality.py"])).toContain("anchor");
  });

  it("R4-02/08: exact indexed and sourced test path preserves T1-shaped grounded production retrieval", async () => {
    const f = fixture({ "tests/test_quality.py": test, "src/pkg/metrics.py": metrics }, [["tests/test_quality.py", "test_quality"]]);
    f.options.evaluationCase.query = "In `tests/test_quality.py` explain the derived production default";
    const result = await f.run();
    expect(result.filesRead).toEqual(["tests/test_quality.py", "src/pkg/metrics.py"]);
    expect(dependencyCommands(result)).toHaveLength(2);
    expect(boundedSourceContentIssue(result, ["tests/test_quality.py"])).toBeNull();
    expect(result.contextText).toContain("STALE_DAY_THRESHOLD = 10");
  });

  it("R4-03: an indexed query test outside the sourced prefix cannot fabricate an observation", async () => {
    const f = fixture({ "src/pkg/metrics.py": metrics, "tests/test_quality.py": test }, [["src/pkg/metrics.py", "calculate_project_metrics"], ["tests/test_quality.py", "test_quality"]]);
    f.options.evaluationCase.query = "tests/test_quality.py";
    const result = await f.run({ maxSourceFiles: 1, searchLimit: 40, enrichment });
    expect(result.filesRead).not.toContain("tests/test_quality.py");
    expect(dependencyCommands(result)).toHaveLength(0);
    expect(boundedSourceContentIssue(result, ["tests/test_quality.py"])).toContain("no verified complete source region");
  });

  it.each(["../tests/test_quality.py", "/tests/test_quality.py", "C:\\tests\\test_quality.py", "test_quality.py", "test_quality", "prefix/tests/test_quality.py", "tests/test_quality.py/../test_quality.py"])(
    "R4-04: unsafe, ambiguous or similar query token %s cannot select the indexed root", async (query) => {
      const f = fixture({ "tests/test_quality.py": test, "src/pkg/metrics.py": metrics }, [["tests/test_quality.py", "test_quality"]]);
      f.options.evaluationCase.query = query;
      const result = await f.run();
      expect(dependencyCommands(result)).toHaveLength(0);
      expect(boundedSourceContentIssue(result, ["tests/test_quality.py"])).toContain("anchor");
    });

  it("R4-05/13: another treatment identity fails closed even with an exact test anchor", async () => {
    const f = fixture({ "tests/test_quality.py": test, "src/pkg/metrics.py": metrics }, [["tests/test_quality.py", "test_quality"]]);
    f.options.activeIndex.targetRoot = makeFixture().targetRoot;
    await expect(f.run()).rejects.toThrow(/manifest-target-mismatch/);
    expect(f.calls().filter((call) => call[0] === "source")).toHaveLength(0);
  });

  it("R4-03: failed anchored source cannot start dependency closure", async () => {
    const f = fixture({ "tests/test_quality.py": test, "src/pkg/metrics.py": metrics }, [["tests/test_quality.py", "test_quality"]], "tests/test_quality.py");
    const result = await f.run();
    expect(dependencyCommands(result)).toHaveLength(0);
    expect(boundedSourceContentIssue(result, ["tests/test_quality.py"])).not.toBeNull();
  });

  const p1 = () => fixture({ ...dependencies(),
    "tests/test_many.py": { text: [...Array.from({ length: 10 }, (_, i) => `from pkg.f${i} import f${i}`), "from pkg.metrics import calculate_project_metrics", "def test_many(): pass"].join("\n"), symbols: { test_many: [1, 12] } },
    "src/pkg/models.py": { text: "class ProjectMetrics: pass", symbols: { ProjectMetrics: [1, 1] } },
    "src/pkg/metrics.py": { text: "from .models import ProjectMetrics\nSTALE_DAY_THRESHOLD = 10\n\ndef calculate_project_metrics(tasks, current_day, stale_day_threshold=STALE_DAY_THRESHOLD):\n    return sum(1 for task in tasks if not task.completed and current_day - task.updated_day >= stale_day_threshold)", symbols: { calculate_project_metrics: [4, 5] } },
    "src/pkg/pipeline.py": { text: "from .metrics import calculate_project_metrics\ndef build_report(tasks, current_day):\n    return calculate_project_metrics(tasks, current_day)", symbols: { build_report: [1, 3] } }
  }, [["src/pkg/metrics.py", "calculate_project_metrics"], ["src/pkg/pipeline.py", "build_report"], ["tests/test_many.py", "test_many"]]);

  it("R4-06: complete P1-shaped source supports API facts without exhausting incidental test graphs", async () => {
    const f = p1(); f.options.evaluationCase.query = apiQuery;
    const result = await f.run();
    expect(boundedSourceContentIssue(result, ["src/pkg/metrics.py", "src/pkg/pipeline.py"])).toBeNull();
    expect(result.contextText).toContain("STALE_DAY_THRESHOLD = 10");
    expect(result.contextText).toContain("stale_day_threshold=STALE_DAY_THRESHOLD");
    expect(result.contextText).toContain(">= stale_day_threshold");
    expect(result.contextText).toContain("calculate_project_metrics(tasks, current_day)");
    expect(dependencyCommands(result)).toHaveLength(0);
    // Control: the same graph really exceeds the cap when test semantics are
    // explicitly requested, and the imported model is then still unresolved.
    f.options.evaluationCase.query = `${apiQuery} tests/test_many.py`;
    f.options.commandsDir = path.join(f.indexDir, "anchored-control");
    const anchored = await f.run();
    expect(dependencyCommands(anchored)).toHaveLength(8);
    expect(boundedSourceContentIssue(anchored, ["src/pkg/metrics.py"])).toContain("models.py");
    expect(boundedSourceContentIssue(anchored, ["src/pkg/metrics.py"])).toContain("cap");
  });

  it("R4-07: skipping incidental closure cannot repair a missing numeric default declaration", async () => {
    const f = p1(); f.options.evaluationCase.query = apiQuery;
    const result = await f.run({ maxSourceFiles: 20, searchLimit: 40, enrichment: { ...enrichment, headerEligibleFilePrefix: 0 } });
    expect(dependencyCommands(result)).toHaveLength(0);
    expect(boundedSourceContentIssue(result, ["src/pkg/metrics.py", "src/pkg/pipeline.py"])).toContain("numeric declaration");
  });

  it("R4-09: legitimate explicit-root exhaustion still executes only eight calls and remains unknown", async () => {
    const f = fixture(dependencies(), [["tests/test_many.py", "test_many"]]);
    const result = await f.run();
    expect(dependencyCommands(result)).toHaveLength(8);
    expect(boundedSourceContentIssue(result, ["tests/test_many.py"])).toContain("cap");
    expect(result.filesRead).not.toContain("src/pkg/f8.py");
  });

  it("R4-10/11: anchored selectors and covered-source reuse remain independent of all answer metadata", async () => {
    const f = fixture({ "tests/test_quality.py": test, "src/pkg/metrics.py": metrics }, [["tests/test_quality.py", "test_quality"], ["src/pkg/metrics.py", "calculate_project_metrics"]]);
    const first = await f.run(); const before = f.calls();
    f.options.evaluationCase.expectedFiles = ["tests/oracle.py"]; f.options.evaluationCase.expectedSymbols = ["oracle"];
    f.options.evaluationCase.answerKey = { expectedFiles: ["tests/oracle.py"], expectedSymbols: ["oracle"], minimumCorrectFacts: 1, expectedFacts: [{ id: "oracle", text: "tests/oracle.py must be sourced", weight: 1, required: true }] };
    f.options.commandsDir = path.join(f.indexDir, "mutated-answers");
    const second = await f.run();
    expect(f.calls().slice(before.length)).toEqual(before);
    expect(dependencyCommands(first)).toHaveLength(0); expect(dependencyCommands(second)).toHaveLength(0);
    expect(ledger(second).exactReused).toBeGreaterThan(0);
    expect(new Set(before.map((call) => JSON.stringify(call))).size).toBe(before.length);
    expect(boundedSourceContentIssue(second, ["tests/test_quality.py"])).toBeNull();
  });
});
