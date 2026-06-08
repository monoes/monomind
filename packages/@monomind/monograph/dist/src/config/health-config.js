export const DEFAULT_BOT_PATTERNS = [
    '*[bot]*', 'dependabot*', 'renovate*', 'github-actions*', 'svc-*', '*-service-account*',
];
export const DEFAULT_FALLOW_HEALTH_CONFIG = {
    maxCyclomatic: 20,
    maxCognitive: 15,
    maxCrap: 30.0,
    ignore: [],
    ownership: { botPatterns: DEFAULT_BOT_PATTERNS, emailMode: 'raw' },
    suggestInlineSuppression: false,
};
export function mergeFallowHealthConfig(partial) {
    const base = DEFAULT_FALLOW_HEALTH_CONFIG;
    return {
        maxCyclomatic: partial.maxCyclomatic ?? base.maxCyclomatic,
        maxCognitive: partial.maxCognitive ?? base.maxCognitive,
        maxCrap: partial.maxCrap ?? base.maxCrap,
        ignore: partial.ignore ?? base.ignore,
        suggestInlineSuppression: partial.suggestInlineSuppression ?? base.suggestInlineSuppression,
        ownership: partial.ownership !== undefined
            ? { ...base.ownership, ...partial.ownership }
            : base.ownership,
    };
}
//# sourceMappingURL=health-config.js.map