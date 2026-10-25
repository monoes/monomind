import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hubCallStarting } from '../../.pi/extensions/monomind-mesh.js';
import { meshCommand } from '../../packages/@monomind/cli/src/commands/mesh.js';
import {
  generateKiloMeshPlugin,
  KILO_MESH_PLUGIN_FILE,
} from '../../packages/@monomind/cli/src/init/opencode-mesh-plugin.js';
import type { InitOptions, InitResult } from '../../packages/@monomind/cli/src/init/types.js';
import { writeKiloMeshPlugin } from '../../packages/@monomind/cli/src/init/write-kilo.js';
import { meshRuntimeFor } from '../../packages/@monomind/cli/src/mcp-tools/mesh-tools.js';
import { MeshHub } from '../../packages/@monomind/cli/src/mesh/hub.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'kdp-'));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}
const result = (): InitResult =>
  ({ created: { files: [] as string[] }, skipped: [] as string[], errors: [] }) as never;

describe('dsh', () => {
  it('maps the dsh MCP client name to the dsh runtime', () => {
    expect(meshRuntimeFor('dsh-mcp-client')).toBe('dsh');
    expect(meshRuntimeFor('dsh')).toBe('dsh');
    expect(meshRuntimeFor('claude-code')).toBe('claude-code');
  });
});

describe('kilo mesh plugin', () => {
  async function loadPlugin(root: string) {
    const file = join(root, 'monomind-mesh.mjs');
    writeFileSync(file, generateKiloMeshPlugin());
    const mod = (await import(pathToFileURL(file).href)) as {
      default: { id: string; server: (ctx: unknown) => Promise<Record<string, any>> };
    };
    return mod.default;
  }

  it('is a default-exported { id, server } module with the chat.message and event hooks', async () => {
    const root = tmpDir();
    const plugin = await loadPlugin(root);
    expect(plugin.id).toBe('monomind-mesh');
    const hooks = await plugin.server({ directory: root, worktree: root, client: {} });
    expect(typeof hooks['chat.message']).toBe('function');
    expect(typeof hooks.event).toBe('function');
  });

  it('appends the inbox as a synthetic text part and titles a new top-level session', async () => {
    const root = tmpDir();
    const helpers = join(root, '.claude', 'helpers');
    mkdirSync(helpers, { recursive: true });
    writeFileSync(
      join(helpers, 'mesh-inbox.cjs'),
      'process.stdout.write("[MESH] 1 new message(s)");',
    );
    writeFileSync(
      join(helpers, 'mesh-title.cjs'),
      'process.stdout.write(JSON.stringify({hookSpecificOutput:{sessionTitle:"app-0925"}}));',
    );
    const update = vi.fn(async () => ({}));
    const hooks = await (await loadPlugin(root)).server({
      directory: root,
      worktree: root,
      client: { session: { update } },
    });

    const output = { message: { id: 'msg_1' }, parts: [] as Array<Record<string, unknown>> };
    await hooks['chat.message']({ sessionID: 's1' }, output);
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]).toMatchObject({
      sessionID: 's1',
      messageID: 'msg_1',
      type: 'text',
      text: '[MESH] 1 new message(s)',
      synthetic: true,
    });

    await hooks.event({
      event: { type: 'session.created', properties: { info: { id: 's1', parentID: 'p' } } },
    });
    expect(update).not.toHaveBeenCalled();
    await hooks.event({
      event: { type: 'session.created', properties: { info: { id: 's2' } } },
    });
    expect(update).toHaveBeenCalledWith({ path: { id: 's2' }, body: { title: 'app-0925' } });
  });

  it('does nothing when the helpers are absent', async () => {
    const root = tmpDir();
    const hooks = await (await loadPlugin(root)).server({ directory: root, worktree: root });
    const output = { message: { id: 'm' }, parts: [] as unknown[] };
    await hooks['chat.message']({ sessionID: 's' }, output);
    expect(output.parts).toEqual([]);
  });

  it('is written only for a project that uses kilo, and kept unless --force', () => {
    const plain = tmpDir();
    const r0 = result();
    writeKiloMeshPlugin(plain, {} as InitOptions, r0);
    expect(r0.created.files).toEqual([]);

    const kilo = tmpDir();
    mkdirSync(join(kilo, '.kilo'));
    const r1 = result();
    writeKiloMeshPlugin(kilo, {} as InitOptions, r1);
    expect(r1.created.files).toEqual([KILO_MESH_PLUGIN_FILE]);
    const r2 = result();
    writeKiloMeshPlugin(kilo, {} as InitOptions, r2);
    expect(r2.skipped).toEqual([KILO_MESH_PLUGIN_FILE]);
    const r3 = result();
    writeKiloMeshPlugin(kilo, { force: true } as InitOptions, r3);
    expect(r3.created.files).toEqual([KILO_MESH_PLUGIN_FILE]);
  });
});

