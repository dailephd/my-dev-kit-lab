import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runExperimentRunCommandFromArgs } from "../../../src/commands/runExperimentRunCommand.js";
import { CAMPAIGN_IDENTITY_VERSION, CAMPAIGN_IDENTITY_VERSION_V2, compareCampaignIdentity, validateCampaignIdentity } from "../../../src/experiments/plugins/agentSuccessRate/campaignIdentity.js";
import { createPromptContract, renderPromptContractArtifact } from "../../../src/experiments/plugins/agentSuccessRate/promptContract.js";
import { captureCommand, cliFixture, latestCheckpoint, useCampaignCleanup } from "./realProviderCampaignTestHelpers.js";

useCampaignCleanup();

const STRICT_FLAGS = ["--prompt-template", "strict-diff-v1", "--prompt-length", "short", "--prompt-explanation", "none", "--prompt-tool-use", "bounded", "--max-command-count", "0"];

async function newStrictCampaign(providerId: "codex" | "claude" = "codex") {
  const f = await cliFixture(providerId);
  const strict = JSON.stringify({ schemaVersion: "1.0.0", patch: f.response });
  for (const mode of ["raw-full-file", "context-pack"]) f.shim.respond(f.task.id, mode, strict);
  const vector = [...f.base, "--agent", providerId, "--include-real-agents"];
  const first = await captureCommand(() => runExperimentRunCommandFromArgs([...vector, ...STRICT_FLAGS, "--agent-campaign", "new"], { context: f.context, campaignRuntime: f.runtime }));
  return { f, vector, first };
}

