import { readFileSync, statSync } from 'fs';
import { extname, basename, join } from 'path';
import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographNode, MonographEdge } from '../../types.js';
import { makeId, toNormLabel, CONFIDENCE_SCORE } from '../../types.js';
import { insertNodes } from '../../storage/node-store.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { StructureOutput } from './structure.js';

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst']);

interface HeadingEntry {
  level: number;
  title: string;
  startLine: number;
  endLine: number;
  content: string;
}

interface LinkRef {
  target: string;
  isWiki: boolean;
}

export interface DocsParseOutput {
  sectionNodes: MonographNode[];
  docFiles: number;
}

// ── Frontmatter ───────────────────────────────────────────────────────────────

function parseFrontmatter(text: string): { meta: Record<string, unknown>; body: string; lineOffset: number } {
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!fmMatch) return { meta: {}, body: text, lineOffset: 0 };

  const yaml = fmMatch[1];
  const meta: Record<string, unknown> = {};
  let currentKey: string | null = null;

  for (const line of yaml.split('\n')) {
    const keyOnlyMatch = line.match(/^(\w[\w-]*)\s*:\s*$/);
    if (keyOnlyMatch) {
      currentKey = keyOnlyMatch[1];
      meta[currentKey] = [];
      continue;
    }
    const itemMatch = line.match(/^\s+-\s+(.+)$/);
    if (itemMatch && currentKey && Array.isArray(meta[currentKey])) {
      (meta[currentKey] as string[]).push(itemMatch[1].trim().replace(/^["']|["']$/g, ''));
      continue;
    }
    if (line && !line.match(/^\s/)) currentKey = null;
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1];
    const val = kvMatch[2].trim();
    if (val.startsWith('[')) {
      meta[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
    } else {
      meta[key] = val.replace(/^["']|["']$/g, '');
    }
  }

  const lineOffset = fmMatch[0].split('\n').length - 1;
  return { meta, body: text.slice(fmMatch[0].length), lineOffset };
}

// ── Heading extraction ────────────────────────────────────────────────────────

function extractHeadings(body: string, lineOffset: number): HeadingEntry[] {
  const lines = body.split('\n');
  const positions: Array<{ level: number; title: string; idx: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
    if (m) positions.push({ level: m[1].length, title: m[2].trim(), idx: i });
  }

  return positions.map((h, i) => {
    const nextIdx = positions[i + 1]?.idx ?? lines.length;
    return {
      level: h.level,
      title: h.title,
      startLine: lineOffset + h.idx + 1,
      endLine: lineOffset + nextIdx,
      content: lines.slice(h.idx + 1, nextIdx).join('\n').trim(),
    };
  });
}

// ── Link extraction ───────────────────────────────────────────────────────────

function extractLinks(text: string): LinkRef[] {
  const links: LinkRef[] = [];
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g)) {
    links.push({ target: m[1].trim(), isWiki: true });
  }
  for (const m of text.matchAll(/\[[^\]]+\]\(([^)]+\.mdx?(?:#[^)]*)?)\)/g)) {
    const href = m[1].split('#')[0].trim();
    if (!href.startsWith('http')) links.push({ target: href, isWiki: false });
  }
  return links;
}

// ── Tag extraction ────────────────────────────────────────────────────────────

function extractTags(text: string, meta: Record<string, unknown>): string[] {
  const tags = new Set<string>();
  for (const key of ['tags', 'tag', 'categories', 'category']) {
    const v = meta[key];
    if (Array.isArray(v)) v.forEach(t => typeof t === 'string' && tags.add(t.toLowerCase()));
    else if (typeof v === 'string') tags.add(v.toLowerCase());
  }
  for (const m of text.matchAll(/(?<![a-z0-9])#([a-z][a-z0-9_-]+)/gi)) {
    tags.add(m[1].toLowerCase());
  }
  return [...tags];
}

// ── Phase ─────────────────────────────────────────────────────────────────────

export const docsParsePhase: PipelinePhase<DocsParseOutput> = {
  name: 'docs-parse',
  deps: ['structure'],

  async execute(ctx, deps) {
    // Respect codeOnly flag
    if (ctx.options.codeOnly) return { sectionNodes: [], docFiles: 0 };

    const { fileNodes } = deps.get('structure') as StructureOutput;
    const docFiles = fileNodes.filter(n => n.filePath && DOC_EXTENSIONS.has(extname(n.filePath).toLowerCase()));
    if (docFiles.length === 0) return { sectionNodes: [], docFiles: 0 };

    const fileByRel = new Map<string, MonographNode>(docFiles.map(n => [n.filePath!, n]));
    const fileByName = new Map<string, MonographNode>(
      docFiles.map(n => [basename(n.filePath!).replace(/\.mdx?$/, '').toLowerCase(), n])
    );

    const sectionNodes: MonographNode[] = [];
    // Key: `${fileId}::${normTitle}` to avoid cross-file title collisions
    const sectionByKey = new Map<string, MonographNode>();
    const conceptNodes = new Map<string, MonographNode>();
    const allEdges: MonographEdge[] = [];
    const deferredRefs: Array<{ sourceId: string; fileId: string; target: string; isWiki: boolean }> = [];

    for (const fileNode of docFiles) {
      const absPath = join(ctx.repoPath, fileNode.filePath!);
      let text: string;
      try {
        const st = statSync(absPath);
        if (st.size > ctx.options.maxFileSizeBytes) continue;
        text = readFileSync(absPath, 'utf-8');
      } catch { continue; }

      const { meta, body, lineOffset } = parseFrontmatter(text);
      const headings = extractHeadings(body, lineOffset);
      const fileTags = extractTags('', meta);

      // No headings → single Section node for the whole file
      if (headings.length === 0) {
        const title = (meta['title'] as string | undefined) ?? basename(fileNode.filePath!).replace(/\.[^.]+$/, '');
        const sectionId = makeId('section', fileNode.id, 'root');
        const node: MonographNode = {
          id: sectionId, label: 'Section',
          name: title, normLabel: toNormLabel(title),
          filePath: fileNode.filePath, startLine: 1, endLine: text.split('\n').length,
          isExported: false,
          properties: { ...meta, level: 0, content: body.slice(0, 2000) },
        };
        sectionNodes.push(node);
        sectionByKey.set(`${fileNode.id}::${toNormLabel(title)}`, node);

        allEdges.push({
          id: makeId(fileNode.id, sectionId, 'defines'),
          sourceId: fileNode.id, targetId: sectionId,
          relation: 'DEFINES', confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
        });

        wireTagEdges(sectionId, fileTags, conceptNodes, allEdges);
        for (const lnk of extractLinks(body)) deferredRefs.push({ sourceId: sectionId, fileId: fileNode.id, ...lnk });
        continue;
      }

      // Preamble content: text before the first heading
      const firstHeadingStart = headings[0].startLine - lineOffset - 1;
      const preamble = body.split('\n').slice(0, firstHeadingStart).join('\n').trim();

      // Build section nodes with parent hierarchy
      const stack: Array<{ level: number; id: string }> = [];
      let firstSectionId: string | null = null;

      for (const h of headings) {
        const sectionId = makeId('section', fileNode.id, toNormLabel(h.title), String(h.startLine));
        if (!firstSectionId) firstSectionId = sectionId;

        const node: MonographNode = {
          id: sectionId, label: 'Section',
          name: h.title, normLabel: toNormLabel(h.title),
          filePath: fileNode.filePath, startLine: h.startLine, endLine: h.endLine,
          isExported: false,
          properties: { ...meta, level: h.level, content: h.content.slice(0, 2000) },
        };
        sectionNodes.push(node);
        // Scoped key: fileId::normTitle — prevents cross-file title collisions
        sectionByKey.set(`${fileNode.id}::${toNormLabel(h.title)}`, node);

        // File → Section (DEFINES)
        allEdges.push({
          id: makeId(fileNode.id, sectionId, 'defines'),
          sourceId: fileNode.id, targetId: sectionId,
          relation: 'DEFINES', confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
        });

        // Parent section → this section (PARENT_SECTION)
        while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
        if (stack.length > 0) {
          const parentId = stack[stack.length - 1].id;
          allEdges.push({
            id: makeId(parentId, sectionId, 'parent_section'),
            sourceId: parentId, targetId: sectionId,
            relation: 'PARENT_SECTION', confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
          });
        }
        stack.push({ level: h.level, id: sectionId });

        wireTagEdges(sectionId, extractTags(h.content, {}), conceptNodes, allEdges);
        for (const lnk of extractLinks(h.content)) deferredRefs.push({ sourceId: sectionId, fileId: fileNode.id, ...lnk });
      }

      // Preamble links/tags → attach to first section
      if (preamble && firstSectionId) {
        wireTagEdges(firstSectionId, extractTags(preamble, {}), conceptNodes, allEdges);
        for (const lnk of extractLinks(preamble)) deferredRefs.push({ sourceId: firstSectionId, fileId: fileNode.id, ...lnk });
      }

      // Frontmatter tags → first section
      if (fileTags.length > 0 && firstSectionId) {
        wireTagEdges(firstSectionId, fileTags, conceptNodes, allEdges);
      }
    }

    // Resolve deferred REFERENCES edges
    // Wiki links resolve within the same file first, then fall back to cross-file
    const seenRefs = new Set<string>();
    for (const ref of deferredRefs as Array<{ sourceId: string; fileId: string; target: string; isWiki: boolean }>) {
      let target: MonographNode | undefined;

      if (ref.isWiki) {
        // Same-file resolution first (avoids cross-file title collisions)
        const normTarget = toNormLabel(ref.target);
        target = sectionByKey.get(`${ref.fileId}::${normTarget}`);
        if (!target) {
          // Cross-file: search all files for matching title
          for (const [key, node] of sectionByKey) {
            if (key.endsWith(`::${normTarget}`)) { target = node; break; }
          }
        }
        if (!target) target = fileByName.get(normTarget);
      } else {
        target = fileByRel.get(ref.target.replace(/^\.\//, ''))
          ?? fileByName.get(basename(ref.target).replace(/\.mdx?$/, '').toLowerCase());
      }

      if (target) {
        const edgeId = makeId(ref.sourceId, target.id, 'references');
        if (!seenRefs.has(edgeId)) {
          seenRefs.add(edgeId);
          allEdges.push({
            id: edgeId, sourceId: ref.sourceId, targetId: target.id,
            relation: 'REFERENCES', confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
          });
        }
      }
    }

    // File nodes are never persisted by structure/parse phases — insert them here
    // so DEFINES/REFERENCES edges can satisfy FK constraints.
    insertNodes(ctx.db, docFiles);
    if (sectionNodes.length > 0) insertNodes(ctx.db, sectionNodes);
    if (conceptNodes.size > 0) insertNodes(ctx.db, [...conceptNodes.values()]);
    if (allEdges.length > 0) insertEdges(ctx.db, allEdges);

    ctx.onProgress?.({ phase: 'docs-parse', message: `Parsed ${docFiles.length} doc files → ${sectionNodes.length} sections` });
    return { sectionNodes, docFiles: docFiles.length };
  },
};

function wireTagEdges(
  sourceId: string,
  tags: string[],
  conceptNodes: Map<string, MonographNode>,
  edges: MonographEdge[],
): void {
  for (const tag of tags) {
    const conceptId = makeId('concept', tag.replace(/[^a-z0-9]/g, '_'));
    if (!conceptNodes.has(conceptId)) {
      conceptNodes.set(conceptId, {
        id: conceptId, label: 'Concept', name: tag, normLabel: toNormLabel(tag), isExported: false,
      });
    }
    edges.push({
      id: makeId(sourceId, conceptId, 'tagged_as'),
      sourceId, targetId: conceptId,
      relation: 'TAGGED_AS', confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
    });
  }
}
