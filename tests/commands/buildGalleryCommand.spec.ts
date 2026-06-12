import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBuildGalleryCommand } from "../../src/commands/buildGalleryCommand.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("buildGalleryCommand", () => {
  it("writes gallery manifest and index", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "build-gallery-"));
    tempDirs.push(root);
    const reportDir = path.join(root, "report");
    await mkdir(reportDir, { recursive: true });
    await writeFile(path.join(reportDir, "experiment-report.html"), "<html></html>");
    await writeFile(path.join(reportDir, "experiment-report.json"), "{}");
    const outDir = path.join(root, "gallery");
    expect(await runBuildGalleryCommand(["--report", reportDir, "--out", outDir])).toBe(0);
    expect(existsSync(path.join(outDir, "gallery-manifest.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "gallery-index.html"))).toBe(true);
  });
});
