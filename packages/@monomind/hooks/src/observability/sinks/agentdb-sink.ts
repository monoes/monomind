/**
 * AgentDBSink - Persists non-trace ObservabilityBus events as JSON lines.
 *
 * Writes daemon.heartbeat, checkpoint, and routing.decision events to a
 * `.jsonl` file for offline analysis.  Uses appendFileSync so events are
 * durable immediately (no buffering beyond the OS page cache).
 *
 * @packageDocumentation
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ObservabilityBusSink, ObservabilityEvent } from '../bus.js';

/** Event types that this sink persists (non-trace, operational events). */
const PERSISTED_TYPES = new Set([
  'daemon.heartbeat',
  'checkpoint',
  'routing.decision',
]);

export class AgentDBSink implements ObservabilityBusSink {
  readonly name = 'agentdb';
  private filePath: string;
  private dirEnsured = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  handle(event: ObservabilityEvent): void {
    if (!PERSISTED_TYPES.has(event.type)) return;

    this.ensureDir();
    const line = JSON.stringify(event) + '\n';
    appendFileSync(this.filePath, line, 'utf-8');
  }

  private ensureDir(): void {
    if (this.dirEnsured) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
    } catch {
      // directory may already exist
    }
    this.dirEnsured = true;
  }
}
