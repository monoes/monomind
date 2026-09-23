/**
 * Package inspection: deterministic file checks first, then the monofence
 * scanner over the accepted Markdown. Read-only — the caller deletes the
 * rejected files. A blocked scan, a scanner error or an unavailable scanner
 * all yield `verdict: 'quarantine'`; nothing here changes lifecycle status.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFenceForRole, type FenceInstance, loadGlobalFenceConfig } from '../orgrt/fence.js';
import { parseFrontmatter } from '../orgrt/skill-library.js';
import { BlueprintSchema } from './blueprints.js';
import { CATALOG_NAME_RE, type CatalogEntry } from './types.js';

export type CatalogFence = Pick<FenceInstance, 'detect'>;
/** Returns the scanner, or null when it is unavailable. */
export type FenceLoader = () => Promise<CatalogFence | null>;

export interface PackageInspection {
  /** Set when the package as a whole is unusable; nothing may be staged. */
  fatal?: string;
  verdict: 'clean' | 'quarantine';
  accepted: string[];
  rejected: { path: string; reason: string }[];
  requestedTools: string[];
  scanner: { ok: boolean; blocked: boolean; summary: string };
}

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_MARKDOWN_FILES = 100;
const SCAN_CHAR_CAP = 200_000;
const SUMMARY_CAP = 500;
export const SKIP_DIRS = new Set(['.git', 'node_modules']);
/** Text reserved for projection markers; a package carrying it could forge one. */
const RESERVED_MARKERS = ['<!-- catalog ', 'monomind:start', 'monomind:end'];
/**
 * Claude Code runs a skill's inline !`cmd` / !$cmd (its detector:
 * `(?<=^|\s)!(?=`|\$)`) and ```! / ~~~! fenced blocks when the skill loads.
 */
const SHELL_EXEC = [/(?:^|\s)!(?=[`$])/m, /^[ \t]*(?:`{3,}|~{3,})[ \t]*!/m];

/** True when `text` carries Markdown that a platform executes as a shell command. */
export const shellExecSyntax = (text: string): boolean => SHELL_EXEC.some((re) => re.test(text));

/** Every path under `dir`, relative, with its lstat kind. Skipped dirs are reported, not walked. */
function walk(
  dir: string,
  prefix = '',
): { rel: string; kind: 'file' | 'symlink' | 'other' | 'skipped' }[] {
  const out: { rel: string; kind: 'file' | 'symlink' | 'other' | 'skipped' }[] = [];
  for (const name of readdirSync(join(dir, prefix)).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = lstatSync(join(dir, rel));
    if (st.isSymbolicLink()) out.push({ rel, kind: 'symlink' });
    else if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) out.push({ rel, kind: 'skipped' });
      else out.push(...walk(dir, rel));
    } else out.push({ rel, kind: st.isFile() ? 'file' : 'other' });
  }
  return out;
}

function fileVerdict(rel: string, kind: CatalogEntry['kind'], size: number): string | undefined {
  if (rel.split('/').includes('..')) return 'path contains ..';
  // A nested `.claude/skills/…` (or any dot dir) is platform config, not package content.
  if (rel.split('/').some((seg) => seg.startsWith('.'))) return 'path segment starts with "."';
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  const allowed =
    base === 'LICENSE.txt' ||
    (kind === 'blueprint' ? rel === 'blueprint.json' : base.endsWith('.md'));
  if (!allowed)
    return kind === 'blueprint'
      ? 'not blueprint.json or LICENSE.txt'
      : 'not Markdown or LICENSE.txt';
  if (size > MAX_FILE_BYTES) return `larger than ${MAX_FILE_BYTES / 1024} KiB`;
  return undefined;
}

const str = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v.join(' ') : v;
const list = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : v.split(/[,\s]+/).filter(Boolean);

/** Package-level problems of the authored metadata; `requestedTools` for skills. */
function metadata(dir: string, kind: CatalogEntry['kind']): { fatal?: string; tools: string[] } {
  if (kind === 'blueprint') {
    try {
      BlueprintSchema.parse(JSON.parse(readFileSync(join(dir, 'blueprint.json'), 'utf8')));
      return { tools: [] };
    } catch (e) {
      return { fatal: `invalid blueprint.json: ${(e as Error).message.slice(0, 300)}`, tools: [] };
    }
  }
  const { data } = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
  const name = str(data.name);
  if (!name) return { fatal: 'SKILL.md has no frontmatter name', tools: [] };
  if (!str(data.description)?.trim())
    return { fatal: 'SKILL.md has no frontmatter description', tools: [] };
  if (!CATALOG_NAME_RE.test(name))
    return { fatal: `name "${name}" is not a valid catalog name`, tools: [] };
  return { tools: [...new Set(list(data.tools))].sort() };
}

