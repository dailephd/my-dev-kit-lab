import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseNpmPackJsonEntry } from "../../src/securityValidation/packageChecks/parseNpmPackDryRun.js";
import {
  diffSnapshots,
  findExactlyOneTarball,
  missingRequiredTarballPaths,
  validateManifestRelativePaths,
  validatePlaywrightRuntimeDependency,
  validateWarmIndexCampaignGalleryManifest,
  validateWarmIndexCampaignScreenshotEvidence,
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

describe("validateWarmIndexCampaignScreenshotEvidence", () => {
  it.each([
    {
      status: "captured" as const,
      commandOutput: "Status: completed\nScreenshot: C:/campaign/report.png",
      expectedPngPath: "C:/campaign/report.png",
      pngExists: true,
      reportItem: { status: "pass", screenshotPath: "../report.png", warnings: [] }
    },
    {
      status: "skipped" as const,
      commandOutput: "Status: completed\nScreenshot: skipped\nPNG screenshot skipped because Playwright or browser runtime is unavailable.",
      expectedPngPath: "C:/campaign/report.png",
      pngExists: false,
      reportItem: { status: "warning", warnings: ["PNG screenshot skipped because Playwright or browser runtime is unavailable."] }
    },
    {
      status: "failed" as const,
      commandOutput: "Status: completed\nScreenshot: failed\nProtocol error (Page.captureScreenshot): Unable to capture screenshot",
      expectedPngPath: "C:/campaign/report.png",
      pngExists: false,
      reportItem: {
        status: "warning",
        warnings: ["Report screenshot capture failed: Protocol error (Page.captureScreenshot): Unable to capture screenshot."]
      }
    }
  ])("accepts consistent $status screenshot evidence", (evidence) => {
    expect(validateWarmIndexCampaignScreenshotEvidence(evidence)).toEqual([]);
  });

  it("rejects contradictory captured evidence when the PNG is missing", () => {
    expect(validateWarmIndexCampaignScreenshotEvidence({
      status: "captured",
      commandOutput: "Status: completed\nScreenshot: C:/campaign/report.png",
      expectedPngPath: "C:/campaign/report.png",
      pngExists: false,
      reportItem: { status: "pass", screenshotPath: "../report.png" }
    }).join("; ")).toMatch(/report.png is missing/);
  });

  it("accepts semantic failure evidence when wrapper wording varies and the diagnostic spans lines", () => {
    const error = "Protocol error (Page.captureScreenshot):\nUnable to capture screenshot";
    expect(validateWarmIndexCampaignScreenshotEvidence({
      status: "failed",
      commandOutput: `Status: completed\nScreenshot: failed\n${error}\nGallery manifest: C:/campaign/gallery/gallery-manifest.json`,
      expectedPngPath: "C:/campaign/report.png",
      pngExists: false,
      reportItem: {
        status: "warning",
        warnings: [`Report screenshot failed: ${error}`]
      }
    })).toEqual([]);
  });

  it.each([
    { label: "empty warnings", warnings: [] },
    { label: "unrelated warning", warnings: ["Plot contains a skipped point."] },
    { label: "failure warning without the available diagnostic", warnings: ["Report screenshot capture failed: browser error."] }
  ])("rejects failed screenshot evidence with $label", ({ warnings }) => {
    const problems = validateWarmIndexCampaignScreenshotEvidence({
      status: "failed",
      commandOutput: "Status: completed\nScreenshot: failed\nProtocol error (Page.captureScreenshot): Unable to capture screenshot",
      expectedPngPath: "C:/campaign/report.png",
      pngExists: false,
      reportItem: { status: "warning", warnings }
    });
    expect(problems.length).toBeGreaterThan(0);
  });

  it("rejects skipped evidence that claims a screenshot path", () => {
    const problems = validateWarmIndexCampaignScreenshotEvidence({
      status: "skipped",
      commandOutput: "Status: completed\nScreenshot: skipped",
      expectedPngPath: "C:/campaign/report.png",
      pngExists: false,
      reportItem: {
        status: "warning",
        screenshotPath: "../report.png",
        warnings: ["PNG screenshot skipped because Playwright or browser runtime is unavailable."]
      }
    });
    expect(problems.some((problem) => problem.includes("inconsistent with the gallery report item"))).toBe(true);
  });

  it("rejects a failed capture that claims a screenshot path or fabricates a PNG", () => {
    const problems = validateWarmIndexCampaignScreenshotEvidence({
      status: "failed",
      commandOutput: "Status: completed\nScreenshot: failed\nProtocol error (Page.captureScreenshot): Unable to capture screenshot",
      expectedPngPath: "C:/campaign/report.png",
      pngExists: true,
      reportItem: {
        status: "warning",
        screenshotPath: "../report.png",
        warnings: ["Report screenshot capture failed: Protocol error (Page.captureScreenshot): Unable to capture screenshot."]
      }
    });
    expect(problems.some((problem) => problem.includes("unexpectedly has report.png"))).toBe(true);
    expect(problems.some((problem) => problem.includes("inconsistent with the gallery report item"))).toBe(true);
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

describe("resolvePackEntry (npm 11 and npm 12 `npm pack --json` shapes)", () => {
  const NAME = "@dailephd/my-dev-kit-lab";
  const VERSION = "0.9.3";
  const TARBALL = "dailephd-my-dev-kit-lab-0.9.3.tgz";
  const packEntry = (overrides: Record<string, unknown> = {}) => ({
    id: `${NAME}@${VERSION}`,
    name: NAME,
    version: VERSION,
    size: 1159149,
    filename: TARBALL,
    files: [
      { path: "package.json", size: 3000, mode: 420 },
      { path: "dist/scripts/cli.js", size: 900, mode: 493 }
    ],
    ...overrides
  });
  const npm11 = (entry: unknown = packEntry()) => JSON.stringify([entry], null, 2);
  const npm12 = (entry: unknown = packEntry()) => JSON.stringify({ [NAME]: entry }, null, 2);
  const expected = { expectedName: NAME, expectedVersion: VERSION, tarballFilename: TARBALL };

  // The verifier is a shebang script that Vite's transform cannot load, so it runs natively in a child process.
  // The real validated parser result is passed in, and resolvePackEntry's own checks run unchanged.
  async function resolve(stdout: string, overrides: Partial<typeof expected> = {}) {
    const script = [
      `const { resolvePackEntry } = await import(${JSON.stringify(pathToFileURL(path.resolve("scripts/verify-packed-package.mjs")).href)});`,
      "const input = JSON.parse((await import(\"node:fs\")).readFileSync(0, \"utf8\"));",
      "try {",
      "  const entry = resolvePackEntry(() => input.parsed, input.stdout, input.options);",
      "  console.log(JSON.stringify({ ok: true, entry }));",
      "} catch (error) {",
      "  console.log(JSON.stringify({ ok: false, message: String(error.message) }));",
      "}"
    ].join("\n");
    const input = JSON.stringify({ parsed: parseNpmPackJsonEntry(stdout), stdout, options: { ...expected, ...overrides } });
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
    if (run.status !== 0) throw new Error(`child failed: ${run.stderr}`);
    const outcome = JSON.parse(run.stdout) as { ok: boolean; entry?: { filename: string; files: string[] }; message?: string };
    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.entry as { filename: string; files: string[] };
  }

  it.each([
    ["npm 11 array", npm11],
    ["npm 12 identity-keyed object", npm12]
  ])("accepts the %s shape and yields validated package-relative files", async (_label, render) => {
    const entry = await resolve(render());
    expect(entry.filename).toBe(TARBALL);
    expect(entry.files).toEqual(["package.json", "dist/scripts/cli.js"]);
  });

  it("returns identical entries for both shapes", async () => {
    expect(await resolve(npm12())).toEqual(await resolve(npm11()));
  });

  it.each([
    ["an empty array", "[]"],
    ["an empty object", "{}"],
    ["multiple array entries", JSON.stringify([packEntry(), packEntry()])],
    ["multiple keyed entries", JSON.stringify({ a: packEntry(), b: packEntry() })],
    ["a bare package object", JSON.stringify(packEntry())],
    ["malformed JSON", "[{ not json"],
    ["empty output", ""],
    ["empty files", npm12(packEntry({ files: [] }))],
    ["missing files", npm11(packEntry({ files: undefined }))],
    ["a parent-traversal path", npm12(packEntry({ files: [{ path: "../escape.js" }] }))],
    ["an absolute path", npm11(packEntry({ files: [{ path: "/etc/passwd" }] }))],
    ["a drive path", npm12(packEntry({ files: [{ path: "C:/Windows/x.js" }] }))]
  ])("rejects %s as a PACK gate failure", async (_label, stdout) => {
    await expect(resolve(stdout)).rejects.toThrow(/\[PACK\]/);
  });

  it("rejects a missing filename", async () => {
    await expect(resolve(npm12(packEntry({ filename: undefined })))).rejects.toThrow(/no tarball filename/);
  });

  it("rejects a filename that does not match the tarball on disk", async () => {
    await expect(resolve(npm11(packEntry({ filename: "other-0.9.3.tgz" })))).rejects.toThrow(/does not match the single tarball/);
  });

  it("rejects a different package identity", async () => {
    await expect(resolve(npm12(packEntry({ name: "someone-else" })))).rejects.toThrow(/package identity/);
    await expect(resolve(npm11(packEntry({ version: "9.9.9" })))).rejects.toThrow(/package identity/);
  });

  it("lets the existing required-path check reject an inventory without runtime files", async () => {
    const entry = await resolve(npm12(packEntry({ files: [{ path: "README.md" }] })));
    const missing = missingRequiredTarballPaths(new Set(entry.files), ["package.json", "dist/scripts/cli.js"]);
    expect(missing).toEqual(["package.json", "dist/scripts/cli.js"]);
  });

  it("accepts the real `npm pack --dry-run --json` output of the installed npm", async () => {
    const run = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: process.platform === "win32",
      maxBuffer: 64 * 1024 * 1024
    });
    expect(run.status).toBe(0);
    const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as { name: string; version: string };
    const tarball = `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
    const entry = await resolve(run.stdout, { expectedName: pkg.name, expectedVersion: pkg.version, tarballFilename: tarball });
    expect(entry.files).toContain("package.json");
    expect(entry.files.length).toBeGreaterThan(10);
  }, 120_000);
});

describe("verify-packed-package entrypoint verdict integrity", () => {
  // A copy without dist/ fails the BUILD_REQUIRED gate before main()'s gate handling, the earliest failure path.
  function makeBuildlessCopy(): string {
    const root = makeTempDir("vpp-buildless-");
    mkdirSync(path.join(root, "scripts"));
    for (const file of ["verify-packed-package.mjs", "verifyPackedPackageAgentSuccess.mjs"]) {
      writeFileSync(path.join(root, "scripts", file), readFileSync(path.resolve("scripts", file)));
    }
    writeFileSync(path.join(root, "package.json"), readFileSync(path.resolve("package.json")));
    return root;
  }

  function runVerifier(scriptPath: string, cwd: string) {
    return spawnSync(process.execPath, [scriptPath], { cwd, encoding: "utf8" });
  }

  it("exits nonzero and prints the FAIL verdict marker when a gate fails before the main gate handling", () => {
    const root = makeBuildlessCopy();
    const run = runVerifier(path.join(root, "scripts", "verify-packed-package.mjs"), root);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("PACKED_PACKAGE_VERDICT: FAIL");
    expect(run.stderr).toContain("FAILED_GATE: BUILD_REQUIRED");
    expect(run.stdout).not.toContain("PACKED_PACKAGE_VERDICT: PASS");
  });

  it("still runs (and fails) when invoked through a directory link instead of silently doing nothing", () => {
    const root = makeBuildlessCopy();
    const link = path.join(makeTempDir("vpp-link-"), "linked");
    symlinkSync(root, link, process.platform === "win32" ? "junction" : "dir");
    const run = runVerifier(path.join(link, "scripts", "verify-packed-package.mjs"), link);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("PACKED_PACKAGE_VERDICT: FAIL");
  });
});
