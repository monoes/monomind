import type Database from 'better-sqlite3';
import type { McpResourceDefinition } from './repos-resource.js';

/**
 * Returns a single node looked up by name.
 * Useful for resolving a named process/function/class to its location metadata.
 */
export const namedProcessResource: McpResourceDefinition = {
  uri: 'monograph://process/{name}',
  name: 'named-process',
  mimeType: 'application/json',
  handler(db, params) {
    const name = params?.['name'];
    if (!name) return null;
    try {
      const row = db
        .prepare(
          'SELECT id, name, label, file_path, start_line, end_line, community_id FROM nodes WHERE name = ? LIMIT 1',
        )
        .get(name) as Record<string, unknown> | undefined;
      return row ?? null;
    } catch {
      return null;
    }
  },
};
