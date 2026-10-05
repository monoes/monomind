// #594: SDK 0.3.289 restores existing Zod limits and field descriptions omitted
// by 0.3.226: brief/context max4000, arrays min1, safe integer evidence exits,
// recheck bounds and org_review.base help. Only tool hashes change; prompts stay frozen.
// packages/@monomind/cli/__tests__/orgrt/frozen-sha-tripwire.test.ts
//
// Org sections P3.0 (spec 13.1.3): the tripwire. The four SHAs below are a
// SECOND, independent copy of the ones in src/__tests__/org-loadouts-default-off.test.ts,
// recomputed here with this file's own rendering code (it imports nothing from
// the golden support files, on purpose). Recapturing one of them to make a
// failure go away therefore takes two edits in two files, and a reviewer sees
// both. The values are frozen for the whole of Phase 3: a piece that fails
// here is wrong, not the test. Only a piece that intentionally changes prompts
// (P3.12) may change them, in both files in one commit, saying why.
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeAgentRunner } from '../../src/orgrt/agent-runner.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildOrgTools, buildRolePrompt, runAgentSession, type SessionOpts } from '../../src/orgrt/session.js';
import type { OrgDef, OrgRole } from '../../src/orgrt/types.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const TMP = process.env.TMPDIR ?? '/var/tmp';

const def = {
  name: 'acme',
  goal: 'ship the widget',
  roles: [
    { id: 'boss', title: 'Boss', type: 'coordinator', responsibilities: ['plan'] },
    { id: 'dev', title: 'Developer', type: 'specialist', reports_to: 'boss', responsibilities: ['write code', 'write tests'] },
  ],
  run_config: {},
} as unknown as OrgDef;
const boss = def.roles[0] as OrgRole;
const dev = def.roles[1] as OrgRole;

const allToolOpts = (role: OrgRole): SessionOpts =>
  ({
    org: 'acme',
    role,
    bus: {},
    policy: {},
    mailbox: {},
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
  }) as unknown as SessionOpts;

async function toolsSha(opts: SessionOpts): Promise<string> {
  let server: any;
  const fakeQuery = ({ options }: any) =>
    (async function* () {
      server = options.mcpServers.org;
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  for await (const _ of new ClaudeAgentRunner(fakeQuery as any).run({
    tools: buildOrgTools(opts),
    prompt: (async function* () {})(),
    systemPrompt: '',
    cwd: '/work',
  } as any)) {
    // drain
  }
  const { tools } = await server.instance.server._requestHandlers.get('tools/list')(
    { method: 'tools/list', params: {} },
    { signal: new AbortController().signal },
  );
  return sha(JSON.stringify(tools.map((t: any) => ({ name: t.name, description: t.description, schema: t.inputSchema }))));
}

async function sessionPromptSha(role: OrgRole, message: string): Promise<string> {
  const bus = new OrgBus('acme', 'r', mkdtempSync(join(TMP, 'tripwire-')));
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
    role: { ...role, policy: { ...role.policy, sandbox: { mode: 'off' } } },
    bus,
    policy: new PolicyEngine(role.id, {}, bus, '/work'),
    mailbox,
    cwd: '/work',
    def,
    deliver: async () => 'ok',
    queryFn: fakeQuery as any,
  });
  return sha(systemPrompt);
}

// Frozen copies; the originals are in src/__tests__/org-loadouts-default-off.test.ts.
const FROZEN = {
  COORDINATOR_PROMPT_SHA: '2dca5a246daf468b94661266050615aeff68656e6520c8f965ed002b993b60bd',
  WORKER_PROMPT_SHA: '69aaf97fabf2bd5cb8f45c989e6bf6c249e733fb860286bb8c923a44320d2159',
  SESSION_PROMPT_SHA: '0c97dc446650c37c3a943c7de1a0411f4dc13172d6d372769f10e9358553c567',
  TOOLS_SHA: '8939953914849c7a5a10cba1db401b2b36dd9a1a46167e62630ce00a4b2022b0',
};

describe('sections-off golden: frozen SHA tripwire', () => {
  it('pins the four SHAs of org-loadouts-default-off.test.ts a second time', async () => {
    const coordinator = buildRolePrompt(boss, def, ['boss', 'dev'], ['Widget', 'Gizmo'], undefined, ['- "hook" (endpoint)']);
    const worker = buildRolePrompt(dev, def, ['boss', 'dev'], undefined, 'GUIDE');
    expect({
      COORDINATOR_PROMPT_SHA: sha(coordinator),
      WORKER_PROMPT_SHA: sha(worker),
      SESSION_PROMPT_SHA: await sessionPromptSha(dev, 'task one'),
      TOOLS_SHA: await toolsSha(allToolOpts(boss)),
    }).toEqual(FROZEN);
    expect(await toolsSha(allToolOpts(dev))).toBe(FROZEN.TOOLS_SHA);
  });
});
