import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { STALE_COMMAND_REFERENCE_DETECTOR } from "../../../src/audits/codeRot/detectors/staleCommandReferenceDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "stale-cmd-test-"));
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

function buildContext(root: string, includeOverride?: string): AuditDetectorContext {
  const inventory = scanProjectInventory(root);
  const sourceOfTruth = collectSourceOfTruth(root, inventory);
  const target = resolveAuditTarget(undefined, root);
  const config = normalizeAuditConfig(includeOverride !== undefined ? { include: includeOverride } : {}, root);
  return { target, config, inventory, sourceOfTruth };
}

async function run(root: string, includeOverride?: string) {
  const ctx = buildContext(root, includeOverride);
  return STALE_COMMAND_REFERENCE_DETECTOR.run(ctx);
}

describe("STALE_COMMAND_REFERENCE_DETECTOR", () => {
  it("flags a current-docs command missing from package.json", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Run it with `npm run does-not-exist`.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("does-not-exist"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a planned/future command missing from package.json", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "## Planned\n\nA future command: `npm run future-thing`.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("future-thing"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("flags an implemented important public script missing from docs/COMMANDS.md", async () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { audit: "tsx scripts/audits/runAudit.ts" } })
      );
      writeFile(root, "docs/COMMANDS.md", "# Commands\n\nThis file does not mention the important script.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"audit"') && i.category === "undocumented-command")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag an internal helper script missing from docs", async () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { "internal-helper": "node helper.js" } })
      );
      writeFile(root, "docs/COMMANDS.md", "# Commands\n\nNo mention of the helper.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("internal-helper"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("stale command issue includes file path, command, excerpt, and recommendation", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Try `npm run ghost-command` today.\n");
      const issues = await run(root);
      const issue = issues.find((i) => i.title.includes("ghost-command"));
      expect(issue).toBeDefined();
      expect(issue?.affectedFiles).toContain("README.md");
      expect(issue?.evidence[0].filePath).toBe("README.md");
      expect(issue?.evidence[0].excerpt).toContain("ghost-command");
      expect(issue?.recommendedAction.length).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });

  it("de-duplicates repeated stale command references", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "README.md",
        "First mention: `npm run repeated-ghost`.\n\nSecond mention: `npm run repeated-ghost`.\n"
      );
      const issues = await run(root);
      const matches = issues.filter((i) => i.title.includes("repeated-ghost"));
      expect(matches).toHaveLength(1);
    } finally {
      cleanup(root);
    }
  });

  it("--include without docs skips this detector (shouldSkip)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Try `npm run ghost-command` today.\n");
      const ctx = buildContext(root, "package");
      const skip = STALE_COMMAND_REFERENCE_DETECTOR.shouldSkip?.(ctx);
      expect(skip?.skip).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("--include docs allows this detector to run", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Try `npm run ghost-command` today.\n");
      const ctx = buildContext(root, "docs");
      const skip = STALE_COMMAND_REFERENCE_DETECTOR.shouldSkip?.(ctx);
      expect(skip?.skip).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});


