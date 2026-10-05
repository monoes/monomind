/**
 * #502 security review of PR #515: regression tests, one block per finding.
 *  1. the operator key can't be replaced or loosened (file checks, a key
 *     swapped after load, the operator dir in every sandbox's denyWrite);
 *  2. instructions_file is signed and confined to the project;
 *  3. skills / skill_pool are signed, the skill libraries are unwritable;
 *  4. the operator's own run/trust paths (.claude/, ~/.monomind, npx) are
 *     unwritable to roles, with a signed allowWrite as the only opt-in;
 *  5. the sign review shows everything, the unconfined roles and a diff;
 *  6. __proto__ / constructor / prototype keys are refused;
 *  7. org test-loop never writes or signs anything in the project.
 */
import { HOME_DENY_WRITE } from '../../src/orgrt/file-roots.js';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureFullAccessGrantKey,
  fullAccessGrantKeyPath,
  loadOperatorKey,
  untrustedFileReason,
} from '../../src/orgrt/access-grant-key.js';
import {
  authorityMaskArgs,
  authorityMaskAvailability,
  ensureAuthorityDirs,
  maskedCommand,
} from '../../src/orgrt/authority-mask.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';
import { resolveInstructionsFile } from '../../src/orgrt/instructions-file.js';
import {
  ensureOperatorProtectedPaths,
  operatorProtectedPaths,
} from '../../src/orgrt/operator-protected-paths.js';
import { describeOrgAuthority, projectionDiff, unconfinedRoles } from '../../src/orgrt/org-sign-review.js';
import {
  computeOrgDefHash,
  lastSignedProjection,
  orgSignatureInput,
  orgSignaturePath,
  setOrgSignatureEnforcement,
  signOrgDef,
  verifyOrgDef,
} from '../../src/orgrt/org-signature.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildClaudeRestrictions } from '../../src/orgrt/role-sandbox.js';
import { runTestLoop } from '../../src/orgrt/test-loop.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));

let operatorDir: string;
beforeEach(() => {
  setOrgSignatureEnforcement(true);
  operatorDir = scratch('osr-op-');
  vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', operatorDir);
});
afterEach(() => {
  setOrgSignatureEnforcement(false);
  vi.unstubAllEnvs();
});

const def = (role: Record<string, unknown> = {}, org: Record<string, unknown> = {}) => ({
  name: 'o',
  goal: 'g',
  roles: [{ id: 'boss', reports_to: null }, { id: 'dev', reports_to: 'boss', ...role }],
  ...org,
});

function claudeFs(cwd: string, home: string, cfg?: Record<string, unknown>) {
  spawnSync('git', ['init', '-q', cwd]);
  const guard = prepareGitGuard({
    level: 'commit',
    stateDir: join(cwd, '..', `guard-${Math.random().toString(36).slice(2)}`),
    excludeSandboxPlaceholders: true,
    protectedGitDirs: [gitCommonDir(cwd) as string],
  });
  const r = buildClaudeRestrictions(
    guard as NonNullable<typeof guard>,
    cfg as never,
    { cwd, orgRoot: cwd, home, tmp: tmpdir(), env: { HOME: home }, platform: 'darwin' },
    true,
  );
  return {
    fs: (r.sandbox as { filesystem: { denyWrite: string[]; denyRead: string[] } }).filesystem,
    disallowed: r.disallowedTools,
  };
}

