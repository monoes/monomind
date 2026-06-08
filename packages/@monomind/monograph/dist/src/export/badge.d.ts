export interface BadgeOptions {
    label?: string;
    value: string;
    color?: string;
    uniqueId?: string;
}
/** Map a letter grade to a shield-style hex color (without leading #). */
export declare function gradeToColor(grade: string): string;
/**
 * Generate a self-contained shields.io-style SVG health-grade badge.
 * Returns the SVG string; callers can write it to a file or embed it inline.
 */
export declare function generateBadge(options: BadgeOptions): string;
export type HealthGradeLetter = 'A' | 'B' | 'C' | 'D' | 'F';
export interface HealthBadgeOptions {
    grade: HealthGradeLetter;
    score: number;
    label?: string;
    ansiColors?: boolean;
}
export declare function renderHealthTerminalBadge(opts: HealthBadgeOptions): string;
export declare function healthScoreToGrade(score: number): HealthGradeLetter;
//# sourceMappingURL=badge.d.ts.map