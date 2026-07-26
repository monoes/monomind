/**
 * storage.ts builds localStorage/sessionStorage expressions by string
 * concatenation, so the JSON.stringify escaping is the only thing standing
 * between a user-supplied key and script injection into the page. That plus
 * evaluateJs's error/timeout contract is what this file pins down.
 * Fake client throughout — no browser.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CdpClient } from '../browser/cdp.js';
import { evaluateJs } from '../browser/actions.js';
import {
  getLocalStorageKey,
  setLocalStorageKey,
  removeLocalStorageKey,
  clearLocalStorage,
  getAllLocalStorage,
  getSessionStorageKey,
  setSessionStorageKey,
  removeSessionStorageKey,
  clearSessionStorage,
  getAllSessionStorage,
} from '../browser/storage.js';

/** Client stub returning a fixed Runtime.evaluate value, recording expressions. */
function stubClient(value?: unknown, exceptionDetails?: unknown): {
  client: CdpClient;
  exprs: string[];
  sids: Array<string | undefined>;
} {
  const exprs: string[] = [];
  const sids: Array<string | undefined> = [];
  const client = {
    send: vi.fn(async (_m: string, params: { expression: string }, sid?: string) => {
      exprs.push(params.expression);
      sids.push(sid);
      return exceptionDetails ? { result: {}, exceptionDetails } : { result: { value, type: 'string' } };
    }),
  } as unknown as CdpClient;
  return { client, exprs, sids };
}

describe('evaluateJs', () => {
  it('sends Runtime.evaluate with returnByValue and awaitPromise, scoped to the session', async () => {
    const client = {
      send: vi.fn(async () => ({ result: { value: 42, type: 'number' } })),
    } as unknown as CdpClient;
    await expect(evaluateJs(client, 'S1', '1 + 41')).resolves.toBe(42);
    expect((client.send as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      'Runtime.evaluate',
      { expression: '1 + 41', returnByValue: true, awaitPromise: true },
      'S1',
    ]);
  });

  it('surfaces the exception description when the page throws', async () => {
    const { client } = stubClient(undefined, {
      text: 'Uncaught',
      exception: { description: 'ReferenceError: foo is not defined' },
    });
    await expect(evaluateJs(client, 'S1', 'foo')).rejects.toThrow(
      'JS evaluation error: ReferenceError: foo is not defined'
    );
  });

  it('falls back to exceptionDetails.text when there is no description', async () => {
    const { client } = stubClient(undefined, { text: 'Uncaught SyntaxError' });
    await expect(evaluateJs(client, 'S1', '{{')).rejects.toThrow(
      'JS evaluation error: Uncaught SyntaxError'
    );
  });

  it('returns undefined for an expression with no value', async () => {
    const client = { send: vi.fn(async () => ({ result: { type: 'undefined' } })) } as unknown as CdpClient;
    await expect(evaluateJs(client, 'S1', 'void 0')).resolves.toBeUndefined();
  });

  it('rejects rather than hanging when the page never settles the promise', async () => {
    // awaitPromise:true means a never-settling expression would hang forever
    // without the race; a 20ms budget proves the timer is armed.
    const client = { send: vi.fn(() => new Promise(() => {})) } as unknown as CdpClient;
    await expect(evaluateJs(client, 'S1', 'new Promise(() => {})', 20)).rejects.toThrow(
      'JS evaluation timed out after 20ms'
    );
  });

  it('waits indefinitely when the timeout is disabled with 0', async () => {
    let resolveSend: (v: unknown) => void = () => {};
    const client = {
      send: vi.fn(() => new Promise((r) => { resolveSend = r; })),
    } as unknown as CdpClient;
    const p = evaluateJs(client, 'S1', 'slow()', 0);
    resolveSend({ result: { value: 'done', type: 'string' } });
    await expect(p).resolves.toBe('done');
  });
});

describe('localStorage helpers', () => {
  it('reads a key through a JSON-escaped getItem call', async () => {
    const { client, exprs, sids } = stubClient('v');
    await expect(getLocalStorageKey(client, 'S1', 'token')).resolves.toBe('v');
    expect(exprs[0]).toBe('localStorage.getItem("token")');
    expect(sids[0]).toBe('S1');
  });

  it('escapes a key containing quotes and backslashes instead of breaking out', async () => {
    const { client, exprs } = stubClient(null);
    await getLocalStorageKey(client, 'S1', 'a"); alert(1); //');
    expect(exprs[0]).toBe('localStorage.getItem("a\\"); alert(1); //")');
    // The payload must survive as *one* string literal: round-tripping the
    // argument back through JSON.parse recovers the key verbatim, which it
    // could not if the quote had terminated the literal early.
    const arg = exprs[0]!.slice('localStorage.getItem('.length, -1);
    expect(JSON.parse(arg)).toBe('a"); alert(1); //');
  });

  it('escapes newlines in a key so the expression stays one statement', async () => {
    const { client, exprs } = stubClient(null);
    await removeLocalStorageKey(client, 'S1', 'a\nb');
    expect(exprs[0]).toBe('localStorage.removeItem("a\\nb")');
    expect(exprs[0]).not.toContain('\n');
  });

  it('escapes both key and value on write', async () => {
    const { client, exprs } = stubClient();
    await setLocalStorageKey(client, 'S1', 'k"1', 'v"2');
    expect(exprs[0]).toBe('localStorage.setItem("k\\"1", "v\\"2")');
  });

  it('clears with a literal expression', async () => {
    const { client, exprs } = stubClient();
    await clearLocalStorage(client, 'S1');
    expect(exprs[0]).toBe('localStorage.clear()');
  });

  it('getAll parses the JSON dump', async () => {
    const { client } = stubClient('{"a":"1","b":"2"}');
    await expect(getAllLocalStorage(client, 'S1')).resolves.toEqual({ a: '1', b: '2' });
  });

  it('getAll degrades to {} on unparseable output rather than throwing', async () => {
    const { client } = stubClient('not json');
    await expect(getAllLocalStorage(client, 'S1')).resolves.toEqual({});
  });

  it('getItem returning null (missing key) is passed through as null', async () => {
    const { client } = stubClient(null);
    await expect(getLocalStorageKey(client, 'S1', 'missing')).resolves.toBeNull();
  });
});

describe('sessionStorage helpers mirror the localStorage ones', () => {
  it('read / write / remove / clear all target sessionStorage', async () => {
    const { client, exprs } = stubClient('v');
    await getSessionStorageKey(client, 'S1', 'k');
    await setSessionStorageKey(client, 'S1', 'k', 'v');
    await removeSessionStorageKey(client, 'S1', 'k');
    await clearSessionStorage(client, 'S1');
    expect(exprs).toEqual([
      'sessionStorage.getItem("k")',
      'sessionStorage.setItem("k", "v")',
      'sessionStorage.removeItem("k")',
      'sessionStorage.clear()',
    ]);
    expect(exprs.some((e) => e.includes('localStorage'))).toBe(false);
  });

  it('getAll parses, and degrades to {} on garbage', async () => {
    await expect(getAllSessionStorage(stubClient('{"s":"1"}').client, 'S1')).resolves.toEqual({ s: '1' });
    await expect(getAllSessionStorage(stubClient('<html>').client, 'S1')).resolves.toEqual({});
  });
});
