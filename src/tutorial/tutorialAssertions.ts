import { readFile, stat } from "node:fs/promises";
import type { PlaywrightLikeTutorialPage } from "../browser/types.js";
import { resolveTargetFilePath } from "./tutorialPaths.js";
import { describeTutorialLocator, resolveTutorialLocator } from "./tutorialLocators.js";
import {
  DEFAULT_TUTORIAL_ASSERTION_TIMEOUT_MS,
  type TutorialAssertionResultV1,
  type TutorialAssertionV1,
  type TutorialJsonScalar
} from "./types.js";

export type TutorialAssertionContext = {
  /** Validated loopback origin; HTTP assertions may not leave it. */
  applicationUrl: string;
  /** Run-owned disposable target working copy; file assertions may not escape it. */
  targetRoot: string;
};

export type JsonPointerResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/**
 * RFC 6901 JSON Pointer resolution.
 *
 * Deliberately only JSON Pointer: no JSONPath, no dot-notation expression
 * language, no evaluation. A pointer can address data but can never compute.
 */
export function resolveJsonPointer(document: unknown, pointer: string): JsonPointerResult {
  if (typeof pointer !== "string") {
    return { ok: false, error: "JSON Pointer must be a string." };
  }
  if (pointer === "") {
    return { ok: true, value: document };
  }
  if (!pointer.startsWith("/")) {
    return { ok: false, error: `JSON Pointer must be empty or begin with "/"; received ${JSON.stringify(pointer)}.` };
  }

  let current: unknown = document;
  const rawTokens = pointer.slice(1).split("/");

  for (const rawToken of rawTokens) {
    const badEscape = /~(?![01])/.exec(rawToken);
    if (badEscape) {
      return {
        ok: false,
        error: `Malformed JSON Pointer escape in segment ${JSON.stringify(rawToken)}; "~" must be followed by "0" or "1".`
      };
    }
    // Order matters: ~1 becomes "/" first, then ~0 becomes "~", so an encoded
    // "~1" inside a name is not re-interpreted as a separator.
    const token = rawToken.replace(/~1/g, "/").replace(/~0/g, "~");

    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) {
        return { ok: false, error: `JSON Pointer segment ${JSON.stringify(token)} is not a valid array index.` };
      }
      const index = Number(token);
      if (index >= current.length) {
        return { ok: false, error: `JSON Pointer segment ${JSON.stringify(token)} is out of range.` };
      }
      current = current[index];
      continue;
    }

    if (typeof current === "object" && current !== null) {
      if (!Object.prototype.hasOwnProperty.call(current, token)) {
        return { ok: false, error: `JSON Pointer segment ${JSON.stringify(token)} was not found.` };
      }
      current = (current as Record<string, unknown>)[token];
      continue;
    }

    return {
      ok: false,
      error: `JSON Pointer segment ${JSON.stringify(token)} cannot be resolved against a non-object value.`
    };
  }

  return { ok: true, value: current };
}

/**
 * Resolves an HTTP assertion path against the application origin and refuses
 * anything that leaves it. Mirrors the navigation rule so a scenario cannot use
 * assertions as a general-purpose network client.
 */
export function resolveAssertionRequestUrl(applicationUrl: string, suppliedPath: string): string {
  if (typeof suppliedPath !== "string" || !suppliedPath.startsWith("/") || suppliedPath.startsWith("//")) {
    throw new Error(
      `HTTP assertion path must be a root-relative path beginning with "/" and must not be protocol-relative; received ${JSON.stringify(suppliedPath)}.`
    );
  }
  const base = new URL(applicationUrl);
  const resolved = new URL(suppliedPath, base);
  if (resolved.protocol !== base.protocol || resolved.hostname !== base.hostname || resolved.port !== base.port) {
    throw new Error(
      `HTTP assertion path ${JSON.stringify(suppliedPath)} resolves to ${resolved.origin}, which leaves the application origin ${base.origin}.`
    );
  }
  return resolved.href;
}

export async function executeTutorialAssertion(
  page: PlaywrightLikeTutorialPage,
  assertion: TutorialAssertionV1,
  context: TutorialAssertionContext
): Promise<TutorialAssertionResultV1> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  let failure: string | undefined;
  try {
    failure = await evaluateAssertion(page, assertion, context);
  } catch (error) {
    // An ordinary assertion problem must never escape as an unhandled
    // exception; it is recorded as a failed assertion result instead.
    failure = error instanceof Error ? error.message : String(error);
  }

  const endedAtMs = Date.now();
  return {
    type: assertion.type,
    status: failure === undefined ? "passed" : "failed",
    startedAt,
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: endedAtMs - startedAtMs,
    ...(failure === undefined ? {} : { error: failure })
  };
}

