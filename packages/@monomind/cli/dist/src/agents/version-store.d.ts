/**
 * Agent Version Store (Task 29)
 *
 * JSONL-based append-only storage for agent definition versions.
 * Supports save, list, get, rollback, and diff operations.
 */
import type { AgentVersionRecord, DiffResult } from '../../../shared/src/types/agent-version.js';
/**
 * JSONL-based agent version store.
 *
 * Each slug's versions are stored in `<dirPath>/versions.jsonl`, one JSON
 * object per line.  Rollback rewrites the file to update `isCurrent` flags.
 */
export declare class AgentVersionStore {
    private readonly dirPath;
    private readonly filePath;
    constructor(dirPath: string);
    private readAll;
    private writeAll;
    /**
     * Save a new version for the given agent slug.
     *
     * Computes a SHA-256 hash of the content, marks all previous versions for
     * the same slug as non-current, and appends the new record.
     */
    saveVersion(slug: string, content: string, version: string, changelog: string, opts?: {
        deprecated?: boolean;
        deprecatedBy?: string;
        capturedBy?: string;
    }): AgentVersionRecord;
    /**
     * List all versions for a slug, sorted by capturedAt DESC (newest first).
     * Uses insertion order (line index) as a stable tiebreaker.
     */
    listVersions(slug: string): AgentVersionRecord[];
    /**
     * Get the current active version for a slug, or null.
     */
    getCurrent(slug: string): AgentVersionRecord | null;
    /**
     * Get a specific version by slug and semver string, or null.
     */
    getVersion(slug: string, version: string): AgentVersionRecord | null;
    /**
     * Roll back to a specific version.
     *
     * Marks the target version as current and all others for that slug as
     * non-current.  Rewrites the JSONL file.
     *
     * @throws Error if the target version does not exist.
     */
    rollback(slug: string, toVersion: string): AgentVersionRecord;
    /**
     * Compute a line-level diff between two versions of the same agent.
     *
     * @throws Error if either version does not exist.
     */
    diff(slug: string, fromVersion: string, toVersion: string): DiffResult;
}
//# sourceMappingURL=version-store.d.ts.map