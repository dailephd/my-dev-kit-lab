export function createDeterministicId(prefix: string, sequence: number): string {
  return `${prefix}-${sequence}`;
}
