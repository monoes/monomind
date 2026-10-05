// #365: `monomind org role set-access <org> <role> <full|scoped>` — the
// human-only write path for policy.access. This process runs INSIDE a
// Claude Code agent turn (CLAUDECODE=1, CLAUDE_CODE_ENTRYPOINT=cli are set
// in the real ambient env), so every "human grants access" test must
// explicitly clear the agent-context markers first — that clearing is
// itself the thing the agent-context-refusal tests assert stays enforced
// when it's NOT done.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessAction } from '../commands/org-subcommands-role.js';
import { resolveRoleAccess } from '../orgrt/access-grant.js';
import { readFullAccessGrantKey } from '../orgrt/access-grant-key.js';
import { AGENT_CONTEXT_ENV_MARKERS } from '../orgrt/agent-context.js';
import { ORG_DIR, OrgDefSchema } from '../orgrt/types.js';
import type { CommandContext } from '../types.js';

const AGENT_MARKERS = AGENT_CONTEXT_ENV_MARKERS;

let operatorDir: string;

beforeEach(() => {
  // A clean "human's own terminal": no agent-context marker set.
  for (const k of AGENT_MARKERS) vi.stubEnv(k, undefined);
  // A fresh, isolated operator-credential dir per test — never the real
  // machine's ~/.monomind/orgrt-operator (broker.ts's own override var).
  operatorDir = mkdtempSync(join(tmpdir(), 'org-role-operator-'));
  vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', operatorDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeOrg(cwd: string, name: string, def: Record<string, unknown>): string {
  const dir = join(cwd, ORG_DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(def, null, 2), 'utf8');
  return path;
}

function ctx(
  args: string[],
  flags: Record<string, unknown> = {},
  interactive = false,
): CommandContext {
  return {
    args,
    flags: { _: [], ...flags } as CommandContext['flags'],
    cwd: mkdtempSync(join(tmpdir(), 'org-role-set-access-')),
    interactive,
  };
}

describe('org role set-access', () => {
  it('usage error with too few args', async () => {
    const c = ctx(['myorg']);
    const res = await setAccessAction(c);
    expect(res.success).toBe(false);
  });

  it('org not found', async () => {
    const c = ctx(['nope', 'builder', 'full'], { 'yes-i-understand': true });
    const res = await setAccessAction(c);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/org not found/);
  });

  it('non-interactive grant without --yes-i-understand is refused', async () => {
    const c = ctx(['myorg', 'builder', 'full']);
    makeOrg(c.cwd, 'myorg', {
      name: 'myorg',
      roles: [{ id: 'builder', runtime: 'claude' }],
    });
    const res = await setAccessAction(c);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/--yes-i-understand/);
    const written = JSON.parse(readFileSync(join(c.cwd, ORG_DIR, 'myorg.json'), 'utf8'));
    expect(written.roles[0].policy).toBeUndefined();
  });

  it('refuses to grant full access on a runtime that does not support it', async () => {
    const c = ctx(['myorg', 'builder', 'full'], { 'yes-i-understand': true });
    makeOrg(c.cwd, 'myorg', { name: 'myorg', roles: [{ id: 'builder', runtime: 'hermes' }] });
    const res = await setAccessAction(c);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/does not support full access/);
  });

  it('#567: refuses a role whose provider.kind puts it on a runtime without full access (vercel)', async () => {
    const c = ctx(['myorg', 'builder', 'full'], { 'yes-i-understand': true });
    makeOrg(c.cwd, 'myorg', {
      name: 'myorg',
      roles: [{ id: 'builder', provider: { kind: 'vercel-api-key', vendor: 'openai' } }],
    });
    const res = await setAccessAction(c);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/does not support full access/);
    const written = JSON.parse(readFileSync(join(c.cwd, ORG_DIR, 'myorg.json'), 'utf8'));
    expect(written.roles[0].policy).toBeUndefined();
  });

  it('grants full access on a non-claude full-access runtime (codex)', async () => {
    const c = ctx(['myorg', 'builder', 'full'], { 'yes-i-understand': true });
    makeOrg(c.cwd, 'myorg', { name: 'myorg', roles: [{ id: 'builder', runtime: 'codex' }] });
    const res = await setAccessAction(c);
    expect(res.success).toBe(true);
    const written = JSON.parse(readFileSync(join(c.cwd, ORG_DIR, 'myorg.json'), 'utf8'));
    expect(written.roles[0].policy.access).toBe('full');
  });

  for (const marker of AGENT_MARKERS) {
    it(`refuses a full grant under agent-context marker ${marker}, even with --yes-i-understand`, async () => {
      vi.stubEnv(marker, '1');
      const c = ctx(['myorg', 'builder', 'full'], { 'yes-i-understand': true });
      const path = makeOrg(c.cwd, 'myorg', {
        name: 'myorg',
        roles: [{ id: 'builder', runtime: 'claude' }],
      });
      const res = await setAccessAction(c);
      expect(res.success).toBe(false);
      expect(res.message).toMatch(/agent context/);
      const written = JSON.parse(readFileSync(path, 'utf8'));
      expect(written.roles[0].policy).toBeUndefined();
    });
  }

  it('--yes-i-understand grants full access and writes a matching, signed access_ack', async () => {
    const c = ctx(['myorg', 'builder', 'full'], { 'yes-i-understand': true });
    const path = makeOrg(c.cwd, 'myorg', {
      name: 'myorg',
      roles: [{ id: 'builder', runtime: 'claude', responsibilities: ['ship it'] }],
    });
    const res = await setAccessAction(c);
    expect(res.success).toBe(true);
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    expect(raw.roles[0].policy.access).toBe('full');
    expect(raw.roles[0].policy.access_ack.by).toBe('human');
    expect(typeof raw.roles[0].policy.access_ack.hash).toBe('string');
    expect(typeof raw.roles[0].policy.access_ack.sig).toBe('string');

    // The written grant must actually resolve to active for the runtime.
    const def = OrgDefSchema.parse(raw);
    const resolved = resolveRoleAccess(def, def.roles[0]);
    expect(resolved).toEqual({ access: 'full', declared: 'full', state: 'active' });
  });

  it('the grant key lands in the operator dir, mode 0600', async () => {
    const c = ctx(['myorg', 'builder', 'full'], { 'yes-i-understand': true });
    makeOrg(c.cwd, 'myorg', { name: 'myorg', roles: [{ id: 'builder', runtime: 'claude' }] });
    await setAccessAction(c);
    const { statSync } = await import('node:fs');
    const { fullAccessGrantKeyPath } = await import('../orgrt/access-grant-key.js');
    const keyPath = fullAccessGrantKeyPath(operatorDir);
    const st = statSync(keyPath);
    expect(st.mode & 0o777).toBe(0o600);
    expect(readFullAccessGrantKey(operatorDir)?.length).toBe(32);
  });

  it('a forged ack (correct hash, no sig) is suspended, not active', async () => {
    const c = ctx(['myorg', 'builder', 'full'], { 'yes-i-understand': true });
    const path = makeOrg(c.cwd, 'myorg', {
      name: 'myorg',
      roles: [{ id: 'builder', runtime: 'claude', responsibilities: ['ship it'] }],
    });
    await setAccessAction(c);
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    // Simulate a config-writing path that recomputed the PUBLIC hash itself
    // (it's derivable from fields already in the file) but has no way to
    // produce a valid sig.
    delete raw.roles[0].policy.access_ack.sig;
    const def = OrgDefSchema.parse(raw);
    const resolved = resolveRoleAccess(def, def.roles[0], { grantKeyDir: operatorDir });
    expect(resolved.access).toBe('scoped');
    expect(resolved.state).toBe('suspended');
    expect(resolved.reason).toMatch(/unsigned/);
  });

  it('a forged ack with a made-up sig is suspended (invalid-signature)', async () => {
    const c = ctx(['myorg', 'builder', 'full'], { 'yes-i-understand': true });
    const path = makeOrg(c.cwd, 'myorg', {
      name: 'myorg',
      roles: [{ id: 'builder', runtime: 'claude', responsibilities: ['ship it'] }],
    });
    await setAccessAction(c);
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    raw.roles[0].policy.access_ack.sig = 'deadbeef'.repeat(8);
    const def = OrgDefSchema.parse(raw);
    const resolved = resolveRoleAccess(def, def.roles[0], { grantKeyDir: operatorDir });
    expect(resolved.access).toBe('scoped');
    expect(resolved.state).toBe('suspended');
    expect(resolved.reason).toMatch(/invalid-signature/);
  });

  it('a genuinely fresh grant on a role with no prior key (attacker computes hash+garbage sig) is suspended', async () => {
    // No org role set-access ever ran here, so no key exists at all in this
    // operator dir — the scenario for an org file authored entirely outside
    // the human CLI path.
    const raw = {
      name: 'myorg',
      roles: [{ id: 'builder', runtime: 'claude', responsibilities: ['ship it'] }],
    };
    const def = OrgDefSchema.parse(raw);
    const role = def.roles[0];
    const { computeAccessAckHash } = await import('../orgrt/access-ack.js');
    role.policy = {
      access: 'full',
      access_ack: {
        by: 'human',
        at: new Date().toISOString(),
        hash: computeAccessAckHash(def, role),
        sig: 'a'.repeat(64),
      },
    };
    const resolved = resolveRoleAccess(def, role, { grantKeyDir: operatorDir });
    expect(resolved.access).toBe('scoped');
    expect(resolved.state).toBe('suspended');
    expect(resolved.reason).toMatch(/invalid-signature/);
  });

  it('key missing after a valid grant (deleted/wrong host) suspends the role', async () => {
    const c = ctx(['myorg', 'builder', 'full'], { 'yes-i-understand': true });
    const path = makeOrg(c.cwd, 'myorg', {
      name: 'myorg',
      roles: [{ id: 'builder', runtime: 'claude', responsibilities: ['ship it'] }],
    });
    await setAccessAction(c);
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const def = OrgDefSchema.parse(raw);
    // Point resolution at an operator dir where the key never existed.
    const emptyDir = mkdtempSync(join(tmpdir(), 'org-role-no-key-'));
    const resolved = resolveRoleAccess(def, def.roles[0], { grantKeyDir: emptyDir });
    expect(resolved.access).toBe('scoped');
    expect(resolved.state).toBe('suspended');
    expect(resolved.reason).toMatch(/invalid-signature/);
  });

  it('a subsequent unrelated config edit suspends a validly signed grant (config-changed)', async () => {
    const c = ctx(['myorg', 'builder', 'full'], { 'yes-i-understand': true });
    const path = makeOrg(c.cwd, 'myorg', {
      name: 'myorg',
      roles: [{ id: 'builder', runtime: 'claude', responsibilities: ['ship it'] }],
    });
    await setAccessAction(c);
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    raw.roles[0].responsibilities = ['ship something else entirely'];
    writeFileSync(path, JSON.stringify(raw, null, 2), 'utf8');
    const def = OrgDefSchema.parse(raw);
    const resolved = resolveRoleAccess(def, def.roles[0], { grantKeyDir: operatorDir });
    expect(resolved.state).toBe('suspended');
    expect(resolved.reason).toMatch(/config-changed/);
  });

  it('set-access scoped removes access and access_ack, and is allowed under an agent-context marker', async () => {
    const c = ctx(['myorg', 'builder', 'full'], { 'yes-i-understand': true });
    const path = makeOrg(c.cwd, 'myorg', {
      name: 'myorg',
      roles: [{ id: 'builder', runtime: 'claude' }],
    });
    await setAccessAction(c);
    vi.stubEnv('CLAUDECODE', '1');
    const c2 = { ...ctx(['myorg', 'builder', 'scoped']), cwd: c.cwd };
    const res = await setAccessAction(c2);
    expect(res.success).toBe(true);
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    expect(raw.roles[0].policy.access).toBeUndefined();
    expect(raw.roles[0].policy.access_ack).toBeUndefined();
  });
});
