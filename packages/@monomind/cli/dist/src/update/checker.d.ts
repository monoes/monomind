/**
 * Update checker for @monoes packages
 * Queries npm registry and compares versions
 */
export interface UpdateCheckResult {
    package: string;
    currentVersion: string;
    latestVersion: string;
    updateType: 'major' | 'minor' | 'patch' | 'none';
    shouldAutoUpdate: boolean;
    priority: 'critical' | 'high' | 'normal' | 'low';
    changelog?: string;
}
export interface UpdateConfig {
    enabled: boolean;
    checkIntervalHours: number;
    autoUpdate: {
        patch: boolean;
        minor: boolean;
        major: boolean;
    };
    priority: Record<string, 'critical' | 'high' | 'normal' | 'low'>;
    exclude: string[];
}
declare const DEFAULT_CONFIG: UpdateConfig;
export declare function getInstalledVersion(packageName: string): string | null;
export declare function checkForUpdates(config?: UpdateConfig): Promise<{
    results: UpdateCheckResult[];
    skipped: boolean;
    reason?: string;
}>;
export declare function checkSinglePackage(packageName: string, config?: UpdateConfig): Promise<UpdateCheckResult | null>;
export { DEFAULT_CONFIG };
//# sourceMappingURL=checker.d.ts.map