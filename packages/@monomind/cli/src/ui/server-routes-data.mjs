import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectAll } from './collector.mjs';
import { _sjCalcCost, _sjHasPricing } from './server.mjs';
import { _readHeadText, _readTailLines } from './server-fileutils.mjs';
import { parseSessionLines } from './server-session-utils.mjs';
import { pathToSlug } from './server-slug.mjs';

// Session/project data-browsing routes.
// Registered, in order, by startServer's request dispatcher in server.mjs.
export async function handleRoutesData(req, res, url, corsOrigin, ctx) {
  const { projectDir } = ctx;
  // --------------------------------------------------------- GET /api/data
  if (req.method === 'GET' && url === '/api/data') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || projectDir || process.cwd();
      const snapshot = await collectAll(dir);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(snapshot));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ------------------------------------------------------ GET /api/session
  if (req.method === 'GET' && url === '/api/session') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const file = qs.get('file');
    const limit = Math.min(parseInt(qs.get('limit') || '600', 10), 3000);
    if (!file) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing file param' }));
      return true;
    }
    try {
      // Security: validate that the requested file stays within this Claude
      // Code install's session-transcript store. The dashboard legitimately
      // browses sessions across multiple projects (see the projectsBase glob
      // above), so this is scoped to ~/.claude/projects rather than the full
      // home directory — narrow enough that ?file=/etc/passwd or a sibling
      // dir under $HOME can't be read, wide enough for real usage.
      const _resolvedFile = path.resolve(file);
      const _sessionsRoot = path.join(os.homedir(), '.claude', 'projects');
      // Bare-prefix check (no path.sep) is bypassable: a sibling dir name that
      // happens to start with the same string would pass a naive startsWith.
      // Require the separator (or exact equality to the root itself) so only
      // true descendants pass.
      if (_resolvedFile !== _sessionsRoot && !_resolvedFile.startsWith(_sessionsRoot + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied: file must be within ~/.claude/projects' }));
        return true;
      }
      // Only allow JSONL files (session logs).
      if (!_resolvedFile.endsWith('.jsonl')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied: only .jsonl files are permitted' }));
        return true;
      }
      const raw = fs.readFileSync(_resolvedFile, 'utf8');
      const allLines = raw.split('\n').filter(Boolean);
      const lines = allLines.slice(-limit);
      const events = parseSessionLines(lines);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ events, total: allLines.length, shown: lines.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ------------------------------------------------------- GET /api/session-journal
  if (req.method === 'GET' && url === '/api/session-journal') {
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
          .slice(0, 50);
      } catch {}

      const sessions = [];
      for (const { f, mtime } of sessionFiles) {
        const fp = path.join(projectClaudeDir, f);
        const id = f.replace('.jsonl', '');
        let lastPrompt = '',
          summaries = [],
          totalDurationMs = 0,
          totalMessages = 0,
          firstTs = null,
          lastTs = null,
          totalCost = 0,
          toolCalls = 0,
          userMessages = 0,
          cacheReadTokens = 0,
          totalInputTokens = 0,
          errorCount = 0;
        const modelBreakdown = {};
        const unknownPricingModels = new Set();
        const filesTouchedSet = new Set();
        try {
          const lines = _readTailLines(fp);
          let pendingCompact = false;
          for (const line of lines) {
            let e;
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            if (e.timestamp) {
              if (!firstTs) firstTs = e.timestamp;
              lastTs = e.timestamp;
            }
            if (e.type === 'last-prompt' && e.lastPrompt) lastPrompt = e.lastPrompt;
            if (e.type === 'user') {
              userMessages++;
              for (const b of e.message?.content || []) {
                if (b && b.type === 'tool_result' && b.is_error) errorCount++;
              }
            }
            if (e.type === 'system' && e.subtype === 'compact_boundary') pendingCompact = true;
            if (pendingCompact && e.type === 'user') {
              const msg = e.message || {};
              const ct = msg.content || [];
              let text = '';
              if (Array.isArray(ct)) {
                for (const b of ct) {
                  if (b && b.type === 'text') {
                    text = b.text;
                    break;
                  }
                }
              } else if (typeof ct === 'string') text = ct;
              const m = text.match(/Summary:\s*([\s\S]+)/);
              if (m) summaries.push({ ts: e.timestamp, text: m[1].trim() });
              pendingCompact = false;
            }
            if (e.type === 'assistant') {
              const msg = e.message || {};
              for (const block of msg.content || []) {
                if (block && block.type === 'tool_use') {
                  toolCalls++;
                  if (
                    ['Write', 'Edit', 'Read', 'MultiEdit'].includes(block.name) &&
                    block.input?.file_path
                  ) {
                    filesTouchedSet.add(path.basename(block.input.file_path));
                  }
                }
              }
              if (msg.usage && msg.model) {
                const c = _sjCalcCost(msg.model, msg.usage);
                // null = unpriced model: sum only priced models; flagged via unknownPricing below.
                if (c !== null) totalCost += c;
                const mk = msg.model.replace(/@.*$/, '').replace(/-\d{8}$/, '');
                if (!modelBreakdown[mk]) modelBreakdown[mk] = { calls: 0, cost: 0 };
                modelBreakdown[mk].calls++;
                modelBreakdown[mk].cost += c ?? 0;
                // A model absent from the pricing table contributes 0 to the sum. Flag it
                // instead of letting the UI render an authoritative-looking $0.00.
                if (!_sjHasPricing(msg.model)) {
                  modelBreakdown[mk].unknownPricing = true;
                  unknownPricingModels.add(mk);
                }
                cacheReadTokens += msg.usage.cache_read_input_tokens || 0;
                totalInputTokens +=
                  (msg.usage.input_tokens || 0) +
                  (msg.usage.cache_creation_input_tokens || 0) +
                  (msg.usage.cache_read_input_tokens || 0);
              }
            }
            if (e.type === 'system' && e.subtype === 'turn_duration') {
              totalDurationMs += e.durationMs || 0;
              if ((e.messageCount || 0) > totalMessages) totalMessages = e.messageCount;
            }
          }
        } catch {}
        const filesTouched = [...filesTouchedSet].slice(0, 20);
        const compactCount = summaries.length;
        const summary = summaries.length ? summaries[summaries.length - 1].text : null;
        // costIncomplete => totalCost is a LOWER BOUND: at least one model had no
        // pricing row, so its spend is missing from the sum entirely.
        sessions.push({
          id,
          mtime,
          firstTs,
          lastTs,
          lastPrompt,
          summaries,
          summary,
          compactCount,
          errorCount,
          totalDurationMs,
          totalMessages,
          totalCost,
          costIncomplete: unknownPricingModels.size > 0,
          unknownPricingModels: [...unknownPricingModels],
          toolCalls,
          userMessages,
          cacheReadTokens,
          totalInputTokens,
          modelBreakdown,
          filesTouched,
          file: fp,
        });
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ sessions }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ------------------------------------------------------- GET /api/search-sessions
  if (req.method === 'GET' && url === '/api/search-sessions') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const dir = qs.get('dir') || '';
    const q = (qs.get('q') || '').toLowerCase().trim();
    if (!q || q.length < 2) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ results: [] }));
      return true;
    }
    try {
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
          .slice(0, 20);
      } catch {}
      const results = [];
      for (const { f, mtime } of sessionFiles) {
        const fp = path.join(projectClaudeDir, f);
        const id = f.replace('.jsonl', '');
        let lastPrompt = '';
        const matches = [];
        try {
          const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
          for (const line of lines) {
            let e;
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            if (e.type === 'last-prompt' && e.lastPrompt) lastPrompt = e.lastPrompt;
            if (e.type === 'user') {
              const msg = e.message || {};
              const ct = msg.content || [];
              let text = '';
              if (Array.isArray(ct)) {
                for (const b of ct) {
                  if (b && b.type === 'text') {
                    text = b.text;
                    break;
                  }
                }
              } else if (typeof ct === 'string') text = ct;
              if (text.toLowerCase().includes(q))
                matches.push({ text: text.slice(0, 150), ts: e.timestamp });
            }
            if (matches.length >= 3) break;
          }
        } catch {}
        if (matches.length) results.push({ id, file: fp, lastPrompt, mtime, matches });
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ results, q }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ---------------------------------------------------------- GET /api/session-errors
  if (req.method === 'GET' && url === '/api/session-errors') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
    // Cap sessionId to prevent O(n×m) DoS via f.includes(sessionId) substring
    // match against every filename when sessionId is a very long string.
    const _rawSessId = qs.get('id') || '';
    const sessionId = _rawSessId.slice(0, 256);
    const slug = pathToSlug(d);
    const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
    try {
      const files = fs
        .readdirSync(projectClaudeDir)
        .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'));
      let fp = null;
      // Find the file matching sessionId
      for (const f of files) {
        if (f.includes(sessionId) || sessionId === f.replace('.jsonl', '')) {
          fp = path.join(projectClaudeDir, f);
          break;
        }
      }
      if (!fp) {
        // fallback: find by scanning — the sessionId lives in the first JSONL line, so a
        // small head-read is enough; no need to load the whole (potentially huge) file.
        for (const f of files) {
          const head = _readHeadText(path.join(projectClaudeDir, f));
          const firstLine = head.split('\n', 1)[0];
          if (firstLine) {
            try {
              const first = JSON.parse(firstLine);
              if (first.sessionId === sessionId) {
                fp = path.join(projectClaudeDir, f);
                break;
              }
            } catch {}
          }
        }
      }
      if (!fp) {
        res.writeHead(404);
        res.end(JSON.stringify({ errors: [] }));
        return true;
      }
      // Only the most recent portion of the file matters for a dashboard error feed —
      // tail-cap the read so a multi-hundred-MB session log doesn't get buffered whole.
      const lines = _readTailLines(fp);
      const errors = [];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          const content = obj.message?.content;
          if (!Array.isArray(content)) continue;
          for (const block of content) {
            if (block.type === 'tool_result' && block.is_error) {
              const errText = Array.isArray(block.content)
                ? block.content.map((c) => c.text || '').join('')
                : String(block.content || '');
              if (errText)
                errors.push({ toolUseId: block.tool_use_id || '', text: errText.slice(0, 500) });
            }
          }
        } catch {}
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ errors: errors.slice(0, 50) }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ errors: [], error: err.message }));
    }
    return true;
  }

  return false;
}
