export type FallowEmailMode = 'raw' | 'handle' | 'hash';
export interface FallowOwnershipConfig {
    botPatterns: string[];
    emailMode: FallowEmailMode;
}
export interface FallowHealthConfig {
    maxCyclomatic: number;
    maxCognitive: number;
    maxCrap: number;
    ignore: string[];
    ownership: FallowOwnershipConfig;
    suggestInlineSuppression: boolean;
}
export declare const DEFAULT_BOT_PATTERNS: string[];
export declare const DEFAULT_FALLOW_HEALTH_CONFIG: FallowHealthConfig;
export declare function mergeFallowHealthConfig(partial: Partial<FallowHealthConfig>): FallowHealthConfig;
//# sourceMappingURL=health-config.d.ts.map