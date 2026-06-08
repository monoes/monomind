export function buildHover(unusedExports, duplication, position, // 0-based LSP
filePath) {
    const lspLine = position.line;
    // Priority: unused export > duplication
    for (const ue of unusedExports) {
        if (ue.line - 1 === lspLine) {
            const lines = [
                `**Unused Export**: \`${ue.exportName}\``,
                '',
                `References found: **${ue.referenceCount}**`,
                '',
                ue.referenceCount === 0
                    ? 'This export has no detected consumers outside the current file.'
                    : 'This export may be consumed only internally.',
            ];
            if (ue.suppressionHint)
                lines.push('', `To suppress: ${ue.suppressionHint}`);
            return { contents: lines.join('\n') };
        }
    }
    for (const dup of duplication) {
        if (dup.line - 1 === lspLine) {
            const contents = [
                `**Code Duplication Detected**`,
                '',
                `- Clone group size: **${dup.groupSize}** instances`,
                `- Similarity: **${(dup.similarityScore * 100).toFixed(0)}%**`,
                '',
                'Consider extracting the duplicated logic into a shared function.',
            ].join('\n');
            return { contents };
        }
    }
    return null;
}
//# sourceMappingURL=hover.js.map