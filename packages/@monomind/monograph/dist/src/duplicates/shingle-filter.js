export const SHINGLE_SIZE = 7;
export function buildShingleSet(tokens, k = SHINGLE_SIZE) {
    const result = new Set();
    if (tokens.length < k)
        return result;
    for (let i = 0; i <= tokens.length - k; i++) {
        result.add(tokens.slice(i, i + k).join(','));
    }
    return result;
}
export function filterToFocusCandidates(focusFileTokens, allFileTokens, k = SHINGLE_SIZE) {
    const focusShingles = new Set();
    for (const tokens of focusFileTokens.values()) {
        for (const shingle of buildShingleSet(tokens, k)) {
            focusShingles.add(shingle);
        }
    }
    const candidates = new Set();
    for (const [fileId, tokens] of allFileTokens) {
        if (focusFileTokens.has(fileId))
            continue;
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
//# sourceMappingURL=shingle-filter.js.map