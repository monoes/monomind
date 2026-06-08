export interface DepFix {
    packageJsonPath: string;
    packageName: string;
    section: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';
}
export interface DepFixResult {
    packageJsonPath: string;
    removed: string[];
    dryRun: boolean;
}
export declare function fixUnusedDeps(fixes: DepFix[], options?: {
    dryRun?: boolean;
}): DepFixResult[];
//# sourceMappingURL=deps.d.ts.map