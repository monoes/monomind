/**
 * #656: a scheduled tick that `org serve` refuses (unsigned definition, failed
 * precheck) must leave a `scheduled-start-refused` line in schedule-audit.jsonl,
 * like the other refused ticks, instead of only printing to serve's stdout.
 *
 * The scheduler callback is private to serveAction, so the OrgScheduler is
 * mocked to capture it.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RunFn = (name: string, intervalMs: number) => Promise<void>;
const captured = vi.hoisted(() => ({ runFn: undefined as undefined | RunFn }));
const signature = vi.hoisted(() => ({ ok: true as boolean }));

vi.mock('../orgrt/scheduler.js', () => ({
  parseSchedule: () => null,
  OrgScheduler: class {
    constructor(runFn: RunFn) {
      captured.runFn = runFn;
    }
    add() {}
    stop() {}
  },
}));
vi.mock('../orgrt/scheduled-run.js', async (orig) => ({
  ...(await orig<typeof import('../orgrt/scheduled-run.js')>()),
  runScheduledIteration: vi.fn(async () => {}),
}));
vi.mock('../orgrt/org-signature.js', () => ({
  orgSignatureEnforced: () => true,
  verifyOrgDef: () =>
    signature.ok
      ? { ok: true }
      : { ok: false, message: 'org "alpha" is unsigned', reason: 'unsigned' },
}));
vi.mock('../memory/memory-bridge.js', () => ({ disableLocalModels: () => {} }));

import { serveAction } from '../commands/org-serve.js';

describe('org serve audits refused scheduled ticks (#656)', () => {
  let cwd: string;
  const auditFile = (name: string) => join(cwd, '.monomind', 'orgs', name, 'schedule-audit.jsonl');
  const auditLines = (name: string) =>
    readFileSync(auditFile(name), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

  const defineOrg = (name: string, def: Record<string, unknown> = {}) => {
    mkdirSync(join(cwd, '.monomind', 'orgs'), { recursive: true });
    writeFileSync(
      join(cwd, '.monomind', 'orgs', `${name}.json`),
      JSON.stringify({ name, roles: [], ...def }),
    );
  };
  const startServe = async () => {
    void serveAction({ cwd, flags: { crossProcess: false }, args: [] } as never);
    await vi.waitFor(() => expect(captured.runFn).toBeDefined());
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-serve-audit-'));
    captured.runFn = undefined;
    signature.ok = true;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('audits a tick refused because the definition is unsigned', async () => {
    defineOrg('alpha');
    signature.ok = false;
    await startServe();
    await captured.runFn?.('alpha', 60_000);

    expect(auditLines('alpha')).toMatchObject([
      { event: 'scheduled-start-refused', msg: 'org "alpha" is unsigned' },
    ]);
  });

  it('audits a tick refused because a precheck failed, with its name and output', async () => {
    defineOrg('alpha', {
      run_config: { prechecks: [{ name: 'disk-free', command: 'echo no space >&2; exit 1' }] },
    });
    await startServe();
    await captured.runFn?.('alpha', 60_000);

    const [line] = auditLines('alpha');
    expect(line.event).toBe('scheduled-start-refused');
    expect(line.msg).toContain('disk-free');
    expect(line.msg).toContain('no space');
  });

  it('writes nothing when the org passes both checks', async () => {
    defineOrg('alpha', { run_config: { prechecks: [{ name: 'ok', command: 'true' }] } });
    await startServe();
    await captured.runFn?.('alpha', 60_000);

    expect(existsSync(auditFile('alpha'))).toBe(false);
  });
});
