import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadLocalRepositorySubject } from "../../../src/evaluation/localRepositorySubject/index.js";
import type { LocalRepositorySubject } from "../../../src/evaluation/localRepositorySubject/index.js";
import {
  commitAll,
  git,
  initRepository,
  makeTempDir,
  minimalCase,
  minimalConfig,
  tryCreateSymlink,
  writeRepositoryFile,
} from "../../evaluation/localRepositorySubject/fixtureRepository.js";

export { git, makeTempDir, minimalCase, minimalConfig, writeRepositoryFile };

export const MARKERS = {
  eligible: "ELIGIBLE_MARKER_7f3a",
  ignoredFile: "IGNORED_FILE_MARKER_91bc",
  ignoredDirectory: "IGNORED_DIR_MARKER_3d2e",
  oversized: "OVERSIZED_MARKER_55aa",
  symlinkTarget: "SYMLINK_TARGET_MARKER_c0de",
} as const;

/** Small enough that a compact fixture file can exceed it. */
export const FIXTURE_MAX_FILE_BYTES = 400;

export type LocalSubjectFixture = {
  root: string;
  outside: string;
  workRoot: string;
  subject: LocalRepositorySubject;
  symlinkCreated: boolean;
  directories: string[];
};

/** Lists every file path below a directory (relative, forward-slash, sorted), for before/after tree comparisons. */
export function listTree(directory: string): string[] {
  const results: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.name === ".git") continue;
      if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
      else results.push(relative);
    }
  };
  walk(directory, "");
  return results.sort();
}

export function readFixtureFile(root: string, relativePath: string): string {
  return readFileSync(path.join(root, ...relativePath.split("/")), "utf8");
}

/**
 * Creates a disposable Git repository, loads it through Batch 1, and returns the runtime subject plus separate
 * temporary directories for the Lab work root and an outside file used as a symlink target.
 */
export async function createLocalSubjectFixture(
  options: { cases?: Record<string, unknown>[]; extraFiles?: Record<string, string>; hugeFileBytes?: number } = {}
): Promise<LocalSubjectFixture> {
  const root = makeTempDir("lrs-b2-repo-");
  const outside = makeTempDir("lrs-b2-outside-");
  const workRoot = path.join(makeTempDir("lrs-b2-work-"), "lab");
  initRepository(root);
  writeRepositoryFile(root, ".gitignore", "src/ignored.ts\nsrc/gen/\n");
  writeRepositoryFile(root, "src/main.ts", `export const value = 1; // ${MARKERS.eligible}\n`);
  writeRepositoryFile(root, "src/util/helper.ts", "export const helper = 2;\n");
  writeRepositoryFile(root, "src/huge.ts", `// ${MARKERS.oversized}\n${"x".repeat(options.hugeFileBytes ?? FIXTURE_MAX_FILE_BYTES + 100)}\n`);
  for (const [relativePath, content] of Object.entries(options.extraFiles ?? {})) {
    writeRepositoryFile(root, relativePath, content);
  }
  commitAll(root, "fixture");
  writeRepositoryFile(root, "src/ignored.ts", `export const ignored = 1; // ${MARKERS.ignoredFile}\n`);
  writeRepositoryFile(root, "src/gen/out.ts", `export const generated = 1; // ${MARKERS.ignoredDirectory}\n`);
  writeFileSync(path.join(outside, "secret.ts"), `export const secret = 1; // ${MARKERS.symlinkTarget}\n`);
  const link = tryCreateSymlink(path.join(outside, "secret.ts"), path.join(root, "src", "linked.ts"), "file");

  const config = minimalConfig({
    cases: options.cases ?? [minimalCase({ rawIncludeGlobs: ["src/**/*"], expectedFiles: ["src/main.ts"] })],
  });
  const subject = await loadLocalRepositorySubject({ config, repositoryPath: root, maxFileBytes: FIXTURE_MAX_FILE_BYTES });
  return { root, outside, workRoot, subject, symlinkCreated: link.ok, directories: [root, outside, path.dirname(workRoot)] };
}

/**
 * Writes a deterministic, offline stand-in for the my-dev-kit CLI. It appends each invocation (argv and cwd) to
 * LRS_FAKE_KIT_LOG when set and answers search with LRS_FAKE_KIT_FILE (default src/main.ts).
 */
export function writeRecordingFakeKit(directory: string): { command: string; script: string } {
  mkdirSync(directory, { recursive: true });
  const script = path.join(directory, "fake-kit.mjs");
  writeFileSync(
    script,
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      "const argv = process.argv.slice(2);",
      "const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };",
      "if (process.env.LRS_FAKE_KIT_LOG) fs.appendFileSync(process.env.LRS_FAKE_KIT_LOG, JSON.stringify({ argv, cwd: process.cwd() }) + '\\n');",
      "if (process.env.LRS_FAKE_KIT_MUTATE && argv[0] === 'index') fs.appendFileSync(process.env.LRS_FAKE_KIT_MUTATE, 'mutated-by-kit\\n');",
      "const command = argv[0];",
      'if (command === "index") {',
      '  const out = value("--out");',
      "  fs.mkdirSync(out, { recursive: true });",
      '  fs.writeFileSync(path.join(out, "manifest.json"), "{}");',
      "  console.log(JSON.stringify({ ok: true }));",
      '} else if (command === "search") {',
      '  const file = process.env.LRS_FAKE_KIT_FILE || "src/main.ts";',
      '  console.log(JSON.stringify({ results: [{ nodeId: "symbol:" + file + "#value", file, symbol: "value" }] }));',
      '} else if (command === "lookup" || command === "slice") {',
      '  console.log(JSON.stringify({ node: value("--node") }));',
      '} else if (command === "source") {',
      '  console.log("1 export const value = 1;");',
      "} else {",
      '  process.stderr.write("unsupported fake command");',
      "  process.exit(1);",
      "}",
      "",
    ].join("\n"),
    "utf8"
  );
  chmodSync(script, 0o644);
  return { command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`, script };
}

export function readKitLog(logPath: string): { argv: string[]; cwd: string }[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { argv: string[]; cwd: string });
  } catch {
    return [];
  }
}
