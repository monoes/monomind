import type { Server } from 'http';
export interface AnalyzeRequest {
    repoPath: string;
    codeOnly?: boolean;
    force?: boolean;
}
export interface AnalyzeProgressEvent {
    type: 'progress' | 'complete' | 'error';
    phase?: string;
    message?: string;
    error?: string;
    nodeCount?: number;
    edgeCount?: number;
}
/**
 * Register the /api/analyze SSE endpoint on an existing HTTP server.
 *
 * GET /api/analyze?repoPath=<path>&codeOnly=<bool>&force=<bool>
 *
 * Responds with Content-Type: text/event-stream
 * Emits:
 *   data: {"type":"progress","phase":"scan","message":"Scanning files..."}\n\n
 *   data: {"type":"complete","nodeCount":123,"edgeCount":456}\n\n
 *   (or on error)
 *   data: {"type":"error","error":"Build failed: ..."}\n\n
 */
export declare function registerAnalyzeRoute(server: Server, pathPrefix?: string, 
/** Allowlisted repo root — only this path (and its subdirectories) may be analyzed */
allowedRepoRoot?: string): void;
//# sourceMappingURL=analyze-api.d.ts.map