import { readFileSync, existsSync } from 'fs';
const JSCPD_REPORTERS_WARNING = 'Use monograph --format sarif|codeclimate|markdown instead';
export function migrateFromJscpd(jscpdConfigPath) {
    if (!existsSync(jscpdConfigPath)) {
        throw new Error(`jscpd config not found: ${jscpdConfigPath}`);
    }
    const raw = readFileSync(jscpdConfigPath, 'utf-8');
    const warnings = [];
    const monographConfig = {};
    let jscpdConfig;
    try {
        jscpdConfig = JSON.parse(raw);
    }
    catch {
        warnings.push({
            field: '<file>',
            message: 'Failed to parse config as JSON',
            knipValue: raw.slice(0, 100),
        });
        return { monographConfig, warnings, inputFile: jscpdConfigPath };
    }
    const knownFields = new Set([
        'threshold',
        'minTokens',
        'ignore',
        'reporters',
        'languages',
        'gitignore',
    ]);
    for (const [key, value] of Object.entries(jscpdConfig)) {
        switch (key) {
            case 'threshold':
                monographConfig['cloneThreshold'] = value;
                break;
            case 'minTokens':
                monographConfig['cloneMinTokens'] = value;
                break;
            case 'ignore':
                monographConfig['exclude'] = value;
                break;
            case 'reporters':
                warnings.push({
                    field: key,
                    message: JSCPD_REPORTERS_WARNING,
                    knipValue: value,
                });
                break;
            case 'languages':
                monographConfig['languages'] = value;
                break;
            case 'gitignore':
                monographConfig['respectGitignore'] = value;
                break;
            default:
                warnings.push({
                    field: key,
                    message: 'No equivalent in monograph config',
                    knipValue: value,
                });
                break;
        }
    }
    return { monographConfig, warnings, inputFile: jscpdConfigPath };
}
//# sourceMappingURL=jscpd.js.map