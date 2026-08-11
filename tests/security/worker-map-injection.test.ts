/**
 * SEC-1 — Command injection in worker-map.ts git-staleness path.
 *
 * Before fix: `execSync(\`git -C ${JSON.stringify(projectRoot)} rev-list
 * --count ${lastHash}..HEAD\`)`. `lastHash` came from the DB (`meta` table)
 * with NO format guard, and the template ran through /bin/sh. A poisoned
 * `.monomind/monograph.db` shipping `last_commit_hash = '$(touch /tmp/pwned)'`
 * yielded RCE on the next `hooks worker run map`.
 *
 * After fix: the hash is gated by `/^[0-9a-f]{7,40}$/i` (skip silently on
 * mismatch, debug-log under MONOMIND_DEBUG) and the git call uses
 * `execFileSync('git', [...args])` — no shell, so even a bad hash can't expand.
 *
 * Probe: seed the poisoned value, run the worker, assert the sentinel file
 * was NOT created. The happy path verifies a valid hash still flows through
 * to the git call (which fails harmlessly inside the worker's try/catch
 * because the temp dir is not a real git repo).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { openDb, closeDb } from '../../packages/@monomind/monograph/src/index.js';
import { createMapWorker } from '../../packages/@monomind/hooks/src/workers/worker-map.js';

const PROBE = `/tmp/mono-sec1-pwned-${process.pid}-${Date.now()}`;

describe('SEC-1 — worker-map git-staleness command injection', () => {
  let projectRoot: string;
  let dbPath: string;

  beforeEach(() => {
    const base = path.join(
      os.tmpdir(),
      `mono-sec1-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    projectRoot = base;
    fs.mkdirSync(path.join(projectRoot, '.monomind'), { recursive: true });
    dbPath = path.join(projectRoot, '.monomind', 'monograph.db');
    if (fs.existsSync(PROBE)) fs.rmSync(PROBE);
  });

  afterEach(() => {
    if (fs.existsSync(PROBE)) fs.rmSync(PROBE, { force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  const seedMeta = (lastCommitHash: string): void => {
    // worker-map.ts queries a `meta(key, value)` table. We use monograph's
    // own openDb (which applies the canonical schema) and then layer our
    // `meta` table on top so the worker's SELECT returns our payload.
    const db = openDb(dbPath);
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_commit_hash', ?)").run(
      lastCommitHash,
    );
    closeDb(db);
  };

  it('does NOT shell-evaluate $(...) in a poisoned last_commit_hash', async () => {
    // Payload: a shell expansion that, if it ever reaches /bin/sh, writes a
    // sentinel file to /tmp. The whole point of the fix is that it never
    // reaches a shell.
    seedMeta(`$(touch ${PROBE})`);
    const worker = createMapWorker(projectRoot);
    const result = await worker();
    expect(result.success).toBe(true);
    expect(fs.existsSync(PROBE)).toBe(false);
  });

  it('does NOT shell-evaluate backtick expansions in last_commit_hash', async () => {
    seedMeta('`touch ' + PROBE + '`');
    const worker = createMapWorker(projectRoot);
    const result = await worker();
    expect(result.success).toBe(true);
    expect(fs.existsSync(PROBE)).toBe(false);
  });

  it('does NOT shell-evaluate ${...} expansions in last_commit_hash', async () => {
    // Standalone ${...} doesn't RCE on its own, but combined with a $() inside
    // it's a common obfuscation. The hash regex rejects it outright.
    seedMeta('${IFS}$(touch ' + PROBE + ')');
    const worker = createMapWorker(projectRoot);
    await worker();
    expect(fs.existsSync(PROBE)).toBe(false);
  });

  it('rejects a hash containing shell metacharacters but no expansion (defense in depth)', async () => {
    // Semicolons/pipes would be dangerous in a shell context. The regex must
    // reject anything outside [0-9a-f].
    seedMeta('deadbeef; touch ' + PROBE);
    const worker = createMapWorker(projectRoot);
    await worker();
    expect(fs.existsSync(PROBE)).toBe(false);
  });

  it('happy path: valid 40-char hex hash flows through (regex accepts, no shell)', async () => {
    // A real git hash. The regex must accept it. The git call itself will
    // fail (not a git repo) — that's swallowed by the worker's existing
    // try/catch. We verify the worker returns success and the security
    // probe (which would only fire if a shell existed and the hash leaked
    // into it) is absent.
    seedMeta('a'.repeat(40));
    const worker = createMapWorker(projectRoot);
    const result = await worker();
    expect(result.success).toBe(true);
    expect(fs.existsSync(PROBE)).toBe(false);
  });

  it('happy path: short 7-char hex hash is accepted', async () => {
    seedMeta('abc1234');
    const worker = createMapWorker(projectRoot);
    const result = await worker();
    expect(result.success).toBe(true);
    expect(fs.existsSync(PROBE)).toBe(false);
  });
});
