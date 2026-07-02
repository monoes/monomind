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
export declare function checkHelpersFresh(): Promise<HealthCheck>;
export declare function checkMonoesIntegration(): Promise<HealthCheck>;
export declare function checkGitignoreCoverage(): Promise<HealthCheck>;
export declare function checkGuidanceGates(): Promise<HealthCheck>;
//# sourceMappingURL=doctor-project-checks.d.ts.map