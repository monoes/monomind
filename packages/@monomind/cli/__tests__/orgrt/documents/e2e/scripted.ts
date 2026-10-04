// P3.14 harness: a real OrgDaemon on a temp project root, driven by a scripted AgentRunner (no model). Each role
// session records the tools it was given, the system prompt it started with and the full text of every message it
// is woken with, and answers each message with an empty turn after running the reaction scripted for its role (what
// a model woken by that message would do). Waits are counted conditions with a generous upper bound, never sleeps.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import type { AgentMessage, AgentRunArgs, AgentRunner, OrgToolDef } from '../../../../src/orgrt/agent-runner.js';
import { OrgDaemon } from '../../../../src/orgrt/daemon.js';

export type Reaction = (text: string, tools: OrgToolDef[]) => Promise<void>;

export class Scripted implements AgentRunner {
  readonly tools = new Map<string, OrgToolDef[]>();
  readonly systemPrompts = new Map<string, string>();
  readonly turns = new Map<string, string[]>();
  readonly on = new Map<string, Reaction>();
  /** Exceptions thrown by a scripted reaction (a test asserts this stays empty). */
  readonly errors: string[] = [];
  /** Roles whose session dies the moment it starts (a terminal crash). */
  readonly crash = new Set<string>();
  private readonly waiters = new Map<string, Array<() => void>>();

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const role = args.env.MONOMIND_ORG_ROLE;
    if (this.crash.has(role)) throw new Error(`${role} always dies`);
    this.tools.set(role, args.tools);
    this.systemPrompts.set(role, args.systemPrompt);
    for (const w of this.waiters.get(role) ?? []) w();
    for await (const m of args.prompt as AsyncIterable<{ message: { content: string } }>) {
      const text = m.message.content;
      this.turns.set(role, [...(this.turns.get(role) ?? []), text]);
      try {
        await this.on.get(role)?.(text, args.tools);
      } catch (err) {
        this.errors.push(`${role}: ${err instanceof Error ? err.stack : String(err)}`); // a script bug must not look like a crash
      }
      yield { type: 'assistant', text: 'ok', session_id: 's' } as AgentMessage;
      yield { type: 'result', subtype: 'success', session_id: 's' } as AgentMessage;
    }
  }

  texts(role: string): string[] {
    return this.turns.get(role) ?? [];
  }
  subjects(role: string): string[] {
    return this.texts(role).map((t) => /subject: (.*)/.exec(t)?.[1] ?? t.slice(0, 30));
  }
  allTexts(): string[] {
    return [...this.turns.values()].flat();
  }

  /** Start `role` with a message from the human (a lazy role starts on its first message) and return its tools. */
  async toolsOf(d: OrgDaemon, org: string, role: string, brief = 'brief'): Promise<OrgToolDef[]> {
    if (!this.tools.has(role)) {
      const seen = new Promise<void>((r) => this.waiters.set(role, [...(this.waiters.get(role) ?? []), r]));
      await d.deliver(org, 'human', role, brief, brief);
      await Promise.race([
        seen,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`role ${role} never started`)), 8000)),
      ]);
    }
    return this.tools.get(role) as OrgToolDef[];
  }
}

export const waitFor = async (cond: () => boolean, ms = 8000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 15));
  }
  return cond();
};
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Call one of a role's tools as the model would and parse its JSON text result. */
export async function call(tools: OrgToolDef[], name: string, args: Record<string, unknown> = {}): Promise<any> {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return JSON.parse((await t.handler(args)).text);
}

/** org_doc_read of a version, every part fetched and the content reassembled (a large body comes back in parts). */
export async function readAll(tools: OrgToolDef[], args: Record<string, unknown>): Promise<any> {
  const first = await call(tools, 'org_doc_read', args);
  if (first.ok !== true || first.parts === 1) return first;
  let text = first.content_part as string;
  for (let p = 2; p <= first.parts; p++) {
    text += (await call(tools, 'org_doc_read', { ...args, version: first.version, part: p })).content_part;
  }
  const { content_part: _drop, outline: _outline, ...meta } = first;
  return { ...meta, ...JSON.parse(text) };
}

export interface StartOptions {
  runner?: Scripted;
  resume?: boolean;
  /** Pass the eval gate (default: only a sections definition does). */
  evalGate?: boolean;
  /** Extra OrgDaemon options (a crash test sets `crashBackoffsMs: []`). */
  daemonOpts?: Record<string, unknown>;
}

/** beforeEach/afterEach for a describe block: a temp project root under TMPDIR and the daemons started in it. */
export function useWorld(tag: string) {
  const saved = { ...process.env };
  const daemons: OrgDaemon[] = [];
  let root = '';
  beforeEach(() => {
    process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
    process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
    root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), `${tag}-`));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  });
  afterEach(async () => {
    await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
    rmSync(root, { recursive: true, force: true });
    for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
  });
  return {
    get root(): string {
      return root;
    },
    write(raw: Record<string, any>): void {
      writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
    },
    async start(raw: Record<string, any>, o: StartOptions = {}) {
      this.write(raw);
      const runner = o.runner ?? new Scripted();
      const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000], ...o.daemonOpts });
      daemons.push(d);
      const gate = o.evalGate ?? Boolean(raw.sections);
      const running = await d.startOrg(raw.name, undefined, { ...(gate ? { evalGate: true } : {}), ...(o.resume ? { resume: true } : {}) });
      return { d, running, runner, name: raw.name as string, docs: running.documents! };
    },
  };
}
