import { relative } from 'node:path';
function rel(file, root) { return relative(root, file); }
export function printExportTraceHuman(trace, root) {
    const status = trace.isUsed ? 'USED' : 'UNUSED';
    console.error(`\n  ${status} ${trace.exportName} in ${rel(trace.file, root)}`);
    console.error(`\n  File: ${trace.fileReachable ? 'reachable' : 'unreachable'}${trace.isEntryPoint ? ' (entry point)' : ''}`);
    console.error(`  Reason: ${trace.reason}`);
    if (trace.directReferences.length > 0) {
        console.error(`\n  ${trace.directReferences.length} direct reference(s):`);
        for (const r of trace.directReferences)
            console.error(`    -> ${rel(r.fromFile, root)} (${r.kind})`);
    }
    if (trace.reExportChains.length > 0) {
        console.error('\n  Re-exported through:');
        for (const c of trace.reExportChains)
            console.error(`    -> ${rel(c.barrelFile, root)} as '${c.exportedAs}' (${c.referenceCount} ref(s))`);
    }
    console.error('');
}
export function printFileTraceHuman(trace, root) {
    const status = trace.isReachable ? 'REACHABLE' : 'UNREACHABLE';
    const entry = trace.isEntryPoint ? ' (entry point)' : '';
    console.error(`\n  ${status} ${rel(trace.file, root)}${entry}`);
    if (trace.exports.length > 0) {
        console.error(`\n  Exports (${trace.exports.length}):`);
        for (const e of trace.exports) {
            const used = e.referenceCount > 0 ? `${e.referenceCount} ref(s)` : 'unused';
            const tag = e.isTypeOnly ? ' (type)' : '';
            console.error(`    export ${e.name}${tag} [${used}]`);
            for (const r of e.referencedBy)
                console.error(`      -> ${rel(r.fromFile, root)} (${r.kind})`);
        }
    }
    if (trace.importedBy.length > 0) {
        console.error(`\n  Imported by (${trace.importedBy.length}):`);
        for (const p of trace.importedBy)
            console.error(`    -> ${rel(p, root)}`);
    }
    console.error('');
}
export function printDependencyTraceHuman(trace) {
    const status = trace.isUsed ? 'USED' : 'UNUSED';
    console.error(`\n  ${status} ${trace.packageName} (${trace.importCount} import(s))`);
    if (trace.importedBy.length > 0) {
        console.error('\n  Imported by:');
        for (const p of trace.importedBy) {
            const tag = trace.typeOnlyImportedBy.includes(p) ? ' (type-only)' : '';
            console.error(`    -> ${p}${tag}`);
        }
    }
    if (trace.usedInScripts)
        console.error('\n  Referenced from package.json scripts or CI configs.');
    console.error('');
}
export function printCloneTraceHuman(trace, root) {
    if (trace.matchedInstance) {
        const m = trace.matchedInstance;
        console.error(`\n  FOUND clone at ${rel(m.file, root)}:${m.startLine}-${m.endLine}`);
    }
    console.error(`  ${trace.cloneGroups.length} clone group(s) containing this location`);
    for (let i = 0; i < trace.cloneGroups.length; i++) {
        const g = trace.cloneGroups[i];
        console.error(`\n  Clone group ${i + 1} (${g.lineCount} lines, ${g.tokenCount} tokens, ${g.instances.length} instance(s))`);
        for (const inst of g.instances) {
            const marker = trace.matchedInstance && trace.matchedInstance.file === inst.file && trace.matchedInstance.startLine === inst.startLine ? '>>' : '->';
            console.error(`    ${marker} ${rel(inst.file, root)}:${inst.startLine}-${inst.endLine}`);
        }
    }
    console.error('');
}
//# sourceMappingURL=trace-human.js.map