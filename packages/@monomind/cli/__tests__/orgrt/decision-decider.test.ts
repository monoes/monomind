// packages/@monomind/cli/__tests__/orgrt/decision-decider.test.ts
/**
 * #835 PR 7 — a decision role is consultable: `autonomy.decider = {kind:'role', role:'<id>'}`
 * routes approvals and gates the autonomy hands to a decider through the role. Confident
 * answers resolve as `decision:<role>`; everything else (below threshold, no probability,
 * provider failure, bad config) falls to the human path and never approves.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { approvalOwnership, awaitApproval } from '../../src/orgrt/approval-decider.js';
import { resolverLabel } from '../../src/orgrt/approval-waiters.js';
import { setApproval } from '../../src/orgrt/approvals.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { createGate, listGates } from '../../src/orgrt/decision-gates.js';
import { deciderRoleErrors } from '../../src/orgrt/decision-decider.js';
import type { DecisionDeps } from '../../src/orgrt/decision-roles.js';
import { checkOrgStructure } from '../../src/orgrt/migrate.js';
import { type OrgRole, OrgDefSchema, ORG_DIR } from '../../src/orgrt/types.js';

const decisionBlock = (over: Record<string, unknown> = {}) => ({
  provider: 'custom',
  question: 'choice',
  criteria: { approve: 'Safe to approve', deny: 'Clearly unsafe' },
  threshold: 0.7,
  fallback_role: 'lead',
  ...over,
});
const triage = (over: Record<string, unknown> = {}) => ({
  id: 'triage',
  title: 'Triage',
  kind: 'decision',
  reports_to: 'lead',
  decision: decisionBlock(),
  ...over,
});
const orgOf = (roles: unknown[], autonomy?: unknown) => ({
  name: 'o',
  run_config: { budget_tokens: 900 },
  roles: [{ id: 'lead', type: 'boss', reports_to: null }, ...roles],
  ...(autonomy ? { autonomy } : {}),
});
const roleDecider = (extra: object = {}) => ({
  level: 'full',
  decider: { kind: 'role', role: 'triage' },
  ...extra,
});
const parsedRoles = (roles: unknown[]): OrgRole[] => OrgDefSchema.parse(orgOf(roles)).roles;

const answer = (choice: string, confidence: number, probSource?: string) => ({
  answers: { decision: { type: 'choice', choice, confidence, ...(probSource ? { probSource } : {}) } },
});

describe('autonomy.decider kind "role": ownership', () => {
  const roles = parsedRoles([triage()]);
  it('a valid role decider owns decider-routed requests (waits the consult bound)', () => {
    const o = approvalOwnership(roleDecider(), 'org_complete', Date.now(), roles);
    expect(o).toMatchObject({ owner: 'decider', decider: 'decision role triage', role: 'triage' });
  });
  it('rule-routed requests stay with the autonomy rules, not the role', () => {
    const o = approvalOwnership(roleDecider(), 'Bash', Date.now(), roles);
    expect(o).toMatchObject({ owner: 'decider', decider: 'rule (routine at full)' });
    expect((o as { role?: string }).role).toBeUndefined();
  });
  const human: Array<[string, unknown, OrgRole[] | undefined]> = [
    ['unknown role', roleDecider({ decider: { kind: 'role', role: 'ghost' } }), roles],
    ['missing role field', roleDecider({ decider: { kind: 'role' } }), roles],
    ['non-decision role', roleDecider({ decider: { kind: 'role', role: 'lead' } }), roles],
    ['no roles given', roleDecider(), undefined],
    [
      'choice without an approve option',
      roleDecider(),
      parsedRoles([triage({ decision: decisionBlock({ criteria: { yes: 'y' } }) })]),
    ],
  ];
  it.each(human)('%s is human-owned (fail closed)', (_n, autonomy, rs) => {
    expect(approvalOwnership(autonomy, 'org_complete', Date.now(), rs)).toEqual({ owner: 'human' });
  });
  it('resolverLabel knows decision:<role> and does not call it a human', () => {
    expect(resolverLabel('decision:triage')).toContain('decision:triage');
    expect(resolverLabel('decision:triage')).not.toContain('human');
  });
});

describe('org validate: autonomy.decider role references', () => {
  const def = (roles: unknown[], autonomy: unknown) => OrgDefSchema.parse(orgOf(roles, autonomy));
  it('accepts a valid reference', () => {
    expect(checkOrgStructure(def([triage()], roleDecider()))).toEqual([]);
  });
  it('rejects unknown, non-decision, missing and approve-less references', () => {
    expect(deciderRoleErrors(def([triage()], roleDecider({ decider: { kind: 'role', role: 'ghost' } }))).join()).toMatch(/ghost.*no role/);
    expect(deciderRoleErrors(def([triage()], roleDecider({ decider: { kind: 'role', role: 'lead' } }))).join()).toMatch(/not a decision role/);
    expect(deciderRoleErrors(def([triage()], roleDecider({ decider: { kind: 'role' } }))).join()).toMatch(/needs a role/);
    const noApprove = def([triage({ decision: decisionBlock({ criteria: { yes: 'y' } }) })], roleDecider());
    expect(checkOrgStructure(noApprove).join()).toMatch(/"approve"/);
  });
  it('ignores other decider kinds', () => {
    expect(deciderRoleErrors(def([triage()], { level: 'full', decider: { kind: 'model' } }))).toEqual([]);
  });
});

let fileTick = 0;
function fakeDaemon(autonomy: unknown = roleDecider(), roles: unknown[] = [triage()]) {
  const root = mkdtempSync(join(tmpdir(), 'decider-role-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ORG_DIR), { recursive: true });
  const path = join(root, ORG_DIR, 'o.json');
  writeFileSync(path, JSON.stringify(orgOf(roles, autonomy)));
  const t = new Date(Date.now() + ++fileTick * 1000);
  utimesSync(path, t, t);
  const mailbox: string[] = [];
  const events: Array<Record<string, unknown>> = [];
  const daemon = {
    root,
    approvals: new Map(),
    approvalLocks: new Map(),
    gatesLocks: new Map(),
    recordDecision: () => {},
    orgs: new Map([
      [
        'o',
        {
          def: { roles: parsedRoles(roles) },
          agents: new Map([['dev', { mailbox: { isClosed: false, push: (m: string) => mailbox.push(m) } }]]),
          bus: { emit: (e: Record<string, unknown>) => events.push(e) },
        },
      ],
    ]),
  } as unknown as OrgDaemon;
  return { daemon, mailbox, events };
}
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const deps = (out: unknown): { deps: DecisionDeps; ask: ReturnType<typeof vi.fn> } => {
  const ask = vi.fn(async () => {
    if (out === 'throw') throw new Error('provider down');
    return out as never;
  });
  return { ask, deps: { ask, resolveProvider: () => ({ name: 'custom', baseUrl: 'http://x' }) } as DecisionDeps };
};

describe('awaitApproval through a decision role', () => {
  it('approve above threshold: approved inline, resolvedBy decision:triage, role not told to repeat', async () => {
    const { daemon, mailbox } = fakeDaemon();
    const { deps: d, ask } = deps(answer('approve', 0.95, 'native'));
    const v = await awaitApproval(daemon, 'o', 'dev', 'org_complete', { why: 'done' }, d);
    expect(v).toMatchObject({ approved: true, owner: 'decider', resolvedBy: 'decision:triage' });
    expect((ask.mock.calls[0] as unknown as [string])[0]).toContain('org_complete');
    expect(mailbox).toEqual([]);
  });

  it('deny above threshold denies', async () => {
    const { daemon } = fakeDaemon();
    const v = await awaitApproval(daemon, 'o', 'dev', 'org_complete', {}, deps(answer('deny', 0.9, 'native')).deps);
    expect(v).toMatchObject({ approved: false, resolvedBy: 'decision:triage' });
  });

  const fallThrough: Array<[string, unknown]> = [
    ['below threshold', answer('approve', 0.4, 'native')],
    ['no probability source', answer('approve', 1, 'none')],
    ['missing probSource', answer('approve', 0.99)],
    ['an option off the menu', answer('delete-everything', 0.99, 'native')],
    ['an option that is neither approve nor deny', answer('maybe', 0.99, 'native')],
    ['provider failure', 'throw'],
    ['no answer', null],
  ];
  it.each(fallThrough)('%s: stays pending for a human, never approved', async (_n, out) => {
    const { daemon, mailbox } = fakeDaemon(roleDecider(), [
      triage({ decision: decisionBlock({ criteria: { approve: 'a', deny: 'd', maybe: 'm' } }) }),
    ]);
    const v = await awaitApproval(daemon, 'o', 'dev', 'org_complete', {}, deps(out).deps);
    expect(v.approved).toBeNull();
    expect(v.owner).toBe('human');
    expect(v.resolvedBy).toBeUndefined();
    // The request is still queued; a person resolving it later is told, as for any human request.
    await setApproval(daemon, 'o', 'dev', 'org_complete', true, { resolvedBy: 'alice' });
    expect(mailbox.join()).toContain('APPROVED');
  });

  it('noul role: a score at or above threshold approves, below falls through', async () => {
    const roles = [triage({ decision: decisionBlock({ question: 'noul', criteria: {} }) })];
    const hi = fakeDaemon(roleDecider(), roles);
    const yes = { answers: { decision: { type: 'noul', noul: 0.9, probSource: 'native' } } };
    expect((await awaitApproval(hi.daemon, 'o', 'dev', 'org_complete', {}, deps(yes).deps)).approved).toBe(true);
    const lo = fakeDaemon(roleDecider(), roles);
    const no = { answers: { decision: { type: 'noul', noul: 0.2, probSource: 'native' } } };
    expect((await awaitApproval(lo.daemon, 'o', 'dev', 'org_complete', {}, deps(no).deps)).approved).toBeNull();
  });

  it('an invalid role reference never reaches the provider', async () => {
    const { daemon } = fakeDaemon(roleDecider({ decider: { kind: 'role', role: 'ghost' } }));
    const { deps: d, ask } = deps(answer('approve', 1, 'native'));
    const v = await awaitApproval(daemon, 'o', 'dev', 'org_complete', {}, d);
    expect(v).toMatchObject({ approved: null, owner: 'human' });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('createGate through a decision role', () => {
  it('a confident approve resolves the gate as decision:triage', async () => {
    const { daemon, events } = fakeDaemon();
    const text = await createGate(daemon, 'o', 'dev', 'ship', 'go/no-go', deps(answer('approve', 0.9, 'native')).deps);
    const [g] = listGates(daemon, 'o');
    expect(g).toMatchObject({ status: 'approved', resolvedBy: 'decision:triage' });
    expect(text).toContain('decision role triage');
    expect(events.some((e) => e.reason === 'decision-resolved')).toBe(true);
  });

  it('below threshold or provider failure leaves the gate pending for a human', async () => {
    for (const out of [answer('approve', 0.3, 'native'), 'throw']) {
      const { daemon } = fakeDaemon();
      const text = await createGate(daemon, 'o', 'dev', 'ship', 'go/no-go', deps(out).deps);
      expect(listGates(daemon, 'o')[0].status).toBe('pending');
      expect(text).toContain('a human must approve');
    }
  });

  it('manual level or another decider kind never consults the role', async () => {
    for (const autonomy of [roleDecider({ level: 'manual' }), roleDecider({ level: 'mid' }), { level: 'full', decider: { kind: 'model' } }]) {
      const { daemon } = fakeDaemon(autonomy);
      const { deps: d, ask } = deps(answer('approve', 1, 'native'));
      await createGate(daemon, 'o', 'dev', 'ship', 'x', d);
      expect(ask).not.toHaveBeenCalled();
      expect(listGates(daemon, 'o')[0].status).toBe('pending');
    }
  });
});

describe('whole path: real daemon, local systemone stub', () => {
  const envKeys = ['MONOMIND_JEV_URL', 'MONOMIND_JEV_API_KEY', 'MONOMIND_JEV'] as const;
  const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const idleQuery = ({ prompt }: any) =>
    (async function* () {
      for await (const m of prompt) {
        void m;
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      }
    })();

  async function start(body: Record<string, unknown>) {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ answers: { decision: body } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    process.env.MONOMIND_JEV_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    delete process.env.MONOMIND_JEV;
    const root = mkdtempSync(join(tmpdir(), 'decider-org-'));
    mkdirSync(join(root, ORG_DIR), { recursive: true });
    writeFileSync(
      join(root, ORG_DIR, 'o.json'),
      JSON.stringify({ ...orgOf([triage(), { id: 'dev', reports_to: 'lead' }], roleDecider()), goal: 'g' }),
    );
    const daemon = new OrgDaemon(root, { queryFn: idleQuery as any, forward: false });
    await daemon.startOrg('o');
    cleanups.push(async () => {
      await daemon.stopAll();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(root, { recursive: true, force: true });
    });
    return daemon;
  }

  it('a confident approve resolves an approval and a gate as decision:triage', async () => {
    const daemon = await start({ type: 'choice', choice: 'approve', confidence: 0.95 });
    const v = await daemon.awaitApproval('o', 'dev', 'org_complete', { why: 'done' });
    expect(v).toMatchObject({ approved: true, owner: 'decider', resolvedBy: 'decision:triage' });
    await daemon.createGate('o', 'dev', 'ship', 'go/no-go');
    expect(daemon.listGates('o')[0]).toMatchObject({ status: 'approved', resolvedBy: 'decision:triage' });
  });

  it('a low-confidence answer leaves approval and gate to a human', async () => {
    const daemon = await start({ type: 'choice', choice: 'approve', confidence: 0.3 });
    const v = await daemon.awaitApproval('o', 'dev', 'org_complete', { why: 'done' });
    expect(v).toMatchObject({ approved: null, owner: 'human' });
    await daemon.createGate('o', 'dev', 'ship', 'go/no-go');
    expect(daemon.listGates('o')[0].status).toBe('pending');
  });
});
