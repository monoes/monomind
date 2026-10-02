// packages/@monomind/cli/src/orgrt/session-cap.ts
/**
 * The session cap (org sections spec 6.10, R8): a between-turn rotation
 * threshold, not a hard within-turn limit. Per (role, session key) the runtime
 * counts the distinct task ids admitted to the current generation and the
 * de-duplicated tokens the main session processed in it (a native child's
 * history is its own and is left out). At or above a threshold the session
 * rotates before its next turn: a turn that crosses it may finish and its
 * overshoot is logged, and the next generation starts fresh.
 *
 * Counters live in the run directory, so they survive a resume or a process
 * cycle; a fresh run starts at zero. Every update loads, changes and saves the
 * file in one synchronous step, so the role loops of a run never interleave.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SessionCap {
  tasks?: number;
  tokens?: number;
}

export type CapReason = 'tasks' | 'tokens';

export interface PendingRotation {
  reason: CapReason;
  cap: number;
  /** What the generation that just ended had processed. */
  previous: { tasks: number; tokens: number };
  overshoot: number;
}

export interface GenerationState {
  generation: number;
  tasks: string[];
  tokens: number;
  /** Rotations in a row after which no further task was done (R22). */
  stalled_rotations: number;
  done_at_last_rotation: number;
  usage_missing: number;
  started_at: number;
  /** Set at rotation, cleared once the new generation's first message carries the digest. */
  pending_rotation?: PendingRotation;
}

const fresh = (): GenerationState => ({
  generation: 0,
  tasks: [],
  tokens: 0,
  stalled_rotations: 0,
  done_at_last_rotation: 0,
  usage_missing: 0,
  started_at: Date.now(),
});

/** Which threshold the generation has reached, if any. With `incoming` (the
 *  task ids the next message carries) the tasks cap fires only for a message
 *  that brings a task the generation lacks: a reminder about a task already in
 *  it, or untagged mail, adds no task and so is no reason to rotate. The tokens
 *  cap does not look at the message. */
export function capReached(
  s: Pick<GenerationState, 'tasks' | 'tokens'>,
  cap: SessionCap | undefined,
  incoming?: readonly string[],
): { reason: CapReason; value: number; cap: number } | undefined {
  const brings = incoming === undefined || incoming.some((id) => !s.tasks.includes(id));
  if (cap?.tasks !== undefined && s.tasks.length >= cap.tasks && brings)
    return { reason: 'tasks', value: s.tasks.length, cap: cap.tasks };
  if (cap?.tokens !== undefined && s.tokens >= cap.tokens)
    return { reason: 'tokens', value: s.tokens, cap: cap.tokens };
  return undefined;
}

const FILE = 'session-counters.json';

type Store = Record<string, GenerationState>;

function readStore(runDir: string): Store {
  const file = join(runDir, FILE);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Store;
  } catch {
    return {}; // a corrupt file reads as fresh counters
  }
}

export function loadCounters(runDir: string, role: string, key: string): GenerationState {
  return { ...fresh(), ...readStore(runDir)[`${role}|${key}`] };
}

export function saveCounters(
  runDir: string,
  role: string,
  key: string,
  state: GenerationState,
): void {
  try {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, FILE),
      JSON.stringify({ ...readStore(runDir), [`${role}|${key}`]: state }),
    );
  } catch {
    /* a run directory being torn down must never fail a turn */
  }
}

export class SessionCounters {
  constructor(
    private readonly runDir: string,
    private readonly role: string,
    private readonly key: string,
  ) {}

  /** The persisted state, read fresh. */
  get state(): GenerationState {
    return loadCounters(this.runDir, this.role, this.key);
  }

  private update(fn: (s: GenerationState) => void): GenerationState {
    const s = this.state;
    fn(s);
    saveCounters(this.runDir, this.role, this.key, s);
    return s;
  }

  /** A message was admitted; a tagged one adds its task id once. */
  admit(taskId: string | undefined): void {
    this.update((s) => {
      if (taskId && !s.tasks.includes(taskId)) s.tasks.push(taskId);
    });
  }

  addTokens(n: number): void {
    if (n > 0) this.update((s) => void (s.tokens += n));
  }

  /** A turn reported no usage. Returns how many have in this generation. */
  noteUsageMissing(): number {
    return this.update((s) => void (s.usage_missing += 1)).usage_missing;
  }

  /** End the generation: the next one starts empty, with a digest owed to its first message. */
  rotate(
    hit: { reason: CapReason; cap: number },
    doneTasks: number,
  ): { from: GenerationState; overshoot: number } {
    const from = this.state;
    const value = hit.reason === 'tasks' ? from.tasks.length : from.tokens;
    this.update((s) => {
      s.stalled_rotations = doneTasks > s.done_at_last_rotation ? 0 : s.stalled_rotations + 1;
      s.done_at_last_rotation = doneTasks;
      s.generation += 1;
      s.tasks = [];
      s.tokens = 0;
      s.usage_missing = 0;
      s.started_at = Date.now();
      s.pending_rotation = {
        reason: hit.reason,
        cap: hit.cap,
        previous: { tasks: from.tasks.length, tokens: from.tokens },
        overshoot: Math.max(0, value - hit.cap),
      };
    });
    return { from, overshoot: Math.max(0, value - hit.cap) };
  }

  clearPendingRotation(): void {
    this.update((s) => void delete s.pending_rotation);
  }
}
