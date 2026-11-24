// packages/@monomind/cli/__tests__/orgrt/decision-capability.test.ts
/**
 * #835 PR 8 — capability `org-decision-roles`. It is advertised only because the whole path
 * works: a decision role answers mail, and `autonomy.decider {kind: 'role'}` resolves an
 * approval and a gate through it, with a fake provider (a local systemone stub). The doc's
 * handshake example must list exactly what the build advertises.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { checkOrgStructure } from '../../src/orgrt/migrate.js';
import { ORG_DIR, OrgDefSchema } from '../../src/orgrt/types.js';
import { AGENT_PROTOCOL_CAPABILITIES, versionJsonPayload } from '../../src/protocol-capabilities.js';

const orgJson = {
  name: 'o',
  goal: 'g',
  run_config: { budget_tokens: 900 },
  autonomy: { level: 'full', decider: { kind: 'role', role: 'triage' } },
  roles: [
    { id: 'lead', type: 'boss', reports_to: null },
    { id: 'dev', reports_to: 'lead' },
    {
      id: 'triage',
      kind: 'decision',
      reports_to: 'lead',
      decision: {
        provider: 'custom',
        question: 'choice',
        criteria: { approve: 'Safe', deny: 'Unsafe' },
        threshold: 0.7,
        fallback_role: 'lead',
      },
    },
  ],
};

describe('capability org-decision-roles', () => {
  it('is in the handshake payload', () => {
    expect(AGENT_PROTOCOL_CAPABILITIES).toContain('org-decision-roles');
    expect(versionJsonPayload('9.9.9').capabilities).toContain('org-decision-roles');
  });

  it('the §2 handshake example in doc/agent-exec-protocol.md lists exactly the advertised set', () => {
    const doc = readFileSync(join(__dirname, '../../../../../doc/agent-exec-protocol.md'), 'utf8');
    const line = doc.split('\n').find((l) => l.startsWith('{"v":1,"version":"<x.y.z>"'));
    expect(line).toBeDefined();
    const listed = (JSON.parse(line as string) as { capabilities: string[] }).capabilities;
    expect(listed).toEqual([...AGENT_PROTOCOL_CAPABILITIES]);
  });

  it('the fixture org validates', () => {
    expect(checkOrgStructure(OrgDefSchema.parse(orgJson))).toEqual([]);
  });
});

describe('what the capability promises: decision roles end to end (fake provider)', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  const envKeys = ['MONOMIND_JEV_URL', 'MONOMIND_JEV_API_KEY', 'MONOMIND_JEV'] as const;
  const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const idleQuery = ({ prompt }: any) =>
    (async function* () {
      for await (const _m of prompt)
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
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
    const root = mkdtempSync(join(tmpdir(), 'decision-cap-'));
    mkdirSync(join(root, ORG_DIR), { recursive: true });
    writeFileSync(join(root, ORG_DIR, 'o.json'), JSON.stringify(orgJson));
    const daemon = new OrgDaemon(root, { queryFn: idleQuery as any, forward: false });
    const running = await daemon.startOrg('o');
    cleanups.push(async () => {
      await daemon.stopAll();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(root, { recursive: true, force: true });
    });
    return { daemon, running };
  }

  it('confident: mail is answered by the role, the approval and the gate resolve as decision:triage', async () => {
    const { daemon, running } = await start({ type: 'choice', choice: 'approve', confidence: 0.95 });
    expect(running.agents.has('triage')).toBe(false);
    expect(await daemon.deliver('o', 'dev', 'triage', 'ship?', 'tests pass')).toContain(
      '(decision: answered)',
    );
    const v = await daemon.awaitApproval('o', 'dev', 'org_complete', { why: 'done' });
    expect(v).toMatchObject({ approved: true, resolvedBy: 'decision:triage' });
    await daemon.createGate('o', 'dev', 'ship', 'go/no-go');
    expect(daemon.listGates('o')[0]).toMatchObject({ status: 'approved', resolvedBy: 'decision:triage' });
  });

  it('not confident: mail goes to the fallback, approval and gate stay with a person', async () => {
    const { daemon } = await start({ type: 'choice', choice: 'approve', confidence: 0.2 });
    expect(await daemon.deliver('o', 'dev', 'triage', 'ship?', 'tests pass')).toContain(
      'forwarded to lead',
    );
    const v = await daemon.awaitApproval('o', 'dev', 'org_complete', { why: 'done' });
    expect(v).toMatchObject({ approved: null, owner: 'human' });
    await daemon.createGate('o', 'dev', 'ship', 'go/no-go');
    expect(daemon.listGates('o')[0].status).toBe('pending');
  });
});
