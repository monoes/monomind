// #480: every role session gets its own TMPDIR under the base it would have
// had, so a bare `mktemp -d` never lands in a directory shared with other
// roles, and one role's cleanup can never reach another role's scratch.
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeAgentRunner } from '../../src/orgrt/agent-runner-claude.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { fileToolRoots } from '../../src/orgrt/file-roots.js';
import { prepareGitGuard } from '../../src/orgrt/git-guard.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildClaudeRestrictions } from '../../src/orgrt/role-sandbox.js';
import {
  createRoleTmpdir,
  releaseRunTmpdirs,
  removeRoleTmpdir,
  ROLE_TMPDIR_MARKER,
  roleTmpEnv,
  sweepStaleRoleTmpdirs,
} from '../../src/orgrt/role-tmpdir.js';
import { buildRolePrompt, runAgentSession, type SessionOpts } from '../../src/orgrt/session.js';
import { sessionRunArgs } from '../../src/orgrt/session-stream.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

let base: string;
let root: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'rtmp-base-'));
  root = mkdtempSync(join(tmpdir(), 'rtmp-root-'));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

const mode = (p: string) => statSync(p).mode & 0o777;
// macOS's `mktemp -d` ignores TMPDIR (it asks confstr for the per-user temp dir), so there the
// same template is spelled out under $TMPDIR; Linux keeps the bare `mktemp -d`.
const mktempCmd = process.platform === 'darwin' ? 'mktemp -d "$TMPDIR/tmp.XXXXXXXXXX"' : 'mktemp -d';
const mktempIn = (env: Record<string, string>): string =>
  execFileSync('sh', ['-c', mktempCmd], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim();

describe('createRoleTmpdir', () => {
  it('gives two roles distinct TMPDIRs directly under the base, both mode 0700', () => {
    const a = createRoleTmpdir({ org: 'rel', role: 'builder', run: 'r1', root, base })!;
    const b = createRoleTmpdir({ org: 'rel', role: 'cli-qa', run: 'r1', root, base })!;
    expect(a).not.toBe(b);
    expect(dirname(a)).toBe(base);
    expect(dirname(b)).toBe(base);
    expect(a.slice(base.length + 1)).toMatch(/^rel-builder-.{6}$/);
    expect(b.slice(base.length + 1)).toMatch(/^rel-cli-qa-.{6}$/);
    expect(mode(a)).toBe(0o700);
    expect(mode(b)).toBe(0o700);
    releaseRunTmpdirs('rel', 'r1');
  });

  it("a role's bare `mktemp -d` lands inside its own subdir, never in the shared base", () => {
    const a = createRoleTmpdir({ org: 'rel', role: 'builder', run: 'r1', root, base })!;
    const made = mktempIn(roleTmpEnv(a));
    expect(dirname(made)).toBe(a);
    expect(readdirSync(base).filter((n) => n.startsWith('tmp.'))).toEqual([]);
    releaseRunTmpdirs('rel', 'r1');
  });

  it('returns undefined (shared base kept) when the base does not exist', () => {
    expect(createRoleTmpdir({ org: 'o', role: 'r', root, base: join(base, 'missing') })).toBeUndefined();
  });
});

describe('removeRoleTmpdir', () => {
  it("role A's cleanup of its own subdir never touches role B's", () => {
    const a = createRoleTmpdir({ org: 'rel', role: 'a', run: 'r1', root, base })!;
    const b = createRoleTmpdir({ org: 'rel', role: 'b', run: 'r1', root, base })!;
    const bScratch = mktempIn(roleTmpEnv(b));
    mktempIn(roleTmpEnv(a));
    // The glob the issue describes, run by A where it now lives: its own dir.
    execFileSync('sh', ['-c', 'cd "$TMPDIR" && rm -rf tmp.*'], { env: { ...process.env, ...roleTmpEnv(a) } });
    expect(removeRoleTmpdir(a, { org: 'rel', role: 'a', base })).toBe(true);
    expect(existsSync(a)).toBe(false);
    expect(existsSync(bScratch)).toBe(true);
    releaseRunTmpdirs('rel', 'r1');
    expect(existsSync(b)).toBe(false);
  });

  it("refuses a path that is not this role's: a sibling, another role's, a symlink, or outside the base", () => {
    const b = createRoleTmpdir({ org: 'rel', role: 'b', run: 'r1', root, base })!;
    const sibling = join(base, 'tmp.sibling');
    mkdirSync(sibling);
    const link = join(base, 'rel-a-linked');
    symlinkSync(b, link);
    expect(removeRoleTmpdir(b, { org: 'rel', role: 'a', base })).toBe(false);
    expect(removeRoleTmpdir(sibling, { org: 'rel', role: 'a', base })).toBe(false);
    expect(removeRoleTmpdir(link, { org: 'rel', role: 'a', base })).toBe(false);
    expect(removeRoleTmpdir(join(b, 'x'), { org: 'rel', role: 'b', base })).toBe(false);
    expect(existsSync(b) && existsSync(sibling) && existsSync(link)).toBe(true);
    releaseRunTmpdirs('rel', 'r1');
  });
});

describe('sweepStaleRoleTmpdirs', () => {
  const plant = (name: string, owner: Record<string, unknown> | null) => {
    const dir = join(base, name);
    mkdirSync(dir);
    if (owner) writeFileSync(join(dir, ROLE_TMPDIR_MARKER), JSON.stringify(owner));
    return dir;
  };
  const DEAD = 999_999_999;
  const LIVE = 424_242;
  const isAlive = (pid: number) => pid === LIVE;

  it("removes only this org's subdirs whose owning run is gone", () => {
    const own = { org: 'rel', role: 'qa', root };
    const deadRun = plant('rel-qa-aaaaaa', { ...own, run: 'old', pid: DEAD });
    const liveRun = plant('rel-qa-bbbbbb', { ...own, run: 'other', pid: LIVE });
    const sameProcOld = plant('rel-qa-cccccc', { ...own, run: 'old', pid: process.pid });
    const sameProcNow = plant('rel-qa-dddddd', { ...own, run: 'now', pid: process.pid });
    const otherOrg = plant('rel2-qa-eeeeee', { ...own, org: 'rel2', run: 'old', pid: DEAD });
    const otherRoot = plant('rel-qa-ffffff', { ...own, root: '/elsewhere', run: 'old', pid: DEAD });
    const noMarker = plant('rel-qa-gggggg', null);
    const unrelated = plant('tmp.XXXXXXXXXX', null);
    const removed = sweepStaleRoleTmpdirs({ org: 'rel', root, run: 'now', base, isAlive });
    expect(removed.sort()).toEqual([deadRun, sameProcOld].sort());
    for (const kept of [liveRun, sameProcNow, otherOrg, otherRoot, noMarker, unrelated])
      expect(existsSync(kept)).toBe(true);
  });

  it('leaves a marker whose name does not match its recorded role', () => {
    const dir = plant('rel-builder-hhhhhh', { org: 'rel', role: 'qa', root, run: 'old', pid: DEAD });
    expect(sweepStaleRoleTmpdirs({ org: 'rel', root, run: 'now', base, isAlive })).toEqual([]);
    expect(existsSync(dir)).toBe(true);
  });
});

describe('session env', () => {
  const opts = (roleTmpdir?: string) => {
    const def = OrgDefSchema.parse({ name: 'o', roles: [{ id: 'w' }] });
    const bus = new OrgBus('o', 'r', root);
    return {
      org: 'o',
      role: def.roles[0],
      bus,
      policy: new PolicyEngine('w', { maxTokens: 1000 }, bus, root),
      mailbox: new Mailbox(),
      cwd: root,
      def,
      deliver: async () => 'ok',
      roleTmpdir,
    } as unknown as SessionOpts;
  };
  const runArgsBase = {
    runner: {} as never,
    tools: [],
    streamOpts: undefined,
    gitEnforcement: { env: {} },
    model: 'm',
    tier: undefined,
    prov: { cfg: undefined } as never,
    resume: undefined,
    authorityMask: undefined,
    abort: new AbortController(),
  };
  const args = (o: SessionOpts, gitEnv: Record<string, string> = {}) =>
    sessionRunArgs(o, {
      runner: {} as never,
      tools: [],
      streamOpts: undefined,
      gitEnforcement: { env: gitEnv },
      model: 'm',
      tier: undefined,
      prov: { cfg: undefined } as never,
      resume: undefined,
      authorityMask: undefined,
      abort: new AbortController(),
    }).env as Record<string, string>;

  it('exports the session TMPDIR as TMPDIR, TMP, TEMP and CLAUDE_CODE_TMPDIR', () => {
    const env = args(opts('/b/o-w-abc123'));
    expect([env.TMPDIR, env.TMP, env.TEMP, env.CLAUDE_CODE_TMPDIR]).toEqual(Array(4).fill('/b/o-w-abc123'));
  });

  // #503: an org started from a Claude Code session's Bash tool inherits that
  // session's CLAUDE_CODE_TMPDIR, which Claude Code reads before TMPDIR.
  it('a claude role gets the role dir in every temp var the SDK sees, over an inherited CLAUDE_CODE_TMPDIR', async () => {
    const dir = createRoleTmpdir({ org: 'o', role: 'w', run: 'rc5', root, base })!;
    const saved = process.env.CLAUDE_CODE_TMPDIR;
    process.env.CLAUDE_CODE_TMPDIR = join(base, 'claude-1000');
    try {
      let sdkEnv: Record<string, string> = {};
      const runner = new ClaudeAgentRunner(((q: { options: { env: Record<string, string> } }) => {
        sdkEnv = q.options.env;
        return (async function* () {})();
      }) as never);
      const o = opts(dir);
      for await (const _ of runner.run({ ...sessionRunArgs(o, { ...runArgsBase, runner }), prompt: (async function* () {})() }));
      for (const k of ['TMPDIR', 'TMP', 'TEMP', 'CLAUDE_CODE_TMPDIR']) expect(sdkEnv[k], k).toBe(dir);
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CODE_TMPDIR;
      else process.env.CLAUDE_CODE_TMPDIR = saved;
      releaseRunTmpdirs('o', 'rc5');
    }
  });

  it('an explicit TMPDIR from a role-specific env overlay wins over isolation', () => {
    expect(args(opts('/b/o-w-abc123'), { TMPDIR: '/explicit' }).TMPDIR).toBe('/explicit');
  });

  it('without a session TMPDIR the inherited value is left as it was', () => {
    expect(args(opts()).TMPDIR).toBe(process.env.TMPDIR);
  });

  it('the role prompt tells every role its TMPDIR is private and forbids cleanup globs on a shared parent', () => {
    const def = OrgDefSchema.parse({ name: 'o', roles: [{ id: 'w' }] });
    const prompt = buildRolePrompt(def.roles[0], def, ['w']);
    expect(prompt).toMatch(/\$TMPDIR is private/);
    expect(prompt).toMatch(/Never run a cleanup glob/);
  });
});

describe('runAgentSession', () => {
  // The session takes its base from the daemon's own TMPDIR.
  let savedTmp: string | undefined;
  beforeEach(() => {
    savedTmp = process.env.TMPDIR;
    process.env.TMPDIR = base;
  });
  afterEach(() => {
    // Assigning undefined would store the string "undefined" (CI has no TMPDIR).
    if (savedTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = savedTmp;
  });
  const run = async (role: string, extra: Partial<SessionOpts> = {}) => {
    const def = OrgDefSchema.parse({ name: 'o', roles: [{ id: role }] });
    const bus = new OrgBus('o', 'r', root);
    const mailbox = new Mailbox();
    const seen: { tmp?: string; made?: string; existed?: boolean } = {};
    const runner = {
      run: async function* (a: { env: Record<string, string>; prompt: AsyncIterable<unknown> }) {
        seen.tmp = a.env.TMPDIR;
        seen.made = mktempIn(a.env);
        seen.existed = existsSync(seen.tmp);
        for await (const _ of a.prompt) {
          yield { type: 'assistant', text: 'ok' };
          mailbox.close('done');
        }
      },
    };
    mailbox.push('go');
    await runAgentSession({
      org: 'o',
      role: def.roles[0],
      bus,
      policy: new PolicyEngine(role, { maxTokens: 100000 }, bus, root),
      mailbox,
      cwd: root,
      orgRoot: root,
      run: 'r',
      def,
      deliver: async () => 'ok',
      runner,
      ...extra,
    } as unknown as SessionOpts);
    return seen;
  };

  it("hands the runner a private TMPDIR under the base, and removes it when the role's session ends", async () => {
    const [a, b] = await Promise.all([run('alpha'), run('beta')]);
    expect(a.tmp).not.toBe(b.tmp);
    for (const s of [a, b]) {
      expect(dirname(s.tmp!)).toBe(base);
      expect(s.existed).toBe(true);
      expect(dirname(s.made!)).toBe(s.tmp);
      expect(existsSync(s.tmp!)).toBe(false);
    }
    expect(readdirSync(base).filter((n) => n.startsWith('o-') || n.startsWith('tmp.'))).toEqual([]);
  });

  it("task scope: each task session gets its own TMPDIR, removed once its task is closed", async () => {
    const def = OrgDefSchema.parse({ name: 'o', roles: [{ id: 'w', reports_to: 'boss' }, { id: 'boss' }] });
    const role = { ...def.roles[0], session_scope: 'task' as const };
    const bus = new OrgBus('o', 'r', root);
    const mailbox = new Mailbox();
    const closed = new Set<string>();
    const tmps: string[] = [];
    let firstGoneBySecond: boolean | undefined;
    const runner = {
      run: async function* (a: { env: Record<string, string>; prompt: AsyncIterable<{ message: { content: string } }> }) {
        tmps.push(a.env.TMPDIR);
        if (tmps.length === 2) firstGoneBySecond = !existsSync(tmps[0]);
        for await (const m of a.prompt) {
          const id = /\[task:(\w+)\]/.exec(String(m.message.content))?.[1];
          if (id) closed.add(id);
          yield { type: 'assistant', text: 'ok' };
          yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
          if (tmps.length === 2) mailbox.close('done');
        }
      },
    };
    mailbox.push('[task:t1] first');
    mailbox.push('[task:t2] second');
    await runAgentSession({
      org: 'o',
      role,
      bus,
      policy: new PolicyEngine('w', { maxTokens: 100000 }, bus, root),
      mailbox,
      cwd: root,
      orgRoot: root,
      run: 'r',
      def,
      deliver: async () => 'ok',
      runner,
      isTaskClosed: (id: string) => closed.has(id),
    } as unknown as SessionOpts);
    expect(tmps).toHaveLength(2);
    expect(tmps[0]).not.toBe(tmps[1]);
    expect(firstGoneBySecond).toBe(true);
    expect(existsSync(tmps[1])).toBe(false);
  });
});

describe('sandbox write roots', () => {
  it("the SDK sandbox's allowWrite and the file-tool roots still cover the role's TMPDIR (it sits under the base)", () => {
    const dir = createRoleTmpdir({ org: 'o', role: 'w', run: 'rs', root, base })!;
    const guard = prepareGitGuard({ level: 'read', stateDir: join(root, 'guard'), protectedGitDirs: [] })!;
    const fs = (buildClaudeRestrictions(guard, undefined, { cwd: root, orgRoot: root, home: root, tmp: base }, true)
      .sandbox as { filesystem: { allowWrite: string[] } }).filesystem;
    const under = (roots: string[]) => roots.some((r) => dir === r || dir.startsWith(`${r}/`));
    expect(under(fs.allowWrite)).toBe(true);
    expect(under(fileToolRoots({ cwd: root, orgRoot: root, env: { TMPDIR: base } }))).toBe(true);
    releaseRunTmpdirs('o', 'rs');
  });
});

// Keep the spawn import honest: a real child process sees the computed env.
describe('child process', () => {
  it('a spawned shell reports the role TMPDIR', async () => {
    const dir = createRoleTmpdir({ org: 'o', role: 'sh', run: 'rc', root, base })!;
    const out = await new Promise<string>((resolve) => {
      const c = spawn('sh', ['-c', 'printf %s "$TMPDIR"'], { env: { ...process.env, ...roleTmpEnv(dir) } });
      let s = '';
      c.stdout.on('data', (d) => (s += d));
      c.on('close', () => resolve(s));
    });
    expect(out).toBe(dir);
    releaseRunTmpdirs('o', 'rc');
  });
});
