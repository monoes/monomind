export function fileId(n) {
    return n;
}
export function formatEntryPointSource(source) {
    switch (source.kind) {
        case 'package-json-main': return 'package.json[main]';
        case 'package-json-module': return 'package.json[module]';
        case 'package-json-exports': return 'package.json[exports]';
        case 'package-json-bin': return 'package.json[bin]';
        case 'package-json-script': return 'package.json[scripts]';
        case 'plugin': return `plugin:${source.name}`;
        case 'test-file': return 'test-file';
        case 'default-index': return 'default-index';
        case 'manual-entry': return 'manual';
        case 'infrastructure-config': return 'infra-config';
        case 'dynamically-loaded': return 'dynamic';
    }
}
//# sourceMappingURL=discover-types.js.map