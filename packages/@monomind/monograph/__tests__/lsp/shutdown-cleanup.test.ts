import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { openDb, closeDb } from '../../src/storage/db.js';
import { startLspServer } from '../../src/lsp/server.js';
import type { MonographDb } from '../../src/storage/db.js';

// MONO-7 regression: the 'shutdown' handler used to send the JSON-RPC response
// but keep the DB handle open and the stdin 'data'/'end' listeners attached,
// relying on the 'exit' notification (or stdin EOF) to drive `process.exit(0)`.
// That left resources leaked on graceful shutdown and made the server impossible
// to embed inside a larger process.

function encodeLspMessage(obj: unknown): Buffer {
  const json = JSON.stringify(obj);
  return Buffer.from(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

describe('MONO-7: LSP shutdown releases DB + stdin listeners', () => {
  let dbPath: string;
  let db: MonographDb;
  let stdoutChunks: Buffer[];
  let originalWrite: typeof process.stdout.write;
  let originalExit: typeof process.exit;
  let removeStdinSpy: ReturnType<typeof vi.spyOn>;
  let dataListenersBefore: number;
  let endListenersBefore: number;

  beforeEach(() => {
    dbPath = join(tmpdir(), `monograph-lsp-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = openDb(dbPath);

    // Capture stdout so the LSP server's responses don't pollute test output and
    // so we can assert on them.
    stdoutChunks = [];
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    }) as typeof process.stdout.write;

    // Stub process.exit so the 'end' / 'exit' handlers don't kill the test runner.
    originalExit = process.exit;
    (process as { exit: typeof process.exit }).exit = ((code?: number) => {
      throw new Error(`process.exit(${code}) called`);
    }) as typeof process.exit;

    removeStdinSpy = vi.spyOn(process.stdin, 'removeListener');

    dataListenersBefore = process.stdin.listenerCount('data');
    endListenersBefore = process.stdin.listenerCount('end');
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    (process as { exit: typeof process.exit }).exit = originalExit;
    removeStdinSpy.mockRestore();
    // Clean up any listeners this test added but didn't remove (defensive).
    process.stdin.removeAllListeners('data');
    process.stdin.removeAllListeners('end');
    try { closeDb(db); } catch { /* already closed */ }
    for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
      if (existsSync(p)) {
        try { unlinkSync(p); } catch { /* best effort */ }
      }
    }
  });

  function decodeResponses(): unknown[] {
    const text = stdoutChunks.join('');
    const out: unknown[] = [];
    let idx = 0;
    while (idx < text.length) {
      const headerEnd = text.indexOf('\r\n\r\n', idx);
      if (headerEnd === -1) break;
      const header = text.slice(idx, headerEnd);
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (!m) break;
      const len = parseInt(m[1], 10);
      const bodyStart = headerEnd + 4;
      out.push(JSON.parse(text.slice(bodyStart, bodyStart + len)));
      idx = bodyStart + len;
    }
    return out;
  }

  it('registers data + end listeners on stdin at start', () => {
    startLspServer(db, '/repo');
    expect(process.stdin.listenerCount('data')).toBe(dataListenersBefore + 1);
    expect(process.stdin.listenerCount('end')).toBe(endListenersBefore + 1);
  });

  it('closes DB after shutdown request; listeners removed on exit', () => {
    startLspServer(db, '/repo');

    const dataListenerCountAtStart = process.stdin.listenerCount('data');
    const endListenerCountAtStart = process.stdin.listenerCount('end');

    // Feed initialize then shutdown then exit (the canonical LSP teardown sequence).
    process.stdin.emit('data', encodeLspMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    process.stdin.emit('data', encodeLspMessage({ jsonrpc: '2.0', id: 2, method: 'shutdown' }));

    // MONO-7 regression fix: shutdown closes the DB handle (frees the native
    // better-sqlite3 file lock) but KEEPS listeners attached so the subsequent
    // 'exit' notification can still be parsed and reach its handler. Removing
    // listeners at shutdown made 'exit' unreachable for strict LSP clients.
    expect(process.stdin.listenerCount('data')).toBe(dataListenerCountAtStart);
    expect(process.stdin.listenerCount('end')).toBe(endListenerCountAtStart);

    // DB was closed — better-sqlite3 throws on queries against a closed handle.
    expect(() => db.prepare('SELECT 1')).toThrow();

    // Now send exit — listeners ARE removed here. process.exit is stubbed to
    // throw, so we wrap in try/catch to observe the post-exit state.
    try {
      process.stdin.emit('data', encodeLspMessage({ jsonrpc: '2.0', method: 'exit' }));
    } catch {
      /* expected — process.exit stub throws */
    }
    expect(process.stdin.listenerCount('data')).toBe(dataListenerCountAtStart - 1);
    expect(removeStdinSpy).toHaveBeenCalledWith('data', expect.any(Function));

    // Both initialize and shutdown responses were written (exit calls process.exit,
    // which the test runner stubs — no response body is expected for exit).
    const responses = decodeResponses();
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ jsonrpc: '2.0', id: 1 });
    expect(responses[1]).toMatchObject({ jsonrpc: '2.0', id: 2, result: null });
  });

  it('does not exit on shutdown (the exit notification or stdin EOF drives that)', () => {
    // The LSP spec says 'shutdown' should NOT exit — only 'exit' does.
    // We assert by NOT seeing the process.exit stub fire during shutdown.
    let exitCalled = false;
    (process as { exit: (code?: number) => never }).exit = (() => {
      exitCalled = true;
      throw new Error('should not exit on shutdown');
    }) as typeof process.exit;

    startLspServer(db, '/repo');
    expect(() => {
      process.stdin.emit('data', encodeLspMessage({ jsonrpc: '2.0', id: 1, method: 'shutdown' }));
    }).not.toThrow();
    expect(exitCalled).toBe(false);
  });

  it('idempotent: a second shutdown request does not double-close the DB', () => {
    startLspServer(db, '/repo');
    // Pipeline both shutdowns in a single 'data' chunk — the LSP framing loop
    // processes them sequentially inside onData, so the guard (`shutdownRequested`)
    // is the only thing preventing double closeDb (which throws on better-sqlite3).
    const chunk = Buffer.concat([
      encodeLspMessage({ jsonrpc: '2.0', id: 1, method: 'shutdown' }),
      encodeLspMessage({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
    ]);
    expect(() => {
      process.stdin.emit('data', chunk);
    }).not.toThrow();
    // DB is closed after the first shutdown.
    expect(() => db.prepare('SELECT 1')).toThrow();
  });
});
