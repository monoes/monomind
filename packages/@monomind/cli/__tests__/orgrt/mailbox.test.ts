import { describe, it, expect } from 'vitest';
import { Mailbox } from '../../src/orgrt/mailbox.js';

describe('Mailbox', () => {
  it('yields pushed messages in order as SDK user messages', async () => {
    const mb = new Mailbox();
    mb.push('first');
    mb.push('second');
    const it = mb.stream()[Symbol.asyncIterator]();
    const a = await it.next();
    expect(a.value.type).toBe('user');
    expect(a.value.message.content).toBe('first');
    expect((await it.next()).value.message.content).toBe('second');
  });

  it('waits for future messages and ends on close', async () => {
    const mb = new Mailbox();
    const collected: string[] = [];
    const done = (async () => {
      for await (const m of mb.stream()) collected.push(m.message.content as string);
    })();
    mb.push('late');
    mb.close();
    await done;
    expect(collected).toEqual(['late']);
  });

  it('queues deliveries pushed while the consumer has not asked for the next turn (never interrupts current work)', async () => {
    // The SDK only calls next() on this stream between its own turns — a session
    // "doing something" simply hasn't called next() yet. Prove pushes made in
    // that window queue in order rather than being lost or racing ahead.
    const mb = new Mailbox();
    mb.push('while-busy-1');
    mb.push('while-busy-2');
    mb.push('while-busy-3');
    // simulate more work arriving before the "session" ever reads a single message
    await new Promise(r => setTimeout(r, 10));
    mb.push('while-busy-4');
    mb.close();

    const seen: string[] = [];
    for await (const m of mb.stream()) seen.push(m.message.content as string);
    expect(seen).toEqual(['while-busy-1', 'while-busy-2', 'while-busy-3', 'while-busy-4']);
  });

  it('a message pushed mid-consumption is not surfaced until the consumer asks again', async () => {
    const mb = new Mailbox();
    mb.push('turn-1');
    const it = mb.stream()[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.value.message.content).toBe('turn-1');

    // consumer is now "working" (mid-turn) — nothing pending, next() would hang.
    // A delivery arriving now must not be observable until next() is called again.
    const nextPromise = it.next();
    let resolved = false;
    nextPromise.then(() => { resolved = true; });
    await new Promise(r => setTimeout(r, 20));
    expect(resolved).toBe(false); // still "mid-turn" — no message yet, no premature yield

    mb.push('interrupt-attempt');
    const second = await nextPromise;
    expect(second.value.message.content).toBe('interrupt-attempt');
  });
});
