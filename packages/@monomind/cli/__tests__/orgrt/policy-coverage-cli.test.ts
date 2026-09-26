// packages/@monomind/cli/__tests__/orgrt/policy-coverage-cli.test.ts
/**
 * Every tool call of a Claude role is decided by the org PolicyEngine — run
 * against the real bundled Claude Code CLI, which talks to a scripted local
 * Messages API (no model involved), through ClaudeAgentRunner and
 * gatedCanUseTool exactly as session.ts wires them.
 *
 * The CLI calls canUseTool only for calls its own rules would ask about;
 * read-only Bash (`cat`, `git status`) and Read inside the cwd run without it.
 * Before policy-hook.ts those calls skipped the PolicyEngine: no `tool`
 * event, and denyTools / allowTools / fileRead did not apply to them (the
 * 2.16.7 release run: 959 Bash results, 655 Bash decisions).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeAgentRunner } from '../../src/orgrt/agent-runner.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildClaudeRestrictions, sandboxAvailability } from '../../src/orgrt/role-sandbox.js';
import { gatedCanUseTool } from '../../src/orgrt/session.js';
import type { BusEvent, RolePolicy } from '../../src/orgrt/types.js';

const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Call {
  name: string;
  input: Record<string, unknown>;
}

const sse = (events: Array<Record<string, unknown>>) =>
  events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

/** One streamed assistant message: a tool call, or a closing text. */
function reply(step: number, call?: Call): string {
  const usage = { input_tokens: 1, output_tokens: 1 };
  const block = call
    ? { type: 'tool_use', id: `toolu_${step}`, name: call.name, input: {} }
    : { type: 'text', text: '' };
  const delta = call
    ? { type: 'input_json_delta', partial_json: JSON.stringify(call.input) }
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
      delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage,
    },
    { type: 'message_stop' },
  ]);
}

/** A Messages API that plays `calls` in order, one per model turn (the turn
 *  number is the count of assistant messages so far); a subagent whose prompt
 *  holds SUBAGENT plays `sub` instead. Side requests without tools get a
 *  plain text. */
