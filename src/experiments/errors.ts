export class ExperimentRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentRegistryError";
  }
}

export class ExperimentTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentTargetError";
  }
}

export class ExperimentConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentConfigValidationError";
  }
}
