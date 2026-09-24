import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffSnapshots,
  findExactlyOneTarball,
  missingRequiredTarballPaths,
  validateManifestRelativePaths,
  validatePlaywrightRuntimeDependency,
  validateWarmIndexCampaignGalleryManifest,
  snapshotDirectory,
  validateInstalledPackageIdentity
} from "../../scripts/verifyPackedPackageHelpers.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("findExactlyOneTarball", () => {
  it("returns the single .tgz filename", () => {
    expect(findExactlyOneTarball(["README.md", "dailephd-my-dev-kit-lab-0.4.5.tgz"])).toBe(
      "dailephd-my-dev-kit-lab-0.4.5.tgz"
    );
  });

  it("throws when no .tgz is present", () => {
    expect(() => findExactlyOneTarball(["README.md"])).toThrow(/no \.tgz/);
  });

  it("throws when more than one .tgz is present", () => {
    expect(() => findExactlyOneTarball(["a.tgz", "b.tgz"])).toThrow(/expected exactly one/i);
  });
});

describe("validateInstalledPackageIdentity", () => {
  const expected = {
    name: "@dailephd/my-dev-kit-lab",
    version: "0.4.5",
    enginesNode: ">=24",
    binName: "my-dev-kit-lab",
    binTarget: "dist/scripts/cli.js"
  };

  it("returns no problems for a matching identity", () => {
    const installed = {
      name: "@dailephd/my-dev-kit-lab",
      version: "0.4.5",
      engines: { node: ">=24" },
      bin: { "my-dev-kit-lab": "dist/scripts/cli.js" }
    };
    expect(validateInstalledPackageIdentity(installed, expected)).toEqual([]);
  });

  it("reports each mismatched field", () => {
    const installed = {
      name: "wrong-name",
      version: "0.0.0",
      engines: { node: ">=20" },
      bin: { "my-dev-kit-lab": "dist/scripts/run-final-demo.js" }
    };
    const problems = validateInstalledPackageIdentity(installed, expected);
    expect(problems).toHaveLength(4);
    expect(problems.some((p: string) => p.includes("name mismatch"))).toBe(true);
    expect(problems.some((p: string) => p.includes("version mismatch"))).toBe(true);
    expect(problems.some((p: string) => p.includes("engines.node mismatch"))).toBe(true);
    expect(problems.some((p: string) => p.includes("bin.my-dev-kit-lab mismatch"))).toBe(true);
  });
});

describe("packed tutorial package helpers", () => {
  it("requires the exact runtime Playwright dependency", () => {
    expect(validatePlaywrightRuntimeDependency({ dependencies: { playwright: "1.60.0" } }, "1.60.0")).toEqual([]);
    expect(validatePlaywrightRuntimeDependency({ devDependencies: { playwright: "1.60.0" } }, "1.60.0")).toHaveLength(2);
  });

  it("finds missing required tarball resources", () => {
    expect(missingRequiredTarballPaths(["package.json", "examples/tutorial-browser/index.html"], ["package.json", "examples/tutorial-browser/index.html", "dist/src/tutorial/runTutorial.js"])).toEqual([
      "dist/src/tutorial/runTutorial.js"
    ]);
  });

  it("rejects absolute, escaped, and Windows manifest paths", () => {
    expect(validateManifestRelativePaths({ artifacts: [{ path: "artifacts/tutorial.webm" }] })).toEqual([]);
    expect(validateManifestRelativePaths({ artifacts: [{ path: "C:/bad.webm" }, { path: "../bad.webm" }, { path: "artifacts\\bad.webm" }] })).toHaveLength(3);
  });
});

