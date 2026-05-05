import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export type AntipatternCategory = 'slop' | 'quality' | 'performance' | 'accessibility';

export interface AntipatternFinding {
  id: string;
  category: AntipatternCategory;
  name: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
}

export interface DetectionResult {
  findings: AntipatternFinding[];
  fileCount: number;
  durationMs: number;
}

function impeccableAvailable(): boolean {
  const result = spawnSync('npx', ['--yes', '--quiet', 'impeccable', '--version'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  return result.status === 0;
}

/**
 * Run impeccable antipattern detection on a path (file, directory, or URL).
 * Returns structured findings. Requires `impeccable` to be installed.
 */
export async function detectAntipatterns(target: string): Promise<DetectionResult> {
  if (!impeccableAvailable()) {
    throw new Error(
      'impeccable is not installed. Run: npm install -g impeccable  or use: npx impeccable@latest detect ' + target,
    );
  }

  const start = Date.now();
  const result = spawnSync('npx', ['impeccable', 'detect', '--json', target], {
    encoding: 'utf8',
    timeout: 60_000,
  });

  const durationMs = Date.now() - start;

  if (result.status !== 0) {
    throw new Error(`impeccable exited with status ${result.status}: ${result.stderr}`);
  }

  const raw = JSON.parse(result.stdout || '{}');
  const findings: AntipatternFinding[] = (raw.findings ?? raw.issues ?? []).map((f: Record<string, unknown>) => ({
    id: String(f.id ?? ''),
    category: (f.category ?? 'quality') as AntipatternCategory,
    name: String(f.name ?? f.rule ?? ''),
    severity: (f.severity ?? 'warning') as AntipatternFinding['severity'],
    message: String(f.message ?? f.description ?? ''),
    file: f.file ? String(f.file) : undefined,
    line: f.line ? Number(f.line) : undefined,
  }));

  return {
    findings,
    fileCount: raw.fileCount ?? raw.files ?? 0,
    durationMs,
  };
}

/**
 * Format findings as a human-readable string for display in agent output.
 */
export function formatFindings(result: DetectionResult): string {
  if (result.findings.length === 0) {
    return `No antipatterns detected in ${result.fileCount} file(s). (${result.durationMs}ms)`;
  }

  const byCategory = result.findings.reduce<Record<string, AntipatternFinding[]>>((acc, f) => {
    (acc[f.category] ??= []).push(f);
    return acc;
  }, {});

  const lines: string[] = [
    `${result.findings.length} finding(s) in ${result.fileCount} file(s) — ${result.durationMs}ms`,
    '',
  ];

  for (const [cat, items] of Object.entries(byCategory)) {
    lines.push(`[${cat.toUpperCase()}]`);
    for (const f of items) {
      const loc = f.file ? `  ${f.file}${f.line ? `:${f.line}` : ''}` : '';
      lines.push(`  ${f.severity === 'error' ? '✗' : '⚠'} ${f.name}`);
      lines.push(`    ${f.message}`);
      if (loc) lines.push(loc);
    }
    lines.push('');
  }

  return lines.join('\n');
}
