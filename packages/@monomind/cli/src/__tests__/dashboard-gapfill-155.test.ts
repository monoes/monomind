/**
 * #155: dashboard's activeOrgs gap-fill never detected a completed run —
 * the SQLite query checked type IN ('run:complete','org:complete','org:stop'),
 * none of which daemon.ts ever emits (the real terminal signal is a
 * type:'status' event with msg:'org stopped' or reason:'org-complete',
 * carried in the JSON-stringified `raw` column, not a dedicated type
 * string) — so a finished run was always reported as still active.
 *
 * The gap-fill logic lives inline in server.mjs's startup function, not as
 * an exported unit — extracting the literal SQL string from source and
 * running it against a real sql.js database (rather than a source-pattern
 * assertion) verifies the actual query behavior without requiring a
 * refactor of unrelated, working server startup code.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../ui/server.mjs'), 'utf-8');

function extractGapfillSql(): string {
  const match = SERVER_SRC.match(/const _gfRunStmt = _runDb\.prepare\(\s*("|')([\s\S]*?)\1,?\s*\);/);
  if (!match) throw new Error('could not find gap-fill SQL in server.mjs — source may have changed');
  // The regex captures the raw JS string-literal source (still containing
  // backslash escapes like \" ), not the actual runtime string value — the
  // source is a double-quoted literal with only JSON-compatible escapes, so
  // JSON.parse on the re-quoted text correctly unescapes it.
  return JSON.parse(match[1] + match[2] + match[1]);
}

describe('dashboard gap-fill SQL detects real terminal events (#155)', () => {
  it('no longer references the non-existent type strings the bug report identified', () => {
    expect(SERVER_SRC).not.toMatch(/type IN \('run:complete','org:complete','org:stop'\)/);
  });

  it('the actual query, run against a real sql.js DB, marks a stopped run as done', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, org TEXT, run_id TEXT, type TEXT, raw TEXT, ts INTEGER
    )`);
    // Matches daemon.ts's real emit: org.bus.emit({ type: 'status', msg: 'org stopped' })
    const stoppedEvent = JSON.stringify({ type: 'status', msg: 'org stopped', org: 'myorg', run: 'run-1', ts: Date.now() });
    db.run('INSERT INTO run_events (org, run_id, type, raw, ts) VALUES (?,?,?,?,?)', [
      'myorg', 'run-1', 'status', stoppedEvent, Date.now(),
    ]);

    const sql = extractGapfillSql();
    const stmt = db.prepare(sql);
    stmt.bind(['myorg', 'run-1']);
    const matched = stmt.step();
    stmt.free();

    expect(matched).toBe(true); // the query DOES find this org-stopped run as terminal
  });

  it('the actual query also matches org_complete (reason:"org-complete"), and does not match a still-running org', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, org TEXT, run_id TEXT, type TEXT, raw TEXT, ts INTEGER
    )`);
    // Matches daemon.ts's real emit: org.bus.emit({ type: 'status', reason: 'org-complete', msg: '...' })
    const completeEvent = JSON.stringify({ type: 'status', reason: 'org-complete', msg: 'run outcome: achieved', org: 'orgA', run: 'run-2' });
    db.run('INSERT INTO run_events (org, run_id, type, raw, ts) VALUES (?,?,?,?,?)', [
      'orgA', 'run-2', 'status', completeEvent, Date.now(),
    ]);
    // A different org, still running — only a non-terminal status event.
    const runningEvent = JSON.stringify({ type: 'status', msg: 'agent working', org: 'orgB', run: 'run-3' });
    db.run('INSERT INTO run_events (org, run_id, type, raw, ts) VALUES (?,?,?,?,?)', [
      'orgB', 'run-3', 'status', runningEvent, Date.now(),
    ]);

    const sql = extractGapfillSql();

    const doneStmt = db.prepare(sql);
    doneStmt.bind(['orgA', 'run-2']);
    expect(doneStmt.step()).toBe(true);
    doneStmt.free();

    const runningStmt = db.prepare(sql);
    runningStmt.bind(['orgB', 'run-3']);
    expect(runningStmt.step()).toBe(false); // still running — must NOT be marked done
    runningStmt.free();
  });
});

describe('dashboard gap-fill JSONL fallback reads the real per-run event log (#155)', () => {
  it('no longer scans a runs/ directory Org Runtime v2 never writes', () => {
    expect(SERVER_SRC).not.toMatch(/path\.join\(_gfOrgsDir, _gfOrg, 'runs'\)/);
  });

  it('reads runtime.json\'s run field and <org>/<runId>/bus.jsonl, matching #138\'s statusline.cjs fix', () => {
    expect(SERVER_SRC).toMatch(/_gfOrgsDir, _gfOrg, 'runtime\.json'/);
    expect(SERVER_SRC).toMatch(/_gfOrgsDir, _gfOrg, _gfId, 'bus\.jsonl'/);
  });
});
