/**
 * ADR-O001 D7 — "everything defaults OFF".
 *
 * An org that declares no `loadouts` catalog must see a BYTE-IDENTICAL system
 * prompt and tool list to the runtime before D7 existed. Both render into the
 * cached prefix (tools at position 0, then the system prompt), so a single
 * changed byte for every org would invalidate every cached prompt on upgrade.
 *
 * The fingerprints below were captured by running this exact file against the
 * pre-D7 code (commit 8546057f7). Do not "update the snapshot" to make a
 * failure go away: a mismatch here means an org that did not opt in now pays
 * a cache miss.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeAgentRunner } from '../orgrt/agent-runner.js';
import { OrgBus } from '../orgrt/bus.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { PolicyEngine } from '../orgrt/policy.js';
import {
  buildOrgTools,
  buildRolePrompt,
  runAgentSession,
  type SessionOpts,
} from '../orgrt/session.js';
import type { OrgDef, OrgRole } from '../orgrt/types.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

const def = {
  name: 'acme',
  goal: 'ship the widget',
  roles: [
    { id: 'boss', title: 'Boss', type: 'coordinator', responsibilities: ['plan'] },
    {
      id: 'dev',
      title: 'Developer',
      type: 'specialist',
      reports_to: 'boss',
      responsibilities: ['write code', 'write tests'],
    },
  ],
  run_config: {},
} as unknown as OrgDef;
const boss = def.roles[0] as OrgRole;
const dev = def.roles[1] as OrgRole;

/** Every task/DAG callback wired, so every gated tool is present. */
function allToolOpts(role: OrgRole): SessionOpts {
  return {
    org: 'acme',
    role,
    bus: {} as OrgBus,
    policy: {} as PolicyEngine,
    mailbox: {} as Mailbox,
    cwd: '/work',
    def,
    deliver: async () => 'ok',
    askHuman: async () => 'ok',
    onComplete: () => null,
    onGate: async () => 'ok',
    recall: async () => 'ok',
    remember: async () => 'ok',
    searchKnowledge: async () => 'ok',
    createTask: () => 'ok',
    completeTask: () => 'ok',
    listTasks: () => 'ok',
    splitTask: () => 'ok',
    mergeTask: () => 'ok',
    cancelTask: () => 'ok',
    blockTask: () => 'ok',
    planGraph: () => 'ok',
  } as unknown as SessionOpts;
}

/** What the model actually sees of a tool: name, description, input schema —
 *  the org MCP server's own tools/list, as ClaudeAgentRunner registers it. A
 *  zod rendering of the shape would miss what the runner changes (strict
 *  objects) and what the SDK's converter drops (length/number bounds). */
