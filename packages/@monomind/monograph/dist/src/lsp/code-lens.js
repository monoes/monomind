export function buildCodeLenses(usages, documentUri) {
    return usages.map(usage => {
        const lspLine = usage.line - 1; // 1-based → 0-based
        const lspCol = usage.col - 1;
        const range = {
            start: { line: lspLine, character: lspCol },
            end: { line: lspLine, character: lspCol + usage.exportName.length },
        };
        const refCount = usage.referenceLocations.length;
        if (refCount === 0) {
            return {
                range,
                command: { title: '0 references', command: 'monograph.noop' },
            };
        }
        return {
            range,
            command: {
                title: `${refCount} reference${refCount === 1 ? '' : 's'}`,
                command: 'editor.action.showReferences',
                arguments: [documentUri, { line: lspLine, character: lspCol }, usage.referenceLocations],
            },
        };
    });
}
//# sourceMappingURL=code-lens.js.map