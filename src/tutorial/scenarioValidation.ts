import {
  MAX_STEP_PAUSE_MS,
  MAX_TUTORIAL_STEPS,
  MAX_VIEWPORT_HEIGHT,
  MAX_VIEWPORT_WIDTH,
  MIN_VIEWPORT_HEIGHT,
  MIN_VIEWPORT_WIDTH,
  TUTORIAL_ACTION_TYPES,
  TUTORIAL_ASSERTION_TYPES,
  TUTORIAL_CALLOUT_PLACEMENTS,
  TUTORIAL_GOTO_WAIT_UNTIL,
  TUTORIAL_LOCATOR_KINDS,
  TUTORIAL_SCHEMA_VERSION,
  TUTORIAL_WAIT_FOR_STATES,
  type TutorialActionV1,
  type TutorialAssertionV1,
  type TutorialLocatorV1,
  type TutorialScenarioV1,
  type TutorialStepV1,
  type TutorialValidationResult
} from "./types.js";
import {
  createErrorCollector,
  describeValue,
  isJsonScalar,
  isNonEmptyString,
  isNonNegativeInteger,
  isPlainObject,
  rejectUnknownKeys,
  validateOptionalTimeout,
  validateSchemaVersion,
  validateStableId,
  type ErrorCollector
} from "./validationPrimitives.js";

const SCENARIO_KEYS = ["schemaVersion", "id", "title", "description", "targetId", "browser", "steps"] as const;
const STEP_KEYS = [
  "id",
  "narration",
  "pauseBeforeMs",
  "pauseAfterMs",
  "action",
  "highlight",
  "callout",
  "screenshot",
  "assertions"
] as const;

/**
 * Validates a parsed JSON value as a TutorialScenarioV1.
 *
 * Strict by construction: unknown action, assertion and locator kinds fail, and
 * unknown object fields fail rather than being ignored. That closure is what
 * keeps a scenario from smuggling in an execution escape hatch (an `evaluate`
 * action, a `script` field, an absolute `goto` URL) that a permissive validator
 * would quietly drop on the floor.
 *
 * `source` is used to prefix each message, normally the scenario file path.
 */
export function validateTutorialScenario(
  value: unknown,
  source = "Scenario"
): TutorialValidationResult<TutorialScenarioV1> {
  const errors = createErrorCollector(source);

  if (!isPlainObject(value)) {
    errors.add("<root>", `expected a JSON object, received ${describeValue(value)}.`);
    return { ok: false, errors: errors.errors };
  }

  rejectUnknownKeys(errors, "<root>", value, SCENARIO_KEYS);
  validateSchemaVersion(errors, value.schemaVersion, TUTORIAL_SCHEMA_VERSION);
  validateStableId(errors, "id", value.id);
  validateStableId(errors, "targetId", value.targetId);

  if (!isNonEmptyString(value.title)) {
    errors.add("title", `expected a non-empty title string, received ${describeValue(value.title)}.`);
  }
  if (value.description !== undefined && typeof value.description !== "string") {
    errors.add("description", `expected a string when supplied, received ${describeValue(value.description)}.`);
  }

  validateBrowser(errors, value.browser);
  validateSteps(errors, value.steps);

  if (errors.length > 0) {
    return { ok: false, errors: errors.errors };
  }
  return { ok: true, value: value as unknown as TutorialScenarioV1 };
}

function validateBrowser(errors: ErrorCollector, value: unknown): void {
  if (!isPlainObject(value)) {
    errors.add("browser", `expected an object with a viewport, received ${describeValue(value)}.`);
    return;
  }
  rejectUnknownKeys(errors, "browser", value, ["viewport"]);

  const viewport = value.viewport;
  if (!isPlainObject(viewport)) {
    errors.add("browser.viewport", `expected an object with width and height, received ${describeValue(viewport)}.`);
    return;
  }
  rejectUnknownKeys(errors, "browser.viewport", viewport, ["width", "height"]);
  validateBounded(errors, "browser.viewport.width", viewport.width, MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH);
  validateBounded(errors, "browser.viewport.height", viewport.height, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT);
}

