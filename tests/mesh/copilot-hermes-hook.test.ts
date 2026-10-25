import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generateCopilotHooksJson,
  generateMeshBridgeScript,
} from '../../packages/@monomind/cli/src/init/copilot-generator.js';
import { generateAgentsOnlyMd } from '../../packages/@monomind/cli/src/init/write-agents.js';
import { writeCopilotMeshHooks } from '../../packages/@monomind/cli/src/init/write-copilot.js';
import { meshRuntimeFor } from '../../packages/@monomind/cli/src/mcp-tools/mesh-tools.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(helper?: string) {
  const root = mkdtempSync(join(tmpdir(), 'copilot-mesh-'));
  dirs.push(root);
  if (helper !== undefined) {
    mkdirSync(join(root, '.claude', 'helpers'), { recursive: true });
    writeFileSync(join(root, '.claude', 'helpers', 'mesh-inbox.cjs'), helper);
  }
  const script = join(root, 'monomind-mesh.cjs');
  writeFileSync(script, generateMeshBridgeScript());
  return { root, script };
}

const run = (script: string, stdin: string) =>
  new Promise<{ stdout: string; code: number | null }>((resolve) => {
    const child = execFile(process.execPath, [script], (_e, stdout) =>
      resolve({ stdout, code: child.exitCode }),
    );
    child.stdin?.end(stdin);
  });

describe('copilot / hermes mesh bridge', () => {
  it('wraps the helper output in the JSON both hook protocols read', async () => {
    const { root, script } = project('console.log("[MESH] hi");');
    const r = await run(script, JSON.stringify({ cwd: root, hookEventName: 'postToolUse' }));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      additionalContext: '[MESH] hi',
      context: '[MESH] hi',
    });
  });

  it('finds the helper from a subdirectory of the project', async () => {
    const { root, script } = project('console.log("[MESH] up");');
    const sub = join(root, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    const r = await run(script, JSON.stringify({ cwd: sub }));
    expect(JSON.parse(r.stdout).context).toBe('[MESH] up');
  });

  it('is silent and exits 0 without the helper, on a silent or failing helper and on bad stdin', async () => {
    const none = project();
    expect((await run(none.script, JSON.stringify({ cwd: none.root }))).stdout).toBe('');
    const quiet = project('');
    expect((await run(quiet.script, JSON.stringify({ cwd: quiet.root }))).stdout).toBe('');
    const bad = project('process.exit(1);');
    const r = await run(bad.script, JSON.stringify({ cwd: bad.root }));
    expect([r.code, r.stdout]).toEqual([0, '']);
    const junk = await run(bad.script, 'not json');
    expect([junk.code, junk.stdout]).toEqual([0, '']);
  });
});

describe('copilot hook wiring', () => {
  it('runs the bridge on sessionStart and postToolUse, not the dropped userPromptSubmitted', () => {
    const cfg = JSON.parse(generateCopilotHooksJson());
    expect(cfg.version).toBe(1);
    expect(Object.keys(cfg.hooks).sort()).toEqual(['postToolUse', 'sessionStart']);
    for (const hooks of Object.values<{ type: string; bash: string }[]>(cfg.hooks)) {
      expect(hooks).toEqual([
        expect.objectContaining({
          type: 'command',
          bash: 'node .github/hooks/monomind-mesh.cjs',
        }),
      ]);
    }
  });

  it('writes both files once and keeps existing ones unless forced', () => {
    const root = mkdtempSync(join(tmpdir(), 'copilot-init-'));
    dirs.push(root);
    const mk = () => ({
      created: { directories: [], files: [] as string[] },
      skipped: [] as string[],
    });
    const first = mk();
    writeCopilotMeshHooks(root, {} as never, first as never);
    expect(first.created.files).toEqual([
      '.github/hooks/monomind-mesh.cjs',
      '.github/hooks/monomind-mesh.json',
    ]);
    writeFileSync(join(root, '.github/hooks/monomind-mesh.json'), '{"mine":true}');
    const again = mk();
    writeCopilotMeshHooks(root, {} as never, again as never);
    expect(again.skipped).toHaveLength(2);
    expect(readFileSync(join(root, '.github/hooks/monomind-mesh.json'), 'utf8')).toBe(
      '{"mine":true}',
    );
    const forced = mk();
    writeCopilotMeshHooks(root, { force: true } as never, forced as never);
    expect(forced.created.files).toHaveLength(2);
  });

  it('keeps the checked-in hook files equal to the generator output', () => {
    const read = (f: string) => readFileSync(join(__dirname, '../../.github/hooks', f), 'utf8');
    expect(read('monomind-mesh.cjs')).toBe(generateMeshBridgeScript());
    expect(read('monomind-mesh.json')).toBe(generateCopilotHooksJson());
  });
});

describe('runtime labels and fallback line', () => {
  it('maps the real client names of Copilot CLI and Hermes', () => {
    expect(meshRuntimeFor('copilot-cli')).toBe('copilot');
    expect(meshRuntimeFor('mcp')).toBe('hermes');
    expect(meshRuntimeFor('mcp-client')).toBe('mcp-client');
    expect(meshRuntimeFor('claude-code')).toBe('claude-code');
  });

  it('tells AGENTS.md runtimes to read mesh_inbox when the tools exist', () => {
    expect(generateAgentsOnlyMd()).toMatch(/mesh_who.*mesh_send.*mesh_inbox/s);
  });
});
