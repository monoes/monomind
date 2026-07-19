import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

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

// Shape of the bundled engine (cli/engine/detect-antipatterns.mjs).
interface DetectorEngine {
  detectText: (content: string, filePath: string, options?: Record<string, unknown>) => RawFinding[];
  detectHtml: (filePath: string, options?: Record<string, unknown>) => Promise<RawFinding[]>;
  detectUrl: (url: string, options?: Record<string, unknown>) => Promise<RawFinding[]>;
  walkDir: (dir: string) => string[];
  ANTIPATTERNS: Array<{ id: string; category?: string; severity?: string }>;
}

interface RawFinding {
  antipattern?: string;
  id?: string;
  name?: string;
  description?: string;
  severity?: string;
  file?: string;
  line?: number;
  snippet?: string;
}

// Typed as plain string so tsc emits a true dynamic import instead of trying
// to type-resolve the untyped .mjs engine module.
const ENGINE_SPECIFIER: string = '../cli/engine/detect-antipatterns.mjs';

let enginePromise: Promise<DetectorEngine | null> | undefined;

async function loadEngine(): Promise<DetectorEngine | null> {
  enginePromise ??= import(ENGINE_SPECIFIER).then(
    (mod) => mod as unknown as DetectorEngine,
    () => null,
  );
  return enginePromise;
}

/** True when the bundled detection engine can be loaded. */
export async function detectorAvailable(): Promise<boolean> {
  return (await loadEngine()) !== null;
}

const HTML_EXTENSIONS = new Set(['.html', '.htm']);

function mapSeverity(severity: string | undefined): AntipatternFinding['severity'] {
  if (severity === 'error') return 'error';
  if (severity === 'advisory' || severity === 'info') return 'info';
  return 'warning';
}

function toFinding(raw: RawFinding, categoryById: Map<string, string>): AntipatternFinding {
  const id = String(raw.antipattern ?? raw.id ?? '');
  return {
    id,
    category: (categoryById.get(id) ?? 'quality') as AntipatternCategory,
    name: String(raw.name ?? id),
    severity: mapSeverity(raw.severity),
    message: String(raw.description ?? raw.snippet ?? ''),
    file: raw.file ? String(raw.file) : undefined,
    line: raw.line ? Number(raw.line) : undefined,
  };
}

async function detectFile(engine: DetectorEngine, filePath: string): Promise<RawFinding[]> {
  if (HTML_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    return engine.detectHtml(filePath);
  }
  return engine.detectText(readFileSync(filePath, 'utf-8'), filePath);
}

/**
 * Run antipattern detection on a path (file, directory, or URL) using the
 * bundled detection engine (cli/engine/detect-antipatterns.mjs). URL targets
 * require the optional puppeteer dependency.
 */
export async function detectAntipatterns(target: string): Promise<DetectionResult> {
  const engine = await loadEngine();
  if (!engine) {
    throw new Error(
      'The monodesign detection engine could not be loaded. ' +
        'Reinstall @monoes/monodesign (its cli/engine/ directory is missing or its dependencies are not installed).',
    );
  }

  const start = Date.now();
  const categoryById = new Map(
    engine.ANTIPATTERNS.map((ap) => [ap.id, ap.category ?? 'quality']),
  );

  let raw: RawFinding[] = [];
  let fileCount = 0;

  if (/^https?:\/\//i.test(target)) {
    raw = await engine.detectUrl(target);
    fileCount = 1;
  } else if (existsSync(target) && statSync(target).isDirectory()) {
    const files = engine.walkDir(target);
    fileCount = files.length;
    for (const file of files) {
      raw.push(...(await detectFile(engine, file)));
    }
  } else if (existsSync(target)) {
    raw = await detectFile(engine, target);
    fileCount = 1;
  } else {
    throw new Error(`Target not found: ${target}`);
  }

  return {
    findings: raw.map((f) => toFinding(f, categoryById)),
    fileCount,
    durationMs: Date.now() - start,
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
