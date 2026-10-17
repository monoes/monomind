/**
 * Monograph MCP Tools — monograph_context, monograph_neighbors, monograph_get_node.
 * Extracted from query-tools.ts.
 */

import type { MCPTool } from '../types.js';
import { ambiguityResult } from './impact-tools-shared.js';
import { getDbPath, text } from './shared.js';

// ── monograph_context ─────────────────────────────────────────────────────────

export const monographContextTool: MCPTool = {
  name: 'monograph_context',
  description:
    '360° symbol view: callers, callees, imports, importedBy, community, and containing processes for a symbol. When a name matches several definitions the candidates are listed instead of one being picked; re-query with nodeId or filePath.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Symbol name to look up' },
      nodeId: {
        type: 'string',
        description: 'Canonical node id — unambiguous, preferred when known',
      },
      filePath: {
        type: 'string',
        description: 'Disambiguate a name by file path (exact, or a trailing fragment)',
      },
    },
    required: ['name'],
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { getMonographContext } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      // Cap name and filePath: forwarded to parameterized SQL via getMonographContext.
      // Very long strings waste memory before the query even executes.
      const MAX_CTX_NAME_LEN = 512;
      const MAX_CTX_PATH_LEN = 4 * 1024;
      const rawCtxName = input.name as string;
      const ctxName =
        typeof rawCtxName === 'string' && rawCtxName.length > MAX_CTX_NAME_LEN
          ? rawCtxName.slice(0, MAX_CTX_NAME_LEN)
          : rawCtxName;
      const rawCtxPath = input.filePath as string | undefined;
      const ctxPath =
        typeof rawCtxPath === 'string' && rawCtxPath.length > MAX_CTX_PATH_LEN
          ? rawCtxPath.slice(0, MAX_CTX_PATH_LEN)
          : rawCtxPath;
      const result = getMonographContext(db, {
        name: ctxName,
        filePath: ctxPath,
        nodeId: input.nodeId as string | undefined,
      });
      if (result?.ambiguous) return ambiguityResult(ctxName, result.candidates ?? []);
      if (!result?.node) return text(`No symbol found: ${ctxName}`);

      // Format context as structured text for direct LLM consumption
      const n = result.node as any;
      const loc = n.filePath
        ? n.startLine != null
          ? `${n.filePath}:${n.startLine}`
          : n.filePath
        : '';
      const lines: string[] = [`[${n.label ?? '?'}] ${n.name}  ${loc}`, ''];

      const formatNodes = (nodes: any[], label: string) => {
        if (!Array.isArray(nodes) || nodes.length === 0) return;
        lines.push(`${label} (${nodes.length}):`);
        for (const node of nodes.slice(0, 20)) {
          const fp = node.filePath ?? node.file_path ?? '';
          const ln = node.startLine ?? node.start_line;
          const nodeLoc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
          lines.push(`  [${node.label ?? '?'}] ${node.name ?? node.id}  ${nodeLoc}`);
        }
        if (nodes.length > 20) lines.push(`  … ${nodes.length - 20} more`);
        lines.push('');
      };

      formatNodes(result.callers as any, 'Callers');
      formatNodes(result.callees as any, 'Callees');
      formatNodes(result.imports as any, 'Imports');
      formatNodes(result.importedBy as any, 'ImportedBy');
      formatNodes(result.testedBy, 'Tested by (calls this symbol)');
      formatNodes(result.fileTests, 'Tests of its file (imports it)');

      if (result.community != null) {
        const c = result.community;
        lines.push(`Community: #${c.id}${c.label ? ` ${c.label}` : ''}`);
      }
      if (result.inProcesses.length > 0) {
        lines.push(`In processes: ${result.inProcesses.map((p) => p.name).join(', ')}`);
      }

      return text(lines.join('\n').trim());
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_neighbors ───────────────────────────────────────────────────────

export const monographNeighborsTool: MCPTool = {
  name: 'monograph_neighbors',
  description:
    'Show all directly connected nodes for a given symbol — outbound and optionally inbound edges, with relation types. When a name matches several definitions the candidates are listed instead of one being picked; re-query with nodeId or filePath. Reports the true neighbor total whenever the result is truncated.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Symbol name to look up' },
      nodeId: {
        type: 'string',
        description: 'Canonical node id — unambiguous, preferred when known',
      },
      filePath: {
        type: 'string',
        description: 'Disambiguate a name by file path (exact, or a trailing fragment)',
      },
      relationFilter: {
        type: 'string',
        description: 'Filter by relation type, e.g. IMPORTS, CALLS',
      },
      includeInbound: { type: 'boolean', description: 'Include inbound edges (default: false)' },
      limit: { type: 'number', description: 'Max neighbors per direction (default 50, max 500)' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb, getMonographNeighbors } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = getMonographNeighbors(db, {
        name: input.name as string | undefined,
        nodeId: input.nodeId as string | undefined,
        filePath: input.filePath as string | undefined,
        relationFilter: input.relationFilter as string | undefined,
        includeInbound: (input.includeInbound as boolean | undefined) ?? false,
        limit: input.limit as number | undefined,
      });
      const target = (input.nodeId ?? input.name ?? '(no name or nodeId given)') as string;
      if (result.ambiguous) {
        // Answering confidently about the wrong definition is worse than asking.
        return text(
          [
            `"${target}" matches ${result.candidates.length} nodes — re-run with nodeId (or filePath) to pick one:`,
            ...result.candidates.map(
              (c) =>
                `  nodeId=${c.id}  [${c.label}] ${c.name}  ${c.filePath ?? '(no path)'}${
                  c.startLine != null ? `:${c.startLine}` : ''
                }`,
            ),
          ].join('\n'),
        );
      }
      if (!result.node) return text(`No node found with name: ${target}`);
      const nodeFilePath = (result.node as any).filePath ?? '';
      const nodeStartLine = (result.node as any).startLine ?? (result.node as any).start_line;
      const nodeLoc = nodeFilePath
        ? nodeStartLine != null
          ? `${nodeFilePath}:${nodeStartLine}`
          : nodeFilePath
        : '';
      const lines = [
        `[${result.node.label}] ${result.node.name}  ${nodeLoc}`,
        result.truncated
          ? `Neighbors: ${result.neighbors.length} of ${result.totalNeighbors} (truncated at limit ${result.limit} — raise limit or filter by relation to see the rest)`
          : `Neighbors: ${result.neighbors.length} (complete)`,
        '',
        ...result.neighbors.map((n) => {
          const fp = (n.node as any).filePath ?? (n.node as any).file_path ?? '';
          const ln = (n.node as any).startLine ?? (n.node as any).start_line;
          const loc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
          return `  ${n.direction === 'inbound' ? '←' : '→'} [${n.node.label}] ${n.node.name}  (${n.relation})  ${loc}`;
        }),
      ];
      return text(lines.join('\n'));
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_get_node ────────────────────────────────────────────────────────

export const monographGetNodeTool: MCPTool = {
  name: 'monograph_get_node',
  description: 'Get a specific node by exact ID or name.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Node ID or name to look up' },
    },
    required: ['id'],
  },
  handler: async (input) => {
    const { openDb, closeDb, getNode } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      let node = getNode(db, input.id as string);
      if (!node) {
        const row = db.prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1').get(input.id) as any;
        if (row) node = row;
      }
      if (!node) return text(`Node not found: ${input.id}`);
      return text(JSON.stringify(node, null, 2));
    } finally {
      closeDb(db);
    }
  },
};