function validateBounded(
  errors: ErrorCollector,
  location: string,
  value: unknown,
  min: number,
  max: number
): void {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.add(location, `expected a finite integer, received ${describeValue(value)}.`);
    return;
  }
  if (value < min || value > max) {
    errors.add(location, `expected an integer between ${min} and ${max}, received ${value}.`);
  }
}

function validateSteps(errors: ErrorCollector, value: unknown): void {
  if (!Array.isArray(value)) {
    errors.add("steps", `expected an array of steps, received ${describeValue(value)}.`);
    return;
  }
  if (value.length === 0) {
    errors.add("steps", "a scenario must declare at least one step.");
    return;
  }
  if (value.length > MAX_TUTORIAL_STEPS) {
    errors.add("steps", `a scenario may declare at most ${MAX_TUTORIAL_STEPS} steps, received ${value.length}.`);
    return;
  }

  const stepIds = new Set<string>();
  const screenshotIds = new Set<string>();

  value.forEach((step, index) => {
    validateStep(errors, `steps[${index}]`, step, stepIds, screenshotIds);
  });
}

function validateStep(
  errors: ErrorCollector,
  location: string,
  value: unknown,
  stepIds: Set<string>,
  screenshotIds: Set<string>
): void {
  if (!isPlainObject(value)) {
    errors.add(location, `expected a step object, received ${describeValue(value)}.`);
    return;
  }
  rejectUnknownKeys(errors, location, value, STEP_KEYS);

  if (validateStableId(errors, `${location}.id`, value.id)) {
    if (stepIds.has(value.id as string)) {
      errors.add(`${location}.id`, `duplicate step id ${JSON.stringify(value.id)}.`);
    }
    stepIds.add(value.id as string);
  }

  if (!isNonEmptyString(value.narration)) {
    errors.add(
      `${location}.narration`,
      `expected non-empty narration text after trimming, received ${describeValue(value.narration)}.`
    );
  }

  validatePause(errors, `${location}.pauseBeforeMs`, value.pauseBeforeMs);
  validatePause(errors, `${location}.pauseAfterMs`, value.pauseAfterMs);

  if (value.action !== undefined) {
    validateAction(errors, `${location}.action`, value.action);
  }
  if (value.highlight !== undefined) {
    validateLocator(errors, `${location}.highlight`, value.highlight);
  }
  if (value.callout !== undefined) {
    validateCallout(errors, `${location}.callout`, value.callout);
  }
  if (value.screenshot !== undefined) {
    validateScreenshot(errors, `${location}.screenshot`, value.screenshot, screenshotIds);
  }
  if (value.assertions !== undefined) {
    if (!Array.isArray(value.assertions)) {
      errors.add(
        `${location}.assertions`,
        `expected an array of assertions, received ${describeValue(value.assertions)}.`
      );
    } else {
      value.assertions.forEach((assertion, index) => {
        validateAssertion(errors, `${location}.assertions[${index}]`, assertion);
      });
    }
  }
}

function validatePause(errors: ErrorCollector, location: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isNonNegativeInteger(value)) {
    errors.add(
      location,
      `expected a finite non-negative integer number of milliseconds, received ${describeValue(value)}.`
    );
    return;
  }
  if (value > MAX_STEP_PAUSE_MS) {
    errors.add(location, `expected at most ${MAX_STEP_PAUSE_MS}ms, received ${value}.`);
  }
}

function validateCallout(errors: ErrorCollector, location: string, value: unknown): void {
  if (!isPlainObject(value)) {
    errors.add(location, `expected a callout object, received ${describeValue(value)}.`);
    return;
  }
  rejectUnknownKeys(errors, location, value, ["text", "locator", "placement"]);
  if (!isNonEmptyString(value.text)) {
    errors.add(`${location}.text`, `expected non-empty callout text, received ${describeValue(value.text)}.`);
  }
  if (value.locator !== undefined) {
    validateLocator(errors, `${location}.locator`, value.locator);
  }
  if (value.placement !== undefined && !TUTORIAL_CALLOUT_PLACEMENTS.includes(value.placement as never)) {
    errors.add(
      `${location}.placement`,
      `expected one of ${TUTORIAL_CALLOUT_PLACEMENTS.join(", ")}, received ${describeValue(value.placement)}.`
    );
  }
}

