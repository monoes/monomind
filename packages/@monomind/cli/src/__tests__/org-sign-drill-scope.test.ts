// #699: release QA drills run a throwaway org from a role. A role must still
// never sign for the operator, but may sign a scratch project against a key of
// its own: operator dir moved inside the project, project not in a git repo.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAction } from '../commands/org-sign.js';
import { drillSigningScope } from '../orgrt/operator-dir-guard.js';
import {
  ensureOperatorProtectedPaths,
  operatorProtectedPaths,
} from '../orgrt/operator-protected-paths.js';
import { allowDrillSigning } from '../orgrt/operator-settings.js';
import { setOrgSignatureEnforcement, verifyOrgDef } from '../orgrt/org-signature.js';
import { ORG_DIR } from '../orgrt/types.js';
import type { CommandContext } from '../types.js';
import { mkdtempSync } from './tmp-track.js';

// The operator's home as the passwd database reports it: the only place the
// setting is read from. A role's $HOME / $MONOMIND_HOME never count.
const fake = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, userInfo: () => ({ ...os.userInfo(), homedir: fake.home }) };
});

const def = { name: 'o', goal: 'g', roles: [{ id: 'boss', type: 'boss', reports_to: null }] };
let root: string;
let opDir: string;
let opHome: string;
const SETTINGS = '.monomind/operator-settings.json';
const operatorSets = (value: unknown, home = opHome) => {
  mkdirSync(join(home, '.monomind'), { recursive: true });
  writeFileSync(join(home, SETTINGS), JSON.stringify({ org: { allowDrillSigning: value } }), {
    mode: 0o600,
  });
};
beforeEach(() => {
  opHome = mkdtempSync(join(tmpdir(), 'drill-home-'));
  fake.home = opHome;
  setOrgSignatureEnforcement(true);
  root = mkdtempSync(join(tmpdir(), 'drill-'));
  mkdirSync(join(root, ORG_DIR), { recursive: true });
  writeFileSync(join(root, ORG_DIR, 'o.json'), JSON.stringify(def));
  opDir = join(root, 'drill-operator');
  vi.stubEnv('MONOMIND_ORG_ROLE', 'runtime-qa');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  setOrgSignatureEnforcement(false);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const ctx = () =>
  ({ args: ['o'], flags: { _: [], yes: true }, cwd: root, interactive: false }) as CommandContext;

describe('drillSigningScope', () => {
  it('is off by default, with the override and a scratch project', () => {
    expect(drillSigningScope(root, { MONOMIND_ORGRT_OPERATOR_DIR: opDir }).ok).toBe(false);
    operatorSets(false);
    expect(drillSigningScope(root, { MONOMIND_ORGRT_OPERATOR_DIR: opDir }).ok).toBe(false);
    operatorSets('true');
    expect(drillSigningScope(root, { MONOMIND_ORGRT_OPERATOR_DIR: opDir }).ok).toBe(false);
  });
  it('ignores a setting file that is group-writable, a symlink or foreign-shaped', () => {
    operatorSets(true);
    chmodSync(join(opHome, SETTINGS), 0o664);
    expect(allowDrillSigning(opHome)).toBe(false);
    const real = join(opHome, 'real.json');
    writeFileSync(real, JSON.stringify({ org: { allowDrillSigning: true } }), { mode: 0o600 });
    rmSync(join(opHome, SETTINGS));
    symlinkSync(real, join(opHome, SETTINGS));
    expect(allowDrillSigning(opHome)).toBe(false);
  });
  it('needs the operator dir override, inside the project', () => {
    operatorSets(true);
    expect(drillSigningScope(root, {}).ok).toBe(false);
    expect(drillSigningScope(root, { MONOMIND_ORGRT_OPERATOR_DIR: tmpdir() }).ok).toBe(false);
    expect(drillSigningScope(root, { MONOMIND_ORGRT_OPERATOR_DIR: root }).ok).toBe(false);
    expect(drillSigningScope(root, { MONOMIND_ORGRT_OPERATOR_DIR: opDir }).ok).toBe(true);
  });
  it('refuses a project in a git work tree', () => {
    operatorSets(true);
    mkdirSync(join(root, '.git'));
    expect(drillSigningScope(root, { MONOMIND_ORGRT_OPERATOR_DIR: opDir }).ok).toBe(false);
    const sub = join(root, 'sub');
    mkdirSync(sub);
    expect(drillSigningScope(sub, { MONOMIND_ORGRT_OPERATOR_DIR: join(sub, 'op') }).ok).toBe(false);
  });
});

describe('org sign from a role', () => {
  it('refuses by default even with the override, a scratch project and a role marker', async () => {
    vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', opDir);
    const r = await signAction(ctx());
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/role context/);
    expect(existsSync(opDir)).toBe(false);
  });
  it('cannot be forged by the role: its own $HOME / $MONOMIND_HOME / files do not enable it', async () => {
    const forged = mkdtempSync(join(tmpdir(), 'drill-forged-'));
    operatorSets(true, forged); // what a role can write inside its own sandbox
    vi.stubEnv('HOME', forged);
    vi.stubEnv('MONOMIND_HOME', join(forged, '.monomind'));
    vi.stubEnv('XDG_CONFIG_HOME', forged);
    vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', opDir);
    mkdirSync(join(root, '.monomind'), { recursive: true });
    writeFileSync(join(root, SETTINGS), JSON.stringify({ org: { allowDrillSigning: true } }));
    writeFileSync(
      join(root, 'monomind.config.json'),
      JSON.stringify({ org: { allowDrillSigning: true } }),
    );
    const r = await signAction(ctx());
    expect(r.success).toBe(false);
    expect(existsSync(opDir)).toBe(false);
  });
  it('still refuses with no drill scope', async () => {
    const r = await signAction(ctx());
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/role context/);
  });
  it('refuses when the project is a git repo, writing nothing', async () => {
    operatorSets(true);
    mkdirSync(join(root, '.git'));
    vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', opDir);
    expect((await signAction(ctx())).success).toBe(false);
    expect(existsSync(opDir)).toBe(false);
  });
  it('signs a scratch project against its own key, verifiable only there', async () => {
    operatorSets(true);
    vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', opDir);
    const r = await signAction(ctx());
    expect(r.success).toBe(true);
    expect(readdirSync(opDir).length).toBeGreaterThan(0);
    expect(verifyOrgDef(root, 'o', def, { dir: opDir }).ok).toBe(true);
    const other = mkdtempSync(join(tmpdir(), 'drill-other-'));
    expect(verifyOrgDef(root, 'o', def, { dir: other }).ok).toBe(false);
  });
});

describe('the setting file is sealed from roles before they start', () => {
  it('is pre-created all-off, never overwritten, and a protected path', () => {
    const env = {} as NodeJS.ProcessEnv;
    ensureOperatorProtectedPaths({ home: opHome, env, platform: 'linux' });
    expect(allowDrillSigning(opHome)).toBe(false);
    expect(existsSync(join(opHome, SETTINGS))).toBe(true);
    operatorSets(true);
    ensureOperatorProtectedPaths({ home: opHome, env, platform: 'linux' });
    expect(allowDrillSigning(opHome)).toBe(true);
    expect(operatorProtectedPaths({ home: opHome, env })).toContain(join(opHome, SETTINGS));
  });
});
