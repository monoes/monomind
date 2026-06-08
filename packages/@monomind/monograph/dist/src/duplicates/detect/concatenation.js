export function concatenateWithSentinels(fileTokens) {
    const sentinelCount = Math.max(0, fileTokens.length - 1);
    const totalLen = fileTokens.reduce((s, f) => s + f.tokens.length, 0) + sentinelCount;
    const text = [];
    const fileOf = [];
    const fileOffsets = [];
    let sentinel = -1;
    for (let i = 0; i < fileTokens.length; i++) {
        const { fileId, tokens } = fileTokens[i];
        fileOffsets.push(text.length);
        for (const r of tokens) {
            text.push(r);
            fileOf.push(fileId);
        }
        if (i + 1 < fileTokens.length) {
            text.push(sentinel);
            fileOf.push(-1);
            sentinel -= 1;
        }
    }
    void totalLen;
    return { text, fileOf, fileOffsets };
}
//# sourceMappingURL=concatenation.js.map