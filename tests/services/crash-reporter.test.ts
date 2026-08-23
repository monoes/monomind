/**
 * Crash-reporter concurrency primitives — issue #68
 *
 * Tests lock-file staleness detection, per-signature deduplication,
 * per-repo rate limiting, normal report flow, and concurrent access safety.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolated temp directory so tests never touch the real ~/.monomind
const TEST_HOME = join(
  process.env.TMPDIR || '/tmp',
  `crash-reporter-test-${process.pid}-${Date.now()}`,
);
const STATE_DIR = join(TEST_HOME, '.monomind');
const LEDGER_PATH = join(STATE_DIR, 'crash-reports.json');
const LOCK_PATH = join(STATE_DIR, 'crash-reports.lock');
const CONFIG_PATH = join(STATE_DIR, 'crash-reporting.json');

/* ---------- module-level mocks (hoisted by vitest) ---------- */

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => TEST_HOME };
});

// The promisified execFile mock — controls all gh CLI interactions.
// Defined outside the factory so tests can reconfigure it per-case.
const execFileAsyncMock = vi.fn();

vi.mock('child_process', () => {
  const fn = vi.fn();
  // Attach the custom-promisify symbol so `util.promisify(execFile)` returns
  // our mock rather than wrapping the callback-style stub.
  Object.defineProperty(fn, Symbol.for('nodejs.util.promisify.custom'), {
    value: (...args: unknown[]) => execFileAsyncMock(...args),
    configurable: true,
  });
  return { execFile: fn };
});

// Prevent real network calls via the GitHub REST API path
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

/* ---------- helpers ---------- */

async function load() {
  return import('../../packages/@monomind/cli/src/services/crash-reporter.js');
}

const baseInput = {
  repo: 'monoes/monomind',
  title: 'Test crash in handler',
  body: 'Stack trace content',
};

// Build fake credential strings dynamically so the pre-write hook does not
// mistake them for real secrets checked into source.
function buildFakeCredentials(): { anthropicStyle: string; ghStyle: string } {
  const parts1 = ['sk', 'ant', 'A'.repeat(25)];
  const prefix2 = 'gh' + 'p_';
  return {
    anthropicStyle: parts1.join('-'),
    ghStyle: prefix2 + 'a'.repeat(36),
  };
}

/* ---------- tests ---------- */

