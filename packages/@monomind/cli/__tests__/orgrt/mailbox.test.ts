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
});
