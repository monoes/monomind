/**
 * Health view: `monomind doctor --json --read-only --offline` for the project
 * the dashboard serves, run on demand (routes-doctor.mjs) and rendered in
 * dashboard.html's Health view.
 */
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDoctorRunner, handleDoctorRoutes } from '../ui/routes-doctor.mjs';
import { dashboardScript, loadPageFunctions, UI_DIR } from './dashboard-script.js';

const HTML = readFileSync(join(UI_DIR, 'dashboard.html'), 'utf-8');

function fakeSpawn() {
  const calls: { cmd: string; args: string[]; opts: { cwd: string } }[] = [];
  const children: (EventEmitter & { stdout: EventEmitter; killed?: string })[] = [];
  const spawnImpl = (cmd: string, args: string[], opts: { cwd: string }) => {
    calls.push({ cmd, args, opts });
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      kill(sig: string) {
        child.killed = sig;
      },
    }) as EventEmitter & { stdout: EventEmitter; killed?: string; kill: (s: string) => void };
    children.push(child);
    return child;
  };
  return { spawnImpl, calls, children };
}

const REPORT = {
  v: 1,
  summary: { passed: 1, warnings: 1, failed: 1, info: 0, skipped: 0 },
  results: [
    { name: 'Git', status: 'pass', message: 'v2.49' },
    { name: 'Disk Space', status: 'fail', message: '1.2Gi <available>', fix: 'free space' },
    { name: 'Claude Code CLI', status: 'warn', message: 'Not installed' },
  ],
};

describe('doctor runner', () => {
  it('runs doctor read-only and offline in the given project, one run at a time', () => {
    const f = fakeSpawn();
    const runner = createDoctorRunner({
      spawnImpl: f.spawnImpl as never,
      bin: () => '/x/bin/cli.js',
    });
    expect(runner.start('/proj')).toBe(true);
    expect(runner.start('/proj')).toBe(false);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].args).toEqual([
      '/x/bin/cli.js',
      'doctor',
      '--json',
      '--read-only',
      '--offline',
    ]);
    expect(f.calls[0].opts.cwd).toBe('/proj');
    expect(runner.state.running).toBe(true);
  });

  it('keeps the parsed report even though doctor exits 1 on a failed check', () => {
    const f = fakeSpawn();
    const runner = createDoctorRunner({
      spawnImpl: f.spawnImpl as never,
      bin: () => '/x/bin/cli.js',
    });
    runner.start('/proj');
    f.children[0].stdout.emit('data', JSON.stringify(REPORT));
    f.children[0].emit('close', 1);
    expect(runner.state.running).toBe(false);
    expect(runner.state.result).toEqual(REPORT);
    expect(runner.state.ranAt).toEqual(expect.any(String));
    expect(runner.start('/proj')).toBe(true); // a new run may start once the last one ended
  });

  it('reports output that is not JSON as an error', () => {
    const f = fakeSpawn();
    const runner = createDoctorRunner({
      spawnImpl: f.spawnImpl as never,
      bin: () => '/x/bin/cli.js',
    });
    runner.start('/proj');
    f.children[0].stdout.emit('data', 'boom');
    f.children[0].emit('close', 1);
    expect(runner.state.error).toBe('doctor did not print a JSON report');
  });

  it('kills a run that does not finish in time', async () => {
    const f = fakeSpawn();
    const runner = createDoctorRunner({
      spawnImpl: f.spawnImpl as never,
      bin: () => '/x/bin/cli.js',
      timeoutMs: 20,
    });
    runner.start('/proj');
    await new Promise((r) => setTimeout(r, 60));
    expect(f.children[0].killed).toBe('SIGTERM');
    expect(runner.state.running).toBe(false);
    expect(runner.state.error).toMatch(/did not finish/);
  });
});

