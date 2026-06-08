import Database from 'better-sqlite3';
export type MonographDb = Database.Database;
export declare function openDb(dbPath: string): MonographDb;
export declare function closeDb(db: MonographDb): void;
/** Write to a .tmp file then rename for atomic replacement. */
export declare function atomicRebuild(dbPath: string, buildFn: (db: MonographDb) => void): void;
//# sourceMappingURL=db.d.ts.map