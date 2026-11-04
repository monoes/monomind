/**
 * Monodesign MCP Tools
 *
 * Exposes the monodesign subsystem (anti-pattern detection, auto-fix, OKLCH
 * palette seeds) as MCP tools so agents on every platform (Claude Code, Kimi
 * Code, Antigravity, opencode) can use them natively — previously CLI-only
 * (`monomind design detect|fix|palette`), which made the subsystem invisible
 * on MCP-driven platforms.
 *
 * - monodesign_palette: pure TS — the 129-seed OKLCH library from
 *   commands/design-palette.ts (no engine, no subprocess).
 * - monodesign_detect: in-process engine — the bundled monodesign engine's
 *   detectText/walkDir run in this process; no CLI spawn.
 * - monodesign_fix: bounded subprocess — the bundled monodesign CLI's `fix`
 *   codemod (no programmatic fix API exists), always supporting --dry-run.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { resolveMonodesignCli } from '../commands/design-detect.js';
import { hashUnit, hueWord, SEEDS, toOklchCss, weightedPick } from '../commands/design-palette.js';
import type { MCPTool } from './types.js';
import { getProjectCwd } from './types.js';

// Lazy-cached engine module — the bundled @monoes/monodesign engine, loaded
// in-process (the `./engine` export of the package). No subprocess for detect.
let _engine: Record<string, any> | null = null;
async function getEngine(): Promise<Record<string, any>> {
  if (_engine) return _engine;
  const cliPath = resolveMonodesignCli();
  if (!cliPath) throw new Error('monodesign engine not found (is @monoes/monodesign installed?)');
  // cliPath = <pkg>/cli/bin/cli.js → engine facade at <pkg>/cli/engine/detect-antipatterns.mjs
  const enginePath = resolve(cliPath, '..', '..', 'engine', 'detect-antipatterns.mjs');
  _engine = await import(enginePath);
  return _engine!;
}

/** The CLI's split (cli/engine/cli/main.mjs): HTML files get the static-HTML
 *  engine, which resolves the CSS cascade (contrast, computed sizes), and
 *  everything else the regex text engine. detectText alone misses every
 *  cascade-dependent finding in HTML (#353). */
const HTML_EXTENSIONS = new Set(['.html', '.htm']);

// Unverified contrast checks (translucent colours, overlays, gradients) are
// always collected so the response can say how many were held back (#424).
const SCAN_OPTIONS = { includeUnverified: true };

async function detectFile(engine: Record<string, any>, file: string): Promise<any[]> {
  return HTML_EXTENSIONS.has(extname(file).toLowerCase())
    ? await engine.detectHtml(file, SCAN_OPTIONS)
    : engine.detectText(readFileSync(file, 'utf8'), file);
}

/** Inline content: detectHtml reads a path, so HTML goes through a temp file
 *  and its findings are labelled with the caller's virtual path. */
