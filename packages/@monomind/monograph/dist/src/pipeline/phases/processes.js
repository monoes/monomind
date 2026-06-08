import { basename, extname } from 'path';
import { makeId, toNormLabel } from '../../types.js';
import { insertNodes } from '../../storage/node-store.js';
import { insertEdges } from '../../storage/edge-store.js';
// ── Entry-point file names that boost score ───────────────────────────────────
const ENTRY_FILENAMES = new Set(['index', 'main', 'cli', 'server', 'app', 'cmd']);
// ── BFS call-chain traversal ──────────────────────────────────────────────────
function bfsCallChain(startNodeId, db, maxDepth = 8) {
    const visited = new Set([startNodeId]);
    const queue = [{ id: startNodeId, depth: 0 }];
    const calleesStmt = db.prepare(`
    SELECT target_id FROM edges WHERE source_id = ? AND relation = 'CALLS'
  `);
    while (queue.length > 0) {
        const item = queue.shift();
        if (item.depth >= maxDepth)
            continue;
        const callees = calleesStmt.all(item.id);
        for (const { target_id } of callees) {
            if (!visited.has(target_id)) {
                visited.add(target_id);
                queue.push({ id: target_id, depth: item.depth + 1 });
            }
        }
    }
    return visited;
}
function scoreEntryPoints(db) {
    const symbolRows = db
        .prepare(`SELECT id, name, file_path, is_exported, language
       FROM nodes
       WHERE label IN ('Function', 'Method', 'Class')`)
        .all();
    const incomingCallsStmt = db.prepare(`SELECT COUNT(*) as cnt FROM edges WHERE target_id = ? AND relation = 'CALLS'`);
    const isRouteHandlerStmt = db.prepare(`SELECT COUNT(*) as cnt FROM edges WHERE target_id = ? AND relation = 'HANDLES_ROUTE'`);
    const isToolHandlerStmt = db.prepare(`SELECT COUNT(*) as cnt FROM edges WHERE target_id = ? AND relation = 'HANDLES_TOOL'`);
    const scored = [];
    for (const row of symbolRows) {
        let score = 0;
        const incomingCalls = incomingCallsStmt.get(row.id).cnt;
        if (incomingCalls === 0)
            score += 3;
        if (row.is_exported === 1)
            score += 2;
        const isRouteHandler = isRouteHandlerStmt.get(row.id).cnt > 0;
        if (isRouteHandler)
            score += 4;
        const isToolHandler = isToolHandlerStmt.get(row.id).cnt > 0;
        if (isToolHandler)
            score += 4;
        const filePath = row.file_path ?? '';
        const filename = basename(filePath, extname(filePath)).toLowerCase();
        if (ENTRY_FILENAMES.has(filename))
            score += 2;
        if (score >= 3) {
            scored.push({
                id: row.id,
                name: row.name,
                filePath: filePath,
                language: row.language ?? 'unknown',
                score,
            });
        }
    }
    // Sort by descending score so highest-priority entry points are processed first
    return scored.sort((a, b) => b.score - a.score);
}
// ── Phase ─────────────────────────────────────────────────────────────────────
export const processesPhase = {
    name: 'processes',
    deps: ['communities', 'routes', 'tools', 'structure'],
    async execute(ctx, _deps) {
        if (!ctx.db) {
            return {
                processResult: {
                    processes: [],
                    memberships: new Map(),
                    stats: { totalProcesses: 0, totalSteps: 0 },
                },
            };
        }
        const db = ctx.db;
        // Determine how many processes to create based on symbol count
        const symbolCountRow = db
            .prepare(`SELECT COUNT(*) as cnt FROM nodes WHERE label NOT IN ('File', 'Folder', 'Community', 'Process', 'Document')`)
            .get();
        const symbolCount = symbolCountRow.cnt;
        const maxProcesses = Math.max(20, Math.min(300, Math.ceil(symbolCount / 10)));
        // Score and collect candidate entry points
        const candidates = scoreEntryPoints(db);
        const limitedCandidates = candidates.slice(0, maxProcesses);
        const processNodes = [];
        const processEdges = [];
        const processDefs = [];
        const memberships = new Map();
        let totalSteps = 0;
        // Track which nodes are already claimed as an entry point of a process
        // to avoid creating duplicate processes for the same entry node
        const claimedEntries = new Set();
        for (const entry of limitedCandidates) {
            if (claimedEntries.has(entry.id))
                continue;
            claimedEntries.add(entry.id);
            const processNodeId = makeId('process', entry.id);
            const stepNodeIds = bfsCallChain(entry.id, db);
            const processNode = {
                id: processNodeId,
                label: 'Process',
                name: entry.name,
                normLabel: toNormLabel(entry.name),
                filePath: entry.filePath,
                language: entry.language,
                startLine: 0,
                endLine: 0,
                isExported: false,
                properties: { stepCount: stepNodeIds.size },
            };
            processNodes.push(processNode);
            // ENTRY_POINT_OF: entry symbol → process
            processEdges.push({
                id: makeId(entry.id, processNodeId, 'entry_point_of'),
                sourceId: entry.id,
                targetId: processNodeId,
                relation: 'ENTRY_POINT_OF',
                confidence: 'EXTRACTED',
                confidenceScore: 0.9,
            });
            // STEP_IN_PROCESS: process → each step symbol (including entry)
            for (const stepNodeId of stepNodeIds) {
                processEdges.push({
                    id: makeId(processNodeId, stepNodeId, 'step_in_process'),
                    sourceId: processNodeId,
                    targetId: stepNodeId,
                    relation: 'STEP_IN_PROCESS',
                    confidence: 'EXTRACTED',
                    confidenceScore: 0.85,
                });
                memberships.set(stepNodeId, processNodeId);
            }
            totalSteps += stepNodeIds.size;
            processDefs.push({
                id: processNodeId,
                name: entry.name,
                filePath: entry.filePath,
                entryNodeId: entry.id,
                stepCount: stepNodeIds.size,
            });
        }
        insertNodes(db, processNodes);
        insertEdges(db, processEdges);
        return {
            processResult: {
                processes: processDefs,
                memberships,
                stats: {
                    totalProcesses: processDefs.length,
                    totalSteps,
                },
            },
        };
    },
};
//# sourceMappingURL=processes.js.map