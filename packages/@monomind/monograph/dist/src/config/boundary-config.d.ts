export type BoundaryPreset = 'layered' | 'hexagonal' | 'feature-sliced' | 'bulletproof';
export interface BoundaryZoneConfig {
    name: string;
    patterns: string[];
    root?: string;
}
export interface BoundaryRuleConfig {
    from: string;
    allow: string[];
}
export interface BoundaryConfigFallow {
    preset?: BoundaryPreset;
    zones?: BoundaryZoneConfig[];
    rules?: BoundaryRuleConfig[];
}
export interface ResolvedZone {
    name: string;
    patterns: string[];
    root: string;
}
export interface ResolvedBoundaryRule {
    from: ResolvedZone;
    allow: ResolvedZone[];
}
export interface ResolvedBoundaryConfig {
    zones: ResolvedZone[];
    rules: ResolvedBoundaryRule[];
}
export declare function expandPreset(preset: BoundaryPreset, sourceRoot: string): BoundaryConfigFallow;
export declare function resolveBoundaryConfig(config: BoundaryConfigFallow, sourceRoot: string): ResolvedBoundaryConfig;
export declare function classifyZone(resolved: ResolvedBoundaryConfig, filePath: string): string | undefined;
export declare function isImportAllowed(resolved: ResolvedBoundaryConfig, fromPath: string, toPath: string): boolean;
//# sourceMappingURL=boundary-config.d.ts.map