function validateScreenshot(
  errors: ErrorCollector,
  location: string,
  value: unknown,
  screenshotIds: Set<string>
): void {
  if (!isPlainObject(value)) {
    errors.add(location, `expected a screenshot object, received ${describeValue(value)}.`);
    return;
  }
  rejectUnknownKeys(errors, location, value, ["id", "fullPage"]);
  if (validateStableId(errors, `${location}.id`, value.id)) {
    if (screenshotIds.has(value.id as string)) {
      errors.add(`${location}.id`, `duplicate screenshot id ${JSON.stringify(value.id)}.`);
    }
    screenshotIds.add(value.id as string);
  }
  if (value.fullPage !== undefined && typeof value.fullPage !== "boolean") {
    errors.add(`${location}.fullPage`, `expected a boolean, received ${describeValue(value.fullPage)}.`);
  }
}

export function validateLocator(errors: ErrorCollector, location: string, value: unknown): void {
  if (!isPlainObject(value)) {
    errors.add(location, `expected a locator object, received ${describeValue(value)}.`);
    return;
  }
  const kind = value.kind;
  if (typeof kind !== "string" || !TUTORIAL_LOCATOR_KINDS.includes(kind as never)) {
    errors.add(
      `${location}.kind`,
      `unsupported locator kind ${describeValue(kind)}; expected one of ${TUTORIAL_LOCATOR_KINDS.join(", ")}.`
    );
    return;
  }

  switch (kind as TutorialLocatorV1["kind"]) {
    case "role":
      rejectUnknownKeys(errors, location, value, ["kind", "role", "name", "exact"]);
      if (!isNonEmptyString(value.role)) {
        errors.add(`${location}.role`, `expected a non-empty role, received ${describeValue(value.role)}.`);
      }
      if (value.name !== undefined && !isNonEmptyString(value.name)) {
        errors.add(
          `${location}.name`,
          `expected a non-empty accessible name when supplied, received ${describeValue(value.name)}.`
        );
      }
      validateOptionalBoolean(errors, `${location}.exact`, value.exact);
      break;
    case "text":
      rejectUnknownKeys(errors, location, value, ["kind", "text", "exact"]);
      if (!isNonEmptyString(value.text)) {
        errors.add(`${location}.text`, `expected non-empty text, received ${describeValue(value.text)}.`);
      }
      validateOptionalBoolean(errors, `${location}.exact`, value.exact);
      break;
    case "css":
      rejectUnknownKeys(errors, location, value, ["kind", "selector"]);
      if (!isNonEmptyString(value.selector)) {
        errors.add(
          `${location}.selector`,
          `expected a non-empty CSS selector, received ${describeValue(value.selector)}.`
        );
      }
      break;
    case "test-id":
      rejectUnknownKeys(errors, location, value, ["kind", "testId"]);
      if (!isNonEmptyString(value.testId)) {
        errors.add(`${location}.testId`, `expected a non-empty testId, received ${describeValue(value.testId)}.`);
      }
      break;
  }
}

function validateOptionalBoolean(errors: ErrorCollector, location: string, value: unknown): void {
  if (value !== undefined && typeof value !== "boolean") {
    errors.add(location, `expected a boolean, received ${describeValue(value)}.`);
  }
}