describe('pi starts the hub', () => {
  const fast = { retryDelayMs: 5, retries: 20, backoffMs: 60_000 };

  it('launches the hub once when it is down, then the call succeeds', async () => {
    const dir = join(tmpDir(), 'mesh');
    const launch = vi.fn(async (d: string) => {
      const hub = await MeshHub.start({ dir: d, host: 'h', isAlive: () => true });
      cleanups.push(() => hub.stop());
      return true;
    });
    const [a, b] = await Promise.all([
      hubCallStarting({ op: 'who', id: '1' }, dir, '/w', { ...fast, launch }),
      hubCallStarting({ op: 'who', id: '2' }, dir, '/w', { ...fast, launch }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(dir, '/w');
  });

  it('does not launch when the hub is already up', async () => {
    const dir = tmpDir();
    const hub = await MeshHub.start({ dir, host: 'h', isAlive: () => true });
    cleanups.push(() => hub.stop());
    const launch = vi.fn(async () => true);
    const r = await hubCallStarting({ op: 'who', id: '1' }, dir, '/w', { ...fast, launch });
    expect(r.ok).toBe(true);
    expect(launch).not.toHaveBeenCalled();
  });

  it('fails fast and stops launching after no monomind binary was found', async () => {
    const dir = join(tmpDir(), 'mesh');
    const launch = vi.fn(async () => false);
    await expect(
      hubCallStarting({ op: 'who', id: '1' }, dir, '/w', { ...fast, launch }),
    ).rejects.toThrow('mesh offline');
    await expect(
      hubCallStarting({ op: 'who', id: '2' }, dir, '/w', { ...fast, launch }),
    ).rejects.toThrow('mesh offline');
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('cools down after a hub that launched but never came up', async () => {
    const dir = join(tmpDir(), 'mesh');
    const launch = vi.fn(async () => true);
    const o = { launch, retryDelayMs: 1, retries: 3, backoffMs: 0 };
    await expect(hubCallStarting({ op: 'who', id: '1' }, dir, '/w', o)).rejects.toThrow(
      'mesh offline',
    );
    await expect(hubCallStarting({ op: 'who', id: '2' }, dir, '/w', o)).rejects.toThrow(
      'mesh offline',
    );
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('never launches when MONOMIND_MESH_HUB_START=0', async () => {
    vi.stubEnv('MONOMIND_MESH_HUB_START', '0');
    const launch = vi.fn(async () => true);
    await expect(
      hubCallStarting({ op: 'who', id: '1' }, join(tmpDir(), 'mesh'), '/w', { ...fast, launch }),
    ).rejects.toThrow('mesh offline');
    expect(launch).not.toHaveBeenCalled();
  });
});

describe('monomind mesh hub', () => {
  it('is a hidden subcommand of mesh', () => {
    const hub = meshCommand.subcommands?.find((c) => c.name === 'hub');
    expect(hub?.hidden).toBe(true);
  });
});
