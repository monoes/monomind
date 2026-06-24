/**
 * CLI Design Detect Command
 * Thin wrapper around impeccable's design anti-pattern detector
 *
 * github.com/monoes/monomind
 */
import type { Command } from '../types.js';
export interface DesignAntiPattern {
    id: string;
    name: string;
    category: string;
    file?: string;
    line?: number;
}
export interface DesignDetectResult {
    patterns: DesignAntiPattern[];
    count: number;
}
export declare const designCommand: Command;
export default designCommand;
//# sourceMappingURL=design-detect.d.ts.map