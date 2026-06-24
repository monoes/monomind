/**
 * CLI Design Palette Command
 * OKLCH brand-seed picker — returns one anchor seed color + mood + composition strategy.
 * Ported from impeccable's palette.mjs (129 hand-curated seeds).
 *
 * github.com/monoes/monomind
 */
import type { Command } from '../types.js';
export interface PaletteSeed {
    id: string;
    oklch: [number, number, number];
    mood: string;
    strategy: string;
}
export interface DesignPaletteResult {
    seed: PaletteSeed;
    oklchCss: string;
    hex?: string;
}
export declare const paletteSubcommand: Command;
export default paletteSubcommand;
//# sourceMappingURL=design-palette.d.ts.map