// Three-state control for suppressing unused-export findings when an export
// is also referenced in the file that declares it.
export const IGNORE_EXPORTS_DISABLED = { kind: 'disabled' };
export const IGNORE_EXPORTS_ENABLED = { kind: 'enabled' };
export function ignoreExportsByKind(byKind) {
    return { kind: 'byKind', byKind };
}
export function isIgnoreExportsEnabled(config) {
    return config.kind !== 'disabled';
}
export function suppressesExport(config, isTypeOnly) {
    if (config.kind === 'disabled')
        return false;
    if (config.kind === 'enabled')
        return true;
    if (isTypeOnly)
        return config.byKind.interface || config.byKind.typeAlias;
    return false;
}
export function parseIgnoreExportsConfig(raw) {
    if (raw === false || raw === null || raw === undefined)
        return IGNORE_EXPORTS_DISABLED;
    if (raw === true)
        return IGNORE_EXPORTS_ENABLED;
    if (typeof raw === 'object') {
        const obj = raw;
        return ignoreExportsByKind({
            interface: Boolean(obj['interface']),
            typeAlias: Boolean(obj['typeAlias'] ?? obj['type_alias']),
        });
    }
    return IGNORE_EXPORTS_DISABLED;
}
//# sourceMappingURL=ignore-exports-used-in-file.js.map