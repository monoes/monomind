// #365: resolveRoleAccess is the runtime's single source of truth for
// whether a role actually gets full access this session.

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeAccessAckHash } from '../orgrt/access-ack.js';
import { isUnattendedRun, resolveRoleAccess } from '../orgrt/access-grant.js';
import { ensureFullAccessGrantKey, signAccessAck } from '../orgrt/access-grant-key.js';
import { type OrgDef, OrgDefSchema, type OrgRole } from '../orgrt/types.js';
import { mkdtempSync } from './tmp-track.js';

let keyDir: string;

beforeEach(() => {
  keyDir = mkdtempSync(join(tmpdir(), 'access-grant-key-'));
});

/** Every `resolveRoleAccess` call in this file goes through this key dir —
 *  never the real machine's operator dir. */
function resolve(
  d: OrgDef,
  role: OrgRole,
  extra: { unattended?: boolean; runtimeId?: string } = {},
) {
  return resolveRoleAccess(d, role, { ...extra, grantKeyDir: keyDir });
}

function def(overrides: Record<string, unknown> = {}): OrgDef {
  return OrgDefSchema.parse({
    name: 'o',
    roles: [{ id: 'builder', runtime: 'claude', policy: { access: 'full' } }],
    ...overrides,
  });
}

/** A grant this file's own `resolveRoleAccess` calls (via `resolve()`,
 *  `grantKeyDir: keyDir`) will verify as `active` — computed and signed the
 *  same way `org role set-access ... full` does. */
function ackedDef(overrides: Record<string, unknown> = {}): OrgDef {
  const d = def(overrides);
  const role = d.roles[0];
  const at = '2026-01-01T00:00:00.000Z';
  const by = 'human' as const;
  const hash = computeAccessAckHash(d, role);
  const key = ensureFullAccessGrantKey(keyDir);
  const sig = signAccessAck({ org: d.name, role: role.id, hash, at, by, key });
  role.policy = { ...role.policy, access: 'full', access_ack: { by, at, hash, sig } };
  return d;
}

