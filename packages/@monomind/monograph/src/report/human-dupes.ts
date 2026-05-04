import type { PipelineDuplicationStats } from '../duplicates/detect/statistics.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function col(c: string, t: string): string { return `${c}${t}${RESET}`; }
function dim(t: string): string { return col(DIM, t); }
function bold(t: string): string { return col(BOLD, t); }

const DOCS_DUPLICATION = 'https://docs.fallow.tools/explanations/duplication';
const MAX_CLONE_GROUPS = 10;
const MAX_FLAT = 10;

export interface HumanDupesOptions {
  maxGroups?: number;
  showSnippets?: boolean;
}

export interface CloneInstance {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface CloneGroup {
  id: number;
  instances: CloneInstance[];
  duplicatedLines: number;
}

export interface CloneFamily {
  files: string[];
  groups: CloneGroup[];
  totalDuplicatedLines: number;
  suggestions: Array<{ description: string }>;
}

function thousands(n: number): string {
  return n.toLocaleString('en-US');
}

function splitDirFilename(path: string): [string, string] {
  const idx = path.lastIndexOf('/');
  if (idx < 0) return ['', path];
  return [path.slice(0, idx + 1), path.slice(idx + 1)];
}

export function formatCloneGroup(group: CloneGroup, idx: number): string[] {
  const lines: string[] = [];
  const lc = group.duplicatedLines;
  const lcStr = thousands(lc).padStart(5);
  const lcColored = lc > 1000
    ? col(RED, col(BOLD, lcStr))
    : lc > 100
      ? col(YELLOW, lcStr)
      : dim(lcStr);

  const plural = group.instances.length === 1 ? 'instance' : 'instances';
  lines.push(`  ${lcColored} lines  ${group.instances.length} ${plural}`);

  for (const inst of group.instances) {
    const [dir, filename] = splitDirFilename(inst.filePath);
    lines.push(`    ${dim(dir)}${filename}:${inst.startLine}-${inst.endLine}`);
  }
  lines.push('');
  return lines;
}

export function buildDuplicationHumanLines(
  stats: PipelineDuplicationStats,
  groups: CloneGroup[],
  opts: HumanDupesOptions = {},
): string[] {
  if (groups.length === 0) return [];
  const lines: string[] = [];
  const maxGroups = opts.maxGroups ?? MAX_CLONE_GROUPS;

  const sorted = [...groups].sort((a, b) => b.duplicatedLines - a.duplicatedLines);
  const totalGroups = sorted.length;
  const shown = sorted.slice(0, maxGroups);

  lines.push(`${col(CYAN, '●')} ${col(CYAN, col(BOLD, `Duplicates (${totalGroups} clone group${totalGroups === 1 ? '' : 's'})`))}`);
  lines.push('');

  for (let i = 0; i < shown.length; i++) {
    lines.push(...formatCloneGroup(shown[i]!, i));
  }

  if (totalGroups > maxGroups) {
    lines.push(`  ${dim(`... and ${totalGroups - maxGroups} more clone groups`)}`);
  }

  lines.push(`  ${dim(`Identical code blocks detected via suffix-array analysis — ${DOCS_DUPLICATION}#clone-groups`)}`);
  lines.push('');

  if (stats.duplicatedLines > 0) {
    const pct = stats.duplicationPct.toFixed(1);
    lines.push(`  ${dim(`Duplicated: ${thousands(stats.duplicatedLines)} lines (${pct}%), ${stats.cloneGroups} clone group${stats.cloneGroups === 1 ? '' : 's'}`)}`);
    lines.push('');
  }

  if (groups.length > 0) {
    lines.push(`  ${dim('Run with --output json for machine-readable output')}`);
  }

  return lines;
}

export function buildDuplicationFamilyLines(
  families: CloneFamily[],
  opts: HumanDupesOptions = {},
): string[] {
  const multi = families.filter(f => f.groups.length > 1);
  if (multi.length === 0) return [];
  const lines: string[] = [];

  lines.push(`${col(YELLOW, '●')} ${col(YELLOW, col(BOLD, `Clone families (${multi.length} with multiple groups)`))}`);
  lines.push('');

  const shown = multi.slice(0, MAX_FLAT);
  for (const family of shown) {
    const fileList = family.files.join(', ');
    lines.push(`  ${bold(String(family.groups.length))} groups, ${bold(thousands(family.totalDuplicatedLines))} lines across ${fileList}`);
    for (const s of family.suggestions) {
      lines.push(`    ${col(YELLOW, '→')} ${dim(s.description)}`);
    }
    lines.push('');
  }

  if (multi.length > MAX_FLAT) {
    lines.push(`  ${dim(`... and ${multi.length - MAX_FLAT} more families`)}`);
    lines.push('');
  }

  lines.push(`  ${dim(`Groups of related clones across the same files — ${DOCS_DUPLICATION}#clone-families`)}`);
  lines.push('');
  return lines;
}
