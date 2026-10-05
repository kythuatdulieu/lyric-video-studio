export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .replace(/[’‘`´]/gu, "'")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function removeDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC");
}

export function normalizeWithoutDiacritics(value: string): string {
  return normalizeForMatch(removeDiacritics(value));
}

export interface TextToken {
  text: string;
  normalized: string;
  accentInsensitive: string;
  index: number;
}

const TOKEN_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;

export function tokenize(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  for (const match of text.normalize("NFC").matchAll(TOKEN_PATTERN)) {
    const value = match[0];
    tokens.push({
      text: value,
      normalized: normalizeForMatch(value),
      accentInsensitive: normalizeWithoutDiacritics(value),
      index: tokens.length,
    });
  }
  return tokens;
}

export function tokenSimilarity(left: string, right: string): number {
  const a = normalizeForMatch(left);
  const b = normalizeForMatch(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (normalizeWithoutDiacritics(a) === normalizeWithoutDiacritics(b)) return 0.88;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}
