/**
 * Configuration Adapter
 * Converts between SystemConfig and MonomindConfig types
 */
type SystemConfig = any;
import type { MonomindConfig } from './types.js';
/**
 * Convert SystemConfig to MonomindConfig (CLI-specific format)
 */
export declare function systemConfigToMonomindConfig(systemConfig: SystemConfig): MonomindConfig;
/**
 * Convert MonomindConfig to SystemConfig
 */
export declare function configToSystemConfig(config: MonomindConfig): Partial<SystemConfig>;
export {};
//# sourceMappingURL=config-adapter.d.ts.map