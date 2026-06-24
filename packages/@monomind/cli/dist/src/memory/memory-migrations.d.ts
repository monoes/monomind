/**
 * Memory Migrations
 * Schema column migration and legacy database detection.
 * Extracted from memory-initializer.ts (ARCH-4)
 *
 * @module v1/cli/memory-migrations
 */
/**
 * Ensure memory_entries table has all required columns
 * Adds missing columns for older databases (e.g., 'content' column)
 */
export declare function ensureSchemaColumns(dbPath: string): Promise<{
    success: boolean;
    columnsAdded: string[];
    error?: string;
}>;
/**
 * Check for legacy database installations and migrate if needed
 */
export declare function checkAndMigrateLegacy(options: {
    dbPath: string;
    verbose?: boolean;
}): Promise<{
    needsMigration: boolean;
    legacyVersion?: string;
    legacyEntries?: number;
    migrated?: boolean;
    migratedCount?: number;
}>;
//# sourceMappingURL=memory-migrations.d.ts.map