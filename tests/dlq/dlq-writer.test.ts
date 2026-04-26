/**
 * Tests for Dead Letter Queue + Message Forensics (Task 37).
 *
 * Uses vitest globals (describe, it, expect, beforeEach, afterEach, vi).
 * Run: npx vitest run tests/dlq/dlq-writer.test.ts --globals
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DLQWriter } from '../../packages/@monomind/cli/src/dlq/dlq-writer.js';
import { DLQReader } from '../../packages/@monomind/cli/src/dlq/dlq-reader.js';
import { DLQReplayer } from '../../packages/@monomind/cli/src/dlq/dlq-replayer.js';
import type { DeliveryAttempt } from '../../packages/@monomind/shared/src/types/dlq.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'dlq-test-'));
}

function makeAttempts(count: number): DeliveryAttempt[] {
  return Array.from({ length: count }, (_, i) => ({
    attemptNumber: i + 1,
    attemptedAt: new Date(Date.now() - (count - i) * 1000).toISOString(),
    errorType: 'TimeoutError',
    errorMessage: `Attempt ${i + 1} failed`,
    latencyMs: 100 + i * 50,
  }));
}

describe('DLQWriter', () => {
  let dir: string;
  let writer: DLQWriter;

  beforeEach(() => {
    dir = makeTmpDir();
    writer = new DLQWriter(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('enqueue() generates a messageId', () => {
    const entry = writer.enqueue({
      toolName: 'memory_store',
      originalPayload: { key: 'test' },
      deliveryAttempts: makeAttempts(3),
    });

    expect(entry.messageId).toBeTruthy();
    expect(typeof entry.messageId).toBe('string');
    expect(entry.messageId.length).toBeGreaterThan(0);
  });

  it('enqueue() sets finalError from last attempt', () => {
    const attempts = makeAttempts(3);
    const entry = writer.enqueue({
      toolName: 'memory_store',
      originalPayload: { key: 'test' },
      deliveryAttempts: attempts,
    });

    expect(entry.finalError).toBe('Attempt 3 failed');
    expect(entry.finalErrorType).toBe('TimeoutError');
  });

  it('enqueue() sets createdAt from first attempt', () => {
    const attempts = makeAttempts(2);
    const entry = writer.enqueue({
      toolName: 'agent_spawn',
      originalPayload: {},
      deliveryAttempts: attempts,
    });

    expect(entry.createdAt).toBe(attempts[0].attemptedAt);
  });

  it('enqueue() stores entry with pending status and tags', () => {
    const entry = writer.enqueue({
      toolName: 'mcp_call',
      originalPayload: { tool: 'test' },
      deliveryAttempts: makeAttempts(1),
      agentId: 'agent-1',
      swarmId: 'swarm-1',
      tags: ['critical', 'memory'],
    });

    expect(entry.status).toBe('pending');
    expect(entry.tags).toEqual(['critical', 'memory']);
    expect(entry.agentId).toBe('agent-1');
    expect(entry.swarmId).toBe('swarm-1');
  });
});

describe('DLQReader', () => {
  let dir: string;
  let writer: DLQWriter;
  let reader: DLQReader;

  beforeEach(() => {
    dir = makeTmpDir();
    writer = new DLQWriter(dir);
    reader = new DLQReader(writer.getFilePath());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('list() returns only pending by default', () => {
    writer.enqueue({
      toolName: 'tool_a',
      originalPayload: {},
      deliveryAttempts: makeAttempts(1),
    });
    writer.enqueue({
      toolName: 'tool_b',
      originalPayload: {},
      deliveryAttempts: makeAttempts(1),
    });

    const pending = reader.list();
    expect(pending).toHaveLength(2);
    expect(pending.every((e) => e.status === 'pending')).toBe(true);
  });

  it('list() filters by toolName', () => {
    writer.enqueue({ toolName: 'tool_a', originalPayload: {}, deliveryAttempts: makeAttempts(1) });
    writer.enqueue({ toolName: 'tool_b', originalPayload: {}, deliveryAttempts: makeAttempts(1) });
    writer.enqueue({ toolName: 'tool_a', originalPayload: {}, deliveryAttempts: makeAttempts(1) });

    const results = reader.list({ toolName: 'tool_a' });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.toolName === 'tool_a')).toBe(true);
  });

  it('list() filters by agentId', () => {
    writer.enqueue({ toolName: 'tool_a', originalPayload: {}, deliveryAttempts: makeAttempts(1), agentId: 'agent-1' });
    writer.enqueue({ toolName: 'tool_a', originalPayload: {}, deliveryAttempts: makeAttempts(1), agentId: 'agent-2' });
    writer.enqueue({ toolName: 'tool_b', originalPayload: {}, deliveryAttempts: makeAttempts(1), agentId: 'agent-1' });

    const results = reader.list({ agentId: 'agent-1' });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.agentId === 'agent-1')).toBe(true);
  });

  it('get() returns entry by messageId', () => {
    const entry = writer.enqueue({
      toolName: 'tool_x',
      originalPayload: { data: 42 },
      deliveryAttempts: makeAttempts(2),
    });

    const found = reader.get(entry.messageId);
    expect(found).not.toBeNull();
    expect(found!.messageId).toBe(entry.messageId);
    expect(found!.toolName).toBe('tool_x');
    expect(found!.originalPayload).toEqual({ data: 42 });
  });

  it('get() returns null for nonexistent messageId', () => {
    const found = reader.get('nonexistent-id');
    expect(found).toBeNull();
  });

  it('purge() marks old entries as purged', () => {
    // Create entry with createdAt set far in the past
    const oldAttempts: DeliveryAttempt[] = [{
      attemptNumber: 1,
      attemptedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days ago
      errorType: 'Error',
      errorMessage: 'old failure',
      latencyMs: 100,
    }];

    writer.enqueue({ toolName: 'old_tool', originalPayload: {}, deliveryAttempts: oldAttempts });
    writer.enqueue({ toolName: 'new_tool', originalPayload: {}, deliveryAttempts: makeAttempts(1) });

    const purged = reader.purge(30); // purge entries older than 30 days
    expect(purged).toBe(1);

    // Old one should be purged
    const pending = reader.list({ status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0].toolName).toBe('new_tool');

    const purgedList = reader.list({ status: 'purged' });
    expect(purgedList).toHaveLength(1);
    expect(purgedList[0].toolName).toBe('old_tool');
  });
});

describe('DLQReplayer', () => {
  let dir: string;
  let writer: DLQWriter;
  let reader: DLQReader;

  beforeEach(() => {
    dir = makeTmpDir();
    writer = new DLQWriter(dir);
    reader = new DLQReader(writer.getFilePath());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('replay() calls toolCaller with original payload', async () => {
    const entry = writer.enqueue({
      toolName: 'memory_store',
      originalPayload: { key: 'hello', value: 'world' },
      deliveryAttempts: makeAttempts(2),
    });

    const toolCaller = vi.fn().mockResolvedValue(undefined);
    const replayer = new DLQReplayer(writer.getFilePath(), toolCaller);

    await replayer.replay(entry.messageId);

    expect(toolCaller).toHaveBeenCalledWith('memory_store', { key: 'hello', value: 'world' });
  });

  it('replay() updates status to replayed on success', async () => {
    const entry = writer.enqueue({
      toolName: 'memory_store',
      originalPayload: {},
      deliveryAttempts: makeAttempts(1),
    });

    const toolCaller = vi.fn().mockResolvedValue(undefined);
    const replayer = new DLQReplayer(writer.getFilePath(), toolCaller);

    const result = await replayer.replay(entry.messageId);
    expect(result.success).toBe(true);

    const updated = reader.get(entry.messageId);
    expect(updated!.status).toBe('replayed');
    expect(updated!.replayResult).toBe('success');
    expect(updated!.replayedAt).toBeTruthy();
  });

  it('replay() keeps pending on failure', async () => {
    const entry = writer.enqueue({
      toolName: 'broken_tool',
      originalPayload: {},
      deliveryAttempts: makeAttempts(1),
    });

    const toolCaller = vi.fn().mockRejectedValue(new Error('still broken'));
    const replayer = new DLQReplayer(writer.getFilePath(), toolCaller);

    const result = await replayer.replay(entry.messageId);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('still broken');

    const updated = reader.get(entry.messageId);
    expect(updated!.status).toBe('pending');
    expect(updated!.replayResult).toBe('failed_again');
  });

  it('replay() throws for non-existent entry', async () => {
    const toolCaller = vi.fn();
    const replayer = new DLQReplayer(writer.getFilePath(), toolCaller);

    await expect(replayer.replay('no-such-id')).rejects.toThrow('DLQ entry not found: no-such-id');
    expect(toolCaller).not.toHaveBeenCalled();
  });

  it('replay() throws for non-pending entry', async () => {
    // Create and then purge an entry so it's not pending
    const oldAttempts: DeliveryAttempt[] = [{
      attemptNumber: 1,
      attemptedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      errorType: 'Error',
      errorMessage: 'old',
      latencyMs: 50,
    }];
    const entry = writer.enqueue({ toolName: 'tool', originalPayload: {}, deliveryAttempts: oldAttempts });
    reader.purge(1); // purge entries older than 1 day

    const toolCaller = vi.fn();
    const replayer = new DLQReplayer(writer.getFilePath(), toolCaller);

    await expect(replayer.replay(entry.messageId)).rejects.toThrow('DLQ entry is not pending');
    expect(toolCaller).not.toHaveBeenCalled();
  });
});
