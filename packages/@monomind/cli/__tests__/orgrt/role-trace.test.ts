// packages/@monomind/cli/__tests__/orgrt/role-trace.test.ts
/**
 * #327 — a role's turn in its tool-call trace, and its chain carried on the
 * mail it sends with org_send (same org and cross-org), so mono-agent's loop
 * control can tell one busy turn from a loop between roles.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentMessage, AgentRunArgs, AgentRunner } from '../../src/orgrt/agent-runner.js';
import { captureCheckpoint } from '../../src/orgrt/checkpoint.js';
import { OrgDaemon, type RunningOrg } from '../../src/orgrt/daemon.js';
import { currentRoleTrace, endTurn, withTrace } from '../../src/orgrt/role-trace.js';
import { parseTraceLine } from '../../src/orgrt/tool-providers.js';

const PROVIDER = `
import readline from 'node:readline';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'f', version: '1' } } });
  else if (msg.method === 'tools/list') send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'whoami', description: 'meta', inputSchema: { type: 'object', properties: {} } }] } });
  else if (msg.method === 'tools/call') send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(msg.params._meta) }] } });
  else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no' } });
});
`;

/** `CALL <tool> xN` calls the tool N times in one turn; `SEND <to> <rest>`
 *  org_sends `<rest>` to `<to>`. Anything else just ends the turn. */
class ScriptRunner implements AgentRunner {
  results: string[][] = [];
  private waiters: Array<(r: string[]) => void> = [];
  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    for await (const m of args.prompt as AsyncIterable<{ message: { content: string } }>) {
      const content = String(m.message.content);
      const call = /CALL (\S+) x(\d+)/.exec(content);
      const sendCmd = /^SEND (\S+) (.*)$/m.exec(content);
      if (call) {
        const tool = args.tools.find((t) => t.name === call[1])!;
        const out: string[] = [];
        for (let i = 0; i < Number(call[2]); i++) {
          await args.canUseTool?.(`mcp__org__${call[1]}`, {});
          out.push((await tool.handler({})).text);
        }
        this.results.push(out);
        this.waiters.shift()?.(out);
      } else if (sendCmd) {
        const orgSend = args.tools.find((t) => t.name === 'org_send')!;
        await orgSend.handler({ to: sendCmd[1], subject: 'hop', message: sendCmd[2] });
      }
      yield { type: 'assistant', text: 'ok', session_id: 'sess-1' };
      yield { type: 'result', subtype: 'success', input_tokens: 1, output_tokens: 1, session_id: 'sess-1' };
    }
  }
  next(): Promise<string[]> {
    return new Promise((r) => this.waiters.push(r));
  }
}

