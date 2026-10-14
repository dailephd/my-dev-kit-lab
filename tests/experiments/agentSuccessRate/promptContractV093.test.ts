import { describe, expect, it } from "vitest";
import {
  buildAgentSuccessRealAgentPrompt,
  validateAgentSuccessRateConfig
} from "../../../src/experiments/plugins/agentSuccessRate/index.js";
import { hasExplicitPromptContractSelection, resolveAgentSuccessPromptContract } from "../../../src/experiments/plugins/agentSuccessRate/config.js";
import {
  assertPromptContractShape,
  computePromptRendererDigest,
  createPromptContract,
  isLegacyDefaultPromptContract,
  promptContractDigest,
  promptContractMatchesCurrentRenderer,
  promptSettingsOf,
  renderPromptContractArtifact
} from "../../../src/experiments/plugins/agentSuccessRate/promptContract.js";
import { REAL_AGENT_CONTEXT_BEGIN, REAL_AGENT_CONTEXT_END } from "../../../src/experiments/plugins/agentSuccessRate/realAgentPrompt.js";
import { parseStrictDiffResponse, validateAgentSuccessFinalAnswer, STRICT_DIFF_MAX_PATCH_BYTES } from "../../../src/experiments/plugins/agentSuccessRate/strictDiffResponse.js";
import {
  LEGACY_PROMPT_PARITY_CONTEXTS,
  LEGACY_PROMPT_PARITY_FEEDBACK,
  LEGACY_PROMPT_PARITY_GOLDEN,
  LEGACY_PROMPT_PARITY_TASK
} from "./legacyPromptParityFixtures.js";

const task = LEGACY_PROMPT_PARITY_TASK as never;
const feedback = LEGACY_PROMPT_PARITY_FEEDBACK as never;
const DIFF = "diff --git a/src/math.cjs b/src/math.cjs\n--- a/src/math.cjs\n+++ b/src/math.cjs\n@@ -1,3 +1,3 @@\n function add(a, b) {\n-  return a - b;\n+  return a + b;\n }\n";

describe("v0.9.3 legacy prompt byte parity (A1)", () => {
  for (const treatmentId of ["raw-full-file", "context-pack"] as const) {
    for (const provider of ["codex", "claude"] as const) {
      it(`default, omitted and explicit-default configurations reproduce the inherited ${treatmentId} prompts for ${provider}`, () => {
        const contextText = LEGACY_PROMPT_PARITY_CONTEXTS[treatmentId];
        const explicitDefault = promptSettingsOf(createPromptContract(provider, { templateId: "legacy-diff-v1", lengthMode: "standard", explanationMode: "legacy", toolUseMode: "prohibited", maxCommandCount: 0 }));
        const implicitDefault = promptSettingsOf(createPromptContract(provider));
        for (const prompt of [undefined, implicitDefault, explicitDefault]) {
          expect(buildAgentSuccessRealAgentPrompt({ task, treatmentId, contextText, ...(prompt ? { prompt } : {}) })).toBe(LEGACY_PROMPT_PARITY_GOLDEN[`initial-${treatmentId}`]);
          expect(
            buildAgentSuccessRealAgentPrompt({ task, treatmentId, contextText, repair: { feedback, attemptNumber: 2, maxAttempts: 3 }, ...(prompt ? { prompt } : {}) })
          ).toBe(LEGACY_PROMPT_PARITY_GOLDEN[`repair-${treatmentId}`]);
        }
      });
    }
  }
});

