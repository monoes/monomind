// #699: release QA drills run a throwaway org from a role. A role must still
// never sign for the operator, but may sign a scratch project against a key of
// its own: operator dir moved inside the project, project not in a git repo.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAction } from '../commands/org-sign.js';
import { drillSigningScope } from '../orgrt/operator-dir-guard.js';
import { setOrgSignatureEnforcement, verifyOrgDef } from '../orgrt/org-signature.js';
import { ORG_DIR } from '../orgrt/types.js';
import type { CommandContext } from '../types.js';
import { mkdtempSync } from './tmp-track.js';

const def = { name: 'o', goal: 'g', roles: [{ id: 'boss', type: 'boss', reports_to: null }] };
let root: string;
let opDir: string;
beforeEach(() => {
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
  it('needs the operator dir override, inside the project', () => {
    expect(drillSigningScope(root, {}).ok).toBe(false);
    expect(drillSigningScope(root, { MONOMIND_ORGRT_OPERATOR_DIR: tmpdir() }).ok).toBe(false);
    expect(drillSigningScope(root, { MONOMIND_ORGRT_OPERATOR_DIR: root }).ok).toBe(false);
    expect(drillSigningScope(root, { MONOMIND_ORGRT_OPERATOR_DIR: opDir }).ok).toBe(true);
  });
  it('refuses a project in a git work tree', () => {
    mkdirSync(join(root, '.git'));
    expect(drillSigningScope(root, { MONOMIND_ORGRT_OPERATOR_DIR: opDir }).ok).toBe(false);
    const sub = join(root, 'sub');
    mkdirSync(sub);
    expect(drillSigningScope(sub, { MONOMIND_ORGRT_OPERATOR_DIR: join(sub, 'op') }).ok).toBe(false);
  });
});

describe('org sign from a role', () => {
  it('still refuses with no drill scope', async () => {
    const r = await signAction(ctx());
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/role context/);
  });
  it('refuses when the project is a git repo, writing nothing', async () => {
    mkdirSync(join(root, '.git'));
    vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', opDir);
    expect((await signAction(ctx())).success).toBe(false);
    expect(existsSync(opDir)).toBe(false);
  });
  it('signs a scratch project against its own key, verifiable only there', async () => {
    vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', opDir);
    const r = await signAction(ctx());
    expect(r.success).toBe(true);
    expect(readdirSync(opDir).length).toBeGreaterThan(0);
    expect(verifyOrgDef(root, 'o', def, { dir: opDir }).ok).toBe(true);
    const other = mkdtempSync(join(tmpdir(), 'drill-other-'));
    expect(verifyOrgDef(root, 'o', def, { dir: other }).ok).toBe(false);
  });
});
