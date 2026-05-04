// Full duplication detection configuration block.

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

export const DEFAULT_DUPLICATES_CONFIG: DuplicatesConfig = {
  enabled: true,
  mode: 'mild',
  minTokens: 50,
  minLines: 5,
  threshold: 0.9,
  ignore: [],
  ignoreDefaults: false,
  skipLocal: false,
  crossLanguage: false,
  ignoreImports: false,
  normalization: {
    ignoreIdentifiers: false,
    ignoreStringValues: false,
    ignoreNumericValues: false,
  },
  minCorpusSizeForShingleFilter: 1000,
  minCorpusSizeForTokenCache: 5000,
};

export function mergeDuplicatesConfig(
  base: DuplicatesConfig,
  partial: Partial<DuplicatesConfig>,
): DuplicatesConfig {
  return {
    ...base,
    ...partial,
    normalization: partial.normalization
      ? { ...base.normalization, ...partial.normalization }
      : base.normalization,
  };
}

export function isDuplicationEnabled(config: DuplicatesConfig): boolean {
  return config.enabled;
}
