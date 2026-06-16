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
});
