import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateCodexHookScript } from '../init/codex-generator.js';
import { generateKimiGateScript } from '../init/kimi-generator.js';
import { generateHooksPlugin } from '../init/opencode-generator.js';

/**
 * Org role hook env (#249).
 *
 * Org role sessions used to put MONOMIND_HOOK_QUIET / MONOMIND_GRAPH_GATE /
 * MONOMIND_SDK_AGENT into the env of the CLI they spawn, and codex/kimi/
 * opencode hand that same env to their shell tool — so every command a role
 * ran saw monomind's hook-quieting switches. The runner now only passes the
 * MONOMIND_ORG_ROLE marker; the generated bridges turn it into the quieting
 * vars on the hook-handler subprocess alone.
 */

const HOOK_VARS = ['MONOMIND_HOOK_QUIET', 'MONOMIND_GRAPH_GATE', 'MONOMIND_SDK_AGENT'] as const;
const MARKER_VARS = [...HOOK_VARS, 'MONOMIND_ORG_ROLE'] as const;

let tmp: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'monomind-bridge-env-'));
  saved = Object.fromEntries(MARKER_VARS.map((k) => [k, process.env[k]]));
  for (const k of MARKER_VARS) delete process.env[k];
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  for (const k of MARKER_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Stub hook-handler.cjs that records the hook vars it was started with. */
function installEnvRecordingHandler(dir: string): string {
  const helpersDir = path.join(dir, '.claude', 'helpers');
  mkdirSync(helpersDir, { recursive: true });
  const outFile = path.join(dir, 'handler-env.json');
  writeFileSync(
    path.join(helpersDir, 'hook-handler.cjs'),
    `'use strict';
const fs = require('fs');
const keys = ${JSON.stringify(HOOK_VARS)};
const seen = {};
for (const k of keys) seen[k] = process.env[k];
fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(seen));
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
`,
  );
  return outFile;
}

function readHandlerEnv(outFile: string): Record<string, string | undefined> {
  return JSON.parse(readFileSync(outFile, 'utf-8'));
}

const QUIET = { MONOMIND_HOOK_QUIET: '1', MONOMIND_GRAPH_GATE: 'off', MONOMIND_SDK_AGENT: '1' };

/** Env for a bridge process: the test's env minus the hook vars, plus extra. */
function bridgeEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const k of HOOK_VARS) delete env[k];
  return env;
}

describe('codex hook bridge', () => {
  function runCodexBridge(env: NodeJS.ProcessEnv) {
    const outFile = installEnvRecordingHandler(tmp);
    const bridge = path.join(tmp, 'monomind-hook.cjs');
    writeFileSync(bridge, generateCodexHookScript());
    const res = spawnSync(process.execPath, [bridge], {
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'shell_command',
        tool_input: { command: 'ls' },
        cwd: tmp,
      }),
      encoding: 'utf-8',
      env,
      timeout: 15000,
    });
    expect(res.status).toBe(0);
    return readHandlerEnv(outFile);
  }

  it('quiets the hook handler inside an org role (MONOMIND_ORG_ROLE set)', () => {
    expect(runCodexBridge(bridgeEnv({ MONOMIND_ORG_ROLE: 'coder' }))).toEqual(QUIET);
  });

  it('leaves the hook handler env untouched outside an org role', () => {
    const seen = runCodexBridge(bridgeEnv({}));
    for (const k of HOOK_VARS) expect(seen[k], k).toBeUndefined();
  });
});

describe('kimi gate bridge', () => {
  function runKimiBridge(env: NodeJS.ProcessEnv) {
    const outFile = installEnvRecordingHandler(tmp);
    const bridge = path.join(tmp, 'monomind-gate.mjs');
    writeFileSync(bridge, generateKimiGateScript());
    const res = spawnSync(process.execPath, [bridge], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: tmp }),
      encoding: 'utf-8',
      env,
      timeout: 15000,
    });
    expect(res.status).toBe(0);
    return readHandlerEnv(outFile);
  }

  it('quiets the hook handler inside an org role (MONOMIND_ORG_ROLE set)', () => {
    expect(runKimiBridge(bridgeEnv({ MONOMIND_ORG_ROLE: 'coder' }))).toEqual(QUIET);
  });

  it('leaves the hook handler env untouched outside an org role', () => {
    const seen = runKimiBridge(bridgeEnv({}));
    for (const k of HOOK_VARS) expect(seen[k], k).toBeUndefined();
  });
});

describe('opencode hooks plugin', () => {
  async function runOpencodePlugin() {
    const outFile = installEnvRecordingHandler(tmp);
    const pluginPath = path.join(tmp, 'monomind-hooks.mjs');
    writeFileSync(pluginPath, generateHooksPlugin());
    const { MonomindHooks } = await import(pluginPath);
    const hooks = await MonomindHooks({ directory: tmp, worktree: tmp });
    await hooks['tool.execute.before'](
      { tool: 'bash', sessionID: 's1' },
      { args: { command: 'ls' } },
    );
    return readHandlerEnv(outFile);
  }

  it('quiets the hook handler inside an org role (MONOMIND_ORG_ROLE set)', async () => {
    process.env.MONOMIND_ORG_ROLE = 'coder';
    expect(await runOpencodePlugin()).toEqual(QUIET);
    // The plugin runs in opencode's own process: it must not set the vars
    // there, or opencode's shell tool would inherit them.
    for (const k of HOOK_VARS) expect(process.env[k], k).toBeUndefined();
  });

  it('leaves the hook handler env untouched outside an org role', async () => {
    const seen = await runOpencodePlugin();
    for (const k of HOOK_VARS) expect(seen[k], k).toBeUndefined();
  });
});