describe("qualified documented package commands", () => {
  it.each([
    { name: "setup cd with a later smoke reference", packageDir: "console", setup: ["cd console", "npm ci"], heading: "", script: "smoke:local" },
    { name: "setup cd with a later validation subsection", packageDir: "client", setup: ["cd client", "npm run prepare:demo"], heading: "## Rendering checks", script: "check:render" },
    { name: "root prefix setup with a later integration reference", packageDir: "service", setup: ["npm --prefix service ci", "npm --prefix service run prepare:demo"], heading: "## Integration gates", script: "smoke:process" },
    { name: "root prefix setup with a later permissions reference", packageDir: "worker", setup: ["npm --prefix worker run prepare:demo"], heading: "## Deployment checks", script: "check:roles" },
  ])("qualifies $name", async ({ packageDir, setup, heading, script }) => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ scripts: {} }));
      writeFile(root, `${packageDir}/package.json`, JSON.stringify({
        scripts: { [script]: "node check.js", "prepare:demo": "node setup.js" },
      }));
      writeFile(root, `${packageDir}/README.md`, [
        "# Component operator guide", "", "From the repository root:", "", "```powershell",
        ...setup, "```", "", heading, "", `The \`npm run ${script}\` command checks this component.`,
      ].join("\n"));
      const ctx = buildContext(root);
      expect(await STALE_COMMAND_REFERENCE_DETECTOR.run(ctx)).toEqual([]);
      expect(ctx.sourceOfTruth.warnings).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  it("tests the exact manifest and retains root finding identity and nested provenance", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", '{"scripts":{"root-ok":"node check.js"}}');
      writeFile(root, "units/one/package.json", '{"scripts":{"shared":"node check.js","only-one":"node local.js"}}');
      writeFile(root, "units/two/package.json", '{"scripts":{"shared":"node other.js"}}');
      writeFile(root, "units/empty/package.json", '{"name":"empty"}');
      writeFile(root, "README.md", [
        "`npm run root-ok`", "`npm run only-one`",
        "`npm --prefix units/one run shared`", "`npm --prefix units/two run shared`",
        "`npm --prefix units/one run only-one`", "`npm --prefix units/two run only-one`",
        "`npm --prefix units/empty run only-one`",
      ].join("\n"));
      const issues = await run(root);
      expect(await run(root)).toEqual(issues);
      expect(issues.map((issue) => issue.id)).toEqual([
        "stale-command-reference:README.md:missing-script:only-one",
        "stale-command-reference:README.md:missing-script:only-one:units/two/package.json",
        "stale-command-reference:README.md:missing-script:only-one:units/empty/package.json",
      ]);
      expect(issues[1].evidence).toEqual([
        expect.objectContaining({ filePath: "README.md", line: 6, excerpt: "`npm --prefix units/two run only-one`" }),
        expect.objectContaining({ filePath: "units/two/package.json" }),
      ]);
      expect(issues[1]).toMatchObject({ severity: "high", confidence: "high" });
    } finally {
      cleanup(root);
    }
  });

  it("bounds cd to its sequence and prefix to its invocation", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", '{"scripts":{"root-ok":"node check.js"}}');
      writeFile(root, "area/package.json", '{"scripts":{"area-ok":"node area.js"}}');
      writeFile(root, "area/leaf/package.json", '{"scripts":{"leaf-ok":"node leaf.js"}}');
      writeFile(root, "README.md", [
        "# Commands", "```sh", "cd area", "npm --prefix leaf run leaf-ok", "npm run area-ok",
        "npm run ghost", "```", "## Independent root sequence", "```sh",
        "npm run root-ok", "npm run area-ok", "```",
      ].join("\n"));
      const issues = await run(root);
      expect(issues.map((issue) => issue.id)).toEqual([
        "stale-command-reference:README.md:missing-script:ghost:area/package.json",
        "stale-command-reference:README.md:missing-script:area-ok",
      ]);
    } finally {
      cleanup(root);
    }
  });

  it("preserves unresolved context as review warnings and leaves planned examples out", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", '{"scripts":{"root-only":"node run.js"}}');
      writeFile(root, "bad/package.json", '{"scripts":{"root-only":24}}');
      writeFile(root, "broken/package.json", '{');
      writeFile(root, "area/package.json", '{"scripts":{"root-only":"node check.js"}}');
      writeFile(root, "README.md", [
        "`npm --prefix bad run root-only`", "`npm --prefix broken run missing`",
        "`npm --prefix unavailable run missing`", "`npm --prefix $PKG run root-only`",
        "`npm --prefix \"two words\" run root-only`", "`npm --prefix ../area run root-only`", "`npm --workspace area run missing`",
        "`cd area && npm run missing`", "```sh", "cd $PKG", "npm run root-only", "```",
        "## Future commands", "`npm --prefix unavailable run future`",
      ].join("\n"));
      const ctx = buildContext(root);
      expect(await STALE_COMMAND_REFERENCE_DETECTOR.run(ctx)).toEqual([]);
      const warnings = ctx.sourceOfTruth.warnings;
      expect(warnings).toHaveLength(9);
      expect(warnings[0]).toContain("malformed-scripts");
      expect(warnings[1]).toContain("malformed-manifest");
      expect(warnings[2]).toContain("no eligible inventory entry");
      expect(warnings.slice(3).every((warning) => warning.includes("unsupported or ambiguous"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });


  it("uses explicit repository-root guidance inside a package-local document", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", '{"scripts":{"root-ok":"node root.js"}}');
      writeFile(root, "unit/package.json", '{"scripts":{"unit-ok":"node check.js"}}');
      writeFile(root, "other/package.json", '{"scripts":{"other-ok":"node other.js"}}');
      writeFile(root, "unit/README.md", [
        "# Unit guide", "```sh", "cd unit", "npm ci", "```", "Use `npm run unit-ok` here.",
        "Also use `npm --prefix other run other-ok` from the repository root.",
        "## Repository root commands", "Use `npm run root-ok` for the repository.",
        "Use `npm run unit-ok` for a missing root command.",
        "## Unit checks", "Use `npm run unit-ok` for this unit.",
      ].join("\n"));
      const issues = await run(root);
      expect(issues.map((issue) => issue.id)).toEqual([
        "stale-command-reference:unit/README.md:missing-script:unit-ok",
      ]);
      expect(issues[0].evidence[0].line).toBe(10);
    } finally {
      cleanup(root);
    }
  });

  it("isolates a standalone snapshot from enclosing Git and keeps selected manifests", async () => {
    const parent = makeTempDir();
    try {
      const root = path.join(parent, "snapshot");
      writeFile(root, ".gitignore", "/module/\n");
      writeFile(root, "package.json", "{}");
      writeFile(root, "module/package.json", '{"scripts":{"check":"node check.js"}}');
      writeFile(root, "README.md", "`npm --prefix module run check`\n");
      const standalone = buildContext(root);
      expect(await STALE_COMMAND_REFERENCE_DETECTOR.run(standalone)).toEqual([]);
      expect(standalone.sourceOfTruth.warnings).toEqual([]);

      execFileSync("git", ["init", "--quiet"], { cwd: parent, windowsHide: true });
      writeFile(parent, ".gitignore", "/snapshot/\n");
      expect(execFileSync("git", ["check-ignore", "snapshot/module/package.json"], {
        cwd: parent, windowsHide: true, encoding: "utf8",
      }).trim()).toBe("snapshot/module/package.json");
      const enclosed = buildContext(root);
      expect(await STALE_COMMAND_REFERENCE_DETECTOR.run(enclosed)).toEqual([]);
      expect(enclosed.sourceOfTruth.warnings).toEqual([]);
      expect(enclosed.sourceOfTruth.nestedPackageScripts.get("module")).toEqual(
        standalone.sourceOfTruth.nestedPackageScripts.get("module")
      );
      expect(fs.existsSync(path.join(root, ".git"))).toBe(false);
    } finally {
      cleanup(parent);
    }
  });
});