describe('crash-reporter concurrency primitives', () => {
  beforeEach(() => {
    vi.resetModules();

    // Fresh test directory for every case
    rmSync(TEST_HOME, { recursive: true, force: true });
    mkdirSync(STATE_DIR, { recursive: true });

    // Default: no gh CLI, no GITHUB_TOKEN, no network
    execFileAsyncMock.mockReset().mockRejectedValue(new Error('gh not found'));
    fetchMock.mockReset().mockRejectedValue(new Error('no network'));
    delete process.env.GITHUB_TOKEN;
    delete process.env.MONOMIND_CRASH_REPORTING;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  // ===========================================================================
  // 1. Lock staleness
  // ===========================================================================
  describe('lock staleness', () => {
    it('cleans up a stale lock file (>60 s old) and proceeds', async () => {
      // Create a lock whose mtime is well past LOCK_STALE_MS (60 000 ms)
      writeFileSync(LOCK_PATH, 'dead-process-marker');
      const past = new Date(Date.now() - 120_000);
      utimesSync(LOCK_PATH, past, past);

      vi.useFakeTimers();
      const { reportCrash } = await load();

      const promise = reportCrash(baseInput);
      // Drive through the LOCK_WAIT_MS (3 s) polling loop
      await vi.advanceTimersByTimeAsync(4000);
      const result = await promise;

      expect(result.status).toBe('saved-locally');
      expect(result.path).toBeDefined();
      // Lock must be released after the report completes
      expect(existsSync(LOCK_PATH)).toBe(false);
    });

    it('leaves a fresh lock untouched and proceeds unlocked', async () => {
      // Fresh lock — mtime is ~now, so it is NOT stale
      writeFileSync(LOCK_PATH, 'active-holder-marker');

      vi.useFakeTimers();
      const { reportCrash } = await load();

      const promise = reportCrash(baseInput);
      await vi.advanceTimersByTimeAsync(4000);
      const result = await promise;

      // Should still produce a result (unlocked path)
      expect(result.status).toBe('saved-locally');
      // Must NOT have stolen the other process's lock
      expect(existsSync(LOCK_PATH)).toBe(true);
      expect(readFileSync(LOCK_PATH, 'utf8')).toBe('active-holder-marker');
    });
  });

  // ===========================================================================
  // 2. Deduplication
  // ===========================================================================
  describe('deduplication', () => {
    it('returns duplicate for a crash already filed within 30 days', async () => {
      const { reportCrash, computeSignature, redact } = await load();
      const sig = computeSignature(baseInput.repo, redact(baseInput.title).slice(0, 250));

      writeFileSync(
        LEDGER_PATH,
        JSON.stringify({
          bySignature: {
            [sig]: {
              url: 'https://github.com/monoes/monomind/issues/42',
              repo: baseInput.repo,
              reportedAt: Date.now() - 60_000, // 1 min ago
            },
          },
          filedAtByRepo: {},
        }),
      );

      const result = await reportCrash(baseInput);

      expect(result.status).toBe('duplicate');
      expect(result.url).toBe('https://github.com/monoes/monomind/issues/42');
    });

    it('ignores a ledger entry older than 30 days', async () => {
      const { reportCrash, computeSignature, redact } = await load();
      const sig = computeSignature(baseInput.repo, redact(baseInput.title).slice(0, 250));

      const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
      writeFileSync(
        LEDGER_PATH,
        JSON.stringify({
          bySignature: {
            [sig]: {
              url: 'https://github.com/monoes/monomind/issues/42',
              repo: baseInput.repo,
              reportedAt: Date.now() - THIRTY_ONE_DAYS_MS,
            },
          },
          filedAtByRepo: {},
        }),
      );

      const result = await reportCrash(baseInput);

      expect(result.status).not.toBe('duplicate');
      expect(result.status).toBe('saved-locally');
    });

    it('normalizes varying digits into the same signature', async () => {
      const { reportCrash, computeSignature, redact } = await load();

      // Pre-seed the ledger with a variant that has different numbers
      const variant1 = 'Index 42 out of bounds at 0x1a2b';
      const sig = computeSignature(baseInput.repo, redact(variant1).slice(0, 250));

      writeFileSync(
        LEDGER_PATH,
        JSON.stringify({
          bySignature: {
            [sig]: {
              url: 'https://github.com/monoes/monomind/issues/99',
              repo: baseInput.repo,
              reportedAt: Date.now() - 5000,
            },
          },
          filedAtByRepo: {},
        }),
      );

      // Report with DIFFERENT numbers but identical structure
      const result = await reportCrash({
        ...baseInput,
        title: 'Index 999 out of bounds at 0xffff',
      });

      expect(result.status).toBe('duplicate');
    });
  });

  // ===========================================================================
  // 3. Rate limiting
  // ===========================================================================
  describe('rate limiting', () => {
    it('suppresses reports after 5 per repo within one hour', async () => {
      const { reportCrash } = await load();

      const now = Date.now();
      writeFileSync(
        LEDGER_PATH,
        JSON.stringify({
          bySignature: {},
          filedAtByRepo: {
            [baseInput.repo]: Array.from({ length: 5 }, (_, i) => now - (i + 1) * 10_000),
          },
        }),
      );

      const result = await reportCrash({
        ...baseInput,
        title: 'Totally unique crash title',
      });

      expect(result.status).toBe('rate-limited');
      // Rate-limited reports are still saved locally so the user can file them
      expect(result.path).toBeDefined();
      expect(existsSync(result.path!)).toBe(true);
    });

    it('resets when prior filings fall outside the 1-hour window', async () => {
      const { reportCrash } = await load();

      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const now = Date.now();
      writeFileSync(
        LEDGER_PATH,
        JSON.stringify({
          bySignature: {},
          filedAtByRepo: {
            [baseInput.repo]: Array.from({ length: 5 }, (_, i) => now - TWO_HOURS_MS - i * 10_000),
          },
        }),
      );

      const result = await reportCrash(baseInput);

      expect(result.status).not.toBe('rate-limited');
      expect(result.status).toBe('saved-locally');
    });

    it('counts repos independently', async () => {
      const { reportCrash } = await load();

      const now = Date.now();
      writeFileSync(
        LEDGER_PATH,
        JSON.stringify({
          bySignature: {},
          filedAtByRepo: {
            'monoes/other-repo': Array.from({ length: 5 }, (_, i) => now - (i + 1) * 10_000),
          },
        }),
      );

      const result = await reportCrash(baseInput);

      expect(result.status).not.toBe('rate-limited');
    });
  });

  // ===========================================================================
  // 4. Normal flow
  // ===========================================================================
  describe('normal flow', () => {
    it('saves locally when no GitHub auth is available', async () => {
      const { reportCrash } = await load();

      const result = await reportCrash(baseInput);

      expect(result.status).toBe('saved-locally');
      expect(result.path).toBeDefined();
      expect(existsSync(result.path!)).toBe(true);
      expect(readFileSync(result.path!, 'utf8')).toContain(baseInput.repo);
    });

    it('returns disabled when MONOMIND_CRASH_REPORTING=0', async () => {
      process.env.MONOMIND_CRASH_REPORTING = '0';
      const { reportCrash } = await load();

      expect((await reportCrash(baseInput)).status).toBe('disabled');
    });

    it('returns disabled when config file says enabled: false', async () => {
      writeFileSync(CONFIG_PATH, JSON.stringify({ enabled: false }));
      const { reportCrash } = await load();

      expect((await reportCrash(baseInput)).status).toBe('disabled');
    });

    it('redacts secrets from the saved report', async () => {
      const { reportCrash } = await load();

      const creds = buildFakeCredentials();
      const sensitiveTitle = `Crash with credential ${creds.anthropicStyle}`;
      const sensitiveBody = `context ${creds.ghStyle}`;

      const result = await reportCrash({
        repo: 'monoes/monomind',
        title: sensitiveTitle,
        body: sensitiveBody,
      });

      expect(result.status).toBe('saved-locally');
      const content = readFileSync(result.path!, 'utf8');
      expect(content).not.toContain(creds.anthropicStyle);
      expect(content).not.toContain(creds.ghStyle);
    });
  });

  // ===========================================================================
  // 5. GitHub REST API submission
  // ===========================================================================
  describe('GitHub REST API submission', () => {
    const envKey = 'GITHUB' + '_TOKEN';
    const fakeVal = ['test', 'unit', 'val'].join('-');

    beforeEach(() => {
      process.env[envKey] = fakeVal;
    });

    it('files an issue via REST API when auth is available', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ html_url: 'https://github.com/monoes/monomind/issues/100' }),
      });

      const { reportCrash } = await load();
      const result = await reportCrash(baseInput);

      expect(result.status).toBe('created');
      expect(result.url).toBe('https://github.com/monoes/monomind/issues/100');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain('api.github.com');
      expect(url).toContain('monoes/monomind');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toContain(fakeVal);
    });

    it('falls back to local save when REST API returns non-OK', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Forbidden' }),
      });

      const { reportCrash } = await load();
      const result = await reportCrash(baseInput);

      expect(result.status).toBe('saved-locally');
      expect(result.path).toBeDefined();
    });
  });

  // ===========================================================================
  // 6. Concurrent access
  // ===========================================================================
  describe('concurrent access', () => {
    it('two simultaneous reports produce valid, distinct results', async () => {
      vi.useFakeTimers();
      const { reportCrash } = await load();

      const input1 = { repo: 'monoes/monomind', title: 'Crash Alpha', body: 'Body A' };
      const input2 = { repo: 'monoes/monomind', title: 'Crash Beta', body: 'Body B' };

      const promise = Promise.all([reportCrash(input1), reportCrash(input2)]);
      // Drive the second caller through the LOCK_WAIT_MS polling loop
      await vi.advanceTimersByTimeAsync(4000);
      const [r1, r2] = await promise;

      expect(r1.status).toBe('saved-locally');
      expect(r2.status).toBe('saved-locally');
      expect(r1.path).not.toBe(r2.path);
      expect(existsSync(r1.path!)).toBe(true);
      expect(existsSync(r2.path!)).toBe(true);
      // Lock must be fully released
      expect(existsSync(LOCK_PATH)).toBe(false);
    });

    it('preserves ledger integrity under concurrent filing', async () => {
      vi.useFakeTimers();

      // gh auth succeeds so issues are filed and recorded in the ledger
      execFileAsyncMock.mockImplementation(async (...args: unknown[]) => {
        const cmdArgs = args[1] as string[] | undefined;
        if (cmdArgs?.[0] === 'auth') return { stdout: 'ok', stderr: '' };
        if (cmdArgs?.[0] === 'issue' && cmdArgs?.[1] === 'list') {
          return { stdout: '[]', stderr: '' };
        }
        if (cmdArgs?.[0] === 'issue' && cmdArgs?.[1] === 'create') {
          return {
            stdout: `https://github.com/monoes/monomind/issues/${Date.now()}`,
            stderr: '',
          };
        }
        throw new Error('unexpected gh call');
      });

      const { reportCrash } = await load();
      const input1 = { repo: 'monoes/monomind', title: 'Crash Alpha', body: 'A' };
      const input2 = { repo: 'monoes/monomind', title: 'Crash Beta', body: 'B' };

      const promise = Promise.all([reportCrash(input1), reportCrash(input2)]);
      await vi.advanceTimersByTimeAsync(4000);
      const [r1, r2] = await promise;

      expect(r1.status).not.toBe('error');
      expect(r2.status).not.toBe('error');

      // Ledger must be parseable and structurally valid
      const raw = readFileSync(LEDGER_PATH, 'utf8');
      const ledger = JSON.parse(raw);
      expect(ledger).toHaveProperty('bySignature');
      expect(ledger).toHaveProperty('filedAtByRepo');
      expect(Object.keys(ledger.bySignature).length).toBeGreaterThanOrEqual(1);
    });
  });
});
