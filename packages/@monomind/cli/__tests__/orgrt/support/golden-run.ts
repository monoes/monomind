// packages/@monomind/cli/__tests__/orgrt/support/golden-run.ts
//
// Org sections P3.0: one scripted run of a small sections-off org in a real
// OrgDaemon with a stub queryFn (no model). The script is a fixed sequence of
// steps, each ending at a barrier that waits for a counted condition, never a
// sleep, so the record does not depend on timing or load:
//   boot -> task dispatch -> open-task nudge -> DONE message -> send receipts
//   -> lead-watch notice (fake clock, no real waiting) -> stop.
// Bus events are recorded per step and per acting role (a role's own events
// are causally ordered; two roles running at once are not), then normalised.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { CHECKPOINT_VERSION } from '../../../src/orgrt/checkpoint.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { dagCompleteTask, dagCreateTask } from '../../../src/orgrt/decisions.js';
import type { BusEvent } from '../../../src/orgrt/types.js';
import { normalizeGolden } from './normalize-golden.js';

const RAW_DEF = {
  name: 'alpha',
  goal: 'g',
  run_config: {
    idle_minutes: 0,
    max_concurrent_agents: 2,
    notify_task_creator: true,
    lead_watch: { not_started_s: 0.3, silent_s: 600 },
  },
  roles: [
    { id: 'boss', title: 'Boss', type: 'boss', reports_to: null, policy: { sandbox: { mode: 'off' } } },
    { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', policy: { sandbox: { mode: 'off' } } },
    { id: 'idle', title: 'Idle', type: 'specialist', reports_to: 'boss', policy: { sandbox: { mode: 'off' } } },
  ],
};

const until = async (pred: () => boolean, what: string, ms = 20_000): Promise<void> => {
  for (let i = 0; i < ms / 10 && !pred(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!pred()) throw new Error(`scripted golden run: never reached "${what}"`);
};

/** Sorted file tree under a directory; directories end with `/`. */
export function fileTree(dir: string, prefix = ''): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const f = join(dir, n);
      return statSync(f).isDirectory() ? [`${prefix}${n}/`, ...fileTree(f, `${prefix}${n}/`)] : [`${prefix}${n}`];
    });
}

export interface ScriptedRun {
  /** Bus events per step, grouped by acting role (`system` when none). */
  bus: Record<string, Record<string, unknown[]>>;
  /** Every message each role's session received, in order. */
  received: Record<string, string[]>;
  /** What deliver() answered the sender. */
  receipts: Record<string, string>;
  files: string[];
  runtimeKeys: string[];
  checkpointKeys: string[];
  checkpointVersion: number;
  currentCheckpointVersion: number;
  sessionsKeys: string[];
}

export async function runScripted(tmp: string): Promise<ScriptedRun> {
  const root = mkdtempSync(join(tmp, 'golden-run-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify(RAW_DEF));
  const received: Record<string, string[]> = {};
  const queryFn = ({ prompt, options }: any) =>
    (async function* () {
      const id = /You are agent "([^"]+)"/.exec(options.systemPrompt)?.[1] ?? 'unknown';
      for await (const m of prompt) {
        (received[id] ??= []).push(m.message.content);
        yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      }
    })();

  // Only the lead-watch interval and the clock are faked; real timers and IO still run.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  try {
    const d = new OrgDaemon(root, { queryFn: queryFn as any, forward: false });
    const running = await d.startOrg('alpha');
    // run memory is stored through a bridge whose outcome depends on the machine
    // (known environmental failure of daemon.test.ts), so its events are left out
    const events = (): BusEvent[] => running
        .busEvents()
        // a host without bubblewrap audits authority-mask-unavailable; the golden is host-independent
        .filter((e) => !e.reason?.startsWith('org-memory-') && e.reason !== 'authority-mask-unavailable');
    const seen = (reason: string, from?: string): boolean =>
      events().some((e) => e.reason === reason && (from === undefined || e.from === from));
    const turns = (role: string): number => events().filter((e) => e.type === 'usage' && e.from === role).length;
    const bus: ScriptedRun['bus'] = {};
    let cut = 0;
    const closeStep = (name: string): void => {
      const slice = events().slice(cut);
      cut += slice.length;
      const grouped: Record<string, unknown[]> = {};
      for (const e of slice) (grouped[e.from ?? 'system'] ??= []).push(normalizeGolden(e, { roots: [root] }));
      bus[name] = Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)));
    };
    const receipts: Record<string, string> = {};

    await until(() => turns('boss') >= 1 && events().some((e) => e.msg?.startsWith('org started')), 'boss briefing turn and org start');
    closeStep('1-boot');

    const id = (JSON.parse(dagCreateTask(d, 'alpha', 'boss', 'do it', 'coder', [], undefined, 'the brief')) as { id: string }).id;
    await until(() => turns('coder') >= 2 && seen('task-dispatched'), 'coder dispatch turn, nudge turn, dispatch event');
    closeStep('2-dispatch');

    dagCompleteTask(d, 'alpha', 'coder', id, 'done it');
    await until(() => turns('boss') >= 2, 'boss DONE turn');
    closeStep('3-done');

    receipts.unknownRecipient = await d.deliver('alpha', 'boss', 'nobody', 's', 'b');
    receipts.toCoder = await d.deliver('alpha', 'boss', 'coder', 's', 'b');
    await until(() => turns('coder') >= 3, 'coder message turn');
    closeStep('4-send');

    // the third role has no free slot, so its task stays ready and the watch tells the lead
    dagCreateTask(d, 'alpha', 'boss', 'held', 'idle', []);
    await until(() => seen('concurrency-limit', 'idle'), 'idle deferred');
    for (let i = 0; i < 5; i++) vi.advanceTimersByTime(100);
    await until(() => turns('boss') >= 3 && seen('lead-watch'), 'boss lead-watch turn');
    closeStep('5-lead-watch');

    await d.stopAll();
    closeStep('6-stop');

    const orgDir = join(root, '.monomind/orgs/alpha');
    const runtime = JSON.parse(readFileSync(join(orgDir, 'runtime.json'), 'utf8')) as Record<string, any>;
    const runDir = readdirSync(orgDir).find((n) => n.startsWith('run-')) as string;
    const sessions = JSON.parse(readFileSync(join(orgDir, runDir, 'sessions.json'), 'utf8')) as unknown;
    const norm = (v: unknown) => normalizeGolden(v, { roots: [root] });
    return {
      bus,
      received: norm(received) as Record<string, string[]>,
      receipts: norm(receipts) as Record<string, string>,
      files: norm(fileTree(join(root, '.monomind/orgs'))) as string[],
      runtimeKeys: Object.keys(runtime),
      checkpointKeys: Object.keys(runtime.checkpoint ?? {}),
      checkpointVersion: runtime.checkpoint?.version,
      currentCheckpointVersion: CHECKPOINT_VERSION,
      sessionsKeys: Array.isArray(sessions) ? ['<array>'] : Object.keys(sessions as object),
    };
  } finally {
    vi.useRealTimers();
  }
}
