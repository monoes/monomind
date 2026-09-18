/**
 * i-055-cli — the crash reporter filed a public GitHub issue on every crash
 * with zero consent step of any kind (no isTTY/prompt/consent logic existed
 * at all — `rg -n "isTTY|prompt|consent|readline" crash-reporter.ts` returned
 * nothing on main). This covers the fix: a tri-state consent
 * ('enabled' | 'disabled' | 'unanswered') that defaults an absent config to
 * 'unanswered' instead of 'enabled', prompts once on an interactive crash
 * (showing the local report path before asking, defaulting to No), and never
 * prompts or files for a non-interactive crash — it only ever saves locally,
 * permanently, since most monomind runs (agents, CI) are non-interactive.
 *
 * `execFile` is mocked at the module boundary so this can never shell out to
 * a real `gh` — every path here must resolve without any process spawn.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const homeState = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homeState.dir };
});

// Tracks every real writeFileSync call (delegating to the actual
// implementation — nothing here is faked) so review findings 6/7 can assert
// exactly how many local .md report writes happened. Counting files on disk
// afterward instead would be flaky: saveLocally() names files by
// `Date.now()`, and two saves of the identical title in the same
// millisecond (routine when `gh` fails synchronously with no real I/O
// delay between calls, as these tests simulate) collide and silently
// collapse into one file, hiding a genuine double-write.
const writeFileCalls = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      writeFileCalls.paths.push(String(args[0]));
      return actual.writeFileSync(...args);
    },
  };
});

function mdWriteCount(): number {
  return writeFileCalls.paths.filter((p) => p.endsWith('.md')).length;
}

const confirmMock = vi.hoisted(() => vi.fn());
vi.mock('../prompt.js', () => ({ confirm: (...args: unknown[]) => confirmMock(...args) }));

type ExecFileCallback = (err: Error | null, result?: { stdout: string; stderr: string }) => void;

// Standing in for `gh`. Default: always fails, so any call in a test that
// doesn't override this proves a real network/auth attempt was made — most
// of this suite must never reach that point at all. A couple of tests
// further down (review finding 6) need `gh` to succeed/fail in specific,
// still entirely mocked, ways; they override this per-test and beforeEach
// restores the always-fail default afterward via mockReset.
function defaultExecFileImpl(
  _cmd: unknown,
  _args: unknown,
  optsOrCb: unknown,
  cb?: ExecFileCallback,
): void {
  const callback = (typeof optsOrCb === 'function' ? optsOrCb : cb) as ExecFileCallback | undefined;
  callback?.(new Error('gh must never be invoked from this test'));
}

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: execFileMock };
});

let tmpHome = '';
let savedStdinTTY: boolean | undefined;
let savedStdoutTTY: boolean | undefined;

function setTty(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
}

async function loadModule() {
  return import('../services/crash-reporter.js');
}

beforeEach(() => {
  vi.resetModules();
  execFileMock.mockReset();
  execFileMock.mockImplementation(defaultExecFileImpl);
  confirmMock.mockReset();
  writeFileCalls.paths.length = 0;
  tmpHome = mkdtempSync(join(tmpdir(), 'i-055-cli-consent-'));
  homeState.dir = tmpHome;
  savedStdinTTY = process.stdin.isTTY;
  savedStdoutTTY = process.stdout.isTTY;
  delete process.env.MONOMIND_CRASH_REPORTING;
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  Object.defineProperty(process.stdin, 'isTTY', { value: savedStdinTTY, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: savedStdoutTTY, configurable: true });
  delete process.env.MONOMIND_CRASH_REPORTING;
});

describe('getConsentState() — tri-state, not a boolean default', () => {
  it('T6: an absent config file is unanswered, not enabled', async () => {
    const { getConsentState } = await loadModule();
    expect(getConsentState()).toBe('unanswered');
  });

  it('T5: MONOMIND_CRASH_REPORTING=off short-circuits before prompt and before gh, env checked before the config file', async () => {
    process.env.MONOMIND_CRASH_REPORTING = 'off';
    setTty(true);
    const { reportCrash } = await loadModule();
    const result = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: boom',
      body: 'stack',
    });
    expect(result.status).toBe('disabled');
    expect(confirmMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
    // No config file gets written just from an env-forced disable.
    expect(existsSync(join(tmpHome, '.monomind', 'crash-reporting.json'))).toBe(false);
  });
});

describe('reportCrash() — non-TTY is local-save-only, permanently', () => {
  it('T1: non-TTY crash saves locally and never invokes gh, never prompts', async () => {
    setTty(false);
    const { reportCrash } = await loadModule();
    const result = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: boom',
      body: 'stack trace',
    });
    expect(result.status).toBe('saved-locally');
    expect(result.path).toBeTruthy();
    expect(existsSync(result.path as string)).toBe(true);
    expect(result.message).toContain(result.path as string);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('a non-TTY crash never persists a decision — stays unanswered for a later interactive run', async () => {
    setTty(false);
    const { reportCrash, getConsentState } = await loadModule();
    await reportCrash({ repo: 'monoes/monomind', title: 'crash: boom', body: 'stack' });
    expect(getConsentState()).toBe('unanswered');
  });
});

describe('reportCrash() — TTY prompts once, shows the path first, defaults to No', () => {
  it('T2: TTY crash prompts with the report path and defaults to No; empty input files nothing', async () => {
    setTty(true);
    // Empty input in a real terminal resolves confirm()'s own default.
    confirmMock.mockImplementation(async (opts: { default?: boolean }) => opts.default ?? false);
    const { reportCrash } = await loadModule();
    const result = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: boom',
      body: 'stack',
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    const promptArg = confirmMock.mock.calls[0][0] as { message: string; default?: boolean };
    expect(promptArg.default).toBe(false);
    expect(promptArg.message).toMatch(/\[y\/N\]/);
    expect(promptArg.message).toMatch(/public/i);
    expect(result.path).toBeTruthy();
    expect(promptArg.message).toContain(result.path as string);

    // Default (empty input) answered No -> nothing filed, nothing shelled out.
    expect(result.status).toBe('saved-locally');
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('T3: answering No persists the choice and prints the verbatim opt-out command', async () => {
    setTty(true);
    confirmMock.mockResolvedValue(false);
    const { reportCrash, getConsentState } = await loadModule();
    const result = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: boom',
      body: 'stack',
    });
    expect(getConsentState()).toBe('disabled');
    expect(result.message).toContain('monomind crash-reporting disable');
  });

  it('T4a: two crashes answered No prompt exactly once (second sees disabled, short-circuits)', async () => {
    setTty(true);
    confirmMock.mockResolvedValue(false);
    const { reportCrash } = await loadModule();
    const first = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: one',
      body: 'stack',
    });
    const second = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: two',
      body: 'stack',
    });
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(first.status).toBe('saved-locally');
    expect(second.status).toBe('disabled');
  });

  it('T4b: two crashes answered Yes prompt exactly once (second sees enabled, skips straight to filing)', async () => {
    setTty(true);
    confirmMock.mockResolvedValue(true);
    const { reportCrash, getConsentState } = await loadModule();
    await reportCrash({ repo: 'monoes/monomind', title: 'crash: one', body: 'stack' });
    expect(getConsentState()).toBe('enabled');
    await reportCrash({ repo: 'monoes/monomind', title: 'crash: two', body: 'stack' });
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('bounds the prompt at ~15s, not far less, so an unanswered readline cannot hang reportCrash forever', async () => {
    setTty(true);
    vi.useFakeTimers();
    try {
      confirmMock.mockImplementation(() => new Promise(() => {})); // never resolves
      const { reportCrash } = await loadModule();
      let settled = false;
      const pending = reportCrash({
        repo: 'monoes/monomind',
        title: 'crash: boom',
        body: 'stack',
      }).then((result) => {
        settled = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(14_900);
      expect(
        settled,
        'resolved before the 15s bound — advancing 15s would also pass a much tighter bound than intended',
      ).toBe(false);

      await vi.advanceTimersByTimeAsync(200);
      const result = await pending;
      expect(settled).toBe(true);
      expect(result.status).toBe('saved-locally');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('reportCrash() — the pre-prompt local save is reused, not duplicated (review finding 6)', () => {
  function pendingReportFiles(): string[] {
    const dir = join(tmpHome, '.monomind', 'pending-reports');
    return existsSync(dir) ? readdirSync(dir) : [];
  }

  it('answering Yes and successfully filing removes the pre-prompt local copy instead of orphaning it', async () => {
    setTty(true);
    confirmMock.mockResolvedValue(true);
    execFileMock.mockImplementation(
      (_cmd: unknown, args: unknown, optsOrCb: unknown, cb?: ExecFileCallback) => {
        const callback = (typeof optsOrCb === 'function' ? optsOrCb : cb) as
          | ExecFileCallback
          | undefined;
        const argv = args as string[];
        if (argv[0] === 'auth') return callback?.(null, { stdout: '', stderr: '' });
        if (argv[0] === 'issue' && argv[1] === 'list')
          return callback?.(null, { stdout: '[]', stderr: '' });
        if (argv[0] === 'issue' && argv[1] === 'create')
          return callback?.(null, {
            stdout: 'https://github.com/monoes/monomind/issues/1\n',
            stderr: '',
          });
        callback?.(new Error(`unexpected gh call in this test: ${JSON.stringify(argv)}`));
      },
    );
    const { reportCrash } = await loadModule();

    const result = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: boom',
      body: 'stack',
    });

    expect(result.status).toBe('created');
    // Exactly one local write ever happened (the pre-prompt save before
    // asking), and the file it produced is gone now that the issue was
    // actually filed — otherwise it sits in pending-reports/ forever even
    // though it's on GitHub already.
    expect(mdWriteCount()).toBe(1);
    expect(pendingReportFiles()).toHaveLength(0);
  });

  it('answering Yes and failing to file reuses the pre-prompt file instead of writing a second one', async () => {
    setTty(true);
    confirmMock.mockResolvedValue(true);
    execFileMock.mockImplementation(
      (_cmd: unknown, _args: unknown, optsOrCb: unknown, cb?: ExecFileCallback) => {
        const callback = (typeof optsOrCb === 'function' ? optsOrCb : cb) as
          | ExecFileCallback
          | undefined;
        callback?.(new Error('simulated network failure'));
      },
    );
    const { reportCrash } = await loadModule();

    const result = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: boom',
      body: 'stack',
    });

    expect(result.status).toBe('saved-locally');
    // Exactly one local write: the pre-prompt save, reused — not a second
    // one from the failure-fallback branch. Counting the actual write calls
    // rather than files on disk: saveLocally() names files by `Date.now()`,
    // and two saves of this identical title can land in the same
    // millisecond with nothing here to introduce real delay between them,
    // which would silently collapse a genuine double-write into one file.
    expect(mdWriteCount()).toBe(1);
    expect(existsSync(result.path as string)).toBe(true);
  });
});

describe('reportCrash() — non-TTY unanswered path is deduped, not unbounded (review finding 7)', () => {
  it('repeating the same signature while unanswered + non-interactive reuses one file instead of piling up a new one per crash', async () => {
    setTty(false);
    const { reportCrash } = await loadModule();

    const first = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: loop',
      body: 'stack',
      signature: 'crash-loop-signature',
    });
    const second = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: loop',
      body: 'stack',
      signature: 'crash-loop-signature',
    });
    const third = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: loop',
      body: 'stack',
      signature: 'crash-loop-signature',
    });

    expect(first.status).toBe('saved-locally');
    expect(second.status).toBe('saved-locally');
    expect(third.status).toBe('saved-locally');
    expect(second.path).toBe(first.path);
    expect(third.path).toBe(first.path);

    // One write, not three — counting actual write calls rather than files
    // on disk avoids the same Date.now() filename-collision flakiness noted
    // above (all three calls here share one title/signature, so on
    // unfixed code they'd race to collide on the exact same risk).
    expect(mdWriteCount()).toBe(1);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('a different signature while unanswered + non-interactive still gets its own file', async () => {
    setTty(false);
    const { reportCrash } = await loadModule();

    const a = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: a',
      body: 'stack',
      signature: 'signature-a',
    });
    const b = await reportCrash({
      repo: 'monoes/monomind',
      title: 'crash: b',
      body: 'stack',
      signature: 'signature-b',
    });

    expect(a.path).not.toBe(b.path);
    expect(mdWriteCount()).toBe(2);
  });
});

describe('checkCrashReporting() — doctor surfacing (i-055 owns this module, not doctor.ts)', () => {
  it('T7: reports on / off / unanswered, each with the exact change command', async () => {
    const { checkCrashReporting } = await import('../commands/doctor-env-checks.js');

    const unanswered = await checkCrashReporting();
    expect(unanswered.message).toContain('monomind crash-reporting');
    expect(unanswered.message.toLowerCase()).toContain('unanswered');

    const { setEnabled } = await loadModule();
    setEnabled(true);
    const enabled = await checkCrashReporting();
    expect(enabled.message).toContain('monomind crash-reporting');
    expect(enabled.message.toLowerCase()).toContain('enabled');

    setEnabled(false);
    const disabled = await checkCrashReporting();
    expect(disabled.message).toContain('monomind crash-reporting');
    expect(disabled.message.toLowerCase()).toContain('disabled');

    expect(new Set([unanswered.message, enabled.message, disabled.message]).size).toBe(3);
  });
});
