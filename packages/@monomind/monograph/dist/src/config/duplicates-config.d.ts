export type DuplicationDetectionMode = 'strict' | 'mild' | 'weak' | 'semantic';
export interface DuplicationNormalizationConfig {
    ignoreIdentifiers: boolean;
    ignoreStringValues: boolean;
    ignoreNumericValues: boolean;
}
export interface DuplicatesConfig {
    enabled: boolean;
    mode: DuplicationDetectionMode;
    minTokens: number;
    minLines: number;
    threshold: number;
    ignore: string[];
    ignoreDefaults: boolean;
    skipLocal: boolean;
    crossLanguage: boolean;
    ignoreImports: boolean;
    normalization: DuplicationNormalizationConfig;
    minCorpusSizeForShingleFilter: number;
    minCorpusSizeForTokenCache: number;
}
export declare const DEFAULT_DUPLICATES_CONFIG: DuplicatesConfig;
export declare function mergeDuplicatesConfig(base: DuplicatesConfig, partial: Partial<DuplicatesConfig>): DuplicatesConfig;
export declare function isDuplicationEnabled(config: DuplicatesConfig): boolean;
//# sourceMappingURL=duplicates-config.d.ts.map