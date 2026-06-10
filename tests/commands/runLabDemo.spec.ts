import { mkdtempSync, writeFileSync } from "node:fs";
import { access, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLabDemo, runLabDemoCommand } from "../../src/commands/runLabDemo.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runLabDemo", () => {
  it("runs with fake my-dev-kit command and writes gallery artifacts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "lab-demo-command-"));
    tempDirs.push(outDir);
    const result = await runLabDemo(
      {
        casesPath: "examples/lab-demo-cases.json",
        kitCommand: `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`,
        outDir,
        requireKit: false,
        noScreenshot: true,
        skipBenchmarkValidation: false
      },
      process.cwd()
    );

    await expect(access(path.join(outDir, "gallery-manifest.json"))).resolves.toBeUndefined();
    await expect(access(path.join(outDir, "token-savings-summary.json"))).resolves.toBeUndefined();
    await expect(access(path.join(outDir, "token-savings-runs.json"))).resolves.toBeUndefined();
    await expect(access(path.join(outDir, "token-savings-report.html"))).resolves.toBeUndefined();
    expect(result.gallery.manifest.items[0]?.summaryPath).toBe("token-savings-summary.json");
  }, 15000);

  it("supports --no-screenshot and --skip-benchmark-validation", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "lab-demo-command-"));
    tempDirs.push(outDir);
    const code = await runLabDemoCommand([
      "--cases",
      "examples/lab-demo-cases.json",
      "--kit-command",
      `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`,
      "--out",
      outDir,
      "--no-screenshot",
      "--skip-benchmark-validation"
    ]);
    expect(code).toBe(0);
    const manifest = JSON.parse(await readFile(path.join(outDir, "gallery-manifest.json"), "utf8")) as { warnings: string[] };
    expect(manifest.warnings.some((warning) => warning.includes("Benchmark validation skipped"))).toBe(true);
  }, 15000);

  it("supports --require-kit with the fake command", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "lab-demo-command-"));
    tempDirs.push(outDir);
    const code = await runLabDemoCommand([
      "--cases",
      "examples/lab-demo-cases.json",
      "--kit-command",
      `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`,
      "--out",
      outDir,
      "--require-kit",
      "--no-screenshot"
    ]);
    expect(code).toBe(0);
  }, 15000);

  it("fails clearly for missing or invalid cases and for benchmark validation failures", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "lab-demo-command-"));
    tempDirs.push(outDir);
    expect(await runLabDemoCommand(["--cases", "missing.json", "--kit-command", "node fake.js", "--out", outDir])).toBe(1);

    const invalidCasesPath = path.join(outDir, "invalid-cases.json");
    writeFileSync(invalidCasesPath, "{ invalid");
    expect(await runLabDemoCommand(["--cases", invalidCasesPath, "--kit-command", "node fake.js", "--out", outDir, "--skip-benchmark-validation"])).toBe(1);

    const emptyRepo = mkdtempSync(path.join(os.tmpdir(), "lab-demo-empty-repo-"));
    tempDirs.push(emptyRepo);
    writeFileSync(
      path.join(emptyRepo, "cases.json"),
      JSON.stringify(
        [
          {
            id: "x",
            title: "x",
            benchmarkProject: "todo-ts",
            targetRoot: "benchmarks/projects/todo-ts",
            sourceRoots: ["src"],
            query: "x",
            expectedFiles: ["src/taskService.ts"],
            expectedSymbols: ["createTask"],
            rawIncludeGlobs: ["src/**/*"]
          }
        ],
        null,
        2
      )
    );

    await expect(
      runLabDemo(
        {
          casesPath: "cases.json",
          kitCommand: `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`,
          outDir: path.join(emptyRepo, "out"),
          requireKit: false,
          noScreenshot: true,
          skipBenchmarkValidation: false
        },
        emptyRepo
      )
    ).rejects.toThrow(/Benchmark validation failed/);
  });
});
