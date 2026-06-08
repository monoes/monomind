import type Database from 'better-sqlite3';
import { type RouteShape } from '../analysis/shape-extractor.js';
export interface ShapeCheckResult {
    route: {
        path: string;
        method: string;
        handlerName: string;
        handlerFile: string;
    } | null;
    shape: RouteShape;
    consumers: {
        name: string;
        filePath: string;
    }[];
    message: string;
}
/**
 * Check whether the JSON shape returned by a route handler matches what its
 * consumers actually access.
 *
 * @param db        - Open monograph SQLite database
 * @param repoPath  - Absolute path to repository root (used to resolve file_path)
 * @param options   - `route` searches by route name/path substring;
 *                    `file` searches by exact file_path of the Route node
 */
export declare function getShapeCheck(db: Database.Database, repoPath: string, options: {
    route?: string;
    file?: string;
}): ShapeCheckResult;
//# sourceMappingURL=shape-check.d.ts.map