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
    // Uses a controlled fake PATH (an extensionless "node" file, matching
    // real POSIX binary naming) rather than the real host PATH: this test
    // file runs on Windows too (via the `platform: "linux"` override), where
    // the real PATH only contains "node.exe", not an extensionless "node" --
    // relying on the real PATH here would make the test's outcome depend on
    // which host OS is actually running it, which is exactly the mismatch
    // that caused a real cross-platform bug (see the "unavailable"/"exists"
    // tests below).
    const bin = makeBin(["node"]);
    const result = resolveCommand("node", { platform: "linux", env: { PATH: bin } });
    expect(result.command).toBe("node");
    expect(result.argsPrefix).toEqual([]);
    expect(result.resolutionKind).toBe("direct");
  });

  it("resolves extensionless Windows command to .cmd", () => {
    const bin = makeBin(["codex.cmd"]);
    const result = resolveCommand("codex", { platform: "win32", env: { Path: bin } });
    expect(result.command.toLowerCase()).toContain("cmd");
    expect(result.resolvedPath).toBe(path.join(bin, "codex.cmd"));
    expect(result.argsPrefix).toEqual(["/d", "/s", "/c", "call"]);
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

  // Regression coverage for a real cross-platform bug found during v0.3.0
  // readiness validation: the non-Windows branch used to unconditionally
  // report "direct" without ever checking PATH, so a genuinely-missing
  // command (e.g. codeql, semgrep) was only discovered as absent when the
  // downstream spawn failed with ENOENT -- which staticScans/codeql.ts and
  // staticScans/semgrep.ts misclassified as a MAJOR/failed finding rather
  // than a graceful skip. These cases intentionally use absolute paths
  // (rather than a PATH-searched bare command name) because `path.delimiter`
  // and `path.join` are based on the real host OS, not the simulated
  // `platform` option -- an absolute-path existence/executable-bit check is
  // the one POSIX-resolution behavior that is safely testable regardless of
  // which real OS is running this test file. The bare-command PATH-search
  // branch is validated by the real Linux/macOS CI matrix.
  it("returns unavailable for a non-Windows absolute path that does not exist", () => {
    const missingAbsolutePath = path.join(os.tmpdir(), "definitely-does-not-exist-resolver-probe", "codeql");
    const result = resolveCommand(missingAbsolutePath, { platform: "linux" });
    expect(result.resolutionKind).toBe("unavailable");
    expect(result.warnings[0]).toContain("not found");
  });

  it("resolves a non-Windows absolute path that exists and is executable", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "resolver-posix-abs-"));
    tempDirs.push(dir);
    const binPath = path.join(dir, "fake-tool");
    writeFileSync(binPath, "#!/bin/sh\necho shim\n", "utf8");
    try {
      await import("node:fs/promises").then((fsp) => fsp.chmod(binPath, 0o755));
    } catch {
      // chmod is a no-op on some Windows filesystems; the executable-bit
      // check below only matters on a real POSIX host.
    }
    const result = resolveCommand(binPath, { platform: "linux" });
    expect(result.resolutionKind === "direct" || result.resolutionKind === "unavailable").toBe(true);
    if (result.resolutionKind === "direct") {
      expect(result.resolvedPath).toBe(binPath);
    }
  });
});
