export type OutputFormat = 'text' | 'json' | 'compact';
export interface FlagsOptions {
    root: string;
    configPath?: string;
    output: OutputFormat;
    noCache: boolean;
    threads: number;
    quiet: boolean;
    production: boolean;
    workspace?: string[];
    changedWorkspaces?: string;
    changedSince?: string;
    explain: boolean;
    top?: number;
}
export interface FeatureFlag {
    name: string;
    filePath: string;
    isEnabled: boolean | null;
    condition?: string;
    line?: number;
}
export interface FlagUse {
    name: string;
    isEnabled: boolean | null;
    condition?: string;
    span?: {
        start: number;
        end: number;
    };
}
export interface FlagsResult {
    flags: FeatureFlag[];
    totalFiles: number;
    totalFlags: number;
}
export declare function flagUseToFeatureFlag(flagUse: FlagUse, filePath: string, line?: number): FeatureFlag;
export declare function groupFlagsByName(flags: FeatureFlag[]): Map<string, FeatureFlag[]>;
export declare function formatFlagsText(result: FlagsResult, top?: number): string;
//# sourceMappingURL=flags.d.ts.map