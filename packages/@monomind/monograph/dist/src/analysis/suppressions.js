export const NON_CORE_KINDS = [
    'complexity',
    'coverage-gaps',
    'code-duplication',
];
export function createSuppressionContext(suppressions) {
    return {
        suppressions: [...suppressions],
        consumed: new Set(),
    };
}
export function suppressionKey(s) {
    return `${s.path}:${s.line}:${s.kind}`;
}
export function markConsumed(ctx, path, line, kind) {
    ctx.consumed.add(`${path}:${line}:${kind}`);
}
export function findStale(ctx) {
    return ctx.suppressions
        .filter((s) => {
        const key = suppressionKey(s);
        const isConsumed = ctx.consumed.has(key);
        const isNonCore = NON_CORE_KINDS.includes(s.kind);
        // Keep (return as stale) if NOT consumed AND NOT a non-core kind
        return !isConsumed && !isNonCore;
    })
        .map((s) => {
        return {
            ...s,
            description() {
                return `Stale suppression of kind "${s.kind}" at ${s.path}:${s.line}:${s.col}`;
            },
            explanation() {
                const comment = s.comment ? ` (comment: "${s.comment}")` : '';
                return `The suppression for "${s.kind}" at line ${s.line} in "${s.path}" was never matched by an actual issue${comment}. It can be safely removed.`;
            },
        };
    });
}
//# sourceMappingURL=suppressions.js.map