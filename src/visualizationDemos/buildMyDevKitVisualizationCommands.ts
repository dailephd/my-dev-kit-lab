import path from "node:path";
import type { VisualizationDemoCommand } from "./types.js";

export function buildMyDevKitVisualizationCommands(options: {
  projectPath: string;
  kitCommand: string;
  outDir: string;
  query?: string;
  nodeId?: string;
}): VisualizationDemoCommand[] {
  const projectPath = path.resolve(options.projectPath);
  const outDir = path.resolve(options.outDir);
  const indexDir = path.join(outDir, "artifacts", "index");
  const artifactsDir = path.join(outDir, "artifacts");
  const query = options.query ?? "create task";
  const nodeId = options.nodeId ?? "todo-ts:createTask";

  return [
    {
      id: "index-project",
      name: "Index project",
      command: options.kitCommand,
      args: ["index", "--src", projectPath, "--out", indexDir, "--call-graph", "--json"],
      cwd: projectPath,
      expectedArtifacts: [path.join(indexDir, "manifest.json")]
    },
    {
      id: "search-task-symbols",
      name: "Search task symbols",
      command: options.kitCommand,
      args: ["search", "--index", indexDir, "--query", query, "--limit", "10"],
      cwd: projectPath,
      expectedArtifacts: []
    },
    {
      id: "view-call-graph",
      name: "View call graph",
      command: options.kitCommand,
      args: ["view", "--index", indexDir, "--graph", "code", "--out", path.join(artifactsDir, "call-graph.svg")],
      cwd: projectPath,
      expectedArtifacts: [path.join(artifactsDir, "call-graph.svg")]
    },
    {
      id: "view-data-model",
      name: "View data model",
      command: options.kitCommand,
      args: ["view", "--index", indexDir, "--graph", "data-model", "--out", path.join(artifactsDir, "data-model.svg")],
      cwd: projectPath,
      expectedArtifacts: [path.join(artifactsDir, "data-model.svg")]
    },
    {
      id: "view-model-view-lineage",
      name: "View model-view-lineage",
      command: options.kitCommand,
      args: ["view", "--index", indexDir, "--graph", "model-view-lineage", "--out", path.join(artifactsDir, "model-view-lineage.svg")],
      cwd: projectPath,
      expectedArtifacts: [path.join(artifactsDir, "model-view-lineage.svg")]
    },
    {
      id: "source-known-symbol",
      name: "Source known symbol",
      command: options.kitCommand,
      args: ["source", "--index", indexDir, "--node", nodeId],
      cwd: projectPath,
      expectedArtifacts: []
    }
  ];
}
