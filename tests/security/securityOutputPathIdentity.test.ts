import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSecurityOutputPath, isSecuritySystemDirectoryAlias } from "../../src/securityValidation/report/writeSecurityReportFiles.js";

const owned: string[] = [];
afterEach(() => { for (const directory of owned.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
describe("security report physical path identity", () => {
  const genuine = { platform: "darwin" as NodeJS.Platform, path: "/var", symbolicLink: true, physicalPath: "/private/var", targetIsDirectory: true };
  it("accepts only the observed genuine macOS directory alias", () => {
    expect(isSecuritySystemDirectoryAlias(genuine)).toBe(true);
    for (const change of [{ platform: "win32" as NodeJS.Platform }, { path: "/tmp/link" }, { path: "/private/var" }, { physicalPath: "/elsewhere" }, { physicalPath: "/private/var/redirect" }, { targetIsDirectory: false }, { symbolicLink: false }]) expect(isSecuritySystemDirectoryAlias({ ...genuine, ...change })).toBe(false);
  });
  it("accepts an authorized nested destination but rejects linked parents and hard-linked files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "security-path-")); owned.push(root);
    const safe = path.join(root, "reports"); fs.mkdirSync(safe);
    expect(() => assertSecurityOutputPath(path.join(safe, "nested/result.json"), true)).not.toThrow();
    const leaf = path.join(safe, "result.json"); fs.writeFileSync(leaf, "original");
    fs.linkSync(leaf, path.join(root, "hard.json")); expect(() => assertSecurityOutputPath(leaf, true)).toThrow("Unsafe security output path");
    expect(fs.readFileSync(leaf, "utf8")).toBe("original");
    fs.symlinkSync(safe, path.join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
    expect(() => assertSecurityOutputPath(path.join(root, "alias/report.json"), true)).toThrow("Unsafe security output path");
    expect(() => assertSecurityOutputPath(path.join(leaf, "child"))).toThrow();
  });
  it.runIf(process.platform === "darwin")("accepts actual /var and /private/var directory identities", () => {
    expect(fs.realpathSync("/var")).toBe("/private/var");
    expect(() => assertSecurityOutputPath("/var")).not.toThrow();
    expect(() => assertSecurityOutputPath("/private/var")).not.toThrow();
    expect(() => assertSecurityOutputPath("/var", true)).toThrow();
  });
});
