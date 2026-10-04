import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRawFullFileBaseline } from "../../src/evaluation/runRawFullFileBaseline.js";
import { removeTempDir, tryCreateSymlink } from "./localRepositorySubject/fixtureRepository.js";
import { MARKERS, createLocalSubjectFixture, writeRepositoryFile } from "../experiments/contextWindowScaling/localSubjectFixture.js";
import type { LocalSubjectFixture } from "../experiments/contextWindowScaling/localSubjectFixture.js";

let fixture: LocalSubjectFixture;
beforeEach(async () => {
  fixture = await createLocalSubjectFixture();
});
afterEach(() => {
  for (const directory of fixture.directories) removeTempDir(directory);
});

function caseWithGlobs(rawIncludeGlobs: string[]) {
  return { ...fixture.subject.evaluationCases[0], rawIncludeGlobs };
}

describe("RSP-001 local raw context is built only from eligible files", () => {
  it("contains eligible content and none of the ignored, oversized, symlink-target or left-out markers", async () => {
    writeRepositoryFile(fixture.root, "src/left-out.ts", "export const leftOut = 1; // LEFT_OUT_MARKER_00aa\n");
    for (const globs of [["src/**/*"], ["**/*"], ["src/**/*", "src/ignored.ts", "src/huge.ts", "src/linked.ts", "src/gen/out.ts"]]) {
      const result = await runRawFullFileBaseline(caseWithGlobs(globs), { eligibleFiles: fixture.subject.eligibleFiles });
      expect(result.contextText).toContain(MARKERS.eligible);
      for (const forbidden of [MARKERS.ignoredFile, MARKERS.ignoredDirectory, MARKERS.oversized, MARKERS.symlinkTarget, "LEFT_OUT_MARKER_00aa"]) {
        expect(result.contextText, `${forbidden} via ${JSON.stringify(globs)}`).not.toContain(forbidden);
      }
      expect(result.filesIncluded).toEqual(["src/main.ts", "src/util/helper.ts"]);
      expect(result.totalFiles).toBe(2);
    }
  });

  it("matches the globs against the supplied list instead of discovering files", async () => {
    const result = await runRawFullFileBaseline(caseWithGlobs(["src/**/*"]), { eligibleFiles: ["src/main.ts"] });
    expect(result.filesIncluded).toEqual(["src/main.ts"]);
    expect(result.contextText).not.toContain("helper");
    const empty = await runRawFullFileBaseline(caseWithGlobs(["src/**/*"]), { eligibleFiles: [] });
    expect(empty.filesIncluded).toEqual([]);
    expect(empty.contextText).toBe("");
  });

  it("orders files deterministically and builds the same context text format", async () => {
    const first = await runRawFullFileBaseline(caseWithGlobs(["src/**/*"]), { eligibleFiles: [...fixture.subject.eligibleFiles].reverse() });
    const second = await runRawFullFileBaseline(caseWithGlobs(["src/**/*"]), { eligibleFiles: fixture.subject.eligibleFiles });
    expect(first.filesIncluded).toEqual(second.filesIncluded);
    expect(first.contextText).toBe(second.contextText);
    expect(first.contextText.startsWith("=== FILE: src/main.ts ===\n")).toBe(true);
  });
});

describe("RSP-003 legacy behavior is unchanged and swapped files are refused", () => {
  it("without the option keeps the walking behavior (it does include ignored and oversized files)", async () => {
    const result = await runRawFullFileBaseline(caseWithGlobs(["src/**/*"]));
    // This is exactly why local subjects must pass eligibleFiles: the legacy path is not ignore- or size-aware.
    expect(result.contextText).toContain(MARKERS.ignoredFile);
    expect(result.contextText).toContain(MARKERS.oversized);
    expect(result.filesIncluded).toEqual(expect.arrayContaining(["src/ignored.ts", "src/huge.ts", "src/main.ts"]));
  });

  it("refuses an eligible file that has been removed since the inventory", async () => {
    rmSync(path.join(fixture.root, "src", "main.ts"));
    await expect(runRawFullFileBaseline(caseWithGlobs(["src/**/*"]), { eligibleFiles: fixture.subject.eligibleFiles })).rejects.toThrow(
      "Eligible file is no longer a regular file: src/main.ts"
    );
  });

  it("refuses an eligible file that has been replaced by a symlink and never reads the target", async () => {
    rmSync(path.join(fixture.root, "src", "main.ts"));
    const link = tryCreateSymlink(path.join(fixture.outside, "secret.ts"), path.join(fixture.root, "src", "main.ts"), "file");
    if (!link.ok) {
      console.warn(`skipping: ${link.reason}`);
      return;
    }
    const attempt = runRawFullFileBaseline(caseWithGlobs(["src/**/*"]), { eligibleFiles: fixture.subject.eligibleFiles });
    await expect(attempt).rejects.toThrow("Eligible file is no longer a regular file: src/main.ts");
    await attempt.catch((error: Error) => expect(error.message).not.toContain(MARKERS.symlinkTarget));
  });

  it("refuses a swapped directory in place of a file", async () => {
    rmSync(path.join(fixture.root, "src", "util", "helper.ts"));
    mkdirSync(path.join(fixture.root, "src", "util", "helper.ts"));
    await expect(runRawFullFileBaseline(caseWithGlobs(["src/**/*"]), { eligibleFiles: fixture.subject.eligibleFiles })).rejects.toThrow(
      "src/util/helper.ts"
    );
  });
});
