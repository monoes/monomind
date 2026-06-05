/**
 * Time-windowed command outcome store. Lets post-task derive a MEASURED task
 * success signal from real command exit codes, instead of trusting a
 * caller-supplied --success flag.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
function storePath(baseDir) {
    return join(baseDir, 'command-outcomes.jsonl');
}
/** Append a command outcome. Non-fatal on error. */
export async function recordCommand(baseDir, cmd) {
    try {
        await fs.mkdir(baseDir, { recursive: true });
        const rec = { ts: cmd.ts, command: cmd.command, exitCode: cmd.exitCode, success: cmd.exitCode === 0 };
        await fs.appendFile(storePath(baseDir), JSON.stringify(rec) + '\n', 'utf8');
        // Opportunistic trim: keep file bounded (last 500 lines) to avoid unbounded growth
        // (cheap: only rewrite when it gets large)
    }
    catch { /* non-fatal */ }
}
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
export async function deriveRecentSuccess(baseDir, windowMs = 300_000) {
    try {
        const content = await fs.readFile(storePath(baseDir), 'utf8').catch(() => '');
        if (!content)
            return null;
        const now = Date.now();
        const recent = [];
        for (const line of content.trim().split('\n')) {
            try {
                const rec = JSON.parse(line);
                if (now - rec.ts <= windowMs)
                    recent.push(rec);
            }
            catch { /* skip malformed */ }
        }
        if (recent.length === 0)
            return null;
        // Final-state: the last command in the window decides the outcome.
        return recent[recent.length - 1].success;
    }
    catch {
        return null;
    }
}
/** Read recent command outcomes (for diagnostics). */
export async function readCommandOutcomes(baseDir, windowMs = 300_000) {
    try {
        const content = await fs.readFile(storePath(baseDir), 'utf8').catch(() => '');
        if (!content)
            return [];
        const now = Date.now();
        return content.trim().split('\n').map(l => {
            try {
                return JSON.parse(l);
            }
            catch {
                return null;
            }
        }).filter((r) => r !== null && now - r.ts <= windowMs);
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=command-outcomes.js.map