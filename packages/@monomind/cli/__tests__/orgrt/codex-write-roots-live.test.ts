// packages/@monomind/cli/__tests__/orgrt/codex-write-roots-live.test.ts
/**
 * Opt-in regression test against the REAL codex CLI. Off unless
 * MONOMIND_LIVE_CODEX=1 and `codex` is on PATH. It makes one cheap model call
 * (the model is asked to run a fixed probe script inside codex's sandbox).
 *
 *   MONOMIND_LIVE_CODEX=1 TMPDIR=/var/tmp/mesh-gate \
 *     pnpm exec vitest run __tests__/orgrt/codex-write-roots-live.test.ts
 *
 * Optional: MONOMIND_LIVE_CODEX_MODEL (default gpt-5.6-terra). The child runs
 * with the real HOME so codex finds its login (and the mise launcher its
 * install); the decoy directories live under /var/tmp, never under TMPDIR,
 * which codex's sandbox leaves writable. Nothing is touched outside them
 * except codex's own state under ~/.codex, as for any codex run.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { codexSandboxArgs } from '../../src/orgrt/cli-sandbox.js';

// The test runner's PATH and HOME are stripped; the child gets the real ones.
const realHome = userInfo().homedir;
const childEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  // The suite points XDG_*, MISE_* and CODEX_HOME at a throwaway home; the
  // launcher and the login live in the real one.
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (/^(XDG_|MISE_|CODEX_HOME$)/.test(k)) delete env[k];
  return {
    ...env,
    HOME: realHome,
    PATH: `${join(realHome, '.local', 'bin')}:${env.PATH ?? ''}`,
    ...extra,
  };
};
const codexOnPath = (): boolean => {
  try {
    return (
      spawnSync('codex', ['--version'], { stdio: 'ignore', timeout: 60_000, env: childEnv() })
        .status === 0
    );
  } catch {
    return false;
  }
};
const live = process.env.MONOMIND_LIVE_CODEX === '1' && codexOnPath();

describe.skipIf(!live)('live codex: allowWrite roots (MONOMIND_LIVE_CODEX=1)', () => {
  it('extra roots are writable; sibling, home and .git (dir, file, hooks) are not', () => {
    const home = mkdtempSync('/var/tmp/cwr-live-'); // the decoy HOME
    const scratch = mkdtempSync('/var/tmp/cwr-live-tmp-');
    const cwd = join(home, 'cwd');
    const extra = join(home, 'extra');
    const extra2 = join(home, 'extra2'); // holds a worktree-style .git FILE
    const hostile = join(home, '-we"ird,]#=\\ ü dir');
    for (const d of [cwd, extra, extra2, hostile, join(home, 'sibling')])
      mkdirSync(d, { recursive: true });
    mkdirSync(join(extra, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(extra2, '.git'), 'gitdir: ../elsewhere\n');

    const probe = join(home, 'probe.sh');
    const q = (p: string) => `'${p}'`; // no single quote in any decoy path
    writeFileSync(
      probe,
      [
        't() { if (echo x >> "$2") 2>/dev/null; then echo "RESULT $1 WRITABLE"; else echo "RESULT $1 READONLY"; fi; }',
        `t cwd ${q(join(cwd, 'p'))}`,
        `t extra ${q(join(extra, 'p'))}`,
        `t sibling ${q(join(home, 'sibling', 'p'))}`,
        `t home ${q(join(home, 'p'))}`,
        `t gitdir ${q(join(extra, '.git', 'p'))}`,
        `t githooks ${q(join(extra, '.git', 'hooks', 'p'))}`,
        `t gitfile ${q(join(extra2, '.git'))}`,
        `t hostile ${q(join(hostile, 'p'))}`,
        '',
      ].join('\n'),
    );

    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--model',
      process.env.MONOMIND_LIVE_CODEX_MODEL ?? 'gpt-5.6-terra',
      '--cd',
      cwd,
      ...codexSandboxArgs('commit', [extra, extra2, hostile]),
      '--',
      '-',
    ];
    const run = spawnSync('codex', args, {
      input: `Run exactly this one shell command and reply with its raw output only: sh ${probe}`,
      encoding: 'utf8',
      timeout: 240_000,
      env: childEnv({ TMPDIR: scratch }),
    });
    const out = `${run.stdout}\n${run.stderr}`;
    const got: Record<string, string> = {};
    for (const m of out.matchAll(/RESULT (\w+) (WRITABLE|READONLY)/g)) got[m[1]] = m[2];

    expect(got, `no probe output; codex said:\n${out.slice(-1500)}`).toHaveProperty('cwd');
    expect(got).toEqual({
      cwd: 'WRITABLE',
      extra: 'WRITABLE',
      hostile: 'WRITABLE',
      sibling: 'READONLY',
      home: 'READONLY',
      gitdir: 'READONLY',
      githooks: 'READONLY',
      gitfile: 'READONLY',
    });
  }, 300_000);
});
