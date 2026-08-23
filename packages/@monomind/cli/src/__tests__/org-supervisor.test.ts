/**
 * `org supervisor` emits a unit that keeps `org serve` running (#45).
 *
 * The reported failure: an `org serve` daemon started with `nohup ... &` vanished
 * after hours with nothing in its log, and every scheduled org silently stopped.
 * Its org logs showed repeated low-memory warnings, which points at an OOM kill.
 *
 * The daemon now announces every death it can observe — signals, uncaught
 * exceptions, unhandled rejections, and the event loop draining — and writes a
 * heartbeat so `org status` can say when it was last alive. But an OOM kill is
 * SIGKILL, which is uncatchable by design: no in-process handler runs, and
 * nothing inside the process can restart it. A `--supervise` flag would be
 * theatre for precisely the case that motivated the report.
 *
 * So the answer is an external supervisor, and these tests pin the two
 * properties that make the generated unit worth having: it restarts the daemon
 * *however* it died, and it points at this exact interpreter and entry point
 * rather than trusting PATH to resolve the same version later.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'cli.js');

function runSupervisor(cwd: string, home: string, args: string[] = []) {
  const res = spawnSync(process.execPath, [CLI, 'org', 'supervisor', ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, HOME: home, MONOMIND_DISABLE_UPDATE_CHECK: '1' },
  });
  return { out: `${res.stdout ?? ''}${res.stderr ?? ''}`, code: res.status };
}

describe('org supervisor emits a usable unit', () => {
  let cwd: string;
  let home: string;

  beforeEach(() => {
    // realpath: on macOS mkdtemp returns /var/... while the command resolve()s
    // it to /private/var/..., so a raw comparison fails for the wrong reason.
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'org-sup-')));
    home = realpathSync(mkdtempSync(join(tmpdir(), 'org-sup-home-')));
  });
  afterEach(() => {
    for (const d of [cwd, home]) {
      rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('emits a launchd plist that restarts the daemon however it died', () => {
    const { out } = runSupervisor(cwd, home, ['--format', 'launchd']);

    // Prefix, not an exact match: the Label carries a per-project suffix so
    // two projects cannot claim the same launchd job.
    expect(out).toMatch(/<key>Label<\/key><string>com\.monomind\.org-serve\.[\w.-]+<\/string>/);
    // KeepAlive is the whole point: it covers SIGKILL, which no in-process
    // handler can. Without it this unit would not solve the reported failure.
    expect(out).toContain('<key>KeepAlive</key><true/>');
    expect(out).toContain('<string>serve</string>');
    // Absolute interpreter + entry point, so a later PATH change cannot swap
    // the daemon for a different version.
    expect(out).toContain(process.execPath);
    expect(out).toContain(cwd);
  }, 70_000);

  it('emits a systemd unit that restarts the daemon however it died', () => {
    const { out } = runSupervisor(cwd, home, ['--format', 'systemd']);

    expect(out).toContain('Restart=always');
    expect(out).toMatch(/ExecStart=.*org serve/);
    expect(out).toContain(`WorkingDirectory=${cwd}`);
  }, 70_000);

  it('rejects a format it cannot generate instead of emitting something wrong', () => {
    const { out, code } = runSupervisor(cwd, home, ['--format', 'upstart']);
    expect(code).not.toBe(0);
    expect(out).toMatch(/expected launchd or systemd/i);
  }, 70_000);

  it('installs into the per-user location on request', () => {
    const { out } = runSupervisor(cwd, home, ['--format', 'systemd', '--install']);

    const dir = join(home, '.config', 'systemd', 'user');
    const units = readdirSync(dir).filter((f) => /^monomind-org-serve-.+\.service$/.test(f));
    expect(units, out).toHaveLength(1);
    expect(readFileSync(join(dir, units[0]), 'utf-8')).toContain('Restart=always');
    // The command must say how to activate it — a written-but-unloaded unit
    // supervises nothing.
    expect(out).toMatch(/systemctl --user/);
  }, 70_000);

  it('gives each project its own unit instead of overwriting the last one', () => {
    // The unit bakes in a WorkingDirectory, so a constant Label and filename
    // meant --install from a second project silently replaced the first
    // project's unit — leaving that daemon unsupervised with no warning.
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'org-sup-other-')));
    try {
      runSupervisor(cwd, home, ['--format', 'systemd', '--install']);
      runSupervisor(other, home, ['--format', 'systemd', '--install']);

      const dir = join(home, '.config', 'systemd', 'user');
      const units = readdirSync(dir).filter((f) => f.endsWith('.service'));
      expect(units, 'the second install overwrote the first').toHaveLength(2);

      const dirs = units
        .map((u) => /WorkingDirectory=(.*)/.exec(readFileSync(join(dir, u), 'utf-8'))?.[1])
        .sort();
      expect(dirs).toEqual([cwd, other].sort());
    } finally {
      rmSync(other, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 70_000);

  it('explains why an external supervisor is needed at all', () => {
    // Without this the reader has no way to know an in-process restart cannot
    // help, and will reasonably ask for --supervise instead.
    const { out } = runSupervisor(cwd, home, []);
    expect(out).toMatch(/SIGKILL/);
  }, 70_000);
});
