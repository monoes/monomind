import type Database from 'better-sqlite3';
export interface ServerOptions {
    port?: number;
    db: Database.Database;
}
export interface ServerHandle {
    url: string;
    stop: () => Promise<void>;
}
export declare function isServerRunning(): boolean;
export declare function startServer(options: ServerOptions): Promise<ServerHandle>;
export declare function getActiveUrl(): string | null;
//# sourceMappingURL=server.d.ts.map