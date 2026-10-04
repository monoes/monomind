// P3.6: how the document tools reach a session. buildOrgTools adds org_doc_* only when SessionOpts carries a
// documents host, after every existing tool; the sections-ON tool list is pinned by its own sha (the
// sections-OFF list stays pinned by org-loadouts-default-off.test.ts and the P3.0 goldens, untouched).
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeAgentRunner } from '../../../src/orgrt/agent-runner.js';
import type { OrgBus } from '../../../src/orgrt/bus.js';
import type { DocumentToolHost } from '../../../src/orgrt/documents/runtime.js';
import type { Mailbox } from '../../../src/orgrt/mailbox.js';
import { buildOrgTools } from '../../../src/orgrt/org-tools.js';
import { spillToolResult } from '../../../src/orgrt/tool-spill.js';
import type { PolicyEngine } from '../../../src/orgrt/policy.js';
import type { SessionOpts } from '../../../src/orgrt/session-types.js';
import type { OrgDef, OrgRole } from '../../../src/orgrt/types.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

// The same fixture org as src/__tests__/org-loadouts-default-off.test.ts, so the sections-off list below is that file's list.
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

const host = {
  role: 'dev',
  list: () => ({ ok: true }),
  read: () => ({ ok: true }),
  publish: () => ({ ok: true }),
  decide: () => ({ ok: true }),
} as unknown as DocumentToolHost;

function allToolOpts(role: OrgRole, documents?: DocumentToolHost): SessionOpts {
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
    ...(documents ? { documents } : {}),
  } as unknown as SessionOpts;
}

async function renderTools(opts: SessionOpts): Promise<{ name: string; description: string; schema: unknown }[]> {
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
  return tools.map((t: any) => ({ name: t.name, description: t.description, schema: t.inputSchema }));
}

// Captured when P3.6 landed. The sections-ON tool list: the sections-off list plus the four org_doc_* tools.
// Change it only for an intentional change to those four tools (P3.12 owns their description text).
const SECTIONS_ON_TOOLS_SHA = '3f54c580d6b89e004a7a2bd28c09f34fa408110bb873b1bbe409fa3d3e8d643a';
const DOC_TOOLS = ['org_doc_list', 'org_doc_read', 'org_doc_publish', 'org_doc_decide'];

describe('org_doc_* registration', () => {
  it('without a documents host there is no org_doc_* tool', () => {
    expect(buildOrgTools(allToolOpts(dev)).map((t) => t.name).filter((n) => n.startsWith('org_doc'))).toEqual([]);
  });

  it('with a host the four tools come last, after every existing tool, in a fixed order', () => {
    const off = buildOrgTools(allToolOpts(dev)).map((t) => t.name);
    const on = buildOrgTools(allToolOpts(dev, host)).map((t) => t.name);
    expect(on.slice(0, off.length)).toEqual(off);
    expect(on.slice(off.length)).toEqual(DOC_TOOLS);
    expect(off.at(-1)).toBe('ask_human');
  });

  it('every tool, org_doc_* included, is strict (unknown arguments rejected)', () => {
    for (const t of buildOrgTools(allToolOpts(dev, host))) expect(t.strict, t.name).toBeDefined();
  });

  it('the existing tools render byte-for-byte the same with and without the host', async () => {
    const off = await renderTools(allToolOpts(dev));
    const on = await renderTools(allToolOpts(dev, host));
    expect(on.slice(0, off.length)).toEqual(off);
    expect(on).toHaveLength(off.length + 4);
  });

  it('SECTIONS_ON_TOOLS_SHA pins the whole sections-on list (names, order, descriptions, schemas)', async () => {
    const on = await renderTools(allToolOpts(dev, host));
    expect(sha(JSON.stringify(on))).toBe(SECTIONS_ON_TOOLS_SHA);
  });

  it('is identical for every role (the list varies with the session wiring, never with the role)', async () => {
    const boss = def.roles[0] as OrgRole;
    expect(await renderTools(allToolOpts(boss, host))).toEqual(await renderTools(allToolOpts(dev, host)));
  });
});

describe('tool-result spill', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'doc-spill-'));
  const big = { text: 'x'.repeat(7000) };

  it('never spills an org_doc_* result (already bounded and paged by the tool)', () => {
    for (const name of ['org_doc_read', 'mcp__org__org_doc_read', 'mcp__org__org_doc_list'])
      expect(spillToolResult(dir, name, 't1', big), name).toBeUndefined();
  });

  it('still spills any other tool result of that size', () => {
    expect(spillToolResult(dir, 'Bash', 't2', big)).toBeDefined();
    expect(spillToolResult(dir, 'mcp__org__org_send', 't3', big)).toBeDefined();
    expect(spillToolResult(dir, 'mcp__org__my_org_doc_reader', 't4', big)).toBeDefined();
  });
});
