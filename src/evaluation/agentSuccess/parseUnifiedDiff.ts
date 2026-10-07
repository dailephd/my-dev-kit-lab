import type { ParsedPatchFile, PatchParseResult } from "./patchTypes.js";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

class PatchMalformed extends Error {
  constructor(
    readonly code: "PATCH_MALFORMED" | "UNSUPPORTED_PATH_QUOTING",
    message: string
  ) {
    super(message);
  }
}

function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Mirrors `git apply -p1`: drop exactly one leading path component. */
function stripOneComponent(rawPath: string): string {
  const slash = rawPath.indexOf("/");
  if (slash < 0) {
    throw new PatchMalformed("PATCH_MALFORMED", "a patch path has no directory component to strip.");
  }
  return rawPath.slice(slash + 1);
}

function parseHeaderPath(headerValue: string): string | null {
  const value = headerValue.split("\t")[0]!.trimEnd();
  if (value.startsWith('"')) {
    throw new PatchMalformed("UNSUPPORTED_PATH_QUOTING", "quoted patch paths are not supported.");
  }
  if (value === "/dev/null") return null;
  return stripOneComponent(value);
}

/** `diff --git <a> <b>`: returns the shared path when both sides agree after -p1 stripping, else null. */
function parseGitHeaderPath(rest: string): string | null {
  if (rest.startsWith('"')) {
    throw new PatchMalformed("UNSUPPORTED_PATH_QUOTING", "quoted patch paths are not supported.");
  }
  for (let index = rest.indexOf(" "); index >= 0; index = rest.indexOf(" ", index + 1)) {
    const left = rest.slice(0, index);
    const right = rest.slice(index + 1);
    if (!left.includes("/") || !right.includes("/")) continue;
    if (stripOneComponent(left) === stripOneComponent(right)) return stripOneComponent(right);
  }
  return null;
}

function newFile(gitHeaderPath: string | null): ParsedPatchFile {
  return {
    oldPath: null,
    newPath: null,
    gitHeaderPath,
    isNew: false,
    isDelete: false,
    binary: false,
    rename: false,
    copy: false,
    oldMode: null,
    newMode: null,
    subproject: false,
    hunkCount: 0
  };
}

/**
 * Parses a Git/unified diff into per-file records with exact hunk accounting: every hunk must contain
 * precisely the old/new line counts its header declares, so truncated or padded patches are rejected here
 * instead of being half-understood. Only structure is recorded; policy decisions live in validatePatchPolicy.
 */
