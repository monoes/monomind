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
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const homeState = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homeState.dir };
});

const confirmMock = vi.hoisted(() => vi.fn());
vi.mock('../prompt.js', () => ({ confirm: (...args: unknown[]) => confirmMock(...args) }));

// Standing in for `gh`: always fails, so any call proves a real network/auth
// attempt was made — this test suite must never actually reach that point.
const execFileMock = vi.hoisted(() =>
  vi.fn((_cmd: unknown, _args: unknown, optsOrCb: unknown, cb?: unknown) => {
    const callback = (typeof optsOrCb === 'function' ? optsOrCb : cb) as
      | ((err: Error) => void)
      | undefined;
    callback?.(new Error('gh must never be invoked from this test'));
  }),
);
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
  execFileMock.mockClear();
  confirmMock.mockReset();
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

  it('bounds the prompt itself so an unanswered readline cannot hang reportCrash forever', async () => {
    setTty(true);
    vi.useFakeTimers();
    try {
      confirmMock.mockImplementation(() => new Promise(() => {})); // never resolves
      const { reportCrash } = await loadModule();
      const pending = reportCrash({ repo: 'monoes/monomind', title: 'crash: boom', body: 'stack' });
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;
      expect(result.status).toBe('saved-locally');
    } finally {
      vi.useRealTimers();
    }
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
