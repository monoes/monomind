// #720: a release-QA drill grant: scoped to named orgs and roles, time-limited,
// written only by the operator. It never flips the global boolean default.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drillGrantAction } from '../commands/org-drill-grant.js';
import { drillSigningScope } from '../orgrt/operator-dir-guard.js';
import { allowDrillSigning } from '../orgrt/operator-settings.js';
import type { CommandContext } from '../types.js';
import { mkdtempSync } from './tmp-track.js';

const fake = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, userInfo: () => ({ ...os.userInfo(), homedir: fake.home }) };
});

const NOW = Date.parse('2026-11-02T12:00:00Z');
const HOUR = 3_600_000;
const FILE = '.monomind/operator-settings.json';
let home: string;
const grant = (g: unknown) => {
  mkdirSync(join(home, '.monomind'), { recursive: true });
  writeFileSync(join(home, FILE), JSON.stringify({ org: { allowDrillSigning: g } }), {
    mode: 0o600,
  });
};
const live = (over: Record<string, unknown> = {}) => ({
  orgs: ['release'],
  roles: ['runtime-qa'],
  issuedAt: new Date(NOW - HOUR).toISOString(),
  expiresAt: new Date(NOW + HOUR).toISOString(),
  ...over,
});
const rel = { org: 'release', role: 'runtime-qa', now: NOW };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'grant-home-'));
  fake.home = home;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('scoped, time-limited grant', () => {
  it('allows the named org and role inside the window', () => {
    grant(live());
    expect(allowDrillSigning(home, rel)).toBe(true);
  });
  it('refuses another org, another role, or no context at all', () => {
    grant(live());
    expect(allowDrillSigning(home, { ...rel, org: 'prod-org' })).toBe(false);
    expect(allowDrillSigning(home, { ...rel, role: 'boss' })).toBe(false);
    expect(allowDrillSigning(home, { now: NOW })).toBe(false);
    expect(allowDrillSigning(home)).toBe(false);
  });
  it('refuses once expired, before it starts, or with a window over 24 hours', () => {
    grant(live());
    expect(allowDrillSigning(home, { ...rel, now: NOW + 2 * HOUR })).toBe(false);
    expect(allowDrillSigning(home, { ...rel, now: NOW - 2 * HOUR })).toBe(false);
    grant(live({ expiresAt: new Date(NOW + 30 * HOUR).toISOString() }));
    expect(allowDrillSigning(home, rel)).toBe(false);
  });
  it('refuses wildcards, empty lists and malformed dates', () => {
    for (const bad of [
      live({ orgs: ['*'] }),
      live({ roles: [] }),
      live({ orgs: 'release' }),
      live({ expiresAt: 'tomorrow' }),
      live({ issuedAt: undefined }),
    ]) {
      grant(bad);
      expect(allowDrillSigning(home, rel)).toBe(false);
    }
  });
  it('drillSigningScope reads the org and role from the environment', () => {
    grant(live());
    const root = mkdtempSync(join(tmpdir(), 'grant-root-'));
    const env = {
      MONOMIND_ORGRT_OPERATOR_DIR: join(root, 'op'),
      MONOMIND_ORG_NAME: 'release',
      MONOMIND_ORG_ROLE: 'runtime-qa',
    };
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    expect(drillSigningScope(root, env).ok).toBe(true);
    expect(drillSigningScope(root, { ...env, MONOMIND_ORG_NAME: 'prod' }).ok).toBe(false);
    expect(drillSigningScope(root, { ...env, MONOMIND_ORG_ROLE: 'boss' }).ok).toBe(false);
  });
});

describe('org drill-grant', () => {
  const ctx = (flags: Record<string, unknown> = {}) =>
    ({ args: [], flags: { _: [], ...flags }, cwd: home, interactive: false }) as CommandContext;
  const stored = () => JSON.parse(readFileSync(join(home, FILE), 'utf8')).org.allowDrillSigning;
  const human = () => {
    for (const k of ['MONOMIND_ORG_ROLE', 'CLAUDECODE', 'AI_AGENT', 'AGENT']) vi.stubEnv(k, '');
  };

  it('refuses from an org role or agent process, writing nothing', async () => {
    vi.stubEnv('MONOMIND_ORG_ROLE', 'runtime-qa');
    const r = await drillGrantAction(ctx({ org: 'release', role: 'runtime-qa', ttl: 60 }));
    expect(r.success).toBe(false);
    expect(() => readFileSync(join(home, FILE))).toThrow();
  });
  it('requires an org and a role, and caps the ttl at 24 hours', async () => {
    human();
    expect((await drillGrantAction(ctx({ role: 'runtime-qa', ttl: 60 }))).success).toBe(false);
    expect((await drillGrantAction(ctx({ org: 'release', ttl: 60 }))).success).toBe(false);
    const long = ctx({ org: 'release', role: 'runtime-qa', ttl: 24 * 60 + 1 });
    expect((await drillGrantAction(long)).success).toBe(false);
  });
  it('writes a grant the reader accepts, and --revoke turns it off', async () => {
    human();
    const r = await drillGrantAction(ctx({ org: 'release', role: 'runtime-qa', ttl: 120 }));
    expect(r.success).toBe(true);
    expect(stored().orgs).toEqual(['release']);
    expect(allowDrillSigning(home, { org: 'release', role: 'runtime-qa' })).toBe(true);
    expect((await drillGrantAction(ctx({ revoke: true }))).success).toBe(true);
    expect(stored()).toBe(false);
    expect(allowDrillSigning(home, { org: 'release', role: 'runtime-qa' })).toBe(false);
  });
});
