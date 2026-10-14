import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_DEPENDENCY_FILES,
  CAMPAIGN_IDENTITY_VERSION,
  CAMPAIGN_IDENTITY_VERSION_V2,
  CAMPAIGN_SOURCE_FILES,
  campaignHash,
  canonicalCampaignJson,
  compareCampaignIdentity,
  createCampaignIdentity,
  validateCampaignIdentity
} from "../../../src/experiments/plugins/agentSuccessRate/campaignIdentity.js";
import { createPromptContract, promptContractDigest, type PromptContractSelection } from "../../../src/experiments/plugins/agentSuccessRate/promptContract.js";
import { makeTask } from "./agentSuccessRateTestHelpers.js";

const task = makeTask();
const bytes = (text: string): Uint8Array => Buffer.from(text);

function input(providerId: "codex" | "claude" | "deterministic-fixture" = "codex", promptContract?: ReturnType<typeof createPromptContract> | null) {
  return {
    tasks: [task],
    corpusBytes: bytes("corpus"),
    projects: [{ projectId: task.benchmarkProject, files: [{ path: "src/math.cjs", bytes: bytes("source") }] }],
    sourceFiles: [...CAMPAIGN_SOURCE_FILES, ...CAMPAIGN_DEPENDENCY_FILES].map((p) => ({ path: p, bytes: bytes(`current ${p}`) })),
    config: { providerId, timeoutMs: 1000, repairAttempts: 0 as const },
    contextConfiguration: { policy: "v1" },
    retrievalConfiguration: { executableIdentity: "my-dev-kit/1.12.5" },
    verifiedProviderObservation: providerId === "deterministic-fixture" ? null : bytes("trusted observation"),
    ...(promptContract !== undefined ? { promptContract } : {})
  };
}
const contract = (selection: PromptContractSelection = { templateId: "strict-diff-v1" }, provider: "codex" | "claude" = "codex") => createPromptContract(provider, selection);
const v2 = (selection?: PromptContractSelection, provider: "codex" | "claude" = "codex") => createCampaignIdentity(input(provider, contract(selection, provider)));