describe('resolveRoleAccess', () => {
  it('a role with no policy.access is scoped, no state', () => {
    const d = OrgDefSchema.parse({ name: 'o', roles: [{ id: 'a' }] });
    const r = resolve(d, d.roles[0]);
    expect(r).toEqual({ access: 'scoped', declared: 'scoped' });
  });

  it('declared full with no access_ack runs scoped, suspended', () => {
    const d = def();
    const r = resolve(d, d.roles[0]);
    expect(r.access).toBe('scoped');
    expect(r.declared).toBe('full');
    expect(r.state).toBe('suspended');
    expect(r.reason).toMatch(/no human acknowledgement/);
  });

  it('declared full on a runtime without full-access support runs scoped, suspended', () => {
    const d = def({ roles: [{ id: 'builder', runtime: 'hermes', policy: { access: 'full' } }] });
    const r = resolve(d, d.roles[0]);
    expect(r.access).toBe('scoped');
    expect(r.state).toBe('suspended');
    expect(r.reason).toMatch(/does not support full access/);
  });

  it('a correctly acknowledged AND signed grant is active', () => {
    const d = ackedDef();
    const r = resolve(d, d.roles[0]);
    expect(r).toEqual({ access: 'full', declared: 'full', state: 'active' });
  });

  it('a valid grant does not run full as root (uid 0) on any runtime', () => {
    for (const runtime of ['claude', 'codex', 'qwen', 'aider']) {
      const d = ackedDef({ roles: [{ id: 'builder', runtime, policy: { access: 'full' } }] });
      const r = resolveRoleAccess(d, d.roles[0], { grantKeyDir: keyDir, getuid: () => 0 });
      expect(r.access, runtime).toBe('scoped');
      expect(r.state).toBe('suspended');
      expect(r.reason).toMatch(/root/);
      const ok = resolveRoleAccess(d, d.roles[0], { grantKeyDir: keyDir, getuid: () => 1000 });
      expect(ok.access, runtime).toBe('full');
    }
  });

  it('an ack with a hash but no sig is suspended (unsigned)', () => {
    const d = def();
    const role = d.roles[0];
    role.policy = {
      ...role.policy,
      access_ack: { by: 'human', at: 'x', hash: 'not-a-real-hash' } as any,
    };
    const r = resolve(d, role);
    expect(r.access).toBe('scoped');
    expect(r.state).toBe('suspended');
    expect(r.reason).toMatch(/unsigned/);
  });

  it('a hash recomputed correctly but with a forged sig is suspended (invalid-signature)', () => {
    // A config-writing path CAN recompute the public hash (it's derivable
    // from fields already in the org JSON) but cannot produce a valid sig
    // without the machine-local key.
    const d = def();
    const role = d.roles[0];
    role.policy = {
      ...role.policy,
      access_ack: {
        by: 'human',
        at: '2026-01-01T00:00:00.000Z',
        hash: computeAccessAckHash(d, role),
        sig: 'f'.repeat(64),
      },
    };
    const r = resolve(d, role);
    expect(r.access).toBe('scoped');
    expect(r.state).toBe('suspended');
    expect(r.reason).toMatch(/invalid-signature/);
  });

  it('a validly signed ack verified against the wrong key dir (key missing there) is suspended', () => {
    const d = ackedDef();
    const otherDir = mkdtempSync(join(tmpdir(), 'access-grant-otherkey-'));
    const r = resolveRoleAccess(d, d.roles[0], { grantKeyDir: otherDir });
    expect(r.access).toBe('scoped');
    expect(r.state).toBe('suspended');
    expect(r.reason).toMatch(/invalid-signature/);
  });

  it('editing the role after the grant (responsibilities) suspends it (config-changed)', () => {
    const d = ackedDef();
    d.roles[0].responsibilities = ['a new, unacknowledged job'];
    const r = resolve(d, d.roles[0]);
    expect(r.access).toBe('scoped');
    expect(r.state).toBe('suspended');
    expect(r.reason).toMatch(/config-changed/);
  });

  it('editing run_config.allow_unattended_full_access after the grant suspends it', () => {
    const d = ackedDef();
    (d.run_config as Record<string, unknown>).allow_unattended_full_access = true;
    const r = resolve(d, d.roles[0]);
    expect(r.state).toBe('suspended');
  });

  it('an acknowledged grant on an unattended (scheduled) run is blocked without the org opt-in', () => {
    const d = ackedDef({ schedule: '30m' });
    const r = resolve(d, d.roles[0], { unattended: isUnattendedRun(d) });
    expect(r.access).toBe('scoped');
    expect(r.state).toBe('unattended-blocked');
  });

  it('an acknowledged grant on an unattended run IS active once allow_unattended_full_access is set and acknowledged with it in place', () => {
    // ackedDef computes the hash AFTER run_config overrides are applied, so
    // this reproduces "set allow_unattended_full_access, THEN run
    // `org role set-access ... full`" — the required order.
    const d = ackedDef({ schedule: '30m', run_config: { allow_unattended_full_access: true } });
    const r = resolve(d, d.roles[0], { unattended: isUnattendedRun(d) });
    expect(r).toEqual({ access: 'full', declared: 'full', state: 'active' });
  });

  it('another role gaining untrusted input after the grant suspends it at runtime (tainted)', () => {
    const d = ackedDef({
      roles: [
        { id: 'builder', runtime: 'claude', policy: { access: 'full' } },
        { id: 'scout', runtime: 'claude', reports_to: 'builder' },
      ],
    });
    expect(resolve(d, d.roles[0]).access).toBe('full');
    // Edits only scout, so builder's own ack hash still matches.
    d.roles[1].policy = { ...d.roles[1].policy, webAllow: ['example.com'] } as OrgRole['policy'];
    const r = resolve(d, d.roles[0]);
    expect(r.access).toBe('scoped');
    expect(r.state).toBe('suspended');
    expect(r.reason).toMatch(/tainted/);
    expect(r.reason).toMatch(/scout/);
  });

  it('isUnattendedRun: false with no schedule, true with one', () => {
    expect(isUnattendedRun(OrgDefSchema.parse({ name: 'o', roles: [{ id: 'a' }] }))).toBe(false);
    expect(
      isUnattendedRun(OrgDefSchema.parse({ name: 'o', roles: [{ id: 'a' }], schedule: '1h' })),
    ).toBe(true);
  });
});
