/**
 * Doctor — project/monomind health checks
 * Config, memory, API keys, MCP, monograph, helpers, routing, gates, gitignore, worker metrics
 */
import type { HealthCheck } from './doctor-env-checks.js';
export type { HealthCheck };
export declare function checkConfigFile(): Promise<HealthCheck>;
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
 * Worker metrics freshness — reports the age of the @monomind/hooks worker
 * output files (written at session start with a 6h staleness gate, or on
 * demand via `monomind hooks worker run <name>`), so missing/stale worker
 * output is visible without digging through .monomind/metrics.
 */
export declare function checkMetricsFreshness(): Promise<HealthCheck>;
/**
 * Surfaces critical findings from the security-audit worker output.
 */
export declare function checkSecurityAuditFindings(): Promise<HealthCheck>;
/**
 * AutoMem proficiency check — reports memory learning health
 */
export declare function checkMemoryProficiency(): Promise<HealthCheck>;
//# sourceMappingURL=doctor-project-checks.d.ts.map