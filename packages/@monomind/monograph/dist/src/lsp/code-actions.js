function detectExportVariant(sourceLine) {
    const variants = [
        'export default ',
        'export const ',
        'export function ',
        'export class ',
        'export abstract class ',
        'export interface ',
        'export type ',
        'export enum ',
        'export ',
    ];
    const trimmed = sourceLine.trimStart();
    const indent = sourceLine.length - trimmed.length;
    for (const v of variants) {
        if (trimmed.startsWith(v)) {
            return { prefix: v, start: indent };
        }
    }
    return null;
}
export function buildRemoveExportActions(unusedExports, cursorLine, // 0-based LSP
fileLines, maxActionsPerFile = 10) {
    const actions = [];
    const inRange = unusedExports.filter(e => e.line - 1 === cursorLine);
    for (const ue of inRange.slice(0, maxActionsPerFile)) {
        const sourceLine = fileLines[ue.line - 1] ?? '';
        const variant = detectExportVariant(sourceLine);
        if (!variant)
            continue;
        const removeRange = {
            start: { line: ue.line - 1, character: variant.start },
            end: { line: ue.line - 1, character: variant.start + variant.prefix.length },
        };
        actions.push({
            title: `Remove 'export' from '${ue.exportName}'`,
            kind: 'quickfix',
            isPreferred: true,
            edit: {
                changes: {
                    [ue.uri]: [{ range: removeRange, newText: '' }],
                },
            },
        });
    }
    return actions;
}
export function buildSuppressActions(unusedExports, cursorLine, // 0-based LSP
fileLines) {
    const actions = [];
    const inRange = unusedExports.filter(e => e.line - 1 === cursorLine);
    for (const ue of inRange) {
        const targetLine = ue.line - 1; // 0-based
        const sourceLine = fileLines[targetLine] ?? '';
        const indent = sourceLine.length - sourceLine.trimStart().length;
        const suppressComment = ' '.repeat(indent) + '// monograph-ignore\n';
        const insertRange = {
            start: { line: targetLine, character: 0 },
            end: { line: targetLine, character: 0 },
        };
        actions.push({
            title: `Suppress monograph warning for '${ue.exportName}'`,
            kind: 'quickfix',
            edit: {
                changes: {
                    [ue.uri]: [{ range: insertRange, newText: suppressComment }],
                },
            },
        });
    }
    return actions;
}
export function buildDeleteFileActions(filePath) {
    return [{
            kind: 'deleteFile',
            title: `Delete unused file: ${filePath.split('/').pop() ?? filePath}`,
            filePath,
            isPreferred: false,
        }];
}
//# sourceMappingURL=code-actions.js.map