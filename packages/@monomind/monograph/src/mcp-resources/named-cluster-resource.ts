import type Database from 'better-sqlite3';
import type { McpResourceDefinition } from './repos-resource.js';

/**
 * Returns a named community cluster with its member nodes.
 * Looks up the community by label and returns all nodes that belong to it.
 */
export const namedClusterResource: McpResourceDefinition = {
  uri: 'monograph://cluster/{name}',
  name: 'named-cluster',
  mimeType: 'application/json',
  handler(db, params) {
    const name = params?.['name'];
    if (!name) return null;
    try {
      const row = db
        .prepare('SELECT id, label FROM communities WHERE label = ?')
        .get(name) as { id: number; label: string } | undefined;
      if (!row) return null;
      const members = db
        .prepare(
          'SELECT id, name, label, file_path FROM nodes WHERE community_id = ?',
        )
        .all(row.id) as Array<{
        id: string;
        name: string;
        label: string;
        file_path: string | null;
      }>;
      return { id: row.id, label: row.label, members };
    } catch {
      return null;
    }
  },
};
