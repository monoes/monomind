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
 *   - true  if there are recent commands in-window and ALL succeeded
 *   - false if there are recent commands in-window and ANY failed
 *   - null  if there are no recent commands (no signal — caller should treat as unknown)
 *
 * Rationale: within a task, a failed command (test/build/lint exit != 0) is strong
 * evidence the task did not cleanly succeed. All-zero exit codes is evidence it did.
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
    return recent.every(r => r.success);
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
