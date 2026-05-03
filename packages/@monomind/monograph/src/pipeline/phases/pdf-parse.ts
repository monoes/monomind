import { readFileSync, statSync, readdirSync } from 'fs';
import { extname, basename, join, relative } from 'path';
import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographNode, MonographEdge } from '../../types.js';
import { makeId, toNormLabel, CONFIDENCE_SCORE } from '../../types.js';
import { insertNodes } from '../../storage/node-store.js';
import { insertEdges } from '../../storage/edge-store.js';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.cache', 'coverage', '.monomind', 'vendor', 'target',
  '.worktrees',
]);

export interface PdfParseOutput {
  sectionNodes: MonographNode[];
  pdfFiles: number;
}

function walkPdfs(dir: string, repoPath: string, ignore: string[]): string[] {
  const extraIgnore = new Set(ignore);
  const results: string[] = [];
  function walk(d: string) {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry) || extraIgnore.has(entry)) continue;
      const full = join(d, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (extname(entry).toLowerCase() === '.pdf') results.push(full);
    }
  }
  walk(dir);
  return results;
}

export const pdfParsePhase: PipelinePhase<PdfParseOutput> = {
  name: 'pdf-parse',
  deps: ['structure'],

  async execute(ctx: PipelineContext) {
    if (ctx.options.codeOnly) return { sectionNodes: [], pdfFiles: 0 };

    // Dynamically load pdf-parse — skip silently if not installed.
    // Use Function() to prevent TypeScript from resolving the optional module at build time.
    let extractText: ((buf: Buffer) => Promise<string>) | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await (new Function('return import("pdf-parse")')() as Promise<any>);
      const fn = mod.default ?? mod;
      extractText = async (buf: Buffer) => (await fn(buf)).text as string;
    } catch {
      return { sectionNodes: [], pdfFiles: 0 };
    }

    const pdfPaths = walkPdfs(ctx.repoPath, ctx.repoPath, ctx.options.ignore);
    if (pdfPaths.length === 0) return { sectionNodes: [], pdfFiles: 0 };

    const sectionNodes: MonographNode[] = [];
    const allEdges: MonographEdge[] = [];

    for (const absPath of pdfPaths) {
      const rel = relative(ctx.repoPath, absPath);
      const fileId = makeId(rel.replace(/\//g, '_'), 'file');

      let text: string;
      try {
        const buf = readFileSync(absPath);
        if (buf.length > ctx.options.maxFileSizeBytes * 10) continue; // 5 MB limit for PDFs
        text = await extractText(buf);
      } catch { continue; }

      if (!text || text.trim().length === 0) continue;

      // Split into ~1500-char paragraphs with 150-char overlap (knowledge_graph style)
      const CHUNK = 1500;
      const OVERLAP = 150;
      const chunks: Array<{ content: string; startChar: number }> = [];
      for (let pos = 0; pos < text.length; pos += CHUNK - OVERLAP) {
        chunks.push({ content: text.slice(pos, pos + CHUNK), startChar: pos });
        if (pos + CHUNK >= text.length) break;
      }

      const docTitle = basename(rel).replace(/\.pdf$/i, '');

      for (let i = 0; i < chunks.length; i++) {
        const { content, startChar } = chunks[i];
        const title = `${docTitle} §${i + 1}`;
        const sectionId = makeId('section', fileId, String(i));

        const node: MonographNode = {
          id: sectionId, label: 'Section',
          name: title, normLabel: toNormLabel(title),
          filePath: rel, startLine: startChar, endLine: startChar + content.length,
          isExported: false,
          properties: { level: 1, content: content.slice(0, 2000), source: 'pdf', chunk: i },
        };
        sectionNodes.push(node);

        allEdges.push({
          id: makeId(fileId, sectionId, 'defines'),
          sourceId: fileId, targetId: sectionId,
          relation: 'DEFINES', confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
        });
      }
    }

    if (sectionNodes.length > 0) insertNodes(ctx.db, sectionNodes);
    if (allEdges.length > 0) insertEdges(ctx.db, allEdges);

    ctx.onProgress?.({ phase: 'pdf-parse', message: `Parsed ${pdfPaths.length} PDF files → ${sectionNodes.length} chunks` });
    return { sectionNodes, pdfFiles: pdfPaths.length };
  },
};
