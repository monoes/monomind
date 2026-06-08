export type CiProvider = 'github' | 'gitlab';
export interface CiTemplateOptions {
    provider: CiProvider;
    monographVersion?: string;
    failOnNewDebt?: boolean;
    healthThreshold?: string;
}
export interface CiTemplate {
    filename: string;
    content: string;
    description: string;
}
export declare function generateCiTemplate(options: CiTemplateOptions): CiTemplate;
//# sourceMappingURL=ci-template.d.ts.map