// ANSI-colored terminal reporters for dead-code, health, and duplication results.

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

function col(color: string, text: string): string {
  return `${color}${text}${RESET}`;
}

export interface HumanDeadCodeFinding {
  filePath: string;
  symbol?: string;
  kind: string;
  line?: number;
}

export interface HumanHealthFinding {
  filePath: string;
  functionName: string;
  startLine: number;
  cyclomatic: number;
  cognitive: number;
  crapScore: number;
  severity: string;
}

export interface HumanDuplicationGroup {
  groupId: number;
  instances: Array<{ filePath: string; startLine: number; endLine: number }>;
  duplicatedLines: number;
}

export interface HumanTraceEntry {
  from: string;
  to: string;
  reason: string;
}

export function buildDeadCodeHumanLines(findings: HumanDeadCodeFinding[], root = ''): string[] {
  if (findings.length === 0) return [col(GREEN, '✓ No dead code found.')];
  const lines: string[] = [col(BOLD, `Found ${findings.length} dead code issue(s):`)];
  const MAX = 50;
  for (const f of findings.slice(0, MAX)) {
    const rel = f.filePath.replace(root, '').replace(/^\//, '');
    const loc = f.line ? `:${f.line}` : '';
    const sym = f.symbol ? ` ${col(CYAN, f.symbol)}` : '';
    lines.push(`  ${col(RED, '●')} ${DIM}${rel}${loc}${RESET}${sym} ${col(DIM, f.kind)}`);
  }
  if (findings.length > MAX) lines.push(col(DIM, `  ... and ${findings.length - MAX} more`));
  return lines;
}

export function buildHealthHumanLines(findings: HumanHealthFinding[], root = ''): string[] {
  if (findings.length === 0) return [col(GREEN, '✓ All functions within complexity thresholds.')];
  const lines: string[] = [col(BOLD, `Found ${findings.length} complex function(s):`)];
  const MAX = 30;
  for (const f of findings.slice(0, MAX)) {
    const rel = f.filePath.replace(root, '').replace(/^\//, '');
    const sev = f.severity === 'critical' ? col(RED, f.severity) : f.severity === 'high' ? col(YELLOW, f.severity) : col(MAGENTA, f.severity);
    lines.push(`  ${col(RED, '●')} ${DIM}${rel}:${f.startLine}${RESET} ${col(CYAN, f.functionName)} [cyc=${f.cyclomatic} cog=${f.cognitive} crap=${f.crapScore.toFixed(0)}] ${sev}`);
  }
  if (findings.length > MAX) lines.push(col(DIM, `  ... and ${findings.length - MAX} more`));
  return lines;
}

export function buildDuplicationHumanLines(groups: HumanDuplicationGroup[], root = ''): string[] {
  if (groups.length === 0) return [col(GREEN, '✓ No code duplication detected.')];
  const lines: string[] = [col(BOLD, `Found ${groups.length} clone group(s):`)];
  for (const g of groups.slice(0, 20)) {
    lines.push(`  ${col(YELLOW, '●')} Group ${g.groupId} — ${col(BOLD, String(g.duplicatedLines))} duplicated lines`);
    for (const inst of g.instances.slice(0, 3)) {
      const rel = inst.filePath.replace(root, '').replace(/^\//, '');
      lines.push(`    ${DIM}${rel}:${inst.startLine}–${inst.endLine}${RESET}`);
    }
    if (g.instances.length > 3) lines.push(col(DIM, `    ... and ${g.instances.length - 3} more instances`));
  }
  return lines;
}

export function buildExportTraceHumanLines(trace: { exportName: string; filePath: string; consumers: HumanTraceEntry[] }): string[] {
  const lines: string[] = [col(BOLD, `Export trace: ${col(CYAN, trace.exportName)} in ${DIM}${trace.filePath}${RESET}`)];
  if (trace.consumers.length === 0) {
    lines.push(col(YELLOW, '  (no consumers — may be dead code)'));
  } else {
    for (const c of trace.consumers) {
      lines.push(`  ${col(GREEN, '→')} ${DIM}${c.to}${RESET} ${col(DIM, c.reason)}`);
    }
  }
  return lines;
}

export function buildFileTraceHumanLines(trace: { filePath: string; importedBy: HumanTraceEntry[] }): string[] {
  const lines: string[] = [col(BOLD, `File trace: ${DIM}${trace.filePath}${RESET}`)];
  if (trace.importedBy.length === 0) {
    lines.push(col(YELLOW, '  (no importers — may be unused)'));
  } else {
    for (const c of trace.importedBy) {
      lines.push(`  ${col(GREEN, '←')} ${DIM}${c.from}${RESET} ${col(DIM, c.reason)}`);
    }
  }
  return lines;
}

export function buildDependencyTraceHumanLines(trace: { packageName: string; usedIn: HumanTraceEntry[] }): string[] {
  const lines: string[] = [col(BOLD, `Dependency trace: ${col(CYAN, trace.packageName)}`)];
  if (trace.usedIn.length === 0) {
    lines.push(col(YELLOW, '  (not imported anywhere — likely unused)'));
  } else {
    for (const u of trace.usedIn) {
      lines.push(`  ${col(GREEN, '→')} ${DIM}${u.from}${RESET} ${col(DIM, u.reason)}`);
    }
  }
  return lines;
}
