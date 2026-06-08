import { ModuleNode } from './node-types.js';
export interface ReachabilityOptions {
    runtimeEntries?: Set<number>;
    testEntries?: Set<number>;
}
export declare function markReachable(nodes: Map<number, ModuleNode>, edges: Map<number, number[]>, entryPoints: number[], opts?: ReachabilityOptions): void;
export declare function collectReachable(nodes: Map<number, ModuleNode>): Set<number>;
export declare function collectUnreachable(nodes: Map<number, ModuleNode>, allFileIds: number[]): number[];
//# sourceMappingURL=reachability.d.ts.map