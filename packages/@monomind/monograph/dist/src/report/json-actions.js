export function makeDeleteFileAction(filePath) {
    return { kind: 'delete-file', filePath };
}
export function makeRemoveExportAction(filePath, symbol, line, col) {
    return { kind: 'remove-export', filePath, symbol, line, col };
}
export function makeExportTypeAction(filePath, symbol, line, col) {
    return { kind: 'export-type', filePath, symbol, line, col };
}
export function makeRemoveDependencyAction(packageName, isDev) {
    return {
        kind: isDev ? 'remove-dev-dependency' : 'remove-dependency',
        filePath: 'package.json',
        packageName,
    };
}
export function makeAddSuppressionAction(filePath, line, suppressionKind) {
    return { kind: 'add-suppression', filePath, line, suppressionKind };
}
export function buildDocsUrl(issueKind) {
    const slug = issueKind.toLowerCase().replace(/[_\s]+/g, '-');
    return `https://fallow.dev/docs/configuration#${slug}`;
}
export function buildActionsForUnusedFile(filePath) {
    return [makeDeleteFileAction(filePath)];
}
export function buildActionsForUnusedExport(filePath, exportName, line, col, isTypeOnly) {
    const removeAction = makeRemoveExportAction(filePath, exportName, line, col);
    if (isTypeOnly) {
        return [removeAction, makeExportTypeAction(filePath, exportName, line, col)];
    }
    return [removeAction];
}
export function buildActionsForUnusedDep(packageName, isDev) {
    return [makeRemoveDependencyAction(packageName, isDev)];
}
//# sourceMappingURL=json-actions.js.map