// A role-scoped assignee receives dispatches queued in the same 500 ms window as
// ONE message: `[task:a] A…\n\n[task:b] B…`, possibly with a STILL OPEN reminder
// or same-turn mail folded in (dag-dispatch.ts). Every task such a message names
// is a task the session is given, so the cap counts each, and the route key of a
// mixed batch is a fixed rule: the first explicit task tag by position, else the
// first sender's last correspondence, else none. The body of a mail is never read.
import { describe, expect, it } from 'vitest';
import { batchOrder } from '../../src/orgrt/dag-dispatch.js';
import { mailRouteKey, messageTaskIds } from '../../src/orgrt/session-ledger.js';

const none = new Map<string, string>();
const mail = (from: string, subject: string, body = 'body') => `[message from ${from}] subject: ${subject}\n\n${body}`;

describe('messageTaskIds', () => {
  it('lists every dispatch tag of a batch, in order, once each', () => {
    const batch = '[task:a] Alpha\n\nObjective: x\n\n[task:b] Beta\n\n[task:a] STILL OPEN — Alpha';
    expect(messageTaskIds(batch)).toEqual(['a', 'b']);
  });

  it('reads a subject tag of a mail, but never a tag in its body', () => {
    expect(messageTaskIds(mail('boss', '[task:t9] review'))).toEqual(['t9']);
    expect(messageTaskIds(mail('boss', 'review', 'see [task:t9] for context'))).toEqual([]);
  });

  it('reads both kinds in a mixed batch, in the order they appear, dispatch paragraphs first', () => {
    const batch = `[task:t1] Alpha\n\n${mail('boss', '[task:t2] fyi')}\n\n${mail('peer', '[task:t3] hello')}`;
    expect(messageTaskIds(batch)).toEqual(['t1', 't2', 't3']);
  });

  it('does not read a paragraph after a mail head as a dispatch: it is that mail\'s body', () => {
    expect(messageTaskIds(`${mail('boss', 'fyi')}\n\n[task:t1] quoted in the body`)).toEqual([]);
  });

  it('is empty for untagged text', () => {
    expect(messageTaskIds('just words')).toEqual([]);
    expect(messageTaskIds(mail('boss', 'no tag'))).toEqual([]);
  });
});

describe('mailRouteKey on a mixed batch', () => {
  it('is unchanged for a single dispatch or a single mail', () => {
    expect(mailRouteKey('[task:a] Alpha', none)).toBe('a');
    expect(mailRouteKey(mail('boss', '[task:b] x'), none)).toBe('b');
    expect(mailRouteKey(mail('boss', 'x'), new Map([['boss', 'c']]))).toBe('c');
    expect(mailRouteKey('plain', none)).toBeUndefined();
  });

  it('routes a batch by its first task tag, an explicit tag beating a correspondent guess', () => {
    expect(mailRouteKey('[task:a] A\n\n[task:b] B', none)).toBe('a');
    expect(mailRouteKey(`[task:b] B\n\n${mail('boss', 'fyi')}`, new Map([['boss', 'c']]))).toBe('b');
    expect(mailRouteKey(`${mail('boss', '[task:t2] fyi')}\n\n${mail('peer', '[task:t1] x')}`, none)).toBe('t2'); // first by position
  });

  it('falls back to the first sender\'s correspondence only when nothing in the batch is tagged', () => {
    expect(mailRouteKey(`${mail('boss', 'one')}\n\n${mail('peer', 'two')}`, new Map([['boss', 'c'], ['peer', 'd']]))).toBe('c');
    expect(mailRouteKey(`${mail('boss', 'one')}\n\n${mail('peer', 'two')}`, none)).toBeUndefined();
  });

  it('never routes by a tag quoted in a mail body', () => {
    expect(mailRouteKey(mail('boss', 'x', 'see [task:zzz]'), new Map([['boss', 'c']]))).toBe('c');
  });
});

describe('batchOrder', () => {
  const t1 = '[task:t1] Alpha';
  const t2 = '[task:t2] Beta';
  const m1 = mail('boss', 'one');
  const m2 = mail('peer', 'two');

  it('puts task paragraphs first and mail after, each in arrival order', () => {
    expect(batchOrder([m1, t1, m2, t2])).toEqual([t1, t2, m1, m2]);
  });

  it('gives one message, and so one route and one set of counted tasks, whatever order the lines were queued in', () => {
    const a = batchOrder([m1, t1, t2]).join('\n\n');
    const b = batchOrder([t1, m1, t2]).join('\n\n');
    expect(a).toBe(b);
    expect(messageTaskIds(a)).toEqual(['t1', 't2']);
    expect(mailRouteKey(a, new Map([['boss', 'zzz']]))).toBe('t1');
  });

  it('leaves a batch of one kind as it was', () => {
    expect(batchOrder([t1, t2])).toEqual([t1, t2]);
    expect(batchOrder([m1, m2])).toEqual([m1, m2]);
  });
});
