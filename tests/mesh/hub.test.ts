import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callWithHub,
  MeshOfflineError,
  meshCall,
} from '../../packages/@monomind/cli/src/mesh/client.js';
import { MeshHub } from '../../packages/@monomind/cli/src/mesh/hub.js';
import { DaemonLockError } from '../../packages/@monomind/cli/src/orgrt/daemon-lock.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tmpDir(): string {
  const d = mkdtempSync(join('/var/tmp', 'mesh-'));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}
async function startHub(dir: string, extra: Partial<Parameters<typeof MeshHub.start>[0]> = {}) {
  const hub = await MeshHub.start({ dir, host: 'h', isAlive: () => true, ...extra });
  cleanups.push(() => hub.stop());
  return hub;
}
const hello = (over: Record<string, unknown> = {}) => ({
  op: 'hello',
  id: 'r1',
  tier: 'session',
  runtime: 'claude-code',
  pid: 4242,
  project: 'p1',
  projectPath: '/w/p1',
  sessionId: 's1',
  ...over,
});

describe('MeshHub', () => {
  it('creates a 0700 directory and registers an agent visible to who', async () => {
    const dir = tmpDir();
    await startHub(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const h = await meshCall(hello(), { dir });
    expect(h).toMatchObject({ ok: true, addr: 'h/p1/s1' });
    expect(h.key).toMatch(/^[0-9a-f]{64}$/);
    const w = await meshCall({ op: 'who', id: 'r2' }, { dir });
    expect((w.agents as Array<{ addr: string }>).map((a) => a.addr)).toEqual(['h/p1/s1']);
  });

  it('requires the issued key for heartbeat and bye', async () => {
    const dir = tmpDir();
    await startHub(dir);
    const { addr, key } = await meshCall(hello(), { dir });
    expect(await meshCall({ op: 'heartbeat', id: 'a', addr, key: 'bad' }, { dir })).toMatchObject({
      ok: false,
      error: 'unauthorized',
    });
    expect(await meshCall({ op: 'heartbeat', id: 'b', addr, key }, { dir })).toMatchObject({
      ok: true,
    });
    expect(await meshCall({ op: 'bye', id: 'c', addr, key: 'bad' }, { dir })).toMatchObject({
      ok: false,
      error: 'unauthorized',
    });
    expect(await meshCall({ op: 'bye', id: 'd', addr, key }, { dir })).toMatchObject({ ok: true });
    const w = await meshCall({ op: 'who', id: 'e' }, { dir });
    expect(w.agents).toEqual([]);
  });

  it('answers invalid requests and alias clashes without crashing', async () => {
    const dir = tmpDir();
    await startHub(dir);
    expect(await meshCall({ op: 'nuke', id: 'x' }, { dir })).toMatchObject({
      ok: false,
      error: 'invalid',
    });
    await meshCall(hello({ alias: 'rev' }), { dir });
    expect(await meshCall(hello({ sessionId: 's2', alias: 'rev' }), { dir })).toMatchObject({
      ok: false,
      error: 'alias_taken',
    });
  });

  it('marks agents stale then gone as time passes, and a gone agent must re-hello', async () => {
    const dir = tmpDir();
    let now = 1_000_000;
    const hub = await startHub(dir, { now: () => now });
    const { addr, key } = await meshCall(hello(), { dir });
    now += 35_000;
    hub.sweepNow();
    let w = await meshCall({ op: 'who', id: 'w1', status: 'stale' }, { dir });
    expect((w.agents as unknown[]).length).toBe(1);
    now += 60_000;
    hub.sweepNow();
    w = await meshCall({ op: 'who', id: 'w2' }, { dir });
    expect(w.agents).toEqual([]);
    expect(await meshCall({ op: 'heartbeat', id: 'h', addr, key }, { dir })).toMatchObject({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('refuses a second hub on the same directory', async () => {
    const dir = tmpDir();
    await startHub(dir);
    await expect(MeshHub.start({ dir, host: 'h' })).rejects.toBeInstanceOf(DaemonLockError);
  });

  it('calls onIdle once no agent has been live for idleExitMs', async () => {
    const dir = tmpDir();
    let now = 0;
    const onIdle = vi.fn();
    const hub = await startHub(dir, { now: () => now, idleExitMs: 120_000, onIdle });
    hub.sweepNow();
    expect(onIdle).not.toHaveBeenCalled();
    now += 121_000;
    hub.sweepNow();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('drops a connection that sends an oversized line', async () => {
    const dir = tmpDir();
    await startHub(dir);
    await expect(
      meshCall({ op: 'who', id: 'big', pad: 'x'.repeat(70_000) }, { dir }),
    ).rejects.toBeInstanceOf(MeshOfflineError);
  });
});

describe('client', () => {
  it('reports offline when no hub is listening', async () => {
    await expect(
      meshCall({ op: 'who', id: '1' }, { dir: tmpDir(), timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(MeshOfflineError);
  });

  it('spawns the hub once on first use and then succeeds', async () => {
    const dir = tmpDir();
    const spawnHub = vi.fn((d: string) => {
      void MeshHub.start({ dir: d, host: 'h', isAlive: () => true }).then((hub) =>
        cleanups.push(() => hub.stop()),
      );
    });
    const r = await callWithHub(hello(), { dir, spawnHub, retryDelayMs: 20, retries: 50 });
    expect(r).toMatchObject({ ok: true, addr: 'h/p1/s1' });
    expect(spawnHub).toHaveBeenCalledTimes(1);
  });

  it('gives up with MeshOfflineError when the spawned hub never appears', async () => {
    await expect(
      callWithHub(
        { op: 'who', id: '1' },
        { dir: tmpDir(), spawnHub: () => {}, retries: 2, retryDelayMs: 10, timeoutMs: 50 },
      ),
    ).rejects.toBeInstanceOf(MeshOfflineError);
  });
});
