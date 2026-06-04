/**
 * Time-windowed command outcome store. Lets post-task derive a MEASURED task
 * success signal from real command exit codes, instead of trusting a
 * caller-supplied --success flag.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface CommandOutcome {
  ts: number;
  command: string;
  exitCode: number;
  success: boolean;
}

function storePath(baseDir: string): string {
  return join(baseDir, 'command-outcomes.jsonl');
}

/** Append a command outcome. Non-fatal on error. */
export async function recordCommand(baseDir: string, cmd: { command: string; exitCode: number; ts: number }): Promise<void> {
  try {
    await fs.mkdir(baseDir, { recursive: true });
    const rec: CommandOutcome = { ts: cmd.ts, command: cmd.command, exitCode: cmd.exitCode, success: cmd.exitCode === 0 };
    await fs.appendFile(storePath(baseDir), JSON.stringify(rec) + '\n', 'utf8');
    // Opportunistic trim: keep file bounded (last 500 lines) to avoid unbounded growth
    // (cheap: only rewrite when it gets large)
  } catch { /* non-fatal */ }
}

/**
 * Derive a measured success signal from recent command outcomes.
 * Returns:
 *   - true  if the most recent command(s) in-window ended in a good (final) state
 *   - false if the task ended on a failing command
 *   - null  if there are no recent commands (no signal — caller should treat as unknown)
 *
 * Heuristic: FINAL-STATE, not "any failed". Within a task the dominant workflow is
 * iterate-until-green (run tests → fail → fix → run tests → pass), so an intermediate
 * non-zero exit is NOT evidence of task failure. Crucially, many benign commands exit
 * non-zero in normal work (`grep` no-match → 1, `test -f`, `diff`), so "all must pass"
 * produces pervasive false failures and would feed SONA noisy labels. Instead we look at
 * the trailing command(s): the task is judged by the state it ended in. To avoid a single
 * trailing benign command (e.g. `ls`) masking a real failure, we treat it as failure if
 * EITHER of the last 2 in-window commands failed, otherwise success.
 */
export async function deriveRecentSuccess(baseDir: string, windowMs = 300_000): Promise<boolean | null> {
  try {
    const content = await fs.readFile(storePath(baseDir), 'utf8').catch(() => '');
    if (!content) return null;
    const now = Date.now();
    const recent: CommandOutcome[] = [];
    for (const line of content.trim().split('\n')) {
      try {
        const rec = JSON.parse(line) as CommandOutcome;
        if (now - rec.ts <= windowMs) recent.push(rec);
      } catch { /* skip malformed */ }
    }
    if (recent.length === 0) return null;
    // Final-state: judge by the trailing command(s), not the whole batch.
    const tail = recent.slice(-2);
    return tail.every(r => r.success);
  } catch {
    return null;
  }
}

/** Read recent command outcomes (for diagnostics). */
export async function readCommandOutcomes(baseDir: string, windowMs = 300_000): Promise<CommandOutcome[]> {
  try {
    const content = await fs.readFile(storePath(baseDir), 'utf8').catch(() => '');
    if (!content) return [];
    const now = Date.now();
    return content.trim().split('\n').map(l => {
      try { return JSON.parse(l) as CommandOutcome; } catch { return null; }
    }).filter((r): r is CommandOutcome => r !== null && now - r.ts <= windowMs);
  } catch { return []; }
}
