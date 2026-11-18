import { execFile, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { psReadsProcessTable } from '../../packages/@monomind/cli/src/__tests__/ps-probe.js';
import { meshCall } from '../../packages/@monomind/cli/src/mesh/client.js';
import { MeshHub } from '../../packages/@monomind/cli/src/mesh/hub.js';
import { projectIdFor } from '../../packages/@monomind/cli/src/mesh/project-id.js';
import {
  claimSessionName,
  isWrapperCommand,
  settleSessionName,
} from '../../packages/@monomind/cli/src/mesh/session-files.js';

const HOOK = join(__dirname, '../../.claude/helpers/mesh-title.cjs');
const noPs = !psReadsProcessTable('title-hook');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const meshDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'mesh-'));
  dirs.push(d);
  return d;
};
const runHook = (dir: string, input: object, preload: string[] = []) =>
  new Promise<string>((resolve) => {
    const child = execFile(
      process.execPath,
      [...preload, HOOK],
      { env: { ...process.env, MONOMIND_MESH_DIR: dir } },
      (_e, stdout) => resolve(stdout),
    );
    child.stdin?.end(JSON.stringify(input));
  });
const titleOf = (out: string) => JSON.parse(out).hookSpecificOutput.sessionTitle as string;

/** A stand-in agent host: runs the hook as its child (behind `sh -c` when `wrap`), like Claude Code. */
const HOST = `const { execFileSync } = require('node:child_process');
const [hook, clock, wrap] = process.argv.slice(2);
const args = clock ? ['-r', clock, hook] : [hook];
const input = JSON.stringify({ cwd: '/w/p' });
const out = wrap
  ? execFileSync('sh', ['-c', '"$0" "$@"; :', process.execPath, ...args], { input })
  : execFileSync(process.execPath, args, { input });
process.stdout.write(JSON.stringify({ pid: process.pid, out: String(out) }));`;
const clockAt = (dir: string, t: number[]) => {
  const file = join(dir, `clock-${t.join('')}.cjs`);
  writeFileSync(
    file,
    `const R = Date; const T = ${JSON.stringify(t)};
     global.Date = class extends R { constructor(...a) { super(...(a.length ? a : T)); } };`,
  );
  return file;
};
const runHost = (dir: string, clock = '', wrap = '') =>
  new Promise<{ pid: number; title: string }>((resolve, reject) => {
    const host = join(dir, 'host.cjs');
    writeFileSync(host, HOST);
    execFile(
      process.execPath,
      [host, HOOK, clock, wrap],
      { env: { ...process.env, MONOMIND_MESH_DIR: dir } },
      (e, stdout) => {
        if (e) return reject(e);
        const r = JSON.parse(stdout);
        resolve({ pid: r.pid, title: titleOf(r.out) });
      },
    );
  });

