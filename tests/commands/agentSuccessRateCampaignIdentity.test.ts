import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import * as observation from "../../src/agents/providerBuildObservation.js";
import { runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { captureCommand, cliFixture, latestCheckpoint, useCampaignCleanup } from "../experiments/agentSuccessRate/realProviderCampaignTestHelpers.js";

useCampaignCleanup();
it("RSP-020/RSP-033 public resume rejects changed current source bytes and preserves completed evidence", async () => {
  const f = await cliFixture();
  const executingMetadata = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as { name: string; version: string };
  const fixtureMetadata = JSON.parse(await readFile(path.join(f.toolRoot, "package.json"), "utf8")) as { name: string; version: string };
  expect(executingMetadata.version).toBe("0.9.1");
  expect(fixtureMetadata.name).toBe(executingMetadata.name);
  expect(fixtureMetadata.version).toBe(executingMetadata.version);
  const sourceRoot = path.join(f.root, "source");
  await mkdir(sourceRoot);
  await cp(path.join(process.cwd(), "src"), path.join(sourceRoot, "src"), { recursive: true });
  for (const name of ["package.json", "package-lock.json"]) await cp(path.join(process.cwd(), name), path.join(sourceRoot, name));
  const flags = [...f.base]; flags[flags.indexOf("--campaign-source-root") + 1] = sourceRoot;
  const observed = vi.spyOn(observation, "observeProviderBuild");
  const created = await captureCommand(() => runExperimentRunCommandFromArgs([...flags, "--agent-campaign", "new"], { context: f.context }));
  expect(created.code).toBe(0);
  const checkpoint = await latestCheckpoint(f.outputRoot);
  const scientific = await readFile(path.join(f.outputRoot, "agent-success-rate-execution.json"));
  const originalPath = path.join(process.cwd(), "src/experiments/plugins/agentSuccessRate/campaignRecovery.ts");
  const original = await readFile(originalPath);
  await writeFile(path.join(sourceRoot, "src/experiments/plugins/agentSuccessRate/campaignRecovery.ts"), Buffer.concat([original, Buffer.from("\n// changed current bytes\n")]));
  const resumed = await captureCommand(() => runExperimentRunCommandFromArgs([...flags, "--agent-campaign", "resume"], { context: f.context }));
  expect(resumed.code).toBe(1); expect(resumed.stderr).toContain("IDENTITY_MISMATCH");
  expect(await latestCheckpoint(f.outputRoot)).toEqual(checkpoint);
  expect(await readFile(path.join(f.outputRoot, "agent-success-rate-execution.json"))).toEqual(scientific);
  expect(await readFile(originalPath)).toEqual(original);
  expect(observed).not.toHaveBeenCalled(); expect(f.shim.invocationKeys()).toEqual([]);
}, 120000);

it.each([
  ["mismatched package version", async (sourceRoot: string) => {
    const metadata = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8")) as Record<string, unknown>;
    metadata.version = "0.9.0";
    await writeFile(path.join(sourceRoot, "package.json"), JSON.stringify(metadata));
  }],
  ["spoofed package name", async (sourceRoot: string) => {
    const metadata = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8")) as Record<string, unknown>;
    metadata.name = "@example/my-dev-kit-lab";
    await writeFile(path.join(sourceRoot, "package.json"), JSON.stringify(metadata));
  }],
  ["missing package version", async (sourceRoot: string) => {
    await writeFile(path.join(sourceRoot, "package.json"), JSON.stringify({ name: "@dailephd/my-dev-kit-lab" }));
  }],
  ["missing package metadata", async (sourceRoot: string) => {
    await rm(path.join(sourceRoot, "package.json"));
  }],
  ["missing source files", async (sourceRoot: string) => {
    await rm(path.join(sourceRoot, "src"), { recursive: true });
  }]
] as const)("rejects %s before creating campaign state", async (_description, mutate) => {
  const f = await cliFixture();
  const sourceRoot = path.join(f.root, "source");
  await mkdir(sourceRoot);
  await cp(path.join(process.cwd(), "src"), path.join(sourceRoot, "src"), { recursive: true });
  for (const name of ["package.json", "package-lock.json"]) await cp(path.join(process.cwd(), name), path.join(sourceRoot, name));
  await mutate(sourceRoot);
  const flags = [...f.base]; flags[flags.indexOf("--campaign-source-root") + 1] = sourceRoot;
  const result = await captureCommand(() => runExperimentRunCommandFromArgs([...flags, "--agent-campaign", "new"], { context: f.context }));
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("CAMPAIGN_SOURCE_UNVERIFIABLE");
  await expect(readFile(path.join(f.outputRoot, "campaign-checkpoints-v2", "index.json"))).rejects.toThrow();
  expect(f.shim.invocationKeys()).toEqual([]);
}, 120000);

it.each([
  ["spoofed executing package name", (metadata: Record<string, unknown>) => { metadata.name = "@example/my-dev-kit-lab"; }],
  ["invalid executing package version", (metadata: Record<string, unknown>) => { metadata.version = "latest"; }]
] as const)("rejects %s before trusting source bytes", async (_description, mutate) => {
  const f = await cliFixture();
  const packagePath = path.join(f.toolRoot, "package.json");
  const metadata = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown>;
  mutate(metadata);
  await writeFile(packagePath, JSON.stringify(metadata));
  const result = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "new"], { context: f.context }));
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("CAMPAIGN_SOURCE_UNVERIFIABLE");
  await expect(readFile(path.join(f.outputRoot, "campaign-checkpoints-v2", "index.json"))).rejects.toThrow();
  expect(f.shim.invocationKeys()).toEqual([]);
}, 120000);
