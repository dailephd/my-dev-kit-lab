import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";

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
});
