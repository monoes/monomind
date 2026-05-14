/**
 * ReplayReader
 *
 * Reads session files from .monomind/sessions/ for replay and listing.
 * Session files follow the pattern session-{id}.json. current.json is a
 * regular file (not a symlink) pointing to the active session data.
 */
export interface SessionSummary {
    id: string;
    startedAt: string;
    endedAt?: string;
    tokenUsage?: {
        total?: number;
    };
    taskCount?: number;
    filePath: string;
}
export interface SessionReplay extends SessionSummary {
    raw: Record<string, unknown>;
}
export declare class ReplayReader {
    private sessionsDir;
    constructor(cwd?: string);
    /**
     * Find and return the session data for a given session ID.
     * The ID may be a bare ID (e.g. "session-1234567890") or a timestamp number.
     * Falls back to current.json if the id matches the current session.
     */
    show(sessionId: string): Promise<SessionReplay | null>;
    /**
     * List sessions ordered by startedAt descending (most recent first).
     * current.json is excluded — only persisted session-*.json files are listed.
     */
    list(limit?: number): Promise<SessionSummary[]>;
    private parseReplay;
    private parseSummary;
    private buildSummary;
    private readJson;
}
//# sourceMappingURL=replay-reader.d.ts.map