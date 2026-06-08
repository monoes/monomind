// Analyzes npm scripts fields and CI config files to derive additional
// entry points for dead-code analysis.
const PACKAGE_MANAGER_PREFIXES = ['npx', 'pnpm', 'yarn', 'bunx', 'nx', 'turbo'];
const SHELL_OPERATORS = /&&|\|\||;|\|/;
export function splitShellOperators(script) {
    return script.split(SHELL_OPERATORS).map(s => s.trim()).filter(Boolean);
}
export function skipInitialWrappers(parts) {
    const skip = new Set(['env', 'cross-env', 'dotenv', 'run-s', 'run-p', 'concurrently']);
    let i = 0;
    while (i < parts.length && (skip.has(parts[i]) || parts[i].includes('=')))
        i++;
    return parts.slice(i);
}
export function parseScriptCommand(raw) {
    const segments = splitShellOperators(raw);
    const first = segments[0];
    if (!first)
        return null;
    const tokens = first.split(/\s+/).filter(Boolean);
    const adjusted = skipInitialWrappers(tokens);
    if (!adjusted.length)
        return null;
    let binary = adjusted[0];
    let args = adjusted.slice(1);
    if (PACKAGE_MANAGER_PREFIXES.includes(binary) && args.length) {
        binary = args[0];
        args = args.slice(1);
    }
    return { binary, args, sourceScript: raw };
}
export function filterProductionScripts(scripts) {
    const devKeys = /^(dev|test|lint|type-check|watch|storybook|e2e)/;
    const result = {};
    for (const [k, v] of Object.entries(scripts)) {
        if (!devKeys.test(k))
            result[k] = v;
    }
    return result;
}
export function analyzeScripts(scripts, _root) {
    const production = filterProductionScripts(scripts);
    const commands = [];
    const entryPatterns = [];
    for (const raw of Object.values(production)) {
        const cmd = parseScriptCommand(raw);
        if (cmd)
            commands.push(cmd);
    }
    return { entryPatterns, commands, binToPackage: new Map() };
}
export function buildBinToPackageMap(packageJson) {
    const map = new Map();
    const name = packageJson['name'];
    if (!name)
        return map;
    const bin = packageJson['bin'];
    if (typeof bin === 'string') {
        map.set(name, name);
    }
    else if (typeof bin === 'object' && bin !== null) {
        for (const k of Object.keys(bin))
            map.set(k, name);
    }
    return map;
}
export function analyzeCiFiles(_root) {
    return { entryPatterns: [], detectedRunners: [] };
}
//# sourceMappingURL=scripts.js.map