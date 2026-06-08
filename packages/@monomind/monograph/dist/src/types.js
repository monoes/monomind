// ── Node labels ───────────────────────────────────────────────────────────────
export const SYMBOL_NODE_LABELS = new Set([
    'Function', 'Class', 'Method', 'Interface', 'Variable', 'Struct', 'Enum',
    'Macro', 'Typedef', 'Union', 'Namespace', 'Trait', 'Impl', 'TypeAlias',
    'Const', 'Static', 'Property', 'Record', 'Delegate', 'Annotation',
    'Constructor', 'Template', 'Module',
]);
export const CONFIDENCE_SCORE = {
    EXTRACTED: 1.0,
    INFERRED: 0.5,
    AMBIGUOUS: 0.2,
};
// ── ID generation ─────────────────────────────────────────────────────────────
export function makeId(...parts) {
    return parts
        .join('_')
        .replace(/[^a-z0-9_]/gi, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}
// ── Norm label ────────────────────────────────────────────────────────────────
export function toNormLabel(name) {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}
// ── Errors ────────────────────────────────────────────────────────────────────
export class MonographError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'MonographError';
    }
}
//# sourceMappingURL=types.js.map