describe('doctor routes', () => {
  function res() {
    const out: { status?: number; body?: unknown } = {};
    return {
      out,
      writeHead(status: number) {
        out.status = status;
      },
      end(body: string) {
        out.body = JSON.parse(body);
      },
    };
  }

  it('POST /api/doctor/run starts a run for the server project; GET reports it', async () => {
    const f = fakeSpawn();
    const runner = createDoctorRunner({
      spawnImpl: f.spawnImpl as never,
      bin: () => '/x/bin/cli.js',
    });
    const ctx = { projectDir: '/served' };
    const post = res();
    expect(
      await handleDoctorRoutes(
        { method: 'POST' } as never,
        post as never,
        '/api/doctor/run',
        '',
        ctx,
        runner,
      ),
    ).toBe(true);
    expect(post.out.status).toBe(202);
    expect(f.calls[0].opts.cwd).toBe('/served');
    const get = res();
    await handleDoctorRoutes(
      { method: 'GET' } as never,
      get as never,
      '/api/doctor',
      '',
      ctx,
      runner,
    );
    expect(get.out.body).toMatchObject({ running: true, projectDir: '/served' });
  });

  it('GET does not start a run', async () => {
    const f = fakeSpawn();
    const runner = createDoctorRunner({
      spawnImpl: f.spawnImpl as never,
      bin: () => '/x/bin/cli.js',
    });
    await handleDoctorRoutes(
      { method: 'GET' } as never,
      res() as never,
      '/api/doctor',
      '',
      { projectDir: '/p' },
      runner,
    );
    expect(f.calls).toHaveLength(0);
  });
});

describe('Health view', () => {
  it('has a nav item, a view and a render branch', () => {
    expect(HTML).toContain('<div class="nav-item" data-view="health"');
    expect(HTML).toContain('<div class="view" id="view-health">');
    expect(dashboardScript).toContain("if (v === 'health') loadHealthView();");
    expect(dashboardScript).toContain('runHealthChecks: _runHealthChecks,');
  });

  function page(extra: Record<string, unknown> = {}) {
    const els: Record<string, Record<string, unknown>> = {
      'health-content': { innerHTML: '' },
      'health-meta': { textContent: '' },
      'health-run-btn': { disabled: false, textContent: '' },
      'health-sub': { textContent: '' },
      'bdg-health': { textContent: '' },
    };
    const ctx = loadPageFunctions(
      dashboardScript,
      [
        'healthRows',
        'healthRowHtml',
        'renderHealth',
        'loadHealthView',
        'esc',
        '_hiPill',
        'relTime',
      ],
      {
        HEALTH_ORDER: { fail: 0, warn: 1, info: 2, skipped: 3, pass: 4 },
        HEALTH_COLOR: {},
        _healthPoll: null,
        currentView: 'health',
        document: { getElementById: (id: string) => els[id] },
        ...extra,
      },
    );
    return { ctx, els };
  }

  it('lists failures first, escapes text, and folds passed checks away', () => {
    const { ctx, els } = page();
    ctx.renderHealth({
      running: false,
      ranAt: new Date().toISOString(),
      durationMs: 4000,
      result: REPORT,
      projectDir: '/served',
    });
    const html = String(els['health-content'].innerHTML);
    expect(html.indexOf('Disk Space')).toBeLessThan(html.indexOf('Claude Code CLI'));
    expect(html).toContain('1.2Gi &lt;available&gt;');
    expect(html).toContain('Fix: <code>free space</code>');
    expect(html).toMatch(/<details[^>]*><summary[^>]*>1 passed<\/summary>/);
    expect(els['bdg-health'].textContent).toBe(2);
    expect(els['health-sub'].textContent).toContain('/served');
  });

  it('shows the running state and polls until the run ends', async () => {
    let polled = 0;
    const { ctx, els } = page({
      apiFetch: async () => ({ running: true, result: null, projectDir: '/p' }),
      setTimeout: () => {
        polled++;
        return 1;
      },
      clearTimeout: () => {},
    });
    await ctx.loadHealthView();
    expect(els['health-run-btn'].disabled).toBe(true);
    expect(els['health-run-btn'].textContent).toBe('Running…');
    expect(polled).toBe(1);
  });

  it('asks before a first run instead of running on open', () => {
    const { ctx, els } = page();
    ctx.renderHealth({ running: false, ranAt: null, result: null });
    expect(String(els['health-content'].innerHTML)).toContain('Run the checks');
    expect(els['health-meta'].textContent).toBe('Not run yet.');
  });
});
