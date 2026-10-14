// Shared, typed registry of specialized (experiment-family) report sections. Core report sections
// (metadata, variants, cases, metrics, warnings, interpretation, artifacts) stay in the generic renderers.
// The registry only selects, orders and dispatches specialized sections for the builder, text and HTML renderers.
// It performs no calculation, no I/O, no dynamic import, and registers only in-process descriptors.

import type { ExperimentRun } from "../../experiments/index.js";
import type { ContextPack } from "../../experiments/plugins/contextPackGeneration/types.js";
import type { PluginExperimentReport } from "./experimentReportModel.js";

export type SpecializedReportProjectionKey =
  | "contextStrategyComparisonV043"
  | "warmIndexReuse"
  | "incrementalChangeStaleness"
  | "contextWindowScaling"
  | "retrievalPrecisionRecall"
  | "retrievalQueryStrategyComparison"
  | "contextPackGeneration"
  | "agentSuccessRate";

export type ReportSectionProjection<K extends SpecializedReportProjectionKey> = NonNullable<PluginExperimentReport[K]>;

export type ReportSectionBuildContext = {
  run: ExperimentRun;
  contextPacks?: ReadonlyMap<string, ContextPack>;
};

export type ReportSectionDescriptorV1<K extends SpecializedReportProjectionKey = SpecializedReportProjectionKey> = {
  /** Stable namespaced identifier, e.g. `retrieval.precision-recall`. */
  readonly id: string;
  /** Deterministic presentation position; ties are broken by id. */
  readonly order: number;
  /** Field of PluginExperimentReport that carries this section's typed projection. */
  readonly projectionKey: K;
  /** Existing plugin identity this section applies to. */
  readonly appliesTo: { readonly pluginIds: readonly string[] };
  /**
   * Text presentation when no projection is available: `placeholder` keeps the established titled
   * "Not applicable to this plugin." block, `omit` writes nothing. `title` is null when the family
   * renderer writes its own headings.
   */
  readonly text: { readonly title: string | null; readonly whenAbsent: "placeholder" | "omit" };
  /** Existing family builder; returns null when the run does not belong to the family. */
  readonly build: (context: ReportSectionBuildContext) => PluginExperimentReport[K];
  /** Existing family text renderer; called only with an available projection. */
  readonly renderText: (lines: string[], projection: ReportSectionProjection<K>) => void;
  /** Existing family HTML renderer; keeps its own null behavior. */
  readonly renderHtml: (projection: PluginExperimentReport[K]) => string;
};

export type ReportSectionAvailability = "available" | "unavailable" | "not-applicable" | "unsupported";

export type ResolvedReportSection = {
  readonly id: string;
  readonly order: number;
  readonly availability: ReportSectionAvailability;
  readonly descriptor: ReportSectionDescriptorV1 | null;
};

export type ReportSectionRegistry = {
  readonly descriptors: readonly ReportSectionDescriptorV1[];
  get(id: string): ReportSectionDescriptorV1 | undefined;
  /** Resolves every registered section against a built report, in deterministic order. */
  resolve(report: PluginExperimentReport): ResolvedReportSection[];
  /** Resolves one id; an id that is not registered is `unsupported`, never `available`. */
  resolveById(id: string, report: PluginExperimentReport): ResolvedReportSection;
};

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function validate(descriptor: ReportSectionDescriptorV1): void {
  const label = typeof descriptor?.id === "string" ? descriptor.id : "<unknown>";
  if (typeof descriptor?.id !== "string" || !ID_PATTERN.test(descriptor.id)) {
    throw new Error(`Invalid report section registration ${label}: id must be a stable lowercase namespaced identifier.`);
  }
  if (!Number.isInteger(descriptor.order)) {
    throw new Error(`Invalid report section registration ${label}: order must be an integer.`);
  }
  if (typeof descriptor.projectionKey !== "string" || descriptor.projectionKey.length === 0) {
    throw new Error(`Invalid report section registration ${label}: projectionKey is required.`);
  }
  const pluginIds = descriptor.appliesTo?.pluginIds;
  if (!Array.isArray(pluginIds) || pluginIds.length === 0 || pluginIds.some((id) => typeof id !== "string" || !id)) {
    throw new Error(`Invalid report section registration ${label}: appliesTo.pluginIds must be a non-empty list of plugin ids.`);
  }
  for (const member of ["build", "renderText", "renderHtml"] as const) {
    if (typeof descriptor[member] !== "function") {
      throw new Error(`Invalid report section registration ${label}: ${member} must be a function.`);
    }
  }
  if (descriptor.text?.whenAbsent !== "placeholder" && descriptor.text?.whenAbsent !== "omit") {
    throw new Error(`Invalid report section registration ${label}: text.whenAbsent must be placeholder or omit.`);
  }
  if (descriptor.text.whenAbsent === "placeholder" && !descriptor.text.title) {
    throw new Error(`Invalid report section registration ${label}: a placeholder text section requires a title.`);
  }
}

/** Assembles an immutable registry. Duplicate ids, duplicate projection keys and invalid descriptors fail. */
export function createReportSectionRegistry(input: readonly ReportSectionDescriptorV1[]): ReportSectionRegistry {
  const ids = new Set<string>();
  const keys = new Set<string>();
  const frozen: ReportSectionDescriptorV1[] = [];
  for (const descriptor of input) {
    validate(descriptor);
    if (ids.has(descriptor.id)) {
      throw new Error(`Duplicate report section registration: ${descriptor.id}.`);
    }
    if (keys.has(descriptor.projectionKey)) {
      throw new Error(`Duplicate report section projection key ${descriptor.projectionKey} (section ${descriptor.id}).`);
    }
    ids.add(descriptor.id);
    keys.add(descriptor.projectionKey);
    frozen.push(
      Object.freeze({
        ...descriptor,
        appliesTo: Object.freeze({ pluginIds: Object.freeze([...descriptor.appliesTo.pluginIds]) }),
        text: Object.freeze({ ...descriptor.text }),
      })
    );
  }
  frozen.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const descriptors = Object.freeze(frozen);
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));

  const availabilityOf = (descriptor: ReportSectionDescriptorV1, report: PluginExperimentReport): ReportSectionAvailability => {
    const projection = report[descriptor.projectionKey] ?? null;
    if (projection !== null) return "available";
    return descriptor.appliesTo.pluginIds.includes(report.plugin.id) ? "unavailable" : "not-applicable";
  };

  return Object.freeze({
    descriptors,
    get: (id: string) => byId.get(id),
    resolve: (report: PluginExperimentReport) =>
      descriptors.map((descriptor) => ({
        id: descriptor.id,
        order: descriptor.order,
        availability: availabilityOf(descriptor, report),
        descriptor,
      })),
    resolveById: (id: string, report: PluginExperimentReport): ResolvedReportSection => {
      const descriptor = byId.get(id);
      if (!descriptor) return { id, order: Number.MAX_SAFE_INTEGER, availability: "unsupported", descriptor: null };
      return { id, order: descriptor.order, availability: availabilityOf(descriptor, report), descriptor };
    },
  });
}
