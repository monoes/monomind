/**
 * The hook process's global safety exit: extended for the `route` hook only,
 * and only while a Jev decision model is configured, so a slow Jev pick still
 * lands; every other hook (above all the pre-bash/pre-write gates) keeps 5 s.
 * The Jev hook window itself is capped at 3 s, so the route hook stays at 5 s.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const HANDLER = path.resolve(__dirname, '../../.claude/helpers/hook-handler.cjs');
const RH_PATH = path.resolve(__dirname, '../../.claude/helpers/handlers/route-handler.cjs');

// Never let the user's own Jev setup (hosted TypeSafe, a custom URL) leak in.
const JEV_ENV = [
  'MONOMIND_JEV',
  'MONOMIND_JEV_URL',
  'MONOMIND_JEV_HOSTED',
  'MONOMIND_JEV_API_KEY',
  'TYPESAFE_API_KEY',
  'MONOMIND_JEV_TIMEOUT_MS',
  'MONOMIND_JEV_HOOK_TIMEOUT_MS',
  'MONOMIND_SDK_AGENT',
  'MONOMIND_HOOK_QUIET',
];

function cleanEnv(extra) {
  const env = { ...process.env };
  for (const k of JEV_ENV) delete env[k];
  return { ...env, ...extra };
}

describe('hook safety exit', () => {
  const { safetyTimeoutMs } = require(HANDLER);
  const jev = { MONOMIND_JEV_URL: 'http://127.0.0.1:3999', MONOMIND_JEV_HOOK_TIMEOUT_MS: '8000' };

  it('keeps the route hook at 5 s even when the env asks Jev for more (the window caps at 3 s)', () => {
    expect(safetyTimeoutMs('route', jev)).toBe(5000);
    expect(safetyTimeoutMs('route', { ...jev, MONOMIND_JEV_HOOK_TIMEOUT_MS: '10000' })).toBe(5000);
  });

  it('keeps 5 s for every other hook, the security gates above all', () => {
    for (const cmd of ['pre-bash', 'pre-write', 'post-edit', 'session-restore']) {
      expect(safetyTimeoutMs(cmd, jev)).toBe(5000);
    }
  });

  it('keeps 5 s for the route hook when Jev is off, unconfigured or short', () => {
    expect(safetyTimeoutMs('route', { ...jev, MONOMIND_JEV: 'off' })).toBe(5000);
    expect(safetyTimeoutMs('route', { MONOMIND_JEV_HOOK_TIMEOUT_MS: '8000' })).toBe(5000);
    expect(safetyTimeoutMs('route', { MONOMIND_JEV_URL: 'http://127.0.0.1:3999' })).toBe(5000);
  });

  it('shares its deadline with the route handler', () => {
    delete require.cache[RH_PATH];
    const { routeDeadlineMs } = require(RH_PATH);
    expect(routeDeadlineMs(jev)).toBe(safetyTimeoutMs('route', jev));
  });
});

describe('route hook with a slow Jev', () => {
  let tmpDir;
  let server;
  let sockets;

  // A Jev stub that answers /v1/systemone after `delayMs` (never when null).
  async function startJev(delayMs) {
    sockets = new Set();
    server = http.createServer((req, res) => {
      req.resume();
      if (!req.url.includes('/v1/systemone')) {
        res.writeHead(404).end();
        return;
      }
      if (delayMs === null) return;
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            answers: {
              agent: {
                type: 'choice',
                choice: 'tester',
                confidence: 0.9,
                probabilities: { tester: 0.9, coder: 0.1 },
              },
            },
          }),
        );
      }, delayMs);
    });
    server.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${server.address().port}`;
  }

  function runRoute(jevUrl) {
    return new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(process.execPath, [HANDLER, 'route'], {
        cwd: tmpDir,
        env: cleanEnv({
          CLAUDE_PROJECT_DIR: tmpDir,
          MONOMIND_JEV_URL: jevUrl,
          // The user's env from the incident: capped to the 3 s hook window.
          MONOMIND_JEV_HOOK_TIMEOUT_MS: '10000',
        }),
      });
      let stderr = '';
      let stdout = '';
      child.stdout.on('data', (d) => {
        stdout += d;
      });
      child.stderr.on('data', (d) => {
        stderr += d;
      });
      child.on('close', (code) => resolve({ code, stdout, stderr, elapsed: Date.now() - started }));
      child.stdin.end(JSON.stringify({ prompt: 'write unit tests for the invoice parser' }));
    });
  }

  const lastRoute = () =>
    JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'last-route.json'), 'utf-8'));

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-jev-'));
    fs.mkdirSync(path.join(tmpDir, '.monomind'));
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'registry.json'),
      JSON.stringify({
        agents: [
          { slug: 'coder', name: 'coder', category: 'core', description: 'Writes code' },
          { slug: 'tester', name: 'tester', category: 'core', description: 'Writes tests' },
        ],
      }),
    );
  });

  afterEach(async () => {
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('waits for a Jev pick that answers inside the 3 s window and records it', async () => {
    const r = await runRoute(await startJev(2000));
    expect(r.stderr).not.toContain('global timeout');
    expect(r.code).toBe(0);
    expect(r.elapsed).toBeGreaterThanOrEqual(1900);
    expect(lastRoute()).toMatchObject({
      agentSlug: 'tester',
      reason: 'jev (custom)',
    });
    expect(r.stdout).toContain('[PICK] agent: tester');
  }, 30000);

  it('gives up on a dead endpoint after the capped 3 s window, not the 10 s the env asks for', async () => {
    const r = await runRoute(await startJev(null));
    expect(r.stderr).not.toContain('global timeout');
    expect(r.code).toBe(0);
    expect(r.elapsed).toBeGreaterThanOrEqual(2900);
    expect(r.elapsed).toBeLessThan(5000);
    expect(lastRoute().reason).not.toMatch(/^jev/);
  }, 30000);
});
