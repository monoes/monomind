#!/usr/bin/env node
/**
 * ua-import.mjs — Option A
 *
 * Imports an Understand-Anything graph.json into a monograph SQLite database.
 *
 * Usage:
 *   node scripts/ua-import.mjs <graph.json> [<monograph.db>]
 *
 * If <monograph.db> is omitted it defaults to .monomind/monograph.db in the
 * current working directory.  The script merges (upserts) UA data so it can be
 * re-run after incremental UA analyses without duplicating rows.
 *
 * Mapping:
 *   UA GraphNode  → monograph nodes  (summary + tags stored in properties)
 *   UA GraphEdge  → monograph edges  (type → relation, weight → weight)
 *   UA Layer      → monograph communities  (id → community_id on nodes)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const CWD   = process.cwd();

// ── Resolve better-sqlite3 via pnpm virtual store ───────────────────────────
function requireBetterSqlite() {
  const require = createRequire(import.meta.url);
  const candidates = [
    join(CWD, 'node_modules/.pnpm/node_modules/@monoes/monograph'),
    join(CWD, 'packages/node_modules/.pnpm/node_modules/@monoes/monograph'),
    join(CWD, 'node_modules/@monoes/monograph'),
  ];
  for (const c of candidates) {
    try { if (existsSync(c)) return require(c); } catch {}
  }
  try { return require('@monoes/monograph'); } catch {}
  throw new Error('Cannot find @monoes/monograph — run pnpm install from the monobrain root');
}

// ── CLI args ────────────────────────────────────────────────────────────────
const [,, graphJsonPath, dbPathArg] = process.argv;
if (!graphJsonPath) {
  console.error('Usage: node scripts/ua-import.mjs <graph.json> [<monograph.db>]');
  process.exit(1);
}
const graphPath = resolve(graphJsonPath);
const dbPath    = resolve(dbPathArg || join(CWD, '.monomind', 'monograph.db'));

if (!existsSync(graphPath)) { console.error('graph.json not found:', graphPath); process.exit(1); }
if (!existsSync(dbPath))    { console.error('monograph.db not found:', dbPath, '— build the graph first'); process.exit(1); }

// ── Load graph.json ─────────────────────────────────────────────────────────
console.log('Reading', graphPath);
const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
const { nodes: uaNodes = [], edges: uaEdges = [], layers = [] } = graph;
console.log(`UA graph: ${uaNodes.length} nodes, ${uaEdges.length} edges, ${layers.length} layers`);

// ── Open monograph DB ───────────────────────────────────────────────────────
const mg = requireBetterSqlite();
const db = mg.openDb(dbPath);

// ── Ensure communities table exists ─────────────────────────────────────────
db.prepare(`CREATE TABLE IF NOT EXISTS communities (
  id INTEGER PRIMARY KEY,
  label TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  cohesion_score REAL NOT NULL DEFAULT 0.0
)`).run();

try { db.prepare(`ALTER TABLE nodes ADD COLUMN properties TEXT`).run(); } catch { /* column already exists */ }

// ── Build layer → community_id map ──────────────────────────────────────────
// Layers from UA become communities in monograph.
// Layer IDs look like "layer:api" — we assign sequential integers.
const layerIdToInt = new Map();
let communityIdx = 1000; // start high to avoid colliding with existing graph-algo communities

const upsertCommunity = db.prepare(
  `INSERT INTO communities (id, label, size, cohesion_score)
   VALUES (?, ?, ?, 0.8)
   ON CONFLICT(id) DO UPDATE SET label=excluded.label, size=excluded.size`
);

for (const layer of layers) {
  layerIdToInt.set(layer.id, communityIdx);
  upsertCommunity.run(communityIdx, layer.name, layer.nodeIds?.length ?? 0);
  communityIdx++;
}
console.log(`Mapped ${layerIdToInt.size} UA layers → monograph communities`);

// ── Map UA NodeType → monograph NodeLabel ────────────────────────────────────
const TYPE_TO_LABEL = {
  file:      'File',
  function:  'Function',
  class:     'Class',
  module:    'Module',
  concept:   'Concept',
  config:    'File',       // closest monograph label
  document:  'File',
  service:   'Module',
  table:     'Concept',    // DB table — store kind in properties
  endpoint:  'Route',
  pipeline:  'Process',
  schema:    'Concept',
  resource:  'Concept',
  domain:    'Concept',
  flow:      'Process',
  step:      'Section',
  article:   'Section',
  entity:    'Concept',
  topic:     'Concept',
  claim:     'Concept',
  source:    'File',
};

// ── Map UA EdgeType → monograph EdgeRelation ─────────────────────────────────
const EDGE_TO_RELATION = {
  imports:           'IMPORTS',
  exports:           'DEFINES',
  contains:          'CONTAINS',
  inherits:          'EXTENDS',
  implements:        'IMPLEMENTS',
  calls:             'CALLS',
  subscribes:        'REFERENCES',
  publishes:         'REFERENCES',
  middleware:        'WRAPS',
  reads_from:        'FETCHES',
  writes_to:         'ACCESSES',
  transforms:        'USES',
  validates:         'USES',
  depends_on:        'IMPORTS',
  tested_by:         'REFERENCES',
  configures:        'REFERENCES',
  related:           'RELATED_TO',
  similar_to:        'RELATED_TO',
  deploys:           'REFERENCES',
  serves:            'REFERENCES',
  provisions:        'REFERENCES',
  triggers:          'REFERENCES',
  migrates:          'REFERENCES',
  documents:         'DESCRIBES',
  routes:            'HANDLES_ROUTE',
  defines_schema:    'DEFINES',
  contains_flow:     'CONTAINS',
  flow_step:         'STEP_IN_PROCESS',
  cross_domain:      'RELATED_TO',
  cites:             'REFERENCES',
  contradicts:       'CONTRASTS_WITH',
  builds_on:         'PART_OF',
  exemplifies:       'DESCRIBES',
  categorized_under: 'PART_OF',
  authored_by:       'REFERENCES',
};

