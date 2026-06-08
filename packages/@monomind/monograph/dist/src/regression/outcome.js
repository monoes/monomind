// Three-variant regression outcome model: Pass, Exceeded, Skipped.
export function regressionOutcomeToJson(outcome) {
    if (outcome.kind === 'skipped') {
        return JSON.stringify({ status: 'skipped', reason: outcome.reason });
    }
    return JSON.stringify({
        status: outcome.kind,
        delta: outcome.delta,
        tolerance: outcome.tolerance,
        tolerance_kind: outcome.toleranceKind,
        exceeded: outcome.kind === 'exceeded' ? outcome.exceeded : undefined,
    });
}
export function printRegressionOutcome(outcome) {
    switch (outcome.kind) {
        case 'pass':
            return `✓ Regression check passed (delta=${outcome.delta}, tolerance=${outcome.tolerance})`;
        case 'exceeded':
            return [
                `✗ Regression check EXCEEDED (delta=${outcome.delta}, tolerance=${outcome.tolerance})`,
                ...outcome.exceeded.map(d => `  ${d.key}: ${d.baseline} → ${d.current} (+${d.delta})`),
            ].join('\n');
        case 'skipped':
            return `⚠ Regression check skipped: ${outcome.reason}`;
    }
}
export function makePassOutcome(delta, tolerance, toleranceKind = 'absolute') {
    return { kind: 'pass', delta, tolerance, toleranceKind };
}
export function makeExceededOutcome(delta, tolerance, exceeded, toleranceKind = 'absolute') {
    return { kind: 'exceeded', delta, tolerance, toleranceKind, exceeded };
}
export function makeSkippedOutcome(reason) {
    return { kind: 'skipped', reason };
}
//# sourceMappingURL=outcome.js.map