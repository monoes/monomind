/**
 * Memory Migrations
 * Schema column migration and legacy database detection.
 * Extracted from memory-initializer.ts (ARCH-4)
 *
 * @module v1/cli/memory-migrations
 */

import * as fs from 'fs';
import * as path from 'path';

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

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    // Guard against excessively large DB files to prevent OOM.
    const ensureStat = fs.statSync(dbPath);
    if (ensureStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, columnsAdded, error: `Database file too large: ${ensureStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Get current columns in memory_entries
    const tableInfo = db.exec("PRAGMA table_info(memory_entries)");
    const existingColumns = new Set(
      tableInfo[0]?.values?.map(row => row[1] as string) || []
    );

    // Required columns that may be missing in older schemas
    // Issue #977: 'type' column was missing from this list, causing store failures on older DBs
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
      { name: 'status', definition: "status TEXT DEFAULT 'active'" }
    ];

    let modified = false;
    for (const col of requiredColumns) {
      if (!existingColumns.has(col.name)) {
        try {
          db.run(`ALTER TABLE memory_entries ADD COLUMN ${col.definition}`);
          columnsAdded.push(col.name);
          modified = true;
        } catch (e) {
          // Column might already exist or other error - continue
        }
      }
    }

    if (modified) {
      // Save updated database (atomic to avoid corruption on crash)
      const data = db.export();
      const tmp = dbPath + '.tmp';
      fs.writeFileSync(tmp, Buffer.from(data));
      fs.renameSync(tmp, dbPath);
    }

    db.close();
    return { success: true, columnsAdded };
  } catch (error) {
    return {
      success: false,
      columnsAdded,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check for legacy database installations and migrate if needed
 */
export async function checkAndMigrateLegacy(options: {
  dbPath: string;
  verbose?: boolean;
}): Promise<{
  needsMigration: boolean;
  legacyVersion?: string;
  legacyEntries?: number;
  migrated?: boolean;
  migratedCount?: number;
}> {
  const { dbPath, verbose = false } = options;

  // Check for legacy locations
  const legacyPaths = [
    path.join(process.cwd(), 'memory.db'),
    path.join(process.cwd(), '.claude/memory.db'),
    path.join(process.cwd(), 'data/memory.db'),
    path.join(process.cwd(), '.monomind/memory.db')
  ];

  for (const legacyPath of legacyPaths) {
    if (fs.existsSync(legacyPath) && legacyPath !== dbPath) {
      try {
        const initSqlJs = (await import('sql.js')).default;
        const SQL = await initSqlJs();

        // Guard against excessively large legacy DB files to prevent OOM.
        const legacyStat = fs.statSync(legacyPath);
        if (legacyStat.size > MAX_DB_FILE_BYTES) {
          if (verbose) {
            console.warn(`[memory] Skipping legacy DB at ${legacyPath}: file too large (${legacyStat.size} bytes)`);
          }
          continue;
        }

        const legacyBuffer = fs.readFileSync(legacyPath);
        const legacyDb = new SQL.Database(legacyBuffer);

        // Check if it has data
        const countResult = legacyDb.exec('SELECT COUNT(*) FROM memory_entries');
        const count = countResult[0]?.values[0]?.[0] as number || 0;

        // Get version if available
        let version = 'unknown';
        try {
          const versionResult = legacyDb.exec("SELECT value FROM metadata WHERE key='schema_version'");
          version = versionResult[0]?.values[0]?.[0] as string || 'unknown';
        } catch { /* no metadata table */ }

        legacyDb.close();

        if (count > 0) {
          return {
            needsMigration: true,
            legacyVersion: version,
            legacyEntries: count
          };
        }
      } catch {
        // Not a valid SQLite database, skip
      }
    }
  }

  return { needsMigration: false };
}
