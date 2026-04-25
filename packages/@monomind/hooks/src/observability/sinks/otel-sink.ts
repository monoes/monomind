/**
 * OTelSink - Optional OpenTelemetry integration for the ObservabilityBus.
 *
 * Tries to dynamically import `@opentelemetry/api` at construction time.
 * When the package is unavailable the sink silently no-ops, so it is safe
 * to register unconditionally.
 *
 * @packageDocumentation
 */

import type { ObservabilityBusSink, ObservabilityEvent } from '../bus.js';

/** Minimal subset of the OTel Tracer API we use. */
interface OTelSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  end(): void;
}

interface OTelTracer {
  startSpan(name: string): OTelSpan;
}

interface OTelApi {
  trace: {
    getTracer(name: string, version?: string): OTelTracer;
  };
  SpanStatusCode: { ERROR: number; OK: number };
}

export class OTelSink implements ObservabilityBusSink {
  readonly name = 'otel';
  private tracer: OTelTracer | null = null;
  private api: OTelApi | null = null;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.tryLoad();
  }

  handle(event: ObservabilityEvent): void {
    if (!this.tracer || !this.api) return;

    switch (event.type) {
      case 'agent.start': {
        const span = this.tracer.startSpan(`agent.start:${event.agentSlug}`);
        span.setAttribute('traceId', event.traceId);
        span.setAttribute('spanId', event.spanId);
        span.setAttribute('agentSlug', event.agentSlug);
        span.setAttribute('taskId', event.taskId);
        span.end();
        break;
      }

      case 'agent.complete': {
        const span = this.tracer.startSpan(`agent.complete:${event.agentSlug}`);
        span.setAttribute('traceId', event.traceId);
        span.setAttribute('spanId', event.spanId);
        span.setAttribute('agentSlug', event.agentSlug);
        span.setAttribute('durationMs', event.durationMs);
        span.setAttribute('inputTokens', event.tokens.inputTokens);
        span.setAttribute('outputTokens', event.tokens.outputTokens);
        span.setStatus({ code: this.api.SpanStatusCode.OK });
        span.end();
        break;
      }

      case 'agent.error': {
        const span = this.tracer.startSpan(`agent.error:${event.agentSlug}`);
        span.setAttribute('traceId', event.traceId);
        span.setAttribute('spanId', event.spanId);
        span.setAttribute('agentSlug', event.agentSlug);
        span.setStatus({
          code: this.api.SpanStatusCode.ERROR,
          message: event.error,
        });
        span.end();
        break;
      }

      default:
        // Other event types are not mapped to OTel spans.
        break;
    }
  }

  /** Exposed for tests — resolves once the dynamic import settles. */
  get ready(): Promise<void> {
    return this.initPromise;
  }

  private async tryLoad(): Promise<void> {
    try {
      const otel = (await import('@opentelemetry/api')) as unknown as OTelApi;
      this.api = otel;
      this.tracer = otel.trace.getTracer('monobrain-observability', '1.0.0');
    } catch {
      // @opentelemetry/api not installed — sink will no-op.
      this.tracer = null;
      this.api = null;
    }
  }
}
