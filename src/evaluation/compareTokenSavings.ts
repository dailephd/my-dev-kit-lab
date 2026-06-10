import { tokenCountMethod } from "../core/countTokens.js";
import type {
  EvaluationCase,
  MyDevKitRetrievalResult,
  RawFullFileBaselineResult,
  TokenSavingsCaseResult,
  TokenSavingsSummary
} from "./types.js";

export function compareTokenSavings(
  evaluations: Array<{
    evaluationCase: EvaluationCase;
    rawBaseline: RawFullFileBaselineResult;
    myDevKit: MyDevKitRetrievalResult;
  }>
): { cases: TokenSavingsCaseResult[]; summary: TokenSavingsSummary } {
  const cases = evaluations.map(({ evaluationCase, rawBaseline, myDevKit }) => {
    const tokensSaved = rawBaseline.totalEstimatedTokens - myDevKit.totalEstimatedTokens;
    const percentSaved = rawBaseline.totalEstimatedTokens === 0 ? 0 : (tokensSaved / rawBaseline.totalEstimatedTokens) * 100;
    return {
      caseId: evaluationCase.id,
      title: evaluationCase.title,
      benchmarkProject: evaluationCase.benchmarkProject,
      rawChars: rawBaseline.totalChars,
      rawEstimatedTokens: rawBaseline.totalEstimatedTokens,
      myDevKitChars: myDevKit.totalChars,
      myDevKitEstimatedTokens: myDevKit.totalEstimatedTokens,
      tokensSaved,
      percentSaved,
      filesReadRaw: rawBaseline.totalFiles,
      filesReadMyDevKit: myDevKit.filesRead.length,
      commandsRun: myDevKit.commands.length,
      durationMsRaw: rawBaseline.durationMs,
      durationMsMyDevKit: myDevKit.durationMs,
      skipped: myDevKit.skipped,
      warnings: [...myDevKit.warnings]
    };
  });

  const completed = cases.filter((result) => !result.skipped);
  const aggregate = (selector: (item: TokenSavingsCaseResult) => number) => completed.reduce((sum, item) => sum + selector(item), 0);
  const average = (selector: (item: TokenSavingsCaseResult) => number) => (completed.length === 0 ? 0 : aggregate(selector) / completed.length);

  return {
    cases,
    summary: {
      caseCount: cases.length,
      completedCaseCount: completed.length,
      skippedCaseCount: cases.length - completed.length,
      averageRawTokens: average((item) => item.rawEstimatedTokens),
      averageMyDevKitTokens: average((item) => item.myDevKitEstimatedTokens),
      averageTokensSaved: average((item) => item.tokensSaved),
      averagePercentSaved: average((item) => item.percentSaved),
      totalRawTokens: aggregate((item) => item.rawEstimatedTokens),
      totalMyDevKitTokens: aggregate((item) => item.myDevKitEstimatedTokens),
      totalTokensSaved: aggregate((item) => item.tokensSaved),
      totalCommandsRun: cases.reduce((sum, item) => sum + item.commandsRun, 0),
      totalDurationMs: cases.reduce((sum, item) => sum + item.durationMsRaw + item.durationMsMyDevKit, 0),
      tokenCountMethod,
      warnings: cases.flatMap((item) => item.warnings)
    }
  };
}