// ── Build nodeId lookup: UA node ids may differ from monograph ids ────────────
// UA uses "file:src/foo.ts", "function:src/foo.ts:bar" etc.
// We'll upsert UA nodes as new rows, using the UA id directly (prefixed with "ua:").
// For nodes that already exist in monograph (matched by file_path + name), we
// update their community_id and properties with UA data rather than duplicating.

const findByFilePath = db.prepare(
  `SELECT id FROM nodes WHERE file_path = ? AND name = ? LIMIT 1`
);
const findByName = db.prepare(
  `SELECT id FROM nodes WHERE name = ? AND label = ? LIMIT 1`
);
const updateNodeEnrichment = db.prepare(
  `UPDATE nodes SET community_id = ?, properties = ? WHERE id = ?`
);
const upsertNode = db.prepare(
  `INSERT INTO nodes (id, label, name, norm_label, file_path, start_line, end_line, community_id, is_exported, language, properties)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     community_id = excluded.community_id,
     properties   = excluded.properties`
);

// Build a reverse map: UA node id → monograph node id (for edge mapping)
const uaToMgId = new Map();

// Build layer node membership map first
const nodeLayerMap = new Map(); // UA node id → layer id
for (const layer of layers) {
  for (const nid of (layer.nodeIds || [])) {
    nodeLayerMap.set(nid, layer.id);
  }
}

let enriched = 0, inserted = 0;
const insertMany = db.transaction((nodes) => {
  for (const uaNode of nodes) {
    const label      = TYPE_TO_LABEL[uaNode.type] || 'Concept';
    const layerId    = nodeLayerMap.get(uaNode.id);
    const communityId = layerId ? layerIdToInt.get(layerId) ?? null : null;
    const properties = JSON.stringify({
      ua_type:       uaNode.type,
      summary:       uaNode.summary || '',
      tags:          uaNode.tags || [],
      complexity:    uaNode.complexity || '',
      languageNotes: uaNode.languageNotes || '',
      domainMeta:    uaNode.domainMeta || null,
      knowledgeMeta: uaNode.knowledgeMeta || null,
    });

    // Try to match existing monograph node
    let existingId = null;
    if (uaNode.filePath) {
      const row = findByFilePath.get(uaNode.filePath, uaNode.name);
      if (row) existingId = row.id;
    }
    if (!existingId) {
      const row = findByName.get(uaNode.name, label);
      if (row) existingId = row.id;
    }

    if (existingId) {
      updateNodeEnrichment.run(communityId, properties, existingId);
      uaToMgId.set(uaNode.id, existingId);
      enriched++;
    } else {
      // Insert as new node with "ua:" prefix to avoid id collision
      const newId = 'ua:' + uaNode.id;
      const normLabel = (uaNode.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
      const lang = uaNode.filePath
        ? uaNode.filePath.split('.').pop() || null
        : null;
      upsertNode.run(
        newId, label, uaNode.name || uaNode.id, normLabel,
        uaNode.filePath || null,
        uaNode.lineRange?.[0] ?? null,
        uaNode.lineRange?.[1] ?? null,
        communityId, lang, properties
      );
      uaToMgId.set(uaNode.id, newId);
      inserted++;
    }
  }
});
insertMany(uaNodes);
console.log(`Nodes: ${enriched} enriched existing, ${inserted} new inserted`);

// ── Upsert edges ─────────────────────────────────────────────────────────────
const upsertEdge = db.prepare(
  `INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score, weight)
   VALUES (?, ?, ?, ?, 'INFERRED', 0.5, ?)
   ON CONFLICT(id) DO UPDATE SET
     relation         = excluded.relation,
     confidence_score = excluded.confidence_score,
     weight           = excluded.weight`
);

let edgesInserted = 0, edgesSkipped = 0;
const insertEdges = db.transaction((edges) => {
  for (const e of edges) {
    const srcId = uaToMgId.get(e.source);
    const tgtId = uaToMgId.get(e.target);
    if (!srcId || !tgtId) { edgesSkipped++; continue; }
    const relation = EDGE_TO_RELATION[e.type] || 'RELATED_TO';
    const edgeId = 'ua:' + e.source + ':' + e.type + ':' + e.target;
    upsertEdge.run(edgeId, srcId, tgtId, relation, e.weight ?? 0.5);
    edgesInserted++;
  }
});
insertEdges(uaEdges);
console.log(`Edges: ${edgesInserted} upserted, ${edgesSkipped} skipped (unresolved node refs)`);

// ── Rebuild FTS index ─────────────────────────────────────────────────────────
try {
  db.prepare(`INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')`).run();
  console.log('FTS index rebuilt');
} catch { /* may not exist — safe to ignore */ }

// ── Update index_meta ─────────────────────────────────────────────────────────
db.prepare(
  `INSERT INTO index_meta (key, value) VALUES ('ua_import_at', ?)
   ON CONFLICT(key) DO UPDATE SET value=excluded.value`
).run(new Date().toISOString());

mg.closeDb(db);

console.log('\n✓ Import complete');
console.log(`  DB: ${dbPath}`);
console.log(`  Communities from UA layers: ${layerIdToInt.size}`);
console.log(`  Nodes enriched: ${enriched}, inserted: ${inserted}`);
console.log(`  Edges: ${edgesInserted} added`);
