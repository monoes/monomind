import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
export const DEFAULT_FLAGS_CONFIG = {
    envPrefixes: ['FEATURE_', 'FF_', 'FLAG_', 'ENABLE_', 'DISABLE_', 'AB_', 'EXP_', 'EXPERIMENT_'],
    sdkPatterns: [
        'launchdarkly', 'ld-client', '@launchdarkly',
        'statsig', '@statsig',
        'unleash', 'unleash-client',
        'growthbook', '@growthbook',
        'configcat', 'config-cat',
        'flagsmith',
        'split-io', '@splitsoftware',
    ],
};
// SDK method patterns that signal flag evaluation
const SDK_CALL_PATTERNS = [
    /\.variation\s*\(/,
    /\.isEnabled\s*\(/,
    /\.checkGate\s*\(/,
    /\.getExperiment\s*\(/,
    /\.isOn\s*\(/,
    /\.getFeature\s*\(/,
    /\.getTreatment\s*\(/,
    /\.evaluate\s*\(/,
    /featureIsEnabled\s*\(/,
    /getFlag\s*\(/,
    /flagEnabled\s*\(/,
];
const ENV_VAR_RE = /process\.env\.([A-Z][A-Z0-9_]+)/g;
const CONFIG_OBJECT_RE = /(?:featureFlags?|flags?|features?)\s*[\[.]\s*['"]([A-Za-z][A-Za-z0-9_-]*)['"]|(?:isEnabled|isActive|isOn)\s*\(\s*['"]([A-Za-z][A-Za-z0-9_-]*)['"]/g;
function isSourceFile(filePath) {
    const ext = extname(filePath).toLowerCase();
    return ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs'].includes(ext);
}
function detectFlagsInLine(line, lineNum, filePath, config) {
    const found = [];
    // Environment variable flags
    let m;
    const envRe = new RegExp(ENV_VAR_RE.source, 'g');
    while ((m = envRe.exec(line)) !== null) {
        const varName = m[1];
        const isFlag = config.envPrefixes.some(p => varName.startsWith(p));
        if (isFlag) {
            found.push({
                filePath, flagName: varName, kind: 'EnvironmentVariable',
                confidence: 'High', line: lineNum, col: m.index + 1,
            });
        }
    }
    // SDK call patterns
    for (const pattern of SDK_CALL_PATTERNS) {
        const sdkMatch = pattern.exec(line);
        if (sdkMatch) {
            // Try to extract the flag name from the first string argument
            const argMatch = line.slice(sdkMatch.index).match(/\(\s*['"]([^'"]+)['"]/);
            if (argMatch) {
                found.push({
                    filePath, flagName: argMatch[1], kind: 'SdkCall',
                    confidence: 'High', line: lineNum, col: sdkMatch.index + 1,
                    sdkName: detectSdkName(line),
                });
            }
        }
    }
    // Config object heuristics
    const configRe = new RegExp(CONFIG_OBJECT_RE.source, 'g');
    while ((m = configRe.exec(line)) !== null) {
        const flagName = m[1] ?? m[2];
        if (flagName) {
            found.push({
                filePath, flagName, kind: 'ConfigObject',
                confidence: 'Medium', line: lineNum, col: m.index + 1,
            });
        }
    }
    return found;
}
function detectSdkName(line) {
    const lower = line.toLowerCase();
    if (lower.includes('launchdarkly') || lower.includes('ldclient'))
        return 'LaunchDarkly';
    if (lower.includes('statsig'))
        return 'Statsig';
    if (lower.includes('unleash'))
        return 'Unleash';
    if (lower.includes('growthbook'))
        return 'GrowthBook';
    if (lower.includes('configcat'))
        return 'ConfigCat';
    if (lower.includes('flagsmith'))
        return 'Flagsmith';
    if (lower.includes('split'))
        return 'Split';
    return 'unknown';
}
export function analyzeFeatureFlags(rootDir, config = DEFAULT_FLAGS_CONFIG) {
    const flags = [];
    walkDir(rootDir, filePath => {
        if (!isSourceFile(filePath))
            return;
        let content;
        try {
            content = readFileSync(filePath, 'utf8');
        }
        catch {
            return;
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const detected = detectFlagsInLine(lines[i], i + 1, filePath, config);
            flags.push(...detected);
        }
    });
    return flags;
}
export function crossReferenceWithDeadCode(flags, deadExports) {
    // Pregroup dead exports by filePath to avoid O(F*D) nested scan
    const deadByFile = new Map();
    for (const e of deadExports) {
        let arr = deadByFile.get(e.filePath);
        if (!arr) {
            arr = [];
            deadByFile.set(e.filePath, arr);
        }
        arr.push({ name: e.name, line: e.line });
    }
    return flags.map(flag => {
        if (flag.guardLineStart == null || flag.guardLineEnd == null)
            return flag;
        const fileDeads = deadByFile.get(flag.filePath);
        if (!fileDeads)
            return flag;
        const start = flag.guardLineStart ?? 0;
        const end = flag.guardLineEnd ?? Infinity;
        const guarded = fileDeads
            .filter(e => e.line >= start && e.line <= end)
            .map(e => e.name);
        return guarded.length > 0 ? { ...flag, guardedDeadExports: guarded } : flag;
    });
}
function walkDir(dir, fn) {
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'build')
            continue;
        const full = join(dir, entry);
        let st;
        try {
            st = statSync(full);
        }
        catch {
            continue;
        }
        if (st.isDirectory())
            walkDir(full, fn);
        else if (st.isFile())
            fn(full);
    }
}
export function summarizeFlags(flags) {
    // Single pass over flags instead of 7 separate filter/map passes
    const byKind = { EnvironmentVariable: 0, SdkCall: 0, ConfigObject: 0 };
    const byConfidence = { High: 0, Medium: 0, Low: 0 };
    const flagNames = new Set();
    const filePaths = new Set();
    let deadCodeOverlaps = 0;
    for (const f of flags) {
        byKind[f.kind]++;
        byConfidence[f.confidence]++;
        flagNames.add(f.flagName);
        filePaths.add(f.filePath);
        if ((f.guardedDeadExports?.length ?? 0) > 0)
            deadCodeOverlaps++;
    }
    return {
        totalFlags: flags.length,
        byKind,
        byConfidence,
        uniqueFlagNames: flagNames.size,
        filesWithFlags: filePaths.size,
        deadCodeOverlaps,
    };
}
//# sourceMappingURL=feature-flags.js.map