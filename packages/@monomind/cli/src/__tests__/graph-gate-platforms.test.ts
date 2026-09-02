import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKimiGateScript, generateKimiPluginManifest } from '../init/kimi-generator.js';
import { generateHooksPlugin } from '../init/opencode-generator.js';

/**
 * Graph-first gate platform coverage (kimi + opencode).
 *
 * The graph-gate blocks grep/search tools once per session until a monograph
 * tool is called (hook-handler.cjs pre-search). Claude Code wires this via
 * settings.json; kimi and opencode need their bridges/plugins to forward
 * search tool calls to pre-search — these tests guard that mapping.
 */

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'monomind-gate-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * Stub hook-handler.cjs: blocks only the pre-search event for the Grep tool
 * (exit 2 with a JSON block reason); allows everything else. Lets the bridges
 * be tested without a real graph, and proves the allow path actually reaches
 * the handler rather than skipping it.
 */
function installStubHandler(dir: string): void {
  const helpersDir = path.join(dir, '.claude', 'helpers');
  mkdirSync(helpersDir, { recursive: true });
  writeFileSync(
    path.join(helpersDir, 'hook-handler.cjs'),
    `'use strict';
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input || '{}'); } catch (e) {}
  if (process.argv[2] === 'pre-search' && payload.tool_name === 'Grep') {
    process.stderr.write(JSON.stringify({ decision: 'block', reason: 'graph-gate: consult monograph first' }) + '\\n');
    process.exit(2);
  }
  process.exit(0);
});
`,
  );
}

describe('kimi graph-gate coverage', () => {
  it('plugin manifest registers a PreToolUse matcher for Grep|Glob', () => {
    const manifest = JSON.parse(generateKimiPluginManifest({} as never));
    const matchers = (manifest.hooks as { event: string; matcher: string }[])
      .filter((h) => h.event === 'PreToolUse')
      .map((h) => h.matcher);
    expect(matchers).toContain('^(Grep|Glob)$');
  });

  it('gate bridge maps Grep and Glob payloads to the pre-search event', () => {
    const script = generateKimiGateScript();
    expect(script).toContain('tool === "Grep"');
    expect(script).toContain('tool === "Glob"');
    expect(script).toContain('"pre-search"');
  });

  it('bridge blocks a Grep call when the handler blocks pre-search', () => {
    installStubHandler(tmp);
    const gatePath = path.join(tmp, 'monomind-gate.mjs');
    writeFileSync(gatePath, generateKimiGateScript());

    const res = spawnSync(process.execPath, [gatePath], {
      input: JSON.stringify({
        tool_name: 'Grep',
        tool_input: { pattern: 'foo' },
        cwd: tmp,
        session_id: 's1',
      }),
      encoding: 'utf-8',
      timeout: 15000,
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('graph-gate');
  });

  it('bridge allows a Glob call when the handler does not block', () => {
    installStubHandler(tmp);
    const gatePath = path.join(tmp, 'monomind-gate.mjs');
    writeFileSync(gatePath, generateKimiGateScript());

    const res = spawnSync(process.execPath, [gatePath], {
      input: JSON.stringify({
        tool_name: 'Glob',
        tool_input: { pattern: '*.ts' },
        cwd: tmp,
        session_id: 's1',
      }),
      encoding: 'utf-8',
      timeout: 15000,
    });
    expect(res.status).toBe(0);
  });

  it('bridge ignores unmapped tools (fail open)', () => {
    installStubHandler(tmp);
    const gatePath = path.join(tmp, 'monomind-gate.mjs');
    writeFileSync(gatePath, generateKimiGateScript());

    const res = spawnSync(process.execPath, [gatePath], {
      input: JSON.stringify({ tool_name: 'Read', tool_input: {}, cwd: tmp, session_id: 's1' }),
      encoding: 'utf-8',
      timeout: 15000,
    });
    expect(res.status).toBe(0);
  });
});

describe('opencode graph-gate coverage', () => {
  it('plugin routes grep and glob through pre-search with the session id', () => {
    const plugin = generateHooksPlugin();
    expect(plugin).toContain('tool === "grep"');
    expect(plugin).toContain('tool === "glob"');
    expect(plugin).toContain('"pre-search"');
    expect(plugin).toContain('input.sessionID');
  });

  it('plugin blocks a grep call when the handler blocks pre-search', async () => {
    installStubHandler(tmp);
    const pluginPath = path.join(tmp, 'monomind-hooks.mjs');
    // The generated plugin is plain ESM JavaScript (no type annotations).
    writeFileSync(pluginPath, generateHooksPlugin());
    const { MonomindHooks } = await import(pluginPath);
    const hooks = await MonomindHooks({ directory: tmp, worktree: tmp });

    await expect(
      hooks['tool.execute.before']({ tool: 'grep', sessionID: 's1' }, { args: { pattern: 'foo' } }),
    ).rejects.toThrow(/graph-gate/);
  });

  it('plugin allows grep when the handler allows it, and ignores unmapped tools', async () => {
    installStubHandler(tmp);
    const pluginPath = path.join(tmp, 'monomind-hooks.mjs');
    writeFileSync(pluginPath, generateHooksPlugin());
    const { MonomindHooks } = await import(pluginPath);
    const hooks = await MonomindHooks({ directory: tmp, worktree: tmp });

    // glob → pre-search on the stub exits 0 → no throw
    await expect(
      hooks['tool.execute.before'](
        { tool: 'glob', sessionID: 's1' },
        { args: { pattern: '*.ts' } },
      ),
    ).resolves.toBeUndefined();
    // read is not mapped at all
    await expect(
      hooks['tool.execute.before']({ tool: 'read', sessionID: 's1' }, { args: {} }),
    ).resolves.toBeUndefined();
  });
});

describe('graph-gate persistent opt-out', () => {
  it('config file active-gates.json { graphGate: "off" } disables the gate without the env var', () => {
    // The check must fire BEFORE session/graph freshness — an opted-out gate
    // is off even when a fresh graph exists.
    const src = readFileSync(
      path.resolve(__dirname, '../../../../../.claude/helpers/utils/monograph.cjs'),
      'utf-8',
    );
    const fn = src.match(/function _graphGateShouldBlock[\s\S]*?\n}/);
    expect(fn).toBeTruthy();
    expect(fn![0]).toContain('active-gates.json');
    expect(fn![0]).toContain('graphGate');
    expect(fn![0]).toContain("'off'");
  });
});
