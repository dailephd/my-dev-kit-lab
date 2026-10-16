import { describe, expect, it } from "vitest";
import { runLabCli } from "../../src/cli/runLabCli.js";

async function help(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await runLabCli(argv, { writers: { stdout: (m: string) => (out += m), stderr: (m: string) => (err += m) } });
  return { code, out, err };
}

describe("report compare-prompts help surfaces", () => {
  it("lists the command in the root synopsis and command list", async () => {
    const root = await help(["--help"]);
    expect(root.code).toBe(0);
    expect(root.out).toContain("report compare-prompts --baseline <run-root> --candidate <run-root> --out <output-root>");
    expect(root.out).toMatch(/report compare-prompts\s+Compare two completed real-agent runs/);
    // Existing report command remains listed.
    expect(root.out).toContain("report render --experiment <dir> --out <dir> [options]");
  });

  it("keeps the report-family and nested help working", async () => {
    const family = await help(["report", "--help"]);
    expect(family.out).toContain("compare-prompts");
    const nested = await help(["report", "compare-prompts", "--help"]);
    expect(nested.code).toBe(0);
    expect(nested.out).toContain("--baseline <run-root>");
    expect(nested.out).toContain("never invokes a provider");
  });
});
