import { relative } from 'node:path';
function rel(p, root) { return relative(root, p); }
function deadCodeReason(kind) {
    if (kind.type === 'unused-file')
        return 'entire file is unused';
    if (kind.type === 'unused-export')
        return `export '${kind.exportName}' is unused`;
    return `type '${kind.typeName}' is unused`;
}
export function buildCrossReferenceLines(result, root) {
    if (result.findings.length === 0)
        return [];
    const lines = [
        '',
        '● Duplicated + Unused (safe to delete)',
        '',
    ];
    for (const f of result.findings) {
        const location = `${rel(f.cloneFile, root)}:${f.startLine}-${f.endLine}`;
        lines.push(`  ${location} (${deadCodeReason(f.deadCodeKind)})`);
    }
    lines.push('');
    return lines;
}
export function printCrossReferenceFindings(result, root, quiet = false) {
    if (result.findings.length === 0 || quiet)
        return;
    for (const line of buildCrossReferenceLines(result, root))
        console.log(line);
    const { findings: { length: total }, clonesInUnusedFiles: files, clonesWithUnusedExports: exports_ } = result;
    console.error(`  ${total} combined finding(s): ${files} in unused file(s), ${exports_} overlapping unused export(s)`);
}
//# sourceMappingURL=cross-ref-human.js.map