async function renderTools(opts: SessionOpts): Promise<string> {
  let server: any;
  const fakeQuery = ({ options }: any) =>
    (async function* () {
      server = options.mcpServers.org;
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  const run = new ClaudeAgentRunner(fakeQuery as any).run({
    tools: buildOrgTools(opts),
    prompt: (async function* () {})(),
    systemPrompt: '',
    cwd: '/work',
  } as any);
  for await (const _ of run) {
    // drain
  }
  const { tools } = await server.instance.server._requestHandlers.get('tools/list')(
    { method: 'tools/list', params: {} },
    { signal: new AbortController().signal },
  );
  return JSON.stringify(
    tools.map((t: any) => ({ name: t.name, description: t.description, schema: t.inputSchema })),
  );
}

async function capturedSystemPrompt(role: OrgRole, message: string): Promise<string> {
  const bus = new OrgBus('acme', 'r', mkdtempSync(join(tmpdir(), 'loadout-off-')));
  const mailbox = new Mailbox();
  mailbox.push(message);
  mailbox.close();
  let systemPrompt = '';
  const fakeQuery = ({ prompt, options }: any) =>
    (async function* () {
      systemPrompt = options.systemPrompt;
      for await (const _ of prompt) break;
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  await runAgentSession({
    org: 'acme',
    // #339: where the OS sandbox runs, a role's prompt also says that `cd`
    // lasts for one Bash command; keep it off so the prompt is host-independent.
    role: { ...role, policy: { ...role.policy, sandbox: { mode: 'off' } } },
    bus,
    policy: new PolicyEngine(role.id, {}, bus, '/work'),
    mailbox,
    cwd: '/work',
    def,
    deliver: async () => 'ok',
    queryFn: fakeQuery as any,
  });
  return systemPrompt;
}

describe('ADR-O001 D7: an org with no loadout catalog is unchanged', () => {
  it('buildRolePrompt output is byte-identical to pre-D7', async () => {
    const coordinator = buildRolePrompt(
      boss,
      def,
      ['boss', 'dev'],
      ['Widget', 'Gizmo'],
      undefined,
      ['- "hook" (endpoint)'],
    );
    const worker = buildRolePrompt(dev, def, ['boss', 'dev'], undefined, 'GUIDE');
    expect(sha(coordinator)).toBe(COORDINATOR_PROMPT_SHA);
    expect(sha(worker)).toBe(WORKER_PROMPT_SHA);
  });

  it('the session system prompt (as sent to the runner) is byte-identical to pre-D7', async () => {
    expect(sha(await capturedSystemPrompt(dev, 'task one'))).toBe(SESSION_PROMPT_SHA);
  });

  it('the org tool list — names, order, descriptions, schemas — is byte-identical to pre-D7', async () => {
    // Tool gating keys off which callbacks are wired, not the role, so the
    // boss and a worker render the same list here.
    expect(sha(await renderTools(allToolOpts(boss)))).toBe(TOOLS_SHA);
    expect(sha(await renderTools(allToolOpts(dev)))).toBe(TOOLS_SHA);
  });
});

// Captured against 8546057f7 (pre-D7).
const COORDINATOR_PROMPT_SHA = 'aac1470d23beab53bc0e30aa5a8af493bd06bc9e78254cdc52e6ca4157fc4ed0';
const WORKER_PROMPT_SHA = 'dff3a95ffbbb6d7238d544976ed42b593ff2738653456a4ce3f5058643a4e0dc';
// Recaptured when role guidance stopped being keyed off ui.icon: the fixture's
// dev role no longer carries archetype text, so its prompt has none.
const SESSION_PROMPT_SHA = '64fc1c260b590557c7321104a37b2457eaf507507c91ca92c59e9c63ac6d9fc1';
// Recaptured when org_task_done's evidence gained an optional `worktree`
// (evidence may be pinned to any local worktree or branch head).
// Recaptured when each evidence check gained an optional `expectExit` (a
// check whose correct outcome is a non-zero exit). The schema is shared by
// every org; the description for orgs without completion_evidence is unchanged.
// Recaptured again when `expectExit` gained its guardrail: checks take an
// `expectReason` (required alongside a non-zero `expectExit`) and the
// evidence description says `expectExit` is refused on an aggregate command.
// Recaptured when org_task and org_plan_graph nodes gained an optional `brief`
// (the task's instructions, sent with its dispatch) — a shared schema, so one
// cache miss per org on upgrade in exchange for briefs that arrive in time.
// Recaptured when org_tasks gained an optional `taskId` filter.
// Recaptured when org_task_block gained an optional `recheckAfterMinutes` and
// its description said plainly that nothing external wakes a blocked task (#329).
// Recaptured when org_task_cancel's description said that the assignee is told
// to stop and a task-scoped session's process is ended.
// Recaptured when renderTools switched to the org MCP server's own tools/list
// (the schema actually sent, which the old zod rendering did not match) and
// built-in org tools became strict (fix/org-tool-strict-args): every schema
// now carries additionalProperties: false. The old rendering produced the
// same hash before and after that change; this one does not.
const TOOLS_SHA = '3118b939ad8130ffe0356267a9e3c2aa8f9833571c75f1acea039e9cc6395a9f';