describe("v0.9.3 prompt contract in campaign identity, checkpoints and resume", () => {
  it.each(["codex", "claude"] as const)("binds a V2 identity and persists a verified prompt-contract.json (%s)", async (providerId) => {
    const { f, first } = await newStrictCampaign(providerId);
    expect(first.stderr).toBe("");
    expect(first.code).toBe(0);
    const checkpoint = await latestCheckpoint(f.outputRoot);
    const identity = checkpoint.identity;
    expect(identity.schemaVersion).toBe(CAMPAIGN_IDENTITY_VERSION_V2);
    if (identity.schemaVersion !== CAMPAIGN_IDENTITY_VERSION_V2) throw new Error("expected V2");
    const expected = createPromptContract(providerId, { templateId: "strict-diff-v1", lengthMode: "short", explanationMode: "none", toolUseMode: "bounded", maxCommandCount: 0 });
    expect(identity.promptContract).toEqual(expected);
    expect(() => validateCampaignIdentity(identity)).not.toThrow();
    expect(checkpoint.units.every((unit) => unit.completion?.taskSuccess === true)).toBe(true);
    for (const unit of checkpoint.units) {
      const directory = unit.epochs[0]!.terminal!.evidence.realAgent!.agentArtifactDirectory!;
      expect(await readFile(path.join(f.outputRoot, ...directory.split("/"), "prompt-contract.json"), "utf8")).toBe(renderPromptContractArtifact(expected));
    }
    const prompt = f.shim.prompt(f.task.id, "raw-full-file")!;
    expect(prompt).toContain("Executable command budget: 0 (zero)");
    expect(prompt).toContain('"schemaVersion":"1.0.0"');
  }, 240000);

  it("reuses completed work on a matching resume without a new provider invocation", async () => {
    const { f, vector } = await newStrictCampaign();
    const before = f.shim.invocationKeys();
    const resume = await captureCommand(() => runExperimentRunCommandFromArgs([...vector, ...STRICT_FLAGS, "--agent-campaign", "resume"], { context: f.context, campaignRuntime: f.runtime }));
    expect(resume.stderr).toBe("");
    expect(resume.code).toBe(0);
    expect(resume.stdout).toContain("New provider work: none");
    expect(f.shim.invocationKeys()).toEqual(before);
  }, 240000);

  it("rejects resume under every changed prompt-contract field before any provider invocation", async () => {
    const { f, vector } = await newStrictCampaign();
    const checkpointBefore = await latestCheckpoint(f.outputRoot);
    const attempts: string[][] = [
      ["--prompt-template", "legacy-diff-v1", "--prompt-length", "short", "--prompt-explanation", "none", "--prompt-tool-use", "bounded", "--max-command-count", "0"],
      ["--prompt-template", "strict-diff-v1", "--prompt-length", "standard", "--prompt-explanation", "none", "--prompt-tool-use", "bounded", "--max-command-count", "0"],
      ["--prompt-template", "strict-diff-v1", "--prompt-length", "short", "--prompt-explanation", "legacy", "--prompt-tool-use", "bounded", "--max-command-count", "0"],
      ["--prompt-template", "strict-diff-v1", "--prompt-length", "short", "--prompt-explanation", "none", "--prompt-tool-use", "prohibited", "--max-command-count", "0"],
      [], // omitted options select the legacy V1 identity
      ["--prompt-length", "short"]
    ];
    const invocationsBefore = f.shim.invocationKeys();
    for (const flags of attempts) {
      const result = await captureCommand(() => runExperimentRunCommandFromArgs([...vector, ...flags, "--agent-campaign", "resume"], { context: f.context, campaignRuntime: f.runtime }));
      expect(result.code, flags.join(" ")).toBe(1);
      expect(result.stderr, flags.join(" ")).toContain("CAMPAIGN_IDENTITY_MISMATCH");
    }
    // Provider mismatch: the identity names the other provider.
    const otherProvider = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent", "claude", "--include-real-agents", ...STRICT_FLAGS, "--agent-campaign", "resume"], { context: f.context, campaignRuntime: { ...f.runtime } }));
    expect(otherProvider.code).toBe(1);
    expect(f.shim.invocationKeys()).toEqual(invocationsBefore);
    expect(await latestCheckpoint(f.outputRoot)).toEqual(checkpointBefore);
  }, 300000);

  it("blocks reuse when the persisted prompt contract is corrupted, replaced or missing", async () => {
    const { f, vector } = await newStrictCampaign();
    const checkpoint = await latestCheckpoint(f.outputRoot);
    const directory = checkpoint.units[0]!.epochs[0]!.terminal!.evidence.realAgent!.agentArtifactDirectory!;
    const file = path.join(f.outputRoot, ...directory.split("/"), "prompt-contract.json");
    const original = await readFile(file, "utf8");
    const invocationsBefore = f.shim.invocationKeys();
    const resume = () => captureCommand(() => runExperimentRunCommandFromArgs([...vector, ...STRICT_FLAGS, "--agent-campaign", "resume"], { context: f.context, campaignRuntime: f.runtime }));

    // A different but internally valid contract (the legacy one) must not be accepted for a strict campaign.
    await writeFile(file, renderPromptContractArtifact(createPromptContract("codex")), "utf8");
    expect((await resume()).code).toBe(1);
    await writeFile(file, original.replace("strict-diff-v1", "legacy-diff-v1"), "utf8");
    expect((await resume()).code).toBe(1);
    await writeFile(file, "{}", "utf8");
    expect((await resume()).code).toBe(1);
    const { rm } = await import("node:fs/promises");
    await rm(file);
    expect((await resume()).code).toBe(1);
    expect(f.shim.invocationKeys()).toEqual(invocationsBefore);

    await writeFile(file, original, "utf8");
    expect((await resume()).code).toBe(0);
  }, 300000);

  it("keeps default runs on the V1 identity, readable and resumable as before", async () => {
    const f = await cliFixture();
    const vector = [...f.base, "--agent", "codex", "--include-real-agents"];
    const first = await captureCommand(() => runExperimentRunCommandFromArgs([...vector, "--agent-campaign", "new"], { context: f.context, campaignRuntime: f.runtime }));
    expect(first.code).toBe(0);
    const checkpoint = await latestCheckpoint(f.outputRoot);
    expect(checkpoint.identity.schemaVersion).toBe(CAMPAIGN_IDENTITY_VERSION);
    expect("promptContract" in checkpoint.identity).toBe(false);
    const resume = await captureCommand(() => runExperimentRunCommandFromArgs([...vector, "--agent-campaign", "resume"], { context: f.context, campaignRuntime: f.runtime }));
    expect(resume.code).toBe(0);
    expect(resume.stdout).toContain("New provider work: none");
    // A V1 identity never equals a V2 identity, even for equal flags otherwise.
    expect(compareCampaignIdentity(checkpoint.identity, { ...checkpoint.identity, schemaVersion: CAMPAIGN_IDENTITY_VERSION_V2 })).toBe("UNVERIFIABLE");
  }, 240000);
});

