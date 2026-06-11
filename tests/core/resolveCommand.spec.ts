import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeBin(files: string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "resolver-bin-"));
  tempDirs.push(dir);
  for (const file of files) {
    writeFileSync(path.join(dir, file), "echo shim\n", "utf8");
  }
  return dir;
}

describe("resolveCommand", () => {
  it("resolves non-Windows direct commands without shell behavior", () => {
    const result = resolveCommand("node", { platform: "linux" });
    expect(result.command).toBe("node");
    expect(result.argsPrefix).toEqual([]);
    expect(result.resolutionKind).toBe("direct");
  });

  it("resolves extensionless Windows command to .cmd", () => {
    const bin = makeBin(["codex.cmd"]);
    const result = resolveCommand("codex", { platform: "win32", env: { Path: bin } });
    expect(result.command.toLowerCase()).toContain("cmd");
    expect(result.resolvedPath).toBe(path.join(bin, "codex.cmd"));
    expect(result.argsPrefix).toContain(path.join(bin, "codex.cmd"));
    expect(result.resolutionKind).toBe("windows-cmd-shim");
  });

  it("prefers .cmd over .ps1 when both exist", () => {
    const bin = makeBin(["codex.ps1", "codex.cmd"]);
    const result = resolveCommand("codex", { platform: "win32", env: { Path: bin } });
    expect(result.resolvedPath).toBe(path.join(bin, "codex.cmd"));
    expect(result.resolutionKind).toBe("windows-cmd-shim");
  });

  it("resolves .ps1 through controlled PowerShell invocation", () => {
    const bin = makeBin(["codex.ps1"]);
    const result = resolveCommand("codex", { platform: "win32", env: { Path: bin } });
    expect(result.command).toBe("powershell.exe");
    expect(result.argsPrefix).toEqual(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(bin, "codex.ps1")]);
    expect(result.resolutionKind).toBe("windows-powershell-shim");
  });

  it("returns unavailable for missing Windows commands", () => {
    const bin = makeBin([]);
    const result = resolveCommand("missing", { platform: "win32", env: { Path: bin } });
    expect(result.resolutionKind).toBe("unavailable");
    expect(result.warnings[0]).toContain("not found");
  });

  it("handles command paths with spaces", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "resolver-space-"));
    tempDirs.push(root);
    const dir = path.join(root, "dir with spaces");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "codex.cmd"), "echo shim\n", "utf8");
    const result = resolveCommand(path.join(dir, "codex"), { platform: "win32" });
    expect(result.resolvedPath).toBe(path.join(dir, "codex.cmd"));
  });
});
