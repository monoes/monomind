// packages/@monomind/cli/__tests__/orgrt/sandbox-stubs-sdk.test.ts
/**
 * The sandbox stub race, against the real bundled Claude Code CLI and
 * bubblewrap. Opt-in: runs only with MONOMIND_SANDBOX_E2E=1, and only where
 * the sandbox can run — it times two live processes against each other, so it
 * stays out of every verify on a machine that happens to have bwrap
 * (`MONOMIND_SANDBOX_E2E=1 npx vitest run __tests__/orgrt/sandbox-stubs-sdk`
 * after an SDK upgrade). Two CLI processes stand
 * in for two roles sharing a cwd and a HOME; each talks to a scripted local
 * Messages API, so no model is involved. Role A runs a slow Bash command, role
 * B a quick one while A's is still running.
 *
 * Without the runtime's stubs, B finds the mount-point stub A's bwrap made,
 * binds it onto itself as an existing file, and A's cleanup then deletes it:
 * had B's bwrap started a moment later, it would have died with "Can't find
 * source path". With them, neither process creates or deletes anything, and
 * the only /dev/null binds left are the ones sandbox-stubs.ts leaves out on
 * purpose — so this also fails when an SDK upgrade adds a path.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';
import { buildClaudeRestrictions, sandboxAvailability } from '../../src/orgrt/role-sandbox.js';
import { SandboxStubs, sandboxStubPaths } from '../../src/orgrt/sandbox-stubs.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sse = (events: Array<Record<string, unknown>>) =>
  events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

/** One streamed assistant message: a Bash call, or a closing text. */
function reply(step: number, command?: string): string {
  const usage = { input_tokens: 1, output_tokens: 1 };
  const block = command
    ? { type: 'tool_use', id: `toolu_${step}`, name: 'Bash', input: {} }
    : { type: 'text', text: '' };
  const delta = command
    ? { type: 'input_json_delta', partial_json: JSON.stringify({ command }) }
    : { type: 'text_delta', text: 'done' };
  return sse([
    {
      type: 'message_start',
      message: {
        id: `msg_${step}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage,
      },
    },
    { type: 'content_block_start', index: 0, content_block: block },
    { type: 'content_block_delta', index: 0, delta },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: command ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage,
    },
    { type: 'message_stop' },
  ]);
}

/** A Messages API that plays one Bash call, then ends the turn. */
function scriptedApi(command: string): Promise<Server> {
  let step = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!req.url?.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: 1 }));
        return;
      }
      const main = /"name":"Bash"/.test(body);
      const i = main ? step++ : -1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(reply(i, main && i === 0 ? command : undefined));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/** An org root with a role's repo in it and a HOME, shaped like a real run's
 *  (the CLI's own dirs exist). The sandbox's temp dir is the test's own, so no
 *  stub lands in the shared $TMPDIR. */
function layout() {
  const base = mkdtempSync(join(tmpdir(), 'stub-race-'));
  dirs.push(base);
  const orgRoot = join(base, 'org');
  const cwd = join(orgRoot, 'wt');
  const home = join(base, 'home');
  const tmp = join(base, 'tmp');
  mkdirSync(tmp);
  spawnSync('git', ['init', '-q', cwd]);
  for (const d of ['projects', 'shell-snapshots', 'session-env', 'plugins', 'backups'])
    mkdirSync(join(home, '.claude', d), { recursive: true });
  // Written by any earlier CLI run. Absent, it is stubbed too, and a CLI
  // starting while another's stub is there dies on the empty file ("Claude
  // configuration file … is corrupted").
  writeFileSync(join(home, '.claude', '.config.json'), '{}');
  const guard = prepareGitGuard({
    level: 'commit',
    stateDir: join(base, 'guard'),
    excludeSandboxPlaceholders: true,
    protectedGitDirs: [gitCommonDir(cwd) as string],
  });
  const { sandbox } = buildClaudeRestrictions(
    guard as NonNullable<typeof guard>,
    undefined,
    { cwd, orgRoot, home, tmp },
    true,
  );
  const writableRoots = (sandbox as { filesystem: { allowWrite: string[] } }).filesystem
    .allowWrite;
  return { base, orgRoot, cwd, home, tmp, sandbox, writableRoots };
}

/** One role process running `command` in the sandbox; resolves to its output. */
async function role(l: ReturnType<typeof layout>, command: string): Promise<string> {
  const server = await scriptedApi(command);
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: l.home,
    TMPDIR: l.tmp,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    // Not a credential: the scripted API accepts anything.
    ANTHROPIC_API_KEY: ['test', 'stubs'].join('-'),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDECODE: undefined,
    CLAUDE_CONFIG_DIR: undefined,
  };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const out: string[] = [];
  try {
    for await (const m of query({
      prompt: 'go',
      options: {
        cwd: l.cwd,
        env,
        settingSources: [],
        maxTurns: 3,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        sandbox: l.sandbox as never,
      },
    })) {
      if (m.type !== 'user' || !Array.isArray(m.message.content)) continue;
      for (const b of m.message.content)
        if (b.type === 'tool_result')
          out.push(typeof b.content === 'string' ? b.content : JSON.stringify(b.content));
    }
  } finally {
    server.close();
  }
  return out.join('\n');
}

async function until(cond: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** mountinfo lines for the test's tree: "<source root> <mount point>". */
const MOUNTS = (base: string) => `awk '{print $4, $5}' /proc/self/mountinfo | grep -F '${base}/'`;

describe.skipIf(
  process.env.MONOMIND_SANDBOX_E2E !== '1' ||
    process.platform !== 'linux' ||
    !sandboxAvailability().available,
)(
  'sandbox mount-point stubs shared by concurrent role processes',
  () => {
    it('without runtime stubs: B binds the stub A made, and A deletes it (the race)', async () => {
      const l = layout();
      const local = join(l.home, '.claude', 'local');
      const a = role(l, 'sleep 8');
      await until(() => existsSync(local));
      const b = await role(l, MOUNTS(l.base));
      // B mounted A's stub as a real file: its own path is the bind source.
      expect(b).toContain(`/@${local} ${local}`);
      await a;
      // ...and A's cleanup took that source away.
      expect(existsSync(local)).toBe(false);
    }, 60_000);

    it('with runtime stubs: nothing is created or deleted, every bind source stays', async () => {
      const l = layout();
      const stubs = new SandboxStubs(null);
      const paths = sandboxStubPaths({
        cwd: l.cwd,
        home: l.home,
        writableRoots: l.writableRoots,
        env: {},
      });
      // The org root above the role's repo is writable, so it gets stubs too.
      expect(paths).toContain(join(l.orgRoot, '.claude', 'settings.local.json'));
      const before = new Set(paths.filter((p) => existsSync(p)));
      const created = stubs.hold('org:run', paths);
      expect(created.sort()).toEqual(paths.filter((p) => !before.has(p)).sort());
      const inode = new Map(created.map((p) => [p, lstatSync(p).ino]));
      const a = role(l, 'sleep 6');
      // A's sandbox is up once the one stub the runtime leaves to it appears.
      await until(() => existsSync(join(l.cwd, '.git', 'config.lock')));
      const b = await role(l, MOUNTS(l.base));
      await a;
      for (const p of created) expect(lstatSync(p).ino, p).toBe(inode.get(p));
      const nullBinds = b
        .split('\n')
        .filter((line) => line.startsWith('/null '))
        .map((line) => line.slice('/null '.length))
        .sort();
      const expected = [
        // Left out on purpose (sandbox-stubs.ts). While A's command runs,
        // B finds A's stubs there and binds them onto themselves instead.
        join(l.cwd, '.git', 'config.lock'),
        join(l.home, '.claude', '.credentials.json'),
        // Masked, not stubbed: /dev/null goes over the existing file.
        join(l.home, '.claude', 'ide'),
      ];
      expect(nullBinds.filter((p) => !expected.includes(p))).toEqual([]);
      // The CLI keeps its own staging dir in the cwd's .claude/, so that
      // directory is no longer empty and stays; everything else goes.
      const dotClaude = join(l.cwd, '.claude');
      expect(stubs.release('org:run').sort()).toEqual(created.filter((p) => p !== dotClaude).sort());
      for (const p of created) expect(existsSync(p), p).toBe(p === dotClaude);
    }, 60_000);

    it('denyWrite ["."] without held stubs: the #323 fallback, a new file lands in the cwd', async () => {
      const l = layout();
      const cwd = l.orgRoot;
      spawnSync('git', ['init', '-q', cwd]);
      const guard = prepareGitGuard({
        level: 'read',
        stateDir: join(l.base, 'guard-qa'),
        excludeSandboxPlaceholders: true,
        protectedGitDirs: [gitCommonDir(cwd) as string],
      });
      const { sandbox } = buildClaudeRestrictions(
        guard as NonNullable<typeof guard>,
        { denyWrite: ['.'] },
        { cwd, orgRoot: l.orgRoot, home: l.home, tmp: l.tmp },
        true,
      );
      expect((sandbox as { filesystem: { denyWrite: string[] } }).filesystem.denyWrite).not.toContain(cwd);
      const out = await role({ ...l, cwd, sandbox }, 'touch qaSample.js; echo "touch=$?"');
      expect(out).toContain('touch=0');
      expect(existsSync(join(cwd, 'qaSample.js'))).toBe(true);
    }, 60_000);

    // A QA role told not to write its checkout (policy.sandbox.denyWrite
    // ["."]): with the stubs held before the restrictions are built, its cwd
    // goes to the SDK as a plain deny, and bwrap has nothing to create in it.
    for (const { name, nested, level } of [
      { name: 'the org root is the cwd', nested: false, level: 'read' as const },
      { name: 'the org root is the cwd, git commit level', nested: false, level: 'commit' as const },
      { name: 'the cwd is a checkout inside the org root', nested: true, level: 'read' as const },
    ])
      it(`denyWrite ["."], ${name}: no new file in the cwd, reads and git still work`, async () => {
        const l = layout();
        const cwd = nested ? l.cwd : l.orgRoot;
        if (!nested) spawnSync('git', ['init', '-q', cwd]);
        writeFileSync(join(cwd, 'README.md'), 'hi\n');
        const guard = prepareGitGuard({
          level,
          stateDir: join(l.base, 'guard-qa'),
          excludeSandboxPlaceholders: true,
          protectedGitDirs: [gitCommonDir(cwd) as string],
        });
        const stubs = new SandboxStubs(null);
        try {
          const { sandbox } = buildClaudeRestrictions(
            guard as NonNullable<typeof guard>,
            { denyWrite: ['.'] },
            {
              cwd,
              orgRoot: l.orgRoot,
              home: l.home,
              tmp: l.tmp,
              holdStubs: (writableRoots) => {
                const paths = sandboxStubPaths({ cwd, home: l.home, writableRoots, env: {} });
                stubs.hold('org:run', paths);
                return stubs.missing(paths);
              },
            },
            true,
          );
          const fs = (sandbox as { filesystem: { denyWrite: string[] } }).filesystem;
          expect(fs.denyWrite).toContain(cwd);
          const out = await role(
            { ...l, cwd, sandbox },
            [
              'ls >/dev/null && cat README.md >/dev/null && git status --short >/dev/null && echo READS-OK',
              'touch newfile; echo "touch=$?"',
              `touch ${join(cwd, '.git', 'x')}; echo "git-touch=$?"`,
            ].join('; '),
          );
          expect(out).not.toMatch(/Can't create file|Can't find source path|bwrap:/);
          expect(out).toContain('READS-OK');
          expect(out).toMatch(/newfile.*Read-only file system/);
          expect(out).toContain('touch=1');
          expect(out).toContain('git-touch=1');
          expect(existsSync(join(cwd, 'newfile'))).toBe(false);
        } finally {
          stubs.releaseAll();
        }
      }, 60_000);
  },
);
