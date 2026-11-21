import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSectionData } from './server-session-utils.mjs';
import { resolveSlugToPath } from './server-slug.mjs';

// Docs/knowledge-content browsing routes.
// Registered, in order, by startServer's request dispatcher in server.mjs.
export async function handleRoutesDocs(req, res, url, corsOrigin, ctx) {
  const { projectDir } = ctx;
  // ------------------------------------------------------- GET /api/global-docs
  // Lists mastermind-generated markdown documents across ALL known projects,
  // plus the global brain. Returns metadata only — content is fetched
  // on demand via /api/global-doc/read. Ordered by mtime (newest first)
  // by the caller; the server returns enough fields for the client to sort
  // and group either way.
  if (req.method === 'GET' && url.startsWith('/api/global-docs')) {
    try {
      // 1. Gather candidate project roots: every project the dashboard
      //    knows about (from ~/.claude/projects) + the global brain dir.
      const projectsBase = path.join(os.homedir(), '.claude', 'projects');
      const roots = [];
      try {
        for (const slug of fs.readdirSync(projectsBase)) {
          const projDir = path.join(projectsBase, slug);
          if (!fs.statSync(projDir).isDirectory()) continue;
          const resolved = resolveSlugToPath(slug, projDir);
          if (resolved && fs.existsSync(resolved)) roots.push(resolved);
        }
      } catch {
        /* projects tree absent — fine */
      }
      const globalBrain =
        process.env.MONOMIND_GLOBAL_BRAIN_DIR ||
        path.join(os.homedir(), '.monomind', 'global-brain');
      if (fs.existsSync(globalBrain)) roots.push(globalBrain);

      // 2. Per-root, scan the known mastermind output directories.
      //    Order in this array is the category-priority order used when
      //    no doc-specific category is inferable from the filename.
      const DOC_DIRS = [
        { sub: ['docs', 'mastermind', 'plans'], category: 'plan' },
        { sub: ['docs', 'mastermind', 'specs'], category: 'spec' },
        { sub: ['docs', 'mastermind', 'reviews'], category: 'review' },
        { sub: ['docs', 'mastermind', 'reports'], category: 'report' },
        { sub: ['docs', 'mastermind', 'wiki'], category: 'wiki' },
        { sub: ['docs', 'mastermind', 'decisions'], category: 'decision' },
        { sub: ['docs', 'mastermind', 'ideas'], category: 'idea' },
        { sub: ['docs', 'mastermind', 'improvements'], category: 'improvement' },
        { sub: ['docs', 'mastermind', 'tasks'], category: 'task' },
        { sub: ['docs', 'mastermind'], category: 'mastermind' },
        { sub: ['docs', 'improvements'], category: 'improvement' },
        { sub: ['docs', 'ideas'], category: 'idea' },
        { sub: ['docs', 'tasks'], category: 'task' },
        { sub: ['docs', 'adrs'], category: 'decision' },
        { sub: ['docs', 'specs'], category: 'spec' },
        { sub: ['docs', 'reviews'], category: 'review' },
        { sub: ['docs', 'plans'], category: 'plan' },
        { sub: ['docs', 'reports'], category: 'report' },
        { sub: ['docs', 'decisions'], category: 'decision' },
        { sub: ['docs', 'wiki'], category: 'wiki' },
      ];

      const seen = new Set(); // dedupe by absolute path
      const docs = [];
      for (const root of roots) {
        for (const { sub, category } of DOC_DIRS) {
          const dir = path.join(root, ...sub);
          if (!fs.existsSync(dir)) continue;
          let files = [];
          try {
            files = fs.readdirSync(dir);
          } catch {
            continue;
          }
          for (const fname of files) {
            if (!fname.endsWith('.md') || fname.startsWith('._')) continue;
            const fullPath = path.join(dir, fname);
            let st;
            try {
              st = fs.statSync(fullPath);
            } catch {
              continue;
            }
            if (!st.isFile()) continue;
            if (seen.has(fullPath)) continue;
            seen.add(fullPath);
            // Pull the first H1 (or first non-empty line) as the title.
            let title = fname.replace(/\.md$/i, '');
            let preview = '';
            try {
              const raw = fs.readFileSync(fullPath, 'utf8').slice(0, 4000);
              const h1 = raw.match(/^#\s+(.+)$/m);
              if (h1) title = h1[1].trim();
              // First non-heading, non-frontmatter paragraph as a preview.
              preview = raw
                .replace(/^---[\s\S]*?---/, '')
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^[<|!]/.test(l))
                .slice(0, 1)
                .join(' ')
                .slice(0, 180);
            } catch {
              /* unreadable — keep defaults */
            }
            docs.push({
              path: fullPath,
              project:
                root === globalBrain
                  ? 'Global Brain'
                  : root.split('/').filter(Boolean).pop() || root,
              projectPath: root,
              category,
              filename: fname,
              title,
              preview,
              sizeBytes: st.size,
              mtime: st.mtimeMs,
              date: new Date(st.mtimeMs).toISOString(),
            });
          }
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ docs }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ------------------------------------------------------- GET /api/global-doc/read
  // Returns the raw markdown body of a single doc. The `path` query param
  // must resolve to a file under one of the project roots or the global
  // brain — anything else is rejected with 403 to avoid an arbitrary-file-read.
  if (req.method === 'GET' && url.startsWith('/api/global-doc/read')) {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const target = qs.get('path');
      if (!target || typeof target !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'path query param required' }));
        return true;
      }
      let resolved = path.resolve(target);
      // Resolve symlinks so the containment check can't be bypassed by a
      // symlink that lexically sits inside an allowed root but physically
      // points outside it. Fall back to the lexical path if the target
      // doesn't exist yet — the existsSync check below will 403 it anyway.
      try {
        resolved = fs.realpathSync(resolved);
      } catch {}
      // Reconstruct the allowed roots set and verify containment.
      const projectsBase = path.join(os.homedir(), '.claude', 'projects');
      const allowedRoots = [];
      try {
        for (const slug of fs.readdirSync(projectsBase)) {
          const resolvedProj = resolveSlugToPath(slug, path.join(projectsBase, slug));
          if (resolvedProj) allowedRoots.push(resolvedProj);
        }
      } catch {}
      const globalBrain =
        process.env.MONOMIND_GLOBAL_BRAIN_DIR ||
        path.join(os.homedir(), '.monomind', 'global-brain');
      if (fs.existsSync(globalBrain)) allowedRoots.push(globalBrain);
      const isAllowed = allowedRoots.some((root) => {
        const rel = path.relative(root, resolved);
        return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
      });
      if (!isAllowed || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'path is outside the allowed project roots' }));
        return true;
      }
      if (!resolved.toLowerCase().endsWith('.md')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'only markdown (.md) files are readable' }));
        return true;
      }
      const body = fs.readFileSync(resolved, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ path: resolved, body }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ------------------------------------------------------- GET /api/adrs
  if (req.method === 'GET' && url.startsWith('/api/adrs')) {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());

      const adrDirs = [{ path: path.join(d, 'docs', 'adrs'), group: 'all' }];

      const adrs = [];
      for (const { path: adrDir, group: _group } of adrDirs) {
        if (!fs.existsSync(adrDir)) continue;
        // Skip AppleDouble junk ('._*') — exFAT volumes litter these and they aren't real ADRs
        const files = fs
          .readdirSync(adrDir)
          .filter(
            (f) =>
              f.endsWith('.md') &&
              !f.startsWith('._') &&
              f !== 'README.md' &&
              f !== 'v3-adrs.md' &&
              f !== 'SECURITY-REVIEW-SUMMARY.md',
          );
        for (const fname of files.sort()) {
          const resolvedGroup = /^ADR-G/i.test(fname) ? 'guidance' : 'implementation';
          try {
            const raw = fs.readFileSync(path.join(adrDir, fname), 'utf8');
            const titleMatch = raw.match(/^#\s+(.+)$/m);
            const header = raw.split('\n').slice(0, 20).join('\n');
            const statusTableMatch = header.match(
              /^\|\s*\*{0,2}Status\*{0,2}\s*\|\s*\*{0,2}([^|*\n]{2,40}?)\*{0,2}\s*\|/im,
            );
            const statusInlineMatch = header.match(
              /\*\*Status[:\s]+\*?\*?\s*(Accepted|Implemented|Proposed|Superseded|Deprecated|Draft|Rejected|Complete|Active|Retired)[^*]*/i,
            );
            const statusMatch = statusTableMatch || statusInlineMatch;
            const dateInlineMatch = header.match(
              /\*\*Date[:\s]+\*?\*?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i,
            );
            const dateMatch =
              raw.match(/\|\s*\*{0,2}Date\*{0,2}\s*\|\s*\*{0,2}([^|*\n]+?)\*{0,2}\s*\|/i) ||
              dateInlineMatch ||
              raw.match(/Date[:\s]+([0-9]{4}-[0-9]{2}-[0-9]{2})/);
            const numMatch = fname.match(/ADR-([A-Z]*[0-9]+)/i);
            const summaryMatch = raw.match(
              /##\s+(?:Context|Summary|Problem Statement)[^\n]*\n+([\s\S]{20,300})/i,
            );
            adrs.push({
              number: numMatch ? `ADR-${numMatch[1]}` : fname.replace('.md', ''),
              title: titleMatch
                ? titleMatch[1].replace(/^ADR-[A-Z0-9-]+[:\s]+/i, '').trim()
                : fname.replace('.md', ''),
              status: statusMatch ? statusMatch[1].trim() : 'Unknown',
              date: dateMatch ? dateMatch[1].trim() : null,
              summary: summaryMatch
                ? summaryMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
                : null,
              group: resolvedGroup,
              file: fname,
            });
          } catch {
            /* skip unreadable */
          }
        }
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ adrs }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------------- GET /api/docs
  if (req.method === 'GET' && url === '/api/docs') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || projectDir || process.cwd();
      const root = path.resolve(dir);
      const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);
      const DOC_EXT = new Set(['.md', '.mdx']);
      const files = [];

      // Dirent.isDirectory() is false for a symlinked directory (it reflects
      // the entry's own type, not the resolved target), so this never
      // follows a symlink into a loop or outside root — no extra guard needed.
      const walk = (abs, rel) => {
        let entries;
        try {
          entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch {
          return true;
        }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
          const childAbs = path.join(abs, entry.name);
          const childRel = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walk(childAbs, childRel);
          } else if (entry.isFile() && DOC_EXT.has(path.extname(entry.name))) {
            let stat;
            try {
              stat = fs.statSync(childAbs);
            } catch {
              continue;
            }
            files.push({ path: childRel, size: stat.size, mtime: stat.mtimeMs });
          }
        }
      };
      walk(root, '');
      files.sort((a, b) => b.mtime - a.mtime);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ files, total: files.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------------- GET /api/doc-read
  // Returns the raw content of one file discovered by /api/docs. Content
  // exposure is a bigger deal than the metadata /api/docs lists, so
  // containment is checked against known project roots (same allowlist
  // /api/global-doc/read uses) rather than trusting the client-supplied
  // `dir` alone — otherwise `?dir=/` would make any .md file on disk
  // "contained".
  if (req.method === 'GET' && url.startsWith('/api/doc-read')) {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || projectDir || process.cwd();
      const rel = qs.get('path');
      if (!rel || typeof rel !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'path query param required' }));
        return true;
      }
      let resolved = path.resolve(dir, rel);
      try {
        resolved = fs.realpathSync(resolved);
      } catch {}

      const allowedRoots = [path.resolve(projectDir || process.cwd())];
      const projectsBase = path.join(os.homedir(), '.claude', 'projects');
      try {
        for (const slug of fs.readdirSync(projectsBase)) {
          const resolvedProj = resolveSlugToPath(slug, path.join(projectsBase, slug));
          if (resolvedProj) allowedRoots.push(resolvedProj);
        }
      } catch {
        /* projects tree absent — fine */
      }
      const globalBrain =
        process.env.MONOMIND_GLOBAL_BRAIN_DIR ||
        path.join(os.homedir(), '.monomind', 'global-brain');
      if (fs.existsSync(globalBrain)) allowedRoots.push(globalBrain);

      const isAllowed = allowedRoots.some((root) => {
        const relCheck = path.relative(root, resolved);
        return relCheck && !relCheck.startsWith('..') && !path.isAbsolute(relCheck);
      });
      if (!isAllowed || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'path is outside the allowed project roots' }));
        return true;
      }
      if (!/\.(md|mdx)$/i.test(resolved)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'only markdown (.md/.mdx) files are readable' }));
        return true;
      }
      const body = fs.readFileSync(resolved, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ body }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ------------------------------------------------------- GET /api/section
  if (req.method === 'GET' && url === '/api/section') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const name = qs.get('name') || '';
      const dir = qs.get('dir') || projectDir || process.cwd();
      const full = qs.get('full') === '1';
      let partial = buildSectionData(name, dir || process.cwd());
      // For full knowledge request, include all chunks
      if (name === 'knowledge' && full) {
        const chunksPath = path.join(
          path.resolve(dir || process.cwd()),
          '.monomind',
          'knowledge',
          'chunks.jsonl',
        );
        let allChunks = [];
        try {
          const raw = fs.readFileSync(chunksPath, 'utf8');
          allChunks = raw
            .split('\n')
            .filter(Boolean)
            .map((l) => {
              try {
                return JSON.parse(l);
              } catch {
                return null;
              }
            })
            .filter(Boolean);
        } catch {}
        partial = { knowledge: { ...partial.knowledge, allChunks } };
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(partial));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}
