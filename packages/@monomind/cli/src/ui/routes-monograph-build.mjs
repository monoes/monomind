import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAllowedProjectDir } from './server-fileutils.mjs';

const _MAX_BUILD_DOCS_STATE = 500;
// ua-*.mjs live in the repo's scripts/ dir, resolved from this file, never from process.cwd().
const _SCRIPTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  'scripts',
);

// Monograph dashboard routes (extracted from routes-monograph.mjs).
// Registered, in order, by handleMonographRoutes in routes-monograph.mjs.
export async function handleMonographBuildRoutes(req, res, url, corsOrigin, ctx) {
  // -------------------------------------------------- POST /api/ua-enrich
  // Trigger semantic enrichment on an existing monograph DB.
  // Imports understand graph.json if present; falls back to structural-only pass.
  if (req.method === 'POST' && url === '/api/ua-enrich') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const d = resolveAllowedProjectDir(qs.get('dir'), ctx.projectDir);
      if (!d) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'dir is not the server project or a known project' }));
        return true;
      }
      const dbFilePath = path.join(d, '.monomind', 'monograph.db');

      // Check for UA graph.json first
      const uaGraphCandidates = [
        path.join(d, '.understand-anything', 'knowledge-graph.json'),
        path.join(d, '.understand-anything', 'graph.json'),
        path.join(d, '.ua', 'knowledge-graph.json'),
        path.join(d, '.ua', 'graph.json'),
      ];
      const uaGraph = uaGraphCandidates.find((p) => fs.existsSync(p));
      const importScript = path.join(_SCRIPTS_DIR, 'ua-import.mjs');
      const enrichScript = path.join(_SCRIPTS_DIR, 'ua-enrich.mjs');

      res.writeHead(202, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });

      if (uaGraph && fs.existsSync(importScript)) {
        res.end(JSON.stringify({ status: 'importing', source: uaGraph }));
        const { spawn: sp } = await import('node:child_process');
        const child = sp(process.execPath, [importScript, uaGraph, dbFilePath], {
          stdio: 'ignore',
          detached: true,
          cwd: d,
        });
        child.unref();
      } else if (fs.existsSync(enrichScript)) {
        res.end(JSON.stringify({ status: 'enriching', mode: 'structural-only' }));
        const { spawn: sp } = await import('node:child_process');
        const child = sp(
          process.execPath,
          [enrichScript, '--dir', d, '--db', dbFilePath, '--full'],
          { stdio: 'ignore', detached: true, cwd: d },
        );
        child.unref();
      } else {
        res.end(
          JSON.stringify({
            status: 'skipped',
            reason:
              'No understand graph.json found. Run /monomind:understand in Claude Code first.',
          }),
        );
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- POST /api/monograph-build
  if (req.method === 'POST' && url === '/api/monograph-build') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());

      // Security: this route spawns `node --eval` with `cwd: d`, which lets
      // Node resolve '@monoes/monograph' against d's node_modules. Only ever
      // allow this for the server's own project root — never an
      // attacker-controlled `?dir=` — since a planted node_modules there
      // would achieve RCE. (See P0-6.)
      const _serverRoot = path.resolve(ctx.projectDir || process.cwd());
      if (d !== _serverRoot) {
        res.writeHead(400, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ error: 'monograph-build only supports the server project root' }));
        return true;
      }

      res.writeHead(202, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ status: 'building', dir: d }));

      // Build via monograph in background
      const { spawn: sp } = await import('node:child_process');
      const script = `import { buildAsync } from '@monoes/monograph'; await buildAsync(${JSON.stringify(d)});`;
      const child = sp(process.execPath, ['--input-type=module', '--eval', script], {
        stdio: 'ignore',
        detached: true,
        cwd: d,
      });
      child.unref();
      console.log(`[graph] build started for ${d} via monograph`);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-build-docs-status
  if (req.method === 'GET' && url === '/api/monograph-build-docs-status') {
    const qs2 = new URL(req.url, 'http://localhost').searchParams;
    const d2 = path.resolve(qs2.get('dir') || ctx.projectDir || process.cwd());
    const state = ctx.buildDocsState.get(d2) || { status: 'idle' };
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });
    res.end(JSON.stringify(state));
    return true;
  }

  // -------------------------------------------------- POST /api/monograph-build-docs
  if (req.method === 'POST' && url === '/api/monograph-build-docs') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!fs.existsSync(dbPath)) {
        res.writeHead(400, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ error: 'monograph.db not found — run BUILD GRAPH first' }));
        return true;
      }

      // Reject if already running
      const existing = ctx.buildDocsState.get(d);
      if (existing && existing.status === 'pending') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ status: 'pending', message: 'Build already in progress' }));
        return true;
      }

      const startedAt = Date.now();
      if (!ctx.buildDocsState.has(d) && ctx.buildDocsState.size >= _MAX_BUILD_DOCS_STATE) {
        const oldest = ctx.buildDocsState.keys().next().value;
        ctx.buildDocsState.delete(oldest);
      }
      ctx.buildDocsState.set(d, {
        status: 'pending',
        sections: 0,
        files: 0,
        error: null,
        startedAt,
      });
      res.writeHead(202, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ status: 'pending', dir: d }));

      // Run doc parsing in background
      (async () => {
        const { openDb, closeDb } = await import(
          new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href
        );
        const { isFileCached, updateFileCache, hashFileContent } = await import(
          new URL('../../../../monograph/dist/src/storage/file-cache.js', import.meta.url).href
        );
        const { readFileSync, readdirSync, statSync } = fs;

        const docExts = new Set(['.md', '.mdx', '.txt', '.rst']);
        const ignoreDirs = new Set([
          'node_modules',
          '.git',
          'dist',
          'build',
          '.next',
          '.nuxt',
          'coverage',
          '.monomind',
          '__pycache__',
          'vendor',
        ]);
        const docFiles = [];
        function walk(dir2, depth = 0) {
          if (depth > 12) return;
          let entries;
          try {
            entries = readdirSync(dir2);
          } catch {
            return;
          }
          for (const e of entries) {
            if (ignoreDirs.has(e) || e.startsWith('.')) continue;
            const full = path.join(dir2, e);
            let st;
            try {
              st = statSync(full);
            } catch {
              continue;
            }
            if (st.isDirectory()) {
              walk(full, depth + 1);
            } else if (docExts.has(path.extname(e).toLowerCase()) && st.size < 600000)
              docFiles.push(full);
          }
        }
        walk(d);

        const db = openDb(dbPath);
        try {
          const insertNode = db.prepare(
            `INSERT OR REPLACE INTO nodes (id, label, name, norm_label, file_path, start_line, end_line, language, is_exported) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          );
          const insertEdge = db.prepare(
            `INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, weight) VALUES (?, ?, ?, ?, 'EXTRACTED', 1.0, 1.0)`,
          );

          const insertAll = db.transaction((nodes, edges) => {
            for (const n of nodes) {
              try {
                insertNode.run(
                  n.id,
                  n.label,
                  n.name,
                  n.norm_label,
                  n.file_path,
                  n.start_line,
                  n.end_line,
                  n.language,
                );
              } catch {}
            }
            for (const e of edges) {
              try {
                insertEdge.run(e.id, e.src, e.dst, e.rel);
              } catch {}
            }
          });

          const normTitle = (t) =>
            t
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_|_$/g, '');

          let totalSections = 0;
          let skipped = 0;
          for (const filePath of docFiles) {
            let content;
            try {
              content = readFileSync(filePath, 'utf-8');
            } catch {
              continue;
            }

            // Skip unchanged files using file cache
            let isCached = false;
            let contentHash = '';
            try {
              contentHash = hashFileContent(content);
              isCached = isFileCached(db, filePath, contentHash);
            } catch {}
            if (isCached) {
              skipped++;
              continue;
            }
            const relPath = path.relative(d, filePath);
            const ext = path.extname(filePath).slice(1).toLowerCase();
            const fileId = `doc:${relPath}`;
            const lineCount = content.split('\n').length;

            const nodes = [
              {
                id: fileId,
                label: 'File',
                name: relPath,
                norm_label: normTitle(relPath),
                file_path: relPath,
                start_line: 1,
                end_line: lineCount,
                language: ext,
              },
            ];
            const edges = [];
            const lines = content.split('\n');
            const sectionStack = [{ id: fileId, depth: 0 }];
            let inCodeBlock = false;
            let codeBlockLang = null;

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];

              // Track fenced code blocks — don't parse headings inside them
              const fenceMatch = line.match(/^```([a-zA-Z0-9_+-]*)$/);
              if (fenceMatch) {
                if (!inCodeBlock) {
                  inCodeBlock = true;
                  codeBlockLang = fenceMatch[1].trim() || null;
                  if (codeBlockLang) {
                    const cId = `concept:lang:${codeBlockLang.toLowerCase()}`;
                    if (!nodes.find((n) => n.id === cId)) {
                      nodes.push({
                        id: cId,
                        label: 'Concept',
                        name: codeBlockLang,
                        norm_label: normTitle(codeBlockLang),
                        file_path: null,
                        start_line: 0,
                        end_line: 0,
                        language: null,
                      });
                    }
                    const curSec = sectionStack[sectionStack.length - 1].id;
                    edges.push({
                      id: `e:${curSec}:${cId}:code`,
                      src: curSec,
                      dst: cId,
                      rel: 'TAGGED_AS',
                    });
                  }
                } else {
                  inCodeBlock = false;
                  codeBlockLang = null;
                }
                continue;
              }
              if (inCodeBlock) continue;

              // ATX headings: # Title
              const hMatch = line.match(/^(#{1,6})\s+(.+)/);
              if (hMatch) {
                const depth = hMatch[1].length;
                const title = hMatch[2]
                  .trim()
                  .replace(/\s+#+\s*$/, '')
                  .trim();
                const secId = `sec:${relPath}:${i + 1}`;
                nodes.push({
                  id: secId,
                  label: 'Section',
                  name: title,
                  norm_label: normTitle(title),
                  file_path: relPath,
                  start_line: i + 1,
                  end_line: i + 1,
                  language: ext,
                });
                totalSections++;
                while (
                  sectionStack.length > 1 &&
                  sectionStack[sectionStack.length - 1].depth >= depth
                )
                  sectionStack.pop();
                const parentId = sectionStack[sectionStack.length - 1].id;
                edges.push({
                  id: `e:${secId}:${parentId}:parent`,
                  src: parentId,
                  dst: secId,
                  rel: 'DEFINES',
                });
                sectionStack.push({ id: secId, depth });
                continue;
              }

              // RST-style headings: line followed by ===, ---, ~~~, ^^^, etc.
              if (
                i + 1 < lines.length &&
                lines[i + 1].match(/^[=\-~^"'`#*+!]{3,}\s*$/) &&
                line.trim().length > 0 &&
                line.trim().length <= lines[i + 1].trim().length + 2
              ) {
                const underlineChar = lines[i + 1].trim()[0];
                const rstDepth = '=-~^"\'`#*+!'.indexOf(underlineChar) + 1 || 3;
                const title = line.trim();
                const secId = `sec:${relPath}:${i + 1}`;
                nodes.push({
                  id: secId,
                  label: 'Section',
                  name: title,
                  norm_label: normTitle(title),
                  file_path: relPath,
                  start_line: i + 1,
                  end_line: i + 1,
                  language: ext,
                });
                totalSections++;
                const depth = Math.min(6, Math.ceil(rstDepth / 2));
                while (
                  sectionStack.length > 1 &&
                  sectionStack[sectionStack.length - 1].depth >= depth
                )
                  sectionStack.pop();
                const parentId = sectionStack[sectionStack.length - 1].id;
                edges.push({
                  id: `e:${secId}:${parentId}:parent`,
                  src: parentId,
                  dst: secId,
                  rel: 'DEFINES',
                });
                sectionStack.push({ id: secId, depth });
                i++; // skip underline line
                continue;
              }

              // #hashtag concepts (skip markdown headings already matched)
              const tags = line.match(/#([a-zA-Z][a-zA-Z0-9_-]{2,})/g);
              if (tags) {
                for (const tag of tags) {
                  const concept = tag.slice(1);
                  const cId = `concept:tag:${concept.toLowerCase()}`;
                  if (!nodes.find((n) => n.id === cId)) {
                    nodes.push({
                      id: cId,
                      label: 'Concept',
                      name: concept,
                      norm_label: normTitle(concept),
                      file_path: null,
                      start_line: 0,
                      end_line: 0,
                      language: null,
                    });
                  }
                  const curSec = sectionStack[sectionStack.length - 1].id;
                  edges.push({
                    id: `e:${curSec}:${cId}:tag`,
                    src: curSec,
                    dst: cId,
                    rel: 'TAGGED_AS',
                  });
                }
              }
            }

            try {
              insertAll(nodes, edges);
              // Update file cache so we skip unchanged files next run
              try {
                updateFileCache(db, {
                  filePath,
                  contentHash,
                  lastParsed: Date.now(),
                  nodeCount: nodes.length,
                  edgeCount: edges.length,
                });
              } catch {}
            } catch (e) {
              console.error('[docs-build] error inserting', relPath, e.message);
            }
          }
          console.log(
            `[docs-build] indexed ${docFiles.length - skipped} docs (${skipped} cached), ${totalSections} sections → ${dbPath}`,
          );
          ctx.buildDocsState.set(d, {
            status: 'done',
            sections: totalSections,
            files: docFiles.length - skipped,
            cached: skipped,
            error: null,
            startedAt,
            completedAt: Date.now(),
          });
        } finally {
          closeDb(db);
        }
      })().catch((e) => {
        console.error('[docs-build] fatal:', e.message);
        ctx.buildDocsState.set(d, {
          status: 'error',
          sections: 0,
          files: 0,
          error: e.message,
          startedAt,
          completedAt: Date.now(),
        });
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }
  return false;
}
