export type ParsedCommand = {
  executable: string;
  args: string[];
};

export function parseCommandString(command: string): ParsedCommand {
  const parts = splitCommandString(command);
  if (parts.length === 0) {
    throw new Error("Command string is empty.");
  }
  return {
    executable: parts[0]!,
    args: parts.slice(1)
  };
}

export function splitCommandString(command: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    const next = command[index + 1];

    if (char === "\\" && next && shouldTreatBackslashAsEscape(quote, next)) {
      current += next;
      index += 1;
      continue;
    }

    if ((char === "\"" || char === "'") && quote === null) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && quote === null) {
      if (current.length > 0) {
        result.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote !== null) {
    throw new Error(`Command string has an unmatched ${quote} quote.`);
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}

export function serializeCommand(parts: string[]): string {
  return parts.map(quoteCommandPart).join(" ");
}

export function quoteCommandPart(part: string): string {
  if (part.length === 0) {
    return "\"\"";
  }
  if (!/[\s"'\\]/.test(part)) {
    return part;
  }
  return `"${part.replace(/(["\\])/g, "\\$1")}"`;
}

function shouldTreatBackslashAsEscape(quote: "\"" | "'" | null, next: string): boolean {
  if (quote === "'") {
    return false;
  }
  return next === "\\" || next === "\"" || next === "'" || /\s/.test(next);
}
