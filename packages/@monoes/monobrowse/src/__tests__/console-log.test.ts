/**
 * console-log.ts is pure in-process state: three CDP event listeners feeding
 * two per-session Maps. Nothing here touches a browser — we hand it a fake
 * client that just records handlers and lets us fire events by hand.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CdpClient } from '../browser/cdp.js';
import {
  setupConsoleCapture,
  getConsoleMessages,
  clearConsoleMessages,
  getPageErrors,
  clearPageErrors,
  teardownConsoleCapture,
} from '../browser/console-log.js';

type Handler = (params: Record<string, unknown>, sessionId?: string) => void;

class FakeClient {
  listeners = new Map<string, Set<Handler>>();
  offCalls = 0;

  on(event: string, fn: Handler): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => {
      this.offCalls++;
      this.listeners.get(event)!.delete(fn);
    };
  }

  emit(event: string, params: Record<string, unknown>, sessionId?: string): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn(params, sessionId);
  }

  get handlerCount(): number {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }

  asCdp(): CdpClient {
    return this as unknown as CdpClient;
  }
}

let client: FakeClient;

beforeEach(() => {
  client = new FakeClient();
  // Wipe cross-test global state in the module's module-level Maps.
  clearConsoleMessages();
  clearPageErrors();
});

describe('setupConsoleCapture', () => {
  it('registers exactly the three CDP listeners it needs', () => {
    setupConsoleCapture(client.asCdp(), 'S1');
    expect([...client.listeners.keys()].sort()).toEqual([
      'Log.entryAdded',
      'Runtime.consoleAPICalled',
      'Runtime.exceptionThrown',
    ]);
    expect(client.handlerCount).toBe(3);
  });

  it('detaches the previous generation of listeners when re-run for the same session', () => {
    setupConsoleCapture(client.asCdp(), 'S1');
    setupConsoleCapture(client.asCdp(), 'S1');
    // Three old handlers unsubscribed, three new ones live — not six live.
    expect(client.offCalls).toBe(3);
    expect(client.handlerCount).toBe(3);

    // And a single emitted event must be recorded once, not twice.
    client.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'hi' }] }, 'S1');
    expect(getConsoleMessages('S1')).toHaveLength(1);
  });

  it('resets buffered messages for the session it re-attaches to', () => {
    setupConsoleCapture(client.asCdp(), 'S1');
    client.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'old' }] }, 'S1');
    expect(getConsoleMessages('S1')).toHaveLength(1);

    setupConsoleCapture(client.asCdp(), 'S1');
    expect(getConsoleMessages('S1')).toEqual([]);
  });
});

describe('Runtime.consoleAPICalled capture', () => {
  beforeEach(() => setupConsoleCapture(client.asCdp(), 'S1'));

  it('joins multiple args with a space, preferring description over value', () => {
    client.emit(
      'Runtime.consoleAPICalled',
      { type: 'log', args: [{ value: 'count:' }, { value: 42 }, { description: 'Object {a: 1}' }] },
      'S1'
    );
    expect(getConsoleMessages('S1')[0]!.text).toBe('count: 42 Object {a: 1}');
  });

  it('normalizes CDP\'s "warning" to the "warn" type used by ConsoleMessage', () => {
    client.emit('Runtime.consoleAPICalled', { type: 'warning', args: [{ value: 'careful' }] }, 'S1');
    expect(getConsoleMessages('S1')[0]!.type).toBe('warn');
  });

  it('passes other CDP types through unchanged', () => {
    client.emit('Runtime.consoleAPICalled', { type: 'error', args: [{ value: 'boom' }] }, 'S1');
    expect(getConsoleMessages('S1')[0]!.type).toBe('error');
  });

  it('tolerates a missing args array', () => {
    client.emit('Runtime.consoleAPICalled', { type: 'log' }, 'S1');
    expect(getConsoleMessages('S1')[0]!.text).toBe('');
  });

  it('ignores events addressed to a different session', () => {
    client.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'other' }] }, 'S2');
    expect(getConsoleMessages('S1')).toEqual([]);
  });
});

describe('Log.entryAdded capture', () => {
  beforeEach(() => setupConsoleCapture(client.asCdp(), 'S1'));

  it('records text, url and lineNumber and maps "warning" to "warn"', () => {
    client.emit(
      'Log.entryAdded',
      { entry: { level: 'warning', text: 'deprecated API', url: 'https://x.test/a.js', lineNumber: 17 } },
      'S1'
    );
    const [msg] = getConsoleMessages('S1');
    expect(msg).toMatchObject({
      type: 'warn',
      text: 'deprecated API',
      url: 'https://x.test/a.js',
      lineNumber: 17,
    });
  });

  it('defaults text to empty string when the entry omits it', () => {
    client.emit('Log.entryAdded', { entry: { level: 'info' } }, 'S1');
    expect(getConsoleMessages('S1')[0]).toMatchObject({ type: 'info', text: '' });
  });
});

describe('Runtime.exceptionThrown capture', () => {
  beforeEach(() => setupConsoleCapture(client.asCdp(), 'S1'));

  it('prefers exception.description over the generic text field', () => {
    client.emit(
      'Runtime.exceptionThrown',
      {
        exceptionDetails: {
          text: 'Uncaught',
          exception: { description: 'TypeError: x is not a function' },
          url: 'https://x.test/a.js',
          lineNumber: 3,
          columnNumber: 9,
        },
      },
      'S1'
    );
    expect(getPageErrors('S1')[0]).toMatchObject({
      text: 'TypeError: x is not a function',
      url: 'https://x.test/a.js',
      lineNumber: 3,
      columnNumber: 9,
    });
  });

  it('falls back to text, then to "Unknown error"', () => {
    client.emit('Runtime.exceptionThrown', { exceptionDetails: { text: 'Uncaught (in promise)' } }, 'S1');
    client.emit('Runtime.exceptionThrown', { exceptionDetails: {} }, 'S1');
    expect(getPageErrors('S1').map((e) => e.text)).toEqual([
      'Uncaught (in promise)',
      'Unknown error',
    ]);
  });

  it('keeps page errors out of the console message buffer', () => {
    client.emit('Runtime.exceptionThrown', { exceptionDetails: { text: 'nope' } }, 'S1');
    expect(getConsoleMessages('S1')).toEqual([]);
  });
});

describe('multi-session isolation and clearing', () => {
  beforeEach(() => {
    setupConsoleCapture(client.asCdp(), 'S1');
    setupConsoleCapture(client.asCdp(), 'S2');
    client.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'one' }] }, 'S1');
    client.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'two' }] }, 'S2');
    client.emit('Runtime.exceptionThrown', { exceptionDetails: { text: 'e1' } }, 'S1');
    client.emit('Runtime.exceptionThrown', { exceptionDetails: { text: 'e2' } }, 'S2');
  });

  it('keeps each session\'s buffers separate', () => {
    expect(getConsoleMessages('S1').map((m) => m.text)).toEqual(['one']);
    expect(getConsoleMessages('S2').map((m) => m.text)).toEqual(['two']);
  });

  it('returns a flattened view across sessions when no session id is given', () => {
    expect(getConsoleMessages().map((m) => m.text).sort()).toEqual(['one', 'two']);
    expect(getPageErrors().map((e) => e.text).sort()).toEqual(['e1', 'e2']);
  });

  it('returns a copy, so mutating the result does not corrupt the buffer', () => {
    const snapshot = getConsoleMessages('S1');
    snapshot.push({ type: 'log', text: 'injected', timestamp: 0 });
    expect(getConsoleMessages('S1')).toHaveLength(1);
  });

  it('clears only the named session', () => {
    clearConsoleMessages('S1');
    clearPageErrors('S1');
    expect(getConsoleMessages('S1')).toEqual([]);
    expect(getPageErrors('S1')).toEqual([]);
    expect(getConsoleMessages('S2')).toHaveLength(1);
    expect(getPageErrors('S2')).toHaveLength(1);
  });

  it('clears every session when called with no id', () => {
    clearConsoleMessages();
    clearPageErrors();
    expect(getConsoleMessages()).toEqual([]);
    expect(getPageErrors()).toEqual([]);
  });

  it('a cleared session keeps capturing new events', () => {
    clearConsoleMessages('S1');
    client.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'again' }] }, 'S1');
    expect(getConsoleMessages('S1').map((m) => m.text)).toEqual(['again']);
  });
});

describe('teardownConsoleCapture', () => {
  it('unsubscribes the listeners and drops both buffers for that session only', () => {
    setupConsoleCapture(client.asCdp(), 'S1');
    setupConsoleCapture(client.asCdp(), 'S2');
    client.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'two' }] }, 'S2');

    teardownConsoleCapture('S1');

    expect(client.offCalls).toBe(3);
    client.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'late' }] }, 'S1');
    expect(getConsoleMessages('S1')).toEqual([]);
    expect(getConsoleMessages('S2')).toHaveLength(1);
  });

  it('is a no-op for an unknown session', () => {
    expect(() => teardownConsoleCapture('never-registered')).not.toThrow();
  });
});
