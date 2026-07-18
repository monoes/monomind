/** Shape the SDK expects for streaming-input user messages. */
export interface OrgUserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

/**
 * Async message queue feeding one persistent SDK session.
 * push() from the daemon (deliveries from other agents / the user);
 * stream() is passed as the `prompt` of query() to keep the session open.
 */
export class Mailbox {
  private queue: string[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  /** Bumped when a new stream() starts; stale generators see the mismatch and exit. */
  private generation = 0;

  push(text: string): void {
    if (this.closed) return;
    this.queue.push(text);
    this.wake?.(); this.wake = null;
  }

  close(): void {
    this.closed = true;
    this.wake?.(); this.wake = null;
  }

  get isClosed(): boolean { return this.closed; }

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
  detach(): void { this.wake = null; }

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
    while (true) {
      while (this.queue.length > 0) {
        if (gen !== this.generation) return; // superseded — leave the queue for the live generator
        yield {
          type: 'user',
          message: { role: 'user', content: this.queue.shift()! },
          parent_tool_use_id: null,
          session_id: sessionId,
        };
        if (gen !== this.generation) return;
      }
      if (this.closed || gen !== this.generation) return;
      await new Promise<void>(r => { this.wake = r; });
      if (gen !== this.generation) return;
    }
  }
}
