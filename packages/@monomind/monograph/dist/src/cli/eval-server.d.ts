/**
 * Eval Server — Lightweight HTTP server for CI/integration evaluation of monograph queries.
 *
 * Exposes /health, /query, and /search endpoints backed by the monograph DB.
 * Designed for integration tests and evaluation scripts.
 *
 * Usage:
 *   createEvalServer('/path/to/repo')
 *   createEvalServer('/path/to/repo', 4848)
 */
import type { Server } from 'http';
import type { Application } from 'express';
import type { HybridResult } from '../search/hybrid-query.js';
export interface EvalServerHandle {
    app: Application;
    start(port: number): Promise<Server>;
    stop(): void;
}
export type SearchResult = HybridResult;
/**
 * Create an eval server for a monograph DB at the given repo path.
 *
 * Returns an object with:
 *  - `app` — Express application (useful for supertest)
 *  - `start(port)` — begins listening; resolves with the Node http.Server
 *  - `stop()` — closes the DB and server
 */
export declare function createEvalServer(repoPath: string, _port?: number): EvalServerHandle;
//# sourceMappingURL=eval-server.d.ts.map