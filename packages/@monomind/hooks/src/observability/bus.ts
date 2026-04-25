/**
 * Observability Bus - Unified event bus for all observability events.
 *
 * Provides pub/sub fan-out to handlers and sinks, with a ring buffer
 * for late-subscriber replay.  Fire-and-forget by default; use
 * `publishSync` when you need back-pressure (tests, draining).
 *
 * @packageDocumentation
 */

// ── Event types ────────────────────────────────────────────────────

export interface TokenUsageEvent {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export type ObservabilityEvent =
  | { type: 'agent.start'; traceId: string; spanId: string; agentSlug: string; taskId: string; timestampMs: number }
  | { type: 'agent.complete'; traceId: string; spanId: string; agentSlug: string; taskId: string; tokens: TokenUsageEvent; durationMs: number; timestampMs: number }
  | { type: 'agent.error'; traceId: string; spanId: string; agentSlug: string; taskId: string; error: string; timestampMs: number }
  | { type: 'tool.call'; traceId: string; spanId: string; toolCallId: string; agentSlug: string; tool: string; input: unknown; timestampMs: number }
  | { type: 'tool.result'; traceId: string; spanId: string; toolCallId: string; tool: string; output: unknown; latencyMs: number; error?: string; timestampMs: number }
  | { type: 'retry'; traceId: string; spanId: string; agentSlug: string; attempt: number; reason: string; timestampMs: number }
  | { type: 'checkpoint'; swarmId: string; step: number; stateHash: string; timestampMs: number }
  | { type: 'session.start'; sessionId: string; timestampMs: number }
  | { type: 'session.end'; sessionId: string; durationMs: number; timestampMs: number }
  | { type: 'daemon.heartbeat'; daemonName: string; status: string; timestampMs: number }
  | { type: 'routing.decision'; taskDescription: string; agentSlug: string; confidence: number; method: string; timestampMs: number };

// ── Handler / Sink contracts ───────────────────────────────────────

export type Unsubscribe = () => void;
export type EventHandler = (event: ObservabilityEvent) => void | Promise<void>;

export interface ObservabilityBusSink {
  name: string;
  handle(event: ObservabilityEvent): void | Promise<void>;
}

// ── Bus implementation ─────────────────────────────────────────────

export class ObservabilityBus {
  private handlers = new Set<EventHandler>();
  private sinks: ObservabilityBusSink[] = [];
  private eventBuffer: ObservabilityEvent[] = [];
  private maxBufferSize: number;

  constructor(maxBufferSize = 10_000) {
    this.maxBufferSize = maxBufferSize;
  }

  /** Subscribe to all events. Returns an unsubscribe function. */
  subscribe(handler: EventHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Register a named sink. */
  addSink(sink: ObservabilityBusSink): void {
    this.sinks.push(sink);
  }

  /** Remove a sink by name. */
  removeSink(name: string): void {
    this.sinks = this.sinks.filter(s => s.name !== name);
  }

  /**
   * Publish an event (fire-and-forget).
   * Errors in individual handlers/sinks are caught and swallowed.
   */
  publish(event: ObservabilityEvent): void {
    this.buffer(event);
    this.fanOut(event);
  }

  /**
   * Publish an event and await all handlers/sinks.
   * Useful for testing or when you need guaranteed delivery.
   */
  async publishSync(event: ObservabilityEvent): Promise<void> {
    this.buffer(event);
    await this.fanOutAsync(event);
  }

  /**
   * Replay buffered events to a late subscriber.
   * Optionally filter by event type.
   */
  replay(
    handler: EventHandler,
    filter?: (event: ObservabilityEvent) => boolean,
  ): void {
    const events = filter
      ? this.eventBuffer.filter(filter)
      : this.eventBuffer;
    for (const event of events) {
      try {
        handler(event);
      } catch {
        // swallow replay errors
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────

  private buffer(event: ObservabilityEvent): void {
    this.eventBuffer.push(event);
    while (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift();
    }
  }

  private fanOut(event: ObservabilityEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // fire-and-forget: swallow
      }
    }
    for (const sink of this.sinks) {
      try {
        sink.handle(event);
      } catch {
        // fire-and-forget: swallow
      }
    }
  }

  private async fanOutAsync(event: ObservabilityEvent): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const handler of this.handlers) {
      try {
        const result = handler(event);
        if (result && typeof (result as Promise<void>).then === 'function') {
          promises.push(
            (result as Promise<void>).catch(() => { /* swallow */ }),
          );
        }
      } catch {
        // swallow sync errors
      }
    }

    for (const sink of this.sinks) {
      try {
        const result = sink.handle(event);
        if (result && typeof (result as Promise<void>).then === 'function') {
          promises.push(
            (result as Promise<void>).catch(() => { /* swallow */ }),
          );
        }
      } catch {
        // swallow sync errors
      }
    }

    await Promise.all(promises);
  }
}

// ── Singleton ──────────────────────────────────────────────────────

export const globalObservabilityBus = new ObservabilityBus();
