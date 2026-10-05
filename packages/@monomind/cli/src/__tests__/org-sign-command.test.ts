// #502: `monomind org sign` and the migration path for orgs made before
// signing existed (`org run` from a terminal offers a one-time review and
// sign; every other path refuses with the `org sign` hint).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirmAnswer = vi.hoisted(() => ({ value: false, asked: 0 }));
vi.mock('../prompt.js', () => ({
  confirm: async () => {
    confirmAnswer.asked++;
    return confirmAnswer.value;
  },
}));

import { ensureOrgSignedForRun, signAction } from '../commands/org-sign.js';
import { setAccessAction } from '../commands/org-subcommands-role.js';
import { AGENT_CONTEXT_ENV_MARKERS } from '../orgrt/agent-context.js';
import { setOrgSignatureEnforcement, signOrgDef, verifyOrgDef } from '../orgrt/org-signature.js';
import { ORG_DIR } from '../orgrt/types.js';
import type { CommandContext } from '../types.js';

let cwd: string;
beforeEach(() => {
  setOrgSignatureEnforcement(true);
  for (const k of AGENT_CONTEXT_ENV_MARKERS) vi.stubEnv(k, undefined);
  vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', mkdtempSync(join(tmpdir(), 'osc-op-')));
  cwd = mkdtempSync(join(tmpdir(), 'osc-root-'));
  confirmAnswer.value = false;
  confirmAnswer.asked = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  setOrgSignatureEnforcement(false);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const def = (git = 'read') => ({
  name: 'o',
  goal: 'g',
  roles: [
    { id: 'boss', type: 'boss', reports_to: null },
    { id: 'dev', reports_to: 'boss', policy: { git } },
  ],
});
function writeDef(name: string, body: unknown = def()): void {
  mkdirSync(join(cwd, ORG_DIR), { recursive: true });
  writeFileSync(join(cwd, ORG_DIR, `${name}.json`), JSON.stringify(body));
}
const raw = (name: string) => JSON.parse(readFileSync(join(cwd, ORG_DIR, `${name}.json`), 'utf8'));
const ctx = (args: string[], flags: Record<string, unknown> = {}, interactive = false) =>
  ({ args, flags: { _: [], ...flags }, cwd, interactive }) as CommandContext;
const logged = () =>
  (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join('\n');

describe('org sign', () => {
  it('signs one org (round trip: the runtime then verifies it)', async () => {
    writeDef('o');
    expect(verifyOrgDef(cwd, 'o', raw('o')).ok).toBe(false);
    const r = await signAction(ctx(['o'], { yes: true }));
    expect(r.success).toBe(true);
    expect(verifyOrgDef(cwd, 'o', raw('o'))).toEqual({ ok: true });
    expect(logged()).toMatch(/dev: runtime claude · git read · access scoped/);
  });

  it('--all signs every org in the project', async () => {
    writeDef('a');
    writeDef('b');
    expect((await signAction(ctx([], { all: true, yes: true }))).success).toBe(true);
    expect(verifyOrgDef(cwd, 'a', raw('a')).ok).toBe(true);
    expect(verifyOrgDef(cwd, 'b', raw('b')).ok).toBe(true);
  });

  it('asks on a TTY and signs nothing when declined', async () => {
    writeDef('o');
    const r = await signAction(ctx(['o'], {}, true));
    expect(confirmAnswer.asked).toBe(1);
    expect(r.success).toBe(false);
    expect(verifyOrgDef(cwd, 'o', raw('o')).ok).toBe(false);
  });

  it('needs --yes off a TTY', async () => {
    writeDef('o');
    expect((await signAction(ctx(['o']))).message).toMatch(/--yes/);
    expect(verifyOrgDef(cwd, 'o', raw('o')).ok).toBe(false);
  });

  it("refuses inside an org role's process tree, whatever the flags", async () => {
    writeDef('o');
    vi.stubEnv('MONOMIND_ORG_ROLE', 'dev');
    const r = await signAction(ctx(['o'], { yes: true }));
    expect(r.message).toMatch(/refused: role context/);
    expect(verifyOrgDef(cwd, 'o', raw('o')).ok).toBe(false);
  });

  it("allows a human's own Claude Code session (the createorg skill's operator)", async () => {
    writeDef('o');
    vi.stubEnv('CLAUDECODE', '1');
    expect((await signAction(ctx(['o'], { yes: true }))).success).toBe(true);
  });
});

describe('migration: org run on an unsigned org', () => {
  it('off a TTY it refuses with the org sign hint', async () => {
    writeDef('o');
    const r = await ensureOrgSignedForRun(ctx(['o']), 'o');
    expect(r?.success).toBe(false);
    expect(logged()).toMatch(/no operator signature — run `monomind org sign o` as the operator/);
    expect(confirmAnswer.asked).toBe(0);
  });

  it('on a TTY it offers a one-time review and sign', async () => {
    writeDef('o');
    confirmAnswer.value = true;
    expect(await ensureOrgSignedForRun(ctx(['o'], {}, true), 'o')).toBeUndefined();
    expect(verifyOrgDef(cwd, 'o', raw('o')).ok).toBe(true);
  });

  it('on a TTY a CHANGED definition is not offered — the operator must run org sign', async () => {
    writeDef('o');
    signOrgDef(cwd, 'o', raw('o'));
    writeDef('o', def('push'));
    confirmAnswer.value = true;
    const r = await ensureOrgSignedForRun(ctx(['o'], {}, true), 'o');
    expect(r?.success).toBe(false);
    expect(confirmAnswer.asked).toBe(0);
    expect(logged()).toMatch(/changed since the operator signed it/);
  });

  it('a signed org passes untouched', async () => {
    writeDef('o');
    signOrgDef(cwd, 'o', raw('o'));
    expect(await ensureOrgSignedForRun(ctx(['o']), 'o')).toBeUndefined();
  });
});

describe('org role set-access keeps a signed org signed', () => {
  it('re-signs after a revoke when the org verified before', async () => {
    writeDef('o');
    signOrgDef(cwd, 'o', raw('o'));
    expect((await setAccessAction(ctx(['o', 'dev', 'scoped']))).success).toBe(true);
    expect(verifyOrgDef(cwd, 'o', raw('o')).ok).toBe(true);
  });

  it('does not sign an org that was not signed before the edit', async () => {
    writeDef('o');
    await setAccessAction(ctx(['o', 'dev', 'scoped']));
    expect(verifyOrgDef(cwd, 'o', raw('o')).ok).toBe(false);
    expect(logged()).toMatch(/not signed for this change/);
  });
});