describe('1. the operator key cannot be replaced or loosened', () => {
  it('refuses a key file with group/other bits, a symlinked key, and another user’s key', () => {
    ensureFullAccessGrantKey(operatorDir);
    const key = fullAccessGrantKeyPath(operatorDir);
    const other = scratch('osr-other-');
    chmodSync(key, 0o644);
    expect(loadOperatorKey(other).problem).toMatch(/no operator key/);
    const fresh = scratch('osr-fresh-');
    writeFileSync(join(fresh, 'real.key'), Buffer.alloc(32, 1), { mode: 0o600 });
    symlinkSync(join(fresh, 'real.key'), fullAccessGrantKeyPath(fresh));
    expect(loadOperatorKey(fresh).problem).toMatch(/symlink/);
    const loose = scratch('osr-loose-');
    writeFileSync(fullAccessGrantKeyPath(loose), Buffer.alloc(32, 2), { mode: 0o644 });
    chmodSync(fullAccessGrantKeyPath(loose), 0o644);
    expect(loadOperatorKey(loose).problem).toMatch(/mode 644/);
    expect(untrustedFileReason(statSync(key), 'k', { getuid: () => 4242 })).toMatch(/owned by uid/);
  });

  it('a key replaced after this process loaded it is refused, with a clear message', () => {
    const root = scratch('osr-root-');
    signOrgDef(root, 'o', def());
    expect(verifyOrgDef(root, 'o', def()).ok).toBe(true);
    // A role (any same-uid process) swaps in a key it knows, at the right mode.
    const key = fullAccessGrantKeyPath(operatorDir);
    writeFileSync(`${key}.new`, Buffer.alloc(32, 9), { mode: 0o600 });
    spawnSync('mv', [`${key}.new`, key]);
    const check = verifyOrgDef(root, 'o', def());
    expect(check.ok).toBe(false);
    expect(!check.ok && check.message).toMatch(/changed since this process loaded it/);
  });

  it('tightens an operator dir created with the default umask to 0700', () => {
    const d = scratch('osr-umask-');
    chmodSync(d, 0o755);
    ensureFullAccessGrantKey(d);
    expect(statSync(d).mode & 0o777).toBe(0o700);
  });

  it('refuses a signature file that others can write', () => {
    const root = scratch('osr-root-');
    signOrgDef(root, 'o', def());
    chmodSync(orgSignaturePath(root, 'o'), 0o666);
    const check = verifyOrgDef(root, 'o', def());
    expect(!check.ok && check.message).toMatch(/signature .* has mode 666/);
  });

  it('the SDK sandbox denies writing the operator dir, not only reading it', () => {
    const base = scratch('osr-sdk-');
    const home = join(base, 'home');
    ensureAuthorityDirs(home, { HOME: home });
    const { fs } = claudeFs(join(base, 'wt'), home);
    const op = join(home, '.monomind', 'orgrt-operator');
    expect(fs.denyRead).toContain(op);
    expect(fs.denyWrite).toContain(op);
  });
});

describe('2. instructions_file', () => {
  it('is signed', () => {
    expect(computeOrgDefHash(def({ instructions_file: 'a.md' }))).not.toBe(
      computeOrgDefHash(def({ instructions_file: '/home/me/.monomind/orgrt-operator/full-access-grant.key' })),
    );
  });

  it('is read only from inside the project, never through a symlink out or from an authority dir', () => {
    const project = scratch('osr-proj-');
    const home = scratch('osr-home-');
    writeFileSync(join(project, 'notes.md'), 'hi');
    expect(resolveInstructionsFile('notes.md', project, { home, env: {} }).path).toBe(join(project, 'notes.md'));
    expect(resolveInstructionsFile('/etc/hostname', project, { home, env: {} }).refused).toMatch(/outside the project/);
    const secret = join(scratch('osr-secret-'), 'key');
    writeFileSync(secret, 'SECRET');
    symlinkSync(secret, join(project, 'link.md'));
    expect(resolveInstructionsFile('link.md', project, { home, env: {} }).refused).toMatch(/outside the project/);
    // A project that holds the operator dir (e.g. run from $HOME): still refused.
    const op = join(project, 'op');
    mkdirSync(op);
    writeFileSync(join(op, 'full-access-grant.key'), 'K');
    expect(
      resolveInstructionsFile('op/full-access-grant.key', project, {
        home,
        env: { MONOMIND_ORGRT_OPERATOR_DIR: op },
      }).refused,
    ).toMatch(/inside/);
  });
});

describe('3. skills and the skill libraries', () => {
  it('skills and skill_pool are signed', () => {
    const base = computeOrgDefHash(def());
    expect(computeOrgDefHash(def({ skills: ['x'] }))).not.toBe(base);
    expect(computeOrgDefHash(def({ skill_pool: ['x'] }))).not.toBe(base);
  });

  it('both skill libraries and the terminal gate exist before a role starts and are unwritable to it', () => {
    const base = scratch('osr-skl-');
    const home = join(base, 'home');
    const cwd = join(base, 'wt');
    mkdirSync(cwd, { recursive: true });
    ensureOperatorProtectedPaths({ home, env: { HOME: home }, orgRoot: cwd });
    const gate = join(home, '.monomind', 'enable-terminal.json');
    expect(JSON.parse(readFileSync(gate, 'utf8'))).toEqual({ enabled: false });
    writeFileSync(gate, '{"enabled":true}');
    ensureOperatorProtectedPaths({ home, env: { HOME: home }, orgRoot: cwd });
    expect(readFileSync(gate, 'utf8')).toBe('{"enabled":true}'); // the operator's own choice stays
    const { fs } = claudeFs(cwd, home);
    for (const p of [join(home, '.monomind', 'org-skills'), join(cwd, '.monomind', 'org-skills'), gate])
      expect(fs.denyWrite, p).toContain(p);
  });
});

