function makeRange(line, col, nameLength) {
    return {
        start: { line: line - 1, character: col - 1 },
        end: { line: line - 1, character: col - 1 + nameLength },
    };
}
export function buildDuplicateExportDiagnostics(groups) {
    const map = new Map();
    for (const group of groups) {
        for (const loc of group.locations) {
            const related = group.locations
                .filter(other => other !== loc)
                .map(other => ({
                uri: other.uri,
                range: makeRange(other.line, other.col, group.name.length),
                message: `Also exported as '${group.name}' here`,
            }));
            const diag = {
                range: makeRange(loc.line, loc.col, group.name.length),
                severity: 2, // Warning
                code: 'monograph/duplicate-export',
                source: 'monograph',
                message: `'${group.name}' is exported from ${group.locations.length} files`,
                relatedInformation: related,
            };
            const arr = map.get(loc.uri) ?? [];
            arr.push(diag);
            map.set(loc.uri, arr);
        }
    }
    return map;
}
export function buildStaleSuppressionDiagnostics(suppressions) {
    const map = new Map();
    for (const s of suppressions) {
        const range = {
            start: { line: s.line - 1, character: 0 },
            end: { line: s.line - 1, character: 65535 },
        };
        const diag = {
            range,
            severity: 4, // Hint
            code: 'monograph/stale-suppression',
            source: 'monograph',
            message: s.description,
            tags: [1], // Unnecessary
        };
        const arr = map.get(s.uri) ?? [];
        arr.push(diag);
        map.set(s.uri, arr);
    }
    return map;
}
//# sourceMappingURL=diagnostics.js.map