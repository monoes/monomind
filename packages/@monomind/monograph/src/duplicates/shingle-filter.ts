export const SHINGLE_SIZE = 7;

export function buildShingleSet(tokens: number[], k: number = SHINGLE_SIZE): Set<string> {
  const result = new Set<string>();
  if (tokens.length < k) return result;
  for (let i = 0; i <= tokens.length - k; i++) {
    result.add(tokens.slice(i, i + k).join(','));
  }
  return result;
}

export function filterToFocusCandidates(
  focusFileTokens: Map<number, number[]>,
  allFileTokens: Map<number, number[]>,
  k: number = SHINGLE_SIZE,
): Set<number> {
  const focusShingles = new Set<string>();
  for (const tokens of focusFileTokens.values()) {
    for (const shingle of buildShingleSet(tokens, k)) {
      focusShingles.add(shingle);
    }
  }

  const candidates = new Set<number>();
  for (const [fileId, tokens] of allFileTokens) {
    if (focusFileTokens.has(fileId)) continue;
    const fileShingles = buildShingleSet(tokens, k);
    for (const s of fileShingles) {
      if (focusShingles.has(s)) {
        candidates.add(fileId);
        break;
      }
    }
  }

  return candidates;
}
