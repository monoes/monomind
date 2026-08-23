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

import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import type { Application } from 'express';
import type { BM25Result } from '../search/hybrid-query.js';
import { bm25Query } from '../search/hybrid-query.js';
import { closeDb, openDb } from '../storage/db.js';
import type { ApiNode } from '../web/api.js';
import { querySearch, queryStats } from '../web/api.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EvalServerHandle {
  app: Application;
  start(port: number): Promise<Server>;
  stop(): void;
}

export type SearchResult = BM25Result;

// ── createEvalServer ──────────────────────────────────────────────────────────

/**
 * Create an eval server for a monograph DB at the given repo path.
 *
 * Returns an object with:
 *  - `app` — Express application (useful for supertest)
 *  - `start(port)` — begins listening; resolves with the Node http.Server
 *  - `stop()` — closes the DB and server
 */
export function createEvalServer(repoPath: string, _port?: number): EvalServerHandle {
  const dbPath = `${repoPath}/.monomind/monograph.db`;
  const db = openDb(dbPath);

  let server: Server | null = null;

  // Lazy-import express to keep startup fast
  let _app: Application | null = null;

  function getApp(): Application {
    if (_app) return _app;

    // createRequire, not a bare require(): this package is ESM
    // ("type": "module"), where `require` is undefined at runtime — the
    // eslint-disable that used to sit here silenced the lint but the call
    // still threw "require is not defined" the moment getApp() ran.
    // getApp() is synchronous, so `await import()` is not an option; this is
    // the correct ESM escape hatch for a deliberately deferred load.
    const require = createRequire(import.meta.url);
    const express = require('express') as typeof import('express');
    const app = express();
    app.use(express.json());

    // GET /health
    app.get('/health', (_req, res) => {
      try {
        const stats = queryStats(db);
        res.json({ status: 'ok', nodeCount: stats.nodeCount, edgeCount: stats.edgeCount });
      } catch {
        res.status(500).json({ status: 'error' });
      }
    });

    // POST /query — text search returning MonographNode[]
    app.post('/query', (req, res) => {
      try {
        const q: string = (req.body as { q?: string }).q ?? '';
        const limit: number = (req.body as { limit?: number }).limit ?? 20;
        const results: ApiNode[] = q.trim() ? querySearch(db, q).slice(0, limit) : [];
        res.json({ results });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // POST /search — BM25 search returning SearchResult[]
    app.post('/search', async (req, res) => {
      try {
        const query: string = (req.body as { query?: string }).query ?? '';
        const limit: number = (req.body as { limit?: number }).limit ?? 20;
        const results: BM25Result[] = query.trim() ? await bm25Query(db, query, { limit }) : [];
        res.json({ results });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    _app = app;
    return app;
  }

  return {
    get app(): Application {
      return getApp();
    },

    start(port: number): Promise<Server> {
      const app = getApp();
      return new Promise((resolve, reject) => {
        const s = app.listen(port, '127.0.0.1', () => resolve(s));
        s.on('error', reject);
        server = s;
      });
    },

    stop(): void {
      if (server) {
        server.close();
        server = null;
      }
      closeDb(db);
    },
  };
}
