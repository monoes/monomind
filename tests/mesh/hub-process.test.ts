import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import * as srcClient from '../../packages/@monomind/cli/src/mesh/client.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = join(root, 'packages/@monomind/cli/src/mesh');
const distDir = join(root, 'packages/@monomind/cli/dist/src/mesh');
const built = existsSync(join(distDir, 'hub-main.js'));
const dirs: string[] = [];

/** Hub processes started for exactly this mesh dir (never another user/session's hub). */
function hubPids(dir: string): number[] {
  let out = '';
  try {
    out = execFileSync('pgrep', ['-f', 'mesh/hub-main']).toString();
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

type Client = typeof srcClient;

/**
 * The same story for both ways of running the hub: first callers start it lazily, exactly one hub
 * survives, and after kill -9 the next caller starts a new one.
 */
async function scenario(client: Client, spawnHub?: (dir: string) => void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'mesh-'));
  dirs.push(dir);
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
  // retries: 150 (~22 s) - this tests the processes, not the client's default budget; a host
  // with load well above its core count can take seconds just to boot node.
  const opts = { dir, timeoutMs: 2000, retries: 150, ...(spawnHub ? { spawnHub } : {}) };

  const replies = await Promise.all([1, 2, 3, 4, 5].map((n) => client.callWithHub(hello(n), opts)));
  expect(replies.every((r) => r.ok)).toBe(true);
  const who = await client.meshCall({ op: 'who', id: 'w' }, { dir });
  expect(who.agents).toHaveLength(5);

  // The spawns that lost the lock exit on their own, but on a loaded host they are still
  // starting up when the replies arrive: wait until only the winning hub is left.
  const pids = await settledHubPids(dir);
  expect(pids).toHaveLength(1);
  process.kill(pids[0], 'SIGKILL');
  await new Promise((r) => setTimeout(r, 200));

  const again = await client.callWithHub(hello(9), opts);
  expect(again.ok).toBe(true);
  expect(await settledHubPids(dir)).toHaveLength(1);
}

describe('hub as a real process', () => {
  it('runs from source (tsx), so this test never depends on a build', async () => {
    const viaTsx = (dir: string) =>
      void spawn(process.execPath, ['--import', 'tsx', join(srcDir, 'hub-main.ts')], {
        cwd: root,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, MONOMIND_MESH_DIR: dir },
      }).unref();
    await scenario(srcClient, viaTsx);
  }, 90_000);

  it.skipIf(!built)(
    'runs from the built package through the default spawn path',
    async () => {
      const client = (await import(pathToFileURL(join(distDir, 'client.js')).href)) as Client;
      await scenario(client);
    },
    90_000,
  );
});
