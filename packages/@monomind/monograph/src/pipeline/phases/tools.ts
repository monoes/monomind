import { readFileSync, statSync } from 'fs';
import { extname } from 'path';
import type { PipelinePhase } from '../types.js';
import type { MonographNode, MonographEdge } from '../../types.js';
import { makeId, toNormLabel } from '../../types.js';
import { insertNodes } from '../../storage/node-store.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { StructureOutput } from './structure.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

// ── Output types ──────────────────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  filePath: string;
  description?: string;
  handlerNodeId?: string;
  toolNodeId: string;
}

export interface ToolsOutput {
  toolDefs: ToolDef[];
}

// ── Detection regexes ─────────────────────────────────────────────────────────

/** server.tool('name', ...) or server.tool("name", ...) */
const SERVER_TOOL_RE = /server\.tool\(\s*['"]([^'"]+)['"]/g;

/** export const FOO_TOOL = { name: 'foo', description: '...' } */
const EXPORTED_TOOL_CONST_RE = /export\s+const\s+\w+[Tt][Oo][Oo][Ll]\w*\s*=\s*\{[^}]*name:\s*['"]([^'"]+)['"]/g;

/** Array variable name pattern: TOOLS, tools, MY_TOOLS, toolsList, etc. (case-insensitive on 'tools') */
const TOOLS_ARRAY_VAR_RE = /(?:export\s+)?(?:const|let|var)\s+(\w*[Tt][Oo][Oo][Ll][Ss]?\w*)\s*(?::\s*\w+\[\])?\s*=\s*\[/g;

// ── Phase ─────────────────────────────────────────────────────────────────────

export const toolsPhase: PipelinePhase<ToolsOutput> = {
  name: 'tools',
  deps: ['parse', 'structure'],
  async execute(ctx, deps) {
    const { fileNodes } = deps.get('structure') as StructureOutput;
    const toolDefs: ToolDef[] = [];
    const toolNodes: MonographNode[] = [];
    const handlesEdges: MonographEdge[] = [];

    for (const fileNode of fileNodes) {
      const relPath = fileNode.filePath ?? '';
      const ext = extname(relPath).toLowerCase();

      if (!CODE_EXTENSIONS.has(ext)) continue;

      const source = safeReadSource(`${ctx.repoPath}/${relPath}`, ctx.options.maxFileSizeBytes);
      if (!source) continue;

      const detectedNames = new Set<string>();

      // ── 1. server.tool('name', ...) pattern ───────────────────────────────
      const serverToolRe = new RegExp(SERVER_TOOL_RE.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = serverToolRe.exec(source)) !== null) {
        detectedNames.add(m[1]);
      }

      // ── 2. Exported constant tool pattern ─────────────────────────────────
      const exportedToolRe = new RegExp(EXPORTED_TOOL_CONST_RE.source, 'g');
      while ((m = exportedToolRe.exec(source)) !== null) {
        detectedNames.add(m[1]);
      }

      // ── 3. TOOLS array pattern ────────────────────────────────────────────
      const toolsArrayRe = new RegExp(TOOLS_ARRAY_VAR_RE.source, 'g');
      while ((m = toolsArrayRe.exec(source)) !== null) {
        const arrayStart = m.index + m[0].length;
        // Extract the array block (up to 4000 chars to avoid huge allocations)
        const block = source.slice(arrayStart, arrayStart + 4000);
        // Only match if array contains a description property (reduces false positives)
        if (!block.includes('description')) continue;
        // Find all name: 'foo' entries in the block
        const nameRe = /name:\s*['"]([^'"]+)['"]/g;
        let nm: RegExpExecArray | null;
        while ((nm = nameRe.exec(block)) !== null) {
          detectedNames.add(nm[1]);
        }
      }

      // ── Create nodes & edges for each detected tool ───────────────────────
      for (const toolName of detectedNames) {
        const toolNodeId = makeId('tool', toolName, relPath);

        const toolNode: MonographNode = {
          id: toolNodeId,
          label: 'Tool',
          name: toolName,
          normLabel: toNormLabel(toolName),
          filePath: relPath,
          startLine: 0,
          endLine: 0,
          isExported: true,
          language: langFromExt(ext),
        };
        toolNodes.push(toolNode);

        const def: ToolDef = { name: toolName, filePath: relPath, toolNodeId };

        // Attempt handler lookup in the DB
        if (ctx.db) {
          const lowerTool = toolName.toLowerCase().replace(/[_-]/g, '');
          // Query Function/Method nodes in the same file
          const rows = ctx.db
            .prepare(
              `SELECT id, name FROM nodes
               WHERE file_path = ?
               AND label IN ('Function', 'Method')`,
            )
            .all(relPath) as { id: string; name: string }[];

          // Find nodes whose name contains the tool name (case-insensitive, stripped)
          const matches = rows.filter(row => {
            const n = row.name.toLowerCase().replace(/[_-]/g, '');
            return n.includes(lowerTool) || (n.length > 0 && lowerTool.includes(n));
          });

          if (matches.length === 1) {
            const edgeId = makeId(toolNodeId, matches[0].id, 'handles_tool');
            handlesEdges.push({
              id: edgeId,
              sourceId: toolNodeId,
              targetId: matches[0].id,
              relation: 'HANDLES_TOOL',
              confidence: 'EXTRACTED',
              confidenceScore: 0.85,
            });
            def.handlerNodeId = matches[0].id;
          }
        }

        toolDefs.push(def);
      }
    }

    if (ctx.db) {
      insertNodes(ctx.db, toolNodes);
      insertEdges(ctx.db, handlesEdges);
    }

    return { toolDefs };
  },
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function safeReadSource(absPath: string, maxBytes: number): string | undefined {
  try {
    const stat = statSync(absPath);
    if (stat.size > maxBytes) return undefined;
    return readFileSync(absPath, 'utf-8');
  } catch {
    return undefined;
  }
}

function langFromExt(ext: string): string {
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  return 'unknown';
}
