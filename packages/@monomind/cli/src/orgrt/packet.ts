// packages/@monomind/cli/src/orgrt/packet.ts
/**
 * The context packet (org sections spec 6.8, Phase 2).
 *
 * A task's declared references (file paths, memory lookup keys, task ids) ride
 * its dispatch after the brief. The declared parts are bounded together, and
 * nothing is ever truncated: a packet that does not fit is rejected with a
 * remedy. The runtime also records exactly what it injected, in the run's
 * `packets.jsonl`: each dispatched packet with its parts' hashes, and the first
 * message of every fresh SDK session (a generation) with its own hash. A
 * resumed session adds no record; a new generation appends one, so an earlier
 * record is never overwritten.
 *
 * References are not snapshots: recording a file path or memory key does not
 * capture its content, and a packet does not authenticate ordinary mail.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { OrgTask } from './task-dag.js';

export const MAX_REFERENCES = 256;
/** All variable first-message parts together, excluding the stable prefix. */
export const MAX_PACKET_CHARS = 12_000;

export interface TaskReferences {
  files?: string[];
  memory_keys?: string[];
  task_ids?: string[];
}

/** The `references` argument of org_task and org_plan_graph nodes. */
export const referencesArg = z
  .object({
    files: z.array(z.string()).optional(),
    memory_keys: z.array(z.string()).optional(),
    task_ids: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

export const REFERENCES_HELP =
  ' `references` lists what the assignee should consult: `files` (authorized paths), `memory_keys` (org_recall lookup keys) and `task_ids` (read with org_tasks). They are listed after the brief; the assignee fetches their contents itself, and a path or key is not a snapshot of what it holds.';

const KINDS = [
  ['files', 'Files'],
  ['memory_keys', 'Memory keys'],
  ['task_ids', 'Tasks'],
] as const;

/** The references block of a dispatch: empty when there is nothing to list. */
export function renderReferences(refs: TaskReferences | undefined): string {
  const lines = KINDS.filter(([k]) => refs?.[k]?.length).map(
    ([k, label]) => `${label}: ${refs![k]!.join(', ')}`,
  );
  return lines.length ? `References:\n${lines.join('\n')}` : '';
}

/** Distinct references, counted per kind (the same string as a file and as a key is two). */
export function countReferences(refs: TaskReferences | undefined): number {
  return KINDS.reduce((n, [k]) => n + new Set(refs?.[k] ?? []).size, 0);
}

/** The error for a declared packet that does not fit, or undefined. */
export function checkPacket(p: {
  title: string;
  brief?: string;
  references?: TaskReferences;
}): string | undefined {
  const refs = countReferences(p.references);
  if (refs > MAX_REFERENCES)
    return `the packet lists ${refs} references, over the ${MAX_REFERENCES} allowed; list fewer references, or split the task (none are dropped)`;
  const chars = [p.title, p.brief ?? '', renderReferences(p.references)].reduce(
    (n, s) => n + s.length,
    0,
  );
  if (chars > MAX_PACKET_CHARS)
    return `the task's brief and references come to ${chars} characters, over ${MAX_PACKET_CHARS}; shorten them, list fewer references, or split the task (nothing is truncated)`;
  return undefined;
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

export interface PacketPart {
  name: string;
  sha256: string;
  chars: number;
}

export interface PacketRecord {
  kind: 'packet';
  ts: number;
  task_id: string;
  role: string;
  /** The dispatch text as sent. */
  text: string;
  sha256: string;
  parts: PacketPart[];
}

export interface GenerationRecord {
  kind: 'generation';
  ts: number;
  role: string;
  /** The session key: a task id under task scope, `_role` otherwise. */
  task_key: string;
  /** 0 for the first SDK session of this (role, task_key), then 1, 2... */
  generation: number;
  resumed: false;
  session_id?: string;
  first_message_sha256: string;
  chars: number;
  /** The task whose dispatch packet this first message carries. */
  packet_task_id?: string;
}

export type PacketLogRecord = PacketRecord | GenerationRecord;

const FILE = 'packets.jsonl';
const ready = new Set<string>();

function append(runDir: string, rec: PacketLogRecord): void {
  try {
    if (!ready.has(runDir)) {
      mkdirSync(runDir, { recursive: true });
      ready.add(runDir);
    }
    appendFileSync(join(runDir, FILE), `${JSON.stringify(rec)}\n`);
  } catch {
    /* a run directory being torn down must never fail a dispatch */
  }
}

export function readPacketLog(runDir: string): PacketLogRecord[] {
  const file = join(runDir, FILE);
  if (!existsSync(file)) return [];
  const out: PacketLogRecord[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as PacketLogRecord);
    } catch {
      /* a torn final line */
    }
  }
  return out;
}

/** The dispatch parts of a task, in the order they are laid out. */
export function dispatchParts(
  taskLine: string,
  task: Pick<OrgTask, 'brief' | 'references'>,
): { name: string; text: string }[] {
  const refs = renderReferences(task.references);
  return [
    { name: 'task', text: taskLine },
    ...(task.brief ? [{ name: 'brief', text: task.brief }] : []),
    ...(refs ? [{ name: 'references', text: refs }] : []),
  ];
}

/** Record a dispatched packet with each part's hash. */
export function recordPacket(
  runDir: string,
  rec: { task_id: string; role: string; text: string; parts: { name: string; text: string }[] },
): void {
  append(runDir, {
    kind: 'packet',
    ts: Date.now(),
    task_id: rec.task_id,
    role: rec.role,
    text: rec.text,
    sha256: sha(rec.text),
    parts: rec.parts.map((p) => ({ name: p.name, sha256: sha(p.text), chars: p.text.length })),
  });
}

/** Record the first message of a fresh SDK session. */
export function recordGeneration(
  runDir: string,
  rec: { role: string; task_key: string; first: string; session_id?: string },
): void {
  const log = readPacketLog(runDir);
  const generation = log.filter(
    (r) => r.kind === 'generation' && r.role === rec.role && r.task_key === rec.task_key,
  ).length;
  const packet = log.find(
    (r): r is PacketRecord =>
      r.kind === 'packet' && r.task_id === rec.task_key && rec.first.includes(r.text),
  );
  append(runDir, {
    kind: 'generation',
    ts: Date.now(),
    role: rec.role,
    task_key: rec.task_key,
    generation,
    resumed: false,
    ...(rec.session_id ? { session_id: rec.session_id } : {}),
    first_message_sha256: sha(rec.first),
    chars: rec.first.length,
    ...(packet ? { packet_task_id: packet.task_id } : {}),
  });
}

/** The text of a stream message, whether the runner is handed a string or an SDK user message. */
export function messageText(m: unknown): string {
  if (typeof m === 'string') return m;
  const c = (m as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c))
    return c
      .map((b) => (typeof b === 'string' ? b : ((b as { text?: string })?.text ?? '')))
      .join('');
  return '';
}

/** Pass a message stream through unchanged, reporting its first message once. */
export function observeFirst<T>(
  source: AsyncIterable<T>,
  onFirst: (m: T) => void,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const it = source[Symbol.asyncIterator]();
      let seen = false;
      return {
        next: async (...args: [] | [undefined]) => {
          const r = await it.next(...args);
          if (!seen && !r.done) {
            seen = true;
            try {
              onFirst(r.value);
            } catch {
              /* recording never changes what the session receives */
            }
          }
          return r;
        },
        return: (v?: unknown) =>
          it.return
            ? it.return(v as never)
            : Promise.resolve({ done: true as const, value: v as never }),
        throw: (e?: unknown) => (it.throw ? it.throw(e) : Promise.reject(e)),
      };
    },
  };
}
