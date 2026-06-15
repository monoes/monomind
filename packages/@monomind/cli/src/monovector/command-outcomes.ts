/**
 * Time-windowed command outcome store. Lets post-task derive a MEASURED task
 * success signal from real command exit codes, instead of trusting a
 * caller-supplied --success flag.
 */
import { promises as fs, statSync } from 'node:fs';
import { join } from 'node:path';

/** Refuse to read files larger than this to prevent OOM. */
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

/** Cap command string length to prevent file bloat. */
const MAX_COMMAND_LEN = 500;

export interface CommandOutcome {
  ts: number;
  command: string;
  exitCode: number;
  success: boolean;
}

function storePath(baseDir: string): string {
  return join(baseDir, 'command-outcomes.jsonl');
}

/** Maximum number of command-outcome records to keep.
 *  deriveRecentSuccess only uses records within a 5-minute window (typically < 50), so
 *  anything older is dead weight. 500 gives a comfortable buffer. */
const MAX_COMMAND_RECORDS = 500;

/** Append a command outcome. Non-fatal on error. */
export async function recordCommand(baseDir: string, cmd: { command: string; exitCode: number; ts: number }): Promise<void> {
  try {
    await fs.mkdir(baseDir, { recursive: true });
    const path = storePath(baseDir);
    // Cap command length to prevent individual records from bloating the file.
    const safeCommand = cmd.command.length > MAX_COMMAND_LEN ? cmd.command.slice(0, MAX_COMMAND_LEN) : cmd.command;
    const rec: CommandOutcome = { ts: cmd.ts, command: safeCommand, exitCode: cmd.exitCode, success: cmd.exitCode === 0 };
    await fs.appendFile(path, JSON.stringify(rec) + '\n', 'utf8');
    // Opportunistic trim: rewrite only when the file exceeds the cap.
    // Avoids an extra stat() on every call by catching the overcount lazily.
    // Guard with size check first to prevent OOM on unexpectedly large files.
    try { if (statSync(path).size > MAX_FILE_BYTES) return; } catch { return; }
    const content = await fs.readFile(path, 'utf8').catch(() => '');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length > MAX_COMMAND_RECORDS) {
      await fs.writeFile(path, lines.slice(-MAX_COMMAND_RECORDS).join('\n') + '\n', 'utf8');
    }
  } catch { /* non-fatal */ }
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
export async function deriveRecentSuccess(baseDir: string, windowMs = 300_000): Promise<boolean | null> {
  try {
    const p = storePath(baseDir);
    try { if (statSync(p).size > MAX_FILE_BYTES) return null; } catch { /* file absent */ }
    const content = await fs.readFile(p, 'utf8').catch(() => '');
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
    // Final-state: the last command in the window decides the outcome.
    return recent[recent.length - 1].success;
  } catch {
    return null;
  }
}

/** Read recent command outcomes (for diagnostics). */
export async function readCommandOutcomes(baseDir: string, windowMs = 300_000): Promise<CommandOutcome[]> {
  try {
    const p = storePath(baseDir);
    try { if (statSync(p).size > MAX_FILE_BYTES) return []; } catch { /* file absent */ }
    const content = await fs.readFile(p, 'utf8').catch(() => '');
    if (!content) return [];
    const now = Date.now();
    return content.trim().split('\n').map(l => {
      try { return JSON.parse(l) as CommandOutcome; } catch { return null; }
    }).filter((r): r is CommandOutcome => r !== null && now - r.ts <= windowMs);
  } catch { return []; }
}
