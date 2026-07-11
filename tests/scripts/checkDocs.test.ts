import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("docs:check", () => {
  it("validates the current documentation invariants", () => {
    const resolved = resolveCommand("node", { cwd: process.cwd() });
    const needsResolvedPathArg =
      resolved.resolutionKind === "windows-cmd-shim" || resolved.resolutionKind === "windows-powershell-shim";
    const output = execFileSync(
      resolved.command,
      [...resolved.argsPrefix, ...(needsResolvedPathArg && resolved.resolvedPath ? [resolved.resolvedPath] : []), "scripts/check-docs.mjs"],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    expect(output).toContain("Documentation consistency check passed");
  });

  it.each([
    ["README.md", "v0.4.1 is published", "released or publish-ready"],
    ["README.md", "", "missing invariant: --android-external-tools"],
    ["docs/COMMANDS.md", "`unknown-tool`", "missing invariant: `semgrep`"],
  ])("rejects stale or incomplete documentation: %s", (changedFile, replacement, expected) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "docs-check-"));
    try {
      for (const file of ["README.md", "CHANGELOG.md", "docs/PROJECT_OVERVIEW.md", "docs/ARCHITECTURE.md", "docs/COMMANDS.md", "docs/WORKFLOWS.md", "docs/ROADMAP.md", "docs/CURRENT_STATE.md", "docs/security-validation-framework.md", "package.json"]) {
        const destination = path.join(temp, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(path.resolve(file), destination);
      }
      if (changedFile === "README.md" && replacement === "") fs.writeFileSync(path.join(temp, changedFile), fs.readFileSync(path.join(temp, changedFile), "utf8").replace(/--android-external-tools/g, "external-tools-flag"));
      else if (changedFile === "docs/COMMANDS.md") fs.writeFileSync(path.join(temp, changedFile), fs.readFileSync(path.join(temp, changedFile), "utf8").replace(/`semgrep`/g, replacement));
      else fs.appendFileSync(path.join(temp, changedFile), `\n${replacement}\n`);
      expect(() => execFileSync(process.execPath, ["scripts/check-docs.mjs"], { cwd: process.cwd(), env: { ...process.env, DOCS_CHECK_ROOT: temp }, encoding: "utf8", stdio: "pipe" })).toThrow(expected);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
});
