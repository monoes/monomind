/**
 * The Monomind Mesh inbox reaches the other CLIs: Codex through its generated hook bridge,
 * opencode through the hook-shim plugin, agy through .agents/hooks.json. Grok and Cursor
 * run the checked-in config; the rest get a one-line instruction. The helper's own output
 * formats are covered in tests/mesh/inbox-hook.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  generateCodexAgentsMd,
  generateCodexHookScript,
  generateCodexHooksConfig,
} from '../init/codex-generator.js';
import { generateGeminiRulesMd } from '../init/geminimd-generator.js';
import { generateHooksPlugin } from '../init/opencode-generator.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { generateAgentsOnlyMd } from '../init/write-agents.js';
import { writeGeminiFiles } from '../init/write-antigravity.js';

const ROOT = resolve(__dirname, '../../../../..');
const readRepo = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mesh-cli-hooks-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A project whose mesh-inbox helper just prints `output` (stands in for the real one). */
function projectWithInbox(
  root: string,
  helper: 'mesh-inbox.cjs' | 'mesh-title.cjs',
  output: string,
) {
  mkdirSync(join(root, '.claude', 'helpers'), { recursive: true });
  writeFileSync(
    join(root, '.claude', 'helpers', helper),
    `process.stdout.write(${JSON.stringify(output)} + (process.argv.slice(2).join(" ")));`,
  );
}

function freshResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    removed: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

describe('Codex', () => {
  it('registers the bridge for UserPromptSubmit', () => {
    const toml = generateCodexHooksConfig();
    expect(toml).toContain('[[hooks.UserPromptSubmit]]');
    expect(toml).toMatch(
      /\[\[hooks\.UserPromptSubmit\.hooks\]\]\ntype = "command"\ncommand = "node \.codex\/hooks\/monomind-hook\.cjs"/,
    );
  });

  const runBridge = (cwd: string, event: string) =>
    execFileSync(process.execPath, [join(cwd, '.codex', 'hooks', 'monomind-hook.cjs')], {
      input: JSON.stringify({ hook_event_name: event, cwd }),
      encoding: 'utf8',
    });

  it('prints what mesh-inbox prints for Codex on a prompt, even with no gate handler installed', () => {
    mkdirSync(join(dir, '.codex', 'hooks'), { recursive: true });
    writeFileSync(join(dir, '.codex', 'hooks', 'monomind-hook.cjs'), generateCodexHookScript());
    projectWithInbox(dir, 'mesh-inbox.cjs', 'inbox:');
    expect(runBridge(dir, 'UserPromptSubmit')).toBe('inbox:--host codex');
  });

  it('stays silent on a prompt when the helper is not installed', () => {
    mkdirSync(join(dir, '.codex', 'hooks'), { recursive: true });
    writeFileSync(join(dir, '.codex', 'hooks', 'monomind-hook.cjs'), generateCodexHookScript());
    expect(runBridge(dir, 'UserPromptSubmit')).toBe('');
  });

  it('does not hand a prompt event to the gate handler', () => {
    mkdirSync(join(dir, '.codex', 'hooks'), { recursive: true });
    writeFileSync(join(dir, '.codex', 'hooks', 'monomind-hook.cjs'), generateCodexHookScript());
    projectWithInbox(dir, 'mesh-inbox.cjs', '');
    writeFileSync(join(dir, '.claude', 'helpers', 'hook-handler.cjs'), 'process.exit(2);');
    expect(runBridge(dir, 'UserPromptSubmit')).toBe('--host codex');
  });
});

describe('instruction line for CLIs without a verified hook', () => {
  it.each([
    ['agents-only AGENTS.md', generateAgentsOnlyMd()],
    ['Codex AGENTS.md', generateCodexAgentsMd()],
    ['agy rules', generateGeminiRulesMd(DEFAULT_INIT_OPTIONS)],
  ])('%s names the mesh tools', (_name, md) => {
    expect(md).toContain('mesh_inbox');
    expect(md).toContain('mesh_who');
    expect(md).toContain('mesh_send');
  });
});

