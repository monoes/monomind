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
import { openDb, closeDb } from '../storage/db.js';
import { querySearch, queryStats } from '../web/api.js';
import { hybridQuery } from '../search/hybrid-query.js';
// ── createEvalServer ──────────────────────────────────────────────────────────
/**
 * Create an eval server for a monograph DB at the given repo path.
 *
 * Returns an object with:
 *  - `app` — Express application (useful for supertest)
 *  - `start(port)` — begins listening; resolves with the Node http.Server
 *  - `stop()` — closes the DB and server
 */
export function createEvalServer(repoPath, _port) {
    const dbPath = `${repoPath}/.monomind/monograph.db`;
    const db = openDb(dbPath);
    let server = null;
    // Lazy-import express to keep startup fast
    let _app = null;
    function getApp() {
        if (_app)
            return _app;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const express = require('express');
        const app = express();
        app.use(express.json());
        // GET /health
        app.get('/health', (_req, res) => {
            try {
                const stats = queryStats(db);
                res.json({ status: 'ok', nodeCount: stats.nodeCount, edgeCount: stats.edgeCount });
            }
            catch {
                res.status(500).json({ status: 'error' });
            }
        });
        // POST /query — text search returning MonographNode[]
        app.post('/query', (req, res) => {
            try {
                const q = req.body.q ?? '';
                const limit = req.body.limit ?? 20;
                const results = q.trim() ? querySearch(db, q).slice(0, limit) : [];
                res.json({ results });
            }
            catch (err) {
                res.status(500).json({ error: String(err) });
            }
        });
        // POST /search — hybrid BM25+vector search returning SearchResult[]
        app.post('/search', async (req, res) => {
            try {
                const query = req.body.query ?? '';
                const limit = req.body.limit ?? 20;
                const results = query.trim()
                    ? await hybridQuery(db, query, { limit })
                    : [];
                res.json({ results });
            }
            catch (err) {
                res.status(500).json({ error: String(err) });
            }
        });
        _app = app;
        return app;
    }
    return {
        get app() {
            return getApp();
        },
        start(port) {
            const app = getApp();
            return new Promise((resolve, reject) => {
                const s = app.listen(port, '127.0.0.1', () => resolve(s));
                s.on('error', reject);
                server = s;
            });
        },
        stop() {
            if (server) {
                server.close();
                server = null;
            }
            closeDb(db);
        },
    };
}
//# sourceMappingURL=eval-server.js.map