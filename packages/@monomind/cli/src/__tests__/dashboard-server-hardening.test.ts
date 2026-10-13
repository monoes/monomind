/**
 * Dashboard server hardening (review fixes): request-handler error containment,
 * mastermind-event body validation, org JSONL tailing, authenticated internal
 * replays, ?dir= validation, pricing, SSE keepalive and the browse dashboard's
 * body cap / WebSocket origin check.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _getGitMonomindDir,
  isPathInside,
  resolveAllowedProjectDir,
} from '../ui/server-fileutils.mjs';

// The seams the real-server tests below use: the route dispatcher (to make a route throw) and
// the lifecycle setup (to observe what is registered by the time it runs). Both delegate to the
// real module unless a test sets the hook.
const mocks = vi.hoisted(() => ({
  // resolves 'next' to fall through to the real dispatcher
  dispatch: null as null | ((...a: any[]) => any),
  onLifecycle: null as null | (() => void),
}));
vi.mock('../ui/server-dispatch.mjs', async (orig) => {
  const actual = await orig<typeof import('../ui/server-dispatch.mjs')>();
  return {
    ...actual,
    dispatchRequest: async (...a: Parameters<typeof actual.dispatchRequest>) =>
      (await mocks.dispatch?.(...a)) === 'next' || !mocks.dispatch
        ? actual.dispatchRequest(...a)
        : true,
  };
});
vi.mock('../ui/server-lifecycle.mjs', async (orig) => {
  const actual = await orig<typeof import('../ui/server-lifecycle.mjs')>();
  return {
    ...actual,
    setupServerLifecycle: (...a: Parameters<typeof actual.setupServerLifecycle>) => {
      mocks.onLifecycle?.();
      return actual.setupServerLifecycle(...a);
    },
  };
});

const tmp = (p: string) => mkdtempSync(join(process.env.TMPDIR || tmpdir(), p));

describe('resolveAllowedProjectDir / isPathInside', () => {
  let root: string;
  beforeEach(() => {
    root = tmp('dash-dir-');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('defaults to the server project and accepts it explicitly', () => {
    expect(resolveAllowedProjectDir(null, root)).toBe(root);
    expect(resolveAllowedProjectDir(root, root)).toBe(root);
  });

  it('rejects an unknown dir and accepts one from known-projects.json', () => {
    const other = tmp('dash-other-');
    try {
      expect(resolveAllowedProjectDir(other, root)).toBeNull();
      mkdirSync(join(root, 'data'), { recursive: true });
      writeFileSync(join(root, 'data', 'known-projects.json'), JSON.stringify([other]));
      expect(resolveAllowedProjectDir(other, root)).toBe(other);
      expect(resolveAllowedProjectDir('/etc', root)).toBeNull();
      expect(resolveAllowedProjectDir(`${other}\0x`, root)).toBeNull();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('isPathInside blocks traversal and sibling-prefix paths', () => {
    expect(isPathInside('/a/b', '/a/b/c.txt')).toBe(true);
    expect(isPathInside('/a/b', '/a/b/../c')).toBe(false);
    expect(isPathInside('/a/b', '/a/bc/x')).toBe(false);
    expect(isPathInside('/a/b', '/etc/passwd')).toBe(false);
  });

  it('_getGitMonomindDir does not cache the fallback', () => {
    expect(_getGitMonomindDir(root)).toBe(join(root, '.monomind'));
    mkdirSync(join(root, '.git'));
    expect(_getGitMonomindDir(root)).toBe(join(root, '.git', 'monomind'));
  });
});

describe('pricing', () => {
  it('returns null for unpriced models and prefers the longest matching key', async () => {
    const { _sjCalcCost, _sjHasPricing } = await import('../ui/server.mjs');
    const usage = { input_tokens: 1_000_000 };
    expect(_sjCalcCost('totally-unknown-model', usage)).toBeNull();
    expect(_sjHasPricing('totally-unknown-model')).toBe(false);
    expect(_sjCalcCost('claude-sonnet-5', usage)).toBeCloseTo(2, 6);
    // gpt-4o-mini must not resolve to the pricier gpt-4o row
    expect(_sjCalcCost('gpt-4o-mini-2024', usage)).toBeCloseTo(0.15, 6);
  });
});

describe('server.mjs request containment and process wiring (real server)', () => {
  let dir: string;
  let started: Array<{ server: http.Server }> = [];
  const token = () => readFileSync(join(dir, '.monomind', 'dashboard-token'), 'utf-8').trim();
  const get = (port: number, path: string) =>
    fetch(`http://127.0.0.1:${port}${path}`, { headers: { 'x-monomind-token': token() } });

  async function start() {
    const { startServer } = await import('../ui/server.mjs');
    const res = await startServer({
      port: 0,
      projectDir: dir,
      projectDirExplicit: true,
      openBrowser: false,
    });
    started.push(res);
    return res as { port: number; server: http.Server };
  }

  beforeEach(() => {
    dir = tmp('dash-srv-');
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    mocks.dispatch = null;
    mocks.onLifecycle = null;
    for (const s of started) {
      s.server?.closeAllConnections?.();
      s.server?.close();
    }
    started = [];
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers 500 when a route throws before writing, and keeps serving', async () => {
    mocks.dispatch = async (_req: http.IncomingMessage, _res: http.ServerResponse, url: string) => {
      if (url === '/boom') throw new Error('route exploded');
      return 'next';
    };
    const { port } = await start();
    const r = await get(port, '/boom');
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'Internal server error' });
    expect((await get(port, '/api/identity')).status).toBe(200);
  }, 30_000);

  it('tears the connection down when a route throws after headers went out, and keeps serving', async () => {
    mocks.dispatch = async (_req: http.IncomingMessage, res: http.ServerResponse, url: string) => {
      if (url !== '/half') return 'next';
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('partial');
      throw new Error('route exploded mid-stream');
    };
    const { port } = await start();
    const outcome = await get(port, '/half').then(
      (r) =>
        r.text().then(
          () => 'complete',
          () => 'aborted',
        ),
      () => 'aborted',
    );
    expect(outcome).toBe('aborted'); // not a second writeHead / a clean-looking 200
    expect((await get(port, '/api/identity')).status).toBe(200);
  }, 30_000);

  it('logs rejections instead of dying, registers that handler once and no uncaughtException one', async () => {
    const uncaught = process.listenerCount('uncaughtException');
    await start();
    const afterFirst = process.listenerCount('unhandledRejection');
    await start();
    expect(process.listenerCount('unhandledRejection')).toBe(afterFirst);
    expect(process.listenerCount('uncaughtException')).toBe(uncaught); // swallowing it would leave unknown state
  }, 30_000);

  it('registers its signal handlers right after bind, before the lifecycle setup runs', async () => {
    const before = process.listenerCount('SIGTERM');
    let atLifecycle = -1;
    mocks.onLifecycle = () => {
      atLifecycle = process.listenerCount('SIGTERM');
    };
    await start();
    expect(atLifecycle).toBe(before + 1);
  }, 30_000);

  it('treats a running record with a non-numeric pid as not active, and a live pid as active', async () => {
    const { activeOrgRuns } = await import('../ui/server-rundb.mjs');
    const orgs = join(dir, '.monomind', 'orgs');
    for (const [org, rt] of Object.entries({
      'hb-nopid': { run: 'r1', status: 'running' },
      'hb-strpid': { run: 'r2', status: 'running', pid: String(process.pid) },
      'hb-live': { run: 'r3', status: 'running', pid: process.pid },
      'hb-done': { run: 'r4', status: 'done', pid: process.pid },
    })) {
      mkdirSync(join(orgs, org), { recursive: true });
      writeFileSync(join(orgs, org, 'runtime.json'), JSON.stringify(rt));
    }
    await start();
    try {
      expect(activeOrgRuns.has('hb-nopid')).toBe(false);
      expect(activeOrgRuns.has('hb-strpid')).toBe(false);
      expect(activeOrgRuns.has('hb-done')).toBe(false);
      expect(activeOrgRuns.get('hb-live')).toBe('r3');
    } finally {
      for (const o of ['hb-nopid', 'hb-strpid', 'hb-live', 'hb-done']) activeOrgRuns.delete(o);
    }
  }, 30_000);
});

describe('POST /api/mastermind/event body handling', () => {
  async function run(chunks: Array<string | Error>) {
    const { createHandleMastermindEvent } = await import(
      '../ui/server-mastermind-event.mjs' as string
    );
    const dir = tmp('dash-ev-');
    const handler = createHandleMastermindEvent({ projectDir: dir, MONOMIND_HOME: dir });
    async function* gen() {
      for (const c of chunks) {
        if (c instanceof Error) throw c;
        yield c;
      }
    }
    const req = Object.assign(gen(), { destroy: vi.fn() });
    const res = { writeHead: vi.fn(), end: vi.fn() };
    await handler(req, res, undefined);
    rmSync(dir, { recursive: true, force: true });
    return res;
  }

  it.each(['null', '[1,2]', '"str"', '42'])('rejects non-object JSON %s with 400', async (body) => {
    const res = await run([body]);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything());
  });

  it('does not throw when the client aborts mid-body', async () => {
    const res = await run(['{"type":', new Error('aborted')]);
    expect(res.writeHead).not.toHaveBeenCalled();
  });
});

describe('_readNewOrgLines', () => {
  let dir: string;
  let file: string;
  const received: string[] = [];
  beforeEach(async () => {
    dir = tmp('dash-org-');
    file = join(dir, 'run1.jsonl');
    received.length = 0;
    const { runStreamClients } = await import('../ui/server-rundb.mjs');
    runStreamClients.set('o1', new Set([{ write: (m: string) => received.push(m) }]));
  });
  afterEach(async () => {
    const { runStreamClients } = await import('../ui/server-rundb.mjs');
    runStreamClients.delete('o1');
    rmSync(dir, { recursive: true, force: true });
  });
  const lines = () => received.map((m) => JSON.parse(m.replace(/^data: /, '')).type);

  it('holds back a partial trailing line until it is completed', async () => {
    const { _readNewOrgLines } = await import('../ui/server-lifecycle.mjs' as string);
    writeFileSync(file, '{"type":"a:one"}\n{"type":"a:t');
    _readNewOrgLines(file, 'o1', 'run1');
    expect(lines()).toEqual(['a:one']);
    writeFileSync(file, '{"type":"a:one"}\n{"type":"a:two"}\n');
    _readNewOrgLines(file, 'o1', 'run1');
    expect(lines()).toEqual(['a:one', 'a:two']);
  });

  it('restarts from 0 when the file shrinks', async () => {
    const { _readNewOrgLines } = await import('../ui/server-lifecycle.mjs' as string);
    writeFileSync(file, '{"type":"a:one"}\n{"type":"a:two"}\n');
    _readNewOrgLines(file, 'o1', 'run1');
    writeFileSync(file, '{"type":"a:new"}\n');
    _readNewOrgLines(file, 'o1', 'run1');
    expect(lines()).toEqual(['a:one', 'a:two', 'a:new']);
  });
});

describe('background replays carry the dashboard token', () => {
  let home: string;
  let srv: http.Server;
  let status = 200;
  const seen: Array<{ auth?: string | string[]; body: string }> = [];
  let port = 0;
  let stop: (() => void) | undefined;

  beforeEach(async () => {
    home = tmp('dash-spool-');
    seen.length = 0;
    status = 200;
    srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ auth: req.headers['x-monomind-token'], body });
        res.writeHead(status);
        res.end();
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    port = (srv.address() as { port: number }).port;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    stop?.();
    vi.useRealTimers();
    srv.close();
    rmSync(home, { recursive: true, force: true });
  });

  async function start() {
    const { setupServerLifecycle } = await import('../ui/server-lifecycle.mjs' as string);
    ({ stopBackgroundTasks: stop } = setupServerLifecycle({
      projectDir: home,
      MONOMIND_HOME: home,
      boundPort: port,
      dashboardAuthValue: 'tok-123',
    }));
  }
  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
  };

  it('spool replay sends x-monomind-token and deletes after 2xx', async () => {
    const spool = join(home, '.monomind', 'capture', 'spool');
    mkdirSync(spool, { recursive: true });
    const f = join(spool, '1-a.json');
    writeFileSync(f, JSON.stringify({ type: 'agent:read' }));
    await start();
    vi.advanceTimersByTime(5000);
    await waitFor(() => !existsSync(f));
    expect(seen[0]?.auth).toBe('tok-123');
    expect(existsSync(f)).toBe(false);
  });

  it('keeps a spool file on 5xx and drops it on a permanent 4xx', async () => {
    const spool = join(home, '.monomind', 'capture', 'spool');
    mkdirSync(spool, { recursive: true });
    const f = join(spool, '1-a.json');
    writeFileSync(f, JSON.stringify({ type: 'agent:read' }));
    status = 500;
    await start();
    vi.advanceTimersByTime(5000);
    await waitFor(() => seen.length > 0);
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(f)).toBe(true);
    status = 400;
    vi.advanceTimersByTime(5000);
    await waitFor(() => !existsSync(f));
    expect(existsSync(f)).toBe(false);
  });

  it('read-batch is unlinked only after a 2xx', async () => {
    const cap = join(home, '.monomind', 'capture');
    mkdirSync(cap, { recursive: true });
    const f = join(cap, 'read-batch-1-2.json');
    writeFileSync(f, JSON.stringify([{ org: 'o', runId: 'r', path: '/x' }]));
    status = 503;
    await start();
    vi.advanceTimersByTime(3000);
    await waitFor(() => seen.length > 0);
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(f)).toBe(true);
    expect(seen[0]?.auth).toBe('tok-123');
    status = 200;
    vi.advanceTimersByTime(3000);
    await waitFor(() => !existsSync(f));
    expect(existsSync(f)).toBe(false);
  });
});

describe('SSE keepalive', () => {
  it('pings connected clients every 25s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const sse = await import('../ui/sse-manager.mjs' as string);
      const writes: string[] = [];
      const client = { write: (m: string) => writes.push(m), writableLength: 0 };
      sse.addSseClient(client);
      vi.advanceTimersByTime(sse.SSE_KEEPALIVE_MS);
      expect(writes).toContain(': ping\n\n');
      sse.removeSseClient(client);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /api/loops/stop id validation', () => {
  it('rejects ids that are not loop-<word> before touching the filesystem', async () => {
    const { handleRoutesLoops } = await import('../ui/server-routes-loops.mjs' as string);
    const dir = tmp('dash-loop-');
    try {
      for (const id of ['../../evil', 'x', 42, 'loop-../a']) {
        const req = Object.assign(Readable.from([JSON.stringify({ id })]), {
          method: 'POST',
          url: '/api/loops/stop',
        });
        const res = { writeHead: vi.fn(), end: vi.fn() };
        await handleRoutesLoops(req, res, '/api/loops/stop', undefined, { projectDir: dir });
        await new Promise((r) => setTimeout(r, 20));
        expect(res.writeHead).toHaveBeenCalledWith(400);
      }
      expect(existsSync(join(dir, '.monomind', 'loops'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('browse dashboard server', () => {
  it('caps the event body at 64KB with 413 and refuses cross-origin WebSockets', async () => {
    const { getDashboardServer } = await import('../browser/dashboard/server.js');
    const server = getDashboardServer(0);
    await new Promise((r) => setTimeout(r, 20));
    const addr = server.address();
    if (!addr) throw new Error('not bound');
    const base = `http://127.0.0.1:${addr.port}`;
    try {
      const res = await fetch(`${base}/api/mastermind/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pad: 'x'.repeat(70 * 1024) }),
      });
      expect(res.status).toBe(413);

      const { default: WebSocket } = await import('ws');
      const bad = new WebSocket(`${base.replace('http', 'ws')}/`, {
        origin: 'http://evil.example.com',
      });
      const outcome = await new Promise<string>((resolve) => {
        bad.once('open', () => resolve('open'));
        bad.once('error', () => resolve('rejected'));
      });
      expect(outcome).toBe('rejected');
      const good = new WebSocket(`${base.replace('http', 'ws')}/`);
      await new Promise((resolve, reject) => {
        good.once('open', resolve);
        good.once('error', reject);
      });
      good.close();
    } finally {
      server.close();
    }
  });
});
