import type { CapabilityModule, CapabilityName, DirectoryScan, HealthCheck, SearchResult } from './types.js';
export declare class CapabilityManager {
    private registry;
    private active;
    register(module: CapabilityModule): void;
    activateFromScan(scan: DirectoryScan, rootDir: string, save?: boolean): Promise<void>;
    private saveCapabilities;
    isActive(name: CapabilityName): boolean;
    getActive(): CapabilityModule[];
    runHealthChecks(): Promise<HealthCheck[]>;
    search(query: string, limit?: number): Promise<SearchResult[]>;
}
//# sourceMappingURL=manager.d.ts.map