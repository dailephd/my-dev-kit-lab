import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Containment policy for deliberately traversing --out / --index values.
//
// A traversing value may only be handed to a CLI when its full destination is
// proven to stay inside a NEW task-owned disposable enclosure. The enclosure is
// not the declared output directory: the value may leave the declared
// directory, but never the enclosure. Anything that cannot be proven is refused
// before launch.
// ---------------------------------------------------------------------------

/** Largest number of net parent components the harness will accommodate. */
export const MAX_TRAVERSAL_DEPTH = 10;

/** Longest destination (excluding the file a CLI adds) allowed on Windows. */
const MAX_WINDOWS_DESTINATION_LENGTH = 200;
const MAX_POSIX_DESTINATION_LENGTH = 3000;

export type TraversalValuePlan =
  | { kind: "relative"; nestDepth: number }
  | { kind: "refused"; reason: string };

function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Pure classification of a traversal value according to how the given host
 * platform resolves it. Reports how many parent components the value needs
 * room for, or refuses values that are absolute or ambiguous on that host.
 */
export function classifyTraversalValue(
  value: string,
  platform: NodeJS.Platform = process.platform
): TraversalValuePlan {
  if (value.length === 0) {
    return { kind: "refused", reason: "empty path value" };
  }
  if (value.includes("\0")) {
    return { kind: "refused", reason: "path value contains a NUL character" };
  }
  const host = pathFor(platform);
  if (host.isAbsolute(value)) {
    return { kind: "refused", reason: `absolute path on ${platform}: destination is not confined to the enclosure` };
  }
  if (platform === "win32") {
    if (/^[A-Za-z]:/.test(value)) {
      return { kind: "refused", reason: "drive-qualified path on win32: drive-relative resolution is ambiguous" };
    }
    if (/[<>:"|?*]/.test(value)) {
      return { kind: "refused", reason: "win32 path contains reserved characters (stream or device ambiguity)" };
    }
  }

  const segments = value.split(platform === "win32" ? /[\\/]+/ : /\/+/);
  let depth = 0;
  let lowest = 0;
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      depth -= 1;
      lowest = Math.min(lowest, depth);
    } else {
      if (platform === "win32" && /[. ]$/.test(segment)) {
        return { kind: "refused", reason: "win32 path component ends in a dot or space and would be rewritten by the OS" };
      }
      depth += 1;
    }
  }
  const nestDepth = lowest === 0 ? 0 : -lowest;
  if (nestDepth > MAX_TRAVERSAL_DEPTH) {
    return {
      kind: "refused",
      reason: `traversal depth ${nestDepth} exceeds the supported maximum of ${MAX_TRAVERSAL_DEPTH}`,
    };
  }
  return { kind: "relative", nestDepth };
}

/** True when `candidate` equals or is below `parent` under the host's path semantics. */
export function isPathInside(
  parent: string,
  candidate: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const host = pathFor(platform);
  const relative = host.relative(parent, candidate);
  if (relative === "") return true;
  return !relative.startsWith("..") && !host.isAbsolute(relative);
}

export type ContainmentProof =
  | {
      ok: true;
      /** Fully resolved attempted destination. */
      destination: string;
      /** Real path of the enclosure the destination was proven to be inside. */
      enclosure: string;
      /** Nearest existing physical ancestor of the destination. */
      nearestExisting: string;
      /** Destination relative to the enclosure, with forward slashes. */
      relativeToEnclosure: string;
      /** Real path of the declared allowed directory. */
      declared: string;
      /** Whether the destination stays inside the declared allowed directory. */
      insideDeclared: boolean;
    }
  | { ok: false; reason: string };

/**
 * Resolves `value` against `baseDir` and proves, using the real filesystem,
 * that the destination, its nearest existing parent and every not-yet-created
 * descendant stay inside `enclosureDir`. Never creates anything.
 */
export function proveContainment(options: {
  value: string;
  baseDir: string;
  enclosureDir: string;
  declaredDir: string;
}): ContainmentProof {
  const { value, baseDir, enclosureDir, declaredDir } = options;
  const platform = process.platform;
  const host = pathFor(platform);

  const plan = classifyTraversalValue(value, platform);
  if (plan.kind === "refused") return { ok: false, reason: plan.reason };

  let enclosure: string;
  let realBase: string;
  let realDeclared: string;
  try {
    enclosure = realpathSync.native(enclosureDir);
    realBase = realpathSync.native(baseDir);
    realDeclared = realpathSync.native(declaredDir);
  } catch (error) {
    return { ok: false, reason: `enclosure, base or declared directory is not inspectable: ${errorMessage(error)}` };
  }
  if (!isPathInside(enclosure, realBase, platform) || !isPathInside(enclosure, realDeclared, platform)) {
    return { ok: false, reason: "base or declared directory is not inside the enclosure" };
  }

  const destination = host.resolve(realBase, value);
  if (!isPathInside(enclosure, destination, platform)) {
    return { ok: false, reason: `destination ${destination} resolves outside the enclosure ${enclosure}` };
  }
  const limit = platform === "win32" ? MAX_WINDOWS_DESTINATION_LENGTH : MAX_POSIX_DESTINATION_LENGTH;
  if (destination.length > limit) {
    return { ok: false, reason: `destination length ${destination.length} exceeds the supported ${limit}` };
  }

  // Find the nearest existing physical ancestor; anything else is inspectable
  // only if lstat answers either "exists" or "does not exist".
  let nearest = destination;
  for (;;) {
    try {
      lstatSync(nearest);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return { ok: false, reason: `cannot inspect ${nearest}: ${errorMessage(error)}` };
      }
      const parent = host.dirname(nearest);
      if (parent === nearest || !isPathInside(enclosure, parent, platform)) {
        return { ok: false, reason: "no existing ancestor found inside the enclosure" };
      }
      nearest = parent;
    }
  }

  // Existing part must be a plain directory chain: no links, junctions or
  // case/short-name aliases (the real path must equal the lexical path).
  let nearestReal: string;
  try {
    if (lstatSync(nearest).isSymbolicLink()) {
      return { ok: false, reason: `${nearest} is a symbolic link or junction` };
    }
    nearestReal = realpathSync.native(nearest);
  } catch (error) {
    return { ok: false, reason: `cannot resolve ${nearest}: ${errorMessage(error)}` };
  }
  if (nearestReal !== nearest) {
    return { ok: false, reason: `${nearest} is an alias of ${nearestReal} (link, junction, case or short-name ambiguity)` };
  }
  if (!isPathInside(enclosure, nearestReal, platform)) {
    return { ok: false, reason: `${nearest} resolves outside the enclosure` };
  }

  return {
    ok: true,
    destination,
    enclosure,
    nearestExisting: nearest,
    relativeToEnclosure: host.relative(enclosure, destination).split(host.sep).join("/"),
    declared: realDeclared,
    insideDeclared: isPathInside(realDeclared, destination, platform),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
