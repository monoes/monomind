// Granular LSP diagnostic push-functions for each finding category.
function singleLineDiag(map, filePath, line, message, code, severity = 'warning') {
    if (!map.has(filePath))
        map.set(filePath, []);
    map.get(filePath).push({
        filePath,
        range: { start: { line, character: 0 }, end: { line, character: 9999 } },
        message,
        severity,
        code,
        source: 'monograph',
    });
}
export function pushExportDiagnostics(map, results) {
    for (const r of results)
        singleLineDiag(map, r.filePath, r.line, `Unused export '${r.symbol}'`, 'unused-export');
}
export function pushFileDiagnostics(map, results) {
    for (const r of results)
        singleLineDiag(map, r.filePath, 0, 'File has no consumers and may be dead code', 'unused-file');
}
export function pushImportDiagnostics(map, results) {
    for (const r of results)
        singleLineDiag(map, r.filePath, r.line, `Cannot resolve import '${r.specifier}'`, 'unresolved-import', 'error');
}
export function pushDepDiagnostics(map, results) {
    const msg = (r) => r.kind === 'unused' ? `Package '${r.name}' is listed but not imported` : `Package '${r.name}' is imported but not in dependencies`;
    for (const r of results)
        singleLineDiag(map, 'package.json', 0, msg(r), r.kind === 'unused' ? 'unused-dep' : 'unlisted-dep');
}
export function pushMemberDiagnostics(map, results) {
    for (const r of results)
        singleLineDiag(map, r.filePath, r.line, `Unused member '${r.className}.${r.member}'`, 'unused-member');
}
export function pushCircularDepDiagnostics(map, results) {
    for (const r of results) {
        const first = r.files[0];
        if (first)
            singleLineDiag(map, first, 0, `Circular dependency involving ${r.files.length} files`, 'circular-dep', 'warning');
    }
}
export function pushBoundaryViolationDiagnostics(map, results) {
    for (const r of results)
        singleLineDiag(map, r.fromFile, r.line, `Boundary violation: imports from restricted zone (rule: ${r.rule})`, 'boundary-violation', 'error');
}
export function pushDuplicateExportDiagnostics(map, results) {
    for (const r of results)
        singleLineDiag(map, r.filePath, r.line, `Duplicate export '${r.symbol}' — exported from multiple files`, 'duplicate-export');
}
export function pushDuplicationDiagnostics(map, results) {
    for (const r of results)
        singleLineDiag(map, r.filePath, r.startLine, `Code duplication (group ${r.groupId}, lines ${r.startLine}-${r.endLine})`, 'duplication', 'information');
}
export function pushStaleSuppressionDiagnostics(map, results) {
    for (const r of results)
        singleLineDiag(map, r.filePath, r.line, `Stale suppression comment for '${r.code}' — no matching finding`, 'stale-suppression', 'hint');
}
//# sourceMappingURL=diagnostics-push.js.map