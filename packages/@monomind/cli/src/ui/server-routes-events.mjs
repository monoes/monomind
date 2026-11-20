import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectAll } from './collector.mjs';
import { _sjCalcCost, _sjHasPricing } from './server.mjs';
import { watchSafely } from './server-net.mjs';
import { pathToSlug, resolveSlugToPath } from './server-slug.mjs';
import { addSseClient, removeSseClient } from './sse-manager.mjs';

// Event/metrics/streaming routes.
// Registered, in order, by startServer's request dispatcher in server.mjs.
export async function handleRoutesEvents(req, res, url, corsOrigin, ctx) {
  const { projectDir } = ctx;
  // ------------------------------------------------------- GET /api/tool-errors
  if (req.method === 'GET' && url === '/api/tool-errors') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      const slug = pathToSlug(d);
      const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
      let sessionFiles = [];
      try {
        sessionFiles = fs
          .readdirSync(projectClaudeDir)
          .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'))
          .map((f) => {
            try {
              return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs };
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 10);
      } catch {}
      // tool_use id → name map, then count is_error:true tool_result per tool name
      const errorCounts = {},
        totalCounts = {};
      for (const { f } of sessionFiles) {
        const fp = path.join(projectClaudeDir, f);
        try {
          const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
          const toolIdMap = {};
          for (const line of lines) {
            let e;
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            if (e.type === 'assistant') {
              for (const b of e.message?.content || []) {
                if (b && b.type === 'tool_use') {
                  toolIdMap[b.id] = b.name;
                  totalCounts[b.name] = (totalCounts[b.name] || 0) + 1;
                }
              }
            }
            if (e.type === 'user') {
              for (const b of e.message?.content || []) {
                if (b && b.type === 'tool_result' && b.is_error) {
                  const name = toolIdMap[b.tool_use_id] || '?';
                  errorCounts[name] = (errorCounts[name] || 0) + 1;
                }
              }
            }
          }
        } catch {}
      }
      const errors = Object.entries(errorCounts)
        .map(([tool, count]) => ({ tool, count, total: totalCounts[tool] || count }))
        .sort((a, b) => b.count - a.count);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ errors }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ------------------------------------------------------- GET /api/tool-ranking
  if (req.method === 'GET' && url === '/api/tool-ranking') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      const slug = pathToSlug(d);
      const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
      let sessionFiles = [];
      try {
        sessionFiles = fs
          .readdirSync(projectClaudeDir)
          .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'))
          .map((f) => {
            try {
              return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs };
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 30);
      } catch {}
      const toolCounts = {},
        errorCounts = {};
      for (const { f } of sessionFiles) {
        const fp = path.join(projectClaudeDir, f);
        try {
          const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
          const toolIdMap = {};
          for (const line of lines) {
            let e;
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            if (e.type === 'assistant') {
              for (const b of e.message?.content || []) {
                if (b && b.type === 'tool_use') {
                  toolIdMap[b.id] = b.name;
                  toolCounts[b.name] = (toolCounts[b.name] || 0) + 1;
                }
              }
            }
            if (e.type === 'user') {
              for (const b of e.message?.content || []) {
                if (b && b.type === 'tool_result' && b.is_error) {
                  const name = toolIdMap[b.tool_use_id] || '?';
                  errorCounts[name] = (errorCounts[name] || 0) + 1;
                }
              }
            }
          }
        } catch {}
      }
      const tools = Object.entries(toolCounts)
        .map(([tool, count]) => ({ tool, count, errors: errorCounts[tool] || 0 }))
        .sort((a, b) => b.count - a.count);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ tools }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ------------------------------------------------------- GET /api/project-costs
  if (req.method === 'GET' && url === '/api/project-costs') {
    try {
      const projectsBase = path.join(os.homedir(), '.claude', 'projects');
      let slugDirs = [];
      try {
        slugDirs = fs
          .readdirSync(projectsBase, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {}
      const projectCosts = [];
      for (const slug of slugDirs) {
        const projDir = path.join(projectsBase, slug);
        const projPath = resolveSlugToPath(slug, projDir);
        let sessionFiles = [];
        try {
          sessionFiles = fs
            .readdirSync(projDir)
            .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'))
            .map((f) => path.join(projDir, f));
        } catch {}
        if (!sessionFiles.length) continue;
        let totalCost = 0;
        const unknownPricingModels = new Set();
        for (const fp of sessionFiles) {
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
            for (const line of lines) {
              let e;
              try {
                e = JSON.parse(line);
              } catch {
                continue;
              }
              if (e.type === 'assistant' && e.message?.usage) {
                const _m = e.message.model || '';
                totalCost += _sjCalcCost(_m, e.message.usage);
                if (!_sjHasPricing(_m))
                  unknownPricingModels.add(_m.replace(/@.*$/, '').replace(/-\d{8}$/, ''));
              }
            }
          } catch {}
        }
        // Include projects whose entire spend is on unpriced models — previously they
        // were dropped by `totalCost > 0` and simply vanished from the cost list.
        if (totalCost > 0 || unknownPricingModels.size > 0) {
          projectCosts.push({
            path: projPath,
            cost: totalCost,
            sessions: sessionFiles.length,
            costIncomplete: unknownPricingModels.size > 0,
            unknownPricingModels: [...unknownPricingModels],
          });
        }
      }
      projectCosts.sort((a, b) => b.cost - a.cost);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ projects: projectCosts }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ------------------------------------------------------- GET /api/projects
  if (req.method === 'GET' && url === '/api/projects') {
    try {
      const projectsBase = path.join(os.homedir(), '.claude', 'projects');
      let slugDirs = [];
      try {
        slugDirs = fs
          .readdirSync(projectsBase, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {}
      const projects = slugDirs
        .map((slug) => {
          const projDir = path.join(projectsBase, slug);
          const projPath = resolveSlugToPath(slug, projDir);
          const name = path.basename(projPath) || slug.split('-').filter(Boolean).pop() || slug;
          let sessionCount = 0;
          let lastActivity = 0;
          let memoryCount = 0;
          try {
            const files = fs
              .readdirSync(projDir)
              .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'));
            sessionCount = files.length;
            for (const f of files) {
              try {
                const st = fs.statSync(path.join(projDir, f));
                if (st.mtimeMs > lastActivity) lastActivity = st.mtimeMs;
              } catch {}
            }
          } catch {}
          try {
            const memDir = path.join(projDir, 'memory');
            memoryCount = fs
              .readdirSync(memDir)
              .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').length;
          } catch {}
          return {
            slug,
            path: projPath,
            name,
            sessionCount,
            memoryCount,
            lastActivity: lastActivity || null,
          };
        })
        .filter((p) => p.sessionCount > 0 || fs.existsSync(path.join(p.path, '.monomind')))
        .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ projects }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ---------------------------------------------------------- GET /api/events-stream (SSE)
  if (req.method === 'GET' && url.startsWith('/api/events-stream')) {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
    const slug = pathToSlug(d);
    const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });
    const send = (ev, data) => {
      try {
        res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };
    send('connected', { ts: Date.now() });
    let watcher = null;
    try {
      watcher = watchSafely(
        fs.watch(projectClaudeDir, { persistent: false }, (evtype) => {
          if (evtype === 'change' || evtype === 'rename') send('update', { ts: Date.now() });
        }),
        'session-sse',
      );
    } catch {}
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {}
    }, 20000);
    req.on('close', () => {
      clearInterval(pingInterval);
      try {
        watcher?.close();
      } catch {}
    });
    return true;
  }

  // ------------------------------------------------------- GET /api/stream
  if (req.method === 'GET' && url === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      'X-Accel-Buffering': 'no',
    });

    // Keep the connection alive with periodic comments
    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 20_000);

    addSseClient(res);

    req.on('close', () => {
      clearInterval(keepAlive);
      removeSseClient(res);
    });

    // Send the initial snapshot immediately
    try {
      const snapshot = await collectAll(projectDir);
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
    return true;
  }

  return false;
}
