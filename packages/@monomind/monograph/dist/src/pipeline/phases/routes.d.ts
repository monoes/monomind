import type { PipelinePhase } from '../types.js';
export interface RouteEntry {
    method: string;
    path: string;
    handlerNodeId?: string;
    filePath: string;
    routeNodeId: string;
    middlewareChain: string[];
}
export interface RoutesOutput {
    routeRegistry: RouteEntry[];
}
export declare const routesPhase: PipelinePhase<RoutesOutput>;
/**
 * Convert a pages/... file path to an HTTP route path.
 * examples:
 *   pages/index.ts         → /
 *   pages/about.ts         → /about
 *   pages/api/users.ts     → /api/users
 *   pages/api/users/[id].ts → /api/users/:id
 *   pages/[[...slug]].ts   → *
 */
export declare function pagesPathToRoute(relPath: string): string;
/**
 * Convert an app/.../route.ts path to an HTTP route path.
 * examples:
 *   app/route.ts               → /
 *   app/users/route.ts         → /users
 *   app/users/[id]/route.ts    → /users/:id
 */
export declare function appPathToRoute(relPath: string): string;
/** Returns the exported identifier from `export default function X` or `export default X` */
export declare function extractDefaultExportName(source: string): string | undefined;
interface DetectedRoute {
    method: string;
    path: string;
    handlerName?: string;
}
export declare function extractExpressRoutes(source: string, _filePath: string, _ext: string): DetectedRoute[];
export declare function extractNestRoutes(source: string, _filePath: string, _ext: string): DetectedRoute[];
export {};
//# sourceMappingURL=routes.d.ts.map