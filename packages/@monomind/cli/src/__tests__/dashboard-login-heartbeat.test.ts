/** The heartbeat evicts a dead org run whose project is not MONOMIND_HOME. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupServerLifecycle } from '../ui/server-lifecycle.mjs';
import { activeOrgRuns } from '../ui/server-rundb.mjs';

describe('dashboard heartbeat across projects', () => {
  afterEach(() => {
    vi.useRealTimers();
    activeOrgRuns.clear();
  });

  it('evicts an org of a known project whose daemon pid is dead', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hb-home-'));
    const proj = mkdtempSync(join(tmpdir(), 'hb-proj-'));
    mkdirSync(join(home, 'data'), { recursive: true });
    writeFileSync(join(home, 'data', 'known-projects.json'), JSON.stringify([proj]));
    mkdirSync(join(proj, '.monomind', 'orgs', 'beta'), { recursive: true });
    writeFileSync(join(proj, '.monomind', 'orgs', 'beta.json'), '{}');
    const deadPid = spawnSync(process.execPath, ['-e', '0']).pid as number;
    writeFileSync(
      join(proj, '.monomind', 'orgs', 'beta', 'runtime.json'),
      JSON.stringify({ pid: deadPid, status: 'running', run: 'r1' }),
    );

    const events: string[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        events.push(body);
        res.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const boundPort = (server.address() as { port: number }).port;

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    activeOrgRuns.set('beta', 'r1');
    const { stopBackgroundTasks } = setupServerLifecycle({
      projectDir: home,
      MONOMIND_HOME: home,
      boundPort,
      dashboardAuthValue: 't',
    });
    vi.advanceTimersByTime(60_000);
    stopBackgroundTasks();
    vi.useRealTimers();
    await vi.waitFor(() => expect(events.some((e) => e.includes('pid-dead'))).toBe(true));
    expect(activeOrgRuns.has('beta')).toBe(false);
    server.close();
  });
});
