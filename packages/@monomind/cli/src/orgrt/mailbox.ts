/** Shape the SDK expects for streaming-input user messages. */
export interface OrgUserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

/** close() reasons that mean "paused, not dead" — the underlying condition
 *  (a budget cap) can be raised by an operator, unlike a crash/terminal
 *  close. Checked before re-closing a checkpointed mailbox on resume: a
 *  mailbox checkpointed with one of these reasons is left open instead of
 *  being re-closed, or the idle watchdog's "raise the budget and resume
 *  from checkpoint" remedy would silently do nothing — nothing in this
 *  codebase ever reopens a closed mailbox otherwise. The only production
 *  resume path is daemon.ts's inline spawnRole logic (where `new Mailbox()`
 *  is constructed for a role with a roleCheckpoint); checkpoint.ts's
 *  mergeCheckpoint() applies the same check but isn't currently called
 *  outside tests — keep both in sync if either changes. */
const BUDGET_CLOSE_REASONS = new Set(['token-budget', 'usd-budget']);
export function isRecoverableCloseReason(reason: string | undefined): boolean {
  return reason !== undefined && BUDGET_CLOSE_REASONS.has(reason);
}

/**
 * Async message queue feeding one persistent SDK session.
 * push() from the daemon (deliveries from other agents / the user);
 * stream() is passed as the `prompt` of query() to keep the session open.
 */
