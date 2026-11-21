import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Health view routes: `monomind doctor --json --read-only --offline` for the
// project this dashboard serves, run on demand.
//
//   POST /api/doctor/run → 202 { running: true } (starts a run unless one is running)
//   GET  /api/doctor     → { running, ranAt, durationMs, result, error }
//
// Read-only and offline, so a run changes no file and makes no network call
// (commands/doctor-mode.ts). It always checks the server's own project: there is
// no dir parameter. One run at a time; the last result is kept in memory.

const TIMEOUT_MS = 180_000;
const MAX_OUTPUT = 4 * 1024 * 1024;

/** The CLI entry point next to this module (src/ui and dist/src/ui sit at different depths). */
function cliBin() {
  for (const rel of ['../../bin/cli.js', '../../../bin/cli.js']) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** A doctor runner with its own state; `spawnImpl` is injectable for tests. */
export function createDoctorRunner({
  spawnImpl = spawn,
  bin = cliBin,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const state = { running: false, ranAt: null, durationMs: null, result: null, error: null };

  function start(projectDir) {
    if (state.running) return false;
    const entry = bin();
    if (!entry) {
      state.error = 'monomind CLI entry point not found';
      return false;
    }
    state.running = true;
    state.error = null;
    const started = Date.now();
    let out = '';
    let done = false;
    const child = spawnImpl(
      process.execPath,
      [entry, 'doctor', '--json', '--read-only', '--offline'],
      { cwd: projectDir, env: process.env, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      state.running = false;
      state.ranAt = new Date().toISOString();
      state.durationMs = Date.now() - started;
      if (error) {
        state.error = error;
        return;
      }
      try {
        // doctor exits 1 when a check fails; the JSON on stdout is still the report.
        state.result = JSON.parse(out);
      } catch {
        state.error = 'doctor did not print a JSON report';
      }
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(`doctor did not finish within ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      out += d;
      if (out.length > MAX_OUTPUT) {
        child.kill('SIGTERM');
        finish('doctor output too large');
      }
    });
    child.on('error', (e) => finish(e.message));
    child.on('close', () => finish(null));
    return true;
  }

  return { state, start };
}

const defaultRunner = createDoctorRunner();

export async function handleDoctorRoutes(req, res, url, corsOrigin, ctx, runner = defaultRunner) {
  const json = (status, body) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });
    res.end(JSON.stringify(body));
    return true;
  };

  if (req.method === 'GET' && url === '/api/doctor') {
    return json(200, { ...runner.state, projectDir: ctx.projectDir });
  }

  if (req.method === 'POST' && url === '/api/doctor/run') {
    runner.start(ctx.projectDir);
    if (!runner.state.running && runner.state.error)
      return json(500, { error: runner.state.error });
    return json(202, { running: true });
  }

  return false;
}
