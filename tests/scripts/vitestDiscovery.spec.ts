import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("canonical Vitest discovery", () => {
  it("lists Lab tests without benchmark or local generated test copies", () => {
    const root = process.cwd();
    const output = execFileSync(
      process.execPath,
      [path.join(root, "node_modules", "vitest", "vitest.mjs"), "list", "--filesOnly", "--config", path.join(root, "vitest.config.ts")],
      { cwd: root, encoding: "utf8", windowsHide: true }
    );
    const files = output.split(/\r?\n/).filter((line) => /\.(test|spec)\.[jt]sx?$/.test(line));

    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.startsWith("tests/"))).toBe(true);
    expect(files).toContain("tests/scripts/vitestDiscovery.spec.ts");
  });
});