describe("v0.9.3 prompt option CLI validation", () => {
  const BASE = ["--experiment", "agent-success-rate"];
  const run = async (args: string[], outputRoot: string) => captureCommand(() => runExperimentRunCommandFromArgs([...BASE, "--out", outputRoot, ...args]));

  it("rejects prompt options without real-agent opt-in before creating output or invoking a provider", async () => {
    const f = await cliFixture();
    for (const args of [
      ["--prompt-template", "strict-diff-v1"],
      ["--prompt-length", "short"],
      ["--prompt-explanation", "none"],
      ["--prompt-tool-use", "bounded"],
      ["--max-command-count", "0"],
      ["--agent", "codex", "--prompt-length", "short"],
      ["--include-real-agents", "--prompt-length", "short"]
    ]) {
      const result = await run(args, f.outputRoot);
      expect(result.code, args.join(" ")).toBe(1);
      expect(existsSync(f.outputRoot), args.join(" ")).toBe(false);
    }
    expect(f.shim.invocationKeys()).toEqual([]);
  }, 120000);

  it("rejects unknown values, bad command counts, duplicate flags and missing values", async () => {
    const f = await cliFixture();
    const real = ["--agent", "codex", "--include-real-agents"];
    const bad: string[][] = [
      ["--prompt-template", "freeform"],
      ["--prompt-length", "tiny"],
      ["--prompt-explanation", "verbose"],
      ["--prompt-tool-use", "free"],
      ["--max-command-count", "1"],
      ["--max-command-count", "-1"],
      ["--max-command-count", "0.5"],
      ["--max-command-count", "zero"],
      ["--prompt-length", "short", "--prompt-length", "standard"],
      ["--prompt-template"],
      ["--prompt-template", "--prompt-length", "short"]
    ];
    for (const args of bad) {
      const result = await run([...real, ...args], f.outputRoot);
      expect(result.code, args.join(" ")).toBe(1);
      expect(existsSync(f.outputRoot), args.join(" ")).toBe(false);
    }
    expect(f.shim.invocationKeys()).toEqual([]);
  }, 120000);

  it("rejects the new flags for other experiment plugins", async () => {
    const f = await cliFixture();
    for (const experiment of ["context-strategy-comparison", "warm-index-reuse", "context-pack-generation", "retrieval-precision-recall"]) {
      for (const flag of [["--prompt-length", "short"], ["--max-command-count", "0"]]) {
        const result = await captureCommand(() => runExperimentRunCommandFromArgs(["--experiment", experiment, "--out", f.outputRoot, ...flag]));
        expect(result.code, `${experiment} ${flag[0]}`).toBe(1);
      }
    }
    expect(existsSync(f.outputRoot)).toBe(false);
  }, 120000);

  it("lists the five new options in the closed flag set", async () => {
    const entries = await readdir(path.join(process.cwd(), "src", "cli"));
    expect(entries).toContain("help.ts");
    const help = await readFile(path.join(process.cwd(), "src", "cli", "help.ts"), "utf8");
    for (const flag of ["--prompt-template", "--prompt-length", "--prompt-explanation", "--prompt-tool-use", "--max-command-count"]) expect(help).toContain(flag);
  });
});
