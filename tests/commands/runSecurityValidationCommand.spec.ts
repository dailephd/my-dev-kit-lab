import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSecurityValidationCommandFromArgs } from "../../src/commands/runSecurityValidationCommand.js";
import { runLabCli } from "../../src/cli/runLabCli.js";
import { createLabExecutionContext } from "../../src/runtime/labExecutionContext.js";
import { runPackageChecks } from "../../src/securityValidation/packageChecks/runPackageChecks.js";
import { writeCheckResult } from "../../src/securityValidation/artifacts.js";
import type { SecurityCheckResult } from "../../src/securityValidation/types.js";

vi.mock("../../src/securityValidation/packageChecks/runPackageChecks.js", () => ({ runPackageChecks: vi.fn() }));
const packageCheck = vi.mocked(runPackageChecks);
let root: string;
let out: string;
let target: string;
let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

function check(): SecurityCheckResult {
  return { id: "npm-pack-dry-run", name: "Fixture package check", category: "package-content", status: "passed",
    severity: "informational", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:00Z", durationMs: 0, findings: [] };
}
function report(dir = out): { checks: SecurityCheckResult[]; verdict: string; summary: { failed: number } } {
  return JSON.parse(fs.readFileSync(path.join(dir, "fixture-security-validation.json"), "utf8"));
}
const args = () => ["--target", target, "--checks", "package", "--format", "text,json", "--report-prefix", "fixture", "--fail-on", "blocker"];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "security-command-readiness-"));
  target = path.join(root, "target"); out = path.join(root, "out");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  packageCheck.mockReset();
  packageCheck.mockImplementation(async ({ config }) => {
    const result = check();
    await writeCheckResult({ result, outputPath: path.join(config.reportDir, "npm-pack-dry-run.json"), rawDir: config.rawOutputDir,
      rawStdout: "fixture stdout", rawStderr: "fixture stderr" });
    return { checks: [result], findings: [] };
  });
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

