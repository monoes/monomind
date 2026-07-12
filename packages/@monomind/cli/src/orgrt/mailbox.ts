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

  async *stream(sessionId = ''): AsyncGenerator<OrgUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield {
          type: 'user',
          message: { role: 'user', content: this.queue.shift()! },
          parent_tool_use_id: null,
          session_id: sessionId,
        };
      }
      if (this.closed) return;
      await new Promise<void>(r => { this.wake = r; });
    }
  }
}
