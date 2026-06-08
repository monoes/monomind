export type GitHooksManager = 'husky' | 'lefthook' | 'raw' | 'none';
export interface GitHooksInstallOptions {
    root: string;
    branch?: string;
    command?: string;
}
export interface GitHooksInstallResult {
    manager: GitHooksManager;
    installed: boolean;
    hookPath: string;
    message: string;
}
/** Detect which hooks manager is active in the project. */
export declare function detectHooksManager(rootFiles: string[]): GitHooksManager;
/** Validate a branch name against shell injection. */
export declare function validateBranchName(branch: string): boolean;
/** Generate the pre-commit hook script content. */
export declare function renderedHookScript(opts: GitHooksInstallOptions): string;
/** Build the hook content by merging with existing content (idempotent). */
export declare function mergeHookContent(existing: string, script: string): string;
/** Remove the managed block from hook content. */
export declare function removeHookBlock(content: string): string;
export declare const GIT_HOOK_INSTALL_RESULT_NONE: GitHooksInstallResult;
//# sourceMappingURL=git-hooks.d.ts.map