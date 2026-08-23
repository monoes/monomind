/**
 * Integration tests for the warm Second Brain endpoint and the dashboard-token
 * pairing guard (src/ui/server.mjs).
 *
 * Boots the REAL built server (dist/src/ui/server.mjs) as a child process with
 * cwd set to a throwaway temp project, so every cwd-derived path — the
 * .monomind/ auth files and the ~/.monomind/projects/<slug> memory store — is
 * fully isolated from the developer's actual projects. Requires `npm run
 * build` to have produced dist/ (same contract as the orgrt smoke tests).
 *
 * Covers:
 *  - POST /api/knowledge/search: auth wall, response shape, KG triplet
 *    surfacing through router-directed RRF fusion
 *  - writeDashboardToken: a secondary instance must NOT clobber the primary
 *    project pairing file; it writes dashboard-token-<port> instead
 */

import { type ChildProcess, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_MJS = path.join(CLI_ROOT, 'dist', 'src', 'ui', 'server.mjs');
const KG_MJS = path.join(CLI_ROOT, 'dist', 'src', 'memory', 'memory-kg.js');

// Ports are picked at runtime (kernel-assigned free ports, then released)
// instead of being hardcoded — a fixed port makes the whole file fail on any
// machine where that port happens to be occupied, which is machine-state
// dependence, not a product signal. There is a small inherent race between
// closing the probe socket and the server binding, but the bound-report check
// in waitForBind() catches it loudly (foreign occupant → wrong port → throw).
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no port assigned'))));
    });
  });
}

let PORT_A = 0;
let PORT_B = 0;

let tmpDir = '';
let globalBrainDir = '';
let serverA: ChildProcess | null = null;
let serverB: ChildProcess | null = null;

/** Mirror of memory-bridge projectDataDir() so afterAll can remove the
 *  temp project's isolated store. Keep in sync with memory-bridge.ts. */
function projectStoreDir(cwd: string): string {
  const resolved = path.resolve(cwd);
  const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 16);
  const readable =
    path
      .basename(resolved)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 40) || 'project';
  return path.join(os.homedir(), '.monomind', 'projects', `${readable}-${hash}`);
}

/** Child env with every project-locating variable pinned to the temp dir —
 *  an inherited CLAUDE_PROJECT_DIR/MONOMIND_BOUND_REPORT would otherwise make
 *  the child write into the REAL project (the exact clobber under test). */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_PROJECT_DIR: tmpDir,
    MONOMIND_GLOBAL_BRAIN_DIR: globalBrainDir,
    MONOMIND_HOME: tmpDir,
  };
  delete env.MONOMIND_BOUND_REPORT;
  delete env.CONTROL_PORT;
  delete env.MONOMIND_CONTROL_PORT;
  return env;
}

function spawnServer(port: number): ChildProcess {
  // The server self-reports its ACTUAL bound port here (identity-proof:
  // bindServer silently falls back to port+1..+10 on EADDRINUSE, and an HTTP
  // probe can't tell our server from a foreign occupant of the fixed port).
  const env = childEnv();
  env.MONOMIND_BOUND_REPORT = path.join(tmpDir, `bound-${port}.json`);
  // stderr goes to a per-port log — when a pairing file never lands the log
  // is the only way to tell a slow start from a crashed server.
  const errFd = fs.openSync(path.join(tmpDir, `server-${port}.log`), 'a');
  return spawn(process.execPath, [SERVER_MJS, String(port)], {
    cwd: tmpDir,
    env,
    stdio: ['ignore', 'ignore', errFd],
    detached: false,
  });
}

/** Wait for the server's bound-port self-report and require the requested
 *  port — a silent fallback bind would otherwise run the suite against the
 *  wrong port (or a foreign process). */
async function waitForBind(requestedPort: number, timeoutMs = 20_000): Promise<void> {
  const reportFile = path.join(tmpDir, `bound-${requestedPort}.json`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const rep = JSON.parse(fs.readFileSync(reportFile, 'utf-8')) as { port?: number };
      if (rep.port === requestedPort) return;
      throw new Error(
        `server bound :${rep.port} instead of requested :${requestedPort} — port collision, free it or change the test port`,
      );
    } catch (e) {
      if (e instanceof Error && /bound :/.test(e.message)) throw e;
      /* report not written yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server on :${requestedPort} did not report a bind within ${timeoutMs}ms`);
}

/** Poll for a pairing file — it lands just after bind (the write awaits an
 *  HTTP liveness probe), so HTTP can answer moments before the file exists. */
async function waitForFile(name: string, timeoutMs = 5000): Promise<void> {
  const fp = path.join(tmpDir, '.monomind', name);
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(fp) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 150));
  if (!fs.existsSync(fp)) {
    // Include the server's stderr tail when this is a port-scoped token —
    // on a timeout the log is the only evidence of what the child was doing.
    let logTail = '';
    const m = name.match(/-(\d+)$/);
    if (m) {
      try {
        const log = fs.readFileSync(path.join(tmpDir, `server-${m[1]}.log`), 'utf-8');
        logTail = `\nserver-${m[1]}.log tail:\n${log.slice(-1500)}`;
      } catch {
        /* no log */
      }
    }
    throw new Error(`${name} was not written within ${timeoutMs}ms${logTail}`);
  }
}

