import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";
import { DEFAULT_AUDIT_REGISTRY } from "../../src/audits/core/auditRegistry.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 6 — genuine end-to-end schema guard.
//
// Unlike tests/audits/auditReportSchemaStability.test.ts (which builds the
// model in-process via buildAuditReportModel()), this test runs the real CLI
// as a subprocess and reads the generated JSON report file back off disk --
// the full path from CLI args -> config -> runAudit -> report model -> JSON
// renderer -> fs.writeFileSync -> fs.readFileSync in a fresh process.
// ---------------------------------------------------------------------------

const toolRoot = process.cwd();
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function runAuditCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const resolved = resolveCommand("npx", { cwd: toolRoot });
  const needsResolvedPathArg =
    resolved.resolutionKind === "windows-cmd-shim" || resolved.resolutionKind === "windows-powershell-shim";
  const fullArgs = [
    ...resolved.argsPrefix,
    ...(needsResolvedPathArg && resolved.resolvedPath ? [resolved.resolvedPath] : []),
    "tsx",
    "scripts/audits/runAudit.ts",
    ...args,
  ];
  try {
    const stdout = execFileSync(resolved.command, fullArgs, { cwd: toolRoot, encoding: "utf8" });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

const REQUIRED_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "metadata",
  "target",
  "config",
  "summary",
  "inventory",
  "sourceOfTruth",
  "sourceFacts",
  // v0.3.2 Batch 3 -- 15th top-level field, alongside the existing 14.
  "pythonProjectMetadata",
  // v0.3.2 Batch 4 -- 16th top-level field.
  "securitySummary",
  "detectors",
  "issues",
  "skippedDetectors",
  "detectorErrors",
  "recommendations",
  "exit",
].sort();

describe("end-to-end audit report schema — real CLI, real fixture, real disk read", () => {
  it("produces a structurally sane JSON report file on disk", () => {
    const target = makeTempDir("audit-e2e-target-");
    writeFile(target, "package.json", JSON.stringify({ name: "fixture-e2e", version: "1.0.0", scripts: {} }, null, 2));
    writeFile(target, "README.md", "Run `npm run totally-fake-e2e-command` to get started.\n");

    const outDir = makeTempDir("audit-e2e-out-");
    const result = runAuditCli(["--target", target, "--types", "code-rot", "--fail-on", "none", "--format", "json", "--out", outDir]);
    expect(result.status).toBe(0);

    const jsonPath = path.join(outDir, "code-rot-audit.json");
    expect(fs.existsSync(jsonPath)).toBe(true);
    // The JSON file path must be under the resolved --out dir.
    expect(path.resolve(jsonPath).startsWith(path.resolve(outDir))).toBe(true);

    const raw = fs.readFileSync(jsonPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // 1. All 16 top-level fields present, nothing more/less (v0.3.1 Batch 2
    // added "sourceFacts" to the original 13; v0.3.2 Batch 3 added
    // "pythonProjectMetadata" as the 15th; v0.3.2 Batch 4 adds
    // "securitySummary" as the 16th).
    expect(Object.keys(parsed).sort()).toEqual(REQUIRED_TOP_LEVEL_KEYS);

    // 2. schemaVersion.
    expect(parsed.schemaVersion).toBe("1.0");

    const metadata = parsed.metadata as Record<string, unknown>;
    const targetField = parsed.target as Record<string, unknown>;
    const config = parsed.config as Record<string, unknown>;
    const summary = parsed.summary as Record<string, unknown>;
    const inventory = parsed.inventory as Record<string, unknown>;
    const sourceOfTruth = parsed.sourceOfTruth as Record<string, unknown>;
    const detectors = parsed.detectors as unknown[];
    const issues = parsed.issues as { severity: string }[];
    const skippedDetectors = parsed.skippedDetectors as unknown[];
    const detectorErrors = parsed.detectorErrors as unknown[];
    const recommendations = parsed.recommendations as unknown[];
    const exit = parsed.exit as Record<string, unknown>;

    // 3. Structural sanity of each nested section, ignoring volatile values.
    expect(typeof metadata.generatedAt).toBe("string");
    expect((metadata.generatedAt as string).length).toBeGreaterThan(0);
    expect(Array.isArray(metadata.auditTypes)).toBe(true);
    expect(metadata.auditTypes).toEqual(["code-rot"]);
    expect(metadata.auditType).toBe("code-rot");

    expect(typeof targetField.rootPath).toBe("string");
    expect((targetField.rootPath as string).length).toBeGreaterThan(0);
    expect(targetField.targetKind).toBe("external");

    expect(typeof config.out).toBe("string");
    expect(path.resolve(config.out as string)).toBe(path.resolve(outDir));

    expect(Array.isArray(inventory.filesByExtension) === false).toBe(true); // object, not array
    expect(typeof inventory.totalFileCount).toBe("number");

    expect(typeof sourceOfTruth.packageName).toBe("string");
    expect(sourceOfTruth.packageName).toBe("fixture-e2e");

    // 4. exit.code matches the actual subprocess exit status.
    expect(exit.code).toBe(result.status);

    // 5. summary.totalIssues === issues.length.
    expect(summary.totalIssues).toBe(issues.length);

    // 6. summary.issuesBySeverity sums match the issues array's actual
    // severity distribution, computed both ways.
    const bySeverityFromIssues: Record<string, number> = { blocker: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const issue of issues) {
      bySeverityFromIssues[issue.severity] = (bySeverityFromIssues[issue.severity] ?? 0) + 1;
    }
    expect(summary.issuesBySeverity).toEqual(bySeverityFromIssues);

    // 7. Detector count in `detectors` equals registry length.
    expect(detectors).toHaveLength(DEFAULT_AUDIT_REGISTRY.length);

    // 8. skippedDetectorCount/detectorErrorCount match their arrays.
    expect(summary.skippedDetectorCount).toBe(skippedDetectors.length);
    expect(summary.detectorErrorCount).toBe(detectorErrors.length);

    expect(Array.isArray(recommendations)).toBe(true);
  }, 30_000);
});
