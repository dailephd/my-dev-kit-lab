import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, vi } from "vitest";
import type { AgentSuccessTaskV1 } from "../../../src/evaluation/agentSuccess/index.js";
import type { CampaignCheckpointV2 } from "../../../src/experiments/plugins/agentSuccessRate/campaignRecovery.js";
import type { LabExecutionContext } from "../../../src/runtime/index.js";
import { makeProviderShim, makeSourceBackedKit } from "./realAgentTestHelpers.js";
import { useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";

const roots: string[] = [];
export function useCampaignCleanup() {
  useSandboxTestCleanup();
  afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) { if (!root.startsWith(path.join(process.cwd(), ".my-dev-kit-context") + path.sep)) throw new Error("UNSAFE_TEST_CLEANUP"); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } });
}
export async function campaignTemp() { const root = await mkdtemp(path.join(process.cwd(), ".my-dev-kit-context", "r6-")); roots.push(root); return root; }
export async function latestCheckpoint(outputRoot: string): Promise<CampaignCheckpointV2> {
  const store = path.join(outputRoot, "campaign-checkpoints-v2");
  const identity = (await readdir(store)).find(n => /^[a-f0-9]{64}$/.test(n))!;
  const directory = path.join(store, identity);
  const last = (await readdir(directory)).filter(n => /^generation-\d{10}\.json$/.test(n)).sort().at(-1)!;
  return JSON.parse(await readFile(path.join(directory, last), "utf8")) as CampaignCheckpointV2;
}
export async function cliFixture(providerId: "codex" | "claude" = "codex") {
  const root = await campaignTemp();
  const toolRoot = path.join(root, "tool"), outputRoot = path.join(root, "out");
  await mkdir(path.join(toolRoot, "benchmarks/contracts"), { recursive: true });
  await writeFile(path.join(toolRoot, "package.json"), '{"name":"@dailephd/my-dev-kit-lab","version":"0.9.0"}');
  const catalogPath = "benchmarks/contracts/agent-success-rate-tasks.json";
  const tasks = JSON.parse(await readFile(catalogPath, "utf8")) as AgentSuccessTaskV1[];
  for (const file of [catalogPath, "benchmarks/contracts/agent-success-rate-project-profiles.json"]) await cp(file, path.join(toolRoot, file));
  for (const id of new Set(tasks.map(t => t.benchmarkProject))) await cp(path.join("benchmarks/projects", id), path.join(toolRoot, "benchmarks/projects", id), { recursive: true });
  const context: LabExecutionContext = { invocationCwd: process.cwd(), packageRoot: toolRoot, resourceRoot: toolRoot, workspaceRoot: root };
  const shim = makeProviderShim(providerId);
  const kit = makeSourceBackedKit();
  const task = tasks[0]!;
  // Equal expected behavior, different provider-produced source bytes from the private fixture.
  const response = task.deterministicFixture!.patch.replace("+  return normalized;", "+  return normalized.trim();");
  shim.respond(task.id, "raw-full-file", response); shim.respond(task.id, "context-pack", response);
  const base = ["--experiment", "agent-success-rate", "--out", outputRoot, "--campaign-source-root", process.cwd(), "--case", task.id];
  return { root, toolRoot, outputRoot, context, shim, kit, task, tasks, response, base, runtime: { env: shim.env, contextDependencies: kit.dependencies } };
}
export async function captureCommand(run: () => Promise<number>) {
  const out: string[] = [], errors: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  const error = vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a.join(" ")));
  try { return { code: await run(), stdout: out.join("\n"), stderr: errors.join("\n") }; } finally { log.mockRestore(); error.mockRestore(); }
}