async function waitFor(fn: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('role-trace helpers', () => {
  it('withTrace stamps the next hop as the first line and never double-stamps', () => {
    const t = { chain_id: 'chn_abc', hop: 2 };
    expect(withTrace('hello', t)).toBe('[trace chn_abc hop=3]\nhello');
    const restamped = withTrace('[trace chn_old hop=9]\nhello\n[trace chn_x hop=1]\nbye', t);
    expect(restamped).toBe('[trace chn_abc hop=3]\nhello\nbye');
    expect(restamped.match(/\[trace /g)).toHaveLength(1);
    expect(parseTraceLine(withTrace('', t))).toEqual({ chain_id: 'chn_abc', hop: 3 });
  });

  it('turn is stable within a turn and climbs as turns end', () => {
    const running = {} as RunningOrg;
    const a = currentRoleTrace(running, 'lead');
    expect(a).toMatchObject({ hop: 0, turn: 1 });
    expect(currentRoleTrace(running, 'lead')).toEqual(a);
    endTurn(running, 'lead');
    expect(currentRoleTrace(running, 'lead')).toEqual({ ...a, turn: 2 });
    expect(currentRoleTrace(running, 'other').turn).toBe(1);
  });
});

describe('role-trace in a running org', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  async function setup(defs: (root: string) => Array<Record<string, unknown>>) {
    const root = mkdtempSync(join(tmpdir(), 'role-trace-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    for (const def of defs(root)) {
      writeFileSync(join(root, `.monomind/orgs/${def.name}.json`), JSON.stringify(def));
    }
    const runner = new ScriptRunner();
    const daemon = new OrgDaemon(root, { runner, forward: false });
    cleanups.push(async () => {
      await daemon.stopAll();
      rmSync(root, { recursive: true, force: true });
    });
    return { root, daemon, runner };
  }

  it('_meta.trace.turn is identical within a turn, +1 on the next, and checkpointed', async () => {
    const { daemon, runner } = await setup((root) => {
      const script = join(root, 'provider.mjs');
      writeFileSync(script, PROVIDER);
      const lead = {
        id: 'lead',
        title: 'Lead',
        type: 'boss',
        reports_to: null,
        tool_providers: [{ kind: 'mcp-stdio', name: 'p', command: process.execPath, args: [script] }],
      };
      return [{ name: 'growth', goal: 'g', roles: [lead] }];
    });
    const running = await daemon.startOrg('growth');
    const turn = async (n: number) => {
      const p = runner.next();
      await daemon.deliver('growth', 'human', 'lead', 'call', `CALL p__whoami x${n}`);
      return (await p).map((r) => JSON.parse(r).trace);
    };
    const first = await turn(2);
    const second = await turn(1);
    expect(first[0]).toEqual({
      org: 'growth',
      run: running.run,
      role: 'lead',
      chain_id: expect.stringMatching(/^chn_/),
      hop: 0,
      turn: expect.any(Number),
    });
    expect(first[1]).toEqual(first[0]); // siblings: same turn
    expect(second[0].turn).toBe(first[0].turn + 1);
    expect(second[0].chain_id).toBe(first[0].chain_id);
    await waitFor(() => (running.turns?.get('lead') ?? 0) >= second[0].turn);
    expect(captureCheckpoint(running).roleState.lead.turns).toBe(second[0].turn);
  }, 30_000);

  const roles = [
    { id: 'a', title: 'A', type: 'boss', reports_to: null },
    { id: 'b', title: 'B', type: 'worker', reports_to: 'a' },
  ];

  it('org_send carries the sender chain at hop+1 and an A → B → A loop climbs one chain', async () => {
    const { daemon } = await setup(() => [{ name: 'growth', goal: 'g', roles }]);
    const running = await daemon.startOrg('growth');
    const chain = daemon.roleTrace('growth', 'a').chain_id;
    await daemon.deliver('growth', 'human', 'a', 'go', 'SEND b SEND a SEND b done');
    const mail = () =>
      running
        .busEvents()
        .filter((e) => e.type === 'message' && e.from !== 'human')
        .map((e) => ({ from: e.from, to: e.to, trace: parseTraceLine(String(e.msg)) }));
    await waitFor(() => mail().length >= 3);
    expect(mail().slice(0, 3)).toEqual([
      { from: 'a', to: 'b', trace: { chain_id: chain, hop: 1 } },
      { from: 'b', to: 'a', trace: { chain_id: chain, hop: 2 } },
      { from: 'a', to: 'b', trace: { chain_id: chain, hop: 3 } },
    ]);
    // the receiver adopted it: b's own calls now sit at hop 3 on a's chain
    expect(daemon.roleTrace('growth', 'b')).toMatchObject({ chain_id: chain, hop: 3 });
    // human mail is never stamped
    const human = running.busEvents().find((e) => e.type === 'message' && e.from === 'human');
    expect(parseTraceLine(String(human?.msg))).toBeUndefined();
  }, 30_000);

  it('a cross-org org_send carries the sender chain at hop+1 and the receiver adopts it', async () => {
    const { daemon } = await setup(() => [
      { name: 'alpha', goal: 'g', roles: [roles[0]] },
      { name: 'beta', goal: 'g', roles: [{ ...roles[0], id: 'b' }] },
    ]);
    const alpha = await daemon.startOrg('alpha');
    const beta = await daemon.startOrg('beta');
    const chain = daemon.roleTrace('alpha', 'a').chain_id;
    await daemon.deliver('alpha', 'human', 'a', 'go', 'SEND beta:b hello');
    await waitFor(() => beta.busEvents().some((e) => e.type === 'xorg'));
    const evt = beta.busEvents().find((e) => e.type === 'xorg')!;
    expect(parseTraceLine(String(evt.msg))).toEqual({ chain_id: chain, hop: 1 });
    expect(alpha.busEvents().some((e) => e.type === 'xorg' && parseTraceLine(String(e.msg))?.hop === 1)).toBe(true);
    expect(daemon.roleTrace('beta', 'b')).toMatchObject({ chain_id: chain, hop: 1 });
  }, 30_000);
});