describe("PromptContractV1 identity", () => {
  it("normalizes omitted fields to the legacy defaults and is deterministic", () => {
    const contract = createPromptContract("codex");
    expect(Object.keys(contract).sort()).toEqual(["explanationMode", "lengthMode", "maxCommandCount", "providerId", "rendererDigest", "schemaVersion", "templateId", "toolUseMode"]);
    expect(contract).toMatchObject({ schemaVersion: "1.0.0", templateId: "legacy-diff-v1", providerId: "codex", lengthMode: "standard", explanationMode: "legacy", toolUseMode: "prohibited", maxCommandCount: 0 });
    expect(isLegacyDefaultPromptContract(contract)).toBe(true);
    expect(createPromptContract("codex")).toEqual(contract);
    expect(promptContractDigest(contract)).toBe(promptContractDigest(createPromptContract("codex")));
    expect(renderPromptContractArtifact(contract)).toBe(renderPromptContractArtifact(createPromptContract("codex")));
    expect(promptContractMatchesCurrentRenderer(contract)).toBe(true);
  });

  it("gives every effective instruction set and provider a distinct renderer digest", () => {
    const variants = [
      createPromptContract("codex"),
      createPromptContract("claude"),
      createPromptContract("codex", { lengthMode: "short" }),
      createPromptContract("codex", { explanationMode: "none" }),
      createPromptContract("codex", { toolUseMode: "bounded" }),
      createPromptContract("codex", { templateId: "strict-diff-v1" }),
      createPromptContract("claude", { templateId: "strict-diff-v1" }),
      createPromptContract("codex", { templateId: "strict-diff-v1", lengthMode: "short" })
    ];
    expect(new Set(variants.map((contract) => contract.rendererDigest)).size).toBe(variants.length);
    expect(new Set(variants.map(promptContractDigest)).size).toBe(variants.length);
  });

  it("changes the digest when the instruction text changes and never reads task data", () => {
    const settings = promptSettingsOf(createPromptContract("codex", { templateId: "strict-diff-v1" }));
    expect(computePromptRendererDigest(settings)).toBe(computePromptRendererDigest({ ...settings }));
    expect(computePromptRendererDigest({ ...settings, lengthMode: "short" })).not.toBe(computePromptRendererDigest(settings));
  });

  it("rejects unknown, missing and out-of-vocabulary persisted fields", () => {
    const valid = createPromptContract("claude", { templateId: "strict-diff-v1" });
    expect(() => assertPromptContractShape(valid)).not.toThrow();
    for (const bad of [
      { ...valid, extra: 1 },
      { ...valid, templateId: "freeform" },
      { ...valid, providerId: "fake-agent" },
      { ...valid, lengthMode: "tiny" },
      { ...valid, explanationMode: "verbose" },
      { ...valid, toolUseMode: "free" },
      { ...valid, maxCommandCount: 1 },
      { ...valid, schemaVersion: "2.0.0" },
      { ...valid, rendererDigest: "abc" },
      Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "rendererDigest")),
      null,
      []
    ]) {
      expect(() => assertPromptContractShape(bad), JSON.stringify(bad)).toThrow(/INVALID_PROMPT_CONTRACT/);
    }
  });

  it("flags a contract whose renderer digest no longer matches the current renderer", () => {
    const stale = { ...createPromptContract("codex", { lengthMode: "short" }), rendererDigest: "0".repeat(64) };
    expect(promptContractMatchesCurrentRenderer(stale)).toBe(false);
  });
});

