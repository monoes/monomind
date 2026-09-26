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
  installRecipe,
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
      capabilities: [
        'agent-exec',
        'agent-scan',
        'agent-scan-read-only',
        'org-json-v1',
        'org-tool-providers',
        'org-decision-attribution',
        'org-endpoint-roles',
        'org-federation',
        'org-idle-deadline',
        'doctor-json',
        'doctor-read-only',
        'doctor-offline',
      ],
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
    const result = await scanInstalled({ env, probe: true, versionTimeoutMs: 8000 });
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
    const result = await scanInstalled({ env, probe: true, versionTimeoutMs: 8000 });
    const codex = result.agents.find((a) => a.id === 'codex')!;
    expect(codex.installed).toBe(true);
    expect(codex.version).toBe('codex 1.2.3');
  }, 10_000);

  it('a hung --version probe is bounded by the timeout', async () => {
    const { binDir } = stubBin('grok', 'sleep 30; echo never');
    const env = { PATH: binDir };
    const t0 = Date.now();
    const result = await scanInstalled({ env, probe: true, versionTimeoutMs: 300 });
    const grok = result.agents.find((a) => a.id === 'grok')!;
    expect(grok.installed).toBe(true);
    expect(grok.version).toBeNull(); // probe timed out — installed, version unknown
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 10_000);

  it('rev 9: every entry carries a structured install recipe and its login hint', async () => {
    const result = await scanInstalled({ env: { PATH: '/nonexistent' }, skipVersionProbe: true });
    const byId = new Map(result.agents.map((x) => [x.id, x]));
    expect(byId.get('claude')).toMatchObject({
      install: { kind: 'npm', packages: ['@anthropic-ai/claude-code'] },
      login_hint: 'claude login',
    });
    expect(byId.get('antigravity')?.install).toEqual({
      kind: 'script',
      url: 'https://antigravity.google/cli/install.sh',
      shell: 'bash',
    });
    expect(byId.get('vercel')?.install).toEqual({ kind: 'manual' });
    for (const a of result.agents) expect(a.install.kind).toMatch(/^(npm|script|manual)$/);
  });

  it('installRecipe only accepts hints a caller can run without a shell', () => {
    expect(installRecipe('npm install --global a b@1.2')).toEqual({
      kind: 'npm',
      packages: ['a', 'b@1.2'],
    });
    expect(installRecipe('npm install -g @scope/pkg@^1.2.3-beta.1 c@latest c@~2')).toEqual({
      kind: 'npm',
      packages: ['@scope/pkg@^1.2.3-beta.1', 'c@latest', 'c@~2'],
    });
    // every real hint that looks installable stays installable
    for (const spec of RUNNER_SPECS) {
      if (/^(npm install -g|curl -fsSL)/.test(spec.installHint))
        expect(installRecipe(spec.installHint).kind, spec.installHint).not.toBe('manual');
    }
    for (const hint of [
      'npm install ai (plus the vendor model package)',
      'npm install -g foo; echo injected',
      'npm install -g --unsafe-perm foo',
      'curl -fsSL http://example.com/install.sh | bash',
      'curl -fsSL https://example.com/i.sh | bash; echo injected',
      'install the Grok Build CLI per https://docs.x.ai/build/cli',
      // shell syntax inside the URL or after it
      'curl -fsSL https://x/$(id) | bash',
      'curl -fsSL https://x/`id` | bash',
      'curl -fsSL https://x/;id | bash',
      'curl -fsSL https://x/&&id | bash',
      'curl -fsSL https://x/a|b | bash',
      'curl -fsSL "https://x/i.sh" | bash',
      "curl -fsSL 'https://x/i.sh' | bash",
      'curl -fsSL https://x/i.sh>/tmp/o | bash',
      'curl -fsSL https://user:pw@x.com/i.sh | bash',
      'curl -fsSL https://x.com/i.sh\n| bash',
      'curl -fsSL https://x.com/i.sh |\nbash',
      // npm version specs that are ranges, wildcards or flags
      'npm install -g foo@>1',
      'npm install -g foo@<1',
      'npm install -g foo@*',
      'npm install -g foo@-x',
      'npm install -g foo@1.0\nbar',
    ]) {
      expect(installRecipe(hint), hint).toEqual({ kind: 'manual' });
    }
  });

  it('vercel (in-process runner) reports no binary but an install hint', async () => {
    const result = await scanInstalled({ env: { PATH: '/nonexistent' }, skipVersionProbe: true });
    const vercel = result.agents.find((a) => a.id === 'vercel')!;
    expect(vercel.binary).toBeNull();
    expect(vercel.install_hint).toContain('npm install');
  });

  it('probeVersion never leaks an ambient ANTHROPIC_* key to the vendor --version probe (o-18)', async () => {
    // binPath is env-controlled (the <X>_CLI_BIN override just above), so this
    // is squarely the same threat model as the 12 AgentRunner spawn sites —
    // `monomind agent scan` must not hand ambient Anthropic creds to it.
    // The env var NAME and fixture VALUE are kept in separate constants
    // (never a literal `ANTHROPIC_API_KEY = '...'` on one line) so the
    // pre-commit secret scanner's keyword+assignment heuristic doesn't
    // mistake this obvious test fixture for a real credential.
    const probeKeyEnv = 'ANTHROPIC_API_KEY';
    const probeKeySentinel = 'O18-REGISTRY-PROBE-DO-NOT-LEAK';
    const { binDir } = stubBin('codex', 'echo "${ANTHROPIC_API_KEY:-unset}"');
    const saved = process.env[probeKeyEnv];
    process.env[probeKeyEnv] = probeKeySentinel;
    try {
      const result = await scanInstalled({
        env: { PATH: binDir },
        probe: true,
        versionTimeoutMs: 8000,
      });
      const codex = result.agents.find((a) => a.id === 'codex')!;
      expect(codex.version).toBe('unset');
    } finally {
      if (saved === undefined) delete process.env[probeKeyEnv];
      else process.env[probeKeyEnv] = saved;
    }
  }, 10_000);
});