function scriptedApi(calls: Call[], sub: Call[] = []) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!req.url?.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: 1 }));
        return;
      }
      const j = JSON.parse(body) as { messages?: Array<{ role: string }>; tools?: unknown[] };
      const turn = (j.messages ?? []).filter((m) => m.role === 'assistant').length;
      const inSub = JSON.stringify(j.messages?.[0] ?? '').includes('SUBAGENT');
      const call = j.tools?.length ? (inSub ? sub : calls)[turn] : undefined;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(reply(inSub ? 100 + turn : turn, call));
    });
  });
  return new Promise<Server>((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

interface Outcome {
  events: BusEvent[];
  results: Map<string, { tool?: string; text: string; is_error?: boolean }>;
  root: string;
}

async function runRole(
  policy: RolePolicy,
  script: (root: string) => Call[],
  sandboxed: boolean,
  sub: Call[] = [],
): Promise<Outcome> {
  const root = tmp('polcov-root-');
  spawnSync('git', ['init', '-q', root]);
  spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  writeFileSync(join(root, 'f.txt'), 'hello\n');
  const bus = new OrgBus('polcov', 'run-1', tmp('polcov-bus-'));
  const events: BusEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const engine = new PolicyEngine('dev', policy, bus, root);
  engine.setOsSandboxed(sandboxed);
  const guard = prepareGitGuard({
    level: policy.git ?? 'read',
    stateDir: tmp('polcov-guard-'),
    excludeSandboxPlaceholders: sandboxed,
    protectedGitDirs: [gitCommonDir(root) as string],
  });
  const restrictions = buildClaudeRestrictions(
    guard as NonNullable<typeof guard>,
    undefined,
    { cwd: root, orgRoot: root },
    sandboxed,
  );
  // The sandbox denies these under the config dir; one the CLI creates only
  // after that breaks bwrap's /dev/null bind (sandbox-shell-cwd.test.ts).
  const config = tmp('polcov-config-');
  for (const d of ['projects', 'shell-snapshots', 'session-env', 'plugins', 'backups'])
    mkdirSync(join(config, d));
  const calls = script(root);
  const server = await scriptedApi(calls, sub);
  // An inherited OAuth login would win over the scripted API's key.
  const unset = ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDECODE'];
  const saved = unset.map((k) => [k, process.env[k]] as const);
  for (const k of unset) delete process.env[k];
  const results: Outcome['results'] = new Map();
  let finish = () => {};
  const done = new Promise<void>((r) => (finish = r));
  try {
    const stream = new ClaudeAgentRunner().run({
      tools: [],
      prompt: (async function* () {
        yield {
          type: 'user' as const,
          message: { role: 'user' as const, content: 'go' },
          parent_tool_use_id: null,
          session_id: '',
        };
        await done;
      })(),
      systemPrompt: 'test',
      cwd: root,
      env: {
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        // Not a credential: the scripted API accepts anything.
        ANTHROPIC_API_KEY: ['test', 'polcov'].join('-'),
        CLAUDE_CONFIG_DIR: config,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        ...(guard?.env ?? {}),
      },
      maxTurns: calls.length + sub.length + 2,
      claudeRestrictions: restrictions,
      canUseTool: gatedCanUseTool(engine, undefined, 'dev'),
    });
    for await (const m of stream) {
      if (m.type === 'result') finish();
      if (m.type === 'tool_result' && m.tool_use_id)
        results.set(m.tool_use_id, { tool: m.tool, text: m.text ?? '', is_error: m.is_error });
    }
  } finally {
    finish();
    server.close();
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
  }
  return { events, results, root };
}

const decisions = (o: Outcome) =>
  new Map(
    o.events
      .filter((e) => e.type === 'tool')
      .map((e) => [String((e.data as { call_id?: string })?.call_id), e.decision]),
  );

const headCount = (root: string) =>
  spawnSync('git', ['-C', root, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

const scenarios: Array<[string, boolean, boolean]> = [
  ['without the OS sandbox', false, process.platform === 'linux' || process.platform === 'darwin'],
  ['inside the OS sandbox', true, sandboxAvailability().available],
];

for (const [label, sandboxed, runnable] of scenarios) {
  describe.skipIf(!runnable)(`every Claude tool call is decided by the PolicyEngine (${label})`, () => {
    it('decides and audits auto-allowed calls, and denies what the policy denies', async () => {
      const o = await runRole(
        { git: 'read', fileRead: ['docs/**'] },
        (root) => [
          { name: 'Bash', input: { command: 'git status --short' } },
          { name: 'Read', input: { file_path: join(root, 'f.txt') } },
          { name: 'Bash', input: { command: 'cat f.txt' } },
          { name: 'Bash', input: { command: 'git add f.txt && git commit -q -m x' } },
        ],
        sandboxed,
      );
      const decided = decisions(o);
      // One `tool` decision event for every call that produced a result.
      expect([...o.results.keys()].sort()).toEqual(['toolu_0', 'toolu_1', 'toolu_2', 'toolu_3']);
      for (const id of o.results.keys()) expect(decided.has(id), id).toBe(true);
      // ...and only one: a call canUseTool also asked about is not re-decided.
      expect(o.events.filter((e) => e.type === 'tool')).toHaveLength(4);
      expect(decided.get('toolu_0')).toBe('allow');
      // Read inside the cwd is auto-allowed by the SDK, but outside fileRead.
      expect(decided.get('toolu_1')).toBe('deny');
      expect(o.results.get('toolu_1')?.text).toContain('[org-policy]');
      expect(o.results.get('toolu_1')?.text).not.toContain('hello');
      expect(decided.get('toolu_2')).toBe('allow');
      // git:'read' — the commit is denied by policy (and audited), not run.
      expect(decided.get('toolu_3')).toBe('deny');
      expect(o.results.get('toolu_3')?.text).toContain('[org-policy]');
      expect(headCount(o.root)).toBe('1');
    }, 90_000);

    it('applies denyTools to a read-only Bash command', async () => {
      const o = await runRole(
        { git: 'read', denyTools: ['Bash'] },
        () => [{ name: 'Bash', input: { command: 'cat f.txt' } }],
        sandboxed,
      );
      expect(decisions(o).get('toolu_0')).toBe('deny');
      expect(o.results.get('toolu_0')?.text).toContain('[org-policy]');
      expect(o.results.get('toolu_0')?.text).not.toContain('hello');
    }, 90_000);

    it("decides a subagent's calls too", async () => {
      const o = await runRole(
        { git: 'read', denyTools: ['Bash'] },
        () => [
          {
            name: 'Agent',
            input: {
              description: 'probe',
              prompt: 'SUBAGENT: read f.txt',
              subagent_type: 'general-purpose',
              run_in_background: false,
            },
          },
        ],
        sandboxed,
        [{ name: 'Bash', input: { command: 'cat f.txt' } }],
      );
      const decided = decisions(o);
      expect(decided.get('toolu_0')).toBe('allow');
      expect(decided.get('toolu_100')).toBe('deny');
      expect(o.results.get('toolu_100')?.text).toContain('[org-policy]');
      expect(o.results.get('toolu_100')?.text).not.toContain('hello');
    }, 90_000);
  });
}
