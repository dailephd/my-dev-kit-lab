import { ExperimentRegistryError } from "./errors.js";
import type { ExperimentPlugin, ExperimentPluginMetadata } from "./types.js";

export class ExperimentPluginRegistry {
  private readonly plugins = new Map<string, ExperimentPlugin>();
  private readonly metadataById = new Map<string, ExperimentPluginMetadata>();

  register(plugin: ExperimentPlugin): void {
    const id = plugin.metadata.id;
    if (!id) {
      throw new ExperimentRegistryError("Experiment plugin metadata.id is required.");
    }
    if (this.plugins.has(id)) {
      throw new ExperimentRegistryError(`Experiment plugin is already registered: ${id}`);
    }

    this.plugins.set(id, plugin);
    this.metadataById.set(id, cloneMetadata(plugin.metadata));
  }

  list(): ExperimentPluginMetadata[] {
    return [...this.metadataById.values()].map(cloneMetadata);
  }

  describe(id: string): ExperimentPluginMetadata {
    const metadata = this.metadataById.get(id);
    if (!metadata) {
      throw new ExperimentRegistryError(`Experiment plugin not found: ${id}`);
    }
    return cloneMetadata(metadata);
  }

  find(id: string): ExperimentPlugin | undefined {
    return this.plugins.get(id);
  }

  get(id: string): ExperimentPlugin {
    const plugin = this.find(id);
    if (!plugin) {
      throw new ExperimentRegistryError(`Experiment plugin not found: ${id}`);
    }
    return plugin;
  }
}

function cloneMetadata(metadata: ExperimentPluginMetadata): ExperimentPluginMetadata {
  return {
    ...metadata,
    supportedTargets: [...metadata.supportedTargets],
    supportedOutputs: [...metadata.supportedOutputs],
  };
}
