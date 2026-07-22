export function canonicalizeStageContextRun(value: unknown): string {
  const seen = new WeakSet<object>();

  function serialize(input: unknown): string {
    if (input === null) return "null";
    const kind = typeof input;
    if (kind === "bigint") {
      throw new TypeError("Stage-context run values must not contain BigInt.");
    }
    if (kind === "function") {
      throw new TypeError("Stage-context run values must not contain functions.");
    }
    if (kind === "symbol") {
      throw new TypeError("Stage-context run values must not contain symbols.");
    }
    if (kind === "undefined") {
      return "null";
    }
    if (kind === "number") {
      if (!Number.isFinite(input as number)) {
        throw new RangeError("Stage-context run values must not contain non-finite numbers.");
      }
      return JSON.stringify(input);
    }
    if (kind === "boolean" || kind === "string") {
      return JSON.stringify(input);
    }
    if (Array.isArray(input)) {
      if (seen.has(input)) {
        throw new TypeError("Stage-context run values must not contain circular references.");
      }
      seen.add(input);
      const items = input.map((item) => (item === undefined ? "null" : serialize(item)));
      seen.delete(input);
      return `[${items.join(",")}]`;
    }
    if (kind === "object") {
      const obj = input as Record<string, unknown>;
      if (seen.has(obj)) {
        throw new TypeError("Stage-context run values must not contain circular references.");
      }
      seen.add(obj);
      const keys = Object.keys(obj)
        .filter((key) => obj[key] !== undefined)
        .sort();
      const parts = keys.map((key) => `${JSON.stringify(key)}:${serialize(obj[key])}`);
      seen.delete(obj);
      return `{${parts.join(",")}}`;
    }
    throw new TypeError("Stage-context run values contain an unsupported type.");
  }

  return serialize(value);
}
