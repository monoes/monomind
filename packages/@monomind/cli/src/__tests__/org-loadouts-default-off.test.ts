// #594: SDK 0.3.289 restores existing Zod limits and field descriptions omitted
// by 0.3.226: brief/context max4000, arrays min1, safe integer evidence exits,
// recheck bounds and org_review.base help. Only tool hashes change; prompts stay frozen.
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

// Captured against 8546057f7 (pre-D7). Recaptured (with SESSION_PROMPT_SHA)
// when every role prompt gained the private-TMPDIR line (#480). Recaptured
// again when every role prompt gained the verify-your-deliverable paragraph
// (and the lead's reassign-and-verify line): one cache miss per org on upgrade.
const COORDINATOR_PROMPT_SHA = '2dca5a246daf468b94661266050615aeff68656e6520c8f965ed002b993b60bd';
const WORKER_PROMPT_SHA = '69aaf97fabf2bd5cb8f45c989e6bf6c249e733fb860286bb8c923a44320d2159';
// Recaptured when role guidance stopped being keyed off ui.icon: the fixture's
// dev role no longer carries archetype text, so its prompt has none.
const SESSION_PROMPT_SHA = '0c97dc446650c37c3a943c7de1a0411f4dc13172d6d372769f10e9358553c567';
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
// Recaptured when org_task_done and org_complete said that a completion after a
// failed write whose file is not on disk is refused (write-ledger.ts).
const TOOLS_SHA = '8939953914849c7a5a10cba1db401b2b36dd9a1a46167e62630ce00a4b2022b0';
