import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MeasuredCommandResult } from "../../src/core/runMeasuredCommand.js";
import { captureIndexSnapshot } from "../../src/evaluation/indexSnapshot.js";

const tempDirs: string[] = [];

/** Register with `afterEach(cleanupTempDirs)` in each test file that uses `makeFixture`. */
export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

export const command = {
  commandId: "index",
  commandString: "node fake-kit.js",
  executable: "node",
  args: ["fake-kit.js", "index", "--json"],
  cwd: ".",
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: "2026-01-01T00:00:01.000Z",
  durationMs: 1000,
  exitCode: 0,
  stdout: "SECRET-STDOUT-BODY",
  stderr: "SECRET-STDERR-BODY",
  stdoutPath: "stdout.txt",
  stderrPath: "stderr.txt",
  telemetryPath: "telemetry.json",
  ok: true,
} satisfies MeasuredCommandResult;

export type Fixture = { targetRoot: string; indexDir: string; sourceRoots: string[] };

/** A temporary target with a few source files and an empty index directory. */
export function makeFixture(files: Record<string, string> = {}): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "index-snapshot-"));
  tempDirs.push(root);
  const targetRoot = path.join(root, "target");
  const indexDir = path.join(root, "index");
  mkdirSync(indexDir, { recursive: true });
  const defaults: Record<string, string> = {
    "src/a.ts": "export const a = 1;\n",
    "src/nested/b.ts": "export const b = 2;\n",
    "tests/a.test.ts": "import '../src/a.js';\n",
    ...files,
  };
  for (const [relative, content] of Object.entries(defaults)) {
    const absolute = path.join(targetRoot, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return { targetRoot, indexDir, sourceRoots: ["src", "tests"] };
}

/** Writes a real-shaped my-dev-kit manifest and symbol index listing exactly `listed`. */
export function writeIndex(
  fixture: Fixture,
  listed: string[],
  overrides: { manifest?: Record<string, unknown>; symbolIndex?: Record<string, unknown> } = {}
): void {
  writeFileSync(
    path.join(fixture.indexDir, "symbol-index.json"),
    JSON.stringify({
      schemaVersion: "2",
      fileCount: listed.length,
      files: listed.map((p) => ({ path: p, language: "typescript" })),
      ...overrides.symbolIndex,
    })
  );
  writeFileSync(
    path.join(fixture.indexDir, "manifest.json"),
    JSON.stringify({
      artifactKind: "my-dev-kit-v1-manifest",
      version: "1.0.0",
      createdAt: "2026-01-01T00:00:00.000Z",
      projectRoot: fixture.targetRoot.replace(/\\/g, "/"),
      sourceRoots: fixture.sourceRoots,
      artifacts: { symbolIndex: "symbol-index.json" },
      summary: { fileCount: listed.length },
      ...overrides.manifest,
    })
  );
}

export const capture = (fixture: Fixture) =>
  captureIndexSnapshot({ indexDir: fixture.indexDir, targetRoot: fixture.targetRoot, sourceRoots: fixture.sourceRoots, command });
