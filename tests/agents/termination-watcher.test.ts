/**
 * Tests for Per-Agent Termination Conditions (Task 35).
 *
 * Uses vitest globals (describe, it, expect, beforeEach, afterEach, vi).
 * Run: npx vitest run tests/agents/termination-watcher.test.ts --globals
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { check, persistEvent } from '../../packages/@monomind/cli/src/agents/termination-watcher.js';
import type { AgentRunState } from '../../packages/@monomind/cli/src/agents/termination-watcher.js';
import { DEFAULT_TERMINATION_POLICY } from '../../packages/@monomind/shared/src/types/termination.js';
import { broadcast, isHalted } from '../../packages/@monomind/cli/src/agents/halt-signal.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'term-watcher-'));
}

function makeState(overrides: Partial<AgentRunState> = {}): AgentRunState {
  return {
    agentId: 'agent-1',
    agentSlug: 'coder',
    swarmId: 'swarm-1',
    turnCount: 0,
    cumulativeCostUsd: 0,
    startedAt: new Date(),
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe('TerminationWatcher.check', () => {
  it('returns event with max_turns_exceeded when turnCount >= maxTurns', () => {
    const state = makeState({ turnCount: 50 });
    const event = check(state, '', { maxTurns: 50 });

    expect(event).not.toBeNull();
    expect(event!.reason).toBe('max_turns_exceeded');
    expect(event!.triggeredValue).toBe(50);
    expect(event!.agentId).toBe('agent-1');
    expect(event!.agentSlug).toBe('coder');
  });

  it('returns event with max_cost_exceeded when cost >= limit', () => {
    const state = makeState({ cumulativeCostUsd: 1.5 });
    const event = check(state, '', { maxCostUsd: 1.0 });

    expect(event).not.toBeNull();
    expect(event!.reason).toBe('max_cost_exceeded');
    expect(event!.triggeredValue).toBe(1.5);
  });

  it('returns event with timeout when elapsed >= timeoutMs', () => {
    const pastDate = new Date(Date.now() - 400_000);
    const state = makeState({ startedAt: pastDate });
    const event = check(state, '', { timeoutMs: 300_000 });

    expect(event).not.toBeNull();
    expect(event!.reason).toBe('timeout');
    expect(event!.triggeredValue).toBeGreaterThanOrEqual(300_000);
  });

  it('returns event with stop_phrase_matched when output contains phrase', () => {
    const state = makeState();
    const event = check(state, 'Done. TASK_COMPLETE.', {
      stopOnPhrases: ['TASK_COMPLETE'],
    });

    expect(event).not.toBeNull();
    expect(event!.reason).toBe('stop_phrase_matched');
    expect(event!.triggeredValue).toBe('TASK_COMPLETE');
  });

  it('returns null when all conditions are within bounds', () => {
    const state = makeState({
      turnCount: 5,
      cumulativeCostUsd: 0.1,
      consecutiveFailures: 0,
    });
    const event = check(state, 'some normal output');

    expect(event).toBeNull();
  });

  it('cascadeHalt is false for stop_phrase_matched (graceful)', () => {
    const state = makeState();
    const event = check(state, 'TASK_COMPLETE', {
      stopOnPhrases: ['TASK_COMPLETE'],
    });

    expect(event).not.toBeNull();
    expect(event!.cascadeHalt).toBe(false);
  });

  it('cascadeHalt is true for max_turns_exceeded', () => {
    const state = makeState({ turnCount: 100 });
    const event = check(state, '', { maxTurns: 50 });

    expect(event).not.toBeNull();
    expect(event!.cascadeHalt).toBe(true);
  });

  it('cascadeHalt is true for max_cost_exceeded', () => {
    const state = makeState({ cumulativeCostUsd: 5.0 });
    const event = check(state, '', { maxCostUsd: 1.0 });

    expect(event).not.toBeNull();
    expect(event!.cascadeHalt).toBe(true);
  });

  it('uses DEFAULT_TERMINATION_POLICY when fields are missing', () => {
    // With default maxTurns=50, turnCount=50 should trigger
    const state = makeState({ turnCount: 50 });
    const event = check(state, '');

    expect(event).not.toBeNull();
    expect(event!.reason).toBe('max_turns_exceeded');
  });

  it('uses DEFAULT_TERMINATION_POLICY stopOnPhrases when not overridden', () => {
    const state = makeState();
    const event = check(state, 'ESCALATE_TO_HUMAN please');

    expect(event).not.toBeNull();
    expect(event!.reason).toBe('stop_phrase_matched');
    expect(event!.triggeredValue).toBe('ESCALATE_TO_HUMAN');
  });

  it('returns event with max_retries_exceeded when consecutive failures >= limit', () => {
    const state = makeState({ consecutiveFailures: 3 });
    const event = check(state, '', { maxRetries: 3 });

    expect(event).not.toBeNull();
    expect(event!.reason).toBe('max_retries_exceeded');
    expect(event!.triggeredValue).toBe(3);
    expect(event!.cascadeHalt).toBe(true);
  });

  it('includes swarmId in event when present in state', () => {
    const state = makeState({ turnCount: 100, swarmId: 'my-swarm' });
    const event = check(state, '', { maxTurns: 50 });

    expect(event).not.toBeNull();
    expect(event!.swarmId).toBe('my-swarm');
  });

  it('event has a valid eventId and terminatedAt', () => {
    const state = makeState({ turnCount: 100 });
    const event = check(state, '', { maxTurns: 50 });

    expect(event).not.toBeNull();
    expect(event!.eventId).toBeTruthy();
    expect(event!.terminatedAt).toBeInstanceOf(Date);
  });
});

describe('HaltSignal', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = makeTmpDir();
    filePath = join(dir, 'halt-signals.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('broadcast writes a halt record', () => {
    const record = broadcast('swarm-1', 'agent-1', 'max_turns_exceeded', filePath);

    expect(record.swarmId).toBe('swarm-1');
    expect(record.sourceAgentId).toBe('agent-1');
    expect(record.reason).toBe('max_turns_exceeded');
    expect(record.id).toBeTruthy();
    expect(record.haltedAt).toBeTruthy();
  });

  it('isHalted returns true after broadcast for same swarm', () => {
    broadcast('swarm-1', 'agent-1', 'max_cost_exceeded', filePath);

    expect(isHalted('swarm-1', filePath)).toBe(true);
  });

  it('isHalted returns false when no halt signal exists', () => {
    expect(isHalted('swarm-unknown', filePath)).toBe(false);
  });

  it('isHalted returns false for different swarm', () => {
    broadcast('swarm-1', 'agent-1', 'timeout', filePath);

    expect(isHalted('swarm-2', filePath)).toBe(false);
  });
});

describe('persistEvent', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes termination event to JSONL file', () => {
    const filePath = join(dir, 'events.jsonl');
    const state = makeState({ turnCount: 100 });
    const event = check(state, '', { maxTurns: 50 })!;

    persistEvent(event, filePath);

    const { readFileSync } = require('fs');
    const content = readFileSync(filePath, 'utf-8').trim();
    const parsed = JSON.parse(content);
    expect(parsed.agentId).toBe('agent-1');
    expect(parsed.reason).toBe('max_turns_exceeded');
  });
});
