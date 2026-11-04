import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALLOW_UNCONFINED_ENV,
  confinementRefusal,
  enforceConfinement,
} from '../orgrt/org-sign-review.js';

// A codex role has no SDK sandbox; with no bubblewrap mask it is unconfined.
const def = { roles: [{ id: 'dev', runtime: 'codex', policy: { access: 'full' } }] };
const confined = { roles: [{ id: 'dev', runtime: 'vercel' }] };

afterEach(() => vi.unstubAllEnvs());

describe('enforceConfinement fails closed', () => {
  it('refuses an unconfined role, naming the role and both fixes', () => {
    vi.stubEnv(ALLOW_UNCONFINED_ENV, '');
    expect(() => enforceConfinement(def, 'o', { warn: () => {} })).toThrow(/dev/);
    expect(() => enforceConfinement(def, 'o', { warn: () => {} })).toThrow(/bubblewrap/);
    expect(() => enforceConfinement(def, 'o', { warn: () => {} })).toThrow(/--allow-unconfined/);
  });
  it('starts with the explicit opt-in and records it in a warning', () => {
    const warn = vi.fn();
    const loose = enforceConfinement(def, 'o', { allowUnconfined: true, warn });
    expect(loose.map((r) => r.id)).toEqual(['dev']);
    expect(warn.mock.calls[0][0]).toMatch(/opt-in/);
  });
  it('accepts the env opt-in', () => {
    vi.stubEnv(ALLOW_UNCONFINED_ENV, '1');
    expect(() => enforceConfinement(def, 'o', { warn: () => {} })).not.toThrow();
  });
  it('does not touch an org with no unconfined role', () => {
    vi.stubEnv(ALLOW_UNCONFINED_ENV, '');
    expect(enforceConfinement(confined, 'o', { warn: () => {} })).toEqual([]);
  });
  it('refusal text is stable', () => {
    expect(confinementRefusal('o', [{ id: 'a', why: 'x' }])).toContain('a: x');
  });
});
