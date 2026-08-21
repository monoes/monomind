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

describe('restart-window message safety (swarm finding #2)', () => {
  it('a push after detach() is preserved for the NEXT stream, not swallowed by the stale generator', async () => {
    const mb = new Mailbox();
    // Session 1: generator parks on wake inside an abandoned next()
    const gen1 = mb.stream('s1');
    const pending = gen1.next(); // no messages yet — parks on wake
    await new Promise(r => setTimeout(r, 5));
    // Session 1 dies; runtime detaches before the replacement starts
    mb.detach();
    // Message arrives during the inter-session window
    mb.push('task-during-restart');
    // Stale generator must NOT have consumed it
    const gen2 = mb.stream('s2');
    const got = await gen2.next();
    expect(got.done).toBe(false);
    expect(got.value.message.content).toBe('task-during-restart');
    // The abandoned next() never resolves with the message either way; the
    // stale generator exits if it is ever resumed.
    mb.close();
    void pending;
  });

  it('a value consumed by a session that ends without return() counts as delivered (no redelivery livelock)', async () => {
    const mb = new Mailbox();
    mb.push('m1');
    const gen1 = mb.stream('s1');
    const first = await gen1.next(); // consume m1, then abandon the generator (like a maxTurns-truncated SDK session)
    expect(first.value.message.content).toBe('m1');
    mb.detach();
    const gen2 = mb.stream('s2');
    mb.close();
    const next = await gen2.next(); // must NOT redeliver m1
    expect(next.done).toBe(true);
  });
});

describe('reclaimInFlight (#203: crash-retry parking the session forever)', () => {
  it('puts a mid-flight message back at the front of the queue when the generator is abandoned mid-yield', async () => {
    const mb = new Mailbox();
    mb.push('crashed-turn');
    const gen1 = mb.stream('s1');
    const first = await gen1.next(); // shift()ed and yielded, but the "session" now dies before asking for more
    expect(first.value.message.content).toBe('crashed-turn');
    expect(mb.consumedRealCount).toBe(1);

    // This is what daemon.ts's crash-retry catch block does.
    mb.detach();
    mb.reclaimInFlight();
    expect(mb.consumedRealCount).toBe(0); // undone — it was never actually processed

    const gen2 = mb.stream('s2');
    const redelivered = await gen2.next();
    expect(redelivered.done).toBe(false);
    expect(redelivered.value.message.content).toBe('crashed-turn');
    mb.close();
  });

  it('is a no-op when the prior turn completed cleanly (generator was resumed for another pull)', async () => {
    const mb = new Mailbox();
    mb.push('turn-1');
    const gen1 = mb.stream('s1');
    await gen1.next(); // consume turn-1
    const parked = gen1.next(); // ask for more with an empty queue — proves turn-1 finished; inFlight clears even though this pull itself won't resolve yet
    await new Promise((r) => setTimeout(r, 5));
    mb.detach();
    mb.reclaimInFlight(); // nothing to reclaim — turn-1 was confirmed delivered
    expect(mb.consumedRealCount).toBe(1); // unchanged — not undone
    const gen2 = mb.stream('s2');
    mb.close();
    const next = await gen2.next();
    expect(next.done).toBe(true); // turn-1 was already delivered to gen1, not lost, not redelivered
    void parked; // abandoned along with gen1 — never resolves, matches existing detach() behavior
  });

  it('is a no-op when nothing was ever pulled', () => {
    const mb = new Mailbox();
    mb.push('never-pulled');
    mb.reclaimInFlight();
    expect(mb.consumedRealCount).toBe(0);
  });

  it('does not decrement consumedRealCount for a reclaimed continuation-prefix message', async () => {
    const mb = new Mailbox();
    mb.push(`${Mailbox.CONTINUE_PREFIX} continue please`);
    const gen1 = mb.stream('s1');
    await gen1.next();
    expect(mb.consumedRealCount).toBe(0); // continuation pushes never increment it
    mb.reclaimInFlight();
    expect(mb.consumedRealCount).toBe(0); // still 0 — nothing to undo
  });
});

describe('closeReason (#205: budget-exhausted boss vs. genuinely unreachable)', () => {
  it('defaults to undefined for a plain close()', () => {
    const mb = new Mailbox();
    mb.close();
    expect(mb.closeReason).toBeUndefined();
  });

  it('records the reason passed to close()', () => {
    const mb = new Mailbox();
    mb.close('token-budget');
    expect(mb.isClosed).toBe(true);
    expect(mb.closeReason).toBe('token-budget');
  });

  it('round-trips through serialize()/deserialize()', () => {
    const mb = new Mailbox();
    mb.close('usd-budget');
    const state = mb.serialize();
    const restored = new Mailbox();
    restored.deserialize(state);
    expect(restored.isClosed).toBe(true);
    expect(restored.closeReason).toBe('usd-budget');
  });

  it('deserializes an older checkpoint with no closeReason field as undefined', () => {
    const mb = new Mailbox();
    mb.deserialize({ queue: [], closed: true, consumedReal: 0 });
    expect(mb.closeReason).toBeUndefined();
  });

  it('first write wins: a second close() call does not overwrite the first reason', () => {
    // Mirrors session.ts's result-message handler, where a circuit-breaker
    // trip (close(), no reason) and a budget check (close('token-budget'))
    // are independent sibling `if`s that can both fire for one message —
    // without first-write-wins, the terminal circuit-breaker close would
    // silently get misclassified as a recoverable budget close, and the
    // resume path would reopen a role meant to require manual intervention.
    const mb = new Mailbox();
    mb.close(); // e.g. circuit-breaker trip — genuinely terminal
    mb.close('token-budget'); // e.g. a sibling budget check firing after
    expect(mb.closeReason).toBeUndefined();
  });

  it('first write wins: a recoverable reason is not overwritten by a later plain close()', () => {
    const mb = new Mailbox();
    mb.close('usd-budget');
    mb.close();
    expect(mb.closeReason).toBe('usd-budget');
  });

  it('first write wins: two conflicting recoverable reasons keep the first', () => {
    const mb = new Mailbox();
    mb.close('token-budget');
    mb.close('usd-budget');
    expect(mb.closeReason).toBe('token-budget');
  });
});
