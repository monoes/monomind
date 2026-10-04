// packages/@monomind/cli/__tests__/orgrt/support/doc-runner.ts
// A scripted AgentRunner for the document tool tests: it only records the tools each role session was given
// (no model call), so a test calls the real tool handlers the daemon built, as the model would.
import type { AgentMessage, AgentRunArgs, AgentRunner, OrgToolDef } from '../../../src/orgrt/agent-runner.js';
import type { OrgDaemon } from '../../../src/orgrt/daemon.js';

export class CaptureRunner implements AgentRunner {
  readonly tools = new Map<string, OrgToolDef[]>();
  private readonly waiters = new Map<string, Array<() => void>>();
  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const role = args.env.MONOMIND_ORG_ROLE;
    this.tools.set(role, args.tools);
    for (const w of this.waiters.get(role) ?? []) w();
    for await (const _ of args.prompt as AsyncIterable<unknown>) {
      yield { type: 'assistant', text: 'ok', session_id: 's' } as AgentMessage;
      yield {
        type: 'result',
        subtype: 'success',
        input_tokens: 1,
        output_tokens: 1,
        session_id: 's',
      } as AgentMessage;
    }
  }
  /** Spawn `role` (a message from the human starts a lazy role) and wait for its tools. */
  async toolsOf(d: OrgDaemon, org: string, role: string): Promise<OrgToolDef[]> {
    if (!this.tools.has(role)) {
      const seen = new Promise<void>((r) => this.waiters.set(role, [...(this.waiters.get(role) ?? []), r]));
      await d.deliver(org, 'human', role, 'hello', 'hello');
      await Promise.race([
        seen,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`role ${role} never started`)), 5000)),
      ]);
    }
    return this.tools.get(role) as OrgToolDef[];
  }
}

/** Call one tool as the model would and parse its JSON text result. */
export async function callTool(tools: OrgToolDef[], name: string, args: Record<string, unknown> = {}): Promise<any> {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return JSON.parse((await t.handler(args)).text);
}
