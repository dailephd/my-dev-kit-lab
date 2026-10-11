import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeProviderShim } from "../experiments/agentSuccessRate/realAgentTestHelpers.js";
import { useSandboxTestCleanup } from "../evaluation/benchmarkSandbox/sandboxTestHelpers.js";

useSandboxTestCleanup();
const entry = path.resolve("dist/scripts/cli.js");
describe("compiled installed-style CLI acceptance (run after normal verify builds current source)", () => {
  it("RSP-038 help and JSON description expose the same campaign flags", () => {
    const shim = makeProviderShim("codex"); const env = { ...process.env, ...shim.env };
    const help = spawnSync(process.execPath, [entry, "experiment", "run", "--help"], { cwd: shim.dir, env, encoding: "utf8", windowsHide: true, timeout: 30000 });
    expect(help.status).toBe(0); expect(help.stdout).toContain("--agent-campaign <new|resume|continue-limit>"); expect(help.stdout).toContain("--timeout-preset");
    const description = spawnSync(process.execPath, [entry, "experiment", "describe", "--experiment", "agent-success-rate", "--json"], { cwd: shim.dir, env, encoding: "utf8", windowsHide: true, timeout: 30000 });
    expect(description.status).toBe(0); expect(JSON.parse(description.stdout).agentSuccessRate.campaign.modes).toEqual(["new", "resume", "continue-limit"]); expect(shim.invocationKeys()).toEqual([]);
  });
  it.each([
    ["--agent-campaign", "invalid", "--out", "unused"],
    ["--agent-campaign", "new", "--out", "unused", "--agent", "codex"],
    ["--agent-campaign", "continue-limit", "--out", "unused"],
    ["--agent-campaign", "new", "--out", "unused", "--agent", "codex", "--include-real-agents", "--timeout-preset", "standard", "--timeout-ms", "1000"]
  ].map(flags => [flags] as const))("RSP-038 compiled parser rejects usage with exit two without provider task: %j", flags => {
    const shim = makeProviderShim("codex");
    const result = spawnSync(process.execPath, [entry, "experiment", "run", "--experiment", "agent-success-rate", ...flags], { cwd: shim.dir, env: { ...process.env, ...shim.env }, encoding: "utf8", windowsHide: true, timeout: 30000 });
    expect(result.status).toBe(2); expect(result.stderr.length).toBeGreaterThan(0); expect(shim.invocationKeys()).toEqual([]);
  });
  it("RSP-038 unrelated installed route remains available", () => {
    const result = spawnSync(process.execPath, [entry, "experiment", "list", "--json"], { encoding: "utf8", windowsHide: true, timeout: 30000 }); expect(result.status).toBe(0); expect(result.stdout).toContain("warm-index-reuse");
  });
});
