import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadedMessageBus } from '../../packages/@monobrain/hooks/src/messaging/threaded-message-bus.js';
import { ConversationThread } from '../../packages/@monobrain/hooks/src/messaging/conversation-thread.js';

describe('ThreadedMessageBus', () => {
  let bus: ThreadedMessageBus;

  beforeEach(() => {
    bus = new ThreadedMessageBus();
  });

  it('creates distinct threads for different agent pairs', () => {
    const t1 = bus.getThread('a', 'b');
    const t2 = bus.getThread('a', 'c');
    expect(t1).not.toBe(t2);
    expect(t1.threadKey).toBe('a:b');
    expect(t2.threadKey).toBe('a:c');
  });

  it('returns the same thread object on repeated calls for the same pair', () => {
    const t1 = bus.getThread('a', 'b');
    const t2 = bus.getThread('a', 'b');
    expect(t1).toBe(t2);
  });

  it('treats A->B and B->A as separate threads (directional)', () => {
    const ab = bus.getThread('a', 'b');
    const ba = bus.getThread('b', 'a');
    expect(ab).not.toBe(ba);
    expect(ab.threadKey).toBe('a:b');
    expect(ba.threadKey).toBe('b:a');
  });

  it('isolates messages: A->B not visible on A->C', () => {
    const ab = bus.getThread('a', 'b');
    const ac = bus.getThread('a', 'c');
    ab.send('hello B');
    ac.send('hello C');
    expect(ab.getHistory()).toHaveLength(1);
    expect(ab.getHistory()[0].content).toBe('hello B');
    expect(ac.getHistory()).toHaveLength(1);
    expect(ac.getHistory()[0].content).toBe('hello C');
  });

  it('evicts oldest messages when token budget is exceeded', () => {
    const thread = bus.getThread('a', 'b');
    // Set a very small budget: 10 tokens = ~40 chars
    thread.setMaxTokens(10);

    // Each message is 20 chars = 5 tokens
    thread.send('12345678901234567890'); // 5 tokens, total 5
    thread.send('abcdefghijklmnopqrst'); // 5 tokens, total 10
    expect(thread.getHistory()).toHaveLength(2);

    // This pushes total to 15, eviction should remove oldest
    thread.send('XYZXYZXYZXYZXYZXYZXY'); // 5 tokens, now over budget -> evict first
    const history = thread.getHistory();
    expect(history).toHaveLength(2);
    // The first message should have been evicted
    expect(history[0].content).toBe('abcdefghijklmnopqrst');
    expect(history[1].content).toBe('XYZXYZXYZXYZXYZXYZXY');
  });

  it('terminateAgent removes all threads involving that agent', () => {
    bus.getThread('a', 'b').send('msg1');
    bus.getThread('b', 'a').send('msg2');
    bus.getThread('c', 'a').send('msg3');
    bus.getThread('c', 'd').send('msg4');
    expect(bus.size).toBe(4);

    bus.terminateAgent('a');
    // Only c->d should remain
    expect(bus.size).toBe(1);
    expect(bus.getAgentThreads('a')).toHaveLength(0);
    expect(bus.getThread('c', 'd').getHistory()).toHaveLength(1);
  });

  it('getAllStats returns stats for every active thread', () => {
    bus.getThread('a', 'b').send('hi');
    bus.getThread('c', 'd').send('there');
    const stats = bus.getAllStats();
    expect(stats).toHaveLength(2);
    expect(stats.map((s) => s.threadKey).sort()).toEqual(['a:b', 'c:d']);
    for (const s of stats) {
      expect(s.messageCount).toBe(1);
      expect(s.totalTokensEstimate).toBeGreaterThan(0);
    }
  });

  it('send() returns a Message with correct fields', () => {
    const thread = bus.getThread('alice', 'bob');
    const msg = thread.send('payload', 'assistant');
    expect(msg.messageId).toBeDefined();
    expect(typeof msg.messageId).toBe('string');
    expect(msg.messageId.length).toBe(32); // 16 random bytes hex
    expect(msg.fromAgentId).toBe('alice');
    expect(msg.toAgentId).toBe('bob');
    expect(msg.content).toBe('payload');
    expect(msg.role).toBe('assistant');
    expect(msg.timestamp).toBeInstanceOf(Date);
  });

  it('getHistory() returns messages in chronological order', () => {
    const thread = bus.getThread('a', 'b');
    thread.send('first');
    thread.send('second');
    thread.send('third');
    const history = thread.getHistory();
    expect(history.map((m) => m.content)).toEqual(['first', 'second', 'third']);
    expect(history[0].timestamp.getTime()).toBeLessThanOrEqual(history[1].timestamp.getTime());
    expect(history[1].timestamp.getTime()).toBeLessThanOrEqual(history[2].timestamp.getTime());
  });

  it('setMaxTokens() changes the budget', () => {
    const thread = bus.getThread('a', 'b');
    // Default is 32000 — send a small message, should be fine
    thread.send('hi');
    expect(thread.getHistory()).toHaveLength(1);

    // Now set a tiny budget and send enough to exceed it
    thread.setMaxTokens(2); // 2 tokens ~ 8 chars
    thread.send('abcdefghij'); // 10 chars = 3 tokens, exceeds budget -> evict 'hi', keep newest
    const history = thread.getHistory();
    // Only the latest message should remain (over budget but always keep the newest)
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('abcdefghij');
  });

  it('clear() empties the thread', () => {
    const thread = bus.getThread('a', 'b');
    thread.send('one');
    thread.send('two');
    expect(thread.getHistory()).toHaveLength(2);
    thread.clear();
    expect(thread.getHistory()).toHaveLength(0);
  });

  it('getPair() returns two directional threads', () => {
    const [ab, ba] = bus.getPair('x', 'y');
    expect(ab).toBeInstanceOf(ConversationThread);
    expect(ba).toBeInstanceOf(ConversationThread);
    expect(ab.threadKey).toBe('x:y');
    expect(ba.threadKey).toBe('y:x');
    expect(ab).not.toBe(ba);
    // They should be the same objects returned by getThread
    expect(bus.getThread('x', 'y')).toBe(ab);
    expect(bus.getThread('y', 'x')).toBe(ba);
  });

  it('getAgentThreads() returns all threads for an agent', () => {
    bus.getThread('a', 'b');
    bus.getThread('a', 'c');
    bus.getThread('d', 'a');
    bus.getThread('e', 'f');

    const threads = bus.getAgentThreads('a');
    expect(threads).toHaveLength(3);
    const keys = threads.map((t) => t.threadKey).sort();
    expect(keys).toEqual(['a:b', 'a:c', 'd:a']);
  });

  it('token estimation is approximately content.length / 4', () => {
    const thread = bus.getThread('a', 'b');
    // 100 chars should be ~25 tokens
    const content = 'x'.repeat(100);
    thread.send(content);
    const stats = thread.getStats();
    expect(stats.totalTokensEstimate).toBe(25);

    // 7 chars -> ceil(7/4) = 2
    const thread2 = bus.getThread('c', 'd');
    thread2.send('1234567');
    expect(thread2.getStats().totalTokensEstimate).toBe(2);
  });
});
