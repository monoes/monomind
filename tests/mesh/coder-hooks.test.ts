import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clineRule } from '../../packages/@monomind/cli/src/init/write-cline.js';
import {
  CRUSH_MESH_COMMAND,
  DROID_MESH_COMMAND,
  generateCrushMeshScript,
  QWEN_MESH_COMMAND,
  writeCrushFiles,
  writeDroidMeshHook,
  writeQwenFiles,
} from '../../packages/@monomind/cli/src/init/write-mesh-coder-hooks.js';
import { meshRuntimeFor } from '../../packages/@monomind/cli/src/mcp-tools/mesh-tools.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'coder-mesh-'));
  dirs.push(d);
  return d;
};
const newResult = () =>
  ({
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    warnings: [],
  }) as never as {
    created: { files: string[] };
    updated: string[];
    skipped: string[];
    warnings: string[];
  };
const options = (force = false) => ({ force, mcp: { monomind: true, pin: 'latest' } }) as never;
const readJson = (root: string, rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

const sh = (cmd: string, env: Record<string, string>, stdin = '') =>
  new Promise<{ stdout: string; code: number | null }>((resolve) => {
    const child = execFile(
      'sh',
      ['-c', cmd],
      { env: { PATH: process.env.PATH, ...env } },
      (_e, stdout) => resolve({ stdout, code: child.exitCode }),
    );
    child.stdin?.end(stdin);
  });

function withHelper(body: string) {
  const root = tmp();
  mkdirSync(join(root, '.claude', 'helpers'), { recursive: true });
  writeFileSync(join(root, '.claude', 'helpers', 'mesh-inbox.cjs'), body);
  return root;
}

describe('qwen mesh wiring', () => {
  it('writes the MCP server and a UserPromptSubmit hook, idempotently', async () => {
    const root = tmp();
    const r1 = newResult();
    await writeQwenFiles(root, options(), r1 as never);
    const doc = readJson(root, '.qwen/settings.json');
    expect(doc.mcpServers.monomind.command).toBe('npx');
    expect(doc.hooks.UserPromptSubmit[0].hooks[0]).toMatchObject({
      type: 'command',
      command: QWEN_MESH_COMMAND,
    });
    const r2 = newResult();
    await writeQwenFiles(root, options(), r2 as never);
    expect(readJson(root, '.qwen/settings.json')).toEqual(doc);
    expect(r2.skipped).toContain('.qwen/settings.json');
  });

  it("keeps the user's own settings and hooks", async () => {
    const root = tmp();
    mkdirSync(join(root, '.qwen'));
    writeFileSync(
      join(root, '.qwen/settings.json'),
      JSON.stringify({
        theme: 'x',
        hooks: { UserPromptSubmit: [{ hooks: [{ command: 'mine' }] }] },
      }),
    );
    await writeQwenFiles(root, options(), newResult() as never);
    const doc = readJson(root, '.qwen/settings.json');
    expect(doc.theme).toBe('x');
    expect(doc.hooks.UserPromptSubmit).toHaveLength(2);
    expect(doc.hooks.UserPromptSubmit[0].hooks[0].command).toBe('mine');
  });

  it('leaves an unparseable settings file alone and warns', async () => {
    const root = tmp();
    mkdirSync(join(root, '.qwen'));
    writeFileSync(join(root, '.qwen/settings.json'), '{ // comment');
    const r = newResult();
    await writeQwenFiles(root, options(), r as never);
    expect(readFileSync(join(root, '.qwen/settings.json'), 'utf8')).toBe('{ // comment');
    expect(r.warnings[0]).toContain('.qwen/settings.json');
  });

  it('hook command prints the helper stdout when QWEN_PROJECT_DIR points at the project', async () => {
    const root = withHelper('console.log("[MESH] qwen");');
    const r = await sh(QWEN_MESH_COMMAND, { QWEN_PROJECT_DIR: root });
    expect(r.stdout).toBe('[MESH] qwen\n');
  });
});

describe('droid mesh wiring', () => {
  it('creates .factory/hooks.json, or extends hooks.json / settings.json that exist', async () => {
    const fresh = tmp();
    await writeDroidMeshHook(fresh, options(), newResult() as never);
    expect(readJson(fresh, '.factory/mcp.json').mcpServers.monomind).toMatchObject({
      type: 'stdio',
      command: 'npx',
    });
    expect(readJson(fresh, '.factory/hooks.json').UserPromptSubmit[0].hooks[0].command).toBe(
      DROID_MESH_COMMAND,
    );

    const withSettings = tmp();
    mkdirSync(join(withSettings, '.factory'));
    writeFileSync(join(withSettings, '.factory/settings.json'), JSON.stringify({ model: 'm' }));
    await writeDroidMeshHook(withSettings, options(), newResult() as never);
    const settings = readJson(withSettings, '.factory/settings.json');
    expect(settings.model).toBe('m');
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    await writeDroidMeshHook(withSettings, options(), newResult() as never);
    expect(readJson(withSettings, '.factory/settings.json').hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('hook command prints the helper stdout when FACTORY_PROJECT_DIR is set', async () => {
    const root = withHelper('console.log("[MESH] droid");');
    expect((await sh(DROID_MESH_COMMAND, { FACTORY_PROJECT_DIR: root })).stdout).toBe(
      '[MESH] droid\n',
    );
  });
});

describe('crush mesh wiring', () => {
  it('writes crush.json (stdio MCP + PreToolUse hook) and the bridge', async () => {
    const root = tmp();
    await writeCrushFiles(root, options(), newResult() as never);
    const doc = readJson(root, 'crush.json');
    expect(doc.mcp.monomind).toMatchObject({ type: 'stdio', command: 'npx' });
    expect(doc.hooks.PreToolUse).toEqual([
      { name: 'monomind-mesh', command: CRUSH_MESH_COMMAND, timeout: 5 },
    ]);
    await writeCrushFiles(root, options(), newResult() as never);
    expect(readJson(root, 'crush.json').hooks.PreToolUse).toHaveLength(1);
    expect(readFileSync(join(root, '.crush/hooks/monomind-mesh.cjs'), 'utf8')).toBe(
      generateCrushMeshScript(),
    );
  });

  it('bridge wraps the helper output as the context envelope crush appends', async () => {
    const root = withHelper('console.log("[MESH] hi");');
    mkdirSync(join(root, '.crush', 'hooks'), { recursive: true });
    writeFileSync(join(root, '.crush/hooks/monomind-mesh.cjs'), generateCrushMeshScript());
    const payload = JSON.stringify({ event: 'PreToolUse', cwd: root, tool_name: 'bash' });
    const r = await sh(CRUSH_MESH_COMMAND, { CRUSH_PROJECT_DIR: root }, payload);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ context: '[MESH] hi' });
  });

  it('bridge is silent with no helper, an empty inbox, a failing helper and junk stdin', async () => {
    const none = tmp();
    mkdirSync(join(none, '.crush', 'hooks'), { recursive: true });
    writeFileSync(join(none, '.crush/hooks/monomind-mesh.cjs'), generateCrushMeshScript());
    expect((await sh(CRUSH_MESH_COMMAND, { CRUSH_PROJECT_DIR: none }, '{}')).stdout).toBe('');
    for (const body of ['', 'process.exit(1);']) {
      const root = withHelper(body);
      mkdirSync(join(root, '.crush', 'hooks'), { recursive: true });
      writeFileSync(join(root, '.crush/hooks/monomind-mesh.cjs'), generateCrushMeshScript());
      const r = await sh(CRUSH_MESH_COMMAND, { CRUSH_PROJECT_DIR: root }, 'not json');
      expect([r.code, r.stdout]).toEqual([0, '']);
    }
  });
});

describe('runtime labels and the cline fallback', () => {
  it('maps real qwen client names to qwen and leaves crush as sent', () => {
    expect(meshRuntimeFor('qwen-code-mcp-client')).toBe('qwen');
    expect(meshRuntimeFor('qwen-cli-mcp-client-monomind')).toBe('qwen');
    expect(meshRuntimeFor('crush')).toBe('crush');
  });

  it('tells cline sessions to poll mesh_inbox, since cline has no usable hook', () => {
    expect(clineRule()).toContain('mesh_inbox');
  });
});
