// Inspects a project root to scaffold a tailored monograph config.
export function detectFramework(deps) {
    if ('react' in deps || 'react-dom' in deps)
        return 'react';
    if ('vue' in deps)
        return 'vue';
    if ('svelte' in deps)
        return 'svelte';
    if ('@angular/core' in deps)
        return 'angular';
    return 'none';
}
export function detectTestRunner(deps) {
    if ('vitest' in deps)
        return 'vitest';
    if ('jest' in deps || '@jest/core' in deps)
        return 'jest';
    if ('@playwright/test' in deps)
        return 'playwright';
    return 'none';
}
export function detectPackageManager(files) {
    if (files.includes('pnpm-lock.yaml'))
        return 'pnpm';
    if (files.includes('bun.lockb'))
        return 'bun';
    if (files.includes('yarn.lock'))
        return 'yarn';
    if (files.includes('package-lock.json'))
        return 'npm';
    return 'unknown';
}
export function detectProject(rootFiles, packageJson, hasPnpmWorkspace) {
    const allDeps = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
    const workspaceGlobs = hasPnpmWorkspace
        ? ['packages/*']
        : Array.isArray(packageJson?.workspaces)
            ? packageJson.workspaces
            : packageJson?.workspaces?.packages ?? [];
    const monorepoTool = hasPnpmWorkspace
        ? 'pnpm-workspaces'
        : workspaceGlobs.length > 0
            ? 'npm-workspaces'
            : 'none';
    const framework = detectFramework(allDeps);
    const testRunner = detectTestRunner(allDeps);
    const packageManager = detectPackageManager(rootFiles);
    const testPatterns = testRunner !== 'none'
        ? ['**/*.test.{ts,tsx,js,jsx}', '**/*.spec.{ts,tsx,js,jsx}']
        : [];
    const entryPoints = ['src/index.ts', 'src/index.tsx', 'src/main.ts', 'index.ts']
        .filter(ep => rootFiles.some(f => f.endsWith(ep.replace('src/', ''))));
    return {
        root: '',
        hasTypeScript: rootFiles.includes('tsconfig.json'),
        framework,
        testRunner,
        packageManager,
        monorepoTool,
        workspaceGlobs,
        hasStorybook: rootFiles.some(f => f.includes('.storybook')),
        entryPoints: entryPoints.length > 0 ? entryPoints : ['src/index.ts'],
        testPatterns,
    };
}
export function buildJsonConfig(info) {
    const config = {
        $schema: 'https://monograph.dev/schema.json',
        entryPoints: info.entryPoints,
        ignore: ['**/*.d.ts', '**/*.test.*', '**/*.spec.*', ...(info.testPatterns.length > 0 ? info.testPatterns : [])],
        ...(info.workspaceGlobs.length > 0 ? { workspaces: info.workspaceGlobs } : {}),
    };
    return JSON.stringify(config, null, 2);
}
export function buildTomlConfig(info) {
    const lines = ['[monograph]'];
    lines.push(`entry_points = [${info.entryPoints.map(e => `"${e}"`).join(', ')}]`);
    if (info.workspaceGlobs.length > 0) {
        lines.push(`workspaces = [${info.workspaceGlobs.map(g => `"${g}"`).join(', ')}]`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=project-detection.js.map