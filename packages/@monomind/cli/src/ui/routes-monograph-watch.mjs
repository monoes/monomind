import fs from 'node:fs';
import path from 'node:path';
import { resolveAllowedProjectDir } from './server-fileutils.mjs';

// Monograph dashboard routes (extracted from routes-monograph.mjs).
// Registered, in order, by handleMonographRoutes in routes-monograph.mjs.
export async function handleMonographWatchRoutes(req, res, url, corsOrigin, ctx) {
  // -------------------------------------------------- GET /api/monograph-watch-status
  if (req.method === 'GET' && url === '/api/monograph-watch-status') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      let running = false,
        pid = null;
      for (const pidName of ['monograph.watch.pid', 'monograph-watch.pid']) {
        try {
          const pp = path.join(d, '.monomind', pidName);
          pid = parseInt(fs.readFileSync(pp, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          if (!ctx.looksLikeOurProcess(pid, d)) continue;
          running = true;
          break;
        } catch {}
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ running, pid }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- POST /api/monograph-watch-toggle
  if (req.method === 'POST' && url === '/api/monograph-watch-toggle') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const d = resolveAllowedProjectDir(qs.get('dir'), ctx.projectDir);
      if (!d) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'dir is not the server project or a known project' }));
        return true;
      }
      const pidPath = path.join(d, '.monomind', 'monograph.watch.pid');
      let wasRunning = false;
      for (const pidName of ['monograph.watch.pid', 'monograph-watch.pid']) {
        try {
          const pp = path.join(d, '.monomind', pidName);
          const pid = parseInt(fs.readFileSync(pp, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          if (!ctx.looksLikeOurProcess(pid, d)) continue;
          wasRunning = true;
          process.kill(pid, 'SIGTERM');
          try {
            fs.unlinkSync(pp);
          } catch {}
        } catch {}
      }

      if (wasRunning) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ running: false, action: 'stopped' }));
      } else {
        const { spawn: sp } = await import('node:child_process');
        const child = sp(process.execPath, [process.argv[1], 'monograph', 'watch'], {
          stdio: 'ignore',
          detached: true,
          cwd: d,
          env: process.env,
        });
        child.unref();
        try {
          fs.mkdirSync(path.join(d, '.monomind'), { recursive: true });
        } catch {}
        try {
          fs.writeFileSync(pidPath, String(child.pid));
        } catch {}
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ running: true, pid: child.pid, action: 'started' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }
  return false;
}
