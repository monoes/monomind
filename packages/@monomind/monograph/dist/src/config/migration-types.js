export const KNIP_CONFIG_FILENAMES = [
    'knip.json',
    'knip.jsonc',
    '.knip.json',
    '.knip.jsonc',
    'knip.ts',
    'knip.js',
    'knip.config.ts',
    'knip.config.js',
];
export const JSCPD_CONFIG_FILENAMES = [
    '.jscpd.json',
    '.jscpd.yaml',
    '.jscpd.yml',
];
export const KNOWN_KNIP_FIELDS = new Set([
    'entry', 'project', 'ignore', 'ignoreBinaries', 'ignoreDependencies', 'ignoreExportsUsedInFile',
    'rules', 'plugins', 'workspaces', 'paths', 'typescript', 'tags',
]);
export const KNOWN_JSCPD_FIELDS = new Set([
    'threshold', 'minLines', 'minTokens', 'format', 'ignore', 'path', 'reporters',
    'output', 'blame', 'silent', 'absolute', 'gitignore', 'maxLines', 'maxSize',
]);
export function detectMigrationSource(dirPath, files) {
    for (const filename of KNIP_CONFIG_FILENAMES) {
        if (files.includes(filename)) {
            return { kind: 'knip', filePath: `${dirPath}/${filename}` };
        }
    }
    for (const filename of JSCPD_CONFIG_FILENAMES) {
        if (files.includes(filename)) {
            return { kind: 'jscpd', filePath: `${dirPath}/${filename}` };
        }
    }
    return null;
}
export function makeMigrationWarning(source, field, message, suggestion) {
    return { source, field, message, suggestion };
}
export function migrationSuccess(config, sources, warnings = []) {
    return { config, warnings, sources };
}
//# sourceMappingURL=migration-types.js.map