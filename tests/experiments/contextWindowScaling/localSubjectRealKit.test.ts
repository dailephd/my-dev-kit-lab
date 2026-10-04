import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMyDevKitIndex } from "../../../src/evaluation/runMyDevKitRetrieval.js";
import { executeLocalRepositorySubjectContextWindowScaling } from "../../../src/experiments/plugins/contextWindowScaling/localSubjectExecution.js";
import { removeTempDir } from "../../evaluation/localRepositorySubject/fixtureRepository.js";
import { createLocalSubjectFixture, listTree, makeTempDir } from "./localSubjectFixture.js";
import type { LocalSubjectFixture } from "./localSubjectFixture.js";

/**
 * Opt-in integration with the real published my-dev-kit CLI (needs the package to be installed or fetchable, so it is
 * not part of the offline default suite). Run with: LAB_REAL_MY_DEV_KIT=1 npx vitest run <this file>
 * Override the command with LAB_REAL_MY_DEV_KIT_COMMAND (default: npx @dailephd/my-dev-kit@latest).
 */
const enabled = Boolean(process.env.LAB_REAL_MY_DEV_KIT);
const kitCommand = process.env.LAB_REAL_MY_DEV_KIT_COMMAND || "npx @dailephd/my-dev-kit@latest";
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let fixture: LocalSubjectFixture;
let scratchArea: string;
beforeEach(async () => {
  if (!enabled) return;
  fixture = await createLocalSubjectFixture();
  scratchArea = makeTempDir("lrs-real-kit-");
});
afterEach(() => {
  if (!enabled) return;
  for (const directory of [...fixture.directories, scratchArea]) removeTempDir(directory);
});

function indexedPaths(directory: string): string[] {
  const indexFile = listTree(directory).find((entry) => entry.endsWith("symbol-index.json"));
  if (!indexFile) throw new Error("no symbol-index.json was produced");
  const parsed = JSON.parse(readFileSync(path.join(directory, ...indexFile.split("/")), "utf8")) as { files: { path: string }[] };
  return parsed.files.map((file) => file.path).sort();
}

describe.skipIf(!enabled)("RSP-006 real my-dev-kit respects the Batch 1 safety universe", () => {
  it("control: without exclusions the real index would include the ignored and oversized files", async () => {
    const indexDir = path.join(scratchArea, "control-index");
    const result = await buildMyDevKitIndex({
      target: fixture.subject.evaluationCases[0],
      kitCommand,
      indexDir,
      commandsDir: path.join(scratchArea, "control-commands"),
      requireKit: true,
    });
    expect(result.ok).toBe(true);
    const paths = indexedPaths(indexDir);
    expect(paths).toEqual(expect.arrayContaining(["src/main.ts", "src/util/helper.ts", "src/ignored.ts", "src/huge.ts"]));
  });

  it("with the derived exclusions the real index lists only eligible files and execution succeeds", async () => {
    let inspected: string[] = [];
    const result = await executeLocalRepositorySubjectContextWindowScaling({
      subject: fixture.subject,
      contextBudgets: [100_000],
      kitCommand,
      workRoot: fixture.workRoot,
      scratchIo: {
        removeDirectory: async (directory) => {
          inspected = indexedPaths(directory);
          rmSync(directory, { recursive: true, force: true });
        },
      },
    });
    expect(inspected).toEqual(["src/main.ts", "src/util/helper.ts"]);
    for (const excluded of ["src/ignored.ts", "src/gen/out.ts", "src/huge.ts", "src/linked.ts"]) {
      expect(inspected).not.toContain(excluded);
    }
    const guided = result.caseEvidence[0].treatments.find((treatment) => treatment.variantId !== "raw-full-file");
    expect(guided?.errors).toEqual([]);
    for (const file of guided?.context.observedFiles ?? []) {
      expect(fixture.subject.eligibleFiles).toContain(file);
    }
    expect(result.immutability.status).toBe("unchanged");
  });
});
