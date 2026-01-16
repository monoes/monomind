/**
 * TraceCollector — wires into hook events to automatically populate traces.
 *
 * Registers hooks for PreTask, PostTask, AgentSpawn, AgentTerminate,
 * PreToolUse, and PostToolUse events.
 */

import { randomBytes } from 'node:crypto';
import { registerHook } from '../registry/index.js';
import { HookEvent, HookPriority, type HookContext } from '../types.js';
import type { TraceStore, TokenUsage } from './trace.js';

function genId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export class TraceCollector {
  private store: TraceStore;
  /** Maps taskId -> traceId for correlating PreTask -> PostTask */
  private taskTraceMap = new Map<string, string>();
  /** Maps agentId -> spanId for correlating AgentSpawn -> AgentTerminate */
  private agentSpanMap = new Map<string, string>();
  /** Maps tool invocation keys -> partial ToolCallEvent data */
  private pendingToolCalls = new Map<string, {
    toolCallId: string;
    spanId: string;
    traceId: string;
    tool: string;
    input: unknown;
    startedAt: string;
  }>();

  constructor(store: TraceStore) {
    this.store = store;
  }

  register(): void {
    // PreTask — start a new trace
    registerHook(
      HookEvent.PreTask,
      async (ctx: HookContext) => {
        const traceId = genId('trc');
        const sessionId = ctx.session?.id ?? 'unknown';
        const taskDescription = ctx.task?.description ?? '';

        this.store.startTrace(traceId, sessionId, taskDescription);

        ctx.traceId = traceId;
        if (ctx.task?.id) {
          this.taskTraceMap.set(ctx.task.id, traceId);
        }

        return { success: true };
      },
      HookPriority.Low,
      { name: 'trace-collector:pre-task' },
    );

    // PostTask — end the trace
    registerHook(
      HookEvent.PostTask,
      async (ctx: HookContext) => {
        const traceId = ctx.traceId
          ?? (ctx.task?.id ? this.taskTraceMap.get(ctx.task.id) : undefined);
        if (traceId) {
          const status = ctx.task?.status === 'error' ? 'error' : 'success';
          this.store.endTrace(traceId, status as 'success' | 'error');
          if (ctx.task?.id) this.taskTraceMap.delete(ctx.task.id);
        }
        return { success: true };
      },
      HookPriority.Low,
      { name: 'trace-collector:post-task' },
    );

    // AgentSpawn — start a span
    registerHook(
      HookEvent.AgentSpawn,
      async (ctx: HookContext) => {
        const traceId = ctx.traceId ?? this.resolveTraceId(ctx);
        if (!traceId) return { success: true };

        const spanId = genId('spn');
        this.store.startSpan({
          spanId,
          traceId,
          agentSlug: ctx.agent?.type ?? 'unknown',
          startedAt: new Date().toISOString(),
          retryCount: 0,
        });

        ctx.spanId = spanId;
        if (ctx.agent?.id) {
          this.agentSpanMap.set(ctx.agent.id, spanId);
        }

        return { success: true };
      },
      HookPriority.Low,
      { name: 'trace-collector:agent-spawn' },
    );

    // AgentTerminate — end the span
    registerHook(
      HookEvent.AgentTerminate,
      async (ctx: HookContext) => {
        const spanId = ctx.spanId
          ?? (ctx.agent?.id ? this.agentSpanMap.get(ctx.agent.id) : undefined);
        if (spanId) {
          const status = ctx.agent?.status === 'error' ? 'error' : 'success';
          const tokenUsage = ctx.metadata?.tokenUsage as TokenUsage | undefined;
          const errorMessage = ctx.metadata?.errorMessage as string | undefined;
          this.store.endSpan(
            spanId,
            status as 'success' | 'error',
            tokenUsage,
            errorMessage,
          );
          if (ctx.agent?.id) this.agentSpanMap.delete(ctx.agent.id);
        }
        return { success: true };
      },
      HookPriority.Low,
      { name: 'trace-collector:agent-terminate' },
    );

    // PreToolUse — record tool call start
    registerHook(
      HookEvent.PreToolUse,
      async (ctx: HookContext) => {
        const traceId = ctx.traceId ?? this.resolveTraceId(ctx);
        const spanId = ctx.spanId ?? this.resolveSpanId(ctx);
        if (!traceId || !spanId) return { success: true };

        const toolCallId = genId('tc');
        const key = `${spanId}:${ctx.tool?.name ?? 'unknown'}`;
        this.pendingToolCalls.set(key, {
          toolCallId,
          spanId,
          traceId,
          tool: ctx.tool?.name ?? 'unknown',
          input: ctx.tool?.parameters,
          startedAt: new Date().toISOString(),
        });

        return { success: true };
      },
      HookPriority.Low,
      { name: 'trace-collector:pre-tool-use' },
    );

    // PostToolUse — record tool call end
    registerHook(
      HookEvent.PostToolUse,
      async (ctx: HookContext) => {
        const spanId = ctx.spanId ?? this.resolveSpanId(ctx);
        if (!spanId) return { success: true };

        const key = `${spanId}:${ctx.tool?.name ?? 'unknown'}`;
        const pending = this.pendingToolCalls.get(key);
        if (pending) {
          const endedAt = new Date().toISOString();
          const startMs = new Date(pending.startedAt).getTime();
          const endMs = new Date(endedAt).getTime();
          this.store.recordToolCall({
            ...pending,
            output: ctx.metadata?.output,
            endedAt,
            latencyMs: endMs - startMs,
            error: ctx.metadata?.error as string | undefined,
          });
          this.pendingToolCalls.delete(key);
        }

        return { success: true };
      },
      HookPriority.Low,
      { name: 'trace-collector:post-tool-use' },
    );
  }

  /** Attempt to resolve traceId from task context */
  private resolveTraceId(ctx: HookContext): string | undefined {
    if (ctx.traceId) return ctx.traceId;
    if (ctx.task?.id) return this.taskTraceMap.get(ctx.task.id);
    return undefined;
  }

  /** Attempt to resolve spanId from agent context */
  private resolveSpanId(ctx: HookContext): string | undefined {
    if (ctx.spanId) return ctx.spanId;
    if (ctx.agent?.id) return this.agentSpanMap.get(ctx.agent.id);
    return undefined;
  }
}
