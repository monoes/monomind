/**
 * Per-org runtime selection (#orgrt): an org def may carry a top-level
 * `runtime` field ('claude' | 'kimicode' | 'opencode') that picks which
 * AgentRunner hosts its role sessions, overriding the MONOMIND_RUNTIME env
 * var. Without either, resolution returns undefined so session.ts falls back
 * to the default ClaudeAgentRunner (keeping Claude orgs byte-for-byte
 * unchanged).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveRunner, resolveRoleRunner } from '../orgrt/daemon.js';
import { KimiCodeAgentRunner } from '../orgrt/kimicode-runner.js';
import { OpencodeAgentRunner } from '../orgrt/opencode-runner.js';
import { OrgDefSchema, RoleSchema } from '../orgrt/types.js';

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
