// packages/@monomind/cli/__tests__/orgrt/authority-mask.test.ts
/**
 * Human authority (operator credentials, the dashboard's human-auth secret,
 * the decision files) is kept from EVERY role: the SDK sandbox carries it for
 * Claude roles below push; everything else runs inside a minimal bubblewrap
 * layer (authority-mask.ts). The end-to-end cases run the real bwrap.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeAgentRunner } from '../../src/orgrt/agent-runner.js';
import {
  authorityMaskArgs,
  authorityMaskAvailability,
  ensureAuthorityDirs,
  isDecisionFile,
  maskedCommand,
} from '../../src/orgrt/authority-mask.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { prepareGitGuard, gitCommonDir } from '../../src/orgrt/git-guard.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildClaudeRestrictions, roleAuthorityMask } from '../../src/orgrt/role-sandbox.js';
import type { BusEvent } from '../../src/orgrt/types.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));

/** A fake $HOME and project with every kind of human-authority file. */
function world() {
  const home = scratch('am-home-');
  const root = scratch('am-root-');
  const env = {} as NodeJS.ProcessEnv;
  ensureAuthorityDirs(home, env);
  writeFileSync(join(home, '.monomind/orgrt-operator/acme.json'), '{"credential":"OPERATOR"}');
  writeFileSync(join(home, '.monomind/dashboard-auth/secret'), 'HUMAN');
  mkdirSync(join(root, '.monomind/orgs/acme'), { recursive: true });
  writeFileSync(join(root, '.monomind/dashboard-token'), 'TOKEN');
  writeFileSync(join(root, '.monomind/orgs/acme/gates.json'), '{"gates":[]}');
  writeFileSync(join(root, '.monomind/orgs/acme/inbox.jsonl'), '');
  return { home, root, env };
}

describe('isDecisionFile', () => {
  it('matches the four decision files of an org dir, nothing else', () => {
    expect(isDecisionFile('/p/.monomind/orgs/acme/gates.json')).toBe(true);
    expect(isDecisionFile('/p/.monomind/orgs/acme/inbox.jsonl')).toBe(true);
    expect(isDecisionFile('/p/.monomind/orgs/acme/runtime.json')).toBe(false);
    expect(isDecisionFile('/p/.monomind/orgs/acme/run-1/gates.json')).toBe(false);
    expect(isDecisionFile('/p/src/gates.json')).toBe(false);
  });
});

describe.runIf(authorityMaskAvailability().available)('the bubblewrap mask (real bwrap)', () => {
  const inMask = (w: ReturnType<typeof world>, script: string) => {
    const [cmd, argv] = maskedCommand(
      authorityMaskArgs({ home: w.home, env: w.env, roots: [w.root], orgRoot: w.root }),
      'bash',
      ['-c', script],
    );
    return spawnSync(cmd, argv, { encoding: 'utf8' });
  };

  it('hides the credentials, including a file created after the mask was built', () => {
    const w = world();
    const args = authorityMaskArgs({ home: w.home, env: w.env, roots: [w.root], orgRoot: w.root });
    writeFileSync(join(w.home, '.monomind/orgrt-operator/late.json'), 'LATE');
    const [cmd, argv] = maskedCommand(args, 'bash', [
      '-c',
      `cat ${w.home}/.monomind/orgrt-operator/* ${w.home}/.monomind/dashboard-auth/* ${w.root}/.monomind/dashboard-token 2>/dev/null; true`,
    ]);
    const out = spawnSync(cmd, argv, { encoding: 'utf8' }).stdout;
    expect(out).not.toMatch(/OPERATOR|HUMAN|TOKEN|LATE/);
  });

  it('makes the decision files unwritable and unremovable, and leaves other work alone', () => {
    const w = world();
    const gates = join(w.root, '.monomind/orgs/acme/gates.json');
    const r = inMask(
      w,
      `echo forged > ${gates}; rm -f ${gates}; mkdir -p ${w.root}/work && echo ok > ${w.root}/work/out.txt`,
    );
    expect(readFileSync(gates, 'utf8')).toBe('{"gates":[]}');
    expect(readFileSync(join(w.root, 'work/out.txt'), 'utf8')).toBe('ok\n');
    expect(r.stderr).toMatch(/Read-only|busy/i);
  });

  it('writes nothing the role puts in a hidden dir to the real one', () => {
    const w = world();
    inMask(w, `echo planted > ${w.home}/.monomind/dashboard-auth/secret2`);
    expect(existsSync(join(w.home, '.monomind/dashboard-auth/secret2'))).toBe(false);
  });
});

