/**
 * Trigger Scanner (Task 32)
 *
 * Scans task descriptions against compiled trigger patterns
 * from agent frontmatter and returns matches.
 *
 * - Patterns are tested in descending priority order.
 * - A `takeover` match short-circuits: only that agent is returned.
 * - `inject` matches accumulate as additional candidates.
 * - Invalid regex patterns are silently skipped.
 */
import type { TriggerPattern, TriggerMatch, TriggerIndex } from '../../../../@monomind/shared/src/types/trigger.js';
export declare class TriggerScanner {
    private compiled;
    private patterns;
    private totalAgentsScanned;
    private buildingIndex;
    constructor(patterns?: TriggerPattern[]);
    /**
     * Test all patterns against `taskDescription` and return matches.
     *
     * Patterns are tested in descending priority order.
     * If a `takeover` pattern matches, scanning stops immediately
     * and only that agent is returned.
     */
    scan(taskDescription: string): TriggerMatch[];
    /**
     * Build an index by scanning agent markdown files under `agentDir`.
     *
     * Reads each `.md` file, extracts YAML frontmatter, and looks for
     * `triggers:` entries with `pattern`, `mode`, and optional `priority`.
     */
    buildIndex(agentDir: string, allowedRoot?: string): TriggerIndex;
    private _buildIndex;
    /** Add a pattern to the index at runtime. */
    addPattern(pattern: TriggerPattern): void;
    /**
     * Remove a specific pattern for an agent.
     * Returns `true` if the pattern was found and removed.
     */
    removePattern(agentSlug: string, pattern: string): boolean;
    /** Return a snapshot of the current index. */
    getIndex(): TriggerIndex;
    /** Number of compiled patterns. */
    get size(): number;
    private compileAndAdd;
    private sortByPriority;
    /** Recursively collect `.md` files (symlinks skipped, visited inodes tracked). */
    private collectMdFiles;
    /** Derive slug from filename. */
    private slugFromPath;
    /**
     * Extract trigger definitions from markdown frontmatter.
     *
     * Looks for a YAML block between `---` markers, then finds lines like:
     *   - pattern: "\\b(auth|jwt)\\b"
     *     mode: "inject"
     *     priority: 10
     */
    private extractTriggers;
    private finalizeTrigger;
    private extractYamlValue;
}
//# sourceMappingURL=trigger-scanner.d.ts.map