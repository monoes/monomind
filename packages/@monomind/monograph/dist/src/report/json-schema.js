export const ANALYSIS_SCHEMA_VERSION = 4;
export const HEALTH_SCHEMA_VERSION = 2;
export const RUNTIME_COVERAGE_SCHEMA_VERSION = '1';
export const DUPLICATION_SCHEMA_VERSION = 1;
export function makeEnvelope(data, schemaVersion, root, schemaUrl) {
    return {
        $schema: schemaUrl,
        schemaVersion,
        generatedAt: new Date().toISOString(),
        root,
        data,
    };
}
export function stripRootPrefix(obj, root) {
    if (typeof obj === 'string') {
        const normalized = root.endsWith('/') ? root : root + '/';
        return obj.startsWith(normalized) ? obj.slice(normalized.length) : obj;
    }
    if (Array.isArray(obj))
        return obj.map(item => stripRootPrefix(item, root));
    if (obj && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = stripRootPrefix(value, root);
        }
        return result;
    }
    return obj;
}
export function injectActions(obj, actions) {
    return { ...obj, actions };
}
export function buildAnalysisJsonEnvelope(results, root, regression) {
    const stripped = stripRootPrefix(results, root);
    const data = { results: stripped };
    if (regression !== undefined)
        data.regression = regression;
    return makeEnvelope(data, ANALYSIS_SCHEMA_VERSION, root, `https://monograph.dev/schema/v${ANALYSIS_SCHEMA_VERSION}/analysis.json`);
}
export function buildHealthJsonEnvelope(healthReport, root) {
    return makeEnvelope(healthReport, HEALTH_SCHEMA_VERSION, root, `https://monograph.dev/schema/v${HEALTH_SCHEMA_VERSION}/health.json`);
}
export function buildDuplicationJsonEnvelope(duplication, root) {
    return makeEnvelope(duplication, DUPLICATION_SCHEMA_VERSION, root, `https://monograph.dev/schema/v${DUPLICATION_SCHEMA_VERSION}/duplication.json`);
}
//# sourceMappingURL=json-schema.js.map