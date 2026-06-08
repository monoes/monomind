export type DetectedFramework = 'react' | 'vue' | 'svelte' | 'angular' | 'none';
export type DetectedTestRunner = 'vitest' | 'jest' | 'playwright' | 'none';
export type DetectedPackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun' | 'unknown';
export type DetectedMonorepoTool = 'pnpm-workspaces' | 'npm-workspaces' | 'yarn-workspaces' | 'nx' | 'turborepo' | 'none';
export interface ProjectInfo {
    root: string;
    hasTypeScript: boolean;
    framework: DetectedFramework;
    testRunner: DetectedTestRunner;
    packageManager: DetectedPackageManager;
    monorepoTool: DetectedMonorepoTool;
    workspaceGlobs: string[];
    hasStorybook: boolean;
    entryPoints: string[];
    testPatterns: string[];
}
export declare function detectFramework(deps: Record<string, string>): DetectedFramework;
export declare function detectTestRunner(deps: Record<string, string>): DetectedTestRunner;
export declare function detectPackageManager(files: string[]): DetectedPackageManager;
export declare function detectProject(rootFiles: string[], packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    workspaces?: string[] | {
        packages: string[];
    };
} | null, hasPnpmWorkspace: boolean): ProjectInfo;
export declare function buildJsonConfig(info: ProjectInfo): string;
export declare function buildTomlConfig(info: ProjectInfo): string;
//# sourceMappingURL=project-detection.d.ts.map