describe("CampaignIdentity V1/V2", () => {
  it("keeps the V1 schema and exact-field validation for runs without a prompt contract", () => {
    const identity = createCampaignIdentity(input("codex"));
    expect(identity.schemaVersion).toBe(CAMPAIGN_IDENTITY_VERSION);
    expect(Object.keys(identity).sort()).toEqual(["algorithm", "components", "config", "digest", "pluginContract", "schemaVersion", "selected", "treatmentOrder"]);
    expect(() => validateCampaignIdentity(identity)).not.toThrow();
    expect(() => validateCampaignIdentity({ ...identity, promptContract: contract() })).toThrow();
    expect(() => validateCampaignIdentity({ ...identity, promptContract: contract(), promptContractDigest: promptContractDigest(contract()) })).toThrow();
  });

  it("binds the normalized prompt contract and its digest in V2", () => {
    const identity = v2();
    expect(identity.schemaVersion).toBe(CAMPAIGN_IDENTITY_VERSION_V2);
    if (identity.schemaVersion !== CAMPAIGN_IDENTITY_VERSION_V2) throw new Error("expected V2");
    expect(identity.promptContract).toEqual(contract());
    expect(identity.promptContractDigest).toBe(promptContractDigest(contract()));
    expect(() => validateCampaignIdentity(identity)).not.toThrow();
    // Equal inputs produce equal digests; key order is irrelevant.
    expect(v2().digest).toBe(identity.digest);
    expect(compareCampaignIdentity(identity, v2())).toBe("MATCH");
    // The effective defaults are bound: an explicit legacy contract still yields V2, distinct from V1.
    const explicitDefault = createCampaignIdentity(input("codex", createPromptContract("codex")));
    expect(explicitDefault.schemaVersion).toBe(CAMPAIGN_IDENTITY_VERSION_V2);
    expect(explicitDefault.digest).not.toBe(createCampaignIdentity(input("codex")).digest);
  });

  it("validates V2 exact fields, digest integrity and contract consistency", () => {
    const identity = v2();
    const mutate = (change: (copy: Record<string, any>) => void): unknown => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const copy = structuredClone(identity) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      change(copy);
      return copy;
    };
    const rejected: Array<[string, unknown]> = [
      ["extra top-level field", mutate((c) => { c.extra = 1; })],
      ["missing promptContract", mutate((c) => { delete c.promptContract; })],
      ["missing promptContractDigest", mutate((c) => { delete c.promptContractDigest; })],
      ["extra contract field", mutate((c) => { c.promptContract.extra = 1; })],
      ["unknown template", mutate((c) => { c.promptContract.templateId = "freeform"; })],
      ["command count", mutate((c) => { c.promptContract.maxCommandCount = 1; })],
      ["contract changed without re-sealing", mutate((c) => { c.promptContract.lengthMode = "short"; })],
      ["contract digest changed", mutate((c) => { c.promptContractDigest = "0".repeat(64); })],
      ["identity digest changed", mutate((c) => { c.digest = "0".repeat(64); })],
      ["provider mismatch", (() => {
        const copy = structuredClone(identity) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        copy.promptContract.providerId = "claude";
        copy.promptContractDigest = promptContractDigest(copy.promptContract);
        const { digest: _digest, ...body } = copy;
        copy.digest = campaignHash(canonicalCampaignJson(body));
        return copy;
      })()],
      ["wrong version string", mutate((c) => { c.schemaVersion = "my-dev-kit-lab-agent-success-rate-campaign-identity-v3"; })]
    ];
    for (const [label, value] of rejected) expect(() => validateCampaignIdentity(value), label).toThrow();
  });

  it("refuses a prompt contract for deterministic-fixture mode or another provider", () => {
    expect(() => createCampaignIdentity(input("deterministic-fixture", createPromptContract("codex")))).toThrow();
    expect(() => createCampaignIdentity(input("claude", createPromptContract("codex")))).toThrow();
  });

  it("treats every prompt-contract field and the renderer digest as a resume-blocking mismatch", () => {
    const base = v2({ templateId: "strict-diff-v1", lengthMode: "short", explanationMode: "none", toolUseMode: "bounded" });
    const variants: Array<[string, ReturnType<typeof v2>]> = [
      ["template", v2({ templateId: "legacy-diff-v1", lengthMode: "short", explanationMode: "none", toolUseMode: "bounded" })],
      ["length", v2({ templateId: "strict-diff-v1", lengthMode: "standard", explanationMode: "none", toolUseMode: "bounded" })],
      ["explanation", v2({ templateId: "strict-diff-v1", lengthMode: "short", explanationMode: "legacy", toolUseMode: "bounded" })],
      ["tool use", v2({ templateId: "strict-diff-v1", lengthMode: "short", explanationMode: "none", toolUseMode: "prohibited" })],
      ["provider", v2({ templateId: "strict-diff-v1", lengthMode: "short", explanationMode: "none", toolUseMode: "bounded" }, "claude")]
    ];
    for (const [label, other] of variants) {
      expect(other.digest, label).not.toBe(base.digest);
      expect(compareCampaignIdentity(base, other), label).toBe("MISMATCH");
    }
    // Renderer digest: a re-sealed identity carrying a different renderer digest must not match.
    const staleContract = { ...contract({ templateId: "strict-diff-v1", lengthMode: "short", explanationMode: "none", toolUseMode: "bounded" }), rendererDigest: "1".repeat(64) };
    expect(compareCampaignIdentity(base, createCampaignIdentity(input("codex", staleContract)))).toBe("MISMATCH");
    // V1 never matches V2, in either direction.
    expect(compareCampaignIdentity(base, createCampaignIdentity(input("codex")))).toBe("MISMATCH");
    expect(compareCampaignIdentity(createCampaignIdentity(input("codex")), base)).toBe("MISMATCH");
  });

  it("still mismatches on corpus, task, treatment, provider-build and source-component changes", () => {
    const base = v2();
    const changed = (mutate: (value: ReturnType<typeof input>) => void) => {
      const value = input("codex", contract());
      mutate(value);
      return createCampaignIdentity(value);
    };
    expect(compareCampaignIdentity(base, changed((v) => { v.corpusBytes = bytes("different corpus"); }))).toBe("MISMATCH");
    expect(compareCampaignIdentity(base, changed((v) => { v.sourceFiles[0]!.bytes = bytes("edited source"); }))).toBe("MISMATCH");
    expect(compareCampaignIdentity(base, changed((v) => { v.verifiedProviderObservation = bytes("different build"); }))).toBe("MISMATCH");
    expect(compareCampaignIdentity(base, changed((v) => { v.config = { ...v.config, timeoutMs: 2000 }; }))).toBe("MISMATCH");
    expect(compareCampaignIdentity(base, changed((v) => { v.tasks = [makeTask({ title: "A different title" })]; }))).toBe("MISMATCH");
  });

  it("lists the new prompt source files among the identity-bound execution dependencies", () => {
    const listed = [...CAMPAIGN_SOURCE_FILES, ...CAMPAIGN_DEPENDENCY_FILES];
    expect(listed).toContain("src/experiments/plugins/agentSuccessRate/promptContract.ts");
    expect(listed).toContain("src/experiments/plugins/agentSuccessRate/strictDiffResponse.ts");
  });
});