/** Returns undefined when the assertion holds, otherwise a failure message. */
async function evaluateAssertion(
  page: PlaywrightLikeTutorialPage,
  assertion: TutorialAssertionV1,
  context: TutorialAssertionContext
): Promise<string | undefined> {
  switch (assertion.type) {
    case "element-visible": {
      const locator = resolveTutorialLocator(page, assertion.locator);
      try {
        await locator.waitFor({ state: "visible", timeout: assertionTimeout(assertion.timeoutMs) });
        return undefined;
      } catch (error) {
        return `Element ${describeTutorialLocator(assertion.locator)} was not visible within ${assertionTimeout(assertion.timeoutMs)}ms: ${messageOf(error)}`;
      }
    }

    case "text-equals":
    case "text-contains": {
      const locator = resolveTutorialLocator(page, assertion.locator);
      const actual = await locator.textContent({ timeout: assertionTimeout(assertion.timeoutMs) });
      if (actual === null) {
        return `Element ${describeTutorialLocator(assertion.locator)} has no text content.`;
      }
      if (assertion.type === "text-equals") {
        return actual === assertion.expected
          ? undefined
          : `Element ${describeTutorialLocator(assertion.locator)} text was ${JSON.stringify(actual)}, expected exactly ${JSON.stringify(assertion.expected)}.`;
      }
      return actual.includes(assertion.expected)
        ? undefined
        : `Element ${describeTutorialLocator(assertion.locator)} text was ${JSON.stringify(actual)}, expected it to contain ${JSON.stringify(assertion.expected)}.`;
    }

    case "url-path-equals": {
      const actual = comparableUrlPath(page.url(), assertion.expected);
      return actual === assertion.expected
        ? undefined
        : `Page path was ${JSON.stringify(actual)}, expected ${JSON.stringify(assertion.expected)}.`;
    }

    case "attribute-equals": {
      const locator = resolveTutorialLocator(page, assertion.locator);
      const actual = await locator.getAttribute(assertion.name, {
        timeout: assertionTimeout(assertion.timeoutMs)
      });
      if (actual === null) {
        return `Element ${describeTutorialLocator(assertion.locator)} has no ${JSON.stringify(assertion.name)} attribute.`;
      }
      return actual === assertion.expected
        ? undefined
        : `Element ${describeTutorialLocator(assertion.locator)} attribute ${JSON.stringify(assertion.name)} was ${JSON.stringify(actual)}, expected ${JSON.stringify(assertion.expected)}.`;
    }

    case "http-json-equals": {
      const url = resolveAssertionRequestUrl(context.applicationUrl, assertion.path);
      const timeoutMs = assertionTimeout(assertion.timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        return `HTTP assertion request to ${assertion.path} failed: ${messageOf(error)}`;
      }
      if (response.status < 200 || response.status > 299) {
        await response.body?.cancel().catch(() => undefined);
        return `HTTP assertion request to ${assertion.path} returned status ${response.status}; expected a 2xx response.`;
      }
      let body: string;
      try {
        body = await response.text();
      } catch (error) {
        return `HTTP assertion response body for ${assertion.path} could not be read: ${messageOf(error)}`;
      }
      let document: unknown;
      try {
        document = JSON.parse(body) as unknown;
      } catch (error) {
        return `HTTP assertion response body for ${assertion.path} is not valid JSON: ${messageOf(error)}`;
      }
      return compareAtPointer(document, assertion.pointer, assertion.expected, `${assertion.path}`);
    }

    case "json-file-equals": {
      const filePath = resolveTargetFilePath(context.targetRoot, assertion.path);
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch (error) {
        return `JSON file assertion could not read ${assertion.path}: ${messageOf(error)}`;
      }
      let document: unknown;
      try {
        document = JSON.parse(raw) as unknown;
      } catch (error) {
        return `JSON file ${assertion.path} is not valid JSON: ${messageOf(error)}`;
      }
      return compareAtPointer(document, assertion.pointer, assertion.expected, assertion.path);
    }

    case "file-exists": {
      const filePath = resolveTargetFilePath(context.targetRoot, assertion.path);
      try {
        const stats = await stat(filePath);
        if (!stats.isFile()) {
          return `Expected ${assertion.path} to be a regular file beneath the tutorial target root, but it is a directory.`;
        }
        return undefined;
      } catch (error) {
        return `Expected file ${assertion.path} to exist beneath the tutorial target root: ${messageOf(error)}`;
      }
    }
  }
}

function compareAtPointer(
  document: unknown,
  pointer: string,
  expected: TutorialJsonScalar,
  sourceLabel: string
): string | undefined {
  const resolved = resolveJsonPointer(document, pointer);
  if (!resolved.ok) {
    return `JSON Pointer ${JSON.stringify(pointer)} did not resolve in ${sourceLabel}: ${resolved.error}`;
  }
  const actual = resolved.value;
  if (
    actual !== null &&
    typeof actual !== "string" &&
    typeof actual !== "number" &&
    typeof actual !== "boolean"
  ) {
    return `JSON Pointer ${JSON.stringify(pointer)} in ${sourceLabel} resolved to a non-scalar value; expected ${JSON.stringify(expected)}.`;
  }
  return actual === expected
    ? undefined
    : `JSON Pointer ${JSON.stringify(pointer)} in ${sourceLabel} was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`;
}

/**
 * Compares only the path portion of the current URL, extended with query and
 * hash when (and only when) the expectation asks for them. The host is never
 * compared because the origin is already constrained by navigation policy.
 */
export function comparableUrlPath(currentUrl: string, expected: string): string {
  let parsed: URL;
  try {
    parsed = new URL(currentUrl);
  } catch {
    return currentUrl;
  }
  if (expected.includes("#")) {
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  if (expected.includes("?")) {
    return `${parsed.pathname}${parsed.search}`;
  }
  return parsed.pathname;
}

function assertionTimeout(timeoutMs: number | undefined): number {
  return timeoutMs ?? DEFAULT_TUTORIAL_ASSERTION_TIMEOUT_MS;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
