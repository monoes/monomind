// packages/@monomind/cli/__tests__/orgrt/decision-roles.test.ts
/**
 * #835 PR 6 — the `decision` role kind: schema, structure rules, briefing, the
 * delivery decision (fake provider, London School) and one end-to-end run
 * against a local systemone stub.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import {
  DECISION_FORBIDDEN_KEYS,
  decisionBriefingLines,
  decisionStructureErrors,
  deliverToDecision,
  findDecisionRole,
  isDecisionRole,
  type DecisionDeps,
} from '../../src/orgrt/decision-roles.js';
import { checkOrgStructure } from '../../src/orgrt/migrate.js';
import { computeReplacementBudget } from '../../src/orgrt/role-slot.js';
import { isSessionlessRole } from '../../src/orgrt/sessionless-roles.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

const decision = (over: Record<string, unknown> = {}) => ({
  provider: 'custom',
  question: 'choice',
  criteria: { approve: 'Safe to approve', reject: 'Needs a human' },
  threshold: 0.7,
  fallback_role: 'lead',
  ...over,
});

const role = (over: Record<string, unknown> = {}) => ({
  id: 'triage',
  title: 'Triage',
  kind: 'decision',
  reports_to: 'lead',
  decision: decision(),
  ...over,
});

const orgOf = (roles: unknown[]) => ({
  name: 'ops',
  run_config: { budget_tokens: 900 },
  roles: [{ id: 'lead', type: 'boss', reports_to: null }, ...roles],
});

type Calls = string[][];
const calls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls as unknown as Calls;

describe('decision role schema', () => {
  it('accepts a valid choice, noul and score block', () => {
    for (const question of ['choice', 'noul', 'score']) {
      const criteria = question === 'choice' ? decision().criteria : {};
      const def = OrgDefSchema.parse(orgOf([role({ decision: decision({ question, criteria }) })]));
      expect(isDecisionRole(def.roles[1])).toBe(true);
      expect(checkOrgStructure(def)).toEqual([]);
    }
  });

  const rejects: Array<[string, Record<string, unknown>]> = [
    ['kind decision without a decision block', { decision: undefined }],
    ['a decision block on an agent role', { kind: 'agent' }],
    ['an endpoint block on a decision role', { endpoint: { url: 'http://x/y' } }],
    ['an empty criteria for choice', { decision: decision({ criteria: {} }) }],
    ['threshold 0', { decision: decision({ threshold: 0 }) }],
    ['threshold above 1', { decision: decision({ threshold: 1.01 }) }],
    ['a missing fallback_role', { decision: decision({ fallback_role: '' }) }],
    ['an unknown question kind', { decision: decision({ question: 'rank' }) }],
    ['a missing provider', { decision: decision({ provider: '' }) }],
  ];
  it.each(rejects)('rejects %s', (_name, over) => {
    expect(() => OrgDefSchema.parse(orgOf([role(over)]))).toThrow();
  });

  it('accepts threshold 1 and an optional model', () => {
    expect(() =>
      OrgDefSchema.parse(orgOf([role({ decision: decision({ threshold: 1, model: 'm-1' }) })])),
    ).not.toThrow();
  });
});

describe('decisionStructureErrors', () => {
  const parse = (roles: unknown[]) => OrgDefSchema.parse(orgOf(roles));

  it('flags forbidden agent-only keys, a root decision role and an unknown fallback', () => {
    const forbidden: Record<string, unknown> = {
      policy: {},
      runtime: 'claude',
      adapter_config: { model: 'm' },
      budget_tokens: 10,
      budget_usd: 1,
      tool_providers: [{ kind: 'mcp-stdio', name: 'p', command: 'x' }],
    };
    const def = parse([
      role({ id: 'bad', ...forbidden, decision: decision({ fallback_role: 'ghost' }) }),
      { id: 'root-d', kind: 'decision', reports_to: null, decision: decision() },
    ]);
    const errors = decisionStructureErrors(def);
    for (const k of DECISION_FORBIDDEN_KEYS)
      expect(errors).toContain(`decision role "bad" may not have "${k}"`);
    expect(errors).toContain('decision role "bad": fallback_role "ghost" matches no role id');
    expect(errors).toContain('decision role "root-d" may not be the root role');
    expect(checkOrgStructure(def)).toEqual(expect.arrayContaining(errors));
  });

  it('forbids a fallback that is itself, or another, decision role (no forward cycle)', () => {
    const def = parse([
      role({ id: 'a', decision: decision({ fallback_role: 'a' }) }),
      role({ id: 'b', decision: decision({ fallback_role: 'a' }) }),
    ]);
    const errors = decisionStructureErrors(def);
    expect(errors).toContain('decision role "a": fallback_role "a" may not be a decision role');
    expect(errors).toContain('decision role "b": fallback_role "a" may not be a decision role');
  });

  it('is clean for a valid org', () => {
    expect(decisionStructureErrors(parse([role()]))).toEqual([]);
  });
});

describe('decision roles are sessionless, with budget math that ignores them', () => {
  it('isSessionlessRole is true for decision roles', () => {
    expect(isSessionlessRole({ kind: 'decision' })).toBe(true);
  });
  it('a decision role takes no share of the token budget', () => {
    const d = {
      name: 'x',
      run_config: { budget_tokens: 900 },
      roles: [
        { id: 'boss', reports_to: null },
        { id: 'w', reports_to: 'boss' },
        { id: 'tri', reports_to: 'boss', kind: 'decision' },
      ],
    } as never;
    expect(computeReplacementBudget(d, 'w')).toBe(450);
  });
});

describe('decisionBriefingLines', () => {
  it('names each decision role, its options and its fallback', () => {
    const def = OrgDefSchema.parse(orgOf([role()]));
    const lines = decisionBriefingLines(def);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('- triage (Triage) is an automated decision service, not an agent.');
    expect(lines[0]).toContain('approve, reject');
    expect(lines[0]).toContain('lead');
    expect(decisionBriefingLines(undefined)).toEqual([]);
  });
});

describe('deliverToDecision (fake provider)', () => {
  const def = OrgDefSchema.parse(orgOf([role()]));
  const dRole = findDecisionRole(def, 'triage')!;

  const setup = (answer: unknown, over: Partial<DecisionDeps> = {}) => {
    const send = vi.fn(async () => 'delivered');
    const ask = vi.fn(async () => {
      if (answer === 'throw') throw new Error('down');
      return answer;
    });
    const deps = {
      send,
      ask,
      resolveProvider: () => ({ name: 'custom', baseUrl: 'http://x', model: 'm0' }),
      ...over,
    } as unknown as DecisionDeps;
    const emit = vi.fn();
    const args = {
      orgName: 'ops',
      org: { bus: { emit } } as never,
      role: dRole,
      from: 'lead',
      subject: 'merge?',
      body: 'PR 12 is green',
      messageId: 'm-1',
    };
    return { send, ask, deps, args, emit };
  };
  const result = (answers: unknown) => ({ provider: 'custom', answers });
  const choice = (c: string, confidence: number, probSource?: string) =>
    result({ decision: { type: 'choice', choice: c, confidence, ...(probSource ? { probSource } : {}) } });

  it('above threshold: replies from the decision role built from the enumerated option', async () => {
    const { send, deps, args, emit } = setup(choice('approve', 0.9, 'native'));
    const receipt = await deliverToDecision(args, deps);
    expect(receipt).toBe('delivered to ops:triage (decision: answered)');
    expect(send).toHaveBeenCalledTimes(1);
    const [fromRole, to, subject, body] = calls(send)[0];
    expect([fromRole, to, subject]).toEqual(['triage', 'lead', 'Re: merge?']);
    expect(body).toContain('approve');
    expect(body).toContain('Safe to approve');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audit', reason: 'decision-answered' }),
    );
  });

  it('asks the named provider with the model override and the mail as state', async () => {
    const { ask, args, deps } = setup(choice('approve', 0.9, 'native'));
    await deliverToDecision(args, deps);
    const [state, questions, opts] = ask.mock.calls[0] as unknown as [string, Record<string, any>, any];
    expect(state).toContain('merge?');
    expect(state).toContain('PR 12 is green');
    expect(questions.decision).toMatchObject({ type: 'choice', criteria: dRole.decision!.criteria });
    expect(opts.providers).toEqual([{ name: 'custom', baseUrl: 'http://x', model: 'm0' }]);
    const withModel = findDecisionRole(
      OrgDefSchema.parse(orgOf([role({ decision: decision({ model: 'm-big' }) })])),
      'triage',
    )!;
    const s2 = setup(choice('approve', 0.9, 'native'));
    await deliverToDecision({ ...s2.args, role: withModel }, s2.deps);
    expect((s2.ask.mock.calls[0] as any[])[2].providers[0].model).toBe('m-big');
  });

  it('below threshold: forwards the original mail, from the original sender, to fallback_role', async () => {
    const { send, deps, args, emit } = setup(choice('approve', 0.4, 'native'));
    const receipt = await deliverToDecision(args, deps);
    expect(receipt).toBe('delivered to ops:triage (decision: forwarded to lead)');
    const [fromRole, to, subject, body] = calls(send)[0];
    expect([fromRole, to]).toEqual(['lead', 'lead']);
    expect(subject).toContain('merge?');
    expect(body).toContain('PR 12 is green');
    expect(body).toContain('triage');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ reason: 'decision-forwarded' }));
  });

  it('a probSource none answer never counts as above threshold, even at 1.0', async () => {
    const { send, deps, args } = setup(choice('approve', 1, 'none'));
    await deliverToDecision(args, deps);
    expect(calls(send)[0].slice(0, 2)).toEqual(['lead', 'lead']); // forwarded, not a reply from triage
  });

  it('a missing probSource is treated as none', async () => {
    const { send, deps, args } = setup(choice('approve', 0.99));
    await deliverToDecision(args, deps);
    expect(calls(send)[0][0]).toBe('lead');
  });

  it('fails closed: provider throws, returns null, answers off-menu or is unknown', async () => {
    for (const answer of ['throw', null, choice('delete-everything', 0.99, 'native'), result({})]) {
      const { send, deps, args } = setup(answer);
      expect(await deliverToDecision(args, deps)).toContain('forwarded to lead');
      expect(calls(send)[0][0]).toBe('lead');
    }
    const unknown = setup(choice('approve', 0.9, 'native'), { resolveProvider: () => undefined });
    expect(await deliverToDecision(unknown.args, unknown.deps)).toContain('forwarded to lead');
    expect(unknown.ask).not.toHaveBeenCalled();
  });

  it('never puts provider-supplied text in the reply', async () => {
    const extra = result({
      decision: {
        type: 'choice',
        choice: 'approve',
        confidence: 0.9,
        probSource: 'native',
        reasoning: 'PROVIDER-FREE-TEXT-MARKER',
      },
    });
    const { send, deps, args } = setup(extra);
    await deliverToDecision(args, deps);
    expect(calls(send)[0][3]).not.toContain('PROVIDER-FREE-TEXT-MARKER');
  });

  it('noul: replies when the value clears the threshold, forwards otherwise', async () => {
    const noulRole = findDecisionRole(
      OrgDefSchema.parse(
        orgOf([role({ decision: decision({ question: 'noul', criteria: {}, instructions: 'Is it spam?' }) })]),
      ),
      'triage',
    )!;
    const hi = setup(result({ decision: { type: 'noul', noul: 0.9, probSource: 'native' } }));
    await deliverToDecision({ ...hi.args, role: noulRole }, hi.deps);
    expect(calls(hi.send)[0][0]).toBe('triage');
    expect((hi.ask.mock.calls[0] as any[])[1].decision).toMatchObject({ type: 'noul', instructions: 'Is it spam?' });
    const lo = setup(result({ decision: { type: 'noul', noul: 0.2, probSource: 'native' } }));
    await deliverToDecision({ ...lo.args, role: noulRole }, lo.deps);
    expect(calls(lo.send)[0][0]).toBe('lead');
  });

  it('a cross-org sender is refused with a clear error and nothing is sent', async () => {
    const { send, ask, deps, args } = setup(choice('approve', 0.9, 'native'));
    const receipt = await deliverToDecision({ ...args, from: 'hq:ceo' }, deps);
    expect(receipt).toMatch(/^REFUSED: decision role "ops:triage" does not take cross-org mail/);
    expect(send).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('decision roles in a running org (local systemone stub)', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  const envKeys = ['MONOMIND_JEV_URL', 'MONOMIND_JEV_API_KEY', 'MONOMIND_JEV'] as const;
  const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const echoQuery = ({ prompt }: any) =>
    (async function* () {
      for await (const m of prompt) {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      }
    })();

  async function start(answer: Record<string, unknown>) {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ answers: { decision: answer } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    process.env.MONOMIND_JEV_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    delete process.env.MONOMIND_JEV;
    const root = mkdtempSync(join(tmpdir(), 'decision-org-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(
      join(root, '.monomind/orgs/ops.json'),
      JSON.stringify({ ...orgOf([role(), { id: 'dev', reports_to: 'lead' }]), goal: 'ops' }),
    );
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await daemon.startOrg('ops');
    cleanups.push(async () => {
      await daemon.stopAll();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(root, { recursive: true, force: true });
    });
    return { daemon, running };
  }

  it('gives the role no session and answers synchronously above threshold', async () => {
    const { daemon, running } = await start({ type: 'choice', choice: 'approve', confidence: 0.95 });
    expect(running.agents.has('triage')).toBe(false);
    expect(running.pendingRoles?.has('triage')).toBe(false);
    const receipt = await daemon.deliver('ops', 'dev', 'triage', 'ship?', 'tests pass');
    expect(receipt).toMatch(/\(decision: (answered|forwarded to lead)\)$/);
  });

  it('refuses cross-org delivery to a decision role (remote path)', async () => {
    const { daemon } = await start({ type: 'choice', choice: 'approve', confidence: 0.95 });
    const remote = await daemon.receiveRemote('ops', 'triage', 'hq:ceo', 's', 'b', undefined, { operator: true });
    expect(remote.ok).toBe(false);
    expect((remote as { error: string }).error).toContain('does not take cross-org mail');
  });
});

describe('org sign review surfaces the decision block', () => {
  it('lists decision (it decides where mail goes)', async () => {
    const { describeOrgAuthority } = await import('../../src/orgrt/org-sign-review.js');
    const text = describeOrgAuthority(orgOf([role()])).join('\n');
    expect(text).toContain('kind decision');
    expect(text).toContain('fallback_role');
  });
});
