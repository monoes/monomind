/**
 * `org serve` signal handling: SIGTERM/SIGINT must run the graceful stop
 * (the caller's `onGraceful` resolves serveAction's wait, which runs
 * `daemon.stopAll()`), not mark every org crashed and exit. A hard-exit timer
 * bounds a stop that hangs, and a second signal forces the exit.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgDaemon } from '../orgrt/daemon.js';
import { installServeShutdown } from '../orgrt/serve-shutdown.js';
import { ORG_DIR } from '../orgrt/types.js';

type Handler = () => void;

function setup(hardExitMs = 1000) {
  const handlers = new Map<string, Handler>();
  const proc = {
    on: vi.fn((sig: string, h: Handler) => {
      handlers.set(sig, h);
    }),
    exit: vi.fn(),
  };
  const daemon = { persistCrashStateAll: vi.fn(), clearHeartbeat: vi.fn() };
  const announce = vi.fn();
  const onGraceful = vi.fn();
  installServeShutdown({ proc, daemon, announce, onGraceful, hardExitMs });
  return { handlers, proc, daemon, announce, onGraceful };
}

describe('installServeShutdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['SIGTERM', 'SIGINT'])(
    '%s starts the graceful stop without marking orgs crashed',
    (sig) => {
      const t = setup();
      t.handlers.get(sig)!();
      expect(t.announce).toHaveBeenCalledWith(`received ${sig}`);
      expect(t.onGraceful).toHaveBeenCalledTimes(1);
      expect(t.daemon.persistCrashStateAll).not.toHaveBeenCalled();
      expect(t.proc.exit).not.toHaveBeenCalled();
    },
  );

  it('forces the exit with crash state if the graceful stop outlives the hard-exit timer', () => {
    const t = setup(1000);
    t.handlers.get('SIGTERM')!();
    vi.advanceTimersByTime(999);
    expect(t.proc.exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(t.daemon.persistCrashStateAll).toHaveBeenCalledTimes(1);
    expect(t.daemon.clearHeartbeat).toHaveBeenCalledTimes(1);
    expect(t.proc.exit).toHaveBeenCalledWith(1);
  });

  it('a second signal forces the exit at once and runs the graceful stop only once', () => {
    const t = setup();
    t.handlers.get('SIGINT')!();
    t.handlers.get('SIGINT')!();
    expect(t.onGraceful).toHaveBeenCalledTimes(1);
    expect(t.daemon.persistCrashStateAll).toHaveBeenCalledTimes(1);
    expect(t.proc.exit).toHaveBeenCalledWith(1);
    vi.advanceTimersByTime(5000);
    expect(t.proc.exit).toHaveBeenCalledTimes(1); // the hard-exit timer was cancelled
  });

  it('SIGHUP keeps the immediate crash-and-exit behaviour', () => {
    const t = setup();
    t.handlers.get('SIGHUP')!();
    expect(t.onGraceful).not.toHaveBeenCalled();
    expect(t.daemon.persistCrashStateAll).toHaveBeenCalledTimes(1);
    expect(t.proc.exit).toHaveBeenCalledWith(1);
  });

  it('finish() clears the hard-exit timer and exits 0', () => {
    const handlers = new Map<string, Handler>();
    const proc = { on: (s: string, h: Handler) => void handlers.set(s, h), exit: vi.fn() };
    const daemon = { persistCrashStateAll: vi.fn(), clearHeartbeat: vi.fn() };
    const { finish } = installServeShutdown({
      proc,
      daemon,
      announce: vi.fn(),
      onGraceful: vi.fn(),
      hardExitMs: 1000,
    });
    handlers.get('SIGTERM')!();
    finish();
    expect(proc.exit).toHaveBeenCalledWith(0);
    vi.advanceTimersByTime(5000);
    expect(daemon.persistCrashStateAll).not.toHaveBeenCalled();
    expect(proc.exit).toHaveBeenCalledTimes(1);
  });
});

describe('serve shutdown against a real daemon', () => {
  let root: string;
  let daemon: OrgDaemon;
  const echoQuery = ({ prompt }: { prompt: AsyncIterable<{ message: { content: string } }> }) =>
    (async function* () {
      for await (const m of prompt) {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] },
        };
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      }
    })();
  const runtimeStatus = () =>
    JSON.parse(readFileSync(join(root, ORG_DIR, 'alpha', 'runtime.json'), 'utf8')).status;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'org-serve-shutdown-'));
    mkdirSync(join(root, ORG_DIR), { recursive: true });
    writeFileSync(
      join(root, ORG_DIR, 'alpha.json'),
      JSON.stringify({
        name: 'alpha',
        goal: 'g',
        roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }],
      }),
    );
    daemon = new OrgDaemon(root, { queryFn: echoQuery as never, forward: false });
    await daemon.startOrg('alpha');
  });
  afterEach(async () => {
    await daemon.stopAll();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('a clean SIGTERM leaves the org stopped, not crashed', async () => {
    const handlers = new Map<string, Handler>();
    const proc = { on: (s: string, h: Handler) => void handlers.set(s, h), exit: vi.fn() };
    let done!: () => void;
    const stopped = new Promise<void>((r) => (done = r));
    const shutdown = installServeShutdown({
      proc,
      daemon,
      announce: vi.fn(),
      onGraceful: () => void daemon.stopAll().then(() => (shutdown.finish(), done())),
      hardExitMs: 30_000,
    });
    expect(runtimeStatus()).toBe('running');

    handlers.get('SIGTERM')!();
    await stopped;

    expect(runtimeStatus()).toBe('stopped');
    expect(proc.exit).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it('a forced exit marks the still-running org crashed', () => {
    const handlers = new Map<string, Handler>();
    const proc = { on: (s: string, h: Handler) => void handlers.set(s, h), exit: vi.fn() };
    installServeShutdown({
      proc,
      daemon,
      announce: vi.fn(),
      onGraceful: vi.fn(),
      hardExitMs: 30_000,
    });

    handlers.get('SIGTERM')!();
    handlers.get('SIGTERM')!();

    expect(runtimeStatus()).toBe('crashed');
    expect(proc.exit).toHaveBeenCalledWith(1);
  });
});
