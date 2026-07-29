import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

const testScriptNames = Object.keys(pkg.scripts).filter((name) => name.startsWith("test:"));

describe("package script contract: test vs verify", () => {
  it("defines a canonical full test script", () => {
    expect(pkg.scripts.test).toBe("vitest run");
  });

  it("defines a verify script", () => {
    expect(pkg.scripts.verify).toBeDefined();
  });

  it("does not invoke npm run test from verify", () => {
    expect(pkg.scripts.verify).not.toMatch(/npm run test(\s|$)/);
  });

  it("does not invoke bare npm test from verify", () => {
    expect(pkg.scripts.verify).not.toMatch(/(^|\s)npm test(\s|$)/);
  });

  it("does not invoke the bare vitest runner from verify", () => {
    expect(pkg.scripts.verify).not.toMatch(/vitest run(?!\s)/);
  });

  it("does not chain any focused test:* script into verify", () => {
    for (const name of testScriptNames) {
      expect(pkg.scripts.verify).not.toMatch(new RegExp(`npm run ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`));
    }
  });

  it("retains the non-test verification gates in verify", () => {
    expect(pkg.scripts.verify).toMatch(/npm run build/);
    expect(pkg.scripts.verify).toMatch(/npm run verify:benchmarks/);
  });
});
