import type Database from 'better-sqlite3';
export interface ServeOptions {
    port?: number;
    open?: boolean;
    db: Database.Database;
}
export interface ServeResult {
    url: string;
    status: 'started' | 'already_running';
}
/**
 * Start the Monograph web UI server.
 * If the server is already running, returns the existing URL.
 */
export declare function serveMonograph(options: ServeOptions): Promise<ServeResult>;
//# sourceMappingURL=serve.d.ts.map