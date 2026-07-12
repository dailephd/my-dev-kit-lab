import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeAndroidExternalToolRequest } from "../../../../src/mobile/android/advancedSecurity/externalTools/types.js";
import { buildMinimalEnvironment } from "../../../../src/mobile/android/advancedSecurity/externalTools/minimalEnvironment.js";
import { boundedText, safeJsonParse } from "../../../../src/mobile/android/advancedSecurity/externalTools/boundedOutput.js";
import { writeExternalToolArtifact, copyExternalToolArtifactFromTarget } from "../../../../src/mobile/android/advancedSecurity/externalTools/artifacts.js";
import { buildCommandSummary } from "../../../../src/mobile/android/advancedSecurity/externalTools/runBoundedExternalTool.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function tmp(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

describe("normalizeAndroidExternalToolRequest — ANDROID-V041-B7-02/03/04/05", () => {
  it("no request executes zero tools", () => {
    const result = normalizeAndroidExternalToolRequest(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tools).toHaveLength(0);
  });

  it("empty requestedTools executes zero tools", () => {
    const result = normalizeAndroidExternalToolRequest({ requestedTools: [], targetRoot: "/t", artifactRoot: "/a" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tools).toHaveLength(0);
  });

  it("only explicitly requested tools are included", () => {
    const result = normalizeAndroidExternalToolRequest({ requestedTools: ["semgrep"], targetRoot: "/t", artifactRoot: "/a" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tools).toEqual(["semgrep"]);
  });

  it("duplicate tool ids normalize to one deterministic request in fixed order", () => {
    const result = normalizeAndroidExternalToolRequest({
      requestedTools: ["dependency-check", "semgrep", "semgrep", "android-lint", "osv"],
      targetRoot: "/t",
      artifactRoot: "/a",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tools).toEqual(["semgrep", "osv", "android-lint", "dependency-check"]);
  });

  it("rejects unknown tool ids at the contract boundary", () => {
    const result = normalizeAndroidExternalToolRequest({ requestedTools: ["semgrep", "arbitrary-tool"], targetRoot: "/t", artifactRoot: "/a" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("arbitrary-tool");
  });

  it("defaults network policy to deny", () => {
    const result = normalizeAndroidExternalToolRequest({ requestedTools: ["osv"], targetRoot: "/t", artifactRoot: "/a" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.networkPolicy).toBe("deny");
  });

  it("rejects a timeout override outside the safe bounds", () => {
    const result = normalizeAndroidExternalToolRequest({ requestedTools: ["semgrep"], targetRoot: "/t", artifactRoot: "/a", timeoutOverrideMs: 1 });
    expect(result.ok).toBe(false);
  });
});

describe("buildMinimalEnvironment — ANDROID-V041-B7-16/17", () => {
  it("only propagates allowlisted keys, never arbitrary credentials", () => {
    const env = buildMinimalEnvironment({
      source: { PATH: "/usr/bin", SEMGREP_APP_TOKEN: "fake-secret-token", GITHUB_TOKEN: "fake-gh-token", NVD_API_KEY: "fake-nvd-key" },
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.SEMGREP_APP_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.NVD_API_KEY).toBeUndefined();
  });

  it("includes additional allowed keys only when explicitly requested", () => {
    const env = buildMinimalEnvironment({ source: { JAVA_HOME: "/opt/java", ANDROID_HOME: "/opt/sdk" }, additionalAllowedKeys: ["JAVA_HOME"] });
    expect(env.JAVA_HOME).toBe("/opt/java");
    expect(env.ANDROID_HOME).toBeUndefined();
  });
});

describe("boundedText / safeJsonParse — ANDROID-V041-B7-13/14/15", () => {
  it("bounds oversized text and records truncation", () => {
    const result = boundedText("x".repeat(100), 10);
    expect(result.text).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("does not truncate text within bounds", () => {
    const result = boundedText("short", 10);
    expect(result.truncated).toBe(false);
  });

  it("parses valid bounded JSON", () => {
    const result = safeJsonParse<{ a: number }>('{"a":1}', 1000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.a).toBe(1);
  });

  it("never parses a truncated document as valid JSON", () => {
    const result = safeJsonParse('{"a":1}', 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.truncated).toBe(true);
  });

  it("reports malformed JSON without crashing", () => {
    const result = safeJsonParse("{ not json", 1000);
    expect(result.ok).toBe(false);
  });
});

describe("artifact containment and fingerprints — ANDROID-V041-B7-22/23", () => {
  it("writes an artifact under the tool-owned artifact directory with a deterministic sha256", () => {
    const artifactRoot = tmp("artifact-root-");
    const ref1 = writeExternalToolArtifact(artifactRoot, "semgrep", "config.json", '{"rules":[]}', "json");
    const ref2 = writeExternalToolArtifact(artifactRoot, "semgrep", "config2.json", '{"rules":[]}', "json");
    expect(ref1.sha256).toBe(ref2.sha256);
    expect(ref1.relativePath.replace(/\\/g, "/")).toBe("semgrep/config.json");
    expect(fs.existsSync(path.join(artifactRoot, "semgrep", "config.json"))).toBe(true);
  });

  it("rejects artifact paths that would escape the artifact root", () => {
    const artifactRoot = tmp("artifact-root-");
    expect(() => writeExternalToolArtifact(artifactRoot, "semgrep", "../../escape.json", "{}", "json")).toThrow();
  });

  it("copies a target-generated report without deleting or modifying the original", () => {
    const targetRoot = tmp("target-");
    const artifactRoot = tmp("artifact-root-");
    const reportDir = path.join(targetRoot, "app", "build", "reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, "lint-results.xml");
    fs.writeFileSync(reportPath, "<issues/>");

    const ref = copyExternalToolArtifactFromTarget(artifactRoot, targetRoot, "android-lint", reportPath, "xml");
    expect(ref?.copiedFromTarget).toBe(true);
    expect(ref?.sourceTargetRelativePath?.replace(/\\/g, "/")).toBe("app/build/reports/lint-results.xml");
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.readFileSync(reportPath, "utf8")).toBe("<issues/>");
  });
});

describe("buildCommandSummary — ANDROID-V041-B7-31", () => {
  it("replaces target and artifact roots with symbolic placeholders and omits environment", () => {
    const summary = buildCommandSummary("semgrep", ["scan", "--config", "/artifacts/semgrep/config.json", "/home/user/project"], "/home/user/project", "/artifacts");
    expect(summary).not.toContain("/home/user/project");
    expect(summary).toContain("<TARGET>");
    expect(summary).toContain("<ARTIFACT_ROOT>");
  });
});
