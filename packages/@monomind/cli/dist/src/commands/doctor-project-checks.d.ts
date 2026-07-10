/**
 * Doctor — project/monomind health checks
 * Config, daemon, memory, API keys, MCP, monograph, helpers, routing, gates, gitignore
 */
import type { HealthCheck } from './doctor-env-checks.js';
export type { HealthCheck };
export declare function checkConfigFile(): Promise<HealthCheck>;
export declare function checkDaemonStatus(): Promise<HealthCheck>;
export declare function checkMemoryDatabase(): Promise<HealthCheck>;
export declare function checkApiKeys(): Promise<HealthCheck>;
export declare function checkMcpServers(): Promise<HealthCheck>;
export declare function checkMonograph(): Promise<HealthCheck>;
export declare function checkMonographFreshness(): Promise<HealthCheck>;
export declare function checkMonoesMemory(): Promise<HealthCheck>;
export declare function fixStaleHelpers(): Promise<boolean>;
export declare function checkHelpersFresh(): Promise<HealthCheck>;
export declare function checkMonoesIntegration(): Promise<HealthCheck>;
export declare function checkGitignoreCoverage(): Promise<HealthCheck>;
export declare function checkAgentRegistry(): Promise<HealthCheck>;
export declare function checkGuidanceGates(): Promise<HealthCheck>;
/**
 * Daemon metrics freshness — flags stale (>1h) or missing worker output files
 * so a wedged/disabled daemon is visible without digging through .monomind/metrics.
 */
export declare function checkMetricsFreshness(): Promise<HealthCheck>;
/**
 * Surfaces critical findings from the security-audit daemon worker output.
 */
export declare function checkSecurityAuditFindings(): Promise<HealthCheck>;
/**
 * Flags uncovered critical paths surfaced by the testgaps worker (headless-only —
 * gracefully reports "not run" when the local daemon has no fallback for this worker).
 */
export declare function checkTestGaps(): Promise<HealthCheck>;
/**
 * AutoMem proficiency check — reports memory learning health
 */
export declare function checkMemoryProficiency(): Promise<HealthCheck>;
//# sourceMappingURL=doctor-project-checks.d.ts.map