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
import { z } from 'zod';
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

/** What the model actually sees of a tool: name, description, input schema. */
function renderTools(opts: SessionOpts): string {
  return JSON.stringify(
    buildOrgTools(opts).map((t) => ({
      name: t.name,
      description: t.description,
      schema: z.toJSONSchema(z.object(t.schema as z.ZodRawShape)),
    })),
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
    role,
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
  it('buildRolePrompt output is byte-identical to pre-D7', () => {
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

  it('the org tool list — names, order, descriptions, schemas — is byte-identical to pre-D7', () => {
    // Tool gating keys off which callbacks are wired, not the role, so the
    // boss and a worker render the same list here.
    expect(sha(renderTools(allToolOpts(boss)))).toBe(TOOLS_SHA);
    expect(sha(renderTools(allToolOpts(dev)))).toBe(TOOLS_SHA);
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
const TOOLS_SHA = 'fa7aa5c81b4d59951b463e5abe90344dd6dc6bafaeb0517d1018961269977353';
