// packages/@monomind/cli/src/orgrt/rotation-digest.ts
/**
 * The runtime-built digest that starts a rotated session (org sections spec
 * 6.10): what the role was doing, so the fresh generation can pick up without
 * its dropped history. It is bounded, names task ids to retrieve through
 * org_tasks rather than implying complete state, and carries a progress counter
 * (R22): rotations in a row that finished no task are called out, so a role
 * that is only churning is told to escalate or replan.
 */
import { isTerminalStatus } from './task-dag.js';

export const MAX_DIGEST_CHARS = 4000;

export interface DigestTask {
  id: string;
  title: string;
  assignee: string;
  status: string;
}

export interface DigestInput {
  role: string;
  generation: number;
  previous: {
    tasks: number;
    tokens: number;
    cap: { tasks?: number; tokens?: number };
    reason: 'tasks' | 'tokens';
  };
  tasks: DigestTask[];
  /** Rotations in a row after which no task finished. */
  stalled: number;
  budget: { usd: number; maxUsd?: number; tokens: number; maxTokens?: number };
}

const n = (v: number): string => Math.round(v).toLocaleString('en-US');
const usd = (v: number): string => `$${v.toFixed(2)}`;
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The digest, never longer than `maxChars`. */
export function buildRotationDigest(input: DigestInput, maxChars = MAX_DIGEST_CHARS): string {
  const mine = input.tasks.filter((t) => t.assignee === input.role);
  const done = mine.filter((t) => t.status === 'done').length;
  const open = mine.filter((t) => !isTerminalStatus(t.status as never));
  const cap = input.previous.cap;
  const capText = [
    cap.tasks !== undefined ? `tasks ${n(cap.tasks)}` : '',
    cap.tokens !== undefined ? `tokens ${n(cap.tokens)}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  const head = [
    `You are continuing after a session rotation (generation ${input.generation}). Your earlier conversation was dropped to keep cost bounded; recover state from what follows, and use org_tasks({taskId}) and org_recall for detail.`,
    `Previous generation: ${n(input.previous.tasks)} task(s) and ${n(input.previous.tokens)} token(s) processed (cap ${capText}; rotated on ${input.previous.reason}).`,
    `Your tasks: ${done} done, ${open.length} open.`,
  ];
  const b = input.budget;
  const budget = `Budget: ${usd(b.usd)}${b.maxUsd !== undefined ? ` of ${usd(b.maxUsd)}` : ''} used; ${n(b.tokens)}${b.maxTokens !== undefined ? ` of ${n(b.maxTokens)}` : ''} tokens used.`;
  const tail = [
    budget,
    ...(input.stalled >= 2
      ? [
          `${input.stalled} rotations in a row finished no task: tell your coordinator what is blocking you, or replan, before continuing.`,
        ]
      : []),
  ];

  const fixed = [...head, ...tail].join('\n').length;
  const lines: string[] = [];
  let used = fixed + 8; // the "Open:" heading and the join newlines
  let listed = 0;
  for (const t of open) {
    const line = `- ${t.id} "${clip(t.title, 80)}" [${t.status}]`;
    // Keep room for the "and N more" line.
    if (used + line.length + 1 + 60 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
    listed++;
  }
  const more = open.length - listed;
  const openBlock = open.length
    ? [
        'Open:',
        ...lines,
        ...(more > 0 ? [`(and ${more} more open task(s); org_tasks lists them)`] : []),
      ]
    : [];
  const text = [...head, ...openBlock, ...tail].join('\n');
  return text.length <= maxChars ? text : clip(text, maxChars);
}
