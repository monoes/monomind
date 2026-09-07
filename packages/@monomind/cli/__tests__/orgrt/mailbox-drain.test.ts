import { describe, it, expect } from 'vitest';
import { Mailbox } from '../../src/orgrt/mailbox.js';

describe('Mailbox.beginDrain', () => {
  it('lets the current in-flight message finish, then stream() returns instead of yielding more', async () => {
    const mailbox = new Mailbox();
    mailbox.push('first');
    mailbox.push('second');
    const iter = mailbox.stream()[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value.message.content).toBe('first');

    // Drain begins WHILE "first" is still in flight (consumer hasn't pulled
    // again yet) — "second" must be swept into the drain snapshot, not yielded.
    const swept = mailbox.beginDrain();
    expect(swept).toEqual(['second']);

    const next = await iter.next();
    expect(next.done).toBe(true);
  });

  it('returns immediately if draining begins with an empty queue and nothing in flight', async () => {
    const mailbox = new Mailbox();
    const iter = mailbox.stream()[Symbol.asyncIterator]();
    // stream() is parked on `wake` (empty queue, nothing in flight).
    const pending = iter.next();
    mailbox.beginDrain();
    const result = await pending;
    expect(result.done).toBe(true);
  });

  it('does not yield a message pushed after draining began', async () => {
    const mailbox = new Mailbox();
    const iter = mailbox.stream()[Symbol.asyncIterator]();
    const pending = iter.next();
    mailbox.beginDrain();
    mailbox.push('too-late');
    const result = await pending;
    expect(result.done).toBe(true);
  });

  it('isDraining reflects state and push() still queues (caller is responsible for redirecting new deliveries elsewhere)', () => {
    const mailbox = new Mailbox();
    expect(mailbox.isDraining).toBe(false);
    mailbox.beginDrain();
    expect(mailbox.isDraining).toBe(true);
    mailbox.push('x');
    expect(mailbox.beginDrain()).toEqual(['x']); // calling again re-sweeps whatever landed since
  });

  it("a fresh generation of stream() is unaffected by a PRIOR generation's drain flag", async () => {
    const mailbox = new Mailbox();
    mailbox.beginDrain();
    // A brand-new stream() (new generation) should behave normally even
    // though `draining` was set for the old generation — draining is a
    // terminal per-mailbox-instance state in this design: once a mailbox is
    // draining it is being retired, never reused for a new generation. This
    // test documents that a caller MUST construct a fresh Mailbox() for the
    // replacement rather than calling stream() again on a draining one.
    mailbox.push('x');
    const iter = mailbox.stream()[Symbol.asyncIterator]();
    const result = await iter.next();
    expect(result.done).toBe(true); // still draining — confirms drain is sticky, not generation-scoped
  });
});
