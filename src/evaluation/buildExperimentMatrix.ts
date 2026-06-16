import type { PromptComplexityLevel } from "../prompts/types.js";
import type { EvaluationCase } from "./types.js";
import type { ExperimentAgentId, ExperimentMatrixCell, ExperimentMatrixConfig, ExperimentStrategy } from "./controlledExperimentTypes.js";

export const ALL_EXPERIMENT_AGENTS: ExperimentAgentId[] = ["fake-agent", "codex", "claude"];
export const DEFAULT_EXPERIMENT_AGENTS: ExperimentAgentId[] = ["fake-agent"];
export const DEFAULT_EXPERIMENT_STRATEGIES: ExperimentStrategy[] = ["raw-full-file", "my-dev-kit-guided"];
export const DEFAULT_EXPERIMENT_COMPLEXITIES: PromptComplexityLevel[] = ["short"];

const VALID_AGENTS = new Set<ExperimentAgentId>(ALL_EXPERIMENT_AGENTS);
const VALID_STRATEGIES = new Set<ExperimentStrategy>(DEFAULT_EXPERIMENT_STRATEGIES);
const VALID_COMPLEXITIES = new Set<PromptComplexityLevel>(["short", "medium", "long", "multi-step"]);

export function buildExperimentMatrix(args: {
  cases: EvaluationCase[];
  config: Pick<
    ExperimentMatrixConfig,
    "caseIds" | "benchmarkProjects" | "agents" | "strategies" | "complexityLevels" | "maxRuns" | "includeRealAgents"
  >;
}): ExperimentMatrixCell[] {
  const agents = args.config.agents ?? DEFAULT_EXPERIMENT_AGENTS;
  const strategies = args.config.strategies ?? DEFAULT_EXPERIMENT_STRATEGIES;
  const complexityLevels = args.config.complexityLevels ?? DEFAULT_EXPERIMENT_COMPLEXITIES;
  validateSelections({ agents, strategies, complexityLevels, includeRealAgents: args.config.includeRealAgents ?? false });

  const selectedCases = args.cases.filter((evaluationCase) => {
    const caseMatches = !args.config.caseIds?.length || args.config.caseIds.includes(evaluationCase.id);
    const projectMatches = !args.config.benchmarkProjects?.length || args.config.benchmarkProjects.includes(evaluationCase.benchmarkProject);
    return caseMatches && projectMatches;
  });

  if (args.config.caseIds?.length) {
    const found = new Set(selectedCases.map((evaluationCase) => evaluationCase.id));
    const missing = args.config.caseIds.filter((caseId) => !found.has(caseId));
    if (missing.length > 0) {
      throw new Error(`Evaluation case not found: ${missing.join(", ")}`);
    }
  }

  const cells: ExperimentMatrixCell[] = [];
  for (const evaluationCase of selectedCases) {
    for (const agentId of agents) {
      for (const strategy of strategies) {
        for (const complexityLevel of complexityLevels) {
          cells.push({
            caseId: evaluationCase.id,
            benchmarkProject: evaluationCase.benchmarkProject,
            agentId,
            strategy,
            complexityLevel,
            runId: buildExperimentRunId({
              caseId: evaluationCase.id,
              benchmarkProject: evaluationCase.benchmarkProject,
              agentId,
              strategy,
              complexityLevel
            })
          });
        }
      }
    }
  }

  return typeof args.config.maxRuns === "number" ? cells.slice(0, args.config.maxRuns) : cells;
}

export function buildExperimentRunId(args: {
  caseId: string;
  benchmarkProject: string;
  agentId: ExperimentAgentId;
  strategy: ExperimentStrategy;
  complexityLevel: PromptComplexityLevel;
}): string {
  return [args.caseId, args.benchmarkProject, args.agentId, args.strategy, args.complexityLevel].map(safeSegment).join(".");
}

function validateSelections(args: {
  agents: ExperimentAgentId[];
  strategies: ExperimentStrategy[];
  complexityLevels: PromptComplexityLevel[];
  includeRealAgents: boolean;
}): void {
  for (const agent of args.agents) {
    if (!VALID_AGENTS.has(agent)) {
      throw new Error(`Invalid experiment agent: ${agent}`);
    }
    if ((agent === "codex" || agent === "claude") && !args.includeRealAgents) {
      throw new Error(`Real agent ${agent} requires --include-real-agents.`);
    }
  }
  for (const strategy of args.strategies) {
    if (!VALID_STRATEGIES.has(strategy)) {
      throw new Error(`Invalid experiment strategy: ${strategy}`);
    }
  }
  for (const complexity of args.complexityLevels) {
    if (!VALID_COMPLEXITIES.has(complexity)) {
      throw new Error(`Invalid prompt complexity level: ${complexity}`);
    }
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