async function detectInline(
  engine: Record<string, any>,
  content: string,
  virtualPath: string,
): Promise<any[]> {
  const ext = extname(virtualPath).toLowerCase();
  if (!HTML_EXTENSIONS.has(ext)) return engine.detectText(content, virtualPath);
  const dir = mkdtempSync(join(tmpdir(), 'monodesign-inline-'));
  try {
    const file = join(dir, `inline${ext}`);
    writeFileSync(file, content);
    const found: any[] = await engine.detectHtml(file, SCAN_OPTIONS);
    return found.map((f) => (f.file === file ? { ...f, file: virtualPath } : f));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const MAX_FINDINGS = 100;
const MAX_GROUPS = 20;
const MAX_OUTPUT_CHARS = 20_000;

function displayPath(file: unknown): unknown {
  if (typeof file !== 'string' || !isAbsolute(file)) return file;
  const rel = relative(getProjectCwd(), file);
  return rel && !rel.startsWith('..') ? rel : file;
}

/** Default response: one entry per (rule, snippet) with a count and example
 *  locations, capped at MAX_GROUPS by severity. Rule descriptions are listed
 *  once in `rules` instead of on every group (#424). */
function groupedResponse(engine: Record<string, any>, findings: any[], offset: number) {
  const groups: any[] = engine.groupFindings(findings);
  const page = groups.slice(offset, offset + MAX_GROUPS);
  const rules: Record<string, { name: string; description?: string }> = {};
  for (const g of page) {
    rules[g.antipattern] ??= {
      name: g.name,
      description: g.description ? String(g.description).slice(0, 200) : undefined,
    };
  }
  const remaining = groups.length - offset - page.length;
  return {
    uniqueCount: groups.length,
    groups: page.map((g) => ({
      antipattern: g.antipattern,
      severity: g.severity,
      count: g.count,
      snippet: g.snippet.slice(0, 120),
      locations: g.locations.map((l: { file: string; line?: number }) =>
        l.line ? `${displayPath(l.file)}:${l.line}` : displayPath(l.file),
      ),
      ...(g.fileCount > g.locations.length ? { moreFiles: g.fileCount - g.locations.length } : {}),
    })),
    rules,
    ...(remaining > 0
      ? {
          more: `${remaining} more group(s); call again with offset=${offset + page.length}, or verbose=true for the raw findings list`,
        }
      : {}),
  };
}

function truncateFindings(findings: any[]): { findings: any[]; truncated: boolean } {
  if (findings.length <= MAX_FINDINGS) return { findings, truncated: false };
  return { findings: findings.slice(0, MAX_FINDINGS), truncated: true };
}

function shapeFinding(f: any): Record<string, unknown> {
  return {
    antipattern: f.antipattern ?? f.ruleId ?? f.id,
    name: f.name,
    severity: f.severity,
    file: f.file,
    line: f.line,
    snippet: typeof f.snippet === 'string' ? f.snippet.slice(0, 120) : undefined,
    message:
      typeof f.message === 'string'
        ? f.message.slice(0, 200)
        : f.description
          ? String(f.description).slice(0, 200)
          : undefined,
  };
}

function validateTarget(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.includes('\0')) return null;
  const abs = resolve(getProjectCwd(), raw);
  return abs;
}

// ─── monodesign_palette ─────────────────────────────────────────────────────

const monodesignPalette: MCPTool = {
  name: 'monodesign_palette',
  description:
    'Pick an OKLCH brand seed from the 129-seed curated library: returns anchor color (oklch css), mood, and composition strategy. Deterministic with `from`, specific with `id`.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Pick a specific seed by ID (e.g. seed-021)' },
      from: {
        type: 'string',
        description: 'Deterministic seed derived from a key (e.g. product name)',
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const id = typeof params.id === 'string' ? params.id : undefined;
      const from = typeof params.from === 'string' && params.from ? params.from : undefined;

      let seed;
      if (id) {
        seed = SEEDS.find((s) => s.id === id);
        if (!seed)
          return {
            success: false,
            error: `No seed with id "${id}" (library has ${SEEDS.length} seeds, ids seed-000…)`,
          };
      } else {
        const unit = from ? hashUnit(from) : Math.random();
        seed = weightedPick(SEEDS, unit);
      }

      const oklchCss = toOklchCss(seed.oklch);
      return {
        success: true,
        id: seed.id,
        oklch: oklchCss,
        hue: hueWord(seed.oklch[2]),
        mood: seed.mood,
        strategy: seed.strategy,
        ...(from ? { deterministicFrom: from } : {}),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ─── monodesign_detect ──────────────────────────────────────────────────────

const monodesignDetect: MCPTool = {
  name: 'monodesign_detect',
  description:
    'Detect design anti-patterns (overused fonts, tiny text, gradient text, glow, layout issues) in HTML/CSS files using the bundled monodesign engine, in-process. Pass a target file/dir, or inline content. Returns findings grouped by (rule, snippet) with counts, most severe first; verbose=true for the raw list.',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'File or directory to scan (default: project cwd)' },
      content: {
        type: 'string',
        description: 'Inline HTML/CSS content to scan instead of a target path',
      },
      filePath: {
        type: 'string',
        description: 'Virtual path used to label findings when scanning inline content',
      },
      severity: {
        type: 'string',
        description: 'Minimum severity to include: info | warning | error (default: all)',
      },
      verbose: {
        type: 'boolean',
        description: `Return the raw per-occurrence findings list (capped at ${MAX_FINDINGS}) instead of grouped findings`,
      },
      offset: {
        type: 'number',
        description: `Skip this many groups (grouped output pages ${MAX_GROUPS} at a time, most severe first)`,
      },
      include_unverified: {
        type: 'boolean',
        description:
          'Also report contrast checks the static analyser cannot verify (translucent colours, overlays, gradients, SVG text); default false',
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const engine = await getEngine();
      const severityFilter = typeof params.severity === 'string' ? params.severity : undefined;

      let findings: any[] = [];

      if (typeof params.content === 'string' && params.content.length > 0) {
        const vp = typeof params.filePath === 'string' ? params.filePath : 'inline.html';
        findings = await detectInline(engine, params.content, vp);
      } else {
        const abs = validateTarget(params.target ?? '.');
        if (!abs) return { success: false, error: 'invalid target path' };
        let st;
        try {
          st = statSync(abs);
        } catch {
          return { success: false, error: `target not found: ${String(params.target ?? '.')}` };
        }

        if (st.isDirectory()) {
          const files: string[] = engine.walkDir(abs);
          if (files.length > 500)
            return {
              success: false,
              error: `target dir has ${files.length} scannable files (cap 500) — narrow the target`,
            };
          for (const file of files) {
            try {
              findings.push(...(await detectFile(engine, file)));
            } catch {
              /* skip unreadable */
            }
          }
        } else {
          findings = await detectFile(engine, abs);
        }
      }

      if (severityFilter) {
        const rank: Record<string, number> = { info: 0, warning: 1, error: 2 };
        const min = rank[severityFilter] ?? 0;
        findings = findings.filter((f) => (rank[f.severity] ?? 1) >= min);
      }

      const unverified = findings.filter((f) => f.unverified).length;
      if (params.include_unverified !== true) findings = findings.filter((f) => !f.unverified);
      const unverifiedNote =
        unverified > 0 && params.include_unverified !== true
          ? {
              unverified,
              unverifiedNote:
                'contrast checks on translucent/overlay/gradient backgrounds were not counted; pass include_unverified=true to see them',
            }
          : {};

      if (params.verbose !== true) {
        const offset =
          typeof params.offset === 'number' && params.offset > 0 ? Math.floor(params.offset) : 0;
        return {
          success: true,
          count: findings.length,
          ...unverifiedNote,
          ...groupedResponse(engine, findings, offset),
        };
      }

      const { findings: capped, truncated } = truncateFindings(findings);
      return {
        success: true,
        count: findings.length,
        ...unverifiedNote,
        ...(truncated ? { truncated: true, showing: MAX_FINDINGS } : {}),
        findings: capped.map(shapeFinding),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ─── monodesign_fix ─────────────────────────────────────────────────────────

const monodesignFix: MCPTool = {
  name: 'monodesign_fix',
  description:
    'Auto-fix design anti-patterns with the bundled deterministic codemod. ALWAYS try dry_run=true first to preview unified diffs; set dry_run=false to write changes.',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'File or directory to fix (default: project cwd)' },
      dry_run: { type: 'boolean', description: 'Preview diffs without writing (default: true)' },
      rules: { type: 'string', description: 'Only fix the given rule ids (comma-separated)' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const cliPath = resolveMonodesignCli();
      if (!cliPath)
        return {
          success: false,
          error: 'monodesign engine not found (is @monoes/monodesign installed?)',
        };

      const abs = validateTarget(params.target ?? '.');
      if (!abs) return { success: false, error: 'invalid target path' };

      const dryRun = params.dry_run !== false; // default true — never write unless asked
      const args = ['fix', abs, '--json'];
      if (dryRun) args.push('--dry-run');
      if (typeof params.rules === 'string' && params.rules) args.push('--rule', params.rules);

      const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
        (resolvePromise) => {
          const child = spawn(process.execPath, [cliPath, ...args], {
            cwd: getProjectCwd(),
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let stdout = '';
          let stderr = '';
          const timer = setTimeout(() => {
            child.kill('SIGTERM');
          }, 120_000);
          child.stdout?.on('data', (c: Buffer) => {
            stdout += c.toString();
          });
          child.stderr?.on('data', (c: Buffer) => {
            stderr += c.toString();
          });
          child.on('error', (e) => {
            clearTimeout(timer);
            resolvePromise({ code: 1, stdout, stderr: String(e) });
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            resolvePromise({ code: code ?? 1, stdout, stderr });
          });
        },
      );

      let report: unknown = result.stdout;
      try {
        report = JSON.parse(result.stdout);
      } catch {
        /* plain text output */
      }

      return {
        success: result.code === 0,
        dry_run: dryRun,
        exit_code: result.code,
        report: typeof report === 'string' ? report.slice(0, MAX_OUTPUT_CHARS) : report,
        ...(result.stderr ? { stderr: result.stderr.slice(-500) } : {}),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const monodesignTools: MCPTool[] = [monodesignPalette, monodesignDetect, monodesignFix];
