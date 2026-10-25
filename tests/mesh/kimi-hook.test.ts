import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generateKimiMeshScript,
  generateKimiPluginManifest,
} from '../../packages/@monomind/cli/src/init/kimi-generator.js';
import { meshRuntimeFor } from '../../packages/@monomind/cli/src/mcp-tools/mesh-tools.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(helper?: string) {
  const root = mkdtempSync(join(tmpdir(), 'kimi-mesh-'));
  dirs.push(root);
  if (helper !== undefined) {
    mkdirSync(join(root, '.claude', 'helpers'), { recursive: true });
    writeFileSync(join(root, '.claude', 'helpers', 'mesh-inbox.cjs'), helper);
  }
  const script = join(root, 'monomind-mesh.mjs');
  writeFileSync(script, generateKimiMeshScript());
  return { root, script };
}

const run = (script: string, stdin: string) =>
  new Promise<{ stdout: string; code: number | null }>((resolve) => {
    const child = execFile(process.execPath, [script], (_e, stdout) =>
      resolve({ stdout, code: child.exitCode }),
    );
    child.stdin?.end(stdin);
  });

describe('kimi mesh wiring', () => {
  it('registers the bridge on UserPromptSubmit', () => {
    const manifest = JSON.parse(generateKimiPluginManifest({} as never));
    expect(manifest.hooks).toContainEqual(
      expect.objectContaining({
        event: 'UserPromptSubmit',
        command: 'node ./hooks/monomind-mesh.mjs',
      }),
    );
  });

  it('forwards the helper stdout so kimi appends it to context', async () => {
    const { root, script } = project('console.log("[MESH] hi");');
    const r = await run(script, JSON.stringify({ cwd: root, hook_event_name: 'UserPromptSubmit' }));
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('[MESH] hi\n');
  });

  it('is silent and exits 0 without the helper, on a failing helper and on bad stdin', async () => {
    const none = project();
    expect((await run(none.script, JSON.stringify({ cwd: none.root }))).stdout).toBe('');
    const bad = project('process.exit(1);');
    const r = await run(bad.script, JSON.stringify({ cwd: bad.root }));
    expect([r.code, r.stdout]).toEqual([0, '']);
    const junk = await run(bad.script, 'not json');
    expect([junk.code, junk.stdout]).toEqual([0, '']);
  });

  it('labels kimi sessions "kimi" whatever the client name', () => {
    expect(meshRuntimeFor('Kimi Code CLI')).toBe('kimi');
    expect(meshRuntimeFor('kimi-cli')).toBe('kimi');
    expect(meshRuntimeFor('claude-code')).toBe('claude-code');
    expect(meshRuntimeFor('')).toBe('claude-code');
  });
});
