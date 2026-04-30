export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: (uri: string) => Promise<{ content: string }>;
}

import { openDb, closeDb } from '../storage/db.js';
import { countNodes } from '../storage/node-store.js';
import { countEdges } from '../storage/edge-store.js';
import { join } from 'path';

function getDbPath(): string {
  const base = process.env.MONOMIND_CWD ?? process.cwd();
  return join(base, '.monomind', 'monograph.db');
}

export const monographResources: MCPResource[] = [
  {
    uri: 'monograph://repo/{name}/context',
    name: 'Monograph Repo Context',
    description: 'Full graph context summary for the indexed repository',
    mimeType: 'application/json',
    handler: async (_uri) => {
      const db = openDb(getDbPath());
      try {
        const nodes = countNodes(db);
        const edges = countEdges(db);
        const meta = db.prepare('SELECT key, value FROM index_meta').all() as { key: string; value: string }[];
        return { content: JSON.stringify({ nodes, edges, meta }, null, 2) };
      } finally { closeDb(db); }
    },
  },
  {
    uri: 'monograph://repo/{name}/clusters',
    name: 'Monograph Community Clusters',
    description: 'Community cluster summary with sizes and labels',
    mimeType: 'application/json',
    handler: async (_uri) => {
      const db = openDb(getDbPath());
      try {
        const communities = db.prepare('SELECT * FROM communities ORDER BY size DESC').all();
        return { content: JSON.stringify(communities, null, 2) };
      } finally { closeDb(db); }
    },
  },
  {
    uri: 'monograph://repo/{name}/processes',
    name: 'Monograph Process Map',
    description: 'Process detection results (populated in Sub-project 3)',
    mimeType: 'application/json',
    handler: async (_uri) => ({ content: JSON.stringify({ note: 'Process detection available in Sub-project 3' }) }),
  },
  {
    uri: 'monograph://repo/{name}/schema',
    name: 'Monograph Schema',
    description: 'Node label and edge relation types present in this repo',
    mimeType: 'application/json',
    handler: async (_uri) => {
      const db = openDb(getDbPath());
      try {
        const labels = db.prepare('SELECT DISTINCT label, COUNT(*) as count FROM nodes GROUP BY label ORDER BY count DESC').all();
        const relations = db.prepare('SELECT DISTINCT relation, COUNT(*) as count FROM edges GROUP BY relation ORDER BY count DESC').all();
        return { content: JSON.stringify({ nodeLabels: labels, edgeRelations: relations }, null, 2) };
      } finally { closeDb(db); }
    },
  },
];