async function waitForServer(port: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1000) });
      return; // any HTTP answer means it's up (401 included)
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server on :${port} did not come up within ${timeoutMs}ms`);
}

/** Read a pairing file written by the server under <tmp>/.monomind/. */
function readPairing(name = 'dashboard-token'): string {
  return fs.readFileSync(path.join(tmpDir, '.monomind', name), 'utf-8').trim();
}

async function search(port: number, pairing: string, body: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${port}/api/knowledge/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-monomind-token': pairing },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return res;
}

/** Seed the temp project's KG store from a child process sharing the server's
 *  cwd (the store is cwd-keyed), so the endpoint's kgSearch can see it. */
function seedKg(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = `
      const kg = await import(${JSON.stringify(KG_MJS)});
      const r = await kg.kgIngest({
        nodes: [
          { name: 'AlphaService', type: 'component', description: 'The alpha orchestration service under test' },
          { name: 'BetaStore', type: 'component', description: 'The beta persistence store under test' },
        ],
        edges: [{ source: 'AlphaService', sourceType: 'component', relation: 'uses', target: 'BetaStore', targetType: 'component', description: 'AlphaService persists run state into BetaStore' }],
        originRef: 'knowledge-endpoint-test',
      });
      if (!r.success) throw new Error('kgIngest failed: ' + r.error);
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: tmpDir,
      env: childEnv(),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr?.on('data', (d) => {
      err += d;
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`seed exited ${code}: ${err.slice(0, 500)}`)),
    );
  });
}

beforeAll(async () => {
  if (!fs.existsSync(SERVER_MJS)) {
    throw new Error('dist/src/ui/server.mjs missing — run `npm run build` first');
  }
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-endpoint-')));
  globalBrainDir = path.join(tmpDir, 'global-brain');
  fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
  fs.mkdirSync(globalBrainDir, { recursive: true });

  PORT_A = await freePort();
  PORT_B = await freePort();

  serverA = spawnServer(PORT_A);
  await waitForBind(PORT_A);
  await waitForServer(PORT_A);
  await waitForFile('dashboard-token');
}, 60_000);

afterAll(() => {
  for (const c of [serverA, serverB]) {
    try {
      c?.kill('SIGKILL');
    } catch {
      /* gone */
    }
  }
  // Guard: if beforeAll failed before mkdtemp, tmpDir is '' and
  // projectStoreDir('') would resolve to the REAL cwd's store. Never remove
  // anything unless tmpDir is a realpath'd temp directory we created.
  if (tmpDir?.startsWith(fs.realpathSync(os.tmpdir()))) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    try {
      fs.rmSync(projectStoreDir(tmpDir), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe('POST /api/knowledge/search (warm Second Brain endpoint)', () => {
  it('rejects requests without the paired auth value', async () => {
    const res = await search(PORT_A, 'not-the-pairing-value', { query: 'anything at all here' });
    expect(res.status).toBe(401);
  }, 30_000);

  it('writes the primary pairing file on startup (no control.json → primary)', () => {
    expect(readPairing()).toMatch(/^[0-9a-f]{32,}$/);
  });

  it('answers with {method, results[]} shape on an empty store', async () => {
    const res = await search(PORT_A, readPairing(), { query: 'completely novel unseen topic' });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(typeof data.method).toBe('string');
    expect(Array.isArray(data.results)).toBe(true);
  }, 30_000);

  it('surfaces KG triplets for relationship-shaped queries (router → kg, RRF fusion)', async () => {
    await seedKg();
    const res = await search(PORT_A, readPairing(), {
      query: 'how does AlphaService relate to BetaStore?',
      limit: 6,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    const triplet = (data.results as Array<Record<string, unknown>>).find(
      (r) => r.triplet === true,
    );
    expect(
      triplet,
      `expected a KG triplet in results: ${JSON.stringify(data.results).slice(0, 400)}`,
    ).toBeTruthy();
    expect(String(triplet?.content)).toContain('AlphaService');
    expect(String(triplet?.content)).toContain('BetaStore');
    // Native score preserved and above the hooks' 0.35 relevance floor.
    expect(Number(triplet?.score)).toBeGreaterThanOrEqual(0.35);
  }, 60_000);

  it('global scope never errors and returns the same shape', async () => {
    const res = await search(PORT_A, readPairing(), {
      query: 'what rules should I always follow?',
      scope: 'global',
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(data.results)).toBe(true);
  }, 30_000);
});

describe('dashboard-token pairing guard (secondary instances)', () => {
  it('a secondary server does not clobber the primary pairing; it writes dashboard-token-<port>', async () => {
    // control.json marks server A as the live primary — exactly what
    // control-start.cjs writes after a spawn.
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'control.json'),
      JSON.stringify({
        pid: serverA?.pid,
        port: PORT_A,
        url: `http://localhost:${PORT_A}`,
        startedAt: new Date().toISOString(),
      }),
    );
    const primaryBefore = readPairing();

    serverB = spawnServer(PORT_B);
    await waitForBind(PORT_B);
    await waitForServer(PORT_B);
    // Generous timeout: under full-suite parallel load (with the native
    // better-sqlite3 backend now active), the secondary pairing write can
    // exceed the 5s default while the server is still perfectly healthy.
    await waitForFile(`dashboard-token-${PORT_B}`, 20000);

    expect(readPairing()).toBe(primaryBefore); // not clobbered
    const portPairing = readPairing(`dashboard-token-${PORT_B}`);
    expect(portPairing).toMatch(/^[0-9a-f]{32,}$/);
    expect(portPairing).not.toBe(primaryBefore);

    // The port-scoped pairing actually authenticates against the secondary.
    const res = await search(PORT_B, portPairing, { query: 'sanity check on secondary' });
    expect(res.status).toBe(200);
    // And the primary keeps answering with the untouched primary pairing.
    const resA = await search(PORT_A, primaryBefore, { query: 'sanity check on primary' });
    expect(resA.status).toBe(200);
  }, 60_000);
});
