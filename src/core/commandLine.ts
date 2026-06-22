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
    executable: parts[0],
    args: parts.slice(1)
  };
}

export function splitCommandString(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];

    if (char === "\\" && quote !== null && next === quote) {
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
        parts.push(current);
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
    parts.push(current);
  }

  return parts;
}

export function serializeCommand(parts: readonly string[]): string {
  return parts.map(quoteCommandPart).join(" ");
}

export function quoteCommandPart(part: string): string {
  if (part.length === 0) {
    return "\"\"";
  }
  if (!/[\s"'\\]/.test(part)) {
    return part;
  }
  return `"${part.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
