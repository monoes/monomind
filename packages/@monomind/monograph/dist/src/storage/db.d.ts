import Database from 'better-sqlite3';
export type MonographDb = Database.Database;
export interface OpenDbOptions {
    /**
     * When true, throw a clear error instead of silently creating a fresh,
     * empty-but-migrated database if `dbPath` doesn't exist yet. Defaults to
     * false to preserve legacy build-time behavior (the `monograph build`
     * codepath legitimately creates new DBs). Read-only analysis tools should
     * pass `true` so pointing them at a repo whose real index lives elsewhere
     * (e.g. running from a subdirectory) fails loudly instead of reporting
     * fake-successful-looking empty results.
     */
    fileMustExist?: boolean;
}
export declare function openDb(dbPath: string, options?: OpenDbOptions): MonographDb;
export declare function closeDb(db: MonographDb): void;
/** Write to a .tmp file then rename for atomic replacement. */
export declare function atomicRebuild(dbPath: string, buildFn: (db: MonographDb) => void): void;
//# sourceMappingURL=db.d.ts.map