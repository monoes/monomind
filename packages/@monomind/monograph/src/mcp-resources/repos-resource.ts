import type Database from 'better-sqlite3';

export interface McpResourceDefinition {
  uri: string;
  name: string;
  mimeType: string;
  handler(db: Database.Database, params?: Record<string, string>): unknown;
}

/**
 * Returns the list of indexed repositories.
 * When no repo registry is available, returns an empty array as a safe default.
 */
export const reposResource: McpResourceDefinition = {
  uri: 'monograph://repos',
  name: 'repos',
  mimeType: 'application/json',
  handler(_db) {
    return [];
  },
};
