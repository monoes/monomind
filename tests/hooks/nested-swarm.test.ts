/**
 * Nested Swarm Sub-Conversations — Task 44 Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NestedSwarmEnvelope } from '../../packages/@monobrain/hooks/src/nested-swarm/nested-swarm-envelope.js';
import { SummaryGenerator } from '../../packages/@monobrain/hooks/src/nested-swarm/summary-generator.js';
import { SubSwarmManager } from '../../packages/@monobrain/hooks/src/nested-swarm/sub-swarm-manager.js';
import type { Message, LlmCallFn } from '../../packages/@monobrain/hooks/src/nested-swarm/types.js';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    messageId: `msg-${Math.random().toString(36).slice(2, 10)}`,
    fromAgentId: 'agent-a',
    toAgentId: 'agent-b',
    content: 'hello world',
    role: 'assistant',
    timestamp: new Date(),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  NestedSwarmEnvelope                                               */
/* ------------------------------------------------------------------ */

describe('NestedSwarmEnvelope', () => {
  let envelope: NestedSwarmEnvelope;

  beforeEach(() => {
    envelope = new NestedSwarmEnvelope('parent-1', 'Analyze codebase');
  });

  it('starts in initializing status', () => {
    expect(envelope.getStatus()).toBe('initializing');
  });

  it('transitions to running when first message is added', () => {
    envelope.addMessage(makeMessage());
    expect(envelope.getStatus()).toBe('running');
  });

  it('toResult() does NOT include raw messages', () => {
    envelope.addMessage(makeMessage());
    const result = envelope.toResult();
    // The result object should not have rawMessages or messages property
    expect(result).not.toHaveProperty('rawMessages');
    expect(result).not.toHaveProperty('messages');
    // It should have the expected properties
    expect(result).toHaveProperty('subSwarmId');
    expect(result).toHaveProperty('parentSwarmId');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('summary');
  });

  it('getRawMessages() returns the messages', () => {
    const msg = makeMessage();
    envelope.addMessage(msg);
    const raw = envelope.getRawMessages();
    expect(raw).toHaveLength(1);
    expect(raw[0]).toEqual(msg);
  });

  it('complete() sets status to completed', () => {
    envelope.addMessage(makeMessage());
    envelope.complete();
    expect(envelope.getStatus()).toBe('completed');
    const result = envelope.toResult();
    expect(result.completedAt).toBeInstanceOf(Date);
  });

  it('fail() sets status to failed with error message', () => {
    envelope.fail('something broke');
    expect(envelope.getStatus()).toBe('failed');
    const result = envelope.toResult();
    expect(result.error).toBe('something broke');
  });

  it('timeout() sets status to timed_out', () => {
    envelope.timeout();
    expect(envelope.getStatus()).toBe('timed_out');
  });

  it('throws when adding messages to a completed envelope', () => {
    envelope.complete();
    expect(() => envelope.addMessage(makeMessage())).toThrow(/completed/);
  });

  it('getMessageCount() returns correct count', () => {
    expect(envelope.getMessageCount()).toBe(0);
    envelope.addMessage(makeMessage());
    envelope.addMessage(makeMessage());
    envelope.addMessage(makeMessage());
    expect(envelope.getMessageCount()).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/*  SummaryGenerator                                                  */
/* ------------------------------------------------------------------ */

describe('SummaryGenerator', () => {
  const llmResponse = [
    'The agents discussed authentication patterns.',
    '- Found SQL injection risk in login handler',
    '- Rate limiting is missing on /api/auth',
    '* Session tokens lack expiration',
  ].join('\n');

  let mockLlm: LlmCallFn & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLlm = vi.fn().mockResolvedValue(llmResponse);
  });

  const messages: Message[] = [
    makeMessage({ fromAgentId: 'agent-1', toAgentId: 'agent-2', content: 'Check auth' }),
    makeMessage({ fromAgentId: 'agent-2', toAgentId: 'agent-3', content: 'Found issue' }),
    makeMessage({ fromAgentId: 'agent-3', toAgentId: 'agent-1', content: 'Confirmed' }),
  ];

  it('calls llmCall with transcript content', async () => {
    await SummaryGenerator.generate('sub-abc', messages, 5000, undefined, mockLlm);
    expect(mockLlm).toHaveBeenCalledTimes(1);
    const [_sys, userPrompt] = (mockLlm as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(userPrompt).toContain('[agent-1 → agent-2]: Check auth');
    expect(userPrompt).toContain('[agent-2 → agent-3]: Found issue');
  });

  it('parses key findings from bullet lines', async () => {
    const summary = await SummaryGenerator.generate('sub-abc', messages, 5000, undefined, mockLlm);
    expect(summary.keyFindings).toHaveLength(3);
    expect(summary.keyFindings[0]).toBe('Found SQL injection risk in login handler');
    expect(summary.keyFindings[2]).toBe('Session tokens lack expiration');
  });

  it('counts unique agent IDs for agentCount', async () => {
    const summary = await SummaryGenerator.generate('sub-abc', messages, 5000, undefined, mockLlm);
    // agents: agent-1, agent-2, agent-3 (from + to)
    expect(summary.agentCount).toBe(3);
  });

  it('sets correct totalMessages and elapsedMs', async () => {
    const summary = await SummaryGenerator.generate('sub-abc', messages, 7500, undefined, mockLlm);
    expect(summary.totalMessages).toBe(3);
    expect(summary.elapsedMs).toBe(7500);
  });
});

/* ------------------------------------------------------------------ */
/*  SubSwarmManager                                                   */
/* ------------------------------------------------------------------ */

describe('SubSwarmManager', () => {
  let manager: SubSwarmManager;

  beforeEach(() => {
    manager = new SubSwarmManager();
  });

  it('spawn() returns a subSwarmId starting with sub-', async () => {
    const id = await manager.spawn({
      parentSwarmId: 'parent-1',
      task: 'Do something',
      maxAgents: 4,
      timeoutMs: 30_000,
      indexTranscript: false,
    });
    expect(id).toMatch(/^sub-[0-9a-f]{16}$/);
  });

  it('getResult() returns null for unknown ID', () => {
    expect(manager.getResult('sub-nonexistent')).toBeNull();
  });
});
