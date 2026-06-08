import type Database from 'better-sqlite3';
export interface RouteMapEntry {
    method: string;
    path: string;
    handlerName: string | null;
    handlerFile: string | null;
    handlerLine: number | null;
    routeNodeId: string;
    middlewareChain: string[];
}
export interface MonographRouteMapResult {
    routes: RouteMapEntry[];
    total: number;
}
export declare function getMonographRouteMap(db: Database.Database, input: {
    prefix?: string;
    method?: string;
    includeMiddleware?: boolean;
    repoPath?: string;
}): MonographRouteMapResult;
//# sourceMappingURL=route-map.d.ts.map