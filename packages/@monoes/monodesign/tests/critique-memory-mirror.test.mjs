/**
 * Tests for the best-effort monomind memory mirror that runs as part of
 * `critique-storage.mjs write`. Contract:
 *
 *   - When a monomind CLI is resolvable, the snapshot's compact record is
 *     stored under namespace `design-critique`, key `<project>-<slug>`.
 *   - When no CLI exists anywhere (bare PATH, no node_modules), the write
 *     still succeeds silently — the mirror must never break the critique.
 *   - MONODESIGN_NO_MEMORY=1 disables the mirror even when a CLI exists.
 *
 * Run with: node --test tests/critique-memory-mirror.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { mirrorToMemory } from '../skill/scripts/critique-storage.mjs';

const SCRIPT = fileURLToPath(new URL('../skill/scripts/critique-storage.mjs', import.meta.url));
const isPosix = process.platform !== 'win32';

let cwd;
beforeEach(() => {
  // realpath: on macOS tmpdir is a /var -> /private/var symlink and the
  // written snapshot path comes back resolved.
  cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'monodesign-mirror-')));
});
afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

/** A fake `monomind` bin that appends its argv (one per line) to a log. */
function installFakeMonomind() {
  const binDir = path.join(cwd, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const log = path.join(cwd, 'mirror-args.log');
  const bin = path.join(binDir, 'monomind');
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${log}"\n`);
  fs.chmodSync(bin, 0o755);
  return log;
}

function runWrite(env = {}) {
  const bodyFile = path.join(cwd, 'body.md');
  fs.writeFileSync(bodyFile, '# Critique\n\n- **[P0] Broken thing**: fix it\n');
  return spawnSync(process.execPath, [SCRIPT, 'write', 'home', bodyFile], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      MONODESIGN_CRITIQUE_META: '{"target":"the homepage","total_score":28,"p0_count":1,"p1_count":3}',
      ...env,
    },
  });
}

describe('memory mirror on write', { skip: !isPosix && 'posix shell fake bin' }, () => {
  it('stores a compact JSON record via the resolved monomind CLI', () => {
    const log = installFakeMonomind();
    const r = runWrite();
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const args = fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean);
    assert.equal(args[0], 'memory');
    assert.equal(args[1], 'store');
    assert.ok(args.includes('--namespace'));
    assert.equal(args[args.indexOf('--namespace') + 1], 'design-critique');
    assert.ok(args.includes('--upsert'));
    const key = args[args.indexOf('--key') + 1];
    assert.equal(key, `${path.basename(cwd)}-home`.toLowerCase().replace(/[^a-z0-9-]+/g, '-'));
    const record = JSON.parse(args[args.indexOf('--value') + 1]);
    assert.equal(record.score, 28);
    assert.equal(record.p0, 1);
    assert.equal(record.p1, 3);
    assert.equal(record.slug, 'home');
    assert.ok(!Number.isNaN(Date.parse(record.date)), `bad date: ${record.date}`);
    // Path points at the snapshot the same write produced.
    assert.ok(record.path.endsWith('__home.md'), `bad path: ${record.path}`);
    assert.ok(fs.existsSync(path.join(cwd, record.path)), 'mirrored path should exist');
  });

  it('is skipped cleanly when no monomind CLI is resolvable', () => {
    // Bare PATH (no npx, no node_modules anywhere up-tree from tmpdir):
    // the mirror must be a silent no-op and the snapshot must still land.
    const emptyBin = path.join(cwd, 'empty-bin');
    fs.mkdirSync(emptyBin);
    const r = runWrite({ PATH: emptyBin });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const written = r.stdout.trim();
    assert.ok(written.endsWith('__home.md'));
    assert.ok(fs.existsSync(written), 'snapshot must be written despite missing CLI');
    assert.equal(r.stderr, '');
  });

  it('is disabled by MONODESIGN_NO_MEMORY=1 even when a CLI exists', () => {
    const log = installFakeMonomind();
    const r = runWrite({ MONODESIGN_NO_MEMORY: '1' });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(!fs.existsSync(log), 'fake CLI must not have been invoked');
    assert.ok(fs.existsSync(r.stdout.trim()), 'snapshot still written');
  });
});

describe('mirrorToMemory unit', () => {
  it('reports disabled without spawning when the kill-switch is set', () => {
    const res = mirrorToMemory({
      slug: 'home',
      meta: { total_score: 28 },
      filePath: path.join(cwd, 'x.md'),
      cwd,
      env: { MONODESIGN_NO_MEMORY: '1' },
    });
    assert.deepEqual(res, { mirrored: false, reason: 'disabled' });
  });

  it('requires a slug', () => {
    assert.deepEqual(mirrorToMemory({ slug: null, cwd }), { mirrored: false, reason: 'no-slug' });
  });

  it('returns cli-unavailable (never throws) when nothing is resolvable', () => {
    const emptyBin = path.join(cwd, 'empty-bin');
    fs.mkdirSync(emptyBin, { recursive: true });
    const res = mirrorToMemory({
      slug: 'home',
      meta: { total_score: 28 },
      filePath: path.join(cwd, 'x.md'),
      cwd,
      env: { PATH: emptyBin },
    });
    assert.equal(res.mirrored, false);
    assert.equal(res.reason, 'cli-unavailable');
  });
});
