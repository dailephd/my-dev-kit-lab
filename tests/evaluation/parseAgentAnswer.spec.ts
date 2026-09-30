import { describe, expect, it } from "vitest";
import { parseAgentAnswer } from "../../src/evaluation/index.js";
import { loadExperimentFixtures } from "./experimentTestHelpers.js";

describe("parseAgentAnswer", () => {
  it("parses fake-agent output and expected facts by fact ID", async () => {
    const { cases } = await loadExperimentFixtures();
    const parsed = parseAgentAnswer({
      text: [
        "answer: ok",
        "relevantFiles: src/taskService.ts, src/taskStore.ts",
        "relevantSymbols: createTask, TaskService",
        "expectedFactsFound: create-deterministic-id, create-validates-title",
        "confidence: high"
      ].join("\n"),
      answerKey: cases[0].answerKey
    });
    expect(parsed.parseStatus).toBe("parsed");
    expect(parsed.relevantFiles).toContain("src/taskService.ts");
    expect(parsed.relevantSymbols).toContain("TaskService");
    expect(parsed.expectedFactsFound).toContain("create-deterministic-id");
  });

  it("parses markdown relevant files, symbols, and commandsRun sections", async () => {
    const { cases } = await loadExperimentFixtures();
    const parsed = parseAgentAnswer({
      text: [
        "The answer is below.",
        "## Relevant Files",
        "- src/taskService.ts",
        "## Relevant Symbols",
        "- createTask",
        "## Expected Facts Found",
        "- createTask assigns deterministic IDs such as task-1 and task-2.",
        "## Commands Run",
        "- my-dev-kit search"
      ].join("\n"),
      answerKey: cases[0].answerKey
    });
    expect(parsed.relevantFiles).toEqual(["src/taskService.ts"]);
    expect(parsed.relevantSymbols).toEqual(["createTask"]);
    expect(parsed.commandsRun).toEqual(["my-dev-kit search"]);
    expect(parsed.expectedFactsFound).toContain("create-deterministic-id");
  });

  it("parses bold markdown labels and bullet continuations from real-agent style output", async () => {
    const { cases } = await loadExperimentFixtures();
    const parsed = parseAgentAnswer({
      text: [
        "**answer:** ok",
        "**relevantFiles:**",
        "- `benchmarks/projects/todo-ts/src/taskService.ts` - service entry",
        "**relevantSymbols:**",
        "- `TaskService.createTask` - public entry",
        "**expectedFactsFound:**",
        "- create-deterministic-id"
      ].join("\n"),
      answerKey: cases[0].answerKey
    });
    expect(parsed.relevantFiles).toEqual(["benchmarks/projects/todo-ts/src/taskService.ts"]);
    expect(parsed.relevantSymbols).toEqual(["TaskService.createTask"]);
    expect(parsed.expectedFactsFound).toContain("create-deterministic-id");
  });

  it("parses JSON-looking blocks and handles partial or empty output without throwing", async () => {
    const { cases } = await loadExperimentFixtures();
    const json = parseAgentAnswer({
      text: '```json\n{"answer":"ok","relevantFiles":["src/taskService.ts"],"relevantSymbols":["createTask"],"expectedFactsFound":["create-deterministic-id"]}\n```',
      answerKey: cases[0].answerKey
    });
    expect(json.parseStatus).toBe("parsed");
    expect(json.relevantFiles).toContain("src/taskService.ts");

    const partial = parseAgentAnswer({ text: "Only a prose answer.", answerKey: cases[0].answerKey });
    expect(partial.parseStatus).toBe("partial");
    expect(partial.warnings.length).toBeGreaterThan(0);

    const empty = parseAgentAnswer({ text: "", answerKey: cases[0].answerKey });
    expect(empty.parseStatus).toBe("failed");
    expect(empty.warnings[0]).toContain("empty");
  });

  it("preserves plain fenced JSON and all structured markdown sections", () => {
    const fenced = parseAgentAnswer({ text: '```\n{"answer":"ok","relevantFiles":["src/a.ts"]}\n```' });
    expect(fenced.answerText).toBe("ok");
    expect(fenced.relevantFiles).toEqual(["src/a.ts"]);
    const sections = parseAgentAnswer({ text: [
      "## Relevant Files", "- src/a.ts", "## Relevant Symbols", "- Thing.run", "## Expected Facts Found", "- fact-1", "## Commands Run", "- npm test"
    ].join("\n") });
    expect(sections.relevantFiles).toEqual(["src/a.ts"]);
    expect(sections.relevantSymbols).toEqual(["Thing.run"]);
    expect(sections.expectedFactsFound).toEqual(["fact-1"]);
    expect(sections.commandsRun).toEqual(["npm test"]);
  });

  it("keeps field markup, bullet continuations, inline code, and dash descriptions compatible", () => {
    const parsed = parseAgentAnswer({ text: [
      "* answer: ok", "relevantFiles: src/a.ts", "  src/b.ts", "  - src/c.ts", "**relevantSymbols:** `Thing.run` - public symbol",
      "commandsRun: npm test \u2013 local run", "selectedContext: path \u2014 description", "fullFileReads: file - reason"
    ].join("\n") });
    expect(parsed.answerText).toBe("ok");
    expect(parsed.relevantFiles).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(parsed.relevantSymbols).toEqual(["Thing.run"]);
    expect(parsed.commandsRun).toEqual(["npm test"]);
    expect(parsed.selectedContext).toEqual(["path"]);
    expect(parsed.fullFileReads).toEqual(["file"]);
  });

  it("classifies large malformed parser inputs without throwing", () => {
    const fences = parseAgentAnswer({ text: "```".repeat(50_000) });
    expect(fences.parseStatus).toBe("partial");
    const malformedField = parseAgentAnswer({ text: `${" ".repeat(120_000)}${"*".repeat(120_000)} not-a-label:` });
    expect(malformedField.parseStatus).toBe("partial");
    const headings = parseAgentAnswer({ text: `${"#".repeat(120_000)} heading` });
    expect(headings.parseStatus).toBe("partial");
    const bullets = parseAgentAnswer({ text: `## Relevant Files\n- ${"x".repeat(120_000)}` });
    expect(bullets.parseStatus).toBe("parsed");
    expect(bullets.relevantFiles[0]).toHaveLength(120_000);
    const quoteTail = ("'\"``").repeat(30_000);
    const malformedTail = parseAgentAnswer({ text: `relevantFiles: ${"x".repeat(120_000)} - ${quoteTail}` });
    expect(malformedTail.relevantFiles).toEqual(["x".repeat(120_000)]);
  });
});
