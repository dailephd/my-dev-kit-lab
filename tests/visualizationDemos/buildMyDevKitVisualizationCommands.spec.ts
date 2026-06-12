import { describe, expect, it } from "vitest";
import { buildMyDevKitVisualizationCommands } from "../../src/visualizationDemos/index.js";

describe("buildMyDevKitVisualizationCommands", () => {
  it("builds bounded visualization commands for todo-ts", () => {
    const commands = buildMyDevKitVisualizationCommands({ projectPath: "benchmarks/projects/todo-ts", kitCommand: "node fake.js", outDir: "out" });
    expect(commands.map((command) => command.id)).toEqual([
      "index-project",
      "search-task-symbols",
      "view-call-graph",
      "view-data-model",
      "view-model-view-lineage",
      "source-known-symbol"
    ]);
    expect(commands[0].command).toBe("node fake.js");
  });
});
