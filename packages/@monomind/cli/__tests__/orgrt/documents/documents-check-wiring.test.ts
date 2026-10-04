// P3.11: how org_doc_check reaches a session. buildOrgTools adds it with the other document tools only when the
// session's documents host can check (some contract declares checks); the sections-on list WITH the check tool is
// pinned by its own sha. The four-tool sha (documents-wiring.test.ts) and the sections-off list stay as they were.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ClaudeAgentRunner } from '../../../src/orgrt/agent-runner.js';
import type { OrgBus } from '../../../src/orgrt/bus.js';
import type { DocumentToolHost } from '../../../src/orgrt/documents/runtime.js';
import type { Mailbox } from '../../../src/orgrt/mailbox.js';
import { buildOrgTools } from '../../../src/orgrt/org-tools.js';
import type { PolicyEngine } from '../../../src/orgrt/policy.js';
import type { SessionOpts } from '../../../src/orgrt/session-types.js';
import type { OrgDef, OrgRole } from '../../../src/orgrt/types.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

const def = {
  name: 'acme',
  goal: 'ship the widget',
  roles: [
    { id: 'boss', title: 'Boss', type: 'coordinator', responsibilities: ['plan'] },
    { id: 'dev', title: 'Developer', type: 'specialist', reports_to: 'boss', responsibilities: ['write code', 'write tests'] },
  ],
  run_config: {},
} as unknown as OrgDef;
const dev = def.roles[1] as OrgRole;

const four = {
  role: 'dev',
  list: () => ({ ok: true }),
  read: () => ({ ok: true }),
  publish: () => ({ ok: true }),
  decide: () => ({ ok: true }),
} as unknown as DocumentToolHost;
const five = { ...four, check: () => ({ ok: true }) } as unknown as DocumentToolHost;

const opts = (documents?: DocumentToolHost): SessionOpts =>
  ({
    org: 'acme',
    role: dev,
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
    ...(documents ? { documents } : {}),
  }) as unknown as SessionOpts;

async function renderTools(o: SessionOpts): Promise<{ name: string; description: string; schema: unknown }[]> {
  let server: any;
  const fakeQuery = ({ options }: any) =>
    (async function* () {
      server = options.mcpServers.org;
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  const run = new ClaudeAgentRunner(fakeQuery as any).run({
    tools: buildOrgTools(o),
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
  return tools.map((t: any) => ({ name: t.name, description: t.description, schema: t.inputSchema }));
}

// Captured when P3.11 landed (c6703659...), re-pinned by P3.12: the sections-on list with the check tool. The
// text changed on purpose: the descriptions of the five org_doc_* tools and the sentence appended to org_send
// when a session has a documents host. Change it only for an intentional change to those tools.
const SECTIONS_ON_CHECK_TOOLS_SHA = '469ba7477d3d41c66bad94fad04462bfb3dc956880c3041fe161a2c9f3d1c9cc';
// The same four-tool list as SECTIONS_ON_TOOLS_SHA in documents-wiring.test.ts (P3.6; re-pinned by P3.12).
const FOUR_TOOLS_SHA = '9354d469266c9616f8fb5db06cf26bbf4a4d086705a3d0222c499a7e4a612302';

describe('org_doc_check registration', () => {
  it('a host that cannot check gives the four tools exactly as before (the P3.6 list, as re-pinned by P3.12)', async () => {
    expect(sha(JSON.stringify(await renderTools(opts(four))))).toBe(FOUR_TOOLS_SHA);
  });

  it('a host that can check adds org_doc_check last, after the four, leaving every other tool byte-identical', async () => {
    const off = await renderTools(opts());
    const a = await renderTools(opts(four));
    const b = await renderTools(opts(five));
    expect(b.slice(0, a.length)).toEqual(a);
    expect(b.map((t) => t.name).slice(off.length)).toEqual([
      'org_doc_list',
      'org_doc_read',
      'org_doc_publish',
      'org_doc_decide',
      'org_doc_check',
    ]);
    expect(b).toHaveLength(a.length + 1);
  });

  it('is strict like every other tool', () => {
    const t = buildOrgTools(opts(five)).find((x) => x.name === 'org_doc_check');
    expect(t?.strict).toBeDefined();
  });

  it('sections off (no documents host): no org_doc_* tool at all', async () => {
    expect((await renderTools(opts())).filter((t) => t.name.startsWith('org_doc'))).toEqual([]);
  });

  it('SECTIONS_ON_CHECK_TOOLS_SHA pins the whole list with the check tool (names, order, descriptions, schemas)', async () => {
    expect(sha(JSON.stringify(await renderTools(opts(five))))).toBe(SECTIONS_ON_CHECK_TOOLS_SHA);
  });
});