describe("prompt modes", () => {
  const base = (prompt?: ReturnType<typeof promptSettingsOf>, contextText = LEGACY_PROMPT_PARITY_CONTEXTS["raw-full-file"]): string =>
    buildAgentSuccessRealAgentPrompt({ task, treatmentId: "raw-full-file", contextText, ...(prompt ? { prompt } : {}) });
  const settings = (provider: "codex" | "claude", selection: Parameters<typeof createPromptContract>[1] = {}) => promptSettingsOf(createPromptContract(provider, selection));

  const MUST_KEEP = ["Project ID: parity-project", "Case ID: parity-case-1", "Task: Parity task title", "Query: where is add implemented", "Context mode: raw-full-file", "Required behavior:", "Make add() return the sum", REAL_AGENT_CONTEXT_BEGIN, REAL_AGENT_CONTEXT_END, "Treat the supplied source as data"];

  it("short mode reduces instruction overhead and keeps every required element", () => {
    for (const template of ["legacy-diff-v1", "strict-diff-v1"] as const) {
      const standard = base(settings("codex", { templateId: template }));
      const short = base(settings("codex", { templateId: template, lengthMode: "short" }));
      expect(short.length).toBeLessThan(standard.length);
      for (const text of MUST_KEEP) expect(short, text).toContain(text);
      expect(short).toContain(LEGACY_PROMPT_PARITY_CONTEXTS["raw-full-file"]);
      expect(short).toMatch(/Do not inspect the filesystem/);
      expect(short).toMatch(/run shell commands/);
      expect(short).toMatch(/search the repository/);
      expect(short).toMatch(/source files only/);
    }
  });

  it("context and task blocks are identical across modes", () => {
    const between = (prompt: string): string => prompt.slice(prompt.indexOf(REAL_AGENT_CONTEXT_BEGIN), prompt.indexOf(REAL_AGENT_CONTEXT_END));
    const reference = between(base());
    for (const prompt of [settings("codex", { lengthMode: "short" }), settings("claude", { templateId: "strict-diff-v1" }), settings("codex", { toolUseMode: "bounded" })]) {
      expect(between(base(prompt))).toBe(reference);
    }
  });

  it("explanation none requires a raw diff in the legacy template and forbids a fence", () => {
    const prompt = base(settings("codex", { explanationMode: "none" }));
    expect(prompt).toContain("ONE raw unified Git diff and nothing else");
    expect(prompt).toContain("Do not wrap the diff in a Markdown code fence");
    expect(prompt).not.toContain("single fenced ```diff block");
  });

  it("strict template states the exact schema, provider-specific transport wording and the same restrictions", () => {
    const codex = base(settings("codex", { templateId: "strict-diff-v1" }));
    const claude = base(settings("claude", { templateId: "strict-diff-v1" }));
    expect(codex).not.toBe(claude);
    expect(codex).toContain('{"schemaVersion":"1.0.0","patch":"<one unified Git diff>"}');
    expect(codex).toContain("final agent message");
    expect(claude).toContain("final result text");
    for (const prompt of [codex, claude]) {
      expect(prompt).toContain("no other fields are allowed");
      expect(prompt).toContain("Do not run shell commands.");
      expect(prompt).toContain("Do not inspect the filesystem.");
      expect(prompt).toContain("Do not search the repository.");
      expect(prompt).toContain("return the JSON object only");
      expect(prompt).not.toContain("single fenced ```diff block");
    }
    // The explanation setting never relaxes the strict schema statement.
    expect(base(settings("codex", { templateId: "strict-diff-v1", explanationMode: "legacy" }))).toBe(base(settings("codex", { templateId: "strict-diff-v1", explanationMode: "none" })));
  });

  it("bounded tool use states an explicit zero command budget and still prohibits commands", () => {
    for (const template of ["legacy-diff-v1", "strict-diff-v1"] as const) {
      for (const length of ["standard", "short"] as const) {
        const prompt = base(settings("claude", { templateId: template, lengthMode: length, toolUseMode: "bounded" }));
        expect(prompt).toContain("Executable command budget: 0 (zero)");
        expect(prompt).toContain("Maximum command count: 0.");
        expect(prompt).toMatch(/run shell commands/);
        expect(prompt).not.toMatch(/Maximum command count: [1-9]/);
      }
    }
  });

  it("never contains answer keys, hidden checks or fixture patches in any mode", () => {
    for (const template of ["legacy-diff-v1", "strict-diff-v1"] as const) {
      for (const length of ["standard", "short"] as const) {
        for (const toolUse of ["prohibited", "bounded"] as const) {
          const prompt = base(settings("codex", { templateId: template, lengthMode: length, toolUseMode: toolUse, explanationMode: "none" }));
          for (const marker of ["expectedEditFiles", "allowedEditFiles", "protectedFiles", "taskChecks", "regressionChecks", "deterministicFixture", "behaviorFacts", "verificationCheckIds"]) {
            expect(prompt, marker).not.toContain(marker);
          }
        }
      }
    }
  });
});