export function validateAction(errors: ErrorCollector, location: string, value: unknown): void {
  if (!isPlainObject(value)) {
    errors.add(location, `expected an action object, received ${describeValue(value)}.`);
    return;
  }
  const type = value.type;
  if (typeof type !== "string" || !TUTORIAL_ACTION_TYPES.includes(type as never)) {
    errors.add(
      `${location}.type`,
      `unsupported action ${describeValue(type)}; expected one of ${TUTORIAL_ACTION_TYPES.join(", ")}.`
    );
    return;
  }

  switch (type as TutorialActionV1["type"]) {
    case "goto":
      rejectUnknownKeys(errors, location, value, ["type", "path", "waitUntil"]);
      validateGotoPath(errors, `${location}.path`, value.path);
      if (value.waitUntil !== undefined && !TUTORIAL_GOTO_WAIT_UNTIL.includes(value.waitUntil as never)) {
        errors.add(
          `${location}.waitUntil`,
          `expected one of ${TUTORIAL_GOTO_WAIT_UNTIL.join(", ")}, received ${describeValue(value.waitUntil)}.`
        );
      }
      break;
    case "click":
    case "hover":
      rejectUnknownKeys(errors, location, value, ["type", "locator", "timeoutMs"]);
      validateLocator(errors, `${location}.locator`, value.locator);
      validateOptionalTimeout(errors, `${location}.timeoutMs`, value.timeoutMs);
      break;
    case "fill":
      rejectUnknownKeys(errors, location, value, ["type", "locator", "value", "timeoutMs"]);
      validateLocator(errors, `${location}.locator`, value.locator);
      if (typeof value.value !== "string") {
        errors.add(`${location}.value`, `expected a string value to fill, received ${describeValue(value.value)}.`);
      }
      validateOptionalTimeout(errors, `${location}.timeoutMs`, value.timeoutMs);
      break;
    case "press":
      rejectUnknownKeys(errors, location, value, ["type", "locator", "key", "timeoutMs"]);
      validateLocator(errors, `${location}.locator`, value.locator);
      if (!isNonEmptyString(value.key)) {
        errors.add(`${location}.key`, `expected a non-empty key name, received ${describeValue(value.key)}.`);
      }
      validateOptionalTimeout(errors, `${location}.timeoutMs`, value.timeoutMs);
      break;
    case "drag":
      rejectUnknownKeys(errors, location, value, ["type", "source", "target", "timeoutMs"]);
      validateLocator(errors, `${location}.source`, value.source);
      validateLocator(errors, `${location}.target`, value.target);
      validateOptionalTimeout(errors, `${location}.timeoutMs`, value.timeoutMs);
      break;
    case "wait-for":
      rejectUnknownKeys(errors, location, value, ["type", "locator", "state", "timeoutMs"]);
      validateLocator(errors, `${location}.locator`, value.locator);
      if (value.state !== undefined && !TUTORIAL_WAIT_FOR_STATES.includes(value.state as never)) {
        errors.add(
          `${location}.state`,
          `expected one of ${TUTORIAL_WAIT_FOR_STATES.join(", ")}, received ${describeValue(value.state)}.`
        );
      }
      validateOptionalTimeout(errors, `${location}.timeoutMs`, value.timeoutMs);
      break;
  }
}

/**
 * A scenario may only navigate inside the target application's own origin, so a
 * goto path is a root-relative path, never a URL. Rejecting the URL forms here
 * (rather than only at resolution time) means an unsafe scenario fails
 * `tutorial validate` without any process ever being started.
 */
export function validateGotoPath(errors: ErrorCollector, location: string, value: unknown): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.add(location, `expected a root-relative path beginning with "/", received ${describeValue(value)}.`);
    return;
  }
  if (value.startsWith("//")) {
    errors.add(
      location,
      `protocol-relative paths are not allowed; received ${JSON.stringify(value)}. Use a root-relative path such as "/dashboard".`
    );
    return;
  }
  if (!value.startsWith("/")) {
    errors.add(
      location,
      `expected a root-relative path beginning with "/", received ${JSON.stringify(value)}. Absolute URLs and scheme-qualified values are not allowed.`
    );
  }
}