describe("shared security command readiness corrections", () => {
  it.each([false, true])("installed route confines intermediate and final files (explicit out=%s)", async (explicit) => {
    const workspace = path.join(root, "workspace");
    const destination = explicit ? out : path.join(workspace, "reports", "security");
    const before = fs.readFileSync(path.join(target, "package.json"), "utf8");
    expect(await runLabCli(["--workspace", workspace, "security", "validate", ...args(), ...(explicit ? ["--out", out] : [])])).toBe(0);
    expect(packageCheck.mock.calls[0]?.[0].config).toMatchObject({ reportDir: destination, rawOutputDir: path.join(destination, "raw") });
    expect(fs.readFileSync(path.join(destination, "raw", "npm-pack-dry-run.stdout.txt"), "utf8")).toBe("fixture stdout");
    expect(fs.readFileSync(path.join(destination, "raw", "npm-pack-dry-run.stderr.txt"), "utf8")).toBe("fixture stderr");
    expect(report(destination).checks.find(c => c.id === "npm-pack-dry-run")?.status).toBe("passed");
    expect(error).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain("Reports written:");
    expect(fs.readdirSync(target)).toEqual(["package.json"]);
    expect(fs.readFileSync(path.join(target, "package.json"), "utf8")).toBe(before);
    if (explicit) expect(fs.existsSync(workspace)).toBe(false);
  });

  it("contributor default roots all evidence under the source checkout reports/security", async () => {
    const context = createLabExecutionContext({ packageRoot: target, workspaceRoot: path.join(root, "unused") });
    expect(await runSecurityValidationCommandFromArgs(args(), { context })).toBe(0);
    const destination = path.join(target, "reports", "security");
    expect(packageCheck.mock.calls[0]?.[0].config.reportDir).toBe(destination);
    expect(fs.existsSync(path.join(destination, "raw", "npm-pack-dry-run.stdout.txt"))).toBe(true);
    expect(report(destination).summary.failed).toBe(0);
  });

  it.each(["installed", "contributor"])("%s cannot hide a selected orchestration error with --fail-on blocker", async (mode) => {
    packageCheck.mockRejectedValue(new Error("fixture package evidence persistence failed"));
    const command = [...args(), "--out", out];
    const code = mode === "installed"
      ? await runLabCli(["--workspace", path.join(root, "workspace"), "security", "validate", ...command])
      : await runSecurityValidationCommandFromArgs(command);
    expect(code).toBe(1);
    expect(report()).toMatchObject({ verdict: "not-ready-security-blocker-remains", summary: { failed: 1 } });
    expect(report().checks.find(c => c.id === "package-content")).toMatchObject({ status: "failed", severity: "major", skippedReason: "fixture package evidence persistence failed" });
    expect(fs.readFileSync(path.join(out, "fixture-security-validation.txt"), "utf8")).toContain("fixture package evidence persistence failed");
    expect(error.mock.calls.flat().join("\n")).toContain("Exit 1");
    expect(log.mock.calls.flat().join("\n")).not.toContain("Exit 0");
  });

  it("final report persistence failure returns 4 without claiming persisted evidence", async () => {
    packageCheck.mockImplementation(async () => {
      fs.mkdirSync(out, { recursive: true });
      fs.mkdirSync(path.join(out, "fixture-security-validation.json"));
      return { checks: [check()], findings: [] };
    });
    expect(await runSecurityValidationCommandFromArgs([...args(), "--out", out])).toBe(4);
    expect(log.mock.calls.flat().join("\n")).not.toContain("Reports written:");
    expect(error.mock.calls.flat().join("\n")).toContain("not persisted");
  });

  it.each(["../escape", "..\\escape", "C:alias", "trailing."])("rejects report-prefix escape %s before checks", async (prefix) => {
    expect(await runSecurityValidationCommandFromArgs([...args(), "--out", out, "--report-prefix", prefix])).toBe(2);
    expect(packageCheck).not.toHaveBeenCalled();
    expect(fs.existsSync(out)).toBe(false);
  });

  it("rejects a file output root before validation", async () => {
    fs.writeFileSync(out, "unchanged");
    expect(await runSecurityValidationCommandFromArgs([...args(), "--out", out])).toBe(2);
    expect(packageCheck).not.toHaveBeenCalled();
    expect(fs.readFileSync(out, "utf8")).toBe("unchanged");
  });

  it("rejects output junctions and raw-directory junctions without touching their destinations", async () => {
    const elsewhere = path.join(root, "elsewhere"); fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, out, process.platform === "win32" ? "junction" : "dir");
    expect(await runSecurityValidationCommandFromArgs([...args(), "--out", out])).toBe(2);
    fs.unlinkSync(out); fs.mkdirSync(out);
    fs.symlinkSync(elsewhere, path.join(out, "raw"), process.platform === "win32" ? "junction" : "dir");
    expect(await runSecurityValidationCommandFromArgs([...args(), "--out", out])).toBe(2);
    expect(packageCheck).not.toHaveBeenCalled();
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it("help wins over invalid paths and performs no validation or writes", async () => {
    expect(await runLabCli(["security", "validate", ...args(), "--out", out, "--report-prefix", "../escape", "--help"])).toBe(0);
    expect(packageCheck).not.toHaveBeenCalled();
    expect(fs.existsSync(out)).toBe(false);
  });

  it("an intermediate evidence hardlink cannot overwrite another file or become a successful result", async () => {
    fs.mkdirSync(out);
    const protectedFile = path.join(root, "protected.json"); fs.writeFileSync(protectedFile, "unchanged");
    fs.linkSync(protectedFile, path.join(out, "npm-pack-dry-run.json"));
    expect(await runSecurityValidationCommandFromArgs([...args(), "--out", out])).toBe(1);
    expect(fs.readFileSync(protectedFile, "utf8")).toBe("unchanged");
    expect(report().checks.find(c => c.id === "package-content")?.status).toBe("failed");
  });

  it("rejects a junction nested in the npm cache before invoking checks", async () => {
    const cache = path.join(out, "raw", "npm-cache"); fs.mkdirSync(cache, { recursive: true });
    const elsewhere = path.join(root, "cache-escape"); fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(cache, "_logs"), process.platform === "win32" ? "junction" : "dir");
    expect(await runSecurityValidationCommandFromArgs([...args(), "--out", out])).toBe(2);
    expect(packageCheck).not.toHaveBeenCalled();
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it.skipIf(process.platform !== "win32")("accepts physical Windows path casing but rejects trailing-dot aliases", async () => {
    expect(await runSecurityValidationCommandFromArgs([...args(), "--out", out.toUpperCase()])).toBe(0);
    expect(report().summary.failed).toBe(0);
    packageCheck.mockClear();
    expect(await runSecurityValidationCommandFromArgs([...args(), "--out", out + "."])).toBe(2);
    expect(packageCheck).not.toHaveBeenCalled();
  });
});
