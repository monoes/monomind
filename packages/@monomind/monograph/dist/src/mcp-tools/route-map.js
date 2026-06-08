import { readFileSync } from 'fs';
import { extractMiddlewareChain } from '../pipeline/phases/middleware-extractor.js';
// ── Implementation ─────────────────────────────────────────────────────────────
export function getMonographRouteMap(db, input) {
    // 1. Query all Route nodes
    let routeRows = db
        .prepare("SELECT * FROM nodes WHERE label = 'Route'")
        .all();
    // 2. Apply prefix filter
    if (input.prefix) {
        const prefix = input.prefix;
        routeRows = routeRows.filter((row) => {
            const name = row.name;
            // name is like "GET /api/users" — find the path part
            const spaceIdx = name.indexOf(' ');
            const path = spaceIdx >= 0 ? name.slice(spaceIdx + 1) : name;
            return path.startsWith(prefix);
        });
    }
    // 3. Apply method filter
    if (input.method) {
        const methodUpper = input.method.toUpperCase();
        routeRows = routeRows.filter((row) => {
            const name = row.name;
            return name.startsWith(methodUpper + ' ') || name.startsWith('ANY ');
        });
    }
    // 4. For each route, find handler via HANDLES_ROUTE edge
    const handlerStmt = db.prepare(`SELECT n.name, n.file_path, n.start_line FROM nodes n
     JOIN edges e ON n.id = e.target_id
     WHERE e.source_id = ? AND e.relation = 'HANDLES_ROUTE'
     LIMIT 1`);
    const routes = routeRows.map((row) => {
        const routeNodeId = row.id;
        const name = row.name;
        // Parse method and path from name (format: "METHOD /path")
        const spaceIdx = name.indexOf(' ');
        const method = spaceIdx >= 0 ? name.slice(0, spaceIdx) : 'ANY';
        const path = spaceIdx >= 0 ? name.slice(spaceIdx + 1) : name;
        // Look up handler
        const handlerRow = handlerStmt.get(routeNodeId);
        // Detect middleware chain at query time when requested
        let middlewareChain = [];
        if (input.includeMiddleware && input.repoPath && handlerRow?.name && handlerRow?.file_path) {
            try {
                const absPath = `${input.repoPath}/${handlerRow.file_path}`;
                const source = readFileSync(absPath, 'utf-8');
                middlewareChain = extractMiddlewareChain(source, handlerRow.name).middlewareNames;
            }
            catch {
                // File not found or unreadable — leave middlewareChain as []
            }
        }
        return {
            method,
            path,
            handlerName: handlerRow?.name ?? null,
            handlerFile: handlerRow?.file_path ?? null,
            handlerLine: handlerRow?.start_line ?? null,
            routeNodeId,
            middlewareChain,
        };
    });
    return { routes, total: routes.length };
}
//# sourceMappingURL=route-map.js.map