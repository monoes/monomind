/**
 * Memory Migrations
 * Schema column migration for older databases.
 * Extracted from memory-initializer.ts (ARCH-4)
 *
 * @module v1/cli/memory-migrations
 */

import * as fs from 'node:fs';
import { withDbLock } from '../utils/db-mutex.js';
import { secureDbFilePermissions } from './file-permissions.js';

/** Maximum SQLite database file size accepted before read (256 MB). */
const MAX_DB_FILE_BYTES = 256 * 1024 * 1024;

/**
 * Ensure memory_entries table has all required columns
 * Adds missing columns for older databases (e.g., 'content' column)
 */
export async function ensureSchemaColumns(dbPath: string): Promise<{
  success: boolean;
  columnsAdded: string[];
  error?: string;
}> {
  const columnsAdded: string[] = [];

  try {
    if (!fs.existsSync(dbPath)) {
      return { success: true, columnsAdded: [] };
    }

    return await withDbLock(dbPath, async () => {
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs();

      // Guard against excessively large DB files to prevent OOM.
      const ensureStat = fs.statSync(dbPath);
      if (ensureStat.size > MAX_DB_FILE_BYTES) {
        return {
          success: false,
          columnsAdded,
          error: `Database file too large: ${ensureStat.size} bytes`,
        };
      }

      const fileBuffer = fs.readFileSync(dbPath);
      const db = new SQL.Database(fileBuffer);

      // Get current columns in memory_entries
      const tableInfo = db.exec('PRAGMA table_info(memory_entries)');
      const existingColumns = new Set(tableInfo[0]?.values?.map((row) => row[1] as string) || []);

      const requiredColumns: Array<{ name: string; definition: string }> = [
        { name: 'content', definition: "content TEXT DEFAULT ''" },
        { name: 'type', definition: "type TEXT DEFAULT 'semantic'" },
        { name: 'embedding', definition: 'embedding TEXT' },
        { name: 'embedding_model', definition: "embedding_model TEXT DEFAULT 'local'" },
        { name: 'embedding_dimensions', definition: 'embedding_dimensions INTEGER' },
        { name: 'tags', definition: 'tags TEXT' },
        { name: 'metadata', definition: 'metadata TEXT' },
        { name: 'owner_id', definition: 'owner_id TEXT' },
        { name: 'expires_at', definition: 'expires_at INTEGER' },
        { name: 'last_accessed_at', definition: 'last_accessed_at INTEGER' },
        { name: 'access_count', definition: 'access_count INTEGER DEFAULT 0' },
        { name: 'status', definition: "status TEXT DEFAULT 'active'" },
      ];

      let modified = false;
      for (const col of requiredColumns) {
        if (!existingColumns.has(col.name)) {
          try {
            db.run(`ALTER TABLE memory_entries ADD COLUMN ${col.definition}`);
            columnsAdded.push(col.name);
            modified = true;
          } catch (e) {
            if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
              console.error(`[ensureSchemaColumns] failed to add column '${col.name}':`, e);
          }
        }
      }

      if (modified) {
        const data = db.export();
        const tmp = `${dbPath}.tmp`;
        fs.writeFileSync(tmp, Buffer.from(data));
        fs.renameSync(tmp, dbPath);
        secureDbFilePermissions(dbPath);
      }

      db.close();
      return { success: true, columnsAdded };
    });
  } catch (error) {
    return {
      success: false,
      columnsAdded,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
