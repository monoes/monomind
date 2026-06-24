/**
 * Display formatting helpers for hooks commands.
 * Extracted from hooks.ts (ARCH-1) — formatIntelligenceStatus and formatWorkerStatus.
 */
import { output } from '../output.js';
/**
 * Format an intelligence component status string with colour coding.
 */
export function formatIntelligenceStatus(status) {
    switch (status) {
        case 'active':
        case 'ready':
            return output.success(status);
        case 'training':
            return output.highlight(status);
        case 'idle':
            return output.dim(status);
        case 'disabled':
        case 'error':
            return output.error(status);
        default:
            return status;
    }
}
/**
 * Format a background worker status string with colour coding.
 */
export function formatWorkerStatus(status) {
    switch (status) {
        case 'running':
            return output.highlight(status);
        case 'completed':
            return output.success(status);
        case 'failed':
            return output.error(status);
        case 'pending':
            return output.dim(status);
        default:
            return status;
    }
}
//# sourceMappingURL=hooks-formatting.js.map