export function buildUnusedSymbolDiagnostics(symbols) {
    const map = new Map();
    for (const sym of symbols) {
        const range = {
            start: { line: sym.line - 1, character: sym.col - 1 },
            end: { line: sym.line - 1, character: sym.col - 1 + sym.name.length },
        };
        const messages = {
            export: `'${sym.name}' is exported but has no external consumers`,
            type: `Type '${sym.name}' is exported but never imported elsewhere`,
            member: `Class member '${sym.name}' is never used outside this class`,
            file: `File '${sym.name}' has no importers and no entry-point role`,
        };
        const diag = {
            range,
            severity: 2, // Warning
            code: `monograph/unused-${sym.symbolKind}`,
            source: 'monograph',
            message: messages[sym.symbolKind],
            tags: [1], // Unnecessary
        };
        const arr = map.get(sym.uri) ?? [];
        arr.push(diag);
        map.set(sym.uri, arr);
    }
    return map;
}
export function buildCircularDepDiagnostics(cycles) {
    const map = new Map();
    for (const cycle of cycles) {
        const line0 = cycle.importLine - 1;
        const range = {
            start: { line: line0, character: 0 },
            end: { line: line0, character: 65535 },
        };
        const diag = {
            range,
            severity: 2, // Warning
            code: 'monograph/circular-dep',
            source: 'monograph',
            message: `Circular dependency: ${cycle.cycle.join(' → ')}`,
        };
        const arr = map.get(cycle.uri) ?? [];
        arr.push(diag);
        map.set(cycle.uri, arr);
    }
    return map;
}
export function buildBoundaryViolationDiagnostics(violations) {
    const map = new Map();
    for (const v of violations) {
        const line0 = v.line - 1;
        const range = {
            start: { line: line0, character: 0 },
            end: { line: line0, character: 65535 },
        };
        const diag = {
            range,
            severity: 1, // Error
            code: 'monograph/boundary-violation',
            source: 'monograph',
            message: `Boundary violation: zone '${v.fromZone}' cannot import from zone '${v.toZone}' (${v.importedPath})`,
        };
        const arr = map.get(v.uri) ?? [];
        arr.push(diag);
        map.set(v.uri, arr);
    }
    return map;
}
export function buildComplexityDiagnostics(issues) {
    const map = new Map();
    for (const issue of issues) {
        const line0 = issue.line - 1;
        const range = {
            start: { line: line0, character: 0 },
            end: { line: line0, character: issue.functionName.length },
        };
        const lspSeverity = {
            moderate: 3, // Information
            high: 2, // Warning
            critical: 1, // Error
        };
        const parts = [`CC=${issue.cyclomaticComplexity}`];
        if (issue.cognitiveComplexity != null)
            parts.push(`cognitive=${issue.cognitiveComplexity}`);
        if (issue.crapScore != null)
            parts.push(`CRAP=${issue.crapScore.toFixed(1)}`);
        const diag = {
            range,
            severity: lspSeverity[issue.severity],
            code: `monograph/complexity-${issue.severity}`,
            source: 'monograph',
            message: `'${issue.functionName}' has ${issue.severity} complexity (${parts.join(', ')})`,
        };
        const arr = map.get(issue.uri) ?? [];
        arr.push(diag);
        map.set(issue.uri, arr);
    }
    return map;
}
//# sourceMappingURL=diagnostics-ext.js.map