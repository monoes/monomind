// packages/@monomind/cli/src/orgrt/test-loop.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { OrgDaemon } from './daemon.js';
import { startOrgServer } from './server.js';
import { OrgBus } from './bus.js';
import { ORG_DIR, type BusEvent } from './types.js';

/**
 * Scripted fake SDK used by the verification loop (no API cost, deterministic).
 * boss: on kickoff, delegates to coder, then pings the partner org's boss.
 * coder: "writes" a report (Write allowed by policy), attempts Bash (denied), replies to boss.
 * It drives the SAME production code paths via the _orgTest seam:
 * callTool → policy.decide → bus; deliver → daemon.deliver → mailboxes + bus;
 * assistant/result → chat/usage events.
 */
const scriptedQuery = (roleId: string) => ({ prompt, options }: any) => (async function* () {
  const seam = options._orgTest;
  for await (const m of prompt) {
    const text = String(m.message.content);
    // Trigger ONLY on the daemon kickoff message (starts with `Org "`). A bare
    // includes('started') also matches the xorg body "alpha started its run",
    // making the partner boss re-deliver to itself forever — an unbroken
    // microtask chain that starves the event loop (waitFor's timer never fires).
    if (roleId === 'boss' && text.startsWith('Org "') && text.includes('started')) {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Kicking off: delegating to coder.' }] } };
      await seam.deliver('coder', 'task', 'produce out/report.md');
      await seam.deliver('partner:boss', 'fyi', 'alpha started its run');
    } else if (roleId === 'coder') {
      await seam.callTool('Write', { file_path: join(options.cwd, 'out/report.md'), content: '# report' });
      await seam.callTool('Bash', { command: 'echo should-be-denied' }); // policy MUST deny
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Report written.' }] } };
      await seam.deliver('boss', 're: task', 'done — out/report.md');
    } else {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `ack: ${text.slice(0, 40)}` }] } };
    }
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 5, output_tokens: 5 } };
  }
})();

interface IterationResult { checks: Record<string, boolean>; events: number; }
export interface LoopReport { iterations: IterationResult[]; failed: number; summary: string; }

function writeFixtures(root: string): void {
  const dir = join(root, ORG_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'alpha.json'), JSON.stringify({
    name: 'alpha', goal: 'produce a report',
    roles: [
      { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
      { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss',
        policy: { denyTools: ['Bash'], fileWrite: ['out/**'] } },
    ],
  }));
  writeFileSync(join(dir, 'partner.json'), JSON.stringify({
    name: 'partner', goal: 'receive handoffs',
    roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }],
  }));
}

async function waitFor(pred: () => boolean, ms = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return pred();
}

export async function runTestLoop(root: string, times: number): Promise<LoopReport> {
  writeFixtures(root);
  const iterations: IterationResult[] = [];

  for (let i = 0; i < times; i++) {
    const queryFn = (args: any) => {
      const roleId = /You are agent "([^"]+)"/.exec(args.options.systemPrompt)?.[1] ?? 'unknown';
      return scriptedQuery(roleId)(args);
    };
    const daemon = new OrgDaemon(root, { queryFn: queryFn as any, forward: false });
    const srv = await startOrgServer(daemon, 0);
    const wsEvents: BusEvent[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    ws.on('message', d => wsEvents.push(JSON.parse(d.toString())));
    await new Promise(r => ws.on('open', r));

    const alpha = await daemon.startOrg('alpha');
    await daemon.startOrg('partner');
    await waitFor(() => alpha.busEvents().some(e => e.type === 'message' && e.from === 'coder' && e.to === 'boss'));
    await daemon.stopAll();
    ws.close(); srv.close();

    const evs = alpha.busEvents();
    const has = (pred: (e: BusEvent) => boolean) => evs.some(pred);
    const persistedCount = OrgBus.readHistory(join(root, ORG_DIR, 'alpha', alpha.run)).length;
    const checks: Record<string, boolean> = {
      chat: has(e => e.type === 'chat'),
      message: has(e => e.type === 'message' && e.from === 'boss' && e.to === 'coder'),
      tool: has(e => e.type === 'tool' && e.decision === 'allow' && e.tool === 'Write'),
      policyDeny: has(e => e.type === 'tool' && e.decision === 'deny' && e.tool === 'Bash'),
      asset: has(e => e.type === 'asset' && (e.path ?? '').endsWith('out/report.md')),
      xorg: has(e => e.type === 'xorg' && e.to === 'partner:boss'),
      usage: has(e => e.type === 'usage'),
      wsDelivery: wsEvents.length > 0 && wsEvents.some(e => e.type === 'chat'),
      persisted: persistedCount === evs.length,
    };
    iterations.push({ checks, events: evs.length });
  }

  const failed = iterations.filter(it => Object.values(it.checks).some(v => !v)).length;
  const summary = `org e2e: ${times - failed}/${times} passed` +
    (failed ? ` — failing checks: ${JSON.stringify(iterations.filter(it => Object.values(it.checks).some(v => !v)).map(it => it.checks))}` : '');
  return { iterations, failed, summary };
}
