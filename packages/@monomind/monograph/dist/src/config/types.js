// Complete monograph configuration schema — all config structs for
// constructing a resolved config from disk and validating config files.
export const DEFAULT_MONOGRAPH_CONFIG = {
    root: '.',
    entry: [],
    production: true,
    detection: 'default',
    project: undefined,
    ignore: [],
    overrides: [],
    regression: { tolerance: 0, baselinePath: '.monograph/regression-baseline.json' },
    audit: { gate: 'error', includeHealthGate: false },
    normalization: { stripComments: true, normalizeWhitespace: true, normalizeIdentifiers: false },
    boundaries: {},
    resolve: { paths: {}, alias: {}, conditions: [], extensions: ['.ts', '.tsx', '.mts', '.cts'] },
    health: { cyclomaticThreshold: 10, cognitiveThreshold: 15, crapThreshold: 30, minLines: 5 },
    ownership: { emailMode: 'fullEmail', codeownersPath: 'CODEOWNERS' },
    plugins: [],
};
//# sourceMappingURL=types.js.map