describe('agy .agents/hooks.json', () => {
  const options = {
    ...DEFAULT_INIT_OPTIONS,
    targetDir: '',
    components: { ...DEFAULT_INIT_OPTIONS.components, helpers: true },
  };
  const hooksPath = () => join(dir, '.agents', 'hooks.json');
  const installHelper = () => {
    mkdirSync(join(dir, '.gemini', 'helpers'), { recursive: true });
    writeFileSync(join(dir, '.gemini', 'helpers', 'mesh-inbox.cjs'), '');
  };

  it('wires PreInvocation to the mesh helper when it is installed', async () => {
    installHelper();
    const result = freshResult();
    await writeGeminiFiles(dir, { ...options, targetDir: dir }, result);
    const hooks = JSON.parse(readFileSync(hooksPath(), 'utf8'));
    expect(hooks['monomind-mesh'].PreInvocation).toEqual([
      { type: 'command', command: 'node ../.gemini/helpers/mesh-inbox.cjs --host agy', timeout: 5 },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('writes nothing when the helper is missing', async () => {
    await writeGeminiFiles(dir, { ...options, targetDir: dir }, freshResult());
    expect(() => readFileSync(hooksPath())).toThrow();
  });

  it('keeps hooks the project already has and does not repeat its own entry', async () => {
    installHelper();
    mkdirSync(join(dir, '.agents'), { recursive: true });
    writeFileSync(hooksPath(), JSON.stringify({ lint: { Stop: [{ command: './lint.sh' }] } }));
    await writeGeminiFiles(dir, { ...options, targetDir: dir }, freshResult());
    const once = readFileSync(hooksPath(), 'utf8');
    expect(Object.keys(JSON.parse(once))).toEqual(['lint', 'monomind-mesh']);
    await writeGeminiFiles(dir, { ...options, targetDir: dir, force: true }, freshResult());
    expect(readFileSync(hooksPath(), 'utf8')).toBe(once);
  });

  it('leaves a hooks.json it cannot parse alone and says so', async () => {
    installHelper();
    mkdirSync(join(dir, '.agents'), { recursive: true });
    writeFileSync(hooksPath(), '{ not json');
    const result = freshResult();
    await writeGeminiFiles(dir, { ...options, targetDir: dir }, result);
    expect(readFileSync(hooksPath(), 'utf8')).toBe('{ not json');
    expect(result.errors.join()).toContain('.agents/hooks.json');
  });
});

describe('opencode plugin', () => {
  async function loadPlugin(root: string) {
    const file = join(root, 'plugin.mjs');
    writeFileSync(file, generateHooksPlugin());
    const updates: unknown[] = [];
    const ctx = {
      directory: root,
      worktree: root,
      client: { session: { update: async (a: unknown) => void updates.push(a) } },
    };
    const mod = await import(pathToFileURL(file).href);
    return { hooks: await mod.MonomindHooks(ctx), updates };
  }

  it('adds the inbox text to the prompt as a synthetic part', async () => {
    projectWithInbox(dir, 'mesh-inbox.cjs', '[MESH] peer says hi ');
    const { hooks } = await loadPlugin(dir);
    const output = {
      message: { id: 'msg_1' },
      parts: [{ type: 'text', text: 'hello' }] as unknown[],
    };
    await hooks['chat.message']({ sessionID: 'ses_1' }, output);
    expect(output.parts).toHaveLength(2);
    expect(output.parts[1]).toMatchObject({
      sessionID: 'ses_1',
      messageID: 'msg_1',
      type: 'text',
      text: '[MESH] peer says hi',
      synthetic: true,
    });
    expect((output.parts[1] as { id: string }).id).toMatch(/^prt_/);
  });

  it('adds nothing when there is no mail or no helper', async () => {
    const { hooks } = await loadPlugin(dir);
    const output = { message: { id: 'm' }, parts: [] as unknown[] };
    await hooks['chat.message']({ sessionID: 's' }, output);
    projectWithInbox(dir, 'mesh-inbox.cjs', '');
    await hooks['chat.message']({ sessionID: 's' }, output);
    expect(output.parts).toEqual([]);
  });

  it('titles a new top-level session with the mesh name, and leaves a subagent session alone', async () => {
    const title = JSON.stringify({ hookSpecificOutput: { sessionTitle: 'proj-20260101-000000' } });
    projectWithInbox(dir, 'mesh-title.cjs', title);
    const { hooks, updates } = await loadPlugin(dir);
    const created = (info: object) => ({
      event: { type: 'session.created', properties: { info } },
    });
    await hooks.event(created({ id: 'ses_child', parentID: 'ses_1' }));
    await hooks.event({ event: { type: 'session.updated', properties: {} } });
    await hooks.event(created({ id: 'ses_1' }));
    expect(updates).toEqual([{ path: { id: 'ses_1' }, body: { title: 'proj-20260101-000000' } }]);
  });
});

describe('checked-in config', () => {
  it('opencode plugin matches its generator', () => {
    expect(readRepo('.opencode/plugins/monomind-hooks.ts')).toBe(generateHooksPlugin());
  });

  it('agy runs the mesh helper before each model call', () => {
    expect(
      JSON.parse(readRepo('.agents/hooks.json'))['monomind-mesh'].PreInvocation[0].command,
    ).toBe('node ../.gemini/helpers/mesh-inbox.cjs --host agy');
  });

  it('grok runs it on PreToolUse, the one event whose context it keeps', () => {
    const hooks = JSON.parse(readRepo('.grok/hooks/monomind-mesh.json')).hooks;
    expect(Object.keys(hooks)).toEqual(['PreToolUse']);
    expect(hooks.PreToolUse[0].hooks[0].command).toContain('mesh-inbox.cjs" --host grok');
  });
});