describe('mesh-title hook', () => {
  it('titles the session <project>-<date>-<time> and keeps that name', async () => {
    const dir = meshDir();
    const out = JSON.parse(await runHook(dir, { cwd: '/work/my proj', source: 'startup' }));
    expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart');
    const title = out.hookSpecificOutput.sessionTitle as string;
    expect(title).toMatch(/^my-proj-\d{8}-\d{6}$/);
    expect(titleOf(await runHook(dir, { cwd: '/elsewhere' }))).toBe(title);
  });

  it('leaves a session the user already named alone', async () => {
    expect(await runHook(meshDir(), { cwd: '/w/p', session_title: 'mine' })).toBe('');
  });

  // reason: both sides find the session pid by walking parents with ps, which a Seatbelt sandbox denies (#798)
  it.skipIf(noPs)(
    'is the name the MCP side then adopts, and settles on a suffixed one',
    async () => {
      const dir = meshDir();
      // The hook is this process's child, so this process stands in for its host.
      const title = titleOf(await runHook(dir, { cwd: '/w/p' }));
      expect(claimSessionName(dir, () => 'other-20000101-000000', process.pid)).toBe(title);
      settleSessionName(dir, `${title}-2`, process.pid);
      expect(claimSessionName(dir, () => 'x', process.pid)).toBe(`${title}-2`);
      expect(readFileSync(join(dir, 'sessions', `${process.pid}.name`), 'utf8')).toBe(`${title}-2`);
    },
  );

  it('claimSessionName writes the name for a hook that starts later', () => {
    const dir = meshDir();
    expect(claimSessionName(dir, () => 'p-20261024-143005')).toBe('p-20261024-143005');
    expect(claimSessionName(dir, () => 'p-20261024-999999')).toBe('p-20261024-143005');
  });

  it('skips names that are already live in the project', async () => {
    const dir = meshDir();
    const clock = join(dir, 'clock.cjs');
    writeFileSync(
      clock,
      `const R = Date; const T = [2026, 9, 24, 14, 30, 5];
       global.Date = class extends R { constructor(...a) { super(...(a.length ? a : T)); } };`,
    );
    const hub = await MeshHub.start({ dir, host: 'h', isAlive: () => true });
    try {
      const project = projectIdFor('/w/p');
      for (const [i, alias] of ['p-20261024-143005', 'p-20261024-143005-2'].entries()) {
        await meshCall(
          {
            op: 'hello',
            id: `h${i}`,
            tier: 'session',
            runtime: 'claude-code',
            pid: 4242,
            project,
            projectPath: '/w/p',
            sessionId: `s${i}`,
            alias,
          },
          { dir },
        );
      }
      const out = await runHook(dir, { cwd: '/w/p' }, ['-r', clock]);
      expect(titleOf(out)).toBe('p-20261024-143005-3');
    } finally {
      await hub.stop();
    }
  });

  it('gives each session started from the same shell its own name', async () => {
    // This process is the long-lived shell; each host is a session started from it.
    const dir = meshDir();
    const a = await runHost(dir, clockAt(dir, [2026, 10, 17, 22, 32, 16]));
    const b = await runHost(dir, clockAt(dir, [2026, 10, 17, 23, 5, 0]));
    expect(a.title).toBe('p-20261117-223216');
    expect(b.title).toBe('p-20261117-230500');
    expect(existsSync(join(dir, 'sessions', `${process.pid}.name`))).toBe(false);
  });

  // reason: finding the host behind `sh -c` reads the wrapper's command line with ps, which a Seatbelt sandbox denies (#798)
  it.skipIf(noPs)('keys the name on the host behind a sh -c wrapper, not the shell', async () => {
    const dir = meshDir();
    const { pid } = await runHost(dir, '', 'wrap');
    expect(readdirSync(join(dir, 'sessions'))).toEqual([`${pid}.name`]);
  });

  it('drops the files of sessions that are gone', async () => {
    const dir = meshDir();
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    for (const ext of ['name', 'json'])
      writeFileSync(join(dir, 'sessions', `${dead}.${ext}`), 'old-1');
    await runHook(dir, { cwd: '/w/p' });
    expect(readdirSync(join(dir, 'sessions')).filter((f) => f.startsWith(`${dead}.`))).toEqual([]);
  });

  it('tells sh -c and npx wrappers from hosts and interactive shells', () => {
    for (const w of [
      'sh -c p=x; exec node /p/.claude/helpers/mesh-title.cjs',
      '/bin/zsh -c node hook.cjs',
      'bash -lc node hook.cjs',
      'npm exec monomind mcp start',
      'npx -y monomind@latest mcp start',
      'node /usr/lib/node_modules/npm/bin/npx-cli.js -y monomind mcp start',
      'pnpm dlx monomind mcp start',
    ])
      expect(isWrapperCommand(w), w).toBe(true);
    for (const h of [
      'claude',
      'claude --resume 3886',
      '-zsh',
      '/bin/zsh',
      'zsh -l',
      'opencode',
      'node /x/node_modules/.bin/monomind mcp start',
      '',
    ])
      expect(isWrapperCommand(h), h).toBe(false);
  });
});
