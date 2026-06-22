import { describe, expect, it } from "vitest";
import { parseNpmAudit } from "../../src/securityValidation/dependencies/parseNpmAudit.js";
import { parseNpmLs } from "../../src/securityValidation/dependencies/parseNpmLs.js";
import { parseNpmOutdated } from "../../src/securityValidation/dependencies/parseNpmOutdated.js";

// ---------------------------------------------------------------------------
// parseNpmAudit
// ---------------------------------------------------------------------------

describe("parseNpmAudit — clean audit", () => {
  it("returns ok when there are no vulnerabilities", () => {
    const cleanAudit = JSON.stringify({
      metadata: {
        vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 },
      },
      vulnerabilities: {},
    });
    const result = parseNpmAudit(cleanAudit, "test");
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.severityCounts.total).toBe(0);
  });

  it("returns ok and empty findings for empty stdout", () => {
    const result = parseNpmAudit("", "test");
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.parseError).toBeUndefined();
  });

  it("returns a parseError for invalid JSON", () => {
    const result = parseNpmAudit("not json {{{", "test");
    expect(result.ok).toBe(false);
    expect(result.parseError).toBeTruthy();
    expect(result.findings).toHaveLength(0);
  });

  it("returns a parseError for JSON that is not an object", () => {
    const result = parseNpmAudit("[]", "test");
    expect(result.ok).toBe(false);
    expect(result.parseError).toBeTruthy();
  });

  it("parses a single high-severity vulnerability into a blocker finding", () => {
    const auditWithVuln = JSON.stringify({
      metadata: {
        vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 0, info: 0, total: 1 },
      },
      vulnerabilities: {
        "vulnerable-pkg": {
          name: "vulnerable-pkg",
          severity: "high",
          range: ">=1.0.0 <1.2.3",
          via: [
            {
              source: 12345,
              title: "Remote code execution",
              url: "https://github.com/advisories/GHSA-test",
              severity: "high",
            },
          ],
        },
      },
    });
    const result = parseNpmAudit(auditWithVuln, "test");
    expect(result.ok).toBe(false);
    expect(result.severityCounts.high).toBe(1);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].severity).toBe("blocker");
    expect(result.findings[0].category).toBe("dependency-audit");
    expect(result.findings[0].title).toContain("vulnerable-pkg");
  });

  it("parses a moderate vulnerability as a major finding", () => {
    const auditWithModerate = JSON.stringify({
      metadata: {
        vulnerabilities: { critical: 0, high: 0, moderate: 1, low: 0, info: 0, total: 1 },
      },
      vulnerabilities: {
        "mod-pkg": {
          name: "mod-pkg",
          severity: "moderate",
          range: ">=2.0.0 <2.1.0",
          via: [{ source: 99, title: "Prototype pollution", url: "https://example.com", severity: "moderate" }],
        },
      },
    });
    const result = parseNpmAudit(auditWithModerate, "test");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].severity).toBe("major");
  });

  it("generates unique finding ids for multiple vulnerabilities", () => {
    const auditWithTwo = JSON.stringify({
      metadata: {
        vulnerabilities: { critical: 0, high: 2, moderate: 0, low: 0, info: 0, total: 2 },
      },
      vulnerabilities: {
        "pkg-a": {
          severity: "high",
          range: ">=1.0.0",
          via: [{ source: 1, title: "RCE in pkg-a", url: "https://example.com/1", severity: "high" }],
        },
        "pkg-b": {
          severity: "high",
          range: ">=2.0.0",
          via: [{ source: 2, title: "RCE in pkg-b", url: "https://example.com/2", severity: "high" }],
        },
      },
    });
    const result = parseNpmAudit(auditWithTwo, "test");
    const ids = result.findings.map((f) => f.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// parseNpmLs
// ---------------------------------------------------------------------------

describe("parseNpmLs — dependency tree checks", () => {
  it("returns ok for a clean dependency tree", () => {
    const cleanLs = JSON.stringify({
      name: "my-dev-kit-lab",
      version: "0.1.0",
      dependencies: {
        typescript: { version: "5.8.3", resolved: "..." },
      },
    });
    const result = parseNpmLs(cleanLs, "test");
    expect(result.ok).toBe(true);
    expect(result.missingCount).toBe(0);
    expect(result.invalidCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("returns ok for empty stdout", () => {
    const result = parseNpmLs("", "test");
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("returns a parseError for invalid JSON", () => {
    const result = parseNpmLs("{invalid}", "test");
    expect(result.parseError).toBeTruthy();
    expect(result.ok).toBe(false);
  });

  it("detects a missing dependency", () => {
    const lsWithMissing = JSON.stringify({
      name: "my-dev-kit-lab",
      version: "0.1.0",
      dependencies: {
        "missing-pkg": { name: "missing-pkg", missing: true },
      },
    });
    const result = parseNpmLs(lsWithMissing, "test");
    expect(result.ok).toBe(false);
    expect(result.missingCount).toBe(1);
    expect(result.findings.length).toBe(1);
    expect(result.findings[0].severity).toBe("major");
  });

  it("detects an invalid dependency", () => {
    const lsWithInvalid = JSON.stringify({
      name: "my-dev-kit-lab",
      version: "0.1.0",
      dependencies: {
        "invalid-pkg": { name: "invalid-pkg", invalid: true },
      },
    });
    const result = parseNpmLs(lsWithInvalid, "test");
    expect(result.invalidCount).toBe(1);
    expect(result.findings[0].severity).toBe("minor");
  });
});

// ---------------------------------------------------------------------------
// parseNpmOutdated
// ---------------------------------------------------------------------------

describe("parseNpmOutdated — outdated package detection", () => {
  it("returns zero count for empty output", () => {
    const result = parseNpmOutdated("", "test");
    expect(result.outdatedCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("returns zero count for empty JSON object", () => {
    const result = parseNpmOutdated("{}", "test");
    expect(result.outdatedCount).toBe(0);
  });

  it("returns a parseError for invalid JSON", () => {
    const result = parseNpmOutdated("not json", "test");
    expect(result.parseError).toBeTruthy();
  });

  it("parses outdated packages as informational findings", () => {
    const outdatedOutput = JSON.stringify({
      typescript: {
        current: "5.0.0",
        wanted: "5.8.3",
        latest: "5.8.3",
        dependent: "my-dev-kit-lab",
        location: "node_modules/typescript",
      },
    });
    const result = parseNpmOutdated(outdatedOutput, "test");
    expect(result.outdatedCount).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("informational");
    expect(result.findings[0].category).toBe("dependency-audit");
    expect(result.findings[0].title).toContain("typescript");
  });
});
