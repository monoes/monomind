import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const dist = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../packages/@monomind/cli/dist/src/mesh',
);
const built = existsSync(join(dist, 'client.js'));
const dirs: string[] = [];

/** Hub processes started for exactly this mesh dir (never another user/session's hub). */
function hubPids(dir: string): number[] {
  let out = '';
  try {
    out = execFileSync('pgrep', ['-f', 'hub-main.js']).toString();
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map(Number)
    .filter((pid) => {
      try {
        return readFileSync(`/proc/${pid}/environ`, 'utf8')
          .split('\0')
          .includes(`MONOMIND_MESH_DIR=${dir}`);
      } catch {
        return false;
      }
    });
}

/** Polls until at most one hub process remains for `dir` (or ~20 s pass), then returns them. */
async function settledHubPids(dir: string): Promise<number[]> {
  let pids = hubPids(dir);
  for (let i = 0; i < 100 && pids.length > 1; i++) {
    await new Promise((r) => setTimeout(r, 200));
    pids = hubPids(dir);
  }
  return pids;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    for (const pid of hubPids(d)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    rmSync(d, { recursive: true, force: true });
  }
});

describe.skipIf(!built)('hub as a real process', () => {
  it('starts lazily, serves concurrent first callers with one hub, and recovers after kill -9', async () => {
    const dir = mkdtempSync(join('/var/tmp', 'mesh-'));
    dirs.push(dir);
    const { callWithHub, meshCall } = await import(pathToFileURL(join(dist, 'client.js')).href);
    const hello = (n: number) => ({
      op: 'hello',
      id: `h${n}`,
      tier: 'session',
      runtime: 't',
      pid: process.pid,
      project: 'p',
      projectPath: '/w',
      sessionId: `s${n}`,
    });

    const replies = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => callWithHub(hello(n), { dir, timeoutMs: 2000 })),
    );
    expect(replies.every((r: { ok: boolean }) => r.ok)).toBe(true);
    const who = await meshCall({ op: 'who', id: 'w' }, { dir });
    expect(who.agents).toHaveLength(5);

    // The four spawns that lost the lock exit on their own, but on a loaded host they are
    // still starting up when the replies arrive: wait until only the winning hub is left.
    const pids = await settledHubPids(dir);
    expect(pids).toHaveLength(1);
    process.kill(pids[0], 'SIGKILL');
    await new Promise((r) => setTimeout(r, 200));

    const again = await callWithHub(hello(9), { dir, timeoutMs: 2000 });
    expect(again.ok).toBe(true);
    expect(await settledHubPids(dir)).toHaveLength(1);
  }, 60_000);
});
