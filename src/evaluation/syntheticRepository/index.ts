export * from "./types.js";
export {
  SYNTHETIC_REPOSITORY_CASE_FIELDS,
  SYNTHETIC_REPOSITORY_LIMITS,
  compareCodeUnits,
  maxImportEdges,
  normalizeSyntheticRepositoryConfig,
  validateSyntheticRepositoryCaseSpec,
  validateSyntheticRepositoryConfig,
} from "./config.js";
export type { SyntheticRepositoryCaseValidationResult, SyntheticRepositoryConfigValidationResult } from "./config.js";
export {
  canonicalSyntheticRepositoryCaseText,
  canonicalSyntheticRepositoryConfigText,
  computeSyntheticRepositoryCaseIdentity,
  computeSyntheticRepositoryConfigIdentity,
} from "./identity.js";
export { createSyntheticRepositoryPrng, syntheticRepositoryPrngInitialState } from "./prng.js";
export type { SyntheticRepositoryPrng } from "./prng.js";
export { planTopology } from "./topology.js";
export type { PlannedTopology, TopologyRequest } from "./topology.js";
export { planSyntheticRepositories, planSyntheticRepositoryCase, verifySyntheticRepositoryPlan } from "./planning.js";
export { SyntheticRepositoryRenderError } from "./renderShared.js";
export type { RenderedFile, RenderedFileRole } from "./renderShared.js";
export { renderTypeScriptRepository } from "./renderTypeScript.js";
export { pythonModuleName, renderPythonRepository } from "./renderPython.js";
export { renderSyntheticRepository } from "./renderRepository.js";
export { inspectRepositoryFiles } from "./inspection.js";
export type { InspectableFile, InspectedDimensions, RepositoryInspection } from "./inspection.js";
export { deriveSyntheticRepositoryLayout, describeSyntheticTask } from "./layout.js";
export type { SyntheticRepositoryLayout, SyntheticTaskText } from "./layout.js";
export {
  SYNTHETIC_REPOSITORY_MANIFEST_FILE_NAME,
  SYNTHETIC_REPOSITORY_MANIFEST_SCHEMA_ID,
  SYNTHETIC_REPOSITORY_MANIFEST_SCHEMA_VERSION,
  SYNTHETIC_REPOSITORY_REPOSITORY_DIRECTORY,
  buildSyntheticRepositoryManifest,
  computeRepositoryContentIdentity,
  serializeSyntheticRepositoryManifest,
  validateSyntheticRepositoryManifest,
} from "./manifest.js";
export type {
  SyntheticManifestAggregate,
  SyntheticManifestDimensions,
  SyntheticManifestFileRecord,
  SyntheticManifestValidation,
  SyntheticRepositoryManifestV1,
} from "./manifest.js";
export { verifySyntheticRepositoryMaterialization } from "./manifestVerification.js";
export type { SyntheticRepositoryVerification } from "./manifestVerification.js";
export { buildSyntheticAnswerKey, buildSyntheticEvaluationCase } from "./evaluationCase.js";
export { SyntheticRepositoryMaterializationError, materializeSyntheticRepository } from "./materialize.js";
export type {
  SyntheticRepositoryMaterialization,
  SyntheticRepositoryMaterializationErrorCode,
  SyntheticRepositoryMaterializationIo,
} from "./materialize.js";
