/**
 * Local vs global monomind version sync checker.
 * Reads .monomind/version (stamped by `monomind init`) and compares to
 * the globally installed monomind package. No network calls — entirely local.
 */
export interface SyncCheckResult {
    localVersion: string | null;
    globalVersion: string | null;
    needsSync: boolean;
}
export declare function checkLocalSync(projectDir?: string): SyncCheckResult;
//# sourceMappingURL=checker.d.ts.map