export function validateAssertion(errors: ErrorCollector, location: string, value: unknown): void {
  if (!isPlainObject(value)) {
    errors.add(location, `expected an assertion object, received ${describeValue(value)}.`);
    return;
  }
  const type = value.type;
  if (typeof type !== "string" || !TUTORIAL_ASSERTION_TYPES.includes(type as never)) {
    errors.add(
      `${location}.type`,
      `unsupported assertion ${describeValue(type)}; expected one of ${TUTORIAL_ASSERTION_TYPES.join(", ")}.`
    );
    return;
  }

  switch (type as TutorialAssertionV1["type"]) {
    case "element-visible":
      rejectUnknownKeys(errors, location, value, ["type", "locator", "timeoutMs"]);
      validateLocator(errors, `${location}.locator`, value.locator);
      validateOptionalTimeout(errors, `${location}.timeoutMs`, value.timeoutMs);
      break;
    case "text-equals":
    case "text-contains":
      rejectUnknownKeys(errors, location, value, ["type", "locator", "expected", "timeoutMs"]);
      validateLocator(errors, `${location}.locator`, value.locator);
      if (typeof value.expected !== "string") {
        errors.add(`${location}.expected`, `expected a string, received ${describeValue(value.expected)}.`);
      }
      validateOptionalTimeout(errors, `${location}.timeoutMs`, value.timeoutMs);
      break;
    case "url-path-equals":
      rejectUnknownKeys(errors, location, value, ["type", "expected"]);
      if (typeof value.expected !== "string" || !value.expected.startsWith("/")) {
        errors.add(
          `${location}.expected`,
          `expected a root-relative path beginning with "/", received ${describeValue(value.expected)}.`
        );
      }
      break;
    case "attribute-equals":
      rejectUnknownKeys(errors, location, value, ["type", "locator", "name", "expected", "timeoutMs"]);
      validateLocator(errors, `${location}.locator`, value.locator);
      if (!isNonEmptyString(value.name)) {
        errors.add(`${location}.name`, `expected a non-empty attribute name, received ${describeValue(value.name)}.`);
      }
      if (typeof value.expected !== "string") {
        errors.add(`${location}.expected`, `expected a string, received ${describeValue(value.expected)}.`);
      }
      validateOptionalTimeout(errors, `${location}.timeoutMs`, value.timeoutMs);
      break;
    case "http-json-equals":
      rejectUnknownKeys(errors, location, value, ["type", "path", "pointer", "expected", "timeoutMs"]);
      validateGotoPath(errors, `${location}.path`, value.path);
      validateJsonPointerDeclaration(errors, `${location}.pointer`, value.pointer);
      if (!isJsonScalar(value.expected)) {
        errors.add(
          `${location}.expected`,
          `expected a JSON scalar (string, finite number, boolean or null), received ${describeValue(value.expected)}.`
        );
      }
      validateOptionalTimeout(errors, `${location}.timeoutMs`, value.timeoutMs);
      break;
    case "json-file-equals":
      rejectUnknownKeys(errors, location, value, ["type", "path", "pointer", "expected"]);
      validateTargetRelativePath(errors, `${location}.path`, value.path);
      validateJsonPointerDeclaration(errors, `${location}.pointer`, value.pointer);
      if (!isJsonScalar(value.expected)) {
        errors.add(
          `${location}.expected`,
          `expected a JSON scalar (string, finite number, boolean or null), received ${describeValue(value.expected)}.`
        );
      }
      break;
    case "file-exists":
      rejectUnknownKeys(errors, location, value, ["type", "path"]);
      validateTargetRelativePath(errors, `${location}.path`, value.path);
      break;
  }
}

function validateTargetRelativePath(errors: ErrorCollector, location: string, value: unknown): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.add(
      location,
      `expected a non-empty path relative to the tutorial target root, received ${describeValue(value)}.`
    );
  }
}

function validateJsonPointerDeclaration(errors: ErrorCollector, location: string, value: unknown): void {
  if (typeof value !== "string") {
    errors.add(location, `expected a JSON Pointer string, received ${describeValue(value)}.`);
    return;
  }
  if (value.length > 0 && !value.startsWith("/")) {
    errors.add(
      location,
      `expected a JSON Pointer that is empty or begins with "/", received ${JSON.stringify(value)}.`
    );
    return;
  }
  // Reject a malformed escape early so a bad pointer fails validation rather
  // than silently never matching at assertion time.
  const badEscape = /~(?![01])/.exec(value);
  if (badEscape) {
    errors.add(
      location,
      `malformed JSON Pointer escape at index ${badEscape.index}; "~" must be followed by "0" or "1" in ${JSON.stringify(value)}.`
    );
  }
}

export type { TutorialStepV1 };
