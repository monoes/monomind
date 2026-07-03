import fs from 'fs';
import type { CapabilityModule, DirectoryScan, FileEntry, IndexResult, SearchResult } from './types.js';

const DATA_EXTENSIONS = new Set(['.csv', '.tsv', '.json', '.jsonl', '.sqlite', '.parquet', '.xlsx', '.xls']);

interface DataEntry {
  path: string;
  columns: string[];
  rowCount: number;
  sampleValues: Record<string, string[]>;
  description: string;
}

const indexedData = new Map<string, DataEntry>();

function parseCSV(content: string): { columns: string[]; rows: string[][] } {
  const lines = content.trim().split('\n');
  if (lines.length === 0) return { columns: [], rows: [] };

  const columns = lines[0].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((line) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
  return { columns, rows };
}

function parseJSON(content: string): { columns: string[]; rowCount: number; sampleValues: Record<string, string[]> } {
  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (arr.length === 0) return { columns: [], rowCount: 0, sampleValues: {} };

    const columns = Object.keys(arr[0]);
    const sampleValues: Record<string, string[]> = {};
    for (const col of columns) {
      sampleValues[col] = arr.slice(0, 3).map((row) => String(row[col] ?? ''));
    }
    return { columns, rowCount: arr.length, sampleValues };
  } catch {
    return { columns: [], rowCount: 0, sampleValues: {} };
  }
}

export const dataCapability: CapabilityModule = {
  name: 'data',

  detect(scan: DirectoryScan): number {
    return scan.capabilities.data.confidence;
  },

  async activate(_rootDir: string): Promise<void> {
    indexedData.clear();
  },

  async index(files: FileEntry[]): Promise<IndexResult> {
    let indexed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const file of files) {
      if (!DATA_EXTENSIONS.has(file.extension)) {
        skipped++;
        continue;
      }

      try {
        let columns: string[] = [];
        let rowCount = 0;
        let sampleValues: Record<string, string[]> = {};

        if (file.extension === '.csv' || file.extension === '.tsv') {
          const content = fs.readFileSync(file.absolutePath, 'utf-8');
          const parsed = parseCSV(content);
          columns = parsed.columns;
          rowCount = parsed.rows.length;
          for (const col of columns) {
            const colIdx = columns.indexOf(col);
            sampleValues[col] = parsed.rows.slice(0, 3).map((row) => row[colIdx] ?? '');
          }
        } else if (file.extension === '.json' || file.extension === '.jsonl') {
          const content = fs.readFileSync(file.absolutePath, 'utf-8');
          const parsed = parseJSON(content);
          columns = parsed.columns;
          rowCount = parsed.rowCount;
          sampleValues = parsed.sampleValues;
        } else {
          // .sqlite, .parquet, .xlsx — metadata only (no content extraction without heavy deps)
          columns = [];
          rowCount = 0;
        }

        const description =
          columns.length > 0
            ? `${file.path}: ${rowCount} rows, columns: ${columns.join(', ')}`
            : `${file.path}: structured data file`;

        indexedData.set(file.path, { path: file.path, columns, rowCount, sampleValues, description });
        indexed++;
      } catch (err) {
        errors.push(`${file.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { indexed, skipped, errors };
  },

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const queryLower = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const [dataPath, entry] of indexedData) {
      const descLower = entry.description.toLowerCase();
      const colMatch = entry.columns.some((c) => c.toLowerCase().includes(queryLower));
      const valMatch = Object.values(entry.sampleValues).flat().some((v) => v.toLowerCase().includes(queryLower));

      if (descLower.includes(queryLower) || colMatch || valMatch) {
        results.push({
          path: dataPath,
          score: colMatch ? 1.0 : valMatch ? 0.8 : 0.5,
          snippet: entry.description,
          type: 'data',
          metadata: { columns: entry.columns, rowCount: entry.rowCount },
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },
};