describe("prompt option configuration", () => {
  const REAL = { agentId: "codex", includeRealAgents: true } as const;

  it("accepts every allowed value in real-agent mode and reports no selection by default", () => {
    const defaults = validateAgentSuccessRateConfig({ ...REAL });
    expect(defaults.valid).toBe(true);
    expect(hasExplicitPromptContractSelection(defaults.config!)).toBe(false);
    expect(resolveAgentSuccessPromptContract(defaults.config!)).toBeNull();
    for (const [field, values] of [
      ["promptTemplate", ["legacy-diff-v1", "strict-diff-v1"]],
      ["promptLength", ["standard", "short"]],
      ["promptExplanation", ["legacy", "none"]],
      ["promptToolUse", ["prohibited", "bounded"]]
    ] as const) {
      for (const value of values) expect(validateAgentSuccessRateConfig({ ...REAL, [field]: value }).valid, `${field}=${value}`).toBe(true);
    }
    const explicit = validateAgentSuccessRateConfig({ ...REAL, promptTemplate: "legacy-diff-v1", promptLength: "standard", promptExplanation: "legacy", promptToolUse: "prohibited", maxCommandCount: 0 });
    expect(explicit.valid).toBe(true);
    const contract = resolveAgentSuccessPromptContract(explicit.config!)!;
    expect(isLegacyDefaultPromptContract(contract)).toBe(true);
  });

  it("rejects unknown values, non-zero command counts and non-integers", () => {
    for (const bad of [
      { promptTemplate: "freeform" }, { promptLength: "tiny" }, { promptExplanation: "verbose" }, { promptToolUse: "free" },
      { maxCommandCount: 1 }, { maxCommandCount: -1 }, { maxCommandCount: 0.5 }, { maxCommandCount: "0" }, { maxCommandCount: null }
    ]) {
      expect(validateAgentSuccessRateConfig({ ...REAL, ...bad }).valid, JSON.stringify(bad)).toBe(false);
    }
  });

  it("never lets prompt options enable or substitute for real-agent mode", () => {
    for (const option of [{ promptTemplate: "strict-diff-v1" }, { promptLength: "short" }, { promptExplanation: "none" }, { promptToolUse: "bounded" }, { maxCommandCount: 0 }]) {
      expect(validateAgentSuccessRateConfig(option).valid, JSON.stringify(option)).toBe(false);
      expect(validateAgentSuccessRateConfig({ agentId: "codex", ...option }).valid, JSON.stringify(option)).toBe(false);
      expect(validateAgentSuccessRateConfig({ includeRealAgents: true, ...option }).valid, JSON.stringify(option)).toBe(false);
    }
  });
});

describe("StrictDiffResponseV1 parser", () => {
  const json = (value: unknown): string => JSON.stringify(value);
  const ok = (text: string) => parseStrictDiffResponse(text);
  const code = (text: string): string => {
    const result = ok(text);
    return result.ok ? "OK" : result.code;
  };

  it("accepts exactly one object with the two required fields, with surrounding whitespace", () => {
    expect(ok(json({ schemaVersion: "1.0.0", patch: DIFF }))).toEqual({ ok: true, response: { schemaVersion: "1.0.0", patch: DIFF } });
    expect(code(`\n  ${json({ patch: DIFF, schemaVersion: "1.0.0" })}\n\n`)).toBe("OK");
  });

  it("rejects each structural violation with a stable bounded code", () => {
    const valid = { schemaVersion: "1.0.0", patch: DIFF };
    const table: Array<[string, string, string]> = [
      ["missing schemaVersion", json({ patch: DIFF }), "STRICT_MISSING_FIELD"],
      ["missing patch", json({ schemaVersion: "1.0.0" }), "STRICT_MISSING_FIELD"],
      ["unsupported version", json({ ...valid, schemaVersion: "2.0.0" }), "STRICT_SCHEMA_VERSION"],
      ["numeric version", json({ ...valid, schemaVersion: 1 }), "STRICT_FIELD_TYPE"],
      ["patch type", json({ ...valid, patch: { diff: DIFF } }), "STRICT_FIELD_TYPE"],
      ["empty patch", json({ ...valid, patch: "  \n" }), "STRICT_EMPTY_PATCH"],
      ["unknown property", json({ ...valid, explanation: "I changed add" }), "STRICT_UNKNOWN_FIELD"],
      ["array", json([valid]), "STRICT_NOT_OBJECT"],
      ["string", json("hello"), "STRICT_NOT_OBJECT"],
      ["multiple documents", `${json(valid)}\n${json(valid)}`, "STRICT_MULTIPLE_DOCUMENTS"],
      ["trailing prose", `${json(valid)}\nHope this helps!`, "STRICT_TRAILING_CONTENT"],
      ["leading prose", `Here you go: ${json(valid)}`, "STRICT_NOT_JSON"],
      ["fenced json", "```json\n" + json(valid) + "\n```", "STRICT_MARKDOWN_FENCE"],
      ["malformed json", '{"schemaVersion": "1.0.0", "patch": ', "STRICT_NOT_JSON"],
      ["comments", '{"schemaVersion":"1.0.0", /* c */ "patch":"x"}', "STRICT_NOT_JSON"],
      ["trailing comma", '{"schemaVersion":"1.0.0","patch":"x",}', "STRICT_NOT_JSON"],
      ["empty", "   ", "STRICT_EMPTY_RESPONSE"],
      ["raw diff", DIFF, "STRICT_NOT_JSON"]
    ];
    for (const [label, text, expected] of table) expect(code(text), label).toBe(expected);
  });

  it("detects duplicate keys that JSON.parse would silently collapse", () => {
    const text = `{"schemaVersion":"1.0.0","patch":${JSON.stringify(DIFF)},"patch":${JSON.stringify("diff --git a/x b/x\n")}}`;
    expect(JSON.parse(text).patch).toContain("diff --git a/x b/x");
    expect(code(text)).toBe("STRICT_DUPLICATE_KEY");
    expect(code('{"schemaVersion":"1.0.0","schemaVersion":"1.0.0","patch":"x"}')).toBe("STRICT_DUPLICATE_KEY");
  });

  it("rejects invalid Unicode, oversized and too-deep responses", () => {
    expect(code(`{"schemaVersion":"1.0.0","patch":"\\ud800"}`)).toBe("STRICT_INVALID_UNICODE");
    expect(code(`{"schemaVersion":"1.0.0","patch":"x\ud800"}`)).toBe("STRICT_INVALID_UNICODE");
    const oversized = `diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+${"y".repeat(STRICT_DIFF_MAX_PATCH_BYTES)}\n`;
    expect(code(json({ schemaVersion: "1.0.0", patch: oversized }))).toBe("STRICT_PATCH_TOO_LARGE");
    expect(code("[".repeat(100) + "]".repeat(100))).toBe("STRICT_TOO_DEEP");
  });

  it("requires the patch to be a raw unified diff and not prose or a fence", () => {
    expect(code(json({ schemaVersion: "1.0.0", patch: "I fixed add by changing minus to plus." }))).toBe("STRICT_PATCH_NOT_RAW_DIFF");
    expect(code(json({ schemaVersion: "1.0.0", patch: "```diff\n" + DIFF + "```\n" }))).toBe("STRICT_PATCH_NOT_RAW_DIFF");
    expect(code(json({ schemaVersion: "1.0.0", patch: DIFF + "That is the patch.\n" }))).toBe("STRICT_PATCH_NOT_RAW_DIFF");
  });

  it("schema validity does not imply patch safety: protected-path diffs still parse and are left to patch policy", () => {
    const protectedDiff = "diff --git a/tests/hidden.check.cjs b/tests/hidden.check.cjs\n--- a/tests/hidden.check.cjs\n+++ b/tests/hidden.check.cjs\n@@ -1 +1 @@\n-a\n+b\n";
    const result = validateAgentSuccessFinalAnswer({ templateId: "strict-diff-v1", explanationMode: "legacy" }, json({ schemaVersion: "1.0.0", patch: protectedDiff }));
    expect(result).toEqual({ ok: true, patchText: protectedDiff });
  });
});

