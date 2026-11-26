import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { PACKAGE_RELEASE_ROT_DETECTOR } from "../../../src/audits/codeRot/detectors/packageReleaseRotDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pkg-release-rot-test-"));
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

function writeFile(root: string, relativePath: string, content = ""): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function buildContext(root: string): AuditDetectorContext {
  const inventory = scanProjectInventory(root);
  const sourceOfTruth = collectSourceOfTruth(root, inventory);
  const target = resolveAuditTarget(undefined, root);
  const config = normalizeAuditConfig({}, root);
  return { target, config, inventory, sourceOfTruth };
}

async function run(root: string) {
  const ctx = buildContext(root);
  return PACKAGE_RELEASE_ROT_DETECTOR.run(ctx);
}

describe("PACKAGE_RELEASE_ROT_DETECTOR — version/name consistency", () => {
  it("flags a package.json/package-lock.json version mismatch", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "2.0.0" }));
      writeFile(root, "package-lock.json", JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }));
      const issues = await run(root);
      const issue = issues.find((i) => i.category === "package-release-rot" && i.title.includes("version mismatch"));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("blocker");
    } finally {
      cleanup(root);
    }
  });

  it("flags a package.json/package-lock.json name mismatch", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture-a", version: "1.0.0" }));
      writeFile(root, "package-lock.json", JSON.stringify({ name: "fixture-b", version: "1.0.0", lockfileVersion: 3 }));
      const issues = await run(root);
      const issue = issues.find((i) => i.category === "package-release-rot" && i.title.includes("name mismatch"));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("high");
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a consistent package.json/package-lock.json pair", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "package-lock.json", JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }));
      const issues = await run(root);
      expect(issues.some((i) => i.category === "package-release-rot")).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("PACKAGE_RELEASE_ROT_DETECTOR — CHANGELOG", () => {

  async function changelogIssues(version: string, content: string) {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version }));
      writeFile(root, "CHANGELOG.md", content);
      return (await run(root)).filter((issue) => issue.id.includes(":missing-current-version-section:"));
    } finally {
      cleanup(root);
    }
  }

  it.each([
    "## [0.4.4]",
    "## [v0.4.4]",
    "## 0.4.4",
    "## v0.4.4",
    "## [0.4.4] - 2026-11-25",
    "## [v0.4.4] - Unreleased",
    "## [0.4.4] Maintenance release",
    "## [0.4.4]: Fixes",
    "## v0.4.4—Fixes",
    "## v0.4.4 — Maintenance and fixes — 2026-10-28",
    "## 0.4.4 – Bug fixes",
    "## 0.4.4 - Bug fixes",
    "## v0.4.4: Release description",
    "## v0.4.4 (2026-11-25)",
    "   ##\tv0.4.4 ###\t",
  ])("recognizes the release heading %s", async (heading) => {
    expect(await changelogIssues("0.4.4", `# Changelog\n\n${heading}\n`)).toEqual([]);
  });

  it.each([
    "## 0.4.40", "## v0.4.40", "## [0.4.40]", "## 10.4.4",
    "## 0.4.4-beta.1", "## 0.4.4+other", "## v0.4.4something",
    "## V0.4.4", "## vv0.4.4", "## 0.4.4 plain trailing prose",
    "The current release is v0.4.4.", "- v0.4.4", "> ## v0.4.4", "`## v0.4.4`",
    "# v0.4.4", "### v0.4.4", "## Changes since v0.4.4", "## Unreleased",
    "##[0.4.4]", "    ## v0.4.4", "## [0.4.4", "## v0.4.4]", "## [0.4.4]]",
    "## [0.4.4]suffix", "##\n[0.4.4]",
  ])("retains the missing finding for %s", async (content) => {
    expect(await changelogIssues("0.4.4", content)).toHaveLength(1);
  });

  it.each([
    { version: "0.4.4-beta.1", matching: "## [v0.4.4-beta.1]", other: "## 0.4.4\n## 0.4.4-beta.2" },
    { version: "0.4.4+build.1", matching: "## v0.4.4+build.1", other: "## 0.4.4\n## 0.4.4+build.2" },
  ])("requires the exact package version $version", async ({ version, matching, other }) => {
    expect(await changelogIssues(version, matching)).toEqual([]);
    expect(await changelogIssues(version, other)).toHaveLength(1);
  });

  it.each([
    ["````markdown", "```", "~~~~", "`````"],
    ["~~~~ markdown", "~~~", "````", "~~~~"],
  ])("ignores headings within a %s fence", async (opening, short, other, closing) => {
    const fenced = [opening, "## [0.4.4]", short, "## v0.4.4", other, "## 0.4.4", closing].join("\n");
    expect(await changelogIssues("0.4.4", fenced)).toHaveLength(1);
    expect(await changelogIssues("0.4.4", fenced + "\n## v0.4.4")).toEqual([]);
  });

  it("ignores commented-out examples and recognizes a later section", async () => {
    const commented = "<!-- ## [0.4.4] -->\n<!--\n```\n## v0.4.4\n-->\n";
    expect(await changelogIssues("0.4.4", commented)).toHaveLength(1);
    expect(await changelogIssues("0.4.4", commented + "## v0.4.4")).toEqual([]);
    expect(await changelogIssues("0.4.4", "An example token is \`<!--\`.\n## v0.4.4")).toEqual([]);
  });

  it.each([
    ["<pre>", "</pre>"],
    ["<div>", "</div>\n"],
    ["<![CDATA[", "]]>"],
  ])("ignores heading-like text in the %s HTML block", async (open, close) => {
    const block = [open, "## [0.4.4]", close].join("\n");
    expect(await changelogIssues("0.4.4", block)).toHaveLength(1);
    expect(await changelogIssues("0.4.4", block + "\n## v0.4.4")).toEqual([]);
  });

  it("qualifies the same heading under LF and CRLF", async () => {
    const content = "```markdown\n## [0.4.4]\n```\n## v0.4.4 — Fixes\n";
    expect(await changelogIssues("0.4.4", content)).toEqual([]);
    expect(await changelogIssues("0.4.4", content.replaceAll("\n", "\r\n"))).toEqual([]);
  });

  it("preserves the missing-section identity and policy with format-neutral guidance", async () => {
    const [issue] = await changelogIssues("0.4.4", "## [0.4.3] - 2026-10-01");
    expect(issue).toMatchObject({
      id: "package-release-rot:CHANGELOG.md:missing-current-version-section:0.4.4",
      detectorId: "package-release-rot",
      category: "package-release-rot",
      severity: "high",
      confidence: "high",
      releaseBlocking: false,
      implementationBlocking: false,
      autoFixEligible: false,
    });
    expect(issue.description).toContain("no supported release heading");
    expect(issue.recommendedAction).toContain("for example");
    expect(issue.suggestedFixStrategy).toContain("level-two heading");
    expect(issue.evidence[0].message).toContain("No supported release heading");
  });

  it("retains the oversized CHANGELOG policy", async () => {
    const oversized = "## v0.4.3\n" + "x".repeat(200_000);
    expect(await changelogIssues("0.4.4", oversized)).toEqual([]);
  });

  it("flags a missing current-version section in CHANGELOG.md", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "2.0.0" }));
      writeFile(root, "CHANGELOG.md", "# Changelog\n\n## [1.0.0] - 2024-01-01\n\nInitial release.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("no section for the current package version"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag when the current-version section is present", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "2.0.0" }));
      writeFile(root, "CHANGELOG.md", "# Changelog\n\n## [2.0.0] - Unreleased\n\nWork in progress.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("no section for the current package version"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("PACKAGE_RELEASE_ROT_DETECTOR — doc version and publish claims", () => {
  it("flags a docs current-version mismatch", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "2.0.0" }));
      writeFile(root, "README.md", "The current package is v1.0.0.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("outdated current version"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("flags a docs publish/release claim without local support", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "README.md", "This package is now published to npm.\n");
      const issues = await run(root);
      const issue = issues.find((i) => i.title.includes("claims publication/release/tag"));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("blocker");
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a correctly-hedged 'not yet published' statement", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "README.md", "This package has not yet been published to npm.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("claims publication/release/tag"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("PACKAGE_RELEASE_ROT_DETECTOR — files field and self-referencing scripts", () => {
  it("flags an obviously risky package.json files entry", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", files: ["dist/", "reports/"] }));
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('risky-looking path'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("flags a script referencing an undefined script", async () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({
          name: "fixture",
          version: "1.0.0",
          scripts: { release: "npm run does-not-exist-script" },
        })
      );
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("references undefined script"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });
});

describe("PACKAGE_RELEASE_ROT_DETECTOR — local-only guarantee", () => {
  it("does not call npm pack, npm view, or require internet (structural + timing check)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const start = Date.now();
      await run(root);
      const elapsedMs = Date.now() - start;
      // A real npm pack/view invocation would take at least hundreds of ms
      // (subprocess spawn) or fail/hang without network -- a pure local
      // detector completes near-instantly.
      expect(elapsedMs).toBeLessThan(1000);
    } finally {
      cleanup(root);
    }
  });

  it("source does not import child_process or call any subprocess-execution helper", () => {
    // Note: the source legitimately contains the advisory *strings*
    // "npm pack --dry-run" / "npm run <script>" inside issue
    // validationCommands (suggestions for a human to run manually) -- this
    // check targets actual subprocess-execution APIs, not those strings.
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/audits/codeRot/detectors/packageReleaseRotDetector.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/child_process|execSync\(|execFileSync\(|spawnSync\(|\bspawn\(/);
  });
});

describe("PACKAGE_RELEASE_ROT_DETECTOR — real self-scan regression guard", () => {
  it("produces no findings against this repo's own current, hedged docs", async () => {
    const issues = await run(process.cwd());
    // This repo's docs were deliberately hedged in earlier release-prep
    // work; a regression here means either a real doc went stale or a
    // detector heuristic became too aggressive.
    expect(issues).toEqual([]);
  });
});
