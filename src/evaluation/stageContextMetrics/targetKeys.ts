import type { StageContextExpectationItemV1 } from "../stageContextExpectations/index.js";

export function buildStageContextExpectationTargetKey(item: StageContextExpectationItemV1): string {
  switch (item.category) {
    case "file":
    case "test-file":
    case "fixture":
    case "factory":
    case "mock":
    case "setup-file":
    case "test-configuration":
      return `${item.sourceArtifact}|${item.category}|path:${item.match.path}`;
    case "symbol":
    case "contract":
    case "validator":
    case "constant":
    case "error":
    case "schema-or-serializer":
      return `${item.sourceArtifact}|${item.category}|symbolId:${item.match.symbolId}`;
    case "source-range":
      return `context-capsule|source-range|filePath:${item.match.filePath}|startLine:${item.match.startLine}|endLine:${item.match.endLine}`;
    case "production-responsibility":
      return `${item.sourceArtifact}|production-responsibility|responsibilityId:${item.match.responsibilityId}`;
    case "package-script":
      return `context-capsule|package-script|name:${item.match.name}`;
    case "test-command":
      return `context-capsule|test-command|commandText:${item.match.commandText}`;
    case "workflow":
    case "stage":
    case "command":
    case "rule":
    case "report-contract":
      return `${item.sourceArtifact}|${item.category}|id:${item.match.id}`;
    case "provenance":
      return `${item.sourceArtifact}|provenance|evidenceId:${item.match.evidenceId}`;
  }
}
