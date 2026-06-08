export function pointSpan(pos) {
    return { start: pos, end: pos + 1 };
}
export function emptyTokens(source) {
    const lineCount = (source.match(/\n/g)?.length ?? 0) + 1;
    return { tokens: [], source, lineCount };
}
//# sourceMappingURL=token-types.js.map