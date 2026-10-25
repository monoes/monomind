import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { meshCall } from '../../packages/@monomind/cli/src/mesh/client.js';
import { MeshHub } from '../../packages/@monomind/cli/src/mesh/hub.js';
import { projectIdFor } from '../../packages/@monomind/cli/src/mesh/project-id.js';
import {
  claimSessionName,
  settleSessionName,
} from '../../packages/@monomind/cli/src/mesh/session-files.js';

const HOOK = join(__dirname, '../../.claude/helpers/mesh-title.cjs');
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

  it('is the name the MCP side then adopts, and settles on a suffixed one', async () => {
    const dir = meshDir();
    const title = titleOf(await runHook(dir, { cwd: '/w/p' }));
    expect(claimSessionName(dir, () => 'other-20000101-000000')).toBe(title);
    settleSessionName(dir, `${title}-2`);
    expect(claimSessionName(dir, () => 'x')).toBe(`${title}-2`);
    expect(readFileSync(join(dir, 'sessions', `${process.ppid}.name`), 'utf8')).toBe(`${title}-2`);
  });

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
});