describe('roleAuthorityMask', () => {
  const bus = () => new OrgBus('o', 'r', scratch('am-bus-'));
  const audits = (b: OrgBus) => {
    const seen: BusEvent[] = [];
    b.subscribe((e) => seen.push(e));
    return seen;
  };
  const base = { roleId: 'coder', cwd: '/w', orgRoot: '/w', home: '/h', env: {} };

  it('is not applied on top of the SDK sandbox, nor to an in-process runtime', () => {
    const available = { available: true };
    expect(roleAuthorityMask({ ...base, bus: bus(), inSdkSandbox: true, inProcess: false, availability: available })).toBeUndefined();
    expect(roleAuthorityMask({ ...base, bus: bus(), inSdkSandbox: false, inProcess: true, availability: available })).toBeUndefined();
  });

  it('wraps a role outside the SDK sandbox', () => {
    const mask = roleAuthorityMask({ ...base, bus: bus(), inSdkSandbox: false, inProcess: false, availability: { available: true } });
    expect(mask?.slice(0, 3)).toEqual(['--dev-bind', '/', '/']);
  });

  it('fails open with a loud audit when bubblewrap cannot run', () => {
    const b = bus();
    const seen = audits(b);
    const mask = roleAuthorityMask({ ...base, bus: b, inSdkSandbox: false, inProcess: false, availability: { available: false, reason: 'bwrap not found' } });
    expect(mask).toBeUndefined();
    expect(seen).toContainEqual(expect.objectContaining({ type: 'audit', reason: 'authority-mask-unavailable' }));
  });
});

describe('SDK sandbox and file tools carry the same protection', () => {
  it('denies the dashboard-auth dir and the decision files to a sandboxed Claude role', () => {
    const w = world();
    spawnSync('git', ['init', '-q', w.root]);
    const guard = prepareGitGuard({ level: 'read', stateDir: join(w.root, 'guard'), protectedGitDirs: [gitCommonDir(w.root)!] })!;
    const r = buildClaudeRestrictions(guard, undefined, { cwd: w.root, orgRoot: w.root, home: w.home, tmp: '/tmp', env: w.env }, true);
    const sb = r.sandbox as any;
    expect(sb.filesystem.denyRead).toContain(join(w.home, '.monomind/dashboard-auth'));
    expect(sb.filesystem.denyWrite).toContain(join(w.root, '.monomind/orgs/acme/gates.json'));
    expect(r.disallowedTools).toContain(`Edit(/${join(w.root, '.monomind/orgs/*/gates.json')})`);
    expect(r.disallowedTools).toContain(`Read(/${join(w.home, '.monomind/dashboard-auth')}/**)`);
  });

  it('refuses a file-tool write to a decision file but still allows reading it', async () => {
    const w = world();
    const p = new PolicyEngine('coder', {}, new OrgBus('o', 'r', scratch('am-bus-')), w.root);
    const file = join(w.root, '.monomind/orgs/acme/gates.json');
    expect((await p.decide('Write', { file_path: file, content: '{}' })).behavior).toBe('deny');
    expect((await p.decide('Read', { file_path: file })).behavior).toBe('allow');
  });
});

describe('ClaudeAgentRunner', () => {
  it('launches the Claude Code process inside the mask when it is given one', async () => {
    let options: any;
    const runner = new ClaudeAgentRunner(((a: any) => {
      options = a.options;
      return (async function* () {})();
    }) as any);
    const run = (authorityMask?: string[]) =>
      runner.run({ tools: [], prompt: (async function* () {})(), systemPrompt: '', cwd: '/tmp', env: {}, maxTurns: 1, authorityMask } as any);
    for await (const _ of run(['--dev-bind', '/', '/']));
    expect(typeof options.spawnClaudeCodeProcess).toBe('function');
    for await (const _ of run(undefined));
    expect('spawnClaudeCodeProcess' in options).toBe(false);
  });
});
