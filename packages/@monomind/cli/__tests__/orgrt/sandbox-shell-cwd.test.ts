// packages/@monomind/cli/__tests__/orgrt/sandbox-shell-cwd.test.ts
/**
 * #339, against the real bundled Claude Code CLI and bubblewrap (skipped where
 * the sandbox cannot run). The CLI talks to a scripted local Messages API, so
 * no model is involved: the "model" runs `cd pkgs/a`, then — after a settings
 * change, which makes the CLI rebuild its sandbox config — tries to write into
 * the sibling `pkgs/hooks`. The sandbox marks an existing
 * `hooks`/`config` read-only in every directory between the session cwd and
 * the shell's current one, so without CLAUDE_SANDBOX_CWD_ENV the write fails
 * with EROFS (the 2.16.3 release run's read-only `packages/@monomind/hooks`).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Query, query } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { CLAUDE_SANDBOX_CWD_ENV } from '../../src/orgrt/bash-timeout.js';
import { gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';
import { buildClaudeRestrictions, sandboxAvailability } from '../../src/orgrt/role-sandbox.js';

const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
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

/** A Messages API that plays `commands` as Bash calls, one per turn, running
 *  `beforeStep[i]` before answering turn i. Side requests get a plain text. */
function scriptedApi(commands: string[], beforeStep: Record<number, () => Promise<void>>) {
  let step = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      if (!req.url?.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
        res.writeHead(req.url?.includes('count_tokens') ? 200 : 404, {
          'content-type': 'application/json',
        });
        res.end(JSON.stringify({ input_tokens: 1 }));
        return;
      }
      const main = /"name":"Bash"/.test(body);
      const i = main ? step++ : -1;
      if (main) await beforeStep[i]?.();
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(reply(i, main ? commands[i] : undefined));
    });
  });
  return new Promise<Server>((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

async function writeIntoSiblingAfterCd(pinShell: boolean): Promise<string> {
  const root = tmp('i339-root-');
  spawnSync('git', ['init', '-q', root]);
  mkdirSync(join(root, 'pkgs', 'a'), { recursive: true });
  mkdirSync(join(root, 'pkgs', 'hooks'));
  const probe = join(root, 'pkgs', 'hooks', 'probe');
  let q: Query | undefined;
  const server = await scriptedApi(
    [`cd ${join(root, 'pkgs', 'a')}`, `touch ${probe} 2>&1 && echo WRITABLE`],
    // Any settings change makes the CLI rebuild the sandbox, from wherever
    // the shell is at that moment.
    { 1: async () => q?.applyFlagSettings({ env: { I339: '1' } }) },
  );
  const guard = prepareGitGuard({
    level: 'commit',
    stateDir: tmp('i339-guard-'),
    excludeSandboxPlaceholders: true,
    protectedGitDirs: [gitCommonDir(root) as string],
  });
  const { sandbox } = buildClaudeRestrictions(
    guard as NonNullable<typeof guard>,
    undefined,
    { cwd: root, orgRoot: root },
    true,
  );
  // The sandbox denies these under the config dir; one the CLI creates only
  // after that (a fresh dir's `projects`) breaks bwrap's /dev/null bind.
  const config = tmp('i339-config-');
  for (const d of ['projects', 'shell-snapshots', 'session-env', 'plugins', 'backups'])
    mkdirSync(join(config, d));
  const env: Record<string, string | undefined> = {
    ...process.env,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    // Not a credential: the scripted API accepts anything.
    ANTHROPIC_API_KEY: ['test', 'i339'].join('-'),
    CLAUDE_CONFIG_DIR: config,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDECODE: undefined,
    ...(pinShell ? CLAUDE_SANDBOX_CWD_ENV : { CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: undefined }),
  };
  // The API key must win over an OAuth login inherited from the environment.
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const outputs: string[] = [];
  let finish = () => {};
  const done = new Promise<void>((r) => (finish = r));
  try {
    q = query({
      prompt: (async function* () {
        yield {
          type: 'user' as const,
          message: { role: 'user' as const, content: 'go' },
          parent_tool_use_id: null,
          session_id: '',
        };
        // Streaming input (applyFlagSettings needs it); ends with the turn.
        await done;
      })(),
      options: {
        cwd: root,
        env,
        settingSources: [],
        maxTurns: 5,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        sandbox: sandbox as never,
      },
    });
    for await (const m of q) {
      if (m.type === 'result') finish();
      if (m.type !== 'user' || !Array.isArray(m.message.content)) continue;
      for (const b of m.message.content)
        if (b.type === 'tool_result') outputs.push(JSON.stringify(b.content));
    }
  } finally {
    server.close();
  }
  return outputs.join('\n');
}

describe.skipIf(process.platform !== 'linux' || !sandboxAvailability().available)(
  '#339: the sandbox after a `cd` in a sandboxed Claude role',
  () => {
    it('leaves a sibling `hooks` directory read-only when the shell keeps its directory (SDK behaviour)', async () => {
      const out = await writeIntoSiblingAfterCd(false);
      // If this starts failing after an SDK upgrade, the CLI no longer walks
      // the shell's directory and CLAUDE_SANDBOX_CWD_ENV may be unnecessary.
      expect(out).toMatch(/Read-only file system/);
    }, 60_000);

    it('keeps the whole cwd writable when the shell returns to the cwd after each command', async () => {
      const out = await writeIntoSiblingAfterCd(true);
      expect(out).toContain('WRITABLE');
      expect(out).not.toMatch(/Read-only file system/);
    }, 60_000);
  },
);
