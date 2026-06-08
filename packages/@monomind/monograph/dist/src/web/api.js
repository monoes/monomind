import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ftsSearch } from '../storage/fts-store.js';
import { globalJobRegistry } from './async-jobs.js';
// ── Query helpers (testable in isolation) ─────────────────────────────────────
export function rowToApiNode(row) {
    return {
        id: row['id'],
        name: row['name'],
        label: row['label'],
        filePath: row['file_path'] ?? null,
        startLine: row['start_line'] ?? null,
        endLine: row['end_line'] ?? null,
        communityId: row['community_id'] ?? null,
    };
}
export function queryGraphData(db) {
    const nodeRows = db
        .prepare('SELECT id, name, label, file_path, start_line, end_line, community_id FROM nodes LIMIT 2000')
        .all();
    const nodes = nodeRows.map(rowToApiNode);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = [];
    if (nodeIds.size > 0) {
        // Use a subquery instead of IN(?,...) to avoid SQLite's SQLITE_MAX_VARIABLE_NUMBER limit
        const edgeRows = db
            .prepare(`SELECT e.source_id, e.target_id, e.relation, e.confidence_score
         FROM edges e
         JOIN (SELECT id FROM nodes LIMIT 2000) n ON e.source_id = n.id
         LIMIT 10000`)
            .all();
        for (const r of edgeRows) {
            edges.push({
                sourceId: r['source_id'],
                targetId: r['target_id'],
                relation: r['relation'],
                confidenceScore: r['confidence_score'],
            });
        }
    }
    const communities = {};
    for (const node of nodes) {
        if (node.communityId != null) {
            const key = String(node.communityId);
            if (!communities[key])
                communities[key] = [];
            communities[key].push(node.id);
        }
    }
    return { nodes, edges, communities };
}
export function queryNode(db, id) {
    const nodeRow = db
        .prepare('SELECT id, name, label, file_path, start_line, end_line, community_id FROM nodes WHERE id = ?')
        .get(id);
    if (!nodeRow)
        return { node: null, callers: [], callees: [] };
    const node = rowToApiNode(nodeRow);
    const callerRows = db
        .prepare(`SELECT n.id, n.name, n.label, n.file_path, n.start_line, n.end_line, n.community_id
       FROM nodes n JOIN edges e ON n.id = e.source_id
       WHERE e.target_id = ? AND e.relation = 'CALLS' LIMIT 20`)
        .all(id);
    const calleeRows = db
        .prepare(`SELECT n.id, n.name, n.label, n.file_path, n.start_line, n.end_line, n.community_id
       FROM nodes n JOIN edges e ON n.id = e.target_id
       WHERE e.source_id = ? AND e.relation = 'CALLS' LIMIT 20`)
        .all(id);
    return {
        node,
        callers: callerRows.map(rowToApiNode),
        callees: calleeRows.map(rowToApiNode),
    };
}
export function querySearch(db, q) {
    const results = ftsSearch(db, q, 10);
    return results.map((r) => ({
        id: r.id,
        name: r.name,
        label: r.label,
        filePath: r.filePath,
        startLine: null,
        endLine: null,
        communityId: null,
    }));
}
export function queryStats(db) {
    const nodeCount = db.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
    const edgeCount = db.prepare('SELECT COUNT(*) as c FROM edges').get().c;
    const communityCount = db.prepare('SELECT COUNT(DISTINCT community_id) as c FROM nodes WHERE community_id IS NOT NULL').get().c;
    const metaRow = db
        .prepare("SELECT value FROM index_meta WHERE key = 'indexed_at'")
        .get();
    return {
        nodeCount,
        edgeCount,
        communityCount,
        buildAt: metaRow?.value ?? null,
    };
}
export function queryGrep(db, pattern, caseSensitive) {
    const sql = caseSensitive
        ? `SELECT id, name, label, file_path, start_line FROM nodes WHERE name GLOB ? LIMIT 100`
        : `SELECT id, name, label, file_path, start_line FROM nodes WHERE name LIKE ? LIMIT 100`;
    const param = caseSensitive ? `*${pattern}*` : `%${pattern}%`;
    const rows = db.prepare(sql).all(param);
    return rows.map(r => ({
        id: r['id'],
        name: r['name'],
        label: r['label'],
        filePath: r['file_path'] ?? null,
        startLine: r['start_line'] ?? null,
    }));
}
export function readFileContent(filePath, startLine, endLine) {
    const raw = readFileSync(filePath, 'utf8');
    const allLines = raw.split('\n');
    // Remove trailing empty line from split
    if (allLines.length > 0 && allLines[allLines.length - 1] === '')
        allLines.pop();
    const start = startLine ?? 1;
    const end = endLine ?? allLines.length;
    const lines = [];
    for (let i = start - 1; i < end && i < allLines.length; i++) {
        lines.push({ number: i + 1, content: allLines[i] });
    }
    return { path: filePath, totalLines: allLines.length, lines };
}
export function queryClusters(db) {
    try {
        const rows = db.prepare(`SELECT c.id, c.label, COUNT(n.id) as memberCount
       FROM communities c LEFT JOIN nodes n ON n.community_id = c.id
       GROUP BY c.id ORDER BY memberCount DESC`).all();
        return rows;
    }
    catch {
        const rows = db.prepare(`SELECT community_id as id, COUNT(*) as memberCount FROM nodes WHERE community_id IS NOT NULL GROUP BY community_id ORDER BY memberCount DESC`).all();
        return rows.map(r => ({ id: r.id, label: null, memberCount: r.memberCount }));
    }
}
export function queryCluster(db, name) {
    try {
        const comm = db.prepare('SELECT id, label FROM communities WHERE label = ? LIMIT 1').get(name);
        if (!comm)
            return null;
        const members = db.prepare('SELECT id, name, label, file_path, start_line, end_line, community_id FROM nodes WHERE community_id = ? LIMIT 200').all(comm.id);
        return { id: comm.id, label: comm.label, members: members.map(rowToApiNode) };
    }
    catch (err) {
        const msg = String(err);
        if (!msg.includes('no such table'))
            throw err;
        return null;
    }
}
export function queryProcessesList(db) {
    const rows = db.prepare(`SELECT id, name, file_path FROM nodes WHERE label = 'Process' LIMIT 200`).all();
    return rows.map(r => ({ id: r.id, name: r.name, filePath: r.file_path }));
}
export function queryProcess(db, name) {
    const row = db.prepare(`SELECT id, name, label, file_path, start_line, end_line, community_id FROM nodes WHERE label = 'Process' AND name = ? LIMIT 1`).get(name);
    return row ?? null;
}
export function getServerInfo() {
    return {
        name: 'monograph',
        version: '1.0.0',
        nodeVersion: process.version,
        uptimeSeconds: process.uptime(),
    };
}
// ── Streaming graph export ────────────────────────────────────────────────────
export async function streamGraph(db, onRecord) {
    const nodeRows = db.prepare('SELECT id, name, label, file_path, start_line, end_line, community_id FROM nodes').all();
    for (const row of nodeRows) {
        onRecord({ type: 'node', ...rowToApiNode(row) });
    }
    const edgeRows = db.prepare('SELECT source_id, target_id, relation, confidence_score FROM edges').all();
    for (const row of edgeRows) {
        onRecord({
            type: 'edge',
            sourceId: row['source_id'],
            targetId: row['target_id'],
            relation: row['relation'],
            confidenceScore: row['confidence_score'],
        });
    }
}
// ── Route setup ───────────────────────────────────────────────────────────────
export function setupApiRoutes(app, db) {
    app.get('/api/graph', (req, res) => {
        try {
            if (req.query['stream'] === 'true') {
                res.setHeader('Content-Type', 'application/x-ndjson');
                streamGraph(db, (record) => {
                    res.write(JSON.stringify(record) + '\n');
                }).then(() => res.end()).catch(() => res.end());
                return;
            }
            res.json(queryGraphData(db));
        }
        catch (err) {
            console.error('[api error]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    app.get('/api/nodes/:id', (req, res) => {
        try {
            const detail = queryNode(db, req.params['id'] ?? '');
            if (!detail.node) {
                res.status(404).json({ error: 'Node not found' });
                return;
            }
            res.json(detail);
        }
        catch (err) {
            console.error('[api error]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    app.get('/api/search', (req, res) => {
        try {
            const q = req.query['q'] ?? '';
            if (!q.trim()) {
                res.json([]);
                return;
            }
            res.json(querySearch(db, q));
        }
        catch (err) {
            console.error('[api error]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    app.get('/api/stats', (_req, res) => {
        try {
            res.json(queryStats(db));
        }
        catch (err) {
            console.error('[api error]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    app.get('/api/file', (req, res) => {
        try {
            const filePath = req.query['path'] ?? '';
            if (!filePath) {
                res.status(400).json({ error: 'path query param required' });
                return;
            }
            // Only serve files that are indexed in the graph DB to prevent arbitrary file read.
            const resolvedPath = resolve(filePath);
            const tracked = db.prepare('SELECT 1 FROM nodes WHERE file_path = ? LIMIT 1').get(resolvedPath);
            if (!tracked) {
                // Also accept the path as stored (may be relative or use different separators)
                const trackedRelative = db.prepare('SELECT 1 FROM nodes WHERE file_path = ? LIMIT 1').get(filePath);
                if (!trackedRelative) {
                    res.status(403).json({ error: 'File not indexed in graph' });
                    return;
                }
            }
            const startLine = req.query['start'] ? parseInt(req.query['start'], 10) : undefined;
            const endLine = req.query['end'] ? parseInt(req.query['end'], 10) : undefined;
            if (startLine !== undefined && isNaN(startLine)) {
                res.status(400).json({ error: 'start must be a positive integer' });
                return;
            }
            if (endLine !== undefined && isNaN(endLine)) {
                res.status(400).json({ error: 'end must be a positive integer' });
                return;
            }
            res.json(readFileContent(resolvedPath, startLine, endLine));
        }
        catch (err) {
            console.error('[api/file]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    // Async analyze job API
    app.post('/api/analyze', (req, res) => {
        const { repoPath } = req.body;
        if (!repoPath) {
            res.status(400).json({ error: 'repoPath is required' });
            return;
        }
        const job = globalJobRegistry.create('analyze', { repoPath });
        globalJobRegistry.update(job.id, { status: 'running' });
        setImmediate(() => {
            globalJobRegistry.update(job.id, { status: 'done', result: { message: 'ok' } });
        });
        res.status(202).json({ jobId: job.id });
    });
    app.get('/api/jobs/:id', (req, res) => {
        const job = globalJobRegistry.get(req.params['id'] ?? '');
        if (!job) {
            res.status(404).json({ error: 'Job not found' });
            return;
        }
        res.json(job);
    });
    app.delete('/api/jobs/:id', (req, res) => {
        const ok = globalJobRegistry.cancel(req.params['id'] ?? '');
        if (!ok) {
            res.status(404).json({ error: 'Job not found' });
            return;
        }
        res.json({ cancelled: true });
    });
    app.get('/api/grep', (req, res) => {
        try {
            const pattern = req.query['q'] ?? '';
            const caseSensitive = req.query['case'] === 'true';
            res.json(queryGrep(db, pattern, caseSensitive));
        }
        catch (err) {
            console.error('[api error]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    // SSE progress stream for a job
    app.get('/api/jobs/:id/progress', (req, res) => {
        const jobId = req.params['id'] ?? '';
        const job = globalJobRegistry.get(jobId);
        if (!job) {
            res.status(404).json({ error: 'Job not found' });
            return;
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        // Send existing progress events
        for (const evt of globalJobRegistry.getProgress(jobId)) {
            res.write(`data: ${JSON.stringify(evt)}\n\n`);
        }
        // Poll for new events until job is done
        let lastSent = globalJobRegistry.getProgress(jobId).length;
        const interval = setInterval(() => {
            const current = globalJobRegistry.get(jobId);
            if (!current) {
                clearInterval(interval);
                res.end();
                return;
            }
            const all = globalJobRegistry.getProgress(jobId);
            for (let i = lastSent; i < all.length; i++) {
                res.write(`data: ${JSON.stringify(all[i])}\n\n`);
            }
            lastSent = all.length;
            if (current.status === 'done' || current.status === 'failed' || current.status === 'cancelled') {
                res.write(`data: ${JSON.stringify({ phase: 'complete', status: current.status })}\n\n`);
                clearInterval(interval);
                res.end();
            }
        }, 500);
        req.on('close', () => clearInterval(interval));
    });
    app.get('/api/clusters', (_req, res) => {
        try {
            res.json(queryClusters(db));
        }
        catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });
    app.get('/api/cluster', (req, res) => {
        try {
            const name = req.query['name'] ?? '';
            if (!name) {
                res.status(400).json({ error: 'name required' });
                return;
            }
            const result = queryCluster(db, name);
            if (!result) {
                res.status(404).json({ error: 'Cluster not found' });
                return;
            }
            res.json(result);
        }
        catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });
    app.get('/api/processes', (_req, res) => {
        try {
            res.json(queryProcessesList(db));
        }
        catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });
    app.get('/api/process', (req, res) => {
        try {
            const name = req.query['name'] ?? '';
            if (!name) {
                res.status(400).json({ error: 'name required' });
                return;
            }
            const result = queryProcess(db, name);
            if (!result) {
                res.status(404).json({ error: 'Process not found' });
                return;
            }
            res.json(result);
        }
        catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });
    app.get('/api/info', (_req, res) => {
        res.json(getServerInfo());
    });
    app.get('/api/heartbeat', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        const interval = setInterval(() => {
            res.write(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`);
        }, 15000);
        // Send immediate heartbeat
        res.write(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`);
        req.on('close', () => clearInterval(interval));
    });
}
//# sourceMappingURL=api.js.map