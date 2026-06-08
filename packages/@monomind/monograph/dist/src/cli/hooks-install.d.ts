export declare const HOOK_MARKER_START = "# monograph-hook-start";
export declare const HOOK_MARKER_END = "# monograph-hook-end";
/**
 * Install (or update) monograph hooks by appending a marked block.
 * Existing hook content is preserved. Re-running is idempotent.
 */
export declare function installGitHooks(repoPath: string, hooks: string[]): void;
/**
 * Uninstall monograph from hooks.
 * Only removes the marker block — surrounding content is preserved.
 * Removes the file entirely if nothing meaningful remains.
 */
export declare function uninstallGitHooks(repoPath: string, hooks: string[]): void;
/**
 * List hook names that contain a monograph marker block.
 */
export declare function listInstalledHooks(repoPath: string): string[];
export interface PerHookStatus {
    installed: boolean;
    path: string;
    hasCustomContent: boolean;
}
export interface HookStatus {
    installed: boolean;
    hooks: string[];
    hooksDir: string;
    /** Per-hook details keyed by hook name. */
    perHook?: Record<string, PerHookStatus>;
}
export declare function getHookStatus(repoPath: string): HookStatus;
//# sourceMappingURL=hooks-install.d.ts.map