export class Mailbox {
  private static readonly MAX_QUEUE = 500;
  /** Prefix tagging self-continuation pushes (turn-limit resume) so stream() can
   *  tell them apart from real deliveries and the restart loop can detect a role
   *  that is spinning on its own continuations without making progress. */
  static readonly CONTINUE_PREFIX = '[system:turn-continue]';
  private queue: string[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  /** Why close() was called — e.g. 'token-budget' / 'usd-budget' — distinct
   *  from a crash/terminal close (undefined). Lets callers like the idle
   *  watchdog tell a recoverable budget pause from genuine unreachability. */
  private closeReasonValue?: string;
  /** Bumped when a new stream() starts; stale generators see the mismatch and exit. */
  private generation = 0;
  /** Monotonic count of REAL (non-continuation) messages consumed by stream().
   *  The restart loop snapshots this around a session to tell progress from spin. */
  private consumedReal = 0;
  /** The most recently shift()ed-but-not-yet-confirmed-processed message: set
   *  right before stream() yields it, cleared once the generator is resumed
   *  for the next pull (proof the runner asked for more, i.e. the prior turn
   *  finished). If a session dies with this still set, the generator was
   *  abandoned mid-yield — see reclaimInFlight(). */
  private inFlight: string | null = null;

  /** Number of real (non-continuation) messages consumed so far across all sessions. */
  get consumedRealCount(): number {
    return this.consumedReal;
  }

  push(text: string): void {
    if (this.closed) return;
    if (this.queue.length >= Mailbox.MAX_QUEUE) {
      this.queue.shift();
    }
    this.queue.push(text);
    this.wake?.();
    this.wake = null;
  }

  close(reason?: string): void {
    // First write wins. session.ts's result-message handler can call
    // close() up to three times for one message (circuit-breaker trip,
    // token-budget, USD-budget are independent sibling `if`s, not
    // mutually exclusive) — without this guard the LAST call's reason
    // silently overwrites the first, so a genuinely terminal
    // circuit-breaker close could get misclassified as a recoverable
    // budget close and the resume path would reopen a role that's
    // supposed to require manual intervention.
    if (this.closed) return;
    this.closed = true;
    this.closeReasonValue = reason;
    this.wake?.();
    this.wake = null;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Why close() was called, if given a reason — undefined for a plain crash/
   *  terminal close. See the closeReasonValue field doc for intent. */
  get closeReason(): string | undefined {
    return this.closeReasonValue;
  }

  /**
   * Detach the current waker WITHOUT resolving it. Called between sessions
   * (maxTurns restart, crash backoff): the dead session's generator may still
   * be parked on `wake` inside an abandoned next() — if a push() during that
   * window resolved it, the stale generator would shift() the message and
   * yield it into a promise nobody reads (silent loss, after deliver()
   * already returned a "delivered" receipt). With the waker dropped, such a
   * push only queues; the replacement session's stream() drains it. The
   * parked stale generator is never resumed and becomes garbage with its
   * session.
   */
  detach(): void {
    this.wake = null;
  }

  /**
   * One live generator at a time: each stream() call bumps `generation`, and
   * a stale generator that ever resumes exits immediately without touching
   * the queue. Values are shift()ed at yield time — once the consumer's
   * next() resolves with a message it counts as delivered (matching SDK
   * behavior: a session may consume a message and end without ever resuming
   * the generator; redelivering would duplicate work and can livelock the
   * restart loop).
   */
  async *stream(sessionId = ''): AsyncGenerator<OrgUserMessage> {
    const gen = ++this.generation;
    // Drop (never resolve) any stale waker — see detach().
    this.wake = null;
    // A fresh generator starts with nothing in flight — any prior value
    // belonged to a now-dead generator and reclaimInFlight() (called from the
    // crash-retry path, if at all) already had its chance to act on it.
    this.inFlight = null;
    while (true) {
      while (this.queue.length > 0) {
        if (gen !== this.generation) return; // superseded — leave the queue for the live generator
        const content = this.queue.shift()!;
        if (!content.startsWith(Mailbox.CONTINUE_PREFIX)) this.consumedReal++;
        this.inFlight = content;
        yield {
          type: 'user',
          message: { role: 'user', content },
          parent_tool_use_id: null,
          session_id: sessionId,
        };
        if (gen !== this.generation) return;
        // Resumed for another pull: the consumer asked for the next message,
        // which only happens once it's done with this one — proof the prior
        // turn completed rather than the session dying mid-processing.
        this.inFlight = null;
      }
      if (this.closed || gen !== this.generation) return;
      await new Promise<void>((r) => {
        this.wake = r;
      });
      if (gen !== this.generation) return;
    }
  }

  /** Called by the crash-retry path right after a session dies abnormally. If
   *  a message was mid-flight — shifted for the crashed generator's yield but
   *  never confirmed processed, because the generator was abandoned at that
   *  yield rather than resumed for another pull — put it back at the front of
   *  the queue so the replacement session (built by the next stream() call)
   *  gets it first instead of the queue staying empty and the new session
   *  parking on the mailbox forever. A no-op when nothing was in flight
   *  (clean session end, or nothing was ever pulled). */
  reclaimInFlight(): void {
    if (this.inFlight === null) return;
    const content = this.inFlight;
    this.inFlight = null;
    this.queue.unshift(content);
    // Undo the increment made when this message was shifted — it was never
    // actually processed, so the restart loop's progress/spin detection
    // should not count it as consumed.
    if (!content.startsWith(Mailbox.CONTINUE_PREFIX)) this.consumedReal--;
  }

  /** Serialize mailbox state for checkpoint/resume - Pattern 3 */
  serialize(): { queue: string[]; closed: boolean; consumedReal: number; closeReason?: string } {
    return {
      queue: [...this.queue], // Copy array - queue is public for checkpoint access
      closed: this.closed,
      consumedReal: this.consumedReal,
      ...(this.closeReasonValue ? { closeReason: this.closeReasonValue } : {}),
    };
  }

  /** Deserialize mailbox state from checkpoint - Pattern 3 */
  deserialize(state: {
    queue: string[];
    closed: boolean;
    consumedReal: number;
    closeReason?: string;
  }): void {
    this.queue = [...state.queue]; // Restore queue content
    this.closed = state.closed;
    this.consumedReal = state.consumedReal;
    this.closeReasonValue = state.closeReason; // undefined for checkpoints predating this field
    // Reset generation, wake, and in-flight tracking - a new stream() call
    // will set fresh values; nothing from a checkpointed run is "in flight".
    this.generation = 0;
    this.wake = null;
    this.inFlight = null;
  }
}
