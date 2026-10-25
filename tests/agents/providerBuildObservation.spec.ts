import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { readFile, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { observeProviderBuild, trustedProviderLaunch, trustedProviderObservation } from "../../src/agents/providerBuildObservation.js";
import { runAgentPrompt } from "../../src/agents/runAgentPrompt.js";
import type { AgentRunRequest } from "../../src/agents/types.js";
import { makeProviderShim } from "../experiments/agentSuccessRate/realAgentTestHelpers.js";
import { makeTempDir, useSandboxTestCleanup } from "../evaluation/benchmarkSandbox/sandboxTestHelpers.js";

useSandboxTestCleanup();
function request(shim: ReturnType<typeof makeProviderShim>, capability: Awaited<ReturnType<typeof observeProviderBuild>>): AgentRunRequest {
  return { runId: "bound-test", agentId: capability.providerId, promptVariant: { id: "transport", strategy: "raw-full-file", complexityLevel: "short" } as AgentRunRequest["promptVariant"], promptText: "Case ID: bound\nContext mode: raw-full-file\n", cwd: shim.dir, outDir: path.join(shim.dir, "artifacts"), env: shim.env, timeoutMs: 5000, promptTransport: "stdin", trustedExecutable: capability };
}
// Controlled ancestor package scopes for the fake provider's temp location. "inherited" keeps whichever scope the run's TEMP
// sits under; the others place the shim beneath a disposable directory with its own package.json.
type ShimScope = "inherited" | "module" | "commonjs" | "untyped";
const SHIM_SCOPES: readonly ShimScope[] = ["inherited", "module", "commonjs", "untyped"];
function shimParent(scope: ShimScope): string | undefined {
  if (scope === "inherited") return undefined;
  const dir = makeTempDir("lab-asr-scope-");
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(scope === "untyped" ? {} : { type: scope }), "utf8");
  return dir;
}
const shimBin = (shim: ReturnType<typeof makeProviderShim>) => shim.env.PATH!.split(path.delimiter)[0]!;
describe("source-grounded provider capability, fake processes only", () => {
  it.each(["codex", "claude"] as const)("RSP-005/RSP-006 actual %s observation is task-free and bound to adapter launch", async provider => {
    const shim = makeProviderShim(provider); const cap = await observeProviderBuild(provider, { env: shim.env });
    expect(shim.invocationKeys()).toEqual([]);
    const bytes = JSON.parse((await trustedProviderObservation(cap, provider)).toString());
    expect(bytes.origin).toBe("inspected-local-executable"); expect(bytes.version).toBe("shim 1.0.0"); expect(bytes.limitation).toContain("not attested");
    const launch = await trustedProviderLaunch(cap, provider); expect(path.isAbsolute(launch.executable)).toBe(true);
    shim.respond("bound", "raw-full-file", "provider-only-answer");
    const result = await runAgentPrompt(request(shim, cap));
    expect(result.status).toBe("completed"); expect(result.finalAnswerText).toBe("provider-only-answer"); expect(result.command).toBe(launch.executable);
    expect(shim.invocationKeys()).toEqual(["bound.raw-full-file"]);
  }, 60000);
  it("RSP-004 synthetic claims and provider switching cannot construct authority", async () => {
    await expect(trustedProviderObservation({ providerId: "codex" }, "codex")).rejects.toThrow("UNVERIFIABLE");
    const shim = makeProviderShim("codex"); const cap = await observeProviderBuild("codex", { env: shim.env });
    await expect(trustedProviderLaunch(cap, "claude")).rejects.toThrow("UNVERIFIABLE");
    await expect(runAgentPrompt({ ...request(shim, cap), commandTemplate: { command: "other", args: [], promptPlaceholder: "{prompt}" } })).rejects.toThrow();
    expect(shim.invocationKeys()).toEqual([]);
  }, 60000);
  it("RSP-007 unrecognized wrapper is rejected without even a version task", async () => {
    const shim = makeProviderShim("codex"); const bin = shim.env.PATH!.split(path.delimiter)[0]!;
    const executable = path.join(bin, process.platform === "win32" ? "codex.cmd" : "codex");
    await writeFile(executable, process.platform === "win32" ? "@echo off\r\nnode evil.js %*\r\n" : "#!/bin/sh\necho 1.0.0\n");
    await expect(observeProviderBuild("codex", { env: shim.env })).rejects.toThrow("UNVERIFIABLE"); expect(shim.invocationKeys()).toEqual([]);
  });
  it("RSP-007 changed entry bytes invalidate a retained capability", async () => {
    const shim = makeProviderShim("codex"); const cap = await observeProviderBuild("codex", { env: shim.env });
    const launch = await trustedProviderLaunch(cap, "codex");
    const entry = launch.prefix[0]!; await writeFile(entry, (await readFile(entry, "utf8")) + "\n// replaced\n");
    await expect(trustedProviderObservation(cap, "codex")).rejects.toThrow("PROVIDER_BUILD_CHANGED"); expect(shim.invocationKeys()).toEqual([]);
  }, 60000);
  it.each(SHIM_SCOPES)("RSP-008 substituted PATH cannot redirect a bound invocation (%s ancestor package scope)", async scope => {
    const parentDir = shimParent(scope);
    const original = makeProviderShim("codex", { parentDir }), other = makeProviderShim("codex", { parentDir });
    const cap = await observeProviderBuild("codex", { env: original.env });
    const launch = await trustedProviderLaunch(cap, "codex");
    // Compare physical fixture identities using the same native resolution as
    // fs/promises.realpath in the producer (ordinary realpathSync can retain
    // the supplied TEMP casing on Windows). No provider evidence is rewritten.
    const launchBin = realpathSync.native(path.dirname(launch.prefix[0]!));
    expect(launchBin).toBe(realpathSync.native(shimBin(original)));
    expect(launchBin).not.toBe(realpathSync.native(shimBin(other)));
    original.respond("bound", "raw-full-file", "original"); other.respond("bound", "raw-full-file", "substitution");
    const req = request(original, cap); req.env = { ...original.env, PATH: other.env.PATH, Path: other.env.Path };
    expect((await runAgentPrompt(req)).finalAnswerText).toBe("original"); expect(other.invocationKeys()).toEqual([]); expect(original.invocationKeys()).toEqual(["bound.raw-full-file"]);
  }, 60000);
  it("module-scope negative control: without a shim-owned CommonJS boundary a type:module ancestor breaks the version probe fail-closed", async () => {
    const parentDir = shimParent("module")!;
    const broken = makeProviderShim("codex", { parentDir, omitModuleBoundary: true }), bounded = makeProviderShim("codex", { parentDir });
    const entry = (shim: ReturnType<typeof makeProviderShim>) => path.join(shimBin(shim), process.platform === "win32" ? "shim.js" : "codex");
    const probe = spawnSync(process.execPath, [entry(broken), "--version"], { encoding: "utf8", timeout: 10000 });
    expect(probe.status).not.toBe(0); expect(probe.stderr).toContain("require is not defined");
    await expect(observeProviderBuild("codex", { env: broken.env })).rejects.toThrow("PROVIDER_BUILD_UNVERIFIABLE"); expect(broken.invocationKeys()).toEqual([]);
    const fixed = spawnSync(process.execPath, [entry(bounded), "--version"], { encoding: "utf8", timeout: 10000 });
    expect(fixed.status).toBe(0); expect(fixed.stdout.trim()).toBe("shim 1.0.0");
    const marker = path.join(shimBin(bounded), "package.json");
    expect(existsSync(marker)).toBe(true); expect(JSON.parse(await readFile(marker, "utf8")).type).toBe("commonjs"); expect(marker.startsWith(parentDir)).toBe(true);
    expect(existsSync(path.join(shimBin(broken), "package.json"))).toBe(false);
  }, 60000);
  it("RSP-005 version flood is bounded and creates no provider task", async () => {
    const shim = makeProviderShim("codex"); const bin = shim.env.PATH!.split(path.delimiter)[0]!;
    const entry = path.join(bin, process.platform === "win32" ? "shim.js" : "codex");
    await writeFile(entry, (await readFile(entry, "utf8")).replace('console.log("shim 1.0.0")', 'console.log("x".repeat(10000))'));
    await expect(observeProviderBuild("codex", { env: shim.env })).rejects.toThrow("UNVERIFIABLE"); expect(shim.invocationKeys()).toEqual([]);
  }, 60000);
  it("RSP-007 switched symlink/junction resolution invalidates the observed target", async () => {
    const a = makeProviderShim("codex"), b = makeProviderShim("codex"); const alias = path.join(a.dir, "linked-bin");
    const dirA = a.env.PATH!.split(path.delimiter)[0]!, dirB = b.env.PATH!.split(path.delimiter)[0]!;
    await symlink(dirA, alias, process.platform === "win32" ? "junction" : "dir");
    const search = `${alias}${path.delimiter}${path.dirname(process.execPath)}`;
    const cap = await observeProviderBuild("codex", { env: { ...a.env, PATH: search, Path: search } });
    await unlink(alias); await symlink(dirB, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(trustedProviderObservation(cap, "codex")).rejects.toThrow("PROVIDER_BUILD_CHANGED"); expect(a.invocationKeys()).toEqual([]); expect(b.invocationKeys()).toEqual([]);
  }, 60000);
  it("RSP-005 a hung version process is bounded and sends no benchmark prompt", async () => {
    const shim = makeProviderShim("codex"); const bin = shim.env.PATH!.split(path.delimiter)[0]!;
    await writeFile(path.join(bin, process.platform === "win32" ? "shim.js" : "codex"), `${process.platform === "win32" ? "" : "#!/usr/bin/env node\n"}setTimeout(() => process.exit(0), 15000);\n`);
    const at = Date.now(); await expect(observeProviderBuild("codex", { env: shim.env })).rejects.toThrow("UNVERIFIABLE"); expect(Date.now() - at).toBeLessThan(14000); expect(shim.invocationKeys()).toEqual([]);
  }, 60000);
  it("RSP-018 provider-authored answer or diff text cannot fabricate a process limit", async () => {
    const shim = makeProviderShim("codex"); const cap = await observeProviderBuild("codex", { env: shim.env });
    const patch = "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-old\n+Rate limit exceeded. quota exhausted\n";
    shim.respond("bound", "raw-full-file", patch);
    const result = await runAgentPrompt(request(shim, cap)); expect(result.status).toBe("completed"); expect(result.errors).toEqual([]);
    shim.behave("bound", "raw-full-file", { exitCode: 1, stderr: patch });
    const failed = await runAgentPrompt({ ...request(shim, cap), outDir: path.join(shim.dir, "failed-artifacts") }); expect(failed.status).toBe("failed"); expect(failed.errors).not.toContain("Provider rate limit reached.");
  }, 60000);
});
