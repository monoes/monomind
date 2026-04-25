/**
 * BusHookBridge - Wires V1 lifecycle hooks into the ObservabilityBus.
 *
 * Calling `register()` subscribes to core hook events and re-publishes
 * them as typed ObservabilityEvent messages on the bus.
 *
 * @packageDocumentation
 */

import { registerHook } from '../registry/index.js';
import { HookEvent, HookPriority } from '../types.js';
import { globalObservabilityBus, type ObservabilityBus } from './bus.js';

export class BusHookBridge {
  private bus: ObservabilityBus;

  constructor(bus?: ObservabilityBus) {
    this.bus = bus ?? globalObservabilityBus;
  }

  /**
   * Register hook listeners that forward lifecycle events to the bus.
   * Returns an array of hook registration IDs (useful for cleanup).
   */
  register(): string[] {
    const ids: string[] = [];

    // Agent spawn → agent.start
    ids.push(
      registerHook(
        HookEvent.AgentSpawn,
        (ctx) => {
          const data = ctx.data as Record<string, unknown> | undefined;
          this.bus.publish({
            type: 'agent.start',
            traceId: String(data?.traceId ?? ''),
            spanId: String(data?.spanId ?? ''),
            agentSlug: String(data?.agentSlug ?? data?.agentType ?? 'unknown'),
            taskId: String(data?.taskId ?? ''),
            timestampMs: Date.now(),
          });
          return { success: true };
        },
        HookPriority.Low,
        { name: 'observability-bus:agent-spawn' },
      ),
    );

    // Agent terminate → agent.complete
    ids.push(
      registerHook(
        HookEvent.AgentTerminate,
        (ctx) => {
          const data = ctx.data as Record<string, unknown> | undefined;
          this.bus.publish({
            type: 'agent.complete',
            traceId: String(data?.traceId ?? ''),
            spanId: String(data?.spanId ?? ''),
            agentSlug: String(data?.agentSlug ?? data?.agentType ?? 'unknown'),
            taskId: String(data?.taskId ?? ''),
            tokens: {
              inputTokens: Number(data?.inputTokens ?? 0),
              outputTokens: Number(data?.outputTokens ?? 0),
              costUsd: data?.costUsd != null ? Number(data.costUsd) : undefined,
            },
            durationMs: Number(data?.durationMs ?? 0),
            timestampMs: Date.now(),
          });
          return { success: true };
        },
        HookPriority.Low,
        { name: 'observability-bus:agent-terminate' },
      ),
    );

    // Pre tool use → tool.call
    ids.push(
      registerHook(
        HookEvent.PreToolUse,
        (ctx) => {
          const data = ctx.data as Record<string, unknown> | undefined;
          this.bus.publish({
            type: 'tool.call',
            traceId: String(data?.traceId ?? ''),
            spanId: String(data?.spanId ?? ''),
            toolCallId: String(data?.toolCallId ?? ''),
            agentSlug: String(data?.agentSlug ?? 'unknown'),
            tool: String(data?.tool ?? data?.toolName ?? 'unknown'),
            input: data?.input ?? data?.args ?? null,
            timestampMs: Date.now(),
          });
          return { success: true };
        },
        HookPriority.Low,
        { name: 'observability-bus:pre-tool-use' },
      ),
    );

    // Post tool use → tool.result
    ids.push(
      registerHook(
        HookEvent.PostToolUse,
        (ctx) => {
          const data = ctx.data as Record<string, unknown> | undefined;
          this.bus.publish({
            type: 'tool.result',
            traceId: String(data?.traceId ?? ''),
            spanId: String(data?.spanId ?? ''),
            toolCallId: String(data?.toolCallId ?? ''),
            tool: String(data?.tool ?? data?.toolName ?? 'unknown'),
            output: data?.output ?? data?.result ?? null,
            latencyMs: Number(data?.latencyMs ?? data?.durationMs ?? 0),
            error: data?.error != null ? String(data.error) : undefined,
            timestampMs: Date.now(),
          });
          return { success: true };
        },
        HookPriority.Low,
        { name: 'observability-bus:post-tool-use' },
      ),
    );

    // Session start
    ids.push(
      registerHook(
        HookEvent.SessionStart,
        (ctx) => {
          const data = ctx.data as Record<string, unknown> | undefined;
          this.bus.publish({
            type: 'session.start',
            sessionId: String(data?.sessionId ?? ''),
            timestampMs: Date.now(),
          });
          return { success: true };
        },
        HookPriority.Low,
        { name: 'observability-bus:session-start' },
      ),
    );

    // Session end
    ids.push(
      registerHook(
        HookEvent.SessionEnd,
        (ctx) => {
          const data = ctx.data as Record<string, unknown> | undefined;
          this.bus.publish({
            type: 'session.end',
            sessionId: String(data?.sessionId ?? ''),
            durationMs: Number(data?.durationMs ?? 0),
            timestampMs: Date.now(),
          });
          return { success: true };
        },
        HookPriority.Low,
        { name: 'observability-bus:session-end' },
      ),
    );

    return ids;
  }
}
