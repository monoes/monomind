export type FlagKind = 'EnvironmentVariable' | 'SdkCall' | 'ConfigObject';
export type FlagConfidence = 'High' | 'Medium' | 'Low';
export interface FeatureFlag {
    filePath: string;
    flagName: string;
    kind: FlagKind;
    confidence: FlagConfidence;
    line: number;
    col: number;
    sdkName?: string;
    guardLineStart?: number;
    guardLineEnd?: number;
    guardedDeadExports?: string[];
}
export interface FlagsConfig {
    sdkPatterns: string[];
    envPrefixes: string[];
}
export declare const DEFAULT_FLAGS_CONFIG: FlagsConfig;
export declare function analyzeFeatureFlags(rootDir: string, config?: FlagsConfig): FeatureFlag[];
export declare function crossReferenceWithDeadCode(flags: FeatureFlag[], deadExports: Array<{
    filePath: string;
    name: string;
    line: number;
}>): FeatureFlag[];
export interface FlagsSummary {
    totalFlags: number;
    byKind: Record<FlagKind, number>;
    byConfidence: Record<FlagConfidence, number>;
    uniqueFlagNames: number;
    filesWithFlags: number;
    deadCodeOverlaps: number;
}
export declare function summarizeFlags(flags: FeatureFlag[]): FlagsSummary;
//# sourceMappingURL=feature-flags.d.ts.map