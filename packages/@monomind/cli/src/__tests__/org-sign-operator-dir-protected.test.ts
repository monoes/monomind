// #643: a role's sandbox hides the operator-credential dir on purpose (an org
// role must never sign or read the key). `org sign` run from such a role used
// to look like it worked (bubblewrap mounts an empty tmpfs over the dir, so
// the write "succeeds" and vanishes). It must refuse first, with a plain
// message, and `org run` must say why the signature is missing.
import { chmodSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureOrgSignedForRun, signAction } from '../commands/org-sign.js';
import { AGENT_CONTEXT_ENV_MARKERS } from '../orgrt/agent-context.js';
import {
  operatorDirBlockedReason,
  operatorDirProtectedMessage,
} from '../orgrt/operator-dir-guard.js';
import { setOrgSignatureEnforcement } from '../orgrt/org-signature.js';
import { ORG_DIR } from '../orgrt/types.js';
import type { CommandContext } from '../types.js';
import { mkdtempSync } from './tmp-track.js';

let cwd: string;
let opDir: string;
beforeEach(() => {
  setOrgSignatureEnforcement(true);
  for (const k of AGENT_CONTEXT_ENV_MARKERS) vi.stubEnv(k, undefined);
  opDir = join(mkdtempSync(join(tmpdir(), 'osp-op-')), 'orgrt-operator');
  mkdirSync(opDir, { mode: 0o700 });
  vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', opDir);
  cwd = mkdtempSync(join(tmpdir(), 'osp-root-'));
  mkdirSync(join(cwd, ORG_DIR), { recursive: true });
  writeFileSync(
    join(cwd, ORG_DIR, 'o.json'),
    JSON.stringify({
      name: 'o',
      goal: 'g',
      roles: [{ id: 'boss', type: 'boss', reports_to: null }],
    }),
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  setOrgSignatureEnforcement(false);
  try {
    chmodSync(opDir, 0o700);
  } catch {
    /* gone */
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ctx = (flags: Record<string, unknown> = {}, interactive = false) =>
  ({ args: ['o'], flags: { _: [], ...flags }, cwd, interactive }) as CommandContext;
const logged = () =>
  (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join('\n');

describe('operatorDirBlockedReason', () => {
  it('is undefined for a normal, readable operator dir and for one not created yet', () => {
    expect(operatorDirBlockedReason(opDir, { mountinfo: '' })).toBeUndefined();
    expect(operatorDirBlockedReason(join(opDir, 'nope'), { mountinfo: '' })).toBeUndefined();
  });

  it('detects the empty tmpfs the bubblewrap mask mounts over the dir', () => {
    const mi = `500 400 0:50 / ${opDir} rw,nosuid - tmpfs tmpfs rw,size=1k\n`;
    expect(operatorDirBlockedReason(opDir, { mountinfo: mi })).toMatch(/tmpfs/);
  });

  it('ignores a tmpfs mounted elsewhere (a tmpfs /tmp is not the mask)', () => {
    const mi = '500 400 0:50 / /tmp rw - tmpfs tmpfs rw\n';
    expect(operatorDirBlockedReason(opDir, { mountinfo: mi })).toBeUndefined();
  });

  it.skipIf(process.getuid?.() === 0)('detects a dir the sandbox made unreadable', () => {
    chmodSync(opDir, 0o000);
    expect(operatorDirBlockedReason(opDir, { mountinfo: '' })).toMatch(/not readable/);
  });

  it('its message says plainly: protected from org roles, only the operator signs', () => {
    const m = operatorDirProtectedMessage(opDir, 'it is a tmpfs mount');
    expect(m).toMatch(/protected from org roles/);
    expect(m).toMatch(/only the operator signs/);
    expect(m).toContain(opDir);
  });
});

describe('org sign from a role whose sandbox hides the operator dir', () => {
  it.skipIf(process.getuid?.() === 0)(
    'refuses before touching anything, with the plain message',
    async () => {
      chmodSync(opDir, 0o000);
      const r = await signAction(ctx({ yes: true }));
      expect(r.success).toBe(false);
      expect(r.message).toMatch(/protected from org roles/);
      expect(logged()).toMatch(/only the operator signs/);
      chmodSync(opDir, 0o700);
      expect(readdirSync(opDir)).toEqual([]);
    },
  );

  it.skipIf(process.getuid?.() === 0)(
    'org run says why the signature cannot be there',
    async () => {
      chmodSync(opDir, 0o000);
      const r = await ensureOrgSignedForRun(ctx(), 'o');
      expect(r?.success).toBe(false);
      expect(logged()).toMatch(/protected from org roles/);
    },
  );

  it('org run inside a role context carries the same explanation', async () => {
    vi.stubEnv('MONOMIND_ORG_ROLE', 'dev');
    const r = await ensureOrgSignedForRun(ctx(), 'o');
    expect(r?.success).toBe(false);
    expect(logged()).toMatch(/only the operator signs/);
  });
});
