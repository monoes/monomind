import type {
  FallowAnalysisResults,
  FallowUnusedFile,
  FallowUnusedExport,
  FallowUnusedDependency,
  FallowUnusedMember,
  FallowUnresolvedImport,
} from '../results/fallow-results.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function col(c: string, t: string): string { return `${c}${t}${RESET}`; }
function dim(t: string): string { return col(DIM, t); }
function bold(t: string): string { return col(BOLD, t); }

const MAX_FLAT = 10;
const MAX_GROUPED_FILES = 10;
const MAX_ITEMS_PER_FILE = 5;
const SCOPING_THRESHOLD = 500;

export interface HumanCheckOptions {
  maxFlatItems?: number;
  maxGroupedFiles?: number;
  maxItemsPerFile?: number;
  top?: number;
}

function truncHint(remaining: number, total: number): string {
  if (remaining > SCOPING_THRESHOLD || total > SCOPING_THRESHOLD) {
    return dim(`... and ${remaining} more — try --workspace <name> or --changed-since main to scope`);
  }
  return dim(`... and ${remaining} more (--format json for full list)`);
}

function sectionHeader(title: string, count: number, level: 'error' | 'warn' | 'info' = 'error'): string {
  const bullet = level === 'error' ? col(RED, '●') : level === 'warn' ? col(YELLOW, '●') : col(CYAN, '●');
  return `${bullet} ${bold(`${title} (${count})`)}`;
}

function categoryHeader(label: string): string {
  const bar = '─'.repeat(37);
  return dim(`── ${label} ${bar}`);
}

export function formatUnusedFiles(files: FallowUnusedFile[], opts: HumanCheckOptions = {}): string[] {
  if (files.length === 0) return [];
  const max = opts.maxFlatItems ?? opts.top ?? MAX_FLAT;
  const total = files.length;
  const lines: string[] = [sectionHeader('Unused files', total)];
  const shown = files.slice(0, max);
  for (const f of shown) {
    lines.push(`  ${f.filePath}`);
  }
  if (total > max) {
    lines.push(`  ${truncHint(total - max, total)}`);
  }
  lines.push('');
  return lines;
}

function groupByFile<T extends { filePath: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const arr = map.get(item.filePath) ?? [];
    arr.push(item);
    map.set(item.filePath, arr);
  }
  return map;
}

