/**
 * Rate limiter for update checks
 * Prevents excessive npm registry queries
 */
export interface RateLimitState {
    lastCheck: string;
    checksToday: number;
    date: string;
    packageVersions: Record<string, string>;
}
export declare function loadState(): RateLimitState;
export declare function saveState(state: RateLimitState): void;
export declare function shouldCheckForUpdates(intervalHours?: number): {
    allowed: boolean;
    reason?: string;
};
/**
 * Atomically check the daily limit and pre-increment the counter.
 * Returns false if already at the limit. Callers MUST call recordCheck
 * only after a successful reserveCheck, so that limit enforcement and
 * increment happen in the same synchronous turn (no await gap between
 * them), preventing two concurrent callers both seeing "allowed".
 */
export declare function reserveCheck(intervalHours?: number): {
    allowed: boolean;
    reason?: string;
};
export declare function recordCheck(packageVersions: Record<string, string>): void;
export declare function getCachedVersions(): Record<string, string>;
export declare function clearCache(): void;
//# sourceMappingURL=rate-limiter.d.ts.map