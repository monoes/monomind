/**
 * session.ts — the path-safety guards and the state-file round trip.
 *
 * Session files hold cookies and localStorage, so the traversal guards and the
 * 0600/0700 permission bits are security-relevant. All of it is filesystem +
 * validation logic: the CdpClient is a stub that answers the handful of CDP
 * commands the round trip issues.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, stat, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CdpClient } from '../browser/cdp.js';
import {
  saveStateFile,
  loadStateFile,
  saveSession,
  loadSession,
  listSessions,
} from '../browser/session.js';

const COOKIES = [{ name: 'sid', value: 'abc', domain: 'x.test', path: '/' }];

/** Records every CDP command and answers the ones session.ts depends on. */
function stubClient(): { client: CdpClient; calls: Array<{ method: string; params: unknown; sid?: string }> } {
  const calls: Array<{ method: string; params: unknown; sid?: string }> = [];
  const client = {
    send: vi.fn(async (method: string, params: unknown, sid?: string) => {
      calls.push({ method, params, sid });
      if (method === 'Network.getCookies') return { cookies: COOKIES };
      if (method === 'Runtime.evaluate') {
        const expr = (params as { expression: string }).expression;
        if (expr.includes('Object.entries(localStorage)')) return { result: { value: '{"k":"v"}' } };
        if (expr.includes('Object.entries(sessionStorage)')) return { result: { value: '{"s":"1"}' } };
      }
      return {};
    }),
  } as unknown as CdpClient;
  return { client, calls };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'monobrowse-session-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('validateSessionName (via saveSession/loadSession)', () => {
  const { client } = stubClient();

  // Rejection happens before any filesystem or CDP work, so these never touch
  // the real ~/.monomind directory.
  const bad: Array<[string, string]> = [
    ['empty', ''],
    ['forward slash', 'a/b'],
    ['backslash', 'a\\b'],
    ['NUL byte', 'a\x00b'],
    ['dot', '.'],
    ['dot-dot', '..'],
    ['dot-dot prefix', '..evil'],
    ['traversal', '../../etc/passwd'],
  ];

  for (const [label, name] of bad) {
    it(`rejects ${label}`, async () => {
      await expect(saveSession(client, 'S1', 'T1', name, 'https://x.test', 'T')).rejects.toThrow(
        /Invalid session name/
      );
      await expect(loadSession(client, 'S1', name)).rejects.toThrow(/Invalid session name/);
    });
  }

  it('accepts an ordinary name (fails later, on the missing file, not on validation)', async () => {
    await expect(loadSession(client, 'S1', 'no-such-session-xyz')).rejects.toThrow(
      'Session not found: no-such-session-xyz'
    );
  });

  it('does not issue a single CDP command for a rejected name', async () => {
    const { client: c, calls } = stubClient();
    await expect(saveSession(c, 'S1', 'T1', '../x', 'https://x.test', 'T')).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe('validateFilePath (via saveStateFile/loadStateFile)', () => {
  const { client } = stubClient();

  const bad: Array<[string, string]> = [
    ['empty', ''],
    ['NUL byte', '/tmp/a\x00b.json'],
    ['embedded ..', '/tmp/a/../../etc/passwd'],
    ['leading ../', '../secret.json'],
    ['trailing /..', '/tmp/state/..'],
    ['backslash', 'C:\\Windows\\state.json'],
  ];

  for (const [label, filePath] of bad) {
    it(`rejects ${label}`, async () => {
      await expect(
        saveStateFile(client, 'S1', 'T1', filePath, 'https://x.test', 'T')
      ).rejects.toThrow(/Invalid file path/);
      await expect(loadStateFile(client, 'S1', filePath)).rejects.toThrow(/Invalid file path/);
    });
  }

  it('allows a plain absolute path', async () => {
    const p = join(dir, 'state.json');
    await expect(saveStateFile(client, 'S1', 'T1', p, 'https://x.test', 'T')).resolves.toBeUndefined();
  });
});

describe('state file round trip', () => {
  it('captures cookies plus local/session storage and writes owner-only (0600)', async () => {
    const { client, calls } = stubClient();
    const p = join(dir, 'nested', 'state.json');
    await saveStateFile(client, 'S1', 'T1', p, 'https://x.test', 'Page Title');

    const state = JSON.parse(await readFile(p, 'utf8'));
    expect(state).toEqual({
      targetId: 'T1',
      sessionId: 'S1',
      url: 'https://x.test',
      title: 'Page Title',
      cookies: COOKIES,
      localStorage: { k: 'v' },
      sessionStorage: { s: '1' },
    });

    expect((await stat(p)).mode & 0o777).toBe(0o600);
    // Parent directory created owner-only too.
    expect((await stat(join(dir, 'nested'))).mode & 0o777).toBe(0o700);

    // Cookies were scoped to the page URL, not fetched globally.
    expect(calls.find((c) => c.method === 'Network.getCookies')?.params).toEqual({
      urls: ['https://x.test'],
    });
  });

  it('replays cookies and both storages back into the page on load', async () => {
    const saver = stubClient();
    const p = join(dir, 'state.json');
    await saveStateFile(saver.client, 'S1', 'T1', p, 'https://x.test', 'T');

    const loader = stubClient();
    const state = await loadStateFile(loader.client, 'S2', p);
    expect(state.cookies).toEqual(COOKIES);

    const setCookies = loader.calls.find((c) => c.method === 'Network.setCookies');
    expect(setCookies).toMatchObject({ params: { cookies: COOKIES }, sid: 'S2' });

    const scripts = loader.calls
      .filter((c) => c.method === 'Runtime.evaluate')
      .map((c) => (c.params as { expression: string }).expression);
    expect(scripts).toContain('localStorage.setItem("k", "v")');
    expect(scripts).toContain('sessionStorage.setItem("s", "1")');
  });

  it('rejects a state file whose cookies field is not an array', async () => {
    const { client } = stubClient();
    const p = join(dir, 'bad.json');
    const { writeFile } = await import('fs/promises');
    await writeFile(p, JSON.stringify({ cookies: { name: 'sid' } }));
    await expect(loadStateFile(client, 'S1', p)).rejects.toThrow(
      'Invalid state file: cookies is not an array'
    );
  });

  it('rejects a state file whose localStorage is an array rather than an object', async () => {
    const { client } = stubClient();
    const p = join(dir, 'bad2.json');
    const { writeFile } = await import('fs/promises');
    await writeFile(p, JSON.stringify({ cookies: [], localStorage: ['nope'] }));
    await expect(loadStateFile(client, 'S1', p)).rejects.toThrow(
      'Invalid state file: localStorage is not a plain object'
    );
  });

  it('rejects a state file whose sessionStorage is an array', async () => {
    const { client } = stubClient();
    const p = join(dir, 'bad3.json');
    const { writeFile } = await import('fs/promises');
    await writeFile(p, JSON.stringify({ cookies: [], sessionStorage: ['nope'] }));
    await expect(loadStateFile(client, 'S1', p)).rejects.toThrow(
      'Invalid state file: sessionStorage is not a plain object'
    );
  });

  it('accepts a state file with neither storage map present', async () => {
    const { client, calls } = stubClient();
    const p = join(dir, 'minimal.json');
    const { writeFile } = await import('fs/promises');
    await writeFile(p, JSON.stringify({ targetId: 'T', sessionId: 'S', url: '', title: '', cookies: [] }));
    await expect(loadStateFile(client, 'S1', p)).resolves.toMatchObject({ cookies: [] });
    expect(calls.filter((c) => c.method === 'Runtime.evaluate')).toEqual([]);
  });
});

describe('listSessions', () => {
  // SESSION_DIR is computed from homedir() at module load, so each case
  // re-imports session.js with 'os' mocked to point at a temp home.
  async function withHome(home: string): Promise<typeof import('../browser/session.js')> {
    vi.resetModules();
    const actualOs = await vi.importActual<typeof import('os')>('os');
    vi.doMock('os', () => ({ ...actualOs, default: actualOs, homedir: () => home }));
    return import('../browser/session.js');
  }

  afterEach(() => {
    vi.doUnmock('os');
    vi.resetModules();
  });

  it('returns [] when the session directory does not exist', async () => {
    const mod = await withHome(join(dir, 'no-such-home'));
    await expect(mod.listSessions()).resolves.toEqual([]);
  });

  it('lists only .json files, with the extension stripped', async () => {
    const sessionDir = join(dir, '.monomind', 'browser-sessions');
    await mkdir(sessionDir, { recursive: true });
    const { writeFile } = await import('fs/promises');
    await writeFile(join(sessionDir, 'alpha.json'), '{}');
    await writeFile(join(sessionDir, 'beta.json'), '{}');
    await writeFile(join(sessionDir, 'notes.txt'), 'ignore me');

    const mod = await withHome(dir);
    await expect(mod.listSessions()).resolves.toEqual(['alpha', 'beta']);
  });

  it('saveSession writes into the session dir and loadSession reads it back', async () => {
    const mod = await withHome(dir);
    const saver = stubClient();
    const filePath = await mod.saveSession(saver.client, 'S1', 'T1', 'my-session', 'https://x.test', 'T');
    expect(filePath).toBe(join(dir, '.monomind', 'browser-sessions', 'my-session.json'));
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, '.monomind', 'browser-sessions'))).mode & 0o777).toBe(0o700);

    const loader = stubClient();
    await expect(mod.loadSession(loader.client, 'S2', 'my-session')).resolves.toMatchObject({
      cookies: COOKIES,
      url: 'https://x.test',
    });
    await expect(mod.listSessions()).resolves.toEqual(['my-session']);
  });
});
