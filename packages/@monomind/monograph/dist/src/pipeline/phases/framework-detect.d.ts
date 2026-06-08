import type { PipelinePhase } from '../types.js';
export type SupportedFramework = 'react' | 'vue' | 'angular' | 'svelte' | 'express' | 'fastify' | 'nestjs' | 'koa' | 'django' | 'flask' | 'fastapi' | 'spring' | 'rails' | 'laravel';
export type PrimaryLanguage = 'javascript' | 'python' | 'java' | 'ruby' | 'php' | null;
export interface FrameworkDetectOutput {
    frameworks: SupportedFramework[];
    primaryLanguage: PrimaryLanguage;
    confidence: Record<SupportedFramework, number>;
}
export declare function detectFrameworks(repoPath: string): FrameworkDetectOutput;
export declare const frameworkDetectPhase: PipelinePhase<FrameworkDetectOutput>;
//# sourceMappingURL=framework-detect.d.ts.map