describe("validateWarmIndexCampaignGalleryManifest", () => {
  function galleryItem(overrides: Record<string, unknown> = {}) {
    return {
      id: "warm-index-campaign-report",
      htmlPath: "../report.html",
      summaryPath: "../report.json",
      artifactPaths: ["../report.txt"],
      ...overrides
    };
  }

  it("accepts exactly the three expected ids with bounded relative paths", () => {
    expect(
      validateWarmIndexCampaignGalleryManifest({
        items: [
          galleryItem({ screenshotPath: "../report.png" }),
          galleryItem({
            id: "warm-index-campaign-plots",
            htmlPath: "",
            summaryPath: "../plots/plots-summary.json",
            runsPath: "../plots/plot-data.json",
            artifactPaths: ["../plots/charts/warm-index-correctness.svg"]
          }),
          galleryItem({ id: "warm-index-execution", htmlPath: "", summaryPath: "../warm-index-execution.json", artifactPaths: undefined })
        ]
      })
    ).toEqual([]);
  });

  it("rejects a wrong or reordered set of item ids", () => {
    expect(validateWarmIndexCampaignGalleryManifest({ items: [galleryItem({ id: "unexpected-item" })] })).toHaveLength(1);
    expect(
      validateWarmIndexCampaignGalleryManifest({
        items: [galleryItem({ id: "warm-index-campaign-plots" }), galleryItem({ id: "warm-index-campaign-report" })]
      })
    ).toHaveLength(1);
  });

  it("rejects absolute, Windows-style, and escaping paths", () => {
    const problems = validateWarmIndexCampaignGalleryManifest({
      items: [galleryItem({ summaryPath: "C:/abs/report.json" }), galleryItem({ id: "warm-index-campaign-plots" }), galleryItem({ id: "warm-index-execution" })]
    });
    expect(problems.some((p) => p.includes("not a bounded relative POSIX path"))).toBe(true);
  });

  it("rejects a path that links detailed agent evidence or provider stdout/stderr/telemetry", () => {
    const problems = validateWarmIndexCampaignGalleryManifest({
      items: [
        galleryItem({ artifactPaths: ["../agents/codex/raw-full-file/stdout.txt"] }),
        galleryItem({ id: "warm-index-campaign-plots" }),
        galleryItem({ id: "warm-index-execution" })
      ]
    });
    expect(problems.some((p) => p.includes("detailed/forensic agent evidence"))).toBe(true);
  });
});

describe("snapshotDirectory / diffSnapshots", () => {
  it("produces a deterministic, sorted snapshot of nested files", async () => {
    const root = makeTempDir("snapshot-test-");
    mkdirSync(path.join(root, "b-dir"), { recursive: true });
    mkdirSync(path.join(root, "a-dir"), { recursive: true });
    writeFileSync(path.join(root, "b-dir", "file.txt"), "hello");
    writeFileSync(path.join(root, "a-dir", "file.txt"), "world");
    writeFileSync(path.join(root, "top.txt"), "top");

    const snapshot = await snapshotDirectory(root);
    const paths = snapshot.map(([relPath]: [string, string]) => relPath);
    expect(paths).toEqual(["a-dir/file.txt", "b-dir/file.txt", "top.txt"]);
    // Uses forward slashes even conceptually on Windows (path.sep normalized).
    expect(paths.every((p: string) => !p.includes("\\"))).toBe(true);
  });

  it("detects no changes between two snapshots of unmodified content", async () => {
    const root = makeTempDir("snapshot-stable-");
    writeFileSync(path.join(root, "file.txt"), "unchanged");
    const before = await snapshotDirectory(root);
    const after = await snapshotDirectory(root);
    expect(diffSnapshots(before, after)).toEqual([]);
  });

  it("detects added, removed, and modified files", async () => {
    const before: Array<[string, string]> = [
      ["kept.txt", "hash-kept"],
      ["removed.txt", "hash-removed"],
      ["changed.txt", "hash-before"]
    ];
    const after: Array<[string, string]> = [
      ["kept.txt", "hash-kept"],
      ["changed.txt", "hash-after"],
      ["added.txt", "hash-added"]
    ];
    const changes = diffSnapshots(before, after);
    expect(changes).toContain("removed: removed.txt");
    expect(changes).toContain("modified: changed.txt");
    expect(changes).toContain("added: added.txt");
    expect(changes).toHaveLength(3);
  });
});