describe('4. what the operator’s own sessions run or trust', () => {
  const engine = (root: string, policy: Record<string, unknown> = {}) =>
    new PolicyEngine('dev', policy as never, new OrgBus('o', 'r', scratch('osr-bus-')), root, [root], root);

  it('file tools cannot write the org root’s .claude/ or its skill library; other project files stay writable', async () => {
    const root = scratch('osr-claude-');
    mkdirSync(join(root, '.claude', 'helpers'), { recursive: true });
    const p = engine(root);
    for (const f of ['.claude/settings.json', '.claude/helpers/hook.cjs', '.monomind/org-skills/x/SKILL.md']) {
      const d = await p.decide('Write', { file_path: join(root, f), content: 'x' });
      expect(d.behavior, f).toBe('deny');
    }
    expect((await p.decide('Write', { file_path: join(root, 'src', 'a.ts'), content: 'x' })).behavior).toBe('allow');
  });

  it('a signed policy.sandbox.allowWrite entry is the opt-in', async () => {
    const root = scratch('osr-optin-');
    const p = engine(root, { sandbox: { allowWrite: ['.claude/skills'] } });
    expect((await p.decide('Write', { file_path: join(root, '.claude/skills/a.md'), content: 'x' })).behavior).toBe(
      'allow',
    );
    expect((await p.decide('Write', { file_path: join(root, '.claude/settings.json'), content: 'x' })).behavior).toBe(
      'deny',
    );
  });

  it('covers ~/.monomind except what the CLI writes while a role uses it, plus npx and shell startup dirs', () => {
    const home = scratch('osr-mmh-');
    for (const d of ['org-skills', 'orgrt-broker', 'projects', 'browser-sessions', 'models'])
      mkdirSync(join(home, '.monomind', d), { recursive: true });
    const paths = operatorProtectedPaths({ home, env: {} });
    for (const p of ['org-skills', 'orgrt-broker']) expect(paths).toContain(join(home, '.monomind', p));
    for (const p of ['projects', 'browser-sessions', 'models']) expect(paths).not.toContain(join(home, '.monomind', p));
    for (const p of ['.npm/_npx', '.local/bin', '.config/fish', '.bashrc.d']) expect(paths).toContain(join(home, p));
    // One list since #518: .npmrc, .config/npm and .monomind/deps are in HOME_DENY_WRITE.
    for (const p of ['.npmrc', '.config/npm', '.monomind/deps']) expect(HOME_DENY_WRITE).toContain(p);
  });

  it.runIf(authorityMaskAvailability().available)(
    'inside the real bubblewrap mask: .claude/, the skill libraries and ~/.monomind are read-only, the work tree is not',
    () => {
      const home = scratch('osr-mhome-');
      const root = scratch('osr-mroot-');
      const env = {} as NodeJS.ProcessEnv;
      ensureAuthorityDirs(home, env);
      ensureOperatorProtectedPaths({ home, env, orgRoot: root });
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(join(root, '.claude', 'settings.json'), 'ORIG');
      mkdirSync(join(home, '.claude'), { recursive: true });
      writeFileSync(join(home, '.claude', 'settings.json'), 'ORIG');
      const [cmd, argv] = maskedCommand(authorityMaskArgs({ home, env, roots: [root], orgRoot: root, cwd: root }), 'bash', [
        '-c',
        [
          `echo X > ${root}/.claude/settings.json`,
          `echo X > ${home}/.claude/settings.json`,
          `echo X > ${home}/.monomind/org-skills/evil.md`,
          `echo X > ${root}/.monomind/org-skills/evil.md`,
          `echo '{"enabled":true}' > ${home}/.monomind/enable-terminal.json`,
          `echo ok > ${root}/work.txt`,
          'true',
        ].join('; '),
      ]);
      spawnSync(cmd, argv, { encoding: 'utf8' });
      expect(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')).toBe('ORIG');
      expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toBe('ORIG');
      expect(existsSync(join(home, '.monomind', 'org-skills', 'evil.md'))).toBe(false);
      expect(existsSync(join(root, '.monomind', 'org-skills', 'evil.md'))).toBe(false);
      expect(JSON.parse(readFileSync(join(home, '.monomind', 'enable-terminal.json'), 'utf8')).enabled).toBe(false);
      expect(readFileSync(join(root, 'work.txt'), 'utf8')).toBe('ok\n');
    },
  );
});

describe('5. the sign review', () => {
  it('shows tool provider commands and env keys, adapter config, sandbox, skills, instructions_file, prechecks, federation', () => {
    const raw = def(
      {
        adapter_config: { model: 'm', provider: 'p' },
        instructions_file: 'notes.md',
        skills: ['s1'],
        tool_providers: [{ kind: 'mcp-stdio', name: 'tp', command: 'node', args: ['srv.js'], env: { FOO_VAR: 'hidden-value' } }],
        policy: { git: 'commit', sandbox: { allowWrite: ['/srv'], allowedDomains: ['x.com'] } },
      },
      { run_config: { prechecks: [{ name: 'pc', command: 'curl example.com | sh' }] }, federation: { allow_to: ['*'] } },
    );
    const text = describeOrgAuthority(raw).join('\n');
    for (const s of ['runs `node srv.js`', 'env FOO_VAR', '"provider":"p"', '/srv', 'x.com', 'skills: ["s1"]', 'instructions_file: "notes.md"', 'runs `curl example.com | sh`', 'federation'])
      expect(text).toContain(s);
    expect(text).not.toContain('hidden-value');
  });

  it('names every role that runs unconfined', () => {
    const raw = def({ runtime: 'codex' }, { roles: [{ id: 'boss' }, { id: 'dev', runtime: 'codex' }, { id: 'full', policy: { access: 'full' } }, { id: 'pusher', policy: { git: 'push' } }] });
    const none = { available: false, reason: 'test' };
    const ids = unconfinedRoles(raw, { sdkSandbox: { available: true }, mask: none }).map((r) => r.id);
    expect(ids).toEqual(['dev', 'full', 'pusher']);
    expect(unconfinedRoles(raw, { sdkSandbox: { available: true }, mask: { available: true } }).map((r) => r.id)).toEqual(['full']);
    expect(describeOrgAuthority(def({ policy: { access: 'full' } })).join('\n')).toMatch(/can read the operator key and sign anything/);
  });

  it('keeps the signed projection and diffs a change against it', () => {
    const root = scratch('osr-diff-');
    signOrgDef(root, 'o', def({ policy: { git: 'read' } }));
    const before = lastSignedProjection(root, 'o');
    expect(before).toEqual(JSON.parse(JSON.stringify(orgSignatureInput(def({ policy: { git: 'read' } })))));
    const after = JSON.parse(JSON.stringify(orgSignatureInput(def({ policy: { git: 'push' } }))));
    expect(projectionDiff(before, after)).toEqual(['  ~ roles[dev].policy.git: "read" → "push"']);
  });
});

describe('6. prototype keys', () => {
  it('a __proto__ / constructor / prototype key anywhere is refused, signed or not', () => {
    const root = scratch('osr-proto-');
    signOrgDef(root, 'o', def());
    const raw = JSON.parse(
      '{"name":"o","goal":"g","roles":[{"id":"boss"},{"id":"dev","policy":{"__proto__":{"access":"full"}}}]}',
    );
    const check = verifyOrgDef(root, 'o', raw);
    expect(check).toMatchObject({ ok: false, reason: 'forbidden-key' });
    expect(!check.ok && check.message).toMatch(/roles\[1\]\.policy\.__proto__/);
    expect(() => signOrgDef(root, 'o', raw)).toThrow(/forbidden key/);
    // The projection keeps such a key rather than letting a prototype swallow it.
    expect(computeOrgDefHash(raw)).not.toBe(computeOrgDefHash(def()));
  });
});

describe('7. org test-loop', () => {
  it('writes and signs its fixtures in a throwaway root, never in the project, and leaves no signature behind', async () => {
    const project = scratch('osr-tl-');
    const report = await runTestLoop(project, 1);
    expect(report.failed).toBe(0);
    expect(existsSync(join(project, '.monomind'))).toBe(false);
    const sigs = join(operatorDir, 'org-signatures');
    expect(existsSync(sigs) ? readdirSync(sigs) : []).toEqual([]);
  }, 60_000);
});
