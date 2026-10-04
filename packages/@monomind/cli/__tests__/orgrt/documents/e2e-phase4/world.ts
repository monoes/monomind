// P4.12 harness: the P3.14 scripted daemon (e2e/scripted.ts) with a runner that also reports a USD cost per message
// (`cost=<usd>` in the text adds to the session's cumulative total, as the SDK reports it), so a real OrgDaemon
// records usage with no model. Everything else (counted waits, tool calls as the model would make them) is reused.
import type { AgentMessage, AgentRunArgs, OrgToolDef } from '../../../../src/orgrt/agent-runner.js';
import type { OrgDaemon } from '../../../../src/orgrt/daemon.js';
import { Scripted, call, readAll, useWorld, waitFor } from '../e2e/scripted.js';

export { Scripted, call, readAll, useWorld, waitFor };
export type { OrgToolDef };

let sessions = 0;

/** `Scripted` plus a cumulative cost per session; each session has its own id so a replaced role does not dedupe. */
export class CostScripted extends Scripted {
  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const sid = `p4-${++sessions}`;
    let total = 0;
    const source = args.prompt as AsyncIterable<{ message: { content: string } }>;
    const prompt = (async function* () {
      for await (const m of source) {
        total += Number(/cost=([\d.]+)/.exec(String(m.message.content))?.[1] ?? 0);
        yield m;
      }
    })();
    for await (const m of super.run({ ...args, prompt: prompt as AgentRunArgs['prompt'] })) {
      yield (m.type === 'result'
        ? { ...m, session_id: sid, input_tokens: 1, output_tokens: 1, ...(total > 0 ? { cost_usd: total } : {}) }
        : { ...m, session_id: sid }) as AgentMessage;
    }
  }

  /** Everything `role` was sent, one entry per message: a turn's text can carry several (the runtime batches what it
   *  owes a busy role), so a count by subject must not look at the first one only. */
  messages(role: string): string[] {
    return this.texts(role).flatMap((t) => t.split(/\n\n(?=\[(?:message from [^\]]+|budget|watch)\])/));
  }
  /** The subject of each message `role` was sent (the first 30 characters of one that has none). */
  subjectsAll(role: string): string[] {
    return this.messages(role).map((m) => /subject: (.*)/.exec(m)?.[1] ?? m.slice(0, 30));
  }
  /** How many messages `role` was sent whose subject starts with `prefix`. */
  count(role: string, prefix: string): number {
    return this.subjectsAll(role).filter((s) => s.startsWith(prefix)).length;
  }
  /** The whole text of the messages `role` was sent whose subject starts with `prefix`. */
  textsOf(role: string, prefix: string): string[] {
    return this.messages(role).filter((m) => (/subject: (.*)/.exec(m)?.[1] ?? '').startsWith(prefix));
  }
}

/** Send `cost=<usd>` to a role and wait until its live metrics show `total` (this incarnation's cumulative spend). */
export async function spend(d: OrgDaemon, org: string, running: { agents: Map<string, any> }, role: string, usd: number, total: number): Promise<void> {
  await d.deliver(org, 'human', role, `work cost=${usd}`, 'work');
  const ok = await waitFor(() => Math.abs((running.agents.get(role)?.metrics.costUsd ?? 0) - total) < 1e-9);
  if (!ok) throw new Error(`${role} never showed a spend of ${total}`);
}

/** Wait for a thing that must NOT happen: a short settle after everything owed was delivered. */
export const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Read every part of a version, then decide it, as a consumer does. */
export async function review(
  tools: OrgToolDef[],
  id: string,
  version: number,
  decision: 'accept' | 'reject',
  reason = 'not good enough yet',
): Promise<any> {
  await readAll(tools, { id, version });
  return call(tools, 'org_doc_decide', { id, version, decision, ...(decision === 'reject' ? { reason } : {}) });
}

export const publish = (tools: OrgToolDef[], type: string, summary: string, extra: Record<string, unknown> = {}): Promise<any> =>
  call(tools, 'org_doc_publish', { type, body: { summary }, ...extra });

/** The dev and QA ping-pong of the loop org, run to the point where qa rejects the last round of a loop with
 *  max_rounds 2: build-1 .. build-3, report-1 .. report-2 (rounds are counted through `inputs`). It ends on
 *  build-3@v1 rejected, the cap spent. */
export async function loopToRejectedLastRound(tools: Record<string, OrgToolDef[]>): Promise<void> {
  await publish(tools.coder, 'build', 'the first build');
  await review(tools['qa-lead'], 'build-1', 1, 'accept');
  await publish(tools['qa-lead'], 'report', 'two defects found', { inputs: ['build-1@v1'] });
  await review(tools['dev-lead'], 'report-1', 1, 'accept');
  await publish(tools.coder, 'build', 'fixed the defects', { inputs: ['report-1@v1'] });
  await review(tools['qa-lead'], 'build-2', 1, 'accept');
  await publish(tools['qa-lead'], 'report', 'one defect left', { inputs: ['build-2@v1'] });
  await review(tools['dev-lead'], 'report-2', 1, 'accept');
  await publish(tools.coder, 'build', 'fixed the last defect', { inputs: ['report-2@v1'] });
  await review(tools['qa-lead'], 'build-3', 1, 'reject', 'the fix breaks the parser');
}
