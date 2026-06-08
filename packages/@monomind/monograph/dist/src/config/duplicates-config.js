// Full duplication detection configuration block.
export const DEFAULT_DUPLICATES_CONFIG = {
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
export function mergeDuplicatesConfig(base, partial) {
    return {
        ...base,
        ...partial,
        normalization: partial.normalization
            ? { ...base.normalization, ...partial.normalization }
            : base.normalization,
    };
}
export function isDuplicationEnabled(config) {
    return config.enabled;
}
//# sourceMappingURL=duplicates-config.js.map