describe("final-answer validation by template and explanation mode", () => {
  const legacyNone = { templateId: "legacy-diff-v1", explanationMode: "none" } as const;
  const legacyDefault = { templateId: "legacy-diff-v1", explanationMode: "legacy" } as const;

  it("preserves historical acceptance of prose-wrapped and fenced diffs for the legacy default", () => {
    for (const text of [DIFF, "Here is the fix:\n```diff\n" + DIFF + "```\nDone.", "anything at all"]) {
      expect(validateAgentSuccessFinalAnswer(legacyDefault, text)).toEqual({ ok: true, patchText: text });
    }
  });

  it("explanation none accepts only a raw diff", () => {
    expect(validateAgentSuccessFinalAnswer(legacyNone, DIFF)).toEqual({ ok: true, patchText: DIFF });
    const rejected: Array<[string, string]> = [
      ["prose before", `Here is the patch.\n${DIFF}`],
      ["prose after", `${DIFF}\nThis fixes the bug.`],
      ["fenced", "```diff\n" + DIFF + "```\n"],
      ["empty", " "],
      ["truncated hunk", "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,3 +1,3 @@\n a\n"]
    ];
    for (const [label, text] of rejected) expect(validateAgentSuccessFinalAnswer(legacyNone, text).ok, label).toBe(false);
  });

  it("a rejected strict response is never reinterpreted as a raw diff", () => {
    const fenced = "```json\n" + JSON.stringify({ schemaVersion: "1.0.0", patch: DIFF }) + "\n```";
    for (const text of [DIFF, fenced, `Sure!\n${DIFF}`]) {
      expect(validateAgentSuccessFinalAnswer({ templateId: "strict-diff-v1", explanationMode: "none" }, text).ok, text.slice(0, 20)).toBe(false);
    }
  });
});