export function formatUnusedExports(exports: FallowUnusedExport[], opts: HumanCheckOptions = {}): string[] {
  if (exports.length === 0) return [];
  const maxFiles = opts.maxGroupedFiles ?? opts.top ?? MAX_GROUPED_FILES;
  const maxPerFile = opts.maxItemsPerFile ?? MAX_ITEMS_PER_FILE;
  const total = exports.length;
  const lines: string[] = [sectionHeader('Unused exports', total)];

  const byFile = groupByFile(exports);
  const sorted = [...byFile.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const shownFiles = sorted.slice(0, maxFiles);

  for (const [filePath, items] of shownFiles) {
    lines.push(`  ${filePath}`);
    const shownItems = items.slice(0, maxPerFile);
    for (const e of shownItems) {
      const tag = e.isReExport ? dim(' (re-export)') : '';
      lines.push(`    ${dim(`:${e.line}`)} ${bold(e.exportName)}${tag}`);
    }
    if (items.length > maxPerFile) {
      lines.push(`    ${dim(`... and ${items.length - maxPerFile} more`)}`);
    }
  }

  const hiddenFiles = sorted.length - shownFiles.length;
  if (hiddenFiles > 0) {
    const hiddenItems = sorted.slice(maxFiles).reduce((s, [, v]) => s + v.length, 0);
    lines.push(`  ${dim(`... and ${hiddenItems} more in ${hiddenFiles} file${hiddenFiles === 1 ? '' : 's'}`)}`);
  }
  lines.push('');
  return lines;
}

export function formatUnusedDeps(deps: FallowUnusedDependency[]): string[] {
  if (deps.length === 0) return [];
  const lines: string[] = [sectionHeader('Unused dependencies', deps.length)];
  for (const d of deps) {
    const workspaces = d.usedInWorkspaces.length > 0
      ? dim(` (imported in ${d.usedInWorkspaces.join(', ')})`)
      : '';
    lines.push(`  ${bold(d.name)}${workspaces}`);
  }
  lines.push('');
  return lines;
}

export function formatUnusedMembers(members: FallowUnusedMember[], title = 'Unused class members'): string[] {
  if (members.length === 0) return [];
  const total = members.length;
  const lines: string[] = [sectionHeader(title, total)];

  const byFile = groupByFile(members);
  const sorted = [...byFile.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const shownFiles = sorted.slice(0, MAX_GROUPED_FILES);

  for (const [filePath, items] of shownFiles) {
    lines.push(`  ${filePath}`);
    for (const m of items.slice(0, MAX_ITEMS_PER_FILE)) {
      lines.push(`    ${dim(`:${m.line}`)} ${bold(`${m.parentName}.${m.memberName}`)}`);
    }
    if (items.length > MAX_ITEMS_PER_FILE) {
      lines.push(`    ${dim(`... and ${items.length - MAX_ITEMS_PER_FILE} more`)}`);
    }
  }

  const hiddenFiles = sorted.length - shownFiles.length;
  if (hiddenFiles > 0) {
    const hiddenItems = sorted.slice(MAX_GROUPED_FILES).reduce((s, [, v]) => s + v.length, 0);
    lines.push(`  ${dim(`... and ${hiddenItems} more in ${hiddenFiles} file${hiddenFiles === 1 ? '' : 's'}`)}`);
  }
  lines.push('');
  return lines;
}

export function formatUnresolvedImports(imports: FallowUnresolvedImport[]): string[] {
  if (imports.length === 0) return [];
  const total = imports.length;
  const lines: string[] = [sectionHeader('Unresolved imports', total)];

  const byFile = groupByFile(imports);
  const sorted = [...byFile.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const shownFiles = sorted.slice(0, MAX_GROUPED_FILES);

  for (const [filePath, items] of shownFiles) {
    lines.push(`  ${filePath}`);
    for (const i of items.slice(0, MAX_ITEMS_PER_FILE)) {
      lines.push(`    ${dim(`:${i.line}`)} ${bold(i.specifier)}`);
    }
    if (items.length > MAX_ITEMS_PER_FILE) {
      lines.push(`    ${dim(`... and ${items.length - MAX_ITEMS_PER_FILE} more`)}`);
    }
  }

  const hiddenFiles = sorted.length - shownFiles.length;
  if (hiddenFiles > 0) {
    const hiddenItems = sorted.slice(MAX_GROUPED_FILES).reduce((s, [, v]) => s + v.length, 0);
    lines.push(`  ${dim(`... and ${hiddenItems} more in ${hiddenFiles} file${hiddenFiles === 1 ? '' : 's'}`)}`);
  }
  lines.push('');
  return lines;
}

export function buildCheckHumanLines(results: FallowAnalysisResults, opts: HumanCheckOptions = {}): string[] {
  const lines: string[] = [];

  const unusedFileSet = new Set(results.unusedFiles.map(f => f.filePath));
  const filteredExports = results.unusedExports.filter(e => !unusedFileSet.has(e.filePath));
  const filteredTypes = results.unusedTypes.filter(e => !unusedFileSet.has(e.filePath));

  const hasUnusedCode =
    results.unusedFiles.length > 0 ||
    filteredExports.length > 0 ||
    filteredTypes.length > 0 ||
    results.unusedEnumMembers.length > 0 ||
    results.unusedClassMembers.length > 0;

  const hasDeps =
    results.unusedDependencies.length > 0 ||
    results.unusedDevDependencies.length > 0 ||
    results.unresolvedImports.length > 0 ||
    results.unlistedDependencies.length > 0 ||
    results.typeOnlyDependencies.length > 0 ||
    results.testOnlyDependencies.length > 0;

  const hasStructure =
    results.duplicateExports.length > 0 ||
    results.circularDependencies.length > 0 ||
    results.boundaryViolations.length > 0;

  if (hasUnusedCode) {
    lines.push(categoryHeader('Unused Code'));
    lines.push('');
    lines.push(...formatUnusedFiles(results.unusedFiles, opts));
    lines.push(...formatUnusedExports(filteredExports, opts));
    if (filteredTypes.length > 0) {
      const typeLines = formatUnusedExports(filteredTypes, opts);
      if (typeLines.length > 0) {
        typeLines[0] = sectionHeader('Unused type exports', filteredTypes.length);
      }
      lines.push(...typeLines);
    }
    lines.push(...formatUnusedMembers(results.unusedEnumMembers, 'Unused enum members'));
    lines.push(...formatUnusedMembers(results.unusedClassMembers, 'Unused class members'));
  }

  if (hasDeps) {
    lines.push(categoryHeader('Dependencies'));
    lines.push('');
    lines.push(...formatUnusedDeps(results.unusedDependencies));
    if (results.unusedDevDependencies.length > 0) {
      const devLines = formatUnusedDeps(results.unusedDevDependencies);
      if (devLines.length > 0) devLines[0] = sectionHeader('Unused devDependencies', results.unusedDevDependencies.length);
      lines.push(...devLines);
    }
    lines.push(...formatUnresolvedImports(results.unresolvedImports));
    if (results.unlistedDependencies.length > 0) {
      lines.push(sectionHeader('Unlisted dependencies', results.unlistedDependencies.length));
      for (const d of results.unlistedDependencies) {
        lines.push(`  ${bold(d.name)}`);
      }
      lines.push('');
    }
    if (results.typeOnlyDependencies.length > 0) {
      lines.push(sectionHeader('Type-only dependencies (consider moving to devDependencies)', results.typeOnlyDependencies.length));
      for (const d of results.typeOnlyDependencies) {
        lines.push(`  ${bold(d.name)}`);
      }
      lines.push('');
    }
    if (results.testOnlyDependencies.length > 0) {
      lines.push(sectionHeader('Test-only production dependencies (consider moving to devDependencies)', results.testOnlyDependencies.length));
      for (const d of results.testOnlyDependencies) {
        lines.push(`  ${bold(d.name)}`);
      }
      lines.push('');
    }
  }

  if (hasStructure) {
    lines.push(categoryHeader('Structure'));
    lines.push('');
    if (results.duplicateExports.length > 0) {
      lines.push(sectionHeader('Duplicate exports', results.duplicateExports.length));
      for (const dup of results.duplicateExports.slice(0, MAX_FLAT)) {
        const locs = dup.locations.map(l => `${l.filePath}:${l.line}`).join(' ↔ ');
        lines.push(`  ${bold(dup.exportName)}  ${dim(locs)}`);
      }
      lines.push('');
    }
    if (results.circularDependencies.length > 0) {
      lines.push(sectionHeader('Circular dependencies', results.circularDependencies.length));
      for (const c of results.circularDependencies.slice(0, MAX_FLAT)) {
        lines.push(`  ${c.cycle.join(dim(' → '))}`);
      }
      lines.push('');
    }
    if (results.boundaryViolations.length > 0) {
      lines.push(sectionHeader('Boundary violations', results.boundaryViolations.length));
      for (const v of results.boundaryViolations.slice(0, MAX_FLAT)) {
        lines.push(`  ${v.fromPath}:${v.line} ${dim('→')} ${v.toPath} ${dim(`(${v.fromZone} → ${v.toZone})`)}`);
      }
      lines.push('');
    }
  }

  if (results.staleSuppressions.length > 0) {
    lines.push(categoryHeader('Maintenance'));
    lines.push('');
    lines.push(sectionHeader('Stale suppressions', results.staleSuppressions.length));
    for (const s of results.staleSuppressions.slice(0, MAX_FLAT)) {
      lines.push(`  ${s.filePath}:${s.commentLine}  ${dim(s.issueKind ?? 'unknown')}`);
    }
    lines.push('');
  }

  return lines;
}
