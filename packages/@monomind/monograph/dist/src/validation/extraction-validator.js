const VALID_LABELS = new Set([
    'File', 'Folder', 'Function', 'Class', 'Method', 'Interface',
    'Variable', 'Struct', 'Enum', 'Macro', 'Typedef', 'Union',
    'Namespace', 'Trait', 'Impl', 'TypeAlias', 'Const', 'Static',
    'Property', 'Record', 'Delegate', 'Annotation', 'Constructor',
    'Template', 'Module', 'Process', 'Route', 'Community', 'Concept',
    'Document', 'Tool', 'Entity', 'Field',
]);
const VALID_CONFIDENCES = new Set(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);
export function validateExtraction(nodes, edges) {
    const errors = [];
    const nodeIds = new Set(nodes.map(n => n.id));
    for (const n of nodes) {
        if (!n.id)
            errors.push(`Node missing id: ${JSON.stringify(n.name)}`);
        if (!n.name)
            errors.push(`Node ${n.id} missing name`);
        if (!VALID_LABELS.has(n.label)) {
            errors.push(`Node ${n.id} has invalid label: ${n.label}`);
        }
        if (typeof n.isExported !== 'boolean') {
            errors.push(`Node ${n.id}: isExported must be boolean`);
        }
    }
    for (const e of edges) {
        if (!e.id)
            errors.push(`Edge missing id`);
        if (!nodeIds.has(e.sourceId)) {
            errors.push(`Edge ${e.id}: sourceId '${e.sourceId}' references unknown node`);
        }
        if (!nodeIds.has(e.targetId)) {
            errors.push(`Edge ${e.id}: targetId '${e.targetId}' references unknown node`);
        }
        if (!VALID_CONFIDENCES.has(e.confidence)) {
            errors.push(`Edge ${e.id}: invalid confidence '${e.confidence}'`);
        }
        if (typeof e.confidenceScore !== 'number') {
            errors.push(`Edge ${e.id}: confidenceScore must be number`);
        }
    }
    return { valid: errors.length === 0, errors };
}
//# sourceMappingURL=extraction-validator.js.map