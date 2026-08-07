/**
 * Per-org runtime selection (#orgrt): an org def may carry a top-level
 * `runtime` field ('claude' | 'kimicode' | 'opencode') that picks which
 * AgentRunner hosts its role sessions, overriding the MONOMIND_RUNTIME env
 * var. Without either, resolution returns undefined so session.ts falls back
 * to the default ClaudeAgentRunner (keeping Claude orgs byte-for-byte
 * unchanged).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveRunner } from '../orgrt/daemon.js';
import { KimiCodeAgentRunner } from '../orgrt/kimicode-runner.js';
import { OpencodeAgentRunner } from '../orgrt/opencode-runner.js';
import { OrgDefSchema } from '../orgrt/types.js';

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
