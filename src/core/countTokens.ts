export const tokenCountMethod = "estimated_chars_div_4";

export function countTextChars(text: string): number {
  return text.length;
}

export function countEstimatedTokens(text: string): number {
  const chars = countTextChars(text);
  return chars === 0 ? 0 : Math.ceil(chars / 4);
}
