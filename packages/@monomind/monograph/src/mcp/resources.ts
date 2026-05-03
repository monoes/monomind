export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: (uri: string) => Promise<{ content: string }>;
}

export interface MCPToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

import { openDb, closeDb } from '../storage/db.js';
import { countNodes, listProperties, queryByProperty } from '../storage/node-store.js';
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

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

export const monographTools: MCPToolDef[] = [
  {
    name: 'monograph_list_properties',
    description: 'List all registered typed property definitions in the node property registry, including their types, cardinalities, view contexts, and queryability.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const db = openDb(getDbPath());
      try {
        const props = listProperties(db);
        return text(JSON.stringify(props, null, 2));
      } finally { closeDb(db); }
    },
  },
  {
    name: 'monograph_query_by_property',
    description: 'Query nodes by a typed metadata property (layer, ua_type, complexity, tags, etc). Returns nodes whose JSON properties contain the given value for the named property.',
    inputSchema: {
      type: 'object',
      properties: {
        ident: { type: 'string', description: 'Property identifier (e.g. layer, ua_type, complexity, tags, language)' },
        value: { type: 'string', description: 'Value to match against the property' },
        comparator: { type: 'string', enum: ['=', 'LIKE', '>', '<'], description: 'Comparison operator (default =)' },
        limit: { type: 'number', description: 'Max results to return (default 100)' },
      },
      required: ['ident', 'value'],
    },
    handler: async (input) => {
      const db = openDb(getDbPath());
      try {
        const ident = input.ident as string;
        const value = input.value as string;
        const comparator = (input.comparator as '=' | 'LIKE' | '>' | '<' | undefined) ?? '=';
        const limit = (input.limit as number | undefined) ?? 100;
        const results = queryByProperty(db, ident, value, comparator, limit);
        if (results.length === 0) return text('No nodes found matching the given property value.');
        const lines = results.map(r =>
          `[${r.label}] ${r.name}  ${r.filePath ?? ''}  (${ident}=${JSON.stringify(r.propertyValue)})`,
        );
        return text(lines.join('\n'));
      } finally { closeDb(db); }
    },
  },
];
