import type Database from 'better-sqlite3';
export interface ToolEntry {
    id: string;
    name: string;
    description: string | null;
    filePath: string | null;
    handlerName: string | null;
    handlerFile: string | null;
    handlerLine: number | null;
}
export declare function getToolMap(db: Database.Database, options?: {
    tool?: string;
}): ToolEntry[];
//# sourceMappingURL=tool-map.d.ts.map