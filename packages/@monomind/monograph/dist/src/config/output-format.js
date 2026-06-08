export const DEFAULT_OUTPUT_FORMAT = 'human';
const VALID_FORMATS = new Set([
    'human', 'json', 'sarif', 'compact', 'markdown', 'code-climate', 'badge',
]);
const FORMAT_ALIASES = {
    codeclimate: 'code-climate',
    'gitlab-codequality': 'code-climate',
    'gitlab-code-quality': 'code-climate',
};
export function parseFallowOutputFormat(s) {
    const normalized = s.toLowerCase();
    if (VALID_FORMATS.has(normalized))
        return normalized;
    if (normalized in FORMAT_ALIASES)
        return FORMAT_ALIASES[normalized];
    return undefined;
}
export function isFallowOutputFormat(s) {
    return VALID_FORMATS.has(s.toLowerCase());
}
//# sourceMappingURL=output-format.js.map