/**
 * CLISink - Renders ObservabilityBus events as colored terminal output.
 *
 * @packageDocumentation
 */

import type { ObservabilityBusSink, ObservabilityEvent } from '../bus.js';

// ANSI color codes
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BLUE = '\x1b[34m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';

function colorFor(type: string): string {
  if (type.startsWith('agent.start') || type === 'agent.complete') return GREEN;
  if (type === 'agent.error') return RED;
  if (type.startsWith('tool.')) return CYAN;
  if (type.startsWith('session.')) return BLUE;
  if (type === 'daemon.heartbeat') return DIM;
  if (type === 'retry') return YELLOW;
  if (type === 'checkpoint') return YELLOW;
  if (type === 'routing.decision') return BLUE;
  return RESET;
}

function formatEvent(event: ObservabilityEvent): string {
  const ts = new Date(event.timestampMs).toISOString().slice(11, 23);
  const color = colorFor(event.type);
  const tag = `[${event.type}]`;

  let detail = '';
  switch (event.type) {
    case 'agent.start':
      detail = `agent=${event.agentSlug} task=${event.taskId}`;
      break;
    case 'agent.complete':
      detail = `agent=${event.agentSlug} dur=${event.durationMs}ms tokens=${event.tokens.inputTokens + event.tokens.outputTokens}`;
      break;
    case 'agent.error':
      detail = `agent=${event.agentSlug} err="${event.error}"`;
      break;
    case 'tool.call':
      detail = `tool=${event.tool} agent=${event.agentSlug}`;
      break;
    case 'tool.result':
      detail = `tool=${event.tool} lat=${event.latencyMs}ms${event.error ? ` err="${event.error}"` : ''}`;
      break;
    case 'retry':
      detail = `agent=${event.agentSlug} attempt=${event.attempt} reason="${event.reason}"`;
      break;
    case 'checkpoint':
      detail = `swarm=${event.swarmId} step=${event.step}`;
      break;
    case 'session.start':
      detail = `session=${event.sessionId}`;
      break;
    case 'session.end':
      detail = `session=${event.sessionId} dur=${event.durationMs}ms`;
      break;
    case 'daemon.heartbeat':
      detail = `daemon=${event.daemonName} status=${event.status}`;
      break;
    case 'routing.decision':
      detail = `agent=${event.agentSlug} conf=${event.confidence} method=${event.method}`;
      break;
  }

  return `${DIM}${ts}${RESET} ${color}${tag}${RESET} ${detail}\n`;
}

export class CLISink implements ObservabilityBusSink {
  readonly name = 'cli';
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  handle(event: ObservabilityEvent): void {
    if (!this.enabled) return;
    process.stdout.write(formatEvent(event));
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}
