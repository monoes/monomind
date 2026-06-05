export interface CommandOutcome {
    ts: number;
    command: string;
    exitCode: number;
    success: boolean;
}
/** Append a command outcome. Non-fatal on error. */
export declare function recordCommand(baseDir: string, cmd: {
    command: string;
    exitCode: number;
    ts: number;
}): Promise<void>;
/**
 * Derive a measured success signal from recent command outcomes.
 * Returns:
 *   - true  if the most recent command(s) in-window ended in a good (final) state
 *   - false if the task ended on a failing command
 *   - null  if there are no recent commands (no signal — caller should treat as unknown)
 *
 * Heuristic: FINAL-STATE — the exit code of the LAST command in the window.
 * Within a task the dominant workflow is iterate-until-green (run tests → fail → fix →
 * run tests → pass), so the task is judged by the state it ENDED in, not by whether any
 * intermediate command failed. "All must pass" would produce pervasive false failures
 * because benign commands routinely exit non-zero (`grep` no-match → 1, `test -f`, `diff`)
 * and the fail-then-pass shape is the norm. Using the last command correctly scores
 * fail→fix→pass as success and ends-on-failure as failure.
 *
 * Known limitation: the store is global (not task-scoped — no taskId exists at command
 * time), so a trailing benign command after a real failure (e.g. `git status` after a
 * failed test) could mask it, and the final command of a prior task could bleed in if a
 * new task records no commands of its own. The time window bounds the latter; per-task
 * scoping would require threading a taskId into post-command.
 */
export declare function deriveRecentSuccess(baseDir: string, windowMs?: number): Promise<boolean | null>;
/** Read recent command outcomes (for diagnostics). */
export declare function readCommandOutcomes(baseDir: string, windowMs?: number): Promise<CommandOutcome[]>;
//# sourceMappingURL=command-outcomes.d.ts.map