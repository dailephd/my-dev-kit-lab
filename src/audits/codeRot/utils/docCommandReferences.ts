import path from "node:path";
import { splitLines } from "./textLines.js";

export type DocCommandReference = {
  command: string;
  lineNumber: number;
  excerpt: string;
  isLabeledPlanned: boolean;
  // An empty directory denotes the repository root; null is unresolved.
  packageDirectory: string | null;
};

const NPM_RUN_PATTERN = /\bnpm(?:[ \t]+--?[^ \t`;\r\n&|]+(?:[ \t]+(?!run\b|npm\b|--?)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^ \t`'";\r\n&|]+))?)*[ \t]+run[ \t]+(?:--\S+[ \t]+)*([\w:.-]+)/g;
const PLANNED_LABEL_PATTERN =
  /\b(planned|future|roadmap|not implemented|not yet implemented|later version|coming soon|avoid)\b/i;
const PLANNED_LABEL_WINDOW_LINES = 15;
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const FENCE_PATTERN = /^ {0,3}(````*|~~~+)[ \t]*(\S*)[ \t]*$/;
const SHELL_FENCE_LANGUAGES = new Set(["", "sh", "shell", "bash", "zsh", "powershell", "pwsh"]);
const DIRECTORY_CHANGE = /^(?:cd|pushd|popd|Set-Location)(?:[ \t]|$)/i;
const CONTEXT_OPTION = /(?:^|\s)(?:--(?:prefix|workspace|workspaces)(?:[=\s]|$)|-w(?:[=\s]|$))/;
const SHELL_OPERATORS = /[;&|<>]/;
const REPOSITORY_ROOT_CONTEXT = /\b(?:from the repository root|repository root commands)\b/i;

type CommandFence = {
  marker: string;
  shell: boolean;
  directory: string | null;
  sawCommand: boolean;
  localCd: boolean;
  localNpm: boolean;
  localPrefix: boolean;
};

function resolveLiteralDirectory(base: string | null, operand: string): string | null {
  // Admit ordinary project-relative path segments and a leading "./".
  // Reject platform-specific aliases, traversal, substitutions and quoting.
  if (base !== null && (operand === "." || operand === "./")) return base;
  if (base === null || !/^(?:\.\/)?[\w-]+(?:[.][\w-]+)*(?:\/[\w-]+(?:[.][\w-]+)*)*\/?$/.test(operand)) {
    return null;
  }
  if (operand.split("/").some((segment) => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
    return null;
  }
  return path.posix.join(base, operand).replace(/\/$/, "");
}

function invocationDirectory(invocation: string, base: string | null): string | null {
  const prefix = invocation.match(/^npm[ \t]+--prefix[ \t]+(\S+)[ \t]+run[ \t]+/);
  if (prefix) {
    return CONTEXT_OPTION.test(invocation.slice(prefix[0].length)) ? null : resolveLiteralDirectory(base, prefix[1]);
  }
  return /^npm[ \t]+run[ \t]+/.test(invocation) && !CONTEXT_OPTION.test(invocation) ? base : null;
}

export function extractDocCommandReferences(content: string, docPath: string): DocCommandReference[] {
  const lines = splitLines(content);
  const refs: DocCommandReference[] = [];
  const documentDirectory = path.posix.dirname(docPath);
  const headingStack: (string | undefined)[] = new Array(7).fill(undefined);
  let documentPackage = "";
  let fence: CommandFence | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fenceMatch && (!fence || (fenceMatch[2] === "" && fenceMatch[1].startsWith(fence.marker)))) {
      if (fence) {
        if (fence.localPrefix || (fence.localCd && fence.localNpm)) documentPackage = documentDirectory;
        fence = undefined;
      } else {
        fence = {
          marker: fenceMatch[1],
          shell: SHELL_FENCE_LANGUAGES.has(fenceMatch[2].toLowerCase()),
          directory: "",
          sawCommand: false,
          localCd: false,
          localNpm: false,
          localPrefix: false,
        };
      }
      continue;
    }

    const headingMatch = !fence && line.match(HEADING_PATTERN);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      headingStack[depth] = headingMatch[2];
      headingStack.fill(undefined, depth + 1);
      if (depth === 1) documentPackage = "";
    }

    if (fence?.shell && trimmed && !trimmed.startsWith("#")) {
      if (DIRECTORY_CHANGE.test(trimmed)) {
        const cd = trimmed.match(/^cd[ \t]+(\S+)$/i);
        fence.directory = cd ? resolveLiteralDirectory(fence.directory, cd[1]) : null;
        fence.localCd = !fence.sawCommand && fence.directory === documentDirectory;
      } else {
        // A package-local setup fence can corroborate the document's package
        // for subsequent prose. A prefix never changes the fence's cwd.
        const setupPrefix = trimmed.match(/^npm[ \t]+--prefix[ \t]+(\S+)[ \t]+(?:ci|run[ \t]+[\w:.-]+)$/);
        if (fence.localCd && /^npm[ \t]+(?:ci|run[ \t]+[\w:.-]+)$/.test(trimmed)) fence.localNpm = true;
        if (setupPrefix && resolveLiteralDirectory(fence.directory, setupPrefix[1]) === documentDirectory) {
          fence.localPrefix = true;
        }
        if (/(?:^|[;&|])[ \t]*(?:cd|pushd|popd|Set-Location)\b/i.test(trimmed)) {
          fence.directory = null;
          fence.localCd = false;
        }
      }
      fence.sawCommand = true;
    }

    const localWindow = lines.slice(Math.max(0, i - PLANNED_LABEL_WINDOW_LINES), i + 1).join(" ");
    const headingContext = headingStack.filter(Boolean).join(" ");
    const seenOnLine = new Set<string>();
    for (const match of line.matchAll(NPM_RUN_PATTERN)) {
      const command = match[1];
      const before = line.slice(0, match.index);
      const after = line.slice(match.index);
      const literal = fence?.shell && match.index === line.indexOf(trimmed) ? trimmed : after.split("`", 1)[0];
      const hasInlineCode = before.split("`").length % 2 === 0;
      const inlineLead = hasInlineCode ? before.slice(before.lastIndexOf("`") + 1).trim() : "";
      const unsupportedChain = (fence?.shell && match.index !== line.indexOf(trimmed)) ||
        ((fence?.shell || hasInlineCode) && SHELL_OPERATORS.test(literal)) || inlineLead !== "" ||
        (!fence && DIRECTORY_CHANGE.test(trimmed));
      const fromRoot = REPOSITORY_ROOT_CONTEXT.test(line) || REPOSITORY_ROOT_CONTEXT.test(headingContext);
      const base = fence ? fence.directory : fromRoot ? "" : documentPackage;
      const packageDirectory = unsupportedChain ? null : invocationDirectory(literal, base);
      const key = JSON.stringify([command, packageDirectory]);
      if (seenOnLine.has(key)) continue;
      seenOnLine.add(key);
      refs.push({
        command,
        lineNumber: i + 1,
        excerpt: trimmed.slice(0, 200),
        isLabeledPlanned: PLANNED_LABEL_PATTERN.test(headingContext + " " + localWindow),
        packageDirectory,
      });
    }
  }

  return refs;
}
