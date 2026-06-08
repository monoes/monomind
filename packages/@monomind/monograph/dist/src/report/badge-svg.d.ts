export declare function textWidth(s: string): number;
export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export declare function gradeColor(grade: HealthGrade | string): string;
export declare function xmlEscape(s: string): string;
export declare function svgIdSuffix(label: string, message: string): string;
export interface BadgeOptions {
    label: string;
    message: string;
    color?: string;
    labelColor?: string;
    style?: 'flat' | 'flat-square' | 'plastic';
}
export declare function renderBadge(opts: BadgeOptions): string;
export declare function renderHealthBadge(score: number, grade: string): string;
export declare function renderGradeBadge(label: string, grade: string): string;
//# sourceMappingURL=badge-svg.d.ts.map