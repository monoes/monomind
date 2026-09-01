/**
 * Unit tests for the runner registry (orgrt/runner-registry.ts) and the
 * capability handshake (protocol-capabilities.ts) — Agent Exec Protocol §2/§6.
 *
 * scanInstalled is exercised against a temp dir of stub binaries via an
 * injected PATH env; no real agent CLIs are required.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  isKnownRuntime,
  RUNNER_SPECS,
  resolveExecRunner,
  scanInstalled,
} from '../orgrt/runner-registry.js';
import {
  AGENT_PROTOCOL_CAPABILITIES,
  AGENT_PROTOCOL_VERSION,
  versionJsonPayload,
} from '../protocol-capabilities.js';

let tmpRoot: string | undefined;
function stubBin(name: string, script: string): { binDir: string } {
  if (!tmpRoot) tmpRoot = mkdtempSync(join(tmpdir(), 'monomind-scan-'));
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `#!/bin/sh\n${script}\n`);
  chmodSync(join(dir, name), 0o755);
  return { binDir: dir };
}
afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('version handshake (§2)', () => {
  it('payload shape: v, version, min_caller, capabilities', () => {
    const p = versionJsonPayload('2.10.0');
    expect(p).toEqual({
      v: 1,
      version: '2.10.0',
      min_caller: '1.0.0',
      capabilities: ['agent-exec', 'agent-scan', 'org-json-v1'],
    });
    expect(p.capabilities).toContain('agent-exec');
    expect(p.capabilities).toBe(AGENT_PROTOCOL_CAPABILITIES);
  });

  it('protocol version is 1', () => {
    expect(AGENT_PROTOCOL_VERSION).toBe(1);
  });
});

describe('runner registry', () => {
  it('covers every RuntimeKind exactly once', () => {
    const ids = RUNNER_SPECS.map((s) => s.id).sort();
    expect(new Set(ids).size).toBe(ids.length);
    // The orgrt RuntimeKind union (daemon.ts) — keep in sync.
    for (const id of [
      'claude',
      'kimicode',
      'opencode',
      'vercel',
      'codex',
      'antigravity',
      'grok',
      'qwen',
      'qwen-rpc',
      'crush',
      'copilot',
      'pi',
      'pi-rpc',
    ]) {
      expect(isKnownRuntime(id), id).toBe(true);
    }
    expect(isKnownRuntime('gemini')).toBe(false);
    expect(isKnownRuntime('cursor')).toBe(false);
  });

  it('resolveExecRunner: unknown ids → null; claude → default runner', async () => {
    expect(await resolveExecRunner('definitely-not')).toBeNull();
    const claude = await resolveExecRunner('claude');
    expect(claude).toBeTruthy();
    expect(typeof claude!.run).toBe('function');
  });
});

describe('scanInstalled (§6)', () => {
  it('detects installed vs missing binaries with versions', async () => {
    const a = stubBin('qwen', 'echo "qwen 0.21.13"');
    const b = stubBin('crush', 'echo "crush 0.89.0"');
    const env = { PATH: [a.binDir, b.binDir].join(':') };
    const result = await scanInstalled({ env, versionTimeoutMs: 8000 });
    const byId = new Map(result.agents.map((x) => [x.id, x]));

    expect(result.v).toBe(1);
    expect(result.agents).toHaveLength(RUNNER_SPECS.length);
    expect(byId.get('qwen')).toMatchObject({ installed: true, version: 'qwen 0.21.13' });
    expect(byId.get('crush')).toMatchObject({ installed: true });
    // Same binary backs both qwen variants; codex was not stubbed.
    expect(byId.get('qwen-rpc')).toMatchObject({ installed: true });
    expect(byId.get('codex')).toMatchObject({ installed: false, binary: null });
    expect(String((byId.get('codex') as { install_hint: string }).install_hint)).toContain(
      '@openai/codex',
    );
  }, 10_000);

  it('honors <X>_CLI_BIN overrides over PATH', async () => {
    const { binDir } = stubBin('codex', 'echo "codex 1.2.3"');
    const env = { PATH: '/usr/bin:/bin', CODEX_CLI_BIN: join(binDir, 'codex') };
    const result = await scanInstalled({ env, versionTimeoutMs: 8000 });
    const codex = result.agents.find((a) => a.id === 'codex')!;
    expect(codex.installed).toBe(true);
    expect(codex.version).toBe('codex 1.2.3');
  }, 10_000);

  it('a hung --version probe is bounded by the timeout', async () => {
    const { binDir } = stubBin('grok', 'sleep 30; echo never');
    const env = { PATH: binDir };
    const t0 = Date.now();
    const result = await scanInstalled({ env, versionTimeoutMs: 300 });
    const grok = result.agents.find((a) => a.id === 'grok')!;
    expect(grok.installed).toBe(true);
    expect(grok.version).toBeNull(); // probe timed out — installed, version unknown
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 10_000);

  it('vercel (in-process runner) reports no binary but an install hint', async () => {
    const result = await scanInstalled({ env: { PATH: '/nonexistent' }, skipVersionProbe: true });
    const vercel = result.agents.find((a) => a.id === 'vercel')!;
    expect(vercel.binary).toBeNull();
    expect(vercel.install_hint).toContain('npm install');
  });
});