export function parseUnifiedDiff(patch: string): PatchParseResult {
  try {
    const lines = patch.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    const files: ParsedPatchFile[] = [];
    let index = 0;

    const parseFileHeaders = (file: ParsedPatchFile): void => {
      const oldHeader = stripCr(lines[index]!);
      const plusLine = lines[index + 1];
      if (plusLine === undefined || !stripCr(plusLine).startsWith("+++ ")) {
        throw new PatchMalformed("PATCH_MALFORMED", 'a "---" header is not followed by a "+++" header.');
      }
      file.oldPath = parseHeaderPath(oldHeader.slice(4));
      file.newPath = parseHeaderPath(stripCr(plusLine).slice(4));
      if (file.oldPath === null) file.isNew = true;
      if (file.newPath === null) file.isDelete = true;
      index += 2;
      while (index < lines.length && stripCr(lines[index]!).startsWith("@@")) {
        parseHunk(file);
      }
    };

    const parseHunk = (file: ParsedPatchFile): void => {
      const match = HUNK_HEADER.exec(stripCr(lines[index]!));
      if (!match) throw new PatchMalformed("PATCH_MALFORMED", "malformed hunk header.");
      let oldRemaining = match[2] === undefined ? 1 : Number(match[2]);
      let newRemaining = match[4] === undefined ? 1 : Number(match[4]);
      index += 1;
      while (oldRemaining > 0 || newRemaining > 0) {
        const line = lines[index];
        if (line === undefined) throw new PatchMalformed("PATCH_MALFORMED", "a hunk ends before its declared line counts.");
        const marker = line.length === 0 ? " " : line[0]!;
        if (marker === " ") {
          oldRemaining -= 1;
          newRemaining -= 1;
        } else if (marker === "-") {
          oldRemaining -= 1;
          if (line.startsWith("-Subproject commit ")) file.subproject = true;
        } else if (marker === "+") {
          newRemaining -= 1;
          if (line.startsWith("+Subproject commit ")) file.subproject = true;
        } else if (marker !== "\\") {
          throw new PatchMalformed("PATCH_MALFORMED", "unexpected line inside a hunk.");
        }
        if (oldRemaining < 0 || newRemaining < 0) {
          throw new PatchMalformed("PATCH_MALFORMED", "a hunk has more lines than its header declares.");
        }
        index += 1;
      }
      while (index < lines.length && lines[index]!.startsWith("\\")) index += 1;
      file.hunkCount += 1;
    };

    while (index < lines.length) {
      const line = stripCr(lines[index]!);
      if (line.startsWith("diff --git ")) {
        const file = newFile(parseGitHeaderPath(line.slice("diff --git ".length)));
        index += 1;
        while (index < lines.length) {
          const header = stripCr(lines[index]!);
          if (header.startsWith("--- ") || header.startsWith("diff --git ")) break;
          let match: RegExpExecArray | null;
          if ((match = /^index [0-9a-f]+\.\.[0-9a-f]+(?: (\d+))?$/.exec(header))) {
            if (match[1]) {
              file.oldMode = match[1];
              file.newMode = match[1];
            }
          } else if ((match = /^old mode (\d+)$/.exec(header))) {
            file.oldMode = match[1]!;
          } else if ((match = /^new mode (\d+)$/.exec(header))) {
            file.newMode = match[1]!;
          } else if ((match = /^deleted file mode (\d+)$/.exec(header))) {
            file.isDelete = true;
            file.oldMode = match[1]!;
          } else if ((match = /^new file mode (\d+)$/.exec(header))) {
            file.isNew = true;
            file.newMode = match[1]!;
          } else if (/^(?:dis)?similarity index \d+%$/.test(header)) {
            // informational; rename/copy intent is carried by the from/to lines
          } else if (/^rename (?:from|to) /.test(header)) {
            file.rename = true;
          } else if (/^copy (?:from|to) /.test(header)) {
            file.copy = true;
          } else if (/^Binary files .* differ$/.test(header) || header === "GIT binary patch") {
            file.binary = true;
            index += 1;
            while (index < lines.length && !lines[index]!.startsWith("diff --git ")) index += 1;
            break;
          } else {
            throw new PatchMalformed("PATCH_MALFORMED", "unrecognized extended header line.");
          }
          index += 1;
        }
        if (!file.binary && index < lines.length && stripCr(lines[index]!).startsWith("--- ")) {
          parseFileHeaders(file);
        }
        files.push(file);
      } else if (line.startsWith("--- ") && lines[index + 1] !== undefined && stripCr(lines[index + 1]!).startsWith("+++ ")) {
        const file = newFile(null);
        parseFileHeaders(file);
        files.push(file);
      } else if (line.trim() === "") {
        index += 1;
      } else {
        throw new PatchMalformed("PATCH_MALFORMED", "unexpected content outside a file section.");
      }
    }

    if (files.length === 0) {
      throw new PatchMalformed("PATCH_MALFORMED", "the patch contains no file sections.");
    }
    for (const file of files) {
      if ((file.oldPath ?? file.newPath ?? file.gitHeaderPath) === null && !file.rename && !file.copy) {
        throw new PatchMalformed("PATCH_MALFORMED", "a file section has no determinable path.");
      }
    }
    return { ok: true, files };
  } catch (error) {
    if (error instanceof PatchMalformed) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}
