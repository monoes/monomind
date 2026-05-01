import type Database from 'better-sqlite3';
import type { McpResourceDefinition } from './repos-resource.js';

const AVAILABLE_TOOLS = [
  'monograph_context', 'monograph_impact', 'monograph_cypher', 'monograph_rename',
  'monograph_api_impact', 'monograph_route_map', 'monograph_tool_map',
  'monograph_detect_changes', 'monograph_shape_check', 'monograph_neighbors',
  'monograph_explain', 'monograph_query_graph',
];

export const repoContextResource: McpResourceDefinition = {
  uri: 'monograph://repo/context',
  name: 'repo-context',
  mimeType: 'application/json',
  handler(db) {
    const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
    const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
    const communityCount = (
      db.prepare('SELECT COUNT(DISTINCT community_id) as c FROM nodes WHERE community_id IS NOT NULL').get() as { c: number }
    ).c;

    let indexedAt: string | null = null;
    try {
      const row = db.prepare("SELECT value FROM index_meta WHERE key = 'indexed_at'").get() as { value: string } | undefined;
      indexedAt = row?.value ?? null;
    } catch { /* ok */ }

    return {
      nodeCount,
      edgeCount,
      communityCount,
      indexedAt,
      availableTools: AVAILABLE_TOOLS,
    };
  },
};
