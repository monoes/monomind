export function parseTraceSpec(spec) {
    const idx = spec.lastIndexOf(':');
    if (idx <= 0)
        return null;
    return [spec.slice(0, idx), spec.slice(idx + 1)];
}
export function buildSarifOutput(issues, toolVersion) {
    const ruleIds = [...new Set(issues.map(i => i.kind))];
    const rules = ruleIds.map(id => ({
        id,
        shortDescription: { text: id },
        defaultConfiguration: { level: 'warning' },
    }));
    const results = issues.map(issue => ({
        ruleId: issue.kind,
        level: issue.severity === 'error' ? 'error' : issue.severity === 'warn' ? 'warning' : 'note',
        message: { text: issue.message },
        locations: [{
                physicalLocation: {
                    artifactLocation: { uri: issue.filePath.replace(/\\/g, '/') },
                },
            }],
    }));
    return {
        version: '2.1.0',
        $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
        runs: [{ tool: { driver: { name: 'monograph', version: toolVersion, rules } }, results }],
    };
}
export function formatIssuesAsText(issues, quiet) {
    if (quiet && issues.length === 0)
        return '';
    const lines = issues.map(i => `[${(i.severity ?? 'error').toUpperCase()}] ${i.filePath}: ${i.message}`);
    return lines.join('\n');
}
export function formatIssuesAsJson(issues) {
    return JSON.stringify({ issues }, null, 2);
}
//# sourceMappingURL=output.js.map