const defaultFence =
  (root: string): FenceLoader =>
  () =>
    createFenceForRole(loadGlobalFenceConfig(root) ?? {});

async function runScanner(text: string, load: FenceLoader): Promise<PackageInspection['scanner']> {
  try {
    const fence = await load();
    if (!fence)
      return {
        ok: false,
        blocked: false,
        summary: 'scanner unavailable (monofence-ai could not be loaded)',
      };
    const r = await fence.detect(text);
    const threats = r.threats.map((t) => `${t.type} ${t.confidence.toFixed(2)}`).join(', ');
    return {
      ok: true,
      blocked: !r.safe,
      summary: (r.safe ? `clean (risk ${r.overallRisk.toFixed(2)})` : `blocked: ${threats}`).slice(
        0,
        SUMMARY_CAP,
      ),
    };
  } catch (e) {
    return {
      ok: false,
      blocked: false,
      summary: `scanner error: ${(e as Error).message}`.slice(0, SUMMARY_CAP),
    };
  }
}

/** Inspect a package directory (the staged temp copy). Never writes. */
export async function inspectPackage(
  dir: string,
  kind: CatalogEntry['kind'],
  opts: { root: string; fence?: FenceLoader },
): Promise<PackageInspection> {
  const accepted: string[] = [];
  const rejected: PackageInspection['rejected'] = [];
  for (const { rel, kind: k } of walk(dir)) {
    if (k === 'symlink') rejected.push({ path: rel, reason: 'symlink' });
    else if (k === 'skipped') rejected.push({ path: rel, reason: 'excluded directory' });
    else if (k === 'other') rejected.push({ path: rel, reason: 'not a regular file' });
    else {
      const why = fileVerdict(rel, kind, lstatSync(join(dir, rel)).size);
      if (why) rejected.push({ path: rel, reason: why });
      else accepted.push(rel);
    }
  }
  accepted.sort();
  const base = { accepted, rejected, requestedTools: [] as string[] };
  const refuse = (fatal: string): PackageInspection => ({
    ...base,
    fatal,
    verdict: 'quarantine',
    scanner: { ok: false, blocked: false, summary: 'not scanned' },
  });
  const primary = kind === 'blueprint' ? 'blueprint.json' : 'SKILL.md';
  if (!accepted.includes(primary)) return refuse(`package has no usable ${primary}`);
  const markdown = accepted.filter((f) => f.endsWith('.md'));
  if (markdown.length > MAX_MARKDOWN_FILES)
    return refuse(`more than ${MAX_MARKDOWN_FILES} Markdown files`);
  const meta = metadata(dir, kind);
  if (meta.fatal) return refuse(meta.fatal);
  for (const f of accepted) {
    const content = readFileSync(join(dir, f), 'utf8');
    const marker = RESERVED_MARKERS.find((m) => content.includes(m));
    if (marker) return refuse(`${f} contains reserved marker text "${marker.trim()}"`);
    if (f.endsWith('.md') && shellExecSyntax(content))
      return refuse(`body-exec: ${f} contains shell execution syntax (!\`…\` or a \`\`\`! block)`);
  }
  const scanned = accepted.filter((f) => f !== 'LICENSE.txt');
  const full = scanned.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n\n');
  const scanner = await runScanner(
    full.slice(0, SCAN_CHAR_CAP),
    opts.fence ?? defaultFence(opts.root),
  );
  // Content past the cap was never scanned: it must not pass as clean.
  const truncated = full.length > SCAN_CHAR_CAP;
  if (truncated)
    scanner.summary =
      `not fully scanned (${full.length} chars > ${SCAN_CHAR_CAP}); ${scanner.summary}`.slice(
        0,
        SUMMARY_CAP,
      );
  return {
    ...base,
    requestedTools: meta.tools,
    verdict: scanner.ok && !scanner.blocked && !truncated ? 'clean' : 'quarantine',
    scanner,
  };
}
