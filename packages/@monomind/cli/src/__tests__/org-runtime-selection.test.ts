/**
 * Per-org runtime selection (#orgrt): an org def may carry a top-level
 * `runtime` field ('claude' | 'kimicode' | 'opencode' | 'vercel' | 'codex')
 * that picks which AgentRunner hosts its role sessions, overriding the
 * MONOMIND_RUNTIME env var. Without either, resolution returns undefined so
 * session.ts falls back to the default ClaudeAgentRunner (keeping Claude orgs
 * byte-for-byte unchanged), or auto-resolves from provider.kind.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveRunner, resolveRoleRunner } from '../orgrt/daemon.js';
import { KimiCodeAgentRunner } from '../orgrt/kimicode-runner.js';
import { OpencodeAgentRunner } from '../orgrt/opencode-runner.js';
import { VercelAgentRunner } from '../orgrt/vercel-runner.js';
import { CodexAgentRunner } from '../orgrt/codex-runner.js';
import { AntigravityAgentRunner } from '../orgrt/antigravity-runner.js';
import { OrgDefSchema, RoleSchema, ProviderSchema } from '../orgrt/types.js';
import { resolveModel } from '../orgrt/session.js';
import { resolveProviderEnv } from '../orgrt/provider.js';

describe('resolveRunner', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.MONOMIND_RUNTIME;
    delete process.env.MONOMIND_RUNTIME;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MONOMIND_RUNTIME;
    else process.env.MONOMIND_RUNTIME = saved;
  });

  it('org def runtime: kimicode resolves to a KimiCodeAgentRunner', () => {
    expect(resolveRunner('kimicode')).toBeInstanceOf(KimiCodeAgentRunner);
  });

  it('org def runtime: opencode resolves to an OpencodeAgentRunner', () => {
    expect(resolveRunner('opencode')).toBeInstanceOf(OpencodeAgentRunner);
  });

  it('org def runtime: claude resolves to undefined (default Claude path)', () => {
    expect(resolveRunner('claude')).toBeUndefined();
  });

  it('org def runtime overrides MONOMIND_RUNTIME', () => {
    process.env.MONOMIND_RUNTIME = 'opencode';
    expect(resolveRunner('kimicode')).toBeInstanceOf(KimiCodeAgentRunner);
    expect(resolveRunner('claude')).toBeUndefined();
  });

  it('no org runtime + MONOMIND_RUNTIME=opencode resolves to an OpencodeAgentRunner', () => {
    process.env.MONOMIND_RUNTIME = 'opencode';
    expect(resolveRunner(undefined)).toBeInstanceOf(OpencodeAgentRunner);
  });

  it('no org runtime + MONOMIND_RUNTIME=kimicode resolves to a KimiCodeAgentRunner', () => {
    process.env.MONOMIND_RUNTIME = 'kimicode';
    expect(resolveRunner(undefined)).toBeInstanceOf(KimiCodeAgentRunner);
  });

  it('neither org runtime nor env var resolves to undefined', () => {
    expect(resolveRunner(undefined)).toBeUndefined();
  });
});

describe('OrgDefSchema runtime field', () => {
  const baseOrg = {
    name: 'demo',
    roles: [{ id: 'boss', reports_to: null }],
  };

  it('accepts a top-level runtime field', () => {
    const def = OrgDefSchema.parse({ ...baseOrg, runtime: 'kimicode' });
    expect(def.runtime).toBe('kimicode');
  });

  it('leaves runtime undefined when absent', () => {
    const def = OrgDefSchema.parse(baseOrg);
    expect(def.runtime).toBeUndefined();
  });

  it('rejects an unknown runtime value', () => {
    expect(() => OrgDefSchema.parse({ ...baseOrg, runtime: 'gpt' })).toThrow();
  });
});

describe('resolveRoleRunner (per-role override)', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.MONOMIND_RUNTIME;
    delete process.env.MONOMIND_RUNTIME;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MONOMIND_RUNTIME;
    else process.env.MONOMIND_RUNTIME = saved;
  });

  it('role runtime beats org def runtime', () => {
    expect(resolveRoleRunner('kimicode', 'opencode')).toBeInstanceOf(KimiCodeAgentRunner);
    expect(resolveRoleRunner('opencode', 'kimicode')).toBeInstanceOf(OpencodeAgentRunner);
  });

  it('role runtime beats MONOMIND_RUNTIME env', () => {
    process.env.MONOMIND_RUNTIME = 'opencode';
    expect(resolveRoleRunner('kimicode', undefined)).toBeInstanceOf(KimiCodeAgentRunner);
  });

  it("role runtime 'claude' forces the default Claude path even when org/env select another runtime", () => {
    process.env.MONOMIND_RUNTIME = 'kimicode';
    expect(resolveRoleRunner('claude', 'opencode')).toBeUndefined();
    expect(resolveRoleRunner('claude', undefined)).toBeUndefined();
  });

  it('role without runtime inherits the org runner', () => {
    expect(resolveRoleRunner(undefined, 'opencode')).toBeInstanceOf(OpencodeAgentRunner);
    process.env.MONOMIND_RUNTIME = 'kimicode';
    expect(resolveRoleRunner(undefined, undefined)).toBeInstanceOf(KimiCodeAgentRunner);
  });
});

describe('RoleSchema runtime field', () => {
  it('accepts a per-role runtime field', () => {
    const role = RoleSchema.parse({ id: 'dev', reports_to: 'boss', runtime: 'opencode' });
    expect(role.runtime).toBe('opencode');
  });

  it('leaves runtime undefined when absent', () => {
    const role = RoleSchema.parse({ id: 'dev', reports_to: 'boss' });
    expect(role.runtime).toBeUndefined();
  });

  it('rejects an unknown runtime value', () => {
    expect(() => RoleSchema.parse({ id: 'dev', reports_to: 'boss', runtime: 'gpt' })).toThrow();
  });

  it('org def round-trips roles with per-role runtime', () => {
    const def = OrgDefSchema.parse({
      name: 'demo',
      runtime: 'kimicode',
      roles: [
        { id: 'boss', reports_to: null, runtime: 'claude' },
        { id: 'dev', reports_to: 'boss' },
      ],
    });
    expect(def.roles[0].runtime).toBe('claude');
    expect(def.roles[1].runtime).toBeUndefined();
  });
});

// ── Vercel + Codex runner resolution ────────────────────────────────────

describe('resolveRunner (Vercel + Codex + Antigravity)', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.MONOMIND_RUNTIME;
    delete process.env.MONOMIND_RUNTIME;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MONOMIND_RUNTIME;
    else process.env.MONOMIND_RUNTIME = saved;
  });

  it('org def runtime: vercel resolves to a VercelAgentRunner', () => {
    expect(resolveRunner('vercel')).toBeInstanceOf(VercelAgentRunner);
  });

  it('org def runtime: codex resolves to a CodexAgentRunner', () => {
    expect(resolveRunner('codex')).toBeInstanceOf(CodexAgentRunner);
  });

  it('org def runtime: antigravity resolves to an AntigravityAgentRunner', () => {
    expect(resolveRunner('antigravity')).toBeInstanceOf(AntigravityAgentRunner);
  });

  it('auto-resolves vercel runner when provider.kind=vercel-api-key', () => {
    expect(resolveRunner(undefined, 'vercel-api-key')).toBeInstanceOf(VercelAgentRunner);
  });

  it('auto-resolves codex runner when provider.kind=codex', () => {
    expect(resolveRunner(undefined, 'codex')).toBeInstanceOf(CodexAgentRunner);
  });

  it('auto-resolves antigravity runner when provider.kind=antigravity', () => {
    expect(resolveRunner(undefined, 'antigravity')).toBeInstanceOf(AntigravityAgentRunner);
  });

  it('explicit runtime beats auto-resolution', () => {
    expect(resolveRunner('claude', 'vercel-api-key')).toBeUndefined();
    expect(resolveRunner('claude', 'codex')).toBeUndefined();
    expect(resolveRunner('claude', 'antigravity')).toBeUndefined();
  });

  it('preserves existing kinds: api-key does NOT auto-resolve to vercel', () => {
    expect(resolveRunner(undefined, 'api-key')).toBeUndefined();
  });

  it('preserves existing kinds: subscription does NOT auto-resolve', () => {
    expect(resolveRunner(undefined, 'subscription')).toBeUndefined();
  });
});

describe('resolveRoleRunner (auto-resolution from provider kind)', () => {
  it('role provider kind beats org provider kind', () => {
    expect(resolveRoleRunner(undefined, undefined, 'codex', 'vercel-api-key')).toBeInstanceOf(CodexAgentRunner);
    expect(resolveRoleRunner(undefined, undefined, 'vercel-api-key', 'codex')).toBeInstanceOf(VercelAgentRunner);
  });

  it('explicit role runtime beats provider kind auto-resolution', () => {
    expect(resolveRoleRunner('claude', undefined, 'vercel-api-key', undefined)).toBeUndefined();
  });
});

describe('ProviderSchema (new vendor + kind fields)', () => {
  it('accepts vercel-api-key with a known vendor', () => {
    expect(() => ProviderSchema.parse({ kind: 'vercel-api-key', vendor: 'glm' })).not.toThrow();
  });

  it('accepts codex kind', () => {
    expect(() => ProviderSchema.parse({ kind: 'codex' })).not.toThrow();
  });

  it('accepts antigravity kind', () => {
    expect(() => ProviderSchema.parse({ kind: 'antigravity' })).not.toThrow();
  });

  it('rejects unknown vendor', () => {
    expect(() => ProviderSchema.parse({ kind: 'vercel-api-key', vendor: 'unknown' })).toThrow();
  });

  it('rejects unknown kind', () => {
    expect(() => ProviderSchema.parse({ kind: 'custom' })).toThrow();
  });

  it('defaults kind to subscription', () => {
    const p = ProviderSchema.parse({});
    expect(p.kind).toBe('subscription');
  });

  it('vercel-api-key provider throws when the named env var is unset (fail-fast)', () => {
    expect(() =>
      resolveProviderEnv({ kind: 'vercel-api-key', apiKeyEnv: 'MISSING_KEY_X' }, { OTHER: '1' }),
    ).toThrow(/MISSING_KEY_X/);
  });

  it('vercel-api-key provider surfaces the key when env var is set', () => {
    const env = resolveProviderEnv(
      { kind: 'vercel-api-key', apiKeyEnv: 'ZHIPU_API_KEY' },
      { ZHIPU_API_KEY: 'test-key' },
    );
    expect(env.ZHIPU_API_KEY).toBe('test-key');
  });
});

describe('OrgDefSchema (new runtime values)', () => {
  const baseOrg = { name: 'demo', roles: [{ id: 'boss', reports_to: null }] };

  it('accepts runtime: vercel', () => {
    expect(OrgDefSchema.parse({ ...baseOrg, runtime: 'vercel' }).runtime).toBe('vercel');
  });

  it('accepts runtime: codex', () => {
    expect(OrgDefSchema.parse({ ...baseOrg, runtime: 'codex' }).runtime).toBe('codex');
  });

  it('accepts runtime: antigravity', () => {
    expect(OrgDefSchema.parse({ ...baseOrg, runtime: 'antigravity' }).runtime).toBe('antigravity');
  });

  it('RoleSchema accepts runtime: vercel', () => {
    expect(RoleSchema.parse({ id: 'dev', reports_to: 'boss', runtime: 'vercel' }).runtime).toBe('vercel');
  });

  it('RoleSchema accepts runtime: codex', () => {
    expect(RoleSchema.parse({ id: 'dev', reports_to: 'boss', runtime: 'codex' }).runtime).toBe('codex');
  });

  it('RoleSchema accepts runtime: antigravity', () => {
    expect(RoleSchema.parse({ id: 'dev', reports_to: 'boss', runtime: 'antigravity' }).runtime).toBe('antigravity');
  });
});

describe('resolveModel (vendor/runtime defaults)', () => {
  it('explicit model always wins', () => {
    expect(resolveModel({ adapter_config: { model: 'custom-x' } } as any, 'vercel', 'glm')).toBe('custom-x');
  });

  it('falls back to vendor default', () => {
    expect(resolveModel({ adapter_config: {} } as any, 'vercel', 'glm')).toBe('glm-5.2');
    expect(resolveModel({ adapter_config: {} } as any, 'vercel', 'openai')).toBe('gpt-5.5');
    expect(resolveModel({ adapter_config: {} } as any, 'vercel', 'deepseek')).toBe('deepseek-chat');
  });

  it('falls back to runtime default when no vendor', () => {
    expect(resolveModel({ adapter_config: {} } as any, 'claude')).toBe('claude-sonnet-4-5');
    expect(resolveModel({ adapter_config: {} } as any, 'kimicode')).toBe('kimi-code/k3');
    expect(resolveModel({ adapter_config: {} } as any, 'opencode')).toBe('glm-5.2');
    expect(resolveModel({ adapter_config: {} } as any, 'codex')).toBe('gpt-5.6-terra');
    expect(resolveModel({ adapter_config: {} } as any, 'antigravity')).toBe('gemini-3.6-flash-high');
    expect(resolveModel({ adapter_config: {} } as any, 'vercel')).toBe('gpt-5.5');
  });

  it('falls back to claude default when nothing set', () => {
    expect(resolveModel({ adapter_config: {} } as any)).toBe('claude-sonnet-